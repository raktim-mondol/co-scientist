// Session store — session lifecycle, research-goal/plan/overview persistence,
// and the cascading delete that spans all child tables.
// Extracted from ContextStore (Phase 2 facade split).

import { eq, desc, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb, getSqlite, withRetry, schema } from "../../db/index.js";
import type { CoScientistSession, SessionStats } from "../../models/session.js";
import type { ResearchGoal, ResearchPlanConfig } from "../../models/researchGoal.js";

export class SessionStore {
  private db = getDb();
  private sqlite = getSqlite();

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

  /**
   * Resolve a session by UUID, partial UUID, or name. Returns the session or null.
   * Tries: exact UUID → partial UUID prefix → case-insensitive name.
   */
  resolveSession(identifier: string): CoScientistSession | null {
    // Try exact UUID first
    const byId = this.getSession(identifier);
    if (byId) return byId;

    // Try partial UUID prefix match (min 4 chars to avoid false positives)
    if (identifier.length >= 4 && /^[\da-f-]+$/i.test(identifier)) {
      const rows = this.db
        .select()
        .from(schema.sessions)
        .where(sql`${schema.sessions.id} LIKE ${identifier + "%"}`)
        .orderBy(desc(schema.sessions.createdAt))
        .all();
      if (rows.length === 1) return this._rowToSession(rows[0]);
      // Multiple prefix matches — ambiguous, fall through to name match
    }

    // Try by name (case-insensitive, most recent first)
    const rows = this.db
      .select()
      .from(schema.sessions)
      .where(sql`lower(${schema.sessions.name}) = lower(${identifier})`)
      .orderBy(desc(schema.sessions.createdAt))
      .all();
    if (rows.length === 0) return null;
    return this._rowToSession(rows[0]);
  }

  /**
   * Mark sessions stuck in "running" or "initializing" for >24h as "interrupted".
   * Returns the count of cleaned-up sessions.
   */
  cleanupStaleSessions(): number {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const stmt = this.sqlite.query(
      `UPDATE sessions SET status = 'interrupted', updated_at = ?1
       WHERE status IN ('running', 'initializing') AND updated_at < ?2`
    );
    const result = stmt.run(new Date().toISOString(), cutoff.toISOString()) as unknown as { changes: number };
    return result.changes ?? 0;
  }

  getResearchGoal(sessionId: string): ResearchGoal | null {
    const row = this.db
      .select({ researchGoalJson: schema.sessions.researchGoalJson })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get();
    if (!row) return null;
    try { return JSON.parse(row.researchGoalJson) as ResearchGoal; } catch { return null; }
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
    // All child tables are deleted by sessionId in dependency order:
    // FKs to hypotheses first, then FKs to sessions, then hypotheses, then sessions.
    // This is both simpler and more robust than per-hypothesis iteration — it can't
    // miss orphan rows or hypotheses added between the SELECT and the DELETE.
    this.sqlite.transaction(() => {
      // ── Tables with FK to hypotheses (must be deleted before hypotheses) ──────
      // Also have sessionId FK — delete by sessionId so we hit every row for this
      // session regardless of hypothesis state.
      this.db.delete(schema.reviews).where(eq(schema.reviews.sessionId, id)).run();
      this.db.delete(schema.claimCitations).where(eq(schema.claimCitations.sessionId, id)).run();
      this.db.delete(schema.experimentalFeedback).where(eq(schema.experimentalFeedback.sessionId, id)).run();
      this.db.delete(schema.safetyAssessments).where(eq(schema.safetyAssessments.sessionId, id)).run();
      this.db.delete(schema.citationVerifications).where(eq(schema.citationVerifications.sessionId, id)).run();
      this.db.delete(schema.rewardMemory).where(eq(schema.rewardMemory.sessionId, id)).run();

      // tournament_matches and proximity_edges have hypothesis_a_id / hypothesis_b_id
      // FKs to hypotheses. Rows from OTHER sessions can reference hypotheses in THIS
      // session, so a plain DELETE BY sessionId is insufficient — we must also purge
      // cross-session references via hypothesis_id JOINs.
      this.db.delete(schema.tournamentMatches).where(eq(schema.tournamentMatches.sessionId, id)).run();
      this.sqlite.query(
        `DELETE FROM tournament_matches WHERE hypothesis_a_id IN (SELECT id FROM hypotheses WHERE session_id = ?) OR hypothesis_b_id IN (SELECT id FROM hypotheses WHERE session_id = ?)`,
      ).run(id, id);
      this.db.delete(schema.proximityEdges).where(eq(schema.proximityEdges.sessionId, id)).run();
      this.sqlite.query(
        `DELETE FROM proximity_edges WHERE hypothesis_a_id IN (SELECT id FROM hypotheses WHERE session_id = ?) OR hypothesis_b_id IN (SELECT id FROM hypotheses WHERE session_id = ?)`,
      ).run(id, id);

      // Tables that have an FK to hypotheses but NO sessionId column — delete by
      // hypothesis_id via a JOIN so we don't need to select individual IDs.
      this.sqlite.query(
        `DELETE FROM vec_embeddings WHERE hypothesis_id IN (SELECT id FROM hypotheses WHERE session_id = ?)`,
      ).run(id);
      this.sqlite.query(
        `DELETE FROM embedding_cache WHERE hypothesis_id IN (SELECT id FROM hypotheses WHERE session_id = ?)`,
      ).run(id);

      // ── Tables with FK to sessions only (no hypothesis FK) ────────────────────
      this.db.delete(schema.sessionActivity).where(eq(schema.sessionActivity.sessionId, id)).run();
      this.db.delete(schema.kgEdges).where(eq(schema.kgEdges.sessionId, id)).run();
      this.db.delete(schema.kgNodes).where(eq(schema.kgNodes.sessionId, id)).run();
      this.db.delete(schema.evidenceSources).where(eq(schema.evidenceSources.sessionId, id)).run();
      this.db.delete(schema.agentTasks).where(eq(schema.agentTasks.sessionId, id)).run();

      // ── Parent tables ─────────────────────────────────────────────────────────
      this.db.delete(schema.hypotheses).where(eq(schema.hypotheses.sessionId, id)).run();
      this.db.delete(schema.sessions).where(eq(schema.sessions.id, id)).run();
    })();
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
    try { return JSON.parse(row.config) as ResearchPlanConfig; } catch { return null; }
  }

  private _rowToSession(row: typeof schema.sessions.$inferSelect): CoScientistSession {
    return {
      id: row.id,
      name: row.name,
      researchGoalId: (() => { try { return JSON.parse(row.researchGoalJson).id; } catch { return ""; } })(),
      status: row.status as CoScientistSession["status"],
      stats: (() => { try { return JSON.parse(row.statsJson); } catch { return {}; } })(),
      metaReviewCritique: row.metaReviewCritique ?? null,
      researchOverview: row.researchOverview ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt ?? null,
    };
  }
}