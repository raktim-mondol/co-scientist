/**
 * RLEF Task 7 — Cross-Session Semantic Memory
 *
 * RewardStore persists strong-signal experimental feedback to `reward_memory`
 * and retrieves relevant priors for new sessions via embedding similarity over
 * the existing `vec_embeddings` / `embedding_cache` infrastructure.
 */
import { getContextStore } from "../memory/contextStore.js";
import { getDeepSeekClient } from "../llm/deepseek.js";
import { getSqlite } from "../db/index.js";
import type { ExperimentalFeedback } from "../models/feedback.js";
import type { RewardMemory } from "../models/feedback.js";
import type { Hypothesis } from "../models/hypothesis.js";

// Only promote feedback with |reward| above this threshold to reward_memory.
const STRONG_SIGNAL_THRESHOLD = 0.3;

// Stop-words to skip during keyword extraction.
const STOP_WORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with",
  "is","are","was","were","be","been","being","have","has","had","do","does",
  "did","will","would","could","should","may","might","this","that","these",
  "those","it","its","we","our","they","their","not","no","by","from","as",
]);

export class RewardStore {
  private memory = getContextStore();
  private llm = getDeepSeekClient();
  private sqlite = getSqlite();

  /**
   * Extract simple keywords from text (words ≥ 4 chars, not stop-words).
   */
  extractKeywords(text: string): string[] {
    return [...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
        .slice(0, 20)
    )];
  }

  /**
   * Persist a strong-signal feedback entry to `reward_memory` and ensure the
   * hypothesis embedding is stored in `vec_embeddings` for future ANN queries.
   *
   * No-ops silently when |reward| ≤ STRONG_SIGNAL_THRESHOLD.
   */
  async recordFeedback(
    feedback: ExperimentalFeedback,
    hypothesis: Hypothesis
  ): Promise<void> {
    if (Math.abs(feedback.computedReward) <= STRONG_SIGNAL_THRESHOLD) return;

    // Ensure embedding exists for this hypothesis (reuse if already stored).
    if (!this.memory.getEmbedding(hypothesis.id)) {
      const text = `${hypothesis.title}. ${hypothesis.summary}`;
      const [embedding] = await this.llm.embed([text]);
      this.memory.saveEmbedding(hypothesis.id, embedding);
    }

    const keywords = this.extractKeywords(feedback.feedbackText);
    const summary = feedback.feedbackText.slice(0, 200);

    this.sqlite.query(`
      INSERT OR IGNORE INTO reward_memory
        (id, hypothesis_id, session_id, feedback_summary,
         mechanistic_keywords, computed_reward, embedding_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      feedback.id,             // use feedback.id so re-submission is idempotent
      feedback.hypothesisId,
      feedback.sessionId,
      summary,
      JSON.stringify(keywords),
      feedback.computedReward,
      hypothesis.id,          // embedding_id == hypothesis_id (same key space)
      Date.now(),
    );
  }

  /**
   * Retrieve the top-K reward memory entries most semantically similar to a
   * research goal, filtered to strong-signal entries (|reward| > threshold).
   *
   * Returns [] when no relevant priors exist or the embedding model is unavailable.
   */
  async getRelevantPriors(
    researchGoal: string,
    topK = 5
  ): Promise<RewardMemory[]> {
    // Embed the research goal
    let queryEmbedding: number[];
    try {
      [queryEmbedding] = await this.llm.embed([researchGoal]);
    } catch {
      return [];
    }

    // ANN search over vec_embeddings (same index used by ProximityAgent)
    const candidates = this.memory.findSimilarByVector(queryEmbedding, topK * 4);
    if (candidates.length === 0) return [];

    const ids = candidates.map((c) => `'${c.hypothesisId}'`).join(",");

    // Join with reward_memory, filter by strong signal, order by |reward| desc
    const rows = this.sqlite.query(`
      SELECT rm.*
      FROM reward_memory rm
      WHERE rm.embedding_id IN (${ids})
        AND ABS(rm.computed_reward) > ${STRONG_SIGNAL_THRESHOLD}
      ORDER BY ABS(rm.computed_reward) DESC
      LIMIT ${topK}
    `).all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id:                   r.id as string,
      hypothesisId:         r.hypothesis_id as string,
      sessionId:            r.session_id as string,
      feedbackSummary:      r.feedback_summary as string,
      mechanisticKeywords:  JSON.parse((r.mechanistic_keywords as string) ?? "[]"),
      computedReward:       r.computed_reward as number,
      embeddingId:          r.embedding_id as string,
      createdAt:            new Date(r.created_at as number),
    }));
  }
}

// Singleton
let _store: RewardStore | null = null;
export function getRewardStore(): RewardStore {
  if (!_store) _store = new RewardStore();
  return _store;
}
