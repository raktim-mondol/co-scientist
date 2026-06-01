/**
 * Helpers for debiasing the LLM-as-judge in the ranking tournament.
 *
 * LLM judges exhibit *position bias* — a systematic preference for whichever
 * candidate is presented first. In this system that bias is compounded because
 * the matchup selector always places the higher-priority (higher-RD) hypothesis
 * in slot "A". These pure helpers let `RankingAgent` judge a pair in both
 * orderings and reconcile the verdicts.
 */

export type Verdict = "A" | "B" | "draw";

/**
 * Translate a verdict expressed in the *presented* layout back to real A/B terms.
 *
 * When `swapped` is true the real hypothesis B was shown in slot A (and vice
 * versa), so a presented "A" win actually means real B won. A draw is
 * orientation-independent.
 */
export function mapPresentedVerdict(presented: Verdict, swapped: boolean): Verdict {
  if (!swapped || presented === "draw") return presented;
  return presented === "A" ? "B" : "A";
}

/**
 * Combine two real-terms verdicts from opposite presentation orders.
 *
 * - Agree on a winner            → that winner (order-robust)
 * - One decisive, the other draw → the decisive winner
 * - Contradict (A vs B)          → draw (verdict was position-dependent)
 * - Both draw                    → draw
 */
export function combineSwappedVerdicts(normal: Verdict, swapped: Verdict): Verdict {
  const hasA = normal === "A" || swapped === "A";
  const hasB = normal === "B" || swapped === "B";
  if (hasA && hasB) return "draw"; // contradictory → position bias detected
  if (hasA) return "A";
  if (hasB) return "B";
  return "draw";
}
