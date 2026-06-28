// Activity store — agent-task logging, token accounting, and session activity log.
// Extracted from ContextStore (Phase 2 facade split).

import { eq, and, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb, getSqlite, schema } from "../../db/index.js";
import type { AgentTask } from "../../models/agentTask.js";

export class ActivityStore {
  private db = getDb();
  private sqlite = getSqlite();

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

  /** Single query: count all completed tasks grouped by type. */
  countAllCompletedTasksByType(sessionId: string): Record<string, number> {
    const rows = this.db
      .select({
        type: schema.agentTasks.type,
        count: sql<number>`count(*)`,
      })
      .from(schema.agentTasks)
      .where(
        and(
          eq(schema.agentTasks.sessionId, sessionId),
          eq(schema.agentTasks.status, "completed")
        )
      )
      .groupBy(schema.agentTasks.type)
      .all();
    return Object.fromEntries(rows.map((r) => [r.type, Number(r.count ?? 0)]));
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
}