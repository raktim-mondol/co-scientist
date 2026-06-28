// Tournament store — Glicko-2 tournament matches and proximity edges.
// Extracted from ContextStore (Phase 2 facade split).

import { eq, desc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb, getSqlite, schema } from "../../db/index.js";
import type { TournamentMatch } from "../../models/tournament.js";

export class TournamentStore {
  private db = getDb();
  private sqlite = getSqlite();

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
}