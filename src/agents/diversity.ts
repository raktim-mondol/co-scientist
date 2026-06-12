/**
 * Diversity-aware generation helpers (feature #4).
 *
 * Pure, dependency-free decision logic for the save-time near-duplicate gate in
 * GenerationAgent. Kept separate from ProximityAgent (which owns post-hoc dedup
 * + the proximity_edges graph) so the two defences stay independent.
 */

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

/** Exact cosine similarity. Returns 0 on length mismatch / empty / zero-norm. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
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
