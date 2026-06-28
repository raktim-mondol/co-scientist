// Review store — hypothesis review persistence and aggregate scoring.
// Extracted from ContextStore (Phase 2 facade split).

import { eq, desc, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb, schema } from "../../db/index.js";
import type { HypothesisReview } from "../../models/hypothesis.js";

export class ReviewStore {
  private db = getDb();

  saveReview(review: Omit<HypothesisReview, "id" | "createdAt">): void {
    const id = uuidv4();
    this.db.insert(schema.reviews).values({
      id,
      hypothesisId: review.hypothesisId,
      sessionId: review.sessionId,
      type: review.type,
      verdict: review.verdict,
      noveltyScore: review.noveltyScore ?? null,
      correctnessScore: review.correctnessScore ?? null,
      testabilityScore: review.testabilityScore ?? null,
      safetyFlag: review.safetyFlag,
      summary: review.summary ?? "No summary provided",
      critique: review.critique ?? "",
      supportingEvidenceJson: JSON.stringify(review.supportingEvidence),
      createdAt: new Date(),
    }).run();
  }

  /**
   * Returns avg novelty/correctness/testability scores per hypothesis for a session.
   * Single query — use this for leaderboard rendering to avoid N+1.
   */
  getAvgScoresForSession(sessionId: string): Record<string, { novelty: number | null; correctness: number | null; testability: number | null }> {
    const rows = this.db
      .select({
        hypothesisId: schema.reviews.hypothesisId,
        novelty:      sql<number | null>`avg(${schema.reviews.noveltyScore})`,
        correctness:  sql<number | null>`avg(${schema.reviews.correctnessScore})`,
        testability:  sql<number | null>`avg(${schema.reviews.testabilityScore})`,
      })
      .from(schema.reviews)
      .where(eq(schema.reviews.sessionId, sessionId))
      .groupBy(schema.reviews.hypothesisId)
      .all();
    return Object.fromEntries(
      rows.map((r) => [r.hypothesisId, { novelty: r.novelty, correctness: r.correctness, testability: r.testability }])
    );
  }

  getReviews(hypothesisId: string): HypothesisReview[] {
    const rows = this.db
      .select()
      .from(schema.reviews)
      .where(eq(schema.reviews.hypothesisId, hypothesisId))
      .orderBy(desc(schema.reviews.createdAt))
      .all();
    return rows.map((r) => ({
      id: r.id,
      hypothesisId: r.hypothesisId,
      sessionId: r.sessionId,
      type: r.type as HypothesisReview["type"],
      verdict: r.verdict as HypothesisReview["verdict"],
      noveltyScore: r.noveltyScore ?? undefined,
      correctnessScore: r.correctnessScore ?? undefined,
      testabilityScore: r.testabilityScore ?? undefined,
      safetyFlag: r.safetyFlag ?? false,
      summary: r.summary,
      critique: r.critique,
      supportingEvidence: (() => { try { return JSON.parse(r.supportingEvidenceJson) as string[]; } catch { return []; } })(),
      createdAt: r.createdAt,
    }));
  }
}