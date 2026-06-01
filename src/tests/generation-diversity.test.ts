import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";

const TEST_DIR = join(tmpdir(), `gen-diversity-test-${Date.now()}`);
mkdirSync(TEST_DIR, { recursive: true });
process.env.DB_PATH = join(TEST_DIR, "test.db");
process.env.DEEPSEEK_API_KEY = "stub-for-tests";

import { resetDb } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { getContextStore, resetContextStore } from "../memory/contextStore.js";
import { resetConfig, getConfig } from "../config.js";
import { GenerationAgent } from "../agents/generation.js";
import type { ContextStore } from "../memory/contextStore.js";

let store: ContextStore;
let sessionId: string;

// The vec0 ANN index is fixed at 384 dims, so neighbours/candidates must match.
// One-hot 384-dim vectors give us clean cosine: identical → 1, distinct → 0.
const EMBED_DIM = 384;
function oneHot(i: number): number[] {
  const v = new Array(EMBED_DIM).fill(0);
  v[i] = 1;
  return v;
}
const VEC_A = oneHot(0);
const VEC_ORTHOGONAL = oneHot(1);

function seedActive(embedding: number[], elo = 1300, status = "active"): string {
  const h = store.saveHypothesis({
    sessionId,
    title: "Existing", summary: "existing", content: "c", rationale: "r",
    generationStrategy: "literature_exploration",
    eloRating: elo, ratingDeviation: 200, volatility: 0.06,
    matchesPlayed: 0, wins: 0, losses: 0, draws: 0,
    status: status as any, parentIds: [], generationRound: 1,
    keyAssumptions: [], citations: [],
  });
  store.saveEmbedding(h.id, embedding);
  return h.id;
}

// Build a GenerationAgent whose strategy + embedding are stubbed so execute()
// exercises only the diversity gate + save path (no real LLM/search).
function makeAgent(candidateEmbedding: number[]): GenerationAgent {
  const agent = new GenerationAgent();
  // Stub the candidate embedding the gate will compute.
  (agent as any).llm = { embed: async () => [candidateEmbedding] };
  // Force a deterministic strategy + parsed hypothesis.
  (agent as any)._selectStrategy = () => "literature_exploration";
  (agent as any)._literatureExploration = async () => ({
    title: "Candidate", summary: "candidate", content: "c", rationale: "r",
    keyAssumptions: [], citations: [],
  });
  return agent;
}

beforeAll(async () => {
  resetConfig();
  resetDb();
  resetContextStore();
  store = getContextStore();
  await runMigrations();
});

beforeEach(() => {
  sessionId = uuidv4();
  store["sqlite"].run(
    `INSERT INTO sessions (id,name,status,research_goal_json,stats_json,created_at,updated_at)
     VALUES ('${sessionId}','Div Test','running','{}','{}',1,1)`
  );
  // Plan config is required by execute(); save a minimal one.
  store.savePlanConfig(sessionId, {
    parsedTitle: "T", parsedDomain: "D", parsedKeywords: ["k"],
    hypothesisAttributes: ["Novel"], evaluationRubric: "r",
    searchQueries: ["q"], constraints: {} as any, evaluationCriteria: {} as any,
    generatedAt: new Date(),
  } as any);
});

afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }));

describe("GenerationAgent diversity gate", () => {
  it("discards a candidate near-identical to an existing active hypothesis", async () => {
    resetConfig(); // default threshold 0.92
    seedActive(VEC_A);
    const before = store.countHypotheses(sessionId).total;
    await makeAgent(VEC_A).execute(sessionId, 2);
    expect(store.countHypotheses(sessionId).total).toBe(before);
  });

  it("saves a candidate that is distinct from all existing hypotheses", async () => {
    resetConfig();
    seedActive(VEC_A);
    const before = store.countHypotheses(sessionId).total;
    await makeAgent(VEC_ORTHOGONAL).execute(sessionId, 2);
    expect(store.countHypotheses(sessionId).total).toBe(before + 1);
    // The saved candidate's embedding is persisted for later reuse.
    const newest = store.getPendingReviewHypotheses(sessionId, 10).find((h) => h.title === "Candidate");
    expect(newest).toBeDefined();
    expect(store.getEmbedding(newest!.id)).not.toBeNull();
  });

  it("threshold = 1 disables the gate (identical candidate is saved)", async () => {
    process.env.GENERATION_DIVERSITY_THRESHOLD = "1";
    resetConfig();
    expect(getConfig().generation.diversityThreshold).toBe(1);
    seedActive(VEC_A);
    const before = store.countHypotheses(sessionId).total;
    await makeAgent(VEC_A).execute(sessionId, 2);
    expect(store.countHypotheses(sessionId).total).toBe(before + 1);
    delete process.env.GENERATION_DIVERSITY_THRESHOLD;
    resetConfig();
  });

  it("ignores rejected hypotheses as neighbours", async () => {
    resetConfig();
    seedActive(VEC_A, 1300, "rejected");
    const before = store.countHypotheses(sessionId).total;
    await makeAgent(VEC_A).execute(sessionId, 2);
    expect(store.countHypotheses(sessionId).total).toBe(before + 1);
  });
});
