// Safety store — safety-gate assessments and quarantine release.
// Extracted from ContextStore (Phase 2 facade split).
//
// Depends on HypothesisStore for getHypothesis() and the batch _rowsToHypotheses
// converter: getQuarantinedHypotheses returns full Hypothesis objects, and
// releaseQuarantine re-checks hypothesis status inside its transaction.

import { eq, desc, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb, getSqlite, schema } from "../../db/index.js";
import type { Hypothesis } from "../../models/hypothesis.js";
import { HypothesisStore } from "./hypothesisStore.js";

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

export class SafetyStore {
  private db = getDb();
  private sqlite = getSqlite();
  private hypothesisStore: HypothesisStore;

  constructor(hypothesisStore: HypothesisStore) {
    this.hypothesisStore = hypothesisStore;
  }

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
    return this.hypothesisStore._rowsToHypotheses(rows);
  }

  /**
   * Release a quarantined hypothesis into the active pool (operator override).
   * Records who released it and why on its latest assessment row. Returns false
   * if the hypothesis is not currently quarantined.
   */
  releaseQuarantine(hypothesisId: string, overriddenBy: string, reason: string): boolean {
    const now = new Date();
    let released = false;
    this.sqlite.transaction(() => {
      // Check status inside the transaction to prevent TOCTOU race conditions
      const hyp = this.hypothesisStore.getHypothesis(hypothesisId);
      if (!hyp || hyp.status !== "quarantined") return;
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
      released = true;
    })();
    return released;
  }

  _rowToSafetyAssessment(r: typeof schema.safetyAssessments.$inferSelect): SafetyAssessmentRow {
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
}