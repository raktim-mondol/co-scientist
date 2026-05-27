/**
 * RLEF Task 6 — Prompt Injection
 *
 * Builds a structured text block from experimental feedback that can be
 * appended to agent prompts (generation, reflection, evolution) so the LLM
 * is aware of empirically validated / refuted hypotheses in the current session.
 */
import type { ExperimentalFeedback } from "../models/feedback.js";

/**
 * Extract a short mechanistic insight from free-text feedback.
 * Returns the first sentence that contains a keyword, or the first 120 chars.
 */
function extractInsight(text: string): string {
  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  const keywords = ["mechanism", "pathway", "inhibit", "activat", "reduc", "increas", "bind", "express", "regulat"];
  const hit = sentences.find((s) => keywords.some((k) => s.toLowerCase().includes(k)));
  return (hit ?? sentences[0] ?? text).slice(0, 120);
}

/**
 * Build the RLEF reinforcement block to inject into agent prompts.
 *
 * Groups feedback into:
 *   - VALIDATED  (reward > 0.3)
 *   - REFUTED    (reward < -0.3)
 *   - NEUTRAL    (|reward| ≤ 0.3) — omitted (low signal)
 *
 * Returns an empty string when there is no strong-signal feedback so callers
 * can safely append it without adding noise.
 */
export function buildRLEFMetaReviewBlock(feedbacks: ExperimentalFeedback[]): string {
  const validated = feedbacks.filter((f) => f.computedReward > 0.3);
  const refuted   = feedbacks.filter((f) => f.computedReward < -0.3);

  if (validated.length === 0 && refuted.length === 0) return "";

  const lines: string[] = [
    "",
    "## EXPERIMENTAL FEEDBACK (Reinforcement Signal)",
  ];

  if (validated.length > 0) {
    lines.push("", "### VALIDATED HYPOTHESES:");
    for (const f of validated) {
      const sign = `+${f.computedReward.toFixed(2)}`;
      lines.push(`- Hypothesis ${f.hypothesisId.slice(0, 8)}: ${f.feedbackText.slice(0, 120)} (reward: ${sign})`);
      lines.push(`  → Mechanistic insight: ${extractInsight(f.feedbackText)}`);
    }
  }

  if (refuted.length > 0) {
    lines.push("", "### REFUTED HYPOTHESES:");
    for (const f of refuted) {
      lines.push(`- Hypothesis ${f.hypothesisId.slice(0, 8)}: ${f.feedbackText.slice(0, 120)} (reward: ${f.computedReward.toFixed(2)})`);
      lines.push(`  → Avoid similar approaches`);
    }
  }

  return lines.join("\n");
}
