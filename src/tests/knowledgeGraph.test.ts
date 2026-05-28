/**
 * Knowledge Graph Agent — Unit Tests
 *
 * Tests graph construction (nodes + edges), unexplored concept detection,
 * and lineage traversal against a real (temp) SQLite database.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";

// ── Test DB isolation ─────────────────────────────────────────────────────────
const TEST_DIR = join(tmpdir(), `kg-test-${Date.now()}`);
mkdirSync(TEST_DIR, { recursive: true });
process.env.DB_PATH = join(TEST_DIR, "test.db");
process.env.DEEPSEEK_API_KEY = "stub-for-tests";

// Reset DB + store singletons so this file gets its own isolated DB
import { resetDb } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { getContextStore, resetContextStore } from "../memory/contextStore.js";
import { KnowledgeGraphAgent } from "../agents/knowledgeGraph.js";
import { resetConfig } from "../config.js";

let store: ReturnType<typeof getContextStore>;
let kg: KnowledgeGraphAgent;
let sessionId: string;

beforeAll(async () => {
  resetConfig();
  resetDb();
  resetContextStore();
  store = getContextStore();
  kg = new KnowledgeGraphAgent();
  await runMigrations();

  sessionId = uuidv4();
  // Seed session
  store["sqlite"].run(
    `INSERT INTO sessions (id,name,status,research_goal_json,stats_json,created_at,updated_at)
     VALUES ('${sessionId}','KG Test','completed','{}','{}',1,1)`
  );
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function addHypothesis(opts: {
  title: string;
  keyAssumptions?: string[];
  citations?: string[];
  parentIds?: string[];
  status?: string;
}) {
  return store.saveHypothesis({
    sessionId,
    title: opts.title,
    summary: opts.title,
    content: "content",
    rationale: "rationale",
    generationStrategy: "literature_exploration",
    eloRating: 1200,
    ratingDeviation: 350,
    volatility: 0.06,
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    status: (opts.status ?? "active") as "active",
    parentIds: opts.parentIds ?? [],
    generationRound: 1,
    keyAssumptions: opts.keyAssumptions ?? [],
    citations: opts.citations ?? [],
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("KnowledgeGraphAgent.execute", () => {
  it("creates hypothesis nodes for all active hypotheses", async () => {
    addHypothesis({ title: "Hyp A", keyAssumptions: ["Concept X"] });
    addHypothesis({ title: "Hyp B", keyAssumptions: ["Concept Y"] });

    await kg.execute(sessionId);

    const nodes = store.getKgNodes(sessionId);
    const hypNodes = nodes.filter((n) => n.type === "hypothesis");
    expect(hypNodes.length).toBeGreaterThanOrEqual(2);
  });

  it("creates concept nodes from keyAssumptions", async () => {
    const nodes = store.getKgNodes(sessionId);
    const conceptNodes = nodes.filter((n) => n.type === "concept");
    const labels = conceptNodes.map((n) => n.label);
    expect(labels).toContain("Concept X");
    expect(labels).toContain("Concept Y");
  });

  it("creates supports edges from hypothesis to concept", async () => {
    const edges = store.getKgEdges(sessionId);
    const supportsEdges = edges.filter((e) => e.relation === "supports");
    expect(supportsEdges.length).toBeGreaterThanOrEqual(2);
  });

  it("creates citation nodes", async () => {
    addHypothesis({ title: "Hyp C", citations: ["Smith et al. 2024"] });
    await kg.execute(sessionId);

    const nodes = store.getKgNodes(sessionId);
    const citeNodes = nodes.filter((n) => n.type === "citation");
    expect(citeNodes.map((n) => n.label)).toContain("Smith et al. 2024");
  });

  it("creates evolved_from edges from parentIds", async () => {
    const parent = addHypothesis({ title: "Parent Hyp" });
    addHypothesis({ title: "Child Hyp", parentIds: [parent.id] });
    await kg.execute(sessionId);

    const edges = store.getKgEdges(sessionId);
    const evolvedEdges = edges.filter((e) => e.relation === "evolved_from");
    expect(evolvedEdges.length).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent — running twice does not duplicate nodes", async () => {
    const nodesBefore = store.getKgNodes(sessionId).length;
    await kg.execute(sessionId);
    const nodesAfter = store.getKgNodes(sessionId).length;
    expect(nodesAfter).toBe(nodesBefore);
  });
});

describe("KnowledgeGraphAgent.getUnexploredConcepts", () => {
  it("returns concepts not covered by any active hypothesis", async () => {
    // Add a hypothesis with a unique concept, then reject it
    const h = addHypothesis({
      title: "Rejected Hyp",
      keyAssumptions: ["Orphan Concept Z"],
      status: "active",
    });
    await kg.execute(sessionId);

    // Now reject it so the concept becomes orphaned
    store.updateHypothesisStatus(h.id, "rejected");

    const unexplored = kg.getUnexploredConcepts(sessionId, 50);
    expect(unexplored).toContain("Orphan Concept Z");
  });

  it("does not return concepts covered by active hypotheses", () => {
    const unexplored = kg.getUnexploredConcepts(sessionId, 50);
    // "Concept X" is covered by active "Hyp A"
    expect(unexplored).not.toContain("Concept X");
  });

  it("respects the limit parameter", () => {
    const unexplored = kg.getUnexploredConcepts(sessionId, 1);
    expect(unexplored.length).toBeLessThanOrEqual(1);
  });
});

describe("KnowledgeGraphAgent.getLineage", () => {
  it("returns ancestry chain from root to target", async () => {
    const root = addHypothesis({ title: "Lineage Root" });
    const mid = addHypothesis({ title: "Lineage Mid", parentIds: [root.id] });
    const leaf = addHypothesis({ title: "Lineage Leaf", parentIds: [mid.id] });
    await kg.execute(sessionId);

    const chain = kg.getLineage(sessionId, leaf.id);
    expect(chain.length).toBe(3);
    expect(chain[0].title).toBe("Lineage Root");
    expect(chain[1].title).toBe("Lineage Mid");
    expect(chain[2].title).toBe("Lineage Leaf");
  });

  it("returns single-element chain for root hypothesis", async () => {
    const root = addHypothesis({ title: "Solo Root" });
    await kg.execute(sessionId);

    const chain = kg.getLineage(sessionId, root.id);
    expect(chain.length).toBe(1);
    expect(chain[0].title).toBe("Solo Root");
  });
});
