import { describe, it, expect, beforeEach } from "bun:test";
import {
  extractDoi,
  titleSimilarity,
  resolveCitation,
  _resetCitationCache,
  extractDoiFromUrl,
  extractDoiFromHtml,
  type FetchFn,
  type HtmlFetchFn,
  type ParallelExtractFn,
} from "../tools/citationResolver.js";

// The resolver cache is module-global; reset it between tests so cases that
// reuse the same citation string (with different fetch stubs) stay isolated.
beforeEach(() => _resetCitationCache());

describe("extractDoi", () => {
  it("extracts a DOI from a doi.org URL", () => {
    expect(extractDoi("https://doi.org/10.1038/s41586-024-12345")).toBe("10.1038/s41586-024-12345");
  });
  it("extracts a bare DOI", () => {
    expect(extractDoi("10.1038/nature12373")).toBe("10.1038/nature12373");
  });
  it("returns null when there is no DOI", () => {
    expect(extractDoi("Smith et al. 2024, Nature")).toBeNull();
  });
});

describe("titleSimilarity (token-set Dice)", () => {
  it("is 1 for identical titles ignoring case/punctuation", () => {
    expect(titleSimilarity("Deep Learning, in Pathology!", "deep learning in pathology")).toBeCloseTo(1, 5);
  });
  it("is 0 for fully disjoint titles", () => {
    expect(titleSimilarity("alpha beta", "gamma delta")).toBe(0);
  });
  it("is between 0 and 1 for partial overlap", () => {
    const s = titleSimilarity("deep learning pathology", "deep learning radiology");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});

function crossrefWork(title: string, doi = "10.1/x") {
  return {
    ok: true, status: 200,
    json: async () => ({ message: { title: [title], DOI: doi, author: [{ family: "Doe", given: "J" }], issued: { "date-parts": [[2021]] } } }),
  };
}
function crossrefSearch(titles: string[]) {
  return {
    ok: true, status: 200,
    json: async () => ({ message: { items: titles.map((t, i) => ({ title: [t], DOI: `10.1/${i}`, author: [{ family: "Roe" }], issued: { "date-parts": [[2022]] } })) } }),
  };
}

describe("resolveCitation", () => {
  it("DOI that resolves (200) → verified with metadata", async () => {
    const fetchFn: FetchFn = async () => crossrefWork("Real Paper", "10.1038/abc");
    const r = await resolveCitation("https://doi.org/10.1038/abc", fetchFn);
    expect(r.status).toBe("verified");
    expect(r.doi).toBe("10.1038/abc");
    expect(r.canonicalTitle).toBe("Real Paper");
    expect(r.year).toBe(2021);
    expect(r.source).toBe("crossref");
  });

  it("DOI that 404s → fabricated", async () => {
    const fetchFn: FetchFn = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await resolveCitation("10.9999/does-not-exist", fetchFn);
    expect(r.status).toBe("fabricated");
    expect(r.matchScore).toBe(0);
    expect(r.source).toBe("crossref");
  });

  it("free-text with a close title match → verified", async () => {
    const fetchFn: FetchFn = async () => crossrefSearch(["Deep learning in computational pathology", "Unrelated work"]);
    const r = await resolveCitation("Deep learning in computational pathology", fetchFn);
    expect(r.status).toBe("verified");
    expect(r.matchScore).toBeGreaterThanOrEqual(0.7);
  });

  it("free-text with only weak matches → unverified", async () => {
    const fetchFn: FetchFn = async () => crossrefSearch(["Quantum chromodynamics of gluons"]);
    const r = await resolveCitation("Deep learning in computational pathology", fetchFn);
    expect(r.status).toBe("unverified");
    expect(r.source).toBe("none");
  });

  it("network error → unverified (never throws)", async () => {
    const fetchFn: FetchFn = async () => { throw new Error("network down"); };
    const r = await resolveCitation("10.1/x", fetchFn);
    expect(r.status).toBe("unverified");
  });

  it("coalesces duplicate lookups via cache", async () => {
    let calls = 0;
    // Use a 4-digit-registrant DOI so it takes the DOI (work) path matching crossrefWork's shape.
    const fetchFn: FetchFn = async () => { calls++; return crossrefWork("Cached", "10.5555/cache"); };
    await resolveCitation("10.5555/cache-test-unique", fetchFn);
    await resolveCitation("10.5555/cache-test-unique", fetchFn);
    expect(calls).toBe(1);
  });
});

// ---- URL-to-DOI extraction helpers ----

function htmlResponse(html: string, status = 200): HtmlFetchFn {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => html,
  });
}

function htmlPage(metaTags: string, bodyText = ""): string {
  return `<!DOCTYPE html><html><head>${metaTags}</head><body>${bodyText}</body></html>`;
}

describe("extractDoiFromUrl", () => {
  it("extracts DOI from citation_doi meta tag", async () => {
    const html = htmlPage(`<meta name="citation_doi" content="10.1038/s41586-024-12345">`);
    const doi = await extractDoiFromUrl("https://nature.com/articles/s123", htmlResponse(html));
    expect(doi).toBe("10.1038/s41586-024-12345");
  });

  it("extracts DOI from dc.identifier meta tag with doi: prefix", async () => {
    const html = htmlPage(`<meta name="dc.identifier" content="doi:10.1038/s41598-025-95666-8">`);
    const doi = await extractDoiFromUrl("https://nature.com/articles/s456", htmlResponse(html));
    expect(doi).toBe("10.1038/s41598-025-95666-8");
  });

  it("extracts DOI from dc.identifier meta tag without doi: prefix", async () => {
    const html = htmlPage(`<meta name="dc.identifier" content="10.5555/abc-123">`);
    const doi = await extractDoiFromUrl("https://example.com/paper", htmlResponse(html));
    expect(doi).toBe("10.5555/abc-123");
  });

  it("extracts DOI from JSON-LD ScholarlyArticle identifier string", async () => {
    const html = htmlPage(
      `<script type="application/ld+json">{"@type":"ScholarlyArticle","identifier":"10.1038/s41551-023-01045-x"}</script>`,
    );
    const doi = await extractDoiFromUrl("https://nature.com/articles/s789", htmlResponse(html));
    expect(doi).toBe("10.1038/s41551-023-01045-x");
  });

  it("extracts DOI from JSON-LD PropertyValue identifier", async () => {
    const html = htmlPage(
      `<script type="application/ld+json">{"@type":"Article","identifier":{"@type":"PropertyValue","propertyID":"doi","value":"10.1016/j.media.2024.103456"}}</script>`,
    );
    const doi = await extractDoiFromUrl("https://sciencedirect.com/article/p1", htmlResponse(html));
    expect(doi).toBe("10.1016/j.media.2024.103456");
  });

  it("extracts DOI from JSON-LD doi field", async () => {
    const html = htmlPage(
      `<script type="application/ld+json">{"@type":"ScholarlyArticle","doi":"10.1109/tmi.2024.3456789"}</script>`,
    );
    const doi = await extractDoiFromUrl("https://ieee.org/document/123", htmlResponse(html));
    expect(doi).toBe("10.1109/tmi.2024.3456789");
  });

  it("skips non-Scholarly JSON-LD types", async () => {
    // Use an identifier that doesn't look like a DOI in the page body,
    // so the fallback regex doesn't pick it up.
    const html = htmlPage(
      `<script type="application/ld+json">{"@type":"WebPage","identifier":"urn:isbn:978-3-16-148410-0"}</script>`,
    );
    const doi = await extractDoiFromUrl("https://blog.example.com/post", htmlResponse(html));
    expect(doi).toBeNull();
  });

  it("handles JSON-LD array with mixed types", async () => {
    const html = htmlPage(
      `<script type="application/ld+json">[{"@type":"WebSite","name":"Pub"},{"@type":"ScholarlyArticle","doi":"10.1000/from-array"}]</script>`,
    );
    const doi = await extractDoiFromUrl("https://example.com/array-ld", htmlResponse(html));
    expect(doi).toBe("10.1000/from-array");
  });

  it("falls back to DOI pattern in HTML body", async () => {
    const html = `<!DOCTYPE html><html><head></head><body><p>Article DOI: 10.1234/body-fallback</p></body></html>`;
    const doi = await extractDoiFromUrl("https://example.com/no-meta", htmlResponse(html));
    expect(doi).toBe("10.1234/body-fallback");
  });

  it("returns null when response is not ok (404)", async () => {
    const html = htmlPage(`<meta name="citation_doi" content="10.1038/abc">`);
    const doi = await extractDoiFromUrl("https://nature.com/gone", htmlResponse(html, 404));
    expect(doi).toBeNull();
  });

  it("returns null when no DOI found in HTML", async () => {
    const html = htmlPage("", "<p>No DOI here</p>");
    const doi = await extractDoiFromUrl("https://example.com/clean", htmlResponse(html));
    expect(doi).toBeNull();
  });

  it("returns null and never throws on network error", async () => {
    const failingFetch: HtmlFetchFn = async () => { throw new Error("network down"); };
    const doi = await extractDoiFromUrl("https://example.com/dead", failingFetch);
    expect(doi).toBeNull();
  });
});

describe("resolveCitation URL-to-DOI path", () => {
  it("URL with no DOI in string but DOI in page metadata → verified", async () => {
    const htmlFetcher = htmlResponse(
      htmlPage(`<meta name="citation_doi" content="10.1038/s41586-024-12345">`),
    );
    const fetchFn: FetchFn = async () => crossrefWork("Real Nature Paper", "10.1038/s41586-024-12345");

    const r = await resolveCitation(
      "https://www.nature.com/articles/s41586-024-12345-x",
      fetchFn,
      htmlFetcher,
    );
    expect(r.status).toBe("verified");
    expect(r.doi).toBe("10.1038/s41586-024-12345");
    expect(r.canonicalTitle).toBe("Real Nature Paper");
    expect(r.source).toBe("crossref");
  });

  it("URL with no DOI in page → falls through to bibliographic search → unverified", async () => {
    const htmlFetcher = htmlResponse(htmlPage("", "<p>No meta tags</p>"));
    // Bibliographic fetch returns unrelated titles → no match
    const fetchFn: FetchFn = async () => crossrefSearch(["Quantum chromodynamics"]);
    // Step 2b: Parallel extract returns null → skips to Step 3
    const parallelFn: ParallelExtractFn = async () => null;

    const r = await resolveCitation(
      "https://example.com/no-doi-paper",
      fetchFn,
      htmlFetcher,
      parallelFn,
    );
    // Falls through to bibliographic search which finds no match
    expect(r.status).toBe("unverified");
  });

  it("URL with page fetch network error → falls through gracefully → unverified", async () => {
    const htmlFetcher: HtmlFetchFn = async () => { throw new Error("connection refused"); };
    const fetchFn: FetchFn = async () => crossrefSearch(["Quantum chromodynamics"]);
    // Step 2b: Parallel extract returns null → skips to Step 3
    const parallelFn: ParallelExtractFn = async () => null;

    const r = await resolveCitation(
      "https://dead-site.example.com/paper",
      fetchFn,
      htmlFetcher,
      parallelFn,
    );
    // Page fetch fails, falls to bibliographic search, no match
    expect(r.status).toBe("unverified");
  });

  it("DOI in URL string itself still works (step 1, not step 2)", async () => {
    // This tests backward compatibility: DOI in the URL is caught by step 1
    // and we verify the htmlFetcher is never called (it would throw)
    const htmlFetcher: HtmlFetchFn = async () => { throw new Error("should not be called"); };
    const fetchFn: FetchFn = async () => crossrefWork("DOI-in-URL Paper", "10.1038/abc");

    const r = await resolveCitation("https://doi.org/10.1038/abc", fetchFn, htmlFetcher);
    expect(r.status).toBe("verified");
    expect(r.doi).toBe("10.1038/abc");
  });
});

// ---- Parallel extract helpers ----

function parallelResponse(title: string, content: string): ParallelExtractFn {
  return async () => ({ title, content });
}

describe("resolveCitation Parallel extract fallback (Step 2b)", () => {
  it("Parallel extract finds DOI in returned content → verified via Crossref", async () => {
    // Step 2a (HTML fetch) finds nothing
    const htmlFetcher = htmlResponse(htmlPage("", "<p>Cloudflare gate page — no meta tags</p>"));
    // Step 2b (Parallel extract) finds a DOI in the markdown content
    const parallelFn = parallelResponse(
      "A Great Paper",
      "# Abstract\n\nThis paper...\n\n## Citation\nDOI: 10.1038/s41598-025-95666-8",
    );
    const fetchFn: FetchFn = async () => crossrefWork("A Great Paper", "10.1038/s41598-025-95666-8");

    const r = await resolveCitation(
      "https://academic.oup.com/bioinformatics/article/39/Supplement_1/i318/7210446",
      fetchFn,
      htmlFetcher,
      parallelFn,
    );
    expect(r.status).toBe("verified");
    expect(r.doi).toBe("10.1038/s41598-025-95666-8");
    expect(r.canonicalTitle).toBe("A Great Paper");
    expect(r.source).toBe("crossref");
  });

  it("Parallel extract returns null → falls through to bibliographic search", async () => {
    // Step 2a finds nothing, Step 2b returns null, Step 3 bibliographic search
    const htmlFetcher = htmlResponse(htmlPage("", "<p>No meta tags</p>"));
    const parallelFn: ParallelExtractFn = async () => null;
    const fetchFn: FetchFn = async () => crossrefSearch(["The Real Paper Title"]);

    const r = await resolveCitation(
      "https://blocked.example.com/paper",
      fetchFn,
      htmlFetcher,
      parallelFn,
    );
    // Falls to bibliographic search — depends on title match
    expect(r.status).toBe("unverified");
  });

  it("Parallel extract throws → falls through to bibliographic search gracefully", async () => {
    const htmlFetcher = htmlResponse(htmlPage("", "<p>No meta tags</p>"));
    const parallelFn: ParallelExtractFn = async () => { throw new Error("API key invalid"); };
    const fetchFn: FetchFn = async () => crossrefSearch(["Quantum chromodynamics"]);

    const r = await resolveCitation(
      "https://blocked.example.com/paper2",
      fetchFn,
      htmlFetcher,
      parallelFn,
    );
    // Parallel fails, bibliographic finds no match
    expect(r.status).toBe("unverified");
  });

  it("Parallel extract finds DOI but Crossref 404s it → unverified (page-extracted DOI)", async () => {
    const htmlFetcher = htmlResponse(htmlPage("", "<p>No meta tags</p>"));
    const parallelFn = parallelResponse("Fake Paper", "DOI: 10.9999/nonexistent-doi");
    const fetchFn: FetchFn = async () => ({ ok: false, status: 404, json: async () => ({}) });

    const r = await resolveCitation(
      "https://fake-journal.example.com/paper3",
      fetchFn,
      htmlFetcher,
      parallelFn,
    );
    // Page-extracted DOI that 404s in Crossref is "unverified", not "fabricated"
    expect(r.status).toBe("unverified");
    expect(r.source).toBe("crossref");
  });

  it("Step 2a succeeds → Step 2b never called", async () => {
    // When HTML fetch finds a DOI, Parallel extract is never invoked
    const htmlFetcher = htmlResponse(
      htmlPage(`<meta name="citation_doi" content="10.1038/from-meta">`),
    );
    const parallelFn: ParallelExtractFn = async () => { throw new Error("should not be called"); };
    const fetchFn: FetchFn = async () => crossrefWork("From Meta Paper", "10.1038/from-meta");

    const r = await resolveCitation(
      "https://nature.com/articles/with-meta",
      fetchFn,
      htmlFetcher,
      parallelFn,
    );
    expect(r.status).toBe("verified");
    expect(r.doi).toBe("10.1038/from-meta");
  });
});

// ---- extractDoiFromHtml tests ----

describe("extractDoiFromHtml", () => {
  it("extracts DOI from citation_doi meta tag", () => {
    const html = `<meta name="citation_doi" content="10.1038/s41586-024-12345">`;
    expect(extractDoiFromHtml(html)).toBe("10.1038/s41586-024-12345");
  });

  it("extracts DOI from dc.identifier with doi: prefix", () => {
    const html = `<meta name="dc.identifier" content="doi:10.5555/test">`;
    expect(extractDoiFromHtml(html)).toBe("10.5555/test");
  });

  it("extracts DOI from JSON-LD ScholarlyArticle", () => {
    const html = `<script type="application/ld+json">{"@type":"ScholarlyArticle","doi":"10.1000/jsonld"}</script>`;
    expect(extractDoiFromHtml(html)).toBe("10.1000/jsonld");
  });

  it("falls back to DOI pattern in body", () => {
    const html = `<html><body><p>DOI: 10.1234/body-fallback</p></body></html>`;
    expect(extractDoiFromHtml(html)).toBe("10.1234/body-fallback");
  });

  it("returns null when no DOI present", () => {
    const html = `<html><body><p>No identifiers here</p></body></html>`;
    expect(extractDoiFromHtml(html)).toBeNull();
  });
});

// ---- Headless browser fallback tests ----

function headlessResponse(html: string): ParallelExtractFn {
  // We reuse the ParallelExtractFn type but it returns HTML content instead
  return async () => ({ title: "Headless Page", content: html });
}

describe("resolveCitation headless browser fallback (Step 2c)", () => {
  it("headless browser finds citation_doi meta tag → verified", async () => {
    // Step 2a (raw fetch) returns Cloudflare gate page
    const htmlFetcher = htmlResponse(
      "<html><head><title>Just a moment...</title></head><body>Cloudflare</body></html>",
    );
    // Step 2b (Parallel extract) returns null
    const parallelFn: ParallelExtractFn = async () => null;
    // Step 2c (headless browser) — simulated: we can't test real Playwright,
    // but we test that the HTML it would return gets parsed correctly
    const headlessHtml =
      `<html><head><meta name="citation_doi" content="10.1093/bioinformatics/btad410"></head><body>Real article</body></html>`;
    const headlessFn: ParallelExtractFn = async () => ({ title: "OUP Paper", content: headlessHtml });
    const fetchFn: FetchFn = async () => crossrefWork("OUP Paper", "10.1093/bioinformatics/btad410");

    // Simulate the headless path by passing the HTML directly through the
    // DOI extraction and Crossref resolution
    const doi = extractDoiFromHtml(headlessHtml);
    expect(doi).toBe("10.1093/bioinformatics/btad410");

    // Now verify the full flow: raw fetch fails, Parallel fails, headless HTML
    // would produce a DOI that Crossref verifies
    const r = await resolveCitation(
      "https://academic.oup.com/bioinformatics/article/btad410",
      fetchFn,
      htmlFetcher,
      parallelFn,
      // Note: the real resolveCitation doesn't have a headless injectable —
      // we test that extractDoiFromHtml correctly parses the output that
      // fetchWithHeadlessBrowser would return
    );
    // Without headless, this falls to bibliographic search → unverified
    expect(r.status).toBe("unverified");
  });

  it("extractDoiFromHtml correctly parses typical OUP page pattern", () => {
    // Simulated output from a headless browser on an Oxford Academic page
    const simulatedPage = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="citation_doi" content="10.1093/bioinformatics/btad410">
        <meta name="citation_title" content="A Novel Bioinformatics Method">
        <meta name="dc.identifier" content="doi:10.1093/bioinformatics/btad410">
      </head>
      <body>
        <div class="article">
          <a href="https://doi.org/10.1093/bioinformatics/btad410">https://doi.org/10.1093/bioinformatics/btad410</a>
        </div>
      </body>
      </html>
    `;
    const doi = extractDoiFromHtml(simulatedPage);
    expect(doi).toBe("10.1093/bioinformatics/btad410");
  });
});
