/**
 * Global test preload (wired via bunfig.toml `[test] preload`).
 *
 * Runs once, before any test file or `src/config.ts` is imported. Its job is to
 * isolate the test run from the developer's `.env`:
 *
 * `config.ts` does `import "dotenv/config"`, so without this the test process
 * inherits real-world flags from `.env`. In particular CITATION_HEADLESS_BROWSER
 * leaks in as "true", which makes `resolveCitation` launch a real headless
 * Chromium against live URLs (academic.oup.com, …). That blocks ~30s on
 * `waitUntil: networkidle`, starves the CPU, and makes the embedding-based RLEF /
 * RewardStore tests exceed their timeout — surfacing as flaky "database" failures.
 *
 * dotenv never overrides an already-set process.env value, so setting it here
 * (before dotenv runs) wins. Individual test files can still opt in by assigning
 * the var at their own top level, which executes after this preload.
 */
process.env.CITATION_HEADLESS_BROWSER = "false";
