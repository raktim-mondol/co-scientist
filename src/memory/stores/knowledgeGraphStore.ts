// Knowledge-graph store — concept/citation/hypothesis graph persistence.
// Extracted from ContextStore (Phase 2 facade split).

import { eq } from "drizzle-orm";
import { getDb, schema } from "../../db/index.js";

export class KnowledgeGraphStore {
  private db = getDb();

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
}