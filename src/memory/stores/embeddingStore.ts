// Embedding store — vector embeddings for hypothesis proximity/ANN search.
// Extracted from ContextStore (Phase 2 facade split). Uses the raw sqlite handle
// for the sqlite-vec vec0 virtual table (not supported by Drizzle ORM).

import { eq } from "drizzle-orm";
import { getDb, getSqlite, schema } from "../../db/index.js";

export class EmbeddingStore {
  private db = getDb();
  private sqlite = getSqlite();

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

  /** Remove a hypothesis's embedding from both cache and ANN index. */
  deleteEmbedding(hypothesisId: string): void {
    this.db.delete(schema.embeddingCache).where(eq(schema.embeddingCache.hypothesisId, hypothesisId)).run();
    this.sqlite.query(`DELETE FROM vec_embeddings WHERE hypothesis_id = ?`).run(hypothesisId);
  }

  /**
   * ANN search via sqlite-vec's vec0 KNN index.
   * Returns up to `limit` hypothesis IDs nearest to `queryEmbedding`,
   * along with their cosine distance (lower = more similar).
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
}