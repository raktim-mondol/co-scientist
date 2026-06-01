import { describe, it, expect, beforeEach } from "bun:test";
import {
  extractDoi,
  titleSimilarity,
  resolveCitation,
  _resetCitationCache,
  type FetchFn,
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
