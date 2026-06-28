// Evidence store — Deep Evidence Pipeline source bank with embedding similarity.
// Extracted from ContextStore (Phase 2 facade split).

import { eq, desc, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb, schema } from "../../db/index.js";
import type { EvidenceSource } from "../../models/evidence.js";
import { cosineSimilarity } from "../../util/vector.js";

export class EvidenceStore {
  private db = getDb();

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
      )).get();
    if (!row) throw new Error(`saveEvidence: upsert failed for ${ev.url}`);
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
}