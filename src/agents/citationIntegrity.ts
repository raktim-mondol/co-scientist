import { BaseAgent } from "./base.js";
import type { Hypothesis } from "../models/hypothesis.js";
import { resolveCitation, type FetchFn } from "../tools/citationResolver.js";

/** Maximum rating points subtracted at a 100% (weighted) fabrication rate. */
export const MAX_PENALTY = 150;
/** Maximum RD points added at a 100% (weighted) fabrication rate. */
export const MAX_RD_WIDEN = 100;

/**
 * Pure soft-penalty mapping from citation-integrity counts to a Glicko-2 delta.
 *
 * Weighted fabrication rate f = (fabricated + 0.5 * unverified) / total.
 * `total === 0` ⇒ f = 0 (nothing to fabricate ⇒ no penalty).
 */
export function citationPenalty(counts: {
  total: number;
  unverified: number;
  fabricated: number;
}): { f: number; ratingDelta: number; rdDelta: number } {
  if (counts.total <= 0) return { f: 0, ratingDelta: 0, rdDelta: 0 };
  const f = (counts.fabricated + 0.5 * counts.unverified) / counts.total;
  return {
    f,
    ratingDelta: f > 0 ? -Math.round(f * MAX_PENALTY) : 0,
    rdDelta: Math.round(f * MAX_RD_WIDEN),
  };
}
