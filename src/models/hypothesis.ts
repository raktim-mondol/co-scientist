import { z } from "zod";

export const HypothesisStatusSchema = z.enum([
  "pending_review",
  "reviewing",
  "reviewed",
  "rejected",
  "active",        // passed initial review, in tournament
  "evolved",       // spawned from evolution
  "quarantined",   // withheld by the safety gate; excluded from the tournament until released
]);

export type HypothesisStatus = z.infer<typeof HypothesisStatusSchema>;

export const ReviewTypeSchema = z.enum([
  "initial",
  "full",
  "deep_verification",
  "observation",
  "simulation",
  "tournament",
  "expert",        // submitted by human scientist
]);

export type ReviewType = z.infer<typeof ReviewTypeSchema>;

export const ReviewVerdictSchema = z.enum(["pass", "fail", "uncertain"]);
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

export const HypothesisReviewSchema = z.object({
  id: z.string().uuid(),
  hypothesisId: z.string().uuid(),
  sessionId: z.string().uuid(),
  type: ReviewTypeSchema,
  verdict: ReviewVerdictSchema,
  noveltyScore: z.number().min(0).max(10).optional(),   // 0-10
  correctnessScore: z.number().min(0).max(10).optional(),
  testabilityScore: z.number().min(0).max(10).optional(),
  safetyFlag: z.boolean().default(false),
  summary: z.string(),          // Concise review summary
  critique: z.string(),         // Detailed critique
  supportingEvidence: z.array(z.string()).default([]),   // URLs / citations
  createdAt: z.date(),
});

export type HypothesisReview = z.infer<typeof HypothesisReviewSchema>;

export const HypothesisSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  title: z.string(),
  summary: z.string(),          // 1-3 sentence summary
  content: z.string(),          // Full hypothesis text
  rationale: z.string(),        // Scientific rationale
  experimentalPlan: z.string().optional(),
  noveltyAssessment: z.string().optional(), // Self-assessed novelty
  keyAssumptions: z.array(z.string()).default([]),
  citations: z.array(z.string()).default([]),
  generationStrategy: z.string(), // Which strategy generated it
  eloRating: z.number().default(1200),       // Glicko-2 rating (μ)
  ratingDeviation: z.number().default(350),  // Glicko-2 RD (φ) — uncertainty
  volatility: z.number().default(0.06),      // Glicko-2 σ — performance consistency
  matchesPlayed: z.number().int().default(0),
  wins: z.number().int().default(0),
  losses: z.number().int().default(0),
  draws: z.number().int().default(0),
  status: HypothesisStatusSchema.default("pending_review"),
  parentIds: z.array(z.string()).default([]), // For evolved hypotheses
  generationRound: z.number().int().default(0),
  feedbackCount: z.number().int().default(0).optional(), // RLEF: # experimental feedback entries
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Hypothesis = z.infer<typeof HypothesisSchema>;
