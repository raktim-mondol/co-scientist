import { logger } from "../config.js";

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

const CROSSREF_BASE = "https://api.crossref.org/works";
const TITLE_MATCH_THRESHOLD = 0.7;
const TIMEOUT_MS = 6000;
// Polite pool: identify ourselves via mailto (query param + User-Agent) for
// higher, more reliable rate limits. No API key needed — Plus is the only keyed tier.
const MAILTO = "dr.raktim.mondol@gmail.com";
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

async function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("crossref timeout")), TIMEOUT_MS)),
  ]);
}

/** Resolve one citation string to an existence verdict via Crossref. Never throws. */
export function resolveCitation(raw: string, fetchFn: FetchFn = globalFetch): Promise<CitationResolution> {
  const key = raw.trim().toLowerCase();
  const cached = _cache.get(key);
  if (cached) return cached;
  const promise = _resolve(raw, fetchFn);
  _cache.set(key, promise);
  return promise;
}

const globalFetch: FetchFn = (url) =>
  fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } }) as unknown as ReturnType<FetchFn>;

async function _resolve(raw: string, fetchFn: FetchFn): Promise<CitationResolution> {
  const doi = extractDoi(raw);
  try {
    if (doi) {
      const res = await withTimeout(fetchFn(`${CROSSREF_BASE}/${encodeURIComponent(doi)}?mailto=${MAILTO}`));
      if (res.status === 404) {
        return { raw, status: "fabricated", matchScore: 0, source: "crossref" };
      }
      if (res.ok) {
        const body = (await res.json()) as { message?: CrossrefItem };
        const meta = itemMeta(body.message ?? {});
        return { raw, status: "verified", matchScore: 1, source: "crossref", ...meta };
      }
      // Other non-OK (rate limit, 5xx) — can't confirm; treat as unverified.
      return { raw, status: "unverified", matchScore: 0, source: "none" };
    }

    // No DOI: bibliographic title search.
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
