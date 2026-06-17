import { logger } from "../config.js";
import { getSearchTool } from "./search.js";

export type CitationStatus = "verified" | "unverified" | "fabricated";

export interface CitationResolution {
  raw: string;
  status: CitationStatus;
  canonicalTitle?: string;
  doi?: string;
  authors?: string;
  year?: number;
  matchScore: number;
  source: "crossref" | "none";
}

export type FetchFn = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export type HtmlFetchFn = (url: string) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export type ParallelExtractFn = (url: string) => Promise<{ title: string; content: string } | null>;

const CROSSREF_BASE = "https://api.crossref.org/works";
const TITLE_MATCH_THRESHOLD = 0.7;
const TIMEOUT_MS = 6000;
// Polite pool: identify ourselves via mailto (query param + User-Agent) for
// higher, more reliable rate limits. No API key needed — Plus is the only keyed tier.
// Set CROSSREF_MAILTO in your environment to use your own address.
const MAILTO = process.env.CROSSREF_MAILTO ?? "user@example.com";
const UA = `co-scientist/1.0 (citation-integrity; mailto:${MAILTO})`;

// In-process cache: coalesce duplicate lookups within a run.
const _cache = new Map<string, Promise<CitationResolution>>();

/** Extract the first DOI from a string (bare or inside a URL). Returns null if none. */
export function extractDoi(s: string): string | null {
  const m = s.match(/10\.\d{4,}\/[^\s"<>]+/);
  if (!m) return null;
  // Trim common trailing punctuation that isn't part of a DOI.
  return m[0].replace(/[.,;)\]]+$/, "");
}

/** Returns true if the string looks like an HTTP(S) URL. */
function isUrl(s: string): boolean {
  return /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(s.trim());
}

function normalizeTitle(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Token-set Dice coefficient over normalized titles. 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const setA = new Set(normalizeTitle(a));
  const setB = new Set(normalizeTitle(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return (2 * inter) / (setA.size + setB.size);
}

interface CrossrefItem {
  title?: string[];
  DOI?: string;
  author?: Array<{ family?: string; given?: string }>;
  issued?: { "date-parts"?: number[][] };
}

function itemMeta(item: CrossrefItem): Pick<CitationResolution, "canonicalTitle" | "doi" | "authors" | "year"> {
  return {
    canonicalTitle: item.title?.[0],
    doi: item.DOI,
    authors: (item.author ?? []).map((a) => a.family).filter(Boolean).join(", ") || undefined,
    year: item.issued?.["date-parts"]?.[0]?.[0],
  };
}

/**
 * Resolve a known DOI via Crossref API. Called both for DOIs extracted from the
 * citation string and for DOIs extracted from fetched HTML. Never throws —
 * callers are responsible for try-catch.
 */
async function _resolveByDoi(
  doi: string,
  raw: string,
  fetchFn: FetchFn,
  doiSource: "raw" | "page" = "raw",
): Promise<CitationResolution> {
  const res = await withTimeout(fetchFn(`${CROSSREF_BASE}/${encodeURIComponent(doi)}?mailto=${MAILTO}`));
  if (res.status === 404) {
    // DOI provided directly by the user → fabricated. DOI extracted from a
    // fetched page → unverified (real page, just not in Crossref).
    const status: CitationStatus = doiSource === "page" ? "unverified" : "fabricated";
    return { raw, status, matchScore: 0, source: "crossref" };
  }
  if (res.ok) {
    const body = (await res.json()) as { message?: CrossrefItem };
    const meta = itemMeta(body.message ?? {});
    return { raw, status: "verified", matchScore: 1, source: "crossref", ...meta };
  }
  // Other non-OK (rate limit, 5xx) — can't confirm; treat as unverified.
  return { raw, status: "unverified", matchScore: 0, source: "none" };
}

async function withTimeout<T>(p: Promise<T>, ms?: number, label?: string): Promise<T> {
  const timeoutMs = ms ?? TIMEOUT_MS;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label ?? "crossref"} timeout`)), timeoutMs)),
  ]);
}

/** Resolve one citation string to an existence verdict via Crossref. Never throws. */
// NOTE: The cache key is raw-string-only. If the same raw string is resolved
// with different fetch/htmlFetch functions, the second call returns the first
// call's cached result. For production use (one fetcher per resolution) this is
// correct. Tests that change the fetcher between calls must use unique strings.
export function resolveCitation(
  raw: string,
  fetchFn: FetchFn = globalFetch,
  htmlFetchFn?: HtmlFetchFn,
  parallelExtractFn?: ParallelExtractFn,
): Promise<CitationResolution> {
  const key = raw.trim().toLowerCase();
  const cached = _cache.get(key);
  if (cached) return cached;
  const promise = _resolve(raw, fetchFn, htmlFetchFn, parallelExtractFn);
  _cache.set(key, promise);
  return promise;
}

const globalFetch: FetchFn = (url) =>
  fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } }) as unknown as ReturnType<FetchFn>;

const HTML_FETCH_TIMEOUT_MS = 10000;

const globalHtmlFetch: HtmlFetchFn = async (url) => {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  // Reject non-HTML responses (PDFs, binaries) — parsing them as text
  // wastes time and never yields a DOI.  A server that ignores Accept
  // and returns application/pdf will be caught here.
  if (res.ok) {
    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(ct)) {
      return { ok: false, status: 415, text: async () => "" };
    }
  }
  return {
    ok: res.ok,
    status: res.status,
    text: () => res.text(),
  };
};

/**
 * Extract a DOI from rendered HTML content (meta tags, JSON-LD, body regex).
 * Priority order:
 *   1. <meta name="citation_doi" content="...">
 *   2. <meta name="dc.identifier" content="doi:...">
 *   3. JSON-LD (ScholarlyArticle/Article with identifier or doi field)
 *   4. Any DOI pattern in the full HTML body (fallback)
 *
 * Returns the first DOI found, or null. Pure function — no I/O.
 */
export function extractDoiFromHtml(html: string): string | null {
  // Priority 1: <meta name="citation_doi" content="10.xxxx/...">
  const citationDoiMatch = html.match(
    /<meta[^>]*?name=["']citation_doi["'][^>]*?content=["'](10\.\d{4,}\/[^"']+)["']/i,
  );
  if (citationDoiMatch) return citationDoiMatch[1];

  // Priority 2: <meta name="dc.identifier" content="doi:10.xxxx/...">
  const dcDoiMatch = html.match(
    /<meta[^>]*?name=["']dc\.identifier["'][^>]*?content=["'(]*(?:doi:\s*)?(10\.\d{4,}\/[^"')\]]+)/i,
  );
  if (dcDoiMatch) return dcDoiMatch[1];

  // Priority 3: JSON-LD in <script type="application/ld+json"> blocks
  const ldJsonBlocks = html.matchAll(
    /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const block of ldJsonBlocks) {
    try {
      const data = JSON.parse(block[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (!item["@type"] || !/Article|Scholarly/i.test(String(item["@type"]))) continue;

        // Check identifier (string value)
        if (typeof item.identifier === "string") {
          const doiFromId = item.identifier.match(/10\.\d{4,}\/[^\s"<>]+/);
          if (doiFromId) return doiFromId[0];
        }

        // Check identifier (PropertyValue object)
        if (
          item.identifier &&
          typeof item.identifier === "object" &&
          item.identifier["@type"] === "PropertyValue" &&
          /doi/i.test(String(item.identifier.propertyID ?? ""))
        ) {
          const doiVal = String(item.identifier.value ?? "");
          const doiMatch = doiVal.match(/10\.\d{4,}\/[^\s"<>]+/);
          if (doiMatch) return doiMatch[0];
        }

        // Check direct doi field
        if (item.doi) {
          const doiMatch = String(item.doi).match(/10\.\d{4,}\/[^\s"<>]+/);
          if (doiMatch) return doiMatch[0];
        }
      }
    } catch {
      // Malformed JSON-LD — skip this block and continue
    }
  }

  // Priority 4: Fallback — any DOI in the HTML body
  const fallbackDoi = html.match(/10\.\d{4,}\/[^\s"<>]+/);
  if (fallbackDoi) return fallbackDoi[0].replace(/[.,;)\]]+$/, "");

  return null;
}

/**
 * Fetch a URL's HTML and extract a DOI from page metadata.
 * Uses raw fetch() — no JS rendering.
 *
 * Returns null on any failure (network error, non-OK status, no DOI found).
 * Never throws.
 */
export async function extractDoiFromUrl(
  url: string,
  htmlFetch?: HtmlFetchFn,
): Promise<string | null> {
  const fetcher = htmlFetch ?? globalHtmlFetch;
  try {
    const res = await withTimeout(fetcher(url), HTML_FETCH_TIMEOUT_MS, "html fetch");
    if (!res.ok) return null;
    const html = await res.text();
    return extractDoiFromHtml(html);
  } catch (err) {
    logger.warn(
      `[CitationResolver] failed to fetch URL for DOI extraction "${url.slice(0, 80)}": ${(err as Error).message}`,
    );
    return null;
  }
}

const PARALLEL_EXTRACT_TIMEOUT_MS = 15000;

/**
 * Fallback: use Parallel AI /v1/extract to fetch rendered content for a URL
 * that may be behind a Cloudflare JS challenge or SPA-rendered (React/Next.js).
 * Searches the returned markdown content for a DOI pattern.
 *
 * When PARALLEL_AI_API_KEY is not set, getSearchTool().extractPages() silently
 * returns [] and we return null — graceful degradation.
 *
 * Returns null on any failure. Never throws.
 */
async function extractDoiFromUrlViaParallel(
  url: string,
  extractFn?: ParallelExtractFn,
): Promise<string | null> {
  try {
    let result: { title: string; content: string } | null;
    if (extractFn) {
      result = await withTimeout(extractFn(url), PARALLEL_EXTRACT_TIMEOUT_MS, "parallel extract");
    } else {
      const pages = await withTimeout(
        (async () => {
          const st = getSearchTool();
          const p = await st.extractPages([url], "Find the DOI of this academic paper", {
            maxCharsPerPage: 5000,
          });
          if (p.length === 0) return null;
          return { title: p[0].title, content: p[0].content };
        })(),
        PARALLEL_EXTRACT_TIMEOUT_MS,
        "parallel extract",
      );
      result = pages;
    }

    if (!result) return null;

    // Search title + content for a DOI pattern
    const searchText = result.title + "\n" + result.content;
    const doiMatch = searchText.match(/10\.\d{4,}\/[^\s"<>]+/);
    if (doiMatch) return doiMatch[0].replace(/[.,;)\]]+$/, "");

    return null;
  } catch (err) {
    logger.warn(
      `[CitationResolver] Parallel extract failed for "${url.slice(0, 80)}": ${(err as Error).message}`,
    );
    return null;
  }
}

async function _resolve(
  raw: string,
  fetchFn: FetchFn,
  htmlFetchFn?: HtmlFetchFn,
  parallelExtractFn?: ParallelExtractFn,
): Promise<CitationResolution> {
  try {
    // Step 1: Direct DOI from the raw string itself (existing).
    const doi = extractDoi(raw);
    if (doi) {
      return await _resolveByDoi(doi, raw, fetchFn);
    }

    // Step 2a: URL — raw fetch + HTML regex for DOI in meta/JSON-LD (existing).
    if (isUrl(raw)) {
      const pageDoi = await extractDoiFromUrl(raw, htmlFetchFn);
      if (pageDoi) {
        return await _resolveByDoi(pageDoi, raw, fetchFn, "page");
      }

      // Step 2b: URL — Parallel AI extract for Cloudflare/SPA-blocked pages (new).
      const parallelDoi = await extractDoiFromUrlViaParallel(raw, parallelExtractFn);
      if (parallelDoi) {
        return await _resolveByDoi(parallelDoi, raw, fetchFn, "page");
      }

    }

    // Step 3: Bibliographic title search fallback (existing).
    const url = `${CROSSREF_BASE}?query.bibliographic=${encodeURIComponent(raw)}&rows=3&mailto=${MAILTO}`;
    const res = await withTimeout(fetchFn(url));
    if (!res.ok) return { raw, status: "unverified", matchScore: 0, source: "none" };
    const body = (await res.json()) as { message?: { items?: CrossrefItem[] } };
    const items = body.message?.items ?? [];
    let best: CrossrefItem | null = null;
    let bestScore = 0;
    for (const item of items) {
      const score = titleSimilarity(raw, item.title?.[0] ?? "");
      if (score > bestScore) { bestScore = score; best = item; }
    }
    if (best && bestScore >= TITLE_MATCH_THRESHOLD) {
      return { raw, status: "verified", matchScore: bestScore, source: "crossref", ...itemMeta(best) };
    }
    return { raw, status: "unverified", matchScore: bestScore, source: "none" };
  } catch (err) {
    logger.warn(`[CitationResolver] lookup failed for "${raw.slice(0, 60)}": ${(err as Error).message}`);
    return { raw, status: "unverified", matchScore: 0, source: "none" };
  }
}

/** Test/maintenance helper: clear the in-process cache. */
export function _resetCitationCache(): void {
  _cache.clear();
}
