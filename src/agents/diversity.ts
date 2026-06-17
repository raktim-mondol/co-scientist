/**
 * Diversity-aware generation helper (feature #4).
 *
 * Pure, dependency-free decision logic for the save-time near-duplicate gate in
 * GenerationAgent. Kept separate from ProximityAgent (which owns post-hoc dedup
 * + the proximity_edges graph) so the two defences stay independent.
 */

import { cosineSimilarity } from "../util/vector.js";
// Re-export so existing imports from this module continue to work.
export { cosineSimilarity } from "../util/vector.js";

/** Number of ANN candidates to pull from the vec0 index before exact re-scoring. */
export const DIVERSITY_ANN_CANDIDATES = 20;

export interface NeighbourEmbedding {
  id: string;
  embedding: number[];
}

export interface DuplicateCheck {
  duplicate: boolean;
  nearestId?: string;
  score: number; // max cosine vs any neighbour, 0..1
}

/**
 * Decide whether `candidate` is a near-duplicate of any neighbour.
 * Returns the max cosine score and the nearest neighbour id. `duplicate` is
 * true when the max score is >= threshold (inclusive).
 */
export function isNearDuplicate(
  candidate: number[],
  neighbours: NeighbourEmbedding[],
  threshold: number
): DuplicateCheck {
  let best = 0;
  let bestId: string | undefined;
  for (const n of neighbours) {
    const score = cosineSimilarity(candidate, n.embedding);
    if (score > best) {
      best = score;
      bestId = n.id;
    }
  }
  return { duplicate: bestId !== undefined && best >= threshold, nearestId: bestId, score: best };
}
