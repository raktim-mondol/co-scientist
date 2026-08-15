// Global numbered bibliography builder for the publishable report.
//
// Collects every raw citation across the included hypotheses, normalizes and
// dedupes them via the existing CrossRef resolver (src/tools/citationResolver.ts),
// assigns stable [n] numbers in first-seen order, and returns a map from each raw
// citation to its number so the Results section can be rewritten with inline
// [n] markers. The resolver is injectable so tests run without network access.

import {
  resolveCitation,
  extractDoi,
  type CitationResolution,
} from "../tools/citationResolver.js";
import type { BibEntry } from "../models/manuscript.js";

export type ResolverFn = (raw: string) => Promise<CitationResolution>;

export interface BuiltBibliography {
  references: BibEntry[];
  /** trimmed raw citation -> [n] */
  markerByRaw: Map<string, number>;
}

/** Normalize a title into a dedupe key: lowercase, alphanumerics only. */
function normTitleKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Build a de-duplicated, numbered bibliography from per-hypothesis citation lists.
 *
 * Dedupe rule: two citations collapse to one reference when they share a DOI, or
 * (absent a DOI) when their canonical/normalized titles match. Numbering is
 * assigned in the order citations are first encountered across hypotheses, so the
 * output is deterministic for a given input.
 */
export async function buildBibliography(
  citationsByHypothesis: string[][],
  resolver: ResolverFn = (raw) => resolveCitation(raw),
): Promise<BuiltBibliography> {
  // Resolve each unique raw citation once.
  const rawToRaw = new Map<string, string>(); // trimmed -> original
  for (const list of citationsByHypothesis) {
    for (const c of list) {
      const t = c.trim();
      if (t && !rawToRaw.has(t)) rawToRaw.set(t, c);
    }
  }

  const resolutions = new Map<string, CitationResolution>();
  for (const [t, raw] of rawToRaw) {
    try {
      resolutions.set(t, await resolver(raw));
    } catch {
      resolutions.set(t, { raw, status: "unverified", matchScore: 0, source: "none" });
    }
  }

  // Assign dedupe keys and numbers in first-seen order.
  const byKey = new Map<string, BibEntry>();
  const keyOrder: string[] = [];
  const keyForRaw = new Map<string, string>();

  for (const list of citationsByHypothesis) {
    for (const c of list) {
      const t = c.trim();
      if (!t || keyForRaw.has(t)) continue;
      const res = resolutions.get(t)!;
      const doi = res.doi ?? extractDoi(t) ?? undefined;
      const key = doi
        ? `doi:${doi.toLowerCase()}`
        : `title:${normTitleKey(res.canonicalTitle ?? t)}`;
      keyForRaw.set(t, key);
      if (!byKey.has(key)) {
        keyOrder.push(key);
        byKey.set(key, {
          n: 0, // assigned below
          raw: c,
          canonicalTitle: res.canonicalTitle,
          doi,
          authors: res.authors,
          year: res.year,
          status: res.status,
        });
      }
    }
  }

  const references: BibEntry[] = [];
  keyOrder.forEach((key, i) => {
    const entry = byKey.get(key)!;
    entry.n = i + 1;
    references.push(entry);
  });

  const markerByRaw = new Map<string, number>();
  for (const [t, key] of keyForRaw) {
    markerByRaw.set(t, byKey.get(key)!.n);
  }

  return { references, markerByRaw };
}

/** Map a hypothesis's raw citations to ascending, de-duplicated [n] markers. */
export function markersFor(
  citations: string[],
  markerByRaw: Map<string, number>,
): number[] {
  const nums = new Set<number>();
  for (const c of citations) {
    const n = markerByRaw.get(c.trim());
    if (n) nums.add(n);
  }
  return [...nums].sort((a, b) => a - b);
}
