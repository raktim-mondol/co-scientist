// Provenance store — claim citations and citation-verification integrity.
// Extracted from ContextStore (Phase 2 facade split).

import { eq, and, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb, getSqlite, schema } from "../../db/index.js";

export class ProvenanceStore {
  private db = getDb();
  private sqlite = getSqlite();

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
}