import { z } from "zod";

export const SessionStatusSchema = z.enum([
  "initializing",
  "running",
  "paused",
  "completed",
  "error",
]);

export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionStatsSchema = z.object({
  totalHypotheses: z.number().int().default(0),
  activeHypotheses: z.number().int().default(0),
  rejectedHypotheses: z.number().int().default(0),
  totalReviews: z.number().int().default(0),
  totalMatches: z.number().int().default(0),
  totalEvolutions: z.number().int().default(0),
  currentRound: z.number().int().default(0),
  topEloRating: z.number().default(1200),
  avgTopTenElo: z.number().default(1200),
  eloPlateau: z.boolean().default(false),
  tokensUsed: z.number().int().default(0),
  tokensByAgent: z.record(z.string(), z.number().int()).default({}),
  elapsedSeconds: z.number().default(0),
});

export type SessionStats = z.infer<typeof SessionStatsSchema>;

export const CoScientistSessionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),                        // Human-friendly session name
  researchGoalId: z.string().uuid(),
  status: SessionStatusSchema.default("initializing"),
  stats: SessionStatsSchema.default({}),
  metaReviewCritique: z.string().nullable().default(null),
  researchOverview: z.string().nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
  completedAt: z.date().nullable().default(null),
});

export type CoScientistSession = z.infer<typeof CoScientistSessionSchema>;
