import { closeDb } from "../../db/index.js";

/**
 * Wraps a CLI command function to ensure closeDb() is called on exit.
 * Prevents WAL checkpoint skips and lock file leaks on error paths.
 */
export async function withDb(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`\n❌ ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    try {
      closeDb();
    } catch {
      // Already closed — safe to ignore
    }
  }
}
