import { describe, it, expect, beforeEach } from "bun:test";
import {
  extractDoi,
  titleSimilarity,
  resolveCitation,
  _resetCitationCache,
  extractDoiFromUrl,
  type FetchFn,
  type HtmlFetchFn,
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

    const r = await resolveCitation(
      "https://example.com/no-doi-paper",
      fetchFn,
      htmlFetcher,
    );
    // Falls through to bibliographic search which finds no match
    expect(r.status).toBe("unverified");
  });

  it("URL with page fetch network error → falls through gracefully → unverified", async () => {
    const htmlFetcher: HtmlFetchFn = async () => { throw new Error("connection refused"); };
    const fetchFn: FetchFn = async () => crossrefSearch(["Quantum chromodynamics"]);

    const r = await resolveCitation(
      "https://dead-site.example.com/paper",
      fetchFn,
      htmlFetcher,
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
