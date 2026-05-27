import { describe, it, expect } from "bun:test";
import { computeEloUpdate, computeGlicko2Update, seededGlicko2FromReviewScores, type Glicko2State } from "../models/tournament.js";
import { TaskScheduler } from "../taskQueue/queue.js";
import { z } from "zod";
import {
  HypothesisSchema,
  HypothesisStatusSchema,
  ReviewTypeSchema,
} from "../models/hypothesis.js";
import { SessionStatusSchema, SessionStatsSchema } from "../models/session.js";
import { ResearchGoalSchema, ResearchConstraintsSchema } from "../models/researchGoal.js";

// ─── Elo Tournament Logic ─────────────────────────────────────────────────────

describe("computeEloUpdate", () => {
  it("A wins: A gains, B loses", () => {
    const { newRatingA, newRatingB } = computeEloUpdate(1200, 1200, "A_wins", 32);
    expect(newRatingA).toBeGreaterThan(1200);
    expect(newRatingB).toBeLessThan(1200);
  });

  it("B wins: B gains, A loses", () => {
    const { newRatingA, newRatingB } = computeEloUpdate(1200, 1200, "B_wins", 32);
    expect(newRatingA).toBeLessThan(1200);
    expect(newRatingB).toBeGreaterThan(1200);
  });

  it("draw: equal-rated players stay at 1200", () => {
    const { newRatingA, newRatingB } = computeEloUpdate(1200, 1200, "draw", 32);
    expect(newRatingA).toBe(1200);
    expect(newRatingB).toBe(1200);
  });

  it("upset win gives larger rating change", () => {
    // Low-rated beats high-rated
    const { newRatingA, newRatingB } = computeEloUpdate(1000, 1400, "A_wins", 32);
    const gain = newRatingA - 1000;
    // Expected score for A is low, so gain should be large
    expect(gain).toBeGreaterThan(20);
    expect(newRatingB).toBeLessThan(1400);
  });

  it("expected win gives smaller rating change", () => {
    // High-rated beats low-rated
    const { newRatingA } = computeEloUpdate(1400, 1000, "A_wins", 32);
    const gain = newRatingA - 1400;
    expect(gain).toBeLessThan(12);
  });

  it("respects K-factor", () => {
    const k16 = computeEloUpdate(1200, 1200, "A_wins", 16);
    const k32 = computeEloUpdate(1200, 1200, "A_wins", 32);
    expect(k32.newRatingA - 1200).toBe(2 * (k16.newRatingA - 1200));
  });

  it("total rating is conserved", () => {
    const { newRatingA, newRatingB } = computeEloUpdate(1300, 1100, "A_wins", 32);
    // Due to rounding, allow ±1
    expect(Math.abs(newRatingA + newRatingB - 2400)).toBeLessThanOrEqual(1);
  });
});

// ─── Glicko-2 Tournament Logic ────────────────────────────────────────────────

/** Helper: create a default Glicko-2 state with optional overrides. */
function makeState(overrides: Partial<Glicko2State> = {}): Glicko2State {
  return {
    rating: 1200,
    rd: 350,
    volatility: 0.06,
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    ...overrides,
  };
}

describe("computeGlicko2Update", () => {
  it("A wins: A gains rating, B loses rating", () => {
    const { newA, newB } = computeGlicko2Update(makeState(), makeState(), "A_wins");
    expect(newA.rating).toBeGreaterThan(1200);
    expect(newB.rating).toBeLessThan(1200);
  });

  it("B wins: B gains rating, A loses rating", () => {
    const { newA, newB } = computeGlicko2Update(makeState(), makeState(), "B_wins");
    expect(newA.rating).toBeLessThan(1200);
    expect(newB.rating).toBeGreaterThan(1200);
  });

  it("draw at equal ratings: ratings stay near 1200", () => {
    const { newA, newB } = computeGlicko2Update(makeState(), makeState(), "draw");
    // Equal-rated draw → symmetric; ratings should stay very close to 1200
    expect(Math.abs(newA.rating - 1200)).toBeLessThan(5);
    expect(Math.abs(newB.rating - 1200)).toBeLessThan(5);
  });

  it("RD decreases after a match for both players", () => {
    const { newA, newB } = computeGlicko2Update(makeState(), makeState(), "A_wins");
    expect(newA.rd).toBeLessThan(350);
    expect(newB.rd).toBeLessThan(350);
  });

  it("win/loss counters are updated correctly", () => {
    const { newA, newB } = computeGlicko2Update(makeState(), makeState(), "A_wins");
    expect(newA.wins).toBe(1);
    expect(newA.losses).toBe(0);
    expect(newB.wins).toBe(0);
    expect(newB.losses).toBe(1);
    expect(newA.matchesPlayed).toBe(1);
    expect(newB.matchesPlayed).toBe(1);
  });

  it("draws increment draw counter for both", () => {
    const { newA, newB } = computeGlicko2Update(makeState(), makeState(), "draw");
    expect(newA.draws).toBe(1);
    expect(newB.draws).toBe(1);
  });

  it("high-RD player sees larger rating swing than low-RD player", () => {
    const highRd = makeState({ rd: 350 });
    const lowRd  = makeState({ rd: 50 });
    const opponent = makeState();

    const { newA: afterHighRd } = computeGlicko2Update(highRd,  opponent, "A_wins");
    const { newA: afterLowRd  } = computeGlicko2Update(lowRd,   opponent, "A_wins");

    const gainHighRd = afterHighRd.rating - 1200;
    const gainLowRd  = afterLowRd.rating  - 1200;
    expect(gainHighRd).toBeGreaterThan(gainLowRd);
  });

  it("upset win (low beats high) gives larger gain than expected win", () => {
    const lowRated  = makeState({ rating: 1000 });
    const highRated = makeState({ rating: 1400 });

    const { newA: upset }   = computeGlicko2Update(lowRated,  highRated, "A_wins");
    const { newA: expected } = computeGlicko2Update(highRated, lowRated,  "A_wins");

    // Underdog gains more from upset than favourite gains from expected win
    expect(upset.rating - 1000).toBeGreaterThan(expected.rating - 1400);
  });

  it("RD is capped at 350 (never exceeds starting value)", () => {
    const { newA, newB } = computeGlicko2Update(makeState(), makeState(), "A_wins");
    expect(newA.rd).toBeLessThanOrEqual(350);
    expect(newB.rd).toBeLessThanOrEqual(350);
  });

  it("volatility stays within a sane range after a match", () => {
    const { newA, newB } = computeGlicko2Update(makeState(), makeState(), "A_wins");
    expect(newA.volatility).toBeGreaterThan(0);
    expect(newA.volatility).toBeLessThan(1);
    expect(newB.volatility).toBeGreaterThan(0);
    expect(newB.volatility).toBeLessThan(1);
  });

  it("well-established (low-RD) player RD does not increase from expected result", () => {
    // High-rated player with low RD beats low-rated — expected outcome
    const established = makeState({ rating: 1400, rd: 50 });
    const weak        = makeState({ rating: 1000, rd: 50 });
    const { newA } = computeGlicko2Update(established, weak, "A_wins");
    // RD should not spike
    expect(newA.rd).toBeLessThanOrEqual(60);
  });
});

// ─── seededGlicko2FromReviewScores ───────────────────────────────────────────

describe("seededGlicko2FromReviewScores", () => {
  it("no scores → default 1200 rating and RD 350", () => {
    const s = seededGlicko2FromReviewScores();
    expect(s.rating).toBe(1200);
    expect(s.rd).toBe(350);
  });

  it("average score 5/10 → rating 1200", () => {
    const s = seededGlicko2FromReviewScores(5, 5, 5);
    expect(s.rating).toBe(1200);
  });

  it("high scores (8/10) give a rating above 1200", () => {
    const s = seededGlicko2FromReviewScores(8, 8, 8);
    expect(s.rating).toBeGreaterThan(1200);
  });

  it("low scores (3/10) give a rating below 1200", () => {
    const s = seededGlicko2FromReviewScores(3, 3, 3);
    expect(s.rating).toBeLessThan(1200);
  });

  it("providing scores reduces RD to 200 (reviewed state)", () => {
    const s = seededGlicko2FromReviewScores(7, 6, 8);
    expect(s.rd).toBe(200);
  });

  it("volatility is always the default 0.06", () => {
    const s = seededGlicko2FromReviewScores(5, 5, 5);
    expect(s.volatility).toBe(0.06);
  });
});

// ─── Task Scheduler ───────────────────────────────────────────────────────────

describe("TaskScheduler", () => {
  const scheduler = new TaskScheduler();

  describe("computeWeights", () => {
    it("bootstrap phase: generation dominates", () => {
      const weights = scheduler.computeWeights({
        totalHypotheses: 1,
        activeHypotheses: 1,
        pendingReview: 0,
        totalMatches: 0,
        currentRound: 0,
        tokensUsed: 0,
        budgetTokens: 50000,
        maxHypotheses: 5,
      });
      expect(weights.generation).toBeGreaterThan(0.5);
    });

    it("review backlog: reflection dominates", () => {
      const weights = scheduler.computeWeights({
        totalHypotheses: 4,
        activeHypotheses: 3,
        pendingReview: 2, // > 50% of active
        totalMatches: 1,
        currentRound: 1,
        tokensUsed: 5000,
        budgetTokens: 50000,
        maxHypotheses: 5,
      });
      expect(weights.reflection).toBeGreaterThan(0.4);
    });

    it("mid-run: balanced weights", () => {
      const weights = scheduler.computeWeights({
        totalHypotheses: 3,
        activeHypotheses: 3,
        pendingReview: 0,
        totalMatches: 2,
        currentRound: 1,
        tokensUsed: 10000,
        budgetTokens: 50000,
        maxHypotheses: 5,
      });
      expect(weights.generation).toBeGreaterThan(0.2);
      expect(weights.ranking).toBeGreaterThan(0.2);
    });

    it("late-run: evolution and ranking dominate", () => {
      const weights = scheduler.computeWeights({
        totalHypotheses: 5,
        activeHypotheses: 4,
        pendingReview: 0,
        totalMatches: 6,
        currentRound: 3,
        tokensUsed: 30000,
        budgetTokens: 50000,
        maxHypotheses: 5,
      });
      expect(weights.evolution + weights.ranking).toBeGreaterThan(0.5);
    });

    it("weights sum to 1.0", () => {
      const weights = scheduler.computeWeights({
        totalHypotheses: 3,
        activeHypotheses: 3,
        pendingReview: 0,
        totalMatches: 2,
        currentRound: 1,
        tokensUsed: 5000,
        budgetTokens: 50000,
        maxHypotheses: 5,
      });
      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 5);
    });
  });

  describe("shouldTerminate", () => {
    it("terminates when token budget exhausted", () => {
      const result = scheduler.shouldTerminate(
        {
          totalHypotheses: 4,
          activeHypotheses: 3,
          pendingReview: 0,
          totalMatches: 5,
          currentRound: 3,
          tokensUsed: 50000,
          budgetTokens: 50000,
          maxHypotheses: 5,
        },
        []
      );
      expect(result).toBe(true);
    });

    it("does not terminate with unlimited budget (0)", () => {
      const result = scheduler.shouldTerminate(
        {
          totalHypotheses: 4,
          activeHypotheses: 3,
          pendingReview: 0,
          totalMatches: 5,
          currentRound: 3,
          tokensUsed: 99999,
          budgetTokens: 0,
          maxHypotheses: 5,
        },
        []
      );
      expect(result).toBe(false);
    });

    it("terminates on Elo plateau", () => {
      // 20 rounds with < 5 change
      const eloHistory = Array(20).fill(1350);
      const result = scheduler.shouldTerminate(
        {
          totalHypotheses: 40,
          activeHypotheses: 30,
          pendingReview: 0,
          totalMatches: 50,
          currentRound: 40,
          tokensUsed: 200000,
          budgetTokens: 500000,
          maxHypotheses: 50,
        },
        eloHistory
      );
      expect(result).toBe(true);
    });

    it("does not terminate if Elo still changing", () => {
      const eloHistory = Array.from({ length: 20 }, (_, i) => 1200 + i * 5);
      const result = scheduler.shouldTerminate(
        {
          totalHypotheses: 40,
          activeHypotheses: 30,
          pendingReview: 0,
          totalMatches: 50,
          currentRound: 40,
          tokensUsed: 200000,
          budgetTokens: 500000,
          maxHypotheses: 50,
        },
        eloHistory
      );
      expect(result).toBe(false);
    });
  });

  describe("sampleNextTaskType", () => {
    it("returns a valid task type", () => {
      const weights = scheduler.computeWeights({
        totalHypotheses: 10,
        activeHypotheses: 8,
        pendingReview: 1,
        totalMatches: 10,
        currentRound: 5,
        tokensUsed: 50000,
        budgetTokens: 500000,
        maxHypotheses: 50,
      });
      const taskType = scheduler.sampleNextTaskType(weights);
      expect([
        "generation",
        "reflection",
        "ranking",
        "evolution",
        "proximity",
        "meta_review",
      ]).toContain(taskType);
    });
  });
});

// ─── Zod Model Validation ─────────────────────────────────────────────────────

describe("Model Schemas", () => {
  describe("HypothesisSchema", () => {
    it("validates a complete hypothesis", () => {
      const result = HypothesisSchema.safeParse({
        id: "550e8400-e29b-41d4-a716-446655440000",
        sessionId: "550e8400-e29b-41d4-a716-446655440001",
        title: "Novel RNA methylation in ALS",
        summary: "m6A modifications on TDP-43 mRNA may drive aggregation.",
        content: "Full hypothesis text here...",
        rationale: "TDP-43 aggregation is a hallmark of ALS...",
        generationStrategy: "literature_exploration",
        eloRating: 1200,
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        status: "pending_review",
        parentIds: [],
        generationRound: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      expect(result.success).toBe(true);
    });

    it("rejects hypothesis without required fields", () => {
      const result = HypothesisSchema.safeParse({ title: "incomplete" });
      expect(result.success).toBe(false);
    });
  });

  describe("HypothesisStatusSchema", () => {
    it("accepts valid statuses", () => {
      for (const s of ["pending_review", "reviewing", "reviewed", "rejected", "active", "evolved"]) {
        expect(HypothesisStatusSchema.safeParse(s).success).toBe(true);
      }
    });

    it("rejects invalid status", () => {
      expect(HypothesisStatusSchema.safeParse("unknown").success).toBe(false);
    });
  });

  describe("ReviewTypeSchema", () => {
    it("accepts all review types", () => {
      for (const t of ["initial", "full", "deep_verification", "observation", "simulation", "tournament", "expert"]) {
        expect(ReviewTypeSchema.safeParse(t).success).toBe(true);
      }
    });
  });

  describe("SessionStatsSchema", () => {
    it("provides defaults for empty object", () => {
      const result = SessionStatsSchema.parse({});
      expect(result.totalHypotheses).toBe(0);
      expect(result.topEloRating).toBe(1200);
      expect(result.eloPlateau).toBe(false);
    });
  });

  describe("ResearchGoalSchema", () => {
    it("validates a research goal", () => {
      const result = ResearchGoalSchema.safeParse({
        id: "550e8400-e29b-41d4-a716-446655440002",
        rawGoal: "What are novel epigenetic mechanisms underlying ALS pathogenesis?",
        createdAt: new Date(),
      });
      expect(result.success).toBe(true);
    });

    it("rejects goal shorter than 10 chars", () => {
      const result = ResearchGoalSchema.safeParse({
        id: "550e8400-e29b-41d4-a716-446655440002",
        rawGoal: "short",
        createdAt: new Date(),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ResearchConstraintsSchema", () => {
    it("provides sensible defaults", () => {
      const result = ResearchConstraintsSchema.parse({});
      expect(result.noveltyRequired).toBe(true);
      expect(result.allowedMethodologies).toEqual([]);
    });
  });
});
