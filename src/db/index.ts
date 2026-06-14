import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import * as sqliteVec from "sqlite-vec";
import * as schema from "./schema.js";
import { getConfig } from "../config.js";

let _db: BunSQLiteDatabase<typeof schema> | null = null;
let _sqlite: Database | null = null;

export function getDb(): BunSQLiteDatabase<typeof schema> {
  if (!_db) {
    const config = getConfig();
    const dbPath = config.db.path;

    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    _sqlite = new Database(dbPath);

    // Enable WAL mode for better concurrent performance
    _sqlite.exec("PRAGMA journal_mode = WAL");
    _sqlite.exec("PRAGMA foreign_keys = ON");
    // Wait (up to 5s) for a lock instead of failing immediately with SQLITE_BUSY.
    // Hardens against transient contention from multiple workers (MAX_WORKERS) and
    // from overlapping connections on slow CI.
    _sqlite.exec("PRAGMA busy_timeout = 5000");

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

export function closeDb() {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
    _db = null;
  }
}

/** Reset singletons without closing (for test isolation when DB_PATH changes). */
export function resetDb() {
  _sqlite = null;
  _db = null;
}

export { schema };
