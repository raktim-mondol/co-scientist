import { logger } from "../config.js";

const HEADLESS_TIMEOUT_MS = 20_000;

/**
 * Fetch a URL's rendered HTML using a headless Chromium browser via Playwright.
 *
 * This is a heavy fallback for JS-heavy pages (Cloudflare challenges, SPAs)
 * that resist raw fetch() and Parallel AI extraction. It launches a real
 * Chromium instance, executes JavaScript, and returns the final DOM as HTML.
 *
 * Lazy-imported: the `playwright` module (~20MB) is only loaded when this
 * function is actually called, so there is zero startup penalty unless the
 * feature is enabled and triggered. The browser binary (~200MB) must be
 * installed separately via `npx playwright install chromium`.
 *
 * Only called when:
 *   - `tools.citationHeadlessBrowser` is true in config
 *   - Steps 2a (raw fetch) and 2b (Parallel AI extract) both returned no DOI
 *
 * Can handle non-interactive Cloudflare Turnstile challenges (JS execution).
 * Cannot handle interactive CAPTCHAs (reCAPTCHA v2 checkbox, hCaptcha).
 *
 * Returns the rendered page HTML, or null on any failure. Never throws.
 */
export async function fetchWithHeadlessBrowser(url: string): Promise<string | null> {
  try {
    const { chromium } = await import("playwright");

    const browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
      timeout: HEADLESS_TIMEOUT_MS,
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
      locale: "en-US",
    });

    const page = await context.newPage();
    const response = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: HEADLESS_TIMEOUT_MS,
    });

    if (!response || !response.ok()) {
      await browser.close();
      return null;
    }

    const html = await page.content();
    await browser.close();
    return html;
  } catch (err) {
    logger.warn(
      `[HeadlessResolver] browser fetch failed for "${url.slice(0, 80)}": ${(err as Error).message}`,
    );
    return null;
  }
}
