// Manuscript store — cached publishable-report persistence (one per session).
// Extracted from ContextStore (facade split), mirrors the other domain stores.

import { eq } from "drizzle-orm";
import { getDb, schema } from "../../db/index.js";
import type { Manuscript } from "../../models/manuscript.js";

export class ManuscriptStore {
  private db = getDb();

  /** Upsert the cached manuscript for a session. */
  saveManuscript(sessionId: string, manuscript: Manuscript): void {
    const json = JSON.stringify(manuscript);
    const now = new Date();
    this.db
      .insert(schema.manuscripts)
      .values({ sessionId, json, createdAt: now })
      .onConflictDoUpdate({
        target: schema.manuscripts.sessionId,
        set: { json, createdAt: now },
      })
      .run();
  }

  getManuscript(sessionId: string): Manuscript | null {
    const row = this.db
      .select()
      .from(schema.manuscripts)
      .where(eq(schema.manuscripts.sessionId, sessionId))
      .get();
    if (!row) return null;
    try {
      return JSON.parse(row.json) as Manuscript;
    } catch {
      return null;
    }
  }
}
