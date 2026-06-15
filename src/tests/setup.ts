/**
 * Global test preload (wired via bunfig.toml `[test] preload`).
 *
 * Runs once, before any test file or `src/config.ts` is imported. Its job is to
 * isolate the test run from the developer's `.env`:
 *
 * `config.ts` does `import "dotenv/config"`, so without this the test process
 * inherits real-world flags from `.env`. dotenv never overrides an already-set
 * process.env value, so setting vars here (before dotenv runs) wins.
 * Individual test files can still opt in by assigning the var at their own top
 * level, which executes after this preload.
 */
