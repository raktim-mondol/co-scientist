// Hypothesis store — hypothesis CRUD, Glicko-2 atomic updates, experiment
// protocol, and the batch feedback-count helpers used to convert rows without
// N+1 queries. Extracted from ContextStore (Phase 2 facade split).

import { eq, desc, and, sql, asc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb, getSqlite, withRetry, schema } from "../../db/index.js";
import type { Hypothesis } from "../../models/hypothesis.js";

export class HypothesisStore {
  private db = getDb();
  private sqlite = getSqlite();

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

  /**
   * Atomic dual Glicko-2 update for a match between two hypotheses.
   * Reads BOTH hypotheses' pre-match state inside a single transaction,
   * computes BOTH updates from the same snapshot, and writes both back.
   * This ensures the zero-sum invariant: newA + newB ≈ oldA + oldB.
   */
  atomicDualGlicko2Update(
    idA: string,
    idB: string,
    compute: (
      stateA: { rating: number; rd: number; volatility: number; wins: number; losses: number; draws: number; matchesPlayed: number },
      stateB: { rating: number; rd: number; volatility: number; wins: number; losses: number; draws: number; matchesPlayed: number }
    ) => {
      newA: { rating: number; rd: number; volatility: number; wins: number; losses: number; draws: number; matchesPlayed: number };
      newB: { rating: number; rd: number; volatility: number; wins: number; losses: number; draws: number; matchesPlayed: number };
    }
  ): void {
    this.sqlite.transaction(() => {
      const hypA = this.getHypothesis(idA);
      const hypB = this.getHypothesis(idB);
      if (!hypA || !hypB) return;
      const stateA = {
        rating: hypA.eloRating, rd: hypA.ratingDeviation ?? 350, volatility: hypA.volatility ?? 0.06,
        wins: hypA.wins, losses: hypA.losses, draws: hypA.draws ?? 0, matchesPlayed: hypA.matchesPlayed,
      };
      const stateB = {
        rating: hypB.eloRating, rd: hypB.ratingDeviation ?? 350, volatility: hypB.volatility ?? 0.06,
        wins: hypB.wins, losses: hypB.losses, draws: hypB.draws ?? 0, matchesPlayed: hypB.matchesPlayed,
      };
      const { newA, newB } = compute(stateA, stateB);
      this.updateHypothesisRating(idA, newA.rating, newA.rd, newA.volatility, newA.wins, newA.losses, newA.matchesPlayed, newA.draws);
      this.updateHypothesisRating(idB, newB.rating, newB.rd, newB.volatility, newB.wins, newB.losses, newB.matchesPlayed, newB.draws);
    })();
  }

  updateHypothesisStatus(id: string, status: string): void {
    this.db
      .update(schema.hypotheses)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.hypotheses.id, id))
      .run();
  }

  /** Reset hypotheses stuck in "reviewing" from a previous crash back to "pending_review". */
  resetStuckReviewingHypotheses(sessionId: string): void {
    this.db
      .update(schema.hypotheses)
      .set({ status: "pending_review", updatedAt: new Date() })
      .where(
        and(
          eq(schema.hypotheses.sessionId, sessionId),
          eq(schema.hypotheses.status, "reviewing")
        )
      )
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

  /**
   * Lightweight batch lookup — returns minimal hypothesis data without the
   * N+1 feedback count subquery.  Used by the diversity gate in GenerationAgent
   * where only status and eloRating are needed (up to 20 calls per generation).
   */
  getHypothesisStatusAndElo(id: string): { sessionId: string; status: string; eloRating: number } | null {
    const row = this.db
      .select({ sessionId: schema.hypotheses.sessionId, status: schema.hypotheses.status, eloRating: schema.hypotheses.eloRating })
      .from(schema.hypotheses)
      .where(eq(schema.hypotheses.id, id))
      .get();
    if (!row) return null;
    return { sessionId: row.sessionId, status: row.status, eloRating: row.eloRating };
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

  /** Lightweight: fetch only Elo ratings for the top N active hypotheses. */
  getTopEloRatings(sessionId: string, n = 10): number[] {
    const rows = this.db
      .select({ eloRating: schema.hypotheses.eloRating })
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
    return rows.map((r) => r.eloRating);
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
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(row.proto) as Record<string, unknown>; } catch { return null; }
    const hasContent = parsed.overview || (Array.isArray(parsed.steps) && (parsed.steps as unknown[]).length > 0);
    if (!hasContent) return null;
    return parsed;
  }

  // ─── Row converters (shared with SafetyStore) ────────────────────────────

  /** Convert a single hypothesis row, fetching its feedback count inline. */
  _rowToHypothesis(row: typeof schema.hypotheses.$inferSelect): Hypothesis {
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
      keyAssumptions: (() => { try { return JSON.parse(row.keyAssumptionsJson); } catch { return []; } })(),
      citations: (() => { try { return JSON.parse(row.citationsJson); } catch { return []; } })(),
      generationStrategy: row.generationStrategy,
      eloRating: row.eloRating,
      ratingDeviation: row.ratingDeviation ?? 350,
      volatility:      row.volatility      ?? 0.06,
      matchesPlayed: row.matchesPlayed,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws ?? 0,
      status: row.status as Hypothesis["status"],
      parentIds: (() => { try { return JSON.parse(row.parentIdsJson); } catch { return []; } })(),
      generationRound: row.generationRound,
      feedbackCount: Number(countRow?.n ?? 0),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Batch feedback count — avoids N+1 when converting multiple hypothesis rows. */
  _getFeedbackCounts(hypothesisIds: string[]): Map<string, number> {
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

  /** Batch convert hypothesis rows with pre-fetched feedback counts (avoids N+1). */
  _rowsToHypotheses(rows: Array<typeof schema.hypotheses.$inferSelect>): Hypothesis[] {
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
      keyAssumptions: (() => { try { return JSON.parse(row.keyAssumptionsJson); } catch { return []; } })(),
      citations: (() => { try { return JSON.parse(row.citationsJson); } catch { return []; } })(),
      generationStrategy: row.generationStrategy,
      eloRating: row.eloRating,
      ratingDeviation: row.ratingDeviation ?? 350,
      volatility:      row.volatility      ?? 0.06,
      matchesPlayed: row.matchesPlayed,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws ?? 0,
      status: row.status as Hypothesis["status"],
      parentIds: (() => { try { return JSON.parse(row.parentIdsJson); } catch { return []; } })(),
      generationRound: row.generationRound,
      feedbackCount: counts.get(row.id) ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }
}