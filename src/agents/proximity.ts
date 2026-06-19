import { BaseAgent } from "./base.js";
import { cosineSimilarity } from "../util/vector.js";

// all-MiniLM-L6-v2 produces 384-dimensional vectors normalised to unit length,
// so cosine similarity = 1 - (L2 distance² / 2).  sqlite-vec reports L2 distance.
function l2DistanceToCosine(l2: number): number {
  // cos_sim = 1 - (l2² / 2)  for unit-norm vectors
  return 1 - (l2 * l2) / 2;
}

const DUPLICATE_THRESHOLD = 0.92;
const EDGE_THRESHOLD = 0.70;

export class ProximityAgent extends BaseAgent {
  get agentName() { return "Proximity"; }

  async execute(sessionId: string): Promise<void> {
    const hypotheses = this.memory.getAllActiveHypotheses(sessionId);
    if (hypotheses.length < 2) return;

    this.log("info", `Computing proximity for ${hypotheses.length} hypotheses`);

    // ── Phase 1: ensure every hypothesis has an embedding ──────────────────────
    const embeddings: Map<string, number[]> = new Map();

    // Collect hypotheses that need embedding so we can batch the LLM call.
    const needsEmbed: Array<{ id: string; text: string }> = [];
    for (const hyp of hypotheses) {
      const cached = this.memory.getEmbedding(hyp.id);
      if (cached) {
        embeddings.set(hyp.id, cached);
      } else {
        needsEmbed.push({ id: hyp.id, text: `${hyp.title}. ${hyp.summary}` });
      }
    }

    if (needsEmbed.length > 0) {
      const results = await this.llm.embed(needsEmbed.map((h) => h.text));
      for (let i = 0; i < needsEmbed.length; i++) {
        const embedding = results[i];
        // saveEmbedding writes to both embedding_cache (blob) AND vec_embeddings (vec0)
        this.memory.saveEmbedding(needsEmbed[i].id, embedding);
        embeddings.set(needsEmbed[i].id, embedding);
      }
    }

    // ── Phase 2: ANN-assisted pairwise similarity ──────────────────────────────
    // For each hypothesis, use sqlite-vec KNN to find the top-N nearest neighbours
    // instead of comparing against every other hypothesis.  We then verify the
    // exact cosine score only for candidate pairs returned by the index, which
    // keeps the work sub-quadratic as the hypothesis count grows.
    //
    // We still need an exact duplicate check (cosine ≥ 0.92), so we run ANN with
    // a generous limit and then apply the exact cosine on the short candidate list.

    const ANN_CANDIDATES = Math.min(hypotheses.length - 1, 30);
    let edgesAdded = 0;
    const seenPairs = new Set<string>();

    for (const hyp of hypotheses) {
      const queryEmbedding = embeddings.get(hyp.id);
      if (!queryEmbedding) continue;

      // KNN query returns the query vector itself at distance 0 — skip it
      const neighbours = this.memory.findSimilarByVector(queryEmbedding, ANN_CANDIDATES + 1);

      for (const { hypothesisId: otherId, distance } of neighbours) {
        if (otherId === hyp.id) continue;

        // Deduplicate pair (A,B) == (B,A)
        const pairKey = [hyp.id, otherId].sort().join("|");
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);

        // Convert L2 distance → cosine similarity for unit-norm MiniLM vectors
        const annScore = l2DistanceToCosine(distance);
        if (annScore < EDGE_THRESHOLD) continue;

        // Exact cosine verification (embeddings are already in memory)
        const embB = embeddings.get(otherId);
        const score = embB ? cosineSimilarity(queryEmbedding, embB) : annScore;

        if (score >= EDGE_THRESHOLD) {
          this.memory.saveProximityEdge(sessionId, hyp.id, otherId, score);
          edgesAdded++;

          if (score >= DUPLICATE_THRESHOLD) {
            const other = hypotheses.find((h) => h.id === otherId);
            this.log(
              "info",
              `Near-duplicate detected: "${hyp.title}" ≈ "${other?.title ?? otherId}" (${score.toFixed(3)})`
            );
            // Reject the lower-Elo duplicate and remove it from the in-memory
            // embeddings map so subsequent iterations don't process it further.
            if (hyp.eloRating < (other?.eloRating ?? Infinity)) {
              this.memory.updateHypothesisStatus(hyp.id, "rejected");
              this.memory.deleteEmbedding(hyp.id);
              embeddings.delete(hyp.id);
              break; // hyp is rejected — stop processing its neighbours
            } else {
              this.memory.updateHypothesisStatus(otherId, "rejected");
              this.memory.deleteEmbedding(otherId);
              embeddings.delete(otherId);
              continue; // skip edge save for rejected pair
            }
          }
        }
      }
    }

    this.log("info", `Proximity graph updated: ${edgesAdded} edges added`);
  }
}
