import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { mkdirSync, existsSync, writeFileSync, readFileSync, unlinkSync } from "fs";
import { dirname } from "path";
import * as sqliteVec from "sqlite-vec";
import * as schema from "./schema.js";
import { getConfig } from "../config.js";

// ── PID lock helpers ────────────────────────────────────────────────────────────

/**
 * Read the process state from /proc/<pid>/status (Linux only).
 * Returns null on non-Linux or if the proc entry is unreadable.
 *
 * "T" = stopped (SIGTSTP), "Z" = zombie, "R"/"S"/"D" = running/sleeping/disk-sleep.
 * Stopped and zombie processes cannot make progress — they're safe to kill.
 */
function _getProcessState(pid: number): string | null {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf-8");
    const match = status.match(/^State:\s+(\w)/m);
    return match ? match[1] : null;
  } catch {
    return null; // non-Linux or permission denied — err on the side of caution
  }
}

/** Check if a stopped/zombie PID should be auto-recovered. */
function _isStuckProcess(pid: number): boolean {
  const state = _getProcessState(pid);
  return state === "T" || state === "Z";
}

let _db: BunSQLiteDatabase<typeof schema> | null = null;
let _sqlite: Database | null = null;
let _lockPath: string | null = null;   // PID lock file path for cleanup on exit
let _exitHandlerRegistered = false;

/** Best-effort cleanup of the PID lock file on process exit. */
function _cleanupLockFile(): void {
  if (_lockPath) {
    try { if (existsSync(_lockPath)) unlinkSync(_lockPath); } catch {}
  }
}

export function getDb(): BunSQLiteDatabase<typeof schema> {
  if (!_db) {
    const config = getConfig();
    const dbPath = config.db.path;

    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // ── PID lock file — prevent concurrent instances from corrupting the DB ──
    const lockPath = dbPath + ".lock";
    try {
      if (existsSync(lockPath)) {
        const stalePid = parseInt(readFileSync(lockPath, "utf-8").trim(), 10);
        if (!Number.isNaN(stalePid)) {
          try {
            // Signal 0 checks if the process exists without sending an actual signal
            process.kill(stalePid, 0);

            // The process still exists. Check if it's stuck (stopped/zombie) —
            // those can't make progress and are safe to auto-recover.
            if (_isStuckProcess(stalePid)) {
              const stateLabel = _getProcessState(stalePid) === "T" ? "stopped" : "zombie";
              try {
                process.kill(stalePid, "SIGKILL");
                console.warn(
                  `⚠️  A previous co-scientist instance (PID ${stalePid}) was found in a ` +
                  `${stateLabel} state and has been terminated.\n` +
                  `   Starting a fresh session...`
                );
              } catch {
                // If we can't kill it, fall through to the error below
                throw new Error(
                  `A previous co-scientist instance (PID ${stalePid}) is in a ${stateLabel} ` +
                  `state but could not be terminated.\n` +
                  `  Please kill it manually: kill -9 ${stalePid}\n` +
                  `  Or delete the lock file: rm ${lockPath}`
                );
              }
            } else {
              throw new Error(
                `Another co-scientist instance is already running (PID ${stalePid}). ` +
                `Only one instance can access the database at a time.\n` +
                `  • If you are sure no other instance is running, delete ${lockPath}\n` +
                `  • To resume the existing session: co-scientist resume <sessionId>\n` +
                `  • Database: ${dbPath}`
              );
            }
          } catch (err: any) {
            // ESRCH = no such process — stale lock file, safe to replace
            if (!("code" in err && err.code === "ESRCH")) throw err;
            // Stale lock — the PID no longer exists, so we can safely replace it
          }
        }
      }
      writeFileSync(lockPath, String(process.pid));
      _lockPath = lockPath;

      // Clean up the lock file on normal exit (SIGINT, uncaught exception, etc.).
      // SIGKILL bypasses this but the next run's PID check handles that case.
      if (!_exitHandlerRegistered) {
        _exitHandlerRegistered = true;
        process.on("exit", _cleanupLockFile);
      }
    } catch (err: any) {
      // Re-throw our own "already running" error; swallow everything else so a
      // permission-denied on the lock file is not fatal to startup.
      if (err.message?.includes("Another co-scientist instance is already running")) {
        throw err;
      }
    }

    _sqlite = new Database(dbPath);

    // Enable WAL mode for better concurrent performance
    _sqlite.exec("PRAGMA journal_mode = WAL");
    _sqlite.exec("PRAGMA foreign_keys = ON");
    // Wait (up to 5s) for a lock instead of failing immediately with SQLITE_BUSY.
    // Hardens against transient contention from multiple workers (MAX_WORKERS) and
    // from overlapping connections on slow CI.
    _sqlite.exec("PRAGMA busy_timeout = 5000");

    // ── WAL checkpoint — clean up stale WAL from crashed previous sessions ──
    // In WAL mode, a crashed process can leave behind a large WAL file. The
    // checkpoint folds WAL pages back into the main DB and truncates the WAL,
    // eliminating stale-lock edge cases on the next connection.
    try {
      _sqlite.query("PRAGMA wal_checkpoint(TRUNCATE)").run();
    } catch {
      // Best-effort — if the DB is somehow still locked, we'll hit the
      // busy_timeout on the first real query instead.
    }

    // Load sqlite-vec extension — provides vec0 virtual tables for ANN vector search
    sqliteVec.load(_sqlite);

    _db = drizzle(_sqlite, { schema });
  }
  return _db;
}

export function getSqlite(): Database {
  getDb(); // Ensure initialized
  return _sqlite!;
}

// ── Retry helper for transient SQLITE_LOCKED errors ──────────────────────────

/**
 * Execute a database operation with automatic retry on transient "database is
 * locked" errors.  SQLite can return SQLITE_LOCKED even in single-process
 * single-connection scenarios — e.g. when a WAL checkpoint is running or when
 * the sqlite-vec extension holds internal locks.  A short back-off resolves
 * these without crashing the session.
 *
 * Only wraps the call; does NOT begin a transaction — callers that need
 * atomicity must manage transactions themselves.
 */
export function withRetry<T>(fn: () => T, maxRetries = 3): T {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return fn();
    } catch (err: any) {
      lastError = err;
      const msg: string = err?.message ?? "";
      // Only retry on "database is locked" (SQLITE_LOCKED / error code 6).
      // SQLITE_BUSY (5) is already handled by busy_timeout.
      if (!msg.includes("database is locked") || attempt >= maxRetries) {
        throw err;
      }
      // Exponential backoff: 100ms, 200ms, 400ms
      const delay = 100 * Math.pow(2, attempt);
      // Busy-wait since we're in a synchronous context (Bun SQLite ops are sync).
      const end = Date.now() + delay;
      while (Date.now() < end) { /* spin */ }
    }
  }
  throw lastError ?? new Error("Retry exhausted with no error captured");
}

export function closeDb() {
  if (_sqlite) {
    // Run a final WAL checkpoint to fold everything back into the main DB
    try { _sqlite.query("PRAGMA wal_checkpoint(TRUNCATE)").run(); } catch {}
    _sqlite.close();
    _sqlite = null;
    _db = null;
    _cleanupLockFile();
    // Reset the ContextStore singleton so it doesn't retain a stale DB handle.
    // Import is deferred to avoid circular dependency (contextStore imports from us).
    import("../memory/contextStore.js")
      .then(m => m.resetContextStore())
      .catch(() => { /* best-effort */ });
  }
}

/** Reset singletons without closing (for test isolation when DB_PATH changes). */
export function resetDb() {
  _sqlite = null;
  _db = null;
}

export { schema };
