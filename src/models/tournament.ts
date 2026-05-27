import { z } from "zod";

export const MatchResultSchema = z.enum(["A_wins", "B_wins", "draw"]);
export type MatchResult = z.infer<typeof MatchResultSchema>;

export const MatchTypeSchema = z.enum([
  "debate",       // Multi-turn scientific debate (top-ranked hypotheses)
  "simple",       // Single-turn comparison (lower-ranked)
]);

export const TournamentMatchSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  hypothesisAId: z.string().uuid(),
  hypothesisBId: z.string().uuid(),
  matchType: MatchTypeSchema,
  result: MatchResultSchema,
  winnerEloAfter: z.number(),
  loserEloAfter: z.number(),
  debateTranscript: z.string().nullable(), // Full debate text
  rationale: z.string(),                  // Why winner won
  round: z.number().int(),
  createdAt: z.date(),
});

export type TournamentMatch = z.infer<typeof TournamentMatchSchema>;

// ─── Legacy Elo State (kept for backward compat) ──────────────────────────────
export const EloStateSchema = z.object({
  hypothesisId: z.string().uuid(),
  rating: z.number().default(1200),
  matchesPlayed: z.number().int().default(0),
  wins: z.number().int().default(0),
  losses: z.number().int().default(0),
  draws: z.number().int().default(0),
});

export type EloState = z.infer<typeof EloStateSchema>;

// ─── Glicko-2 State ───────────────────────────────────────────────────────────

/**
 * Glicko-2 rating state for a hypothesis.
 *
 * - `rating`    : public rating on the Elo-compatible scale (default 1200)
 * - `rd`        : Rating Deviation — uncertainty in the rating (default 350 = "never played")
 * - `volatility`: expected degree of rating fluctuation (default 0.06 per Glickman)
 */
export const Glicko2StateSchema = z.object({
  rating:      z.number().default(1200),
  rd:          z.number().default(350),
  volatility:  z.number().default(0.06),
  matchesPlayed: z.number().int().default(0),
  wins:        z.number().int().default(0),
  losses:      z.number().int().default(0),
  draws:       z.number().int().default(0),
});

export type Glicko2State = z.infer<typeof Glicko2StateSchema>;

// ─── Glicko-2 Constants ───────────────────────────────────────────────────────

/** Scale factor converting between public and internal Glicko-2 scales. */
const GLICKO2_SCALE = 173.7178;

/** System constant τ — constrains volatility changes. Lower = more stable.
 *  Glickman recommends 0.3–1.2; we use 0.5 as a good default for fast-moving systems. */
const TAU = 0.5;

/** Default starting values for a hypothesis that has never played. */
export const GLICKO2_DEFAULTS = {
  rating:     1200,
  rd:         350,
  volatility: 0.06,
} as const;

/**
 * Default RD for a hypothesis that has been through Reflection review.
 * Lower than 350 (unplayed) because the review gives us some prior information.
 */
export const GLICKO2_REVIEWED_RD = 200;

// ─── Glicko-2 Internal Helpers ────────────────────────────────────────────────

/** Convert public rating to internal μ scale. */
function toMu(rating: number): number {
  return (rating - 1500) / GLICKO2_SCALE;
}

/** Convert public RD to internal φ scale. */
function toPhi(rd: number): number {
  return rd / GLICKO2_SCALE;
}

/** Convert internal μ back to public rating scale. */
function fromMu(mu: number): number {
  return mu * GLICKO2_SCALE + 1500;
}

/** Convert internal φ back to public RD scale. */
function fromPhi(phi: number): number {
  return phi * GLICKO2_SCALE;
}

/** Glicko-2 g function — reduces impact of matches against uncertain opponents. */
function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/** Glicko-2 E function — expected score. */
function E(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

/**
 * Solve for new volatility σ′ using the Illinois algorithm
 * (Glickman 2012, step 5).
 */
function computeNewVolatility(
  phi: number,
  sigma: number,
  delta: number,
  v: number
): number {
  const a = Math.log(sigma * sigma);
  const eps = 1e-6;

  function f(x: number): number {
    const ex = Math.exp(x);
    const phiSqPlusVPlusEx = phi * phi + v + ex;
    const num = ex * (delta * delta - phiSqPlusVPlusEx);
    const den = 2 * phiSqPlusVPlusEx * phiSqPlusVPlusEx;
    return num / den - (x - a) / (TAU * TAU);
  }

  // Initialise bracket
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);

  // Illinois algorithm
  for (let i = 0; i < 1000 && Math.abs(B - A) > eps; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }

  return Math.exp(A / 2);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute Glicko-2 rating update for a single match between A and B.
 *
 * Implements Mark Glickman's Glicko-2 algorithm (2012 revision), steps 1–7.
 * Each call constitutes a one-match "rating period" for both players.
 *
 * @returns New Glicko2State for both A and B.
 */
export function computeGlicko2Update(
  playerA: Glicko2State,
  playerB: Glicko2State,
  result: MatchResult
): { newA: Glicko2State; newB: Glicko2State } {
  const scoreA = result === "A_wins" ? 1 : result === "B_wins" ? 0 : 0.5;
  const scoreB = 1 - scoreA;

  function updatePlayer(
    player: Glicko2State,
    opponent: Glicko2State,
    score: number
  ): Glicko2State {
    // Step 2: Convert to internal scale
    const mu   = toMu(player.rating);
    const phi  = toPhi(player.rd);
    const muJ  = toMu(opponent.rating);
    const phiJ = toPhi(opponent.rd);

    // Step 3: Compute v — estimated variance of the player's rating based on game outcomes
    const gPhiJ = g(phiJ);
    const eVal  = E(mu, muJ, phiJ);
    const v = 1 / (gPhiJ * gPhiJ * eVal * (1 - eVal));

    // Step 4: Compute delta — estimated improvement
    const delta = v * gPhiJ * (score - eVal);

    // Step 5: Compute new volatility σ′
    const newSigma = computeNewVolatility(phi, player.volatility, delta, v);

    // Step 6: Update RD to account for elapsed time (φ* = √(φ² + σ′²))
    const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);

    // Step 7: Compute new φ′ and μ′
    const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
    const newMu  = mu + newPhi * newPhi * gPhiJ * (score - eVal);

    // Convert back to public scale
    const newRating = Math.round(fromMu(newMu));
    const newRd     = Math.min(350, Math.round(fromPhi(newPhi))); // cap at 350

    const won  = score === 1;
    const drew = score === 0.5;

    return {
      rating:       newRating,
      rd:           newRd,
      volatility:   Math.round(newSigma * 1e6) / 1e6, // keep 6 decimal places
      matchesPlayed: player.matchesPlayed + 1,
      wins:   player.wins   + (won  ? 1 : 0),
      losses: player.losses + (!won && !drew ? 1 : 0),
      draws:  player.draws  + (drew ? 1 : 0),
    };
  }

  return {
    newA: updatePlayer(playerA, playerB, scoreA),
    newB: updatePlayer(playerB, playerA, scoreB),
  };
}

/**
 * Seed a Glicko-2 starting state from Reflection review scores.
 *
 * Rating formula (same as legacy Elo seed):
 *   rating = 1000 + (avgScore / 10) * 400
 *   - avg 5/10 → 1200 (neutral baseline)
 *   - avg 8/10 → 1320 (head-start)
 *   - avg 3/10 → 1120 (below average)
 *
 * RD is set to GLICKO2_REVIEWED_RD (200) because the review gives prior
 * information — less uncertain than a completely unreviewed hypothesis (350).
 */
export function seededGlicko2FromReviewScores(
  novelty?: number,
  correctness?: number,
  testability?: number
): Pick<Glicko2State, "rating" | "rd" | "volatility"> {
  const scores = [novelty, correctness, testability].filter(
    (s): s is number => s !== undefined && s !== null
  );
  const rating =
    scores.length === 0
      ? GLICKO2_DEFAULTS.rating
      : Math.round(1000 + (scores.reduce((a, b) => a + b, 0) / scores.length / 10) * 400);

  return {
    rating,
    rd:         scores.length > 0 ? GLICKO2_REVIEWED_RD : GLICKO2_DEFAULTS.rd,
    volatility: GLICKO2_DEFAULTS.volatility,
  };
}

/**
 * @deprecated Use computeGlicko2Update instead.
 * Compute Elo update — retained for backward compatibility with existing tests.
 */
export function computeEloUpdate(
  ratingA: number,
  ratingB: number,
  result: MatchResult,
  kFactor = 32
): { newRatingA: number; newRatingB: number } {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;

  const scoreA =
    result === "A_wins" ? 1 : result === "B_wins" ? 0 : 0.5;
  const scoreB = 1 - scoreA;

  return {
    newRatingA: Math.round(ratingA + kFactor * (scoreA - expectedA)),
    newRatingB: Math.round(ratingB + kFactor * (scoreB - expectedB)),
  };
}

/**
 * @deprecated Use seededGlicko2FromReviewScores instead.
 */
export function seededEloFromReviewScores(
  novelty?: number,
  correctness?: number,
  testability?: number
): number {
  return seededGlicko2FromReviewScores(novelty, correctness, testability).rating;
}

/** Canonical Glicko-2 name for seeding a rating from review scores. */
export const seededGlicko2Rating = seededGlicko2FromReviewScores;
