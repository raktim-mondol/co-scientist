import { createHash } from "crypto";
import { BaseAgent } from "./base.js";

/**
 * Builds and maintains a deterministic knowledge graph from existing session data.
 *
 * Node types:  hypothesis | concept | citation
 * Edge types:  evolved_from | related_to | supports | contradicts
 *
 * All edges are derived without LLM calls:
 *   - evolved_from  : hypothesis.parentIds
 *   - related_to    : proximityEdges with score ≥ 0.7
 *   - supports      : hypothesis → concept node for each keyAssumption
 *   - contradicts   : review verdict="fail" → hypothesis node (concept-level)
 */
export class KnowledgeGraphAgent extends BaseAgent {
  get agentName() { return "KnowledgeGraph"; }

  /** Rebuild the full graph for a session (idempotent — uses deterministic IDs). */
  async execute(sessionId: string): Promise<void> {
    const hypotheses = this.memory.getAllActiveHypotheses(sessionId);
    if (hypotheses.length === 0) return;

    // Deterministic IDs mean upsert handles dedup — no need to pre-fetch existing edges.

    // ── 1. Hypothesis nodes ──────────────────────────────────────────────────
    for (const h of hypotheses) {
      const nodeId = this._nodeId("hypothesis", h.id);
      this.memory.upsertKgNode(nodeId, sessionId, "hypothesis", h.title, h.id);
    }

    // ── 2. Concept nodes + supports edges (from keyAssumptions) ─────────────
    for (const h of hypotheses) {
      const hypNodeId = this._nodeId("hypothesis", h.id);
      for (const assumption of h.keyAssumptions) {
        const conceptId = this._nodeId("concept", assumption);
        this.memory.upsertKgNode(conceptId, sessionId, "concept", assumption);
        this.memory.upsertKgEdge(
          this._edgeId(hypNodeId, conceptId, "supports"),
          sessionId, hypNodeId, conceptId, "supports"
        );
      }
    }

    // ── 3. Citation nodes (from citations array) ─────────────────────────────
    for (const h of hypotheses) {
      const hypNodeId = this._nodeId("hypothesis", h.id);
      for (const cite of h.citations) {
        const citeId = this._nodeId("citation", cite);
        this.memory.upsertKgNode(citeId, sessionId, "citation", cite);
        this.memory.upsertKgEdge(
          this._edgeId(hypNodeId, citeId, "supports"),
          sessionId, hypNodeId, citeId, "supports"
        );
      }
    }

    // ── 4. evolved_from edges (from parentIds) ───────────────────────────────
    for (const h of hypotheses) {
      const childNodeId = this._nodeId("hypothesis", h.id);
      for (const parentId of h.parentIds) {
        const parentNodeId = this._nodeId("hypothesis", parentId);
        this.memory.upsertKgEdge(
          this._edgeId(childNodeId, parentNodeId, "evolved_from"),
          sessionId, childNodeId, parentNodeId, "evolved_from"
        );
      }
    }

    // ── 5. related_to edges (from proximity, score ≥ 0.7) ───────────────────
    for (const h of hypotheses) {
      const similar = this.memory.getSimilarHypotheses(h.id, 10);
      for (const otherId of similar) {
        // Only add if the other hypothesis is active (node exists)
        const otherHyp = hypotheses.find((x) => x.id === otherId);
        if (!otherHyp) continue;
        const aId = this._nodeId("hypothesis", h.id);
        const bId = this._nodeId("hypothesis", otherId);
        // Use canonical order to avoid duplicate A→B and B→A edges
        const [from, to] = aId < bId ? [aId, bId] : [bId, aId];
        this.memory.upsertKgEdge(
          this._edgeId(from, to, "related_to"),
          sessionId, from, to, "related_to"
        );
      }
    }

    this.log("info", `Graph updated: ${hypotheses.length} hypotheses processed`);
  }

  /**
   * Returns concept labels not covered by any currently active hypothesis.
   * A concept is "unexplored" if it exists in the graph (from a rejected,
   * evolved-away, or cross-pollinated hypothesis) but no active hypothesis
   * has it as a keyAssumption. Used by GenerationAgent.research_expansion.
   */
  getUnexploredConcepts(sessionId: string, limit = 10): string[] {
    const nodes = this.memory.getKgNodes(sessionId);
    const edges = this.memory.getKgEdges(sessionId);

    // Active hypothesis node IDs
    const activeHypotheses = this.memory.getAllActiveHypotheses(sessionId);
    const activeHypNodeIds = new Set(
      activeHypotheses.map((h) => this._nodeId("hypothesis", h.id))
    );

    // Concept node IDs covered by at least one ACTIVE hypothesis via "supports"
    const coveredConceptIds = new Set(
      edges
        .filter((e) => e.relation === "supports" && activeHypNodeIds.has(e.fromNodeId))
        .map((e) => e.toNodeId)
    );

    // Concepts that exist in the graph but are not covered by any active hypothesis
    return nodes
      .filter((n) => n.type === "concept" && !coveredConceptIds.has(n.id))
      .map((n) => n.label)
      .slice(0, limit);
  }

  /**
   * Returns the lineage chain for a hypothesis: list of {id, title, strategy} from root to leaf.
   */
  getLineage(sessionId: string, hypothesisId: string): Array<{ id: string; title: string; strategy: string }> {
    const nodes = this.memory.getKgNodes(sessionId);
    const edges = this.memory.getKgEdges(sessionId);

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const evolvedFromEdges = edges.filter((e) => e.relation === "evolved_from");

    const chain: Array<{ id: string; title: string; strategy: string }> = [];
    let currentNodeId = this._nodeId("hypothesis", hypothesisId);

    const visited = new Set<string>();
    while (currentNodeId && !visited.has(currentNodeId)) {
      visited.add(currentNodeId);
      const node = nodeById.get(currentNodeId);
      if (!node || !node.hypothesisId) break;

      const hyp = this.memory.getHypothesis(node.hypothesisId);
      if (!hyp) break;
      chain.unshift({ id: hyp.id, title: hyp.title, strategy: hyp.generationStrategy });

      const parentEdge = evolvedFromEdges.find((e) => e.fromNodeId === currentNodeId);
      currentNodeId = parentEdge?.toNodeId ?? "";
    }

    return chain;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Deterministic node ID: sha1(type:value) truncated to 16 chars */
  private _nodeId(type: string, value: string): string {
    return createHash("sha1").update(`${type}:${value}`).digest("hex").slice(0, 16);
  }

  /** Deterministic edge ID: sha1(from:to:relation) */
  private _edgeId(from: string, to: string, relation: string): string {
    return createHash("sha1").update(`${from}:${to}:${relation}`).digest("hex").slice(0, 16);
  }
}
