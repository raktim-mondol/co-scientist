// Feedback store — RLEF experimental feedback persistence.
// Extracted from ContextStore (Phase 2 facade split).

import { getSqlite } from "../../db/index.js";
import type { ExperimentalFeedback } from "../../models/feedback.js";

export class FeedbackStore {
  private sqlite = getSqlite();

  saveExperimentalFeedback(feedback: ExperimentalFeedback): void {
    this.sqlite.query(`
      INSERT INTO experimental_feedback
        (id, hypothesis_id, session_id, feedback_text,
         novelty_score, correctness_score, testability_score,
         metadata_json, computed_reward, recorded_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      feedback.id,
      feedback.hypothesisId,
      feedback.sessionId,
      feedback.feedbackText,
      feedback.noveltyScore      ?? null,
      feedback.correctnessScore  ?? null,
      feedback.testabilityScore  ?? null,
      JSON.stringify(feedback.metadata ?? {}),
      feedback.computedReward,
      feedback.recordedBy,
      feedback.createdAt.getTime() / 1000,
    );
  }

  getExperimentalFeedback(hypothesisId: string): ExperimentalFeedback[] {
    const rows = this.sqlite.query(`
      SELECT * FROM experimental_feedback
      WHERE hypothesis_id = ?
      ORDER BY created_at DESC
    `).all(hypothesisId) as Array<Record<string, unknown>>;
    return rows.map(this._rowToFeedback);
  }

  getAllFeedbackForSession(sessionId: string): ExperimentalFeedback[] {
    const rows = this.sqlite.query(`
      SELECT * FROM experimental_feedback
      WHERE session_id = ?
      ORDER BY created_at DESC
    `).all(sessionId) as Array<Record<string, unknown>>;
    return rows.map(this._rowToFeedback);
  }

  private _rowToFeedback(row: Record<string, unknown>): ExperimentalFeedback {
    return {
      id:               row.id as string,
      hypothesisId:     row.hypothesis_id as string,
      sessionId:        row.session_id as string,
      feedbackText:     row.feedback_text as string,
      noveltyScore:     row.novelty_score != null ? (row.novelty_score as number) : undefined,
      correctnessScore: row.correctness_score != null ? (row.correctness_score as number) : undefined,
      testabilityScore: row.testability_score != null ? (row.testability_score as number) : undefined,
      metadata:         (() => { try { return JSON.parse((row.metadata_json as string) ?? "{}"); } catch { return {}; } })(),
      computedReward:   row.computed_reward as number,
      recordedBy:       (row.recorded_by as "human" | "automated") ?? "human",
      createdAt:        new Date((row.created_at as number) * 1000),
    };
  }
}