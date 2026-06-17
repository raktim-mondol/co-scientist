/**
 * RLEF Task 3 — Reward Signal Extraction
 *
 * extractRewardFromFeedback: derives a reward in [-1, +1] from free-text
 *   sentiment + structured N/C/T scores using the plan formula:
 *     sentiment  = analyzeSentiment(feedbackText)          // -1 to +1
 *     scoreAvg   = (N + C + T) / 30 - 1                   // normalize to [-1, +1]
 *     reward     = 0.4 * sentiment + 0.6 * scoreAvg
 *   When scores are absent the weight shifts entirely to sentiment.
 *
 * applyFeedbackAsGlicko2Match: applies the reward to a hypothesis via a
 *   Glicko-2 match against a virtual opponent at 1200, updating rating, RD,
 *   and volatility (replaces the old Elo-only applyRewardToElo).
 */

// ─── Sentiment lexicon ────────────────────────────────────────────────────────
const POSITIVE_TERMS = [
  "confirm", "confirmed", "confirms", "validate", "validated", "validates",
  "support", "supports", "supported", "replicate", "replicated", "replicates",
  "success", "successful", "effective", "efficacious", "significant",
  "improve", "improved", "improvement", "increase", "increased",
  "reduce", "reduced", "reduction", "inhibit", "inhibited", "inhibition",
  "positive", "promising", "excellent", "strong", "robust", "consistent",
  "works", "worked", "correct", "accurate", "novel", "breakthrough",
];

const NEGATIVE_TERMS = [
  "refute", "refuted", "refutes", "reject", "rejected", "rejects",
  "fail", "failed", "fails", "failure", "ineffective", "inefficacious",
  "contradict", "contradicts", "contradicted", "disprove", "disproved",
  "negative", "poor", "weak", "inconsistent", "unreliable", "incorrect",
  "no effect", "no significant", "not significant", "not effective",
  "does not", "did not", "cannot", "could not", "unable",
  "toxic", "harmful", "dangerous", "unsafe",
];

/** Returns a sentiment score in [-1, +1] based on keyword counting.
 * Uses word-boundary matching to avoid substring collisions (e.g. "inconsistent"
 * would otherwise also match the positive term "consistent"). */
function analyzeSentiment(text: string): number {
  const lower = text.toLowerCase();
  // Split on non-word characters to get discrete tokens for exact matching
  const words = new Set(lower.split(/\W+/));
  let pos = 0;
  let neg = 0;
  for (const t of POSITIVE_TERMS) {
    if (t.includes(" ") ? lower.includes(t) : words.has(t)) pos++;
  }
  for (const t of NEGATIVE_TERMS) {
    if (t.includes(" ") ? lower.includes(t) : words.has(t)) neg++;
  }
  const total = pos + neg;
  if (total === 0) return 0;
  return Math.max(-1, Math.min(1, (pos - neg) / total));
}

/**
 * Derive a reward signal in [-1, +1] from feedback text and optional N/C/T scores.
 *
 * When all three scores are provided:
 *   reward = 0.4 * sentiment + 0.6 * scoreAvg
 * When scores are absent, weight shifts entirely to sentiment:
 *   reward = sentiment
 */
export function extractRewardFromFeedback(
  feedbackText: string,
  novelty?: number,
  correctness?: number,
  testability?: number,
): number {
  const sentiment = analyzeSentiment(feedbackText);

  const hasScores =
    novelty !== undefined && correctness !== undefined && testability !== undefined;

  if (!hasScores) return sentiment;

  // Normalize three 0-10 scores to [-1, +1]: (sum / 30) - 1
  const scoreAvg = (novelty! + correctness! + testability!) / 30 - 1;
  const reward = 0.4 * sentiment + 0.6 * scoreAvg;
  return Math.max(-1, Math.min(1, reward));
}

// ─── Glicko-2 Feedback Integration ───────────────────────────────────────────

import { computeGlicko2Update, type Glicko2State, type MatchResult } from "../models/tournament.js";

/** Virtual opponent representing the empirical baseline. Low RD = high confidence
 *  in the baseline, which causes more RD reduction for the hypothesis. */
const VIRTUAL_OPPONENT: Glicko2State = {
  rating: 1200,
  rd: 50,
  volatility: 0.06,
  matchesPlayed: 0,
  wins: 0,
  losses: 0,
  draws: 0,
};

/** Reward threshold for mapping to win/loss. Values in [-0.33, 0.33] → draw. */
const REWARD_WIN_THRESHOLD = 0.33;

/**
 * Apply RLEF feedback as a proper Glicko-2 match against a virtual opponent.
 *
 * This ensures RD, volatility, and matchesPlayed all update correctly,
 * making RLEF-boosted ratings comparable to tournament debate ratings.
 *
 * Reward mapping:
 *   reward >  0.33 → hypothesis wins  (positive empirical evidence)
 *   reward < -0.33 → hypothesis loses (negative empirical evidence)
 *   otherwise      → draw             (neutral/mixed evidence)
 */
export function applyFeedbackAsGlicko2Match(
  player: Glicko2State,
  reward: number,
): Glicko2State {
  const matchResult: MatchResult =
    reward > REWARD_WIN_THRESHOLD ? "A_wins" :
    reward < -REWARD_WIN_THRESHOLD ? "B_wins" :
    "draw";

  const { newA } = computeGlicko2Update(player, VIRTUAL_OPPONENT, matchResult);
  return newA;
}
