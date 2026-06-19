import { z } from "zod";

/**
 * RLEF (Reinforcement Learning from Experimental Feedback) data models.
 *
 * Mirrors the `experimental_feedback` and `reward_memory` SQLite tables defined
 * in `src/db/schema.ts`. The model layer uses idiomatic TypeScript shapes
 * (`metadata` as a record, `mechanisticKeywords` as `string[]`) — the
 * persistence layer is responsible for (de)serialising these to/from JSON
 * strings stored in the corresponding `*_json` columns.
 *
 * @see RLEF_IMPLEMENTATION_PLAN.md – Task 2 (Feedback Data Models)
 */

// ─── Recorded-by enum ────────────────────────────────────────────────────────
// `human`     — submitted via `co-scientist feedback ... --experimental` CLI.
// `automated` — reserved for future API ingestion / autonomous sources.
export const FeedbackRecorderSchema = z.enum(["human", "automated"]);
export type FeedbackRecorder = z.infer<typeof FeedbackRecorderSchema>;

// ─── Experimental Feedback ───────────────────────────────────────────────────
// One row per empirical observation about a single hypothesis. Free-text
// `feedbackText` carries the qualitative signal; the optional 0-10 scores
// (Novelty / Correctness / Testability) carry the quantitative signal.
// `computedReward` is derived from those two by the Task-3 reward extractor
// and lives in [-1, +1].
export const ExperimentalFeedbackSchema = z.object({
  id: z.string().uuid(),
  hypothesisId: z.string().uuid(),
  sessionId: z.string().uuid(),

  feedbackText: z.string(),                                        // free-text empirical observation

  // Structured ratings — all optional so a user can submit purely qualitative
  // feedback. Range matches the existing `reviews` table convention.
  noveltyScore: z.number().min(0).max(10).optional(),
  correctnessScore: z.number().min(0).max(10).optional(),
  testabilityScore: z.number().min(0).max(10).optional(),

  // Domain-specific payload. Persisted as the `metadata_json` TEXT column.
  // Examples: `{ cellLine: "MDA-MB-231", IC50_nM: 42 }`,
  //           `{ model: "ResNet-50", accuracy: 0.94, dataset: "CIFAR-10" }`.
  metadata: z.record(z.string(), z.unknown()).default({}),

  // Derived reward signal in [-1, +1]. -1 = strongly refuted, +1 = strongly
  // validated, 0 = neutral / no signal.
  computedReward: z.number().min(-1).max(1),

  recordedBy: FeedbackRecorderSchema.default("human"),
  createdAt: z.date(),
});

export type ExperimentalFeedback = z.infer<typeof ExperimentalFeedbackSchema>;

// ─── Experimental Feedback — User Input ──────────────────────────────────────
// What the CLI / API caller actually supplies. The system fills in `id`,
// `computedReward`, `recordedBy`, and `createdAt` before persisting.
// Provided here so Tasks 4 & 5 can validate raw user input without manually
// stripping derived fields.
export const ExperimentalFeedbackInputSchema = ExperimentalFeedbackSchema.omit({
  id: true,
  computedReward: true,
  recordedBy: true,
  createdAt: true,
});

export type ExperimentalFeedbackInput = z.infer<typeof ExperimentalFeedbackInputSchema>;

// ─── Reward Memory (Cross-Session Semantic Recall) ───────────────────────────
// One row per *strong-signal* feedback (|reward| typically > 0.3) promoted to
// the cross-session memory layer. Queried by new sessions via embedding
// similarity over the `vec_embeddings` virtual table — `embeddingId` keys into
// the same space as `embedding_cache.hypothesisId` / `vec_embeddings.hypothesis_id`.
export const RewardMemorySchema = z.object({
  id: z.string().uuid(),
  hypothesisId: z.string().uuid(),
  sessionId: z.string().uuid(),

  feedbackSummary: z.string(),                                     // distilled summary of the original feedbackText
  mechanisticKeywords: z.array(z.string()).default([]),            // surfaced from feedbackText (Task 7)
  computedReward: z.number().min(-1).max(1),

  // Reference into the embedding key space. Currently always equals
  // `hypothesisId`, but kept as a separate field so we can later embed other
  // artefacts (e.g. a feedback summary) without breaking schema.
  embeddingId: z.string().min(1),

  createdAt: z.date(),
});

export type RewardMemory = z.infer<typeof RewardMemorySchema>;

// ─── Validation helpers ──────────────────────────────────────────────────────
// Throwing variants for trusted call-sites (post-DB-load, internal pipelines).
// `safe*` variants return a discriminated-union result without throwing — use
// at trust boundaries (CLI input, deserialised JSON, etc.).

export function validateExperimentalFeedback(input: unknown): ExperimentalFeedback {
  return ExperimentalFeedbackSchema.parse(input);
}

export function safeValidateExperimentalFeedback(
  input: unknown,
): { success: true; data: ExperimentalFeedback } | { success: false; error: z.ZodError } {
  const r = ExperimentalFeedbackSchema.safeParse(input);
  return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
}

export function validateRewardMemory(input: unknown): RewardMemory {
  return RewardMemorySchema.parse(input);
}
