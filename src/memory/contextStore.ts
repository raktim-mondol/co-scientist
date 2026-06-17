import { eq, desc, and, sql, asc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb, getSqlite, withRetry, schema } from "../db/index.js";
import type { Hypothesis } from "../models/hypothesis.js";
import type { HypothesisReview } from "../models/hypothesis.js";
import type { TournamentMatch } from "../models/tournament.js";
import type { CoScientistSession, SessionStats } from "../models/session.js";
import type { ResearchGoal, ResearchPlanConfig } from "../models/researchGoal.js";
import type { AgentTask } from "../models/agentTask.js";
import type { ExperimentalFeedback } from "../models/feedback.js";
import type { EvidenceSource } from "../models/evidence.js";
import { cosineSimilarity } from "../util/vector.js";
import { logger } from "../config.js";

export interface SafetyAssessmentRow {
  severity: string;
  category: string;
  reasoning: string;
  decision: "allowed" | "quarantined";
  threshold: string;
  overriddenBy: string | null;
  overrideReason: string | null;
  overriddenAt: Date | null;
  createdAt: Date;
}

export class ContextStore {
  private db = getDb();
  // Raw sqlite3 handle — used for vec0 virtual table (not supported by Drizzle ORM)
  private sqlite = getSqlite();

  // ─── Sessions ─────────────────────────────────────────────────────────────

  createSession(name: string, goal: ResearchGoal): string {
    const id = uuidv4();
    const now = new Date();
    // Retry on transient "database is locked" — can happen when a previous
    // session's WAL checkpoint hasn't fully released the write lock.
    withRetry(() => {
      this.db.insert(schema.sessions).values({
        id,
        name,
        status: "initializing",
        researchGoalJson: JSON.stringify(goal),
        statsJson: JSON.stringify({}),
        createdAt: now,
        updatedAt: now,
      }).run();
    });
    return id;
  }

  getSession(id: string): CoScientistSession | null {
    const row = this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, id))
      .get();
    if (!row) return null;
    return this._rowToSession(row);
  }

  getResearchGoal(sessionId: string): ResearchGoal | null {
    const row = this.db
      .select({ researchGoalJson: schema.sessions.researchGoalJson })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get();
    if (!row) return null;
    return JSON.parse(row.researchGoalJson) as ResearchGoal;
  }

  listSessions(): CoScientistSession[] {
    const rows = this.db
      .select()
      .from(schema.sessions)
      .orderBy(desc(schema.sessions.createdAt))
      .all();
    return rows.map((r) => this._rowToSession(r));
  }

  countTournamentMatches(sessionId: string): number {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.tournamentMatches)
      .where(eq(schema.tournamentMatches.sessionId, sessionId))
      .get();
    return Number(row?.count ?? 0);
  }

  deleteSession(id: string): void {
    // Delete in dependency order (child tables first, then session)
    const hyps = this.db
      .select({ id: schema.hypotheses.id })
      .from(schema.hypotheses)
      .where(eq(schema.hypotheses.sessionId, id))
      .all();

    for (const h of hyps) {
      this.db.delete(schema.embeddingCache).where(eq(schema.embeddingCache.hypothesisId, h.id)).run();
      this.db.delete(schema.reviews).where(eq(schema.reviews.hypothesisId, h.id)).run();
      // Remove claim citations per hypothesis
      this.db.delete(schema.claimCitations).where(eq(schema.claimCitations.hypothesisId, h.id)).run();
      this.sqlite.query(`DELETE FROM citation_verifications WHERE hypothesis_id = ?`).run(h.id);
      this.sqlite.query(`DELETE FROM safety_assessments WHERE hypothesis_id = ?`).run(h.id);
      // Remove embedding from vec0 ANN index
      this.sqlite.query(`DELETE FROM vec_embeddings WHERE hypothesis_id = ?`).run(h.id);
    }

    // Remove feedback & reward_memory rows (FK to both hypotheses & sessions)
    this.db.delete(schema.experimentalFeedback).where(eq(schema.experimentalFeedback.sessionId, id)).run();
    this.sqlite.query(`DELETE FROM reward_memory WHERE session_id = ?`).run(id);
    // Remove thinking traces & session activity
    this.db.delete(schema.thinkingTraces).where(eq(schema.thinkingTraces.sessionId, id)).run();
    this.db.delete(schema.sessionActivity).where(eq(schema.sessionActivity.sessionId, id)).run();
    // Remove KG nodes and edges for the session
    this.db.delete(schema.kgEdges).where(eq(schema.kgEdges.sessionId, id)).run();
    this.db.delete(schema.kgNodes).where(eq(schema.kgNodes.sessionId, id)).run();
    this.db.delete(schema.proximityEdges).where(eq(schema.proximityEdges.sessionId, id)).run();
    this.db.delete(schema.evidenceSources).where(eq(schema.evidenceSources.sessionId, id)).run();
    this.db.delete(schema.tournamentMatches).where(eq(schema.tournamentMatches.sessionId, id)).run();
    this.db.delete(schema.hypotheses).where(eq(schema.hypotheses.sessionId, id)).run();
    this.db.delete(schema.agentTasks).where(eq(schema.agentTasks.sessionId, id)).run();
    this.db.delete(schema.sessions).where(eq(schema.sessions.id, id)).run();
  }

  updateSessionStatus(id: string, status: string): void {
    this.db
      .update(schema.sessions)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.sessions.id, id))
      .run();
  }

  updateSessionStats(id: string, stats: SessionStats): void {
    this.db
      .update(schema.sessions)
      .set({ statsJson: JSON.stringify(stats), updatedAt: new Date() })
      .where(eq(schema.sessions.id, id))
      .run();
  }

  savePlanConfig(sessionId: string, config: ResearchPlanConfig): void {
    this.db
      .update(schema.sessions)
      .set({ planConfigJson: JSON.stringify(config), updatedAt: new Date() })
      .where(eq(schema.sessions.id, sessionId))
      .run();
  }

  saveMetaReviewCritique(sessionId: string, critique: string): void {
    this.db
      .update(schema.sessions)
      .set({ metaReviewCritique: critique, updatedAt: new Date() })
      .where(eq(schema.sessions.id, sessionId))
      .run();
  }

  saveResearchOverview(sessionId: string, overview: string): void {
    this.db
      .update(schema.sessions)
      .set({
        researchOverview: overview.trim().replace(/\n{3,}/g, "\n\n"),
        status: "completed",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.sessions.id, sessionId))
      .run();
  }

  getMetaReviewCritique(sessionId: string): string | null {
    const row = this.db
      .select({ critique: schema.sessions.metaReviewCritique })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get();
    return row?.critique ?? null;
  }

  getPlanConfig(sessionId: string): ResearchPlanConfig | null {
    const row = this.db
      .select({ config: schema.sessions.planConfigJson })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get();
    if (!row?.config) return null;
    return JSON.parse(row.config);
  }

  // ─── Hypotheses ───────────────────────────────────────────────────────────

  saveHypothesis(hyp: Omit<Hypothesis, "id" | "createdAt" | "updatedAt">): Hypothesis {
    const id = uuidv4();
    const now = new Date();
    const fullHyp: Hypothesis = {
      ...hyp,
      id,
      createdAt: now,
      updatedAt: now,
    } as Hypothesis;

    withRetry(() => {
      this.db.insert(schema.hypotheses).values({
        id,
        sessionId: fullHyp.sessionId,
        title: fullHyp.title,
        summary: fullHyp.summary,
        content: fullHyp.content,
        rationale: fullHyp.rationale,
        experimentalPlan: fullHyp.experimentalPlan ?? null,
        noveltyAssessment: fullHyp.noveltyAssessment ?? null,
        keyAssumptionsJson: JSON.stringify(fullHyp.keyAssumptions),
        citationsJson: JSON.stringify(fullHyp.citations),
        generationStrategy: fullHyp.generationStrategy,
        eloRating: fullHyp.eloRating,
        ratingDeviation: fullHyp.ratingDeviation ?? 350,
        volatility: fullHyp.volatility ?? 0.06,
        matchesPlayed: fullHyp.matchesPlayed,
        wins: fullHyp.wins,
        losses: fullHyp.losses,
        draws: fullHyp.draws ?? 0,
        status: fullHyp.status,
        parentIdsJson: JSON.stringify(fullHyp.parentIds),
        generationRound: fullHyp.generationRound,
        createdAt: now,
        updatedAt: now,
      }).run();
    });

    return fullHyp;
  }

  /**
   * Update a hypothesis's Glicko-2 rating state after a match.
   */
  updateHypothesisRating(
    id: string,
    rating: number,
    rd: number,
    volatility: number,
    wins: number,
    losses: number,
    matchesPlayed: number,
    draws: number = 0
  ): void {
    this.db
      .update(schema.hypotheses)
      .set({
        eloRating: rating,
        ratingDeviation: rd,
        volatility,
        wins,
        losses,
        draws,
        matchesPlayed,
        updatedAt: new Date(),
      })
      .where(eq(schema.hypotheses.id, id))
      .run();
  }

  /**
   * @deprecated Use updateHypothesisRating instead.
   * Kept for backward compatibility — only updates the rating column.
   */
  updateHypothesisElo(
    id: string,
    elo: number,
    wins: number,
    losses: number,
    matchesPlayed: number
  ): void {
    this.updateHypothesisRating(id, elo, 350, 0.06, wins, losses, matchesPlayed);
  }

  /**
   * Atomic read-compute-write for Glicko-2 rating updates.
   * Reads fresh state inside a transaction, applies the compute function,
   * and writes back — preventing concurrent matches from overwriting each other.
   */
  atomicGlicko2Update(
    id: string,
    compute: (current: { rating: number; rd: number; volatility: number; wins: number; losses: number; draws: number; matchesPlayed: number }) => { rating: number; rd: number; volatility: number; wins: number; losses: number; draws: number; matchesPlayed: number }
  ): void {
    this.sqlite.transaction(() => {
      const hyp = this.getHypothesis(id);
      if (!hyp) return;
      const current = {
        rating: hyp.eloRating,
        rd: hyp.ratingDeviation ?? 350,
        volatility: hyp.volatility ?? 0.06,
        wins: hyp.wins,
        losses: hyp.losses,
        draws: hyp.draws ?? 0,
        matchesPlayed: hyp.matchesPlayed,
      };
      const updated = compute(current);
      this.updateHypothesisRating(
        id, updated.rating, updated.rd, updated.volatility,
        updated.wins, updated.losses, updated.matchesPlayed, updated.draws
      );
    })();
  }

  updateHypothesisStatus(id: string, status: string): void {
    this.db
      .update(schema.hypotheses)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.hypotheses.id, id))
      .run();
  }

  getHypothesis(id: string): Hypothesis | null {
    const row = this.db
      .select()
      .from(schema.hypotheses)
      .where(eq(schema.hypotheses.id, id))
      .get();
    if (!row) return null;
    return this._rowToHypothesis(row);
  }

  getTopHypotheses(sessionId: string, n = 10): Hypothesis[] {
    const rows = this.db
      .select()
      .from(schema.hypotheses)
      .where(
        and(
          eq(schema.hypotheses.sessionId, sessionId),
          eq(schema.hypotheses.status, "active")
        )
      )
      .orderBy(desc(schema.hypotheses.eloRating))
      .limit(n)
      .all();
    return this._rowsToHypotheses(rows);
  }

  getAllActiveHypotheses(sessionId: string): Hypothesis[] {
    const rows = this.db
      .select()
      .from(schema.hypotheses)
      .where(
        and(
          eq(schema.hypotheses.sessionId, sessionId),
          eq(schema.hypotheses.status, "active")
        )
      )
      .orderBy(desc(schema.hypotheses.eloRating))
      .all();
    return this._rowsToHypotheses(rows);
  }

  getPendingReviewHypotheses(sessionId: string, limit = 5): Hypothesis[] {
    const rows = this.db
      .select()
      .from(schema.hypotheses)
      .where(
        and(
          eq(schema.hypotheses.sessionId, sessionId),
          eq(schema.hypotheses.status, "pending_review")
        )
      )
      .orderBy(asc(schema.hypotheses.createdAt))
      .limit(limit)
      .all();
    return this._rowsToHypotheses(rows);
  }

  countHypotheses(sessionId: string): { total: number; active: number; pending: number } {
    const rows = this.db
      .select({
        status: schema.hypotheses.status,
        count: sql<number>`count(*)`,
      })
      .from(schema.hypotheses)
      .where(eq(schema.hypotheses.sessionId, sessionId))
      .groupBy(schema.hypotheses.status)
      .all();

    const counts = { total: 0, active: 0, pending: 0 };
    for (const r of rows) {
      counts.total += Number(r.count);
      if (r.status === "active") counts.active = Number(r.count);
      if (r.status === "pending_review") counts.pending = Number(r.count);
    }
    return counts;
  }

  // ─── Reviews ──────────────────────────────────────────────────────────────

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
      supportingEvidence: JSON.parse(r.supportingEvidenceJson),
      createdAt: r.createdAt,
    }));
  }

  // ─── Tournament ───────────────────────────────────────────────────────────

  saveTournamentMatch(match: Omit<TournamentMatch, "id" | "createdAt">): void {
    this.db.insert(schema.tournamentMatches).values({
      id: uuidv4(),
      ...match,
      debateTranscript: match.debateTranscript ?? null,
      createdAt: new Date(),
    }).run();
  }

  getRecentMatches(sessionId: string, limit = 50): TournamentMatch[] {
    const rows = this.db
      .select()
      .from(schema.tournamentMatches)
      .where(eq(schema.tournamentMatches.sessionId, sessionId))
      .orderBy(desc(schema.tournamentMatches.createdAt))
      .limit(limit)
      .all();
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      hypothesisAId: r.hypothesisAId,
      hypothesisBId: r.hypothesisBId,
      matchType: r.matchType as TournamentMatch["matchType"],
      result: r.result as TournamentMatch["result"],
      winnerEloAfter: r.winnerEloAfter,
      loserEloAfter: r.loserEloAfter,
      debateTranscript: r.debateTranscript ?? null,
      rationale: r.rationale,
      round: r.round,
      createdAt: r.createdAt,
    }));
  }

  // ─── Proximity ────────────────────────────────────────────────────────────

  saveProximityEdge(
    sessionId: string,
    hypAId: string,
    hypBId: string,
    score: number
  ): void {
    // Use raw SQL INSERT OR REPLACE to avoid duplicate edges for the same pair.
    // Pairs are stored in canonical (sorted) order so (A,B) and (B,A) are treated identically.
    const [aId, bId] = [hypAId, hypBId].sort();
    this.sqlite.transaction(() => {
      // INSERT OR IGNORE so new pairs are inserted; existing pairs are silently skipped.
      this.sqlite
        .query(
          `INSERT OR IGNORE INTO proximity_edges (id, session_id, hypothesis_a_id, hypothesis_b_id, similarity_score, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(uuidv4(), sessionId, aId, bId, score, Math.floor(Date.now() / 1000));
      // UPDATE the score for the pair that already existed (no-op for the just-inserted row
      // since it matches, but SQLite guarantees the INSERT above ran first).
      this.sqlite
        .query(
          `UPDATE proximity_edges SET similarity_score = ? WHERE hypothesis_a_id = ? AND hypothesis_b_id = ?`
        )
        .run(score, aId, bId);
    })();
  }

  getSimilarHypotheses(hypothesisId: string, k = 5): string[] {
    const rowsA = this.db
      .select({
        otherId: schema.proximityEdges.hypothesisBId,
        score: schema.proximityEdges.similarityScore,
      })
      .from(schema.proximityEdges)
      .where(eq(schema.proximityEdges.hypothesisAId, hypothesisId))
      .orderBy(desc(schema.proximityEdges.similarityScore))
      .limit(k)
      .all();

    const rowsB = this.db
      .select({
        otherId: schema.proximityEdges.hypothesisAId,
        score: schema.proximityEdges.similarityScore,
      })
      .from(schema.proximityEdges)
      .where(eq(schema.proximityEdges.hypothesisBId, hypothesisId))
      .orderBy(desc(schema.proximityEdges.similarityScore))
      .limit(k)
      .all();

    const combined = [...rowsA, ...rowsB]
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((r) => r.otherId);

    return [...new Set(combined)];
  }

  saveEmbedding(hypothesisId: string, embedding: number[]): void {
    const buf = Buffer.from(new Float32Array(embedding).buffer);

    // 1. Save raw blob to embedding_cache for direct retrieval (no inference needed)
    this.db.insert(schema.embeddingCache).values({
      hypothesisId,
      embeddingBlob: buf,
      createdAt: new Date(),
    }).onConflictDoUpdate({
      target: schema.embeddingCache.hypothesisId,
      set: { embeddingBlob: buf, createdAt: new Date() },
    }).run();

    // 2. Upsert into vec_embeddings (sqlite-vec vec0 virtual table) for ANN search.
    //    sqlite-vec virtual tables do not support ON CONFLICT / INSERT OR REPLACE,
    //    so we use an explicit DELETE + INSERT inside a transaction instead.
    this.sqlite.transaction(() => {
      this.sqlite.query(`DELETE FROM vec_embeddings WHERE hypothesis_id = ?`).run(hypothesisId);
      this.sqlite.query(`INSERT INTO vec_embeddings(hypothesis_id, embedding) VALUES (?, ?)`).run(hypothesisId, buf);
    })();
  }

  getEmbedding(hypothesisId: string): number[] | null {
    const row = this.db
      .select()
      .from(schema.embeddingCache)
      .where(eq(schema.embeddingCache.hypothesisId, hypothesisId))
      .get();
    if (!row) return null;
    // Reinterpret the raw bytes as float32 (NOT new Float32Array(buffer), which
    // would copy each byte as a separate element). Respect byteOffset/length so
    // a pooled Buffer slice decodes correctly.
    const buf = row.embeddingBlob as Buffer;
    return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
  }

  /**
   * ANN search via sqlite-vec's vec0 KNN index.
   * Returns up to `limit` hypothesis IDs nearest to `queryEmbedding`,
   * along with their cosine distance (lower = more similar).
   *
   * This replaces the O(n²) pairwise loop in ProximityAgent for neighbour lookup.
   * For full pairwise similarity (deduplication), ProximityAgent still iterates all
   * active hypotheses but skips pairs that already have a proximity_edge row.
   */
  findSimilarByVector(
    queryEmbedding: number[],
    limit = 20
  ): Array<{ hypothesisId: string; distance: number }> {
    const buf = Buffer.from(new Float32Array(queryEmbedding).buffer);
    const rows = this.sqlite
      .query(
        `SELECT hypothesis_id, distance
         FROM vec_embeddings
         WHERE embedding MATCH ?
         ORDER BY distance
         LIMIT ?`
      )
      .all(buf, limit) as Array<{ hypothesis_id: string; distance: number }>;
    return rows.map((r) => ({ hypothesisId: r.hypothesis_id, distance: r.distance }));
  }

  // ─── Knowledge Graph ─────────────────────────────────────────────────────

  upsertKgNode(id: string, sessionId: string, type: string, label: string, hypothesisId?: string): void {
    this.db.insert(schema.kgNodes).values({
      id,
      sessionId,
      type,
      label,
      hypothesisId: hypothesisId ?? null,
      createdAt: new Date(),
    }).onConflictDoNothing().run();
  }

  upsertKgEdge(id: string, sessionId: string, fromNodeId: string, toNodeId: string, relation: string): void {
    this.db.insert(schema.kgEdges).values({
      id,
      sessionId,
      fromNodeId,
      toNodeId,
      relation,
      createdAt: new Date(),
    }).onConflictDoNothing().run();
  }

  getKgNodes(sessionId: string): Array<typeof schema.kgNodes.$inferSelect> {
    return this.db.select().from(schema.kgNodes).where(eq(schema.kgNodes.sessionId, sessionId)).all();
  }

  getKgEdges(sessionId: string): Array<typeof schema.kgEdges.$inferSelect> {
    return this.db.select().from(schema.kgEdges).where(eq(schema.kgEdges.sessionId, sessionId)).all();
  }

  // ─── Experiment Protocol ─────────────────────────────────────────────────

  saveExperimentProtocol(hypothesisId: string, protocol: Record<string, unknown>): void {
    this.db
      .update(schema.hypotheses)
      .set({ experimentProtocolJson: JSON.stringify(protocol), updatedAt: new Date() })
      .where(eq(schema.hypotheses.id, hypothesisId))
      .run();
  }

  getExperimentProtocol(hypothesisId: string): Record<string, unknown> | null {
    const row = this.db
      .select({ proto: schema.hypotheses.experimentProtocolJson })
      .from(schema.hypotheses)
      .where(eq(schema.hypotheses.id, hypothesisId))
      .get();
    if (!row?.proto) return null;
    const parsed = JSON.parse(row.proto) as Record<string, unknown>;
    // Treat as absent if core LLM-generated fields are missing (stale/incomplete protocol)
    const hasContent = parsed.overview || (Array.isArray(parsed.steps) && (parsed.steps as unknown[]).length > 0);
    if (!hasContent) return null;
    return parsed;
  }

  // ─── Agent Tasks ─────────────────────────────────────────────────────────

  logTask(task: Omit<AgentTask, "id" | "createdAt">): void {
    this.db.insert(schema.agentTasks).values({
      id: uuidv4(),
      sessionId: task.sessionId,
      type: task.type,
      status: task.status ?? "pending",
      priority: task.priority ?? 5,
      payloadJson: JSON.stringify(task.payload ?? {}),
      resultJson: task.result ? JSON.stringify(task.result) : null,
      error: task.error ?? null,
      tokensUsed: task.tokensUsed ?? 0,
      startedAt: task.startedAt ?? null,
      completedAt: task.completedAt ?? null,
      createdAt: new Date(),
    }).run();
  }

  // ─── Provenance ───────────────────────────────────────────────────────────

  saveClaimCitations(
    hypothesisId: string,
    sessionId: string,
    claims: Array<{
      claimText: string;
      paperTitle: string;
      paperUrl: string;
      paperAuthors: string;
      paperYear?: number;
      paperAbstract: string;
      support: "supports" | "contradicts" | "unaddressed";
      confidence: number;
    }>
  ): void {
    const now = new Date();
    this.sqlite.transaction(() => {
      for (const c of claims) {
        this.db.insert(schema.claimCitations).values({
          id: uuidv4(),
          hypothesisId,
          sessionId,
          claimText: c.claimText,
          paperTitle: c.paperTitle,
          paperUrl: c.paperUrl,
          paperAuthors: c.paperAuthors,
          paperYear: c.paperYear ?? null,
          paperAbstract: c.paperAbstract,
          support: c.support,
          confidence: c.confidence,
          createdAt: now,
        }).run();
      }
    })();
  }

  getClaimCitations(hypothesisId: string): Array<typeof schema.claimCitations.$inferSelect> {
    return this.db
      .select()
      .from(schema.claimCitations)
      .where(eq(schema.claimCitations.hypothesisId, hypothesisId))
      .all();
  }

  /** True if the hypothesis has ≥1 contradicted or unaddressed claim. */
  hasProvenanceFlag(hypothesisId: string): boolean {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.claimCitations)
      .where(
        and(
          eq(schema.claimCitations.hypothesisId, hypothesisId),
          sql`${schema.claimCitations.support} IN ('contradicts', 'unaddressed')`
        )
      )
      .get();
    return Number(row?.count ?? 0) > 0;
  }

  // ─── Evidence Bank (Deep Evidence Pipeline) ──────────────────────────────────

  /** Upsert by (sessionId, url). Optionally stores the summary embedding. */
  saveEvidence(
    ev: Omit<EvidenceSource, "id" | "createdAt">,
    embedding?: number[]
  ): EvidenceSource {
    const id = uuidv4();
    const now = new Date();
    const embeddingBlob = embedding
      ? Buffer.from(new Float32Array(embedding).buffer)
      : null;

    this.db.insert(schema.evidenceSources).values({
      id,
      sessionId: ev.sessionId,
      url: ev.url,
      title: ev.title,
      doi: ev.doi ?? null,
      publishedDate: ev.publishedDate ?? null,
      goal: ev.goal,
      rationale: ev.rationale,
      evidence: ev.evidence,
      summary: ev.summary,
      round: ev.round,
      embeddingBlob,
      createdAt: now,
    }).onConflictDoUpdate({
      target: [schema.evidenceSources.sessionId, schema.evidenceSources.url],
      set: {
        title: ev.title,
        doi: ev.doi ?? null,
        publishedDate: ev.publishedDate ?? null,
        goal: ev.goal,
        rationale: ev.rationale,
        evidence: ev.evidence,
        summary: ev.summary,
        round: ev.round,
        embeddingBlob,
        createdAt: now,
      },
    }).run();

    // Re-read so upserts return the surviving row's id
    const row = this.db.select().from(schema.evidenceSources)
      .where(and(
        eq(schema.evidenceSources.sessionId, ev.sessionId),
        eq(schema.evidenceSources.url, ev.url),
      )).get()!;
    return this._rowToEvidence(row);
  }

  getEvidenceBySession(sessionId: string): EvidenceSource[] {
    const rows = this.db.select().from(schema.evidenceSources)
      .where(eq(schema.evidenceSources.sessionId, sessionId))
      .orderBy(desc(schema.evidenceSources.createdAt))
      .all();
    return rows.map((r) => this._rowToEvidence(r));
  }

  hasVisitedUrl(sessionId: string, url: string): boolean {
    const row = this.db.select({ id: schema.evidenceSources.id })
      .from(schema.evidenceSources)
      .where(and(
        eq(schema.evidenceSources.sessionId, sessionId),
        eq(schema.evidenceSources.url, url),
      )).get();
    return !!row;
  }

  /** Top-k evidence rows by cosine similarity of stored embeddings (TS-side; row counts are small). */
  getRelevantEvidence(sessionId: string, embedding: number[], k: number): EvidenceSource[] {
    const rows = this.db.select().from(schema.evidenceSources)
      .where(eq(schema.evidenceSources.sessionId, sessionId))
      .all();
    return rows
      .filter((r) => r.embeddingBlob != null)
      .map((r) => {
        const buf = r.embeddingBlob as Buffer;
        const vec = Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
        return { row: r, score: cosineSimilarity(embedding, vec) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ row }) => this._rowToEvidence(row));
  }

  // ─── Citation Verifications (Citation-Integrity) ──────────────────────────

  saveCitationVerifications(
    hypothesisId: string,
    sessionId: string,
    rows: Array<{
      rawCitation: string;
      status: "verified" | "unverified" | "fabricated";
      canonicalTitle?: string;
      doi?: string;
      authors?: string;
      year?: number;
      matchScore: number;
    }>
  ): void {
    const now = Math.floor(Date.now() / 1000);
    this.sqlite.transaction(() => {
      this.sqlite
        .query(`DELETE FROM citation_verifications WHERE hypothesis_id = ?`)
        .run(hypothesisId);
      for (const r of rows) {
        this.sqlite
          .query(
            `INSERT INTO citation_verifications
               (id, hypothesis_id, session_id, raw_citation, status,
                canonical_title, doi, authors, year, match_score, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            uuidv4(), hypothesisId, sessionId, r.rawCitation, r.status,
            r.canonicalTitle ?? null, r.doi ?? null, r.authors ?? null,
            r.year ?? null, r.matchScore, now
          );
      }
    })();
  }

  getCitationVerifications(
    hypothesisId: string
  ): Array<{
    rawCitation: string;
    status: "verified" | "unverified" | "fabricated";
    canonicalTitle: string | null;
    doi: string | null;
    authors: string | null;
    year: number | null;
    matchScore: number;
  }> {
    const rows = this.sqlite
      .query(
        `SELECT raw_citation, status, canonical_title, doi, authors, year, match_score
         FROM citation_verifications WHERE hypothesis_id = ? ORDER BY created_at ASC`
      )
      .all(hypothesisId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      rawCitation: r.raw_citation as string,
      status: r.status as "verified" | "unverified" | "fabricated",
      canonicalTitle: (r.canonical_title as string | null) ?? null,
      doi: (r.doi as string | null) ?? null,
      authors: (r.authors as string | null) ?? null,
      year: (r.year as number | null) ?? null,
      matchScore: r.match_score as number,
    }));
  }

  getCitationIntegrity(hypothesisId: string): {
    total: number; verified: number; unverified: number; fabricated: number; fabricationRate: number;
  } {
    const rows = this.sqlite
      .query(
        `SELECT status, count(*) as n FROM citation_verifications
         WHERE hypothesis_id = ? GROUP BY status`
      )
      .all(hypothesisId) as Array<{ status: string; n: number }>;
    const counts = { total: 0, verified: 0, unverified: 0, fabricated: 0 };
    for (const r of rows) {
      const n = Number(r.n);
      counts.total += n;
      if (r.status === "verified") counts.verified = n;
      else if (r.status === "unverified") counts.unverified = n;
      else if (r.status === "fabricated") counts.fabricated = n;
    }
    return {
      ...counts,
      fabricationRate: counts.total > 0 ? counts.fabricated / counts.total : 0,
    };
  }

  // ─── Safety Assessments (Safety Gate) ─────────────────────────────────────

  saveSafetyAssessment(
    hypothesisId: string,
    sessionId: string,
    a: { severity: string; category: string; reasoning: string; decision: string; threshold: string }
  ): void {
    this.db.insert(schema.safetyAssessments).values({
      id: uuidv4(),
      hypothesisId,
      sessionId,
      severity: a.severity,
      category: a.category,
      reasoning: a.reasoning,
      decision: a.decision,
      threshold: a.threshold,
      overriddenBy: null,
      overrideReason: null,
      overriddenAt: null,
      createdAt: new Date(),
    }).run();
  }

  /** Most recent safety assessment for a hypothesis, or null if never screened. */
  getLatestSafetyAssessment(hypothesisId: string): SafetyAssessmentRow | null {
    const row = this.db
      .select()
      .from(schema.safetyAssessments)
      .where(eq(schema.safetyAssessments.hypothesisId, hypothesisId))
      .orderBy(desc(schema.safetyAssessments.createdAt))
      .get();
    return row ? this._rowToSafetyAssessment(row) : null;
  }

  /** Hypotheses currently withheld by the safety gate, newest first. */
  getQuarantinedHypotheses(sessionId: string): Hypothesis[] {
    const rows = this.db
      .select()
      .from(schema.hypotheses)
      .where(
        and(
          eq(schema.hypotheses.sessionId, sessionId),
          eq(schema.hypotheses.status, "quarantined")
        )
      )
      .orderBy(desc(schema.hypotheses.createdAt))
      .all();
    return this._rowsToHypotheses(rows);
  }

  /**
   * Release a quarantined hypothesis into the active pool (operator override).
   * Records who released it and why on its latest assessment row. Returns false
   * if the hypothesis is not currently quarantined.
   */
  releaseQuarantine(hypothesisId: string, overriddenBy: string, reason: string): boolean {
    const hyp = this.getHypothesis(hypothesisId);
    if (!hyp || hyp.status !== "quarantined") return false;
    const now = new Date();
    this.sqlite.transaction(() => {
      this.db
        .update(schema.hypotheses)
        .set({ status: "active", updatedAt: now })
        .where(eq(schema.hypotheses.id, hypothesisId))
        .run();
      const latest = this.db
        .select({ id: schema.safetyAssessments.id })
        .from(schema.safetyAssessments)
        .where(eq(schema.safetyAssessments.hypothesisId, hypothesisId))
        .orderBy(desc(schema.safetyAssessments.createdAt))
        .get();
      if (latest) {
        this.db
          .update(schema.safetyAssessments)
          .set({ overriddenBy, overrideReason: reason, overriddenAt: now })
          .where(eq(schema.safetyAssessments.id, latest.id))
          .run();
      }
    })();
    return true;
  }

  private _rowToSafetyAssessment(r: typeof schema.safetyAssessments.$inferSelect): SafetyAssessmentRow {
    return {
      severity: r.severity,
      category: r.category,
      reasoning: r.reasoning,
      decision: r.decision as "allowed" | "quarantined",
      threshold: r.threshold,
      overriddenBy: r.overriddenBy ?? null,
      overrideReason: r.overrideReason ?? null,
      overriddenAt: r.overriddenAt ?? null,
      createdAt: r.createdAt,
    };
  }

  getTokensByAgent(sessionId: string): Record<string, number> {
    const rows = this.db
      .select({
        type: schema.agentTasks.type,
        total: sql<number>`sum(${schema.agentTasks.tokensUsed})`,
      })
      .from(schema.agentTasks)
      .where(eq(schema.agentTasks.sessionId, sessionId))
      .groupBy(schema.agentTasks.type)
      .all();
    return Object.fromEntries(rows.map((r) => [r.type, Number(r.total ?? 0)]));
  }

  countCompletedTasksByType(sessionId: string, type: string): number {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.agentTasks)
      .where(
        and(
          eq(schema.agentTasks.sessionId, sessionId),
          eq(schema.agentTasks.type, type),
          eq(schema.agentTasks.status, "completed")
        )
      )
      .get();
    return Number(row?.count ?? 0);
  }

  // ─── Experimental Feedback (RLEF) ────────────────────────────────────────

  saveExperimentalFeedback(feedback: ExperimentalFeedback): void {
    this.sqlite.query(`
      INSERT INTO experimental_feedback
        (id, hypothesis_id, session_id, feedback_text,
         novelty_score, correctness_score, testability_score,
         metadata_json, computed_reward, recorded_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      feedback.id,
      feedback.hypothesisId,
      feedback.sessionId,
      feedback.feedbackText,
      feedback.noveltyScore      ?? null,
      feedback.correctnessScore  ?? null,
      feedback.testabilityScore  ?? null,
      JSON.stringify(feedback.metadata ?? {}),
      feedback.computedReward,
      feedback.recordedBy,
      feedback.createdAt.getTime() / 1000,
    );
  }

  getExperimentalFeedback(hypothesisId: string): ExperimentalFeedback[] {
    const rows = this.sqlite.query(`
      SELECT * FROM experimental_feedback
      WHERE hypothesis_id = ?
      ORDER BY created_at DESC
    `).all(hypothesisId) as Array<Record<string, unknown>>;
    return rows.map(this._rowToFeedback);
  }

  getAllFeedbackForSession(sessionId: string): ExperimentalFeedback[] {
    const rows = this.sqlite.query(`
      SELECT * FROM experimental_feedback
      WHERE session_id = ?
      ORDER BY created_at DESC
    `).all(sessionId) as Array<Record<string, unknown>>;
    return rows.map(this._rowToFeedback);
  }

  // ─── Thinking Traces ─────────────────────────────────────────────────────

  /** Persist a DeepSeek reasoning trace to the DB. */
  saveThinkingTrace(params: {
    id: string;
    sessionId: string;
    agent: string;
    reasoning: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }): void {
    this.db.insert(schema.thinkingTraces).values({
      id: params.id,
      sessionId: params.sessionId,
      agent: params.agent,
      reasoning: params.reasoning,
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
      totalTokens: params.totalTokens,
      createdAt: new Date(),
    }).run();
  }

  /** Get all thinking traces for a session. */
  getThinkingTraces(sessionId: string): Array<{
    id: string;
    agent: string;
    reasoning: string;
    tokens: number;
    createdAt: Date;
  }> {
    return (this.sqlite.query(`
      SELECT id, agent, reasoning, total_tokens AS tokens, created_at AS createdAt
      FROM thinking_traces
      WHERE session_id = ?
      ORDER BY created_at ASC
    `).all(sessionId) as Array<{
      id: string; agent: string; reasoning: string; tokens: number; createdAt: number;
    }>).map((r) => ({ ...r, createdAt: new Date(r.createdAt * 1000) }));
  }
  
  /** Check if a session has any thinking traces. */
  hasThinkingTraces(sessionId: string): boolean {
    const row = this.sqlite.query(`
      SELECT 1 FROM thinking_traces WHERE session_id = ? LIMIT 1
    `).get(sessionId) as { 1: number } | undefined;
    return row !== undefined;
  }

  // ─── Session Activity Log ─────────────────────────────────────────────────

  /** Log a session activity entry. */
  logActivity(params: {
    id: string;
    sessionId: string;
    agent: string;
    type: string;
    message: string;
    detailJson?: string;
    tokensIn?: number;
    tokensOut?: number;
  }): void {
    this.db.insert(schema.sessionActivity).values({
      id: params.id,
      sessionId: params.sessionId,
      agent: params.agent,
      type: params.type,
      message: params.message,
      detailJson: params.detailJson ?? null,
      tokensIn: params.tokensIn ?? null,
      tokensOut: params.tokensOut ?? null,
      createdAt: new Date(),
    }).run();
  }

  /** Get all activity entries for a session, ordered chronologically. */
  getSessionActivity(sessionId: string): Array<{
    id: string;
    agent: string;
    type: string;
    message: string;
    detailJson: string | null;
    tokensIn: number | null;
    tokensOut: number | null;
    createdAt: Date;
  }> {
    return (this.sqlite.query(`
      SELECT id, agent, type, message, detail_json AS detailJson,
             tokens_in AS tokensIn, tokens_out AS tokensOut, created_at AS createdAt
      FROM session_activity
      WHERE session_id = ?
      ORDER BY created_at ASC
    `).all(sessionId) as Array<{
      id: string; agent: string; type: string; message: string;
      detailJson: string | null; tokensIn: number | null; tokensOut: number | null;
      createdAt: number;
    }>).map((r) => ({ ...r, createdAt: new Date(r.createdAt * 1000) }));
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private _rowToEvidence(r: typeof schema.evidenceSources.$inferSelect): EvidenceSource {
    return {
      id: r.id,
      sessionId: r.sessionId,
      url: r.url,
      title: r.title,
      doi: r.doi ?? undefined,
      publishedDate: r.publishedDate ?? undefined,
      goal: r.goal,
      rationale: r.rationale,
      evidence: r.evidence,
      summary: r.summary,
      round: r.round,
      createdAt: r.createdAt,
    };
  }

  private _rowToSession(row: typeof schema.sessions.$inferSelect): CoScientistSession {
    return {
      id: row.id,
      name: row.name,
      researchGoalId: JSON.parse(row.researchGoalJson).id,
      status: row.status as CoScientistSession["status"],
      stats: JSON.parse(row.statsJson),
      metaReviewCritique: row.metaReviewCritique ?? null,
      researchOverview: row.researchOverview ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt ?? null,
    };
  }

  private _rowToFeedback(row: Record<string, unknown>): ExperimentalFeedback {
    return {
      id:               row.id as string,
      hypothesisId:     row.hypothesis_id as string,
      sessionId:        row.session_id as string,
      feedbackText:     row.feedback_text as string,
      noveltyScore:     row.novelty_score != null ? (row.novelty_score as number) : undefined,
      correctnessScore: row.correctness_score != null ? (row.correctness_score as number) : undefined,
      testabilityScore: row.testability_score != null ? (row.testability_score as number) : undefined,
      metadata:         JSON.parse((row.metadata_json as string) ?? "{}"),
      computedReward:   row.computed_reward as number,
      recordedBy:       (row.recorded_by as "human" | "automated") ?? "human",
      createdAt:        new Date((row.created_at as number) * 1000),
    };
  }

  private _rowToHypothesis(row: typeof schema.hypotheses.$inferSelect): Hypothesis {
    const countRow = this.sqlite
      .query(`SELECT count(*) as n FROM experimental_feedback WHERE hypothesis_id = ?`)
      .get(row.id) as { n: number } | undefined;
    return {
      id: row.id,
      sessionId: row.sessionId,
      title: row.title,
      summary: row.summary,
      content: row.content,
      rationale: row.rationale,
      experimentalPlan: row.experimentalPlan ?? undefined,
      noveltyAssessment: row.noveltyAssessment ?? undefined,
      keyAssumptions: JSON.parse(row.keyAssumptionsJson),
      citations: JSON.parse(row.citationsJson),
      generationStrategy: row.generationStrategy,
      eloRating: row.eloRating,
      ratingDeviation: row.ratingDeviation ?? 350,
      volatility:      row.volatility      ?? 0.06,
      matchesPlayed: row.matchesPlayed,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws ?? 0,
      status: row.status as Hypothesis["status"],
      parentIds: JSON.parse(row.parentIdsJson),
      generationRound: row.generationRound,
      feedbackCount: Number(countRow?.n ?? 0),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Batch feedback count — avoids N+1 when converting multiple hypothesis rows.
   */
  private _getFeedbackCounts(hypothesisIds: string[]): Map<string, number> {
    if (hypothesisIds.length === 0) return new Map();
    const placeholders = hypothesisIds.map(() => "?").join(",");
    const rows = this.sqlite
      .query(
        `SELECT hypothesis_id, count(*) as n FROM experimental_feedback WHERE hypothesis_id IN (${placeholders}) GROUP BY hypothesis_id`
      )
      .all(...hypothesisIds) as Array<{ hypothesis_id: string; n: number }>;
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.hypothesis_id, Number(r.n));
    return map;
  }

  /**
   * Batch convert hypothesis rows with pre-fetched feedback counts (avoids N+1).
   */
  private _rowsToHypotheses(rows: Array<typeof schema.hypotheses.$inferSelect>): Hypothesis[] {
    const ids = rows.map((r) => r.id);
    const counts = this._getFeedbackCounts(ids);
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      title: row.title,
      summary: row.summary,
      content: row.content,
      rationale: row.rationale,
      experimentalPlan: row.experimentalPlan ?? undefined,
      noveltyAssessment: row.noveltyAssessment ?? undefined,
      keyAssumptions: JSON.parse(row.keyAssumptionsJson),
      citations: JSON.parse(row.citationsJson),
      generationStrategy: row.generationStrategy,
      eloRating: row.eloRating,
      ratingDeviation: row.ratingDeviation ?? 350,
      volatility:      row.volatility      ?? 0.06,
      matchesPlayed: row.matchesPlayed,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws ?? 0,
      status: row.status as Hypothesis["status"],
      parentIds: JSON.parse(row.parentIdsJson),
      generationRound: row.generationRound,
      feedbackCount: counts.get(row.id) ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }
}

// Singleton
let _store: ContextStore | null = null;
export function getContextStore(): ContextStore {
  if (!_store) _store = new ContextStore();
  return _store;
}

/** Reset singleton (for test isolation). */
export function resetContextStore(): void {
  _store = null;
}
