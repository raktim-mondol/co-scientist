/**
 * RLEF Task 9 — Integration Tests
 *
 * Tests the end-to-end RLEF flow against a real (in-memory) SQLite database:
 *   submit feedback → reward extraction → Elo update → prompt injection → cross-session retrieval
 *
 * No LLM calls are made. Embedding calls are stubbed via process.env.DB_PATH
 * pointing to a temp file so tests are fully isolated.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";

// ── Test DB isolation ─────────────────────────────────────────────────────────
const TEST_DIR = join(tmpdir(), `rlef-test-${Date.now()}`);
mkdirSync(TEST_DIR, { recursive: true });
process.env.DB_PATH = join(TEST_DIR, "test.db");
process.env.DEEPSEEK_API_KEY = "stub-for-tests";

// Imports must come AFTER env vars are set (modules read env at load time)
import { runMigrations } from "../db/migrate.js";
import { closeDb, getSqlite, resetDb } from "../db/index.js";
import { getContextStore, resetContextStore } from "../memory/contextStore.js";
import { resetConfig } from "../config.js";
import { extractRewardFromFeedback, applyRewardToElo, applyFeedbackAsGlicko2Match } from "../rlef/reward-signal.js";
import { buildRLEFMetaReviewBlock } from "../rlef/prompt-injection.js";
import { RewardStore } from "../rlef/reward-store.js";
import type { ExperimentalFeedback } from "../models/feedback.js";
import type { Hypothesis } from "../models/hypothesis.js";

// ── Helpers ───────────────────────────────────────────────────────────────────
// store/rewardStore are assigned in beforeAll AFTER resetting the DB singletons.
// Bun runs all test files in one process, so acquiring these at module-eval time
// would capture a stale ContextStore/connection from a previously-run file whose
// temp DB directory has since been deleted (→ "disk I/O error" / SQLITE_BUSY).
let sessionId: string;
let hyp: Hypothesis;
let store: ReturnType<typeof getContextStore>;
let rewardStore: RewardStore;

function makeFeedback(
  hypothesisId: string,
  text: string,
  reward: number,
  novelty?: number,
  correctness?: number,
  testability?: number,
): ExperimentalFeedback {
  return {
    id: uuidv4(),
    hypothesisId,
    sessionId,
    feedbackText: text,
    noveltyScore: novelty,
    correctnessScore: correctness,
    testabilityScore: testability,
    metadata: {},
    computedReward: reward,
    recordedBy: "human",
    createdAt: new Date(),
  };
}

beforeAll(async () => {
  // Establish a clean, isolated DB on THIS file's DB_PATH before any DB use,
  // matching the pattern used by the other DB test files (safety, citation, etc.).
  resetConfig();
  resetDb();
  resetContextStore();
  store = getContextStore();
  rewardStore = new RewardStore();

  await runMigrations();

  // Seed a session and hypothesis
  sessionId = uuidv4();
  getSqlite().run(
    `INSERT INTO sessions (id,name,status,research_goal_json,stats_json,created_at,updated_at)
     VALUES ('${sessionId}','RLEF Test','running','{}','{}',1,1)`
  );
  hyp = store.saveHypothesis({
    sessionId,
    title: "Drug X reduces tumor volume via apoptosis",
    summary: "Drug X inhibits Bcl-2 pathway leading to apoptosis",
    content: "Full content here",
    rationale: "Bcl-2 overexpression is a hallmark of TNBC",
    generationStrategy: "literature_exploration",
    eloRating: 1200,
    ratingDeviation: 350,
    volatility: 0.06,
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    status: "active",
    parentIds: [],
    generationRound: 1,
    keyAssumptions: ["Bcl-2 is overexpressed in TNBC"],
    citations: [],
  });

  // Pre-seed a dummy embedding so recordFeedback() doesn't call the LLM.
  // The embed() API is not available in tests (DEEPSEEK_API_KEY is a stub).
  // A zero-filled Float32Array of length 384 matches the all-MiniLM-L6-v2
  // dimensionality used by the production embedding pipeline.
  store.saveEmbedding(hyp.id, new Array(384).fill(0));
});

afterAll(() => {
  closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ── Task 3: Reward Extraction ─────────────────────────────────────────────────
describe("RLEF reward extraction", () => {
  it("positive text + high scores → positive reward", () => {
    const r = extractRewardFromFeedback("confirmed and validated", 9, 9, 9);
    expect(r).toBeGreaterThan(0);
  });

  it("negative text + low scores → negative reward", () => {
    const r = extractRewardFromFeedback("failed and refuted", 1, 1, 1);
    expect(r).toBeLessThan(0);
  });

  it("reward is always in [-1, +1]", () => {
    const r1 = extractRewardFromFeedback("confirmed validated success", 10, 10, 10);
    const r2 = extractRewardFromFeedback("failed rejected toxic", 0, 0, 0);
    expect(r1).toBeLessThanOrEqual(1);
    expect(r2).toBeGreaterThanOrEqual(-1);
  });

  it("empty feedback text with no scores → 0", () => {
    expect(extractRewardFromFeedback("")).toBe(0);
  });
});

// ── Task 3: Elo Update ────────────────────────────────────────────────────────
describe("RLEF Elo update", () => {
  it("positive reward raises Elo", () => {
    expect(applyRewardToElo(1200, 0.5)).toBeGreaterThan(1200);
  });

  it("negative reward lowers Elo", () => {
    expect(applyRewardToElo(1200, -0.5)).toBeLessThan(1200);
  });

  it("zero reward leaves Elo unchanged", () => {
    expect(applyRewardToElo(1200, 0)).toBeCloseTo(1200);
  });

  it("K=48 produces larger swing than K=32", () => {
    const k48 = applyRewardToElo(1200, 0.8, 48) - 1200;
    const k32 = applyRewardToElo(1200, 0.8, 32) - 1200;
    expect(k48).toBeGreaterThan(k32);
  });
});

// ── Task 5: ContextStore feedback methods ─────────────────────────────────────
describe("ContextStore experimental feedback", () => {
  it("saveExperimentalFeedback + getExperimentalFeedback round-trip", () => {
    const fb = makeFeedback(hyp.id, "Confirmed: drug X works", 0.78, 8, 9, 8);
    store.saveExperimentalFeedback(fb);

    const fetched = store.getExperimentalFeedback(hyp.id);
    expect(fetched.length).toBeGreaterThanOrEqual(1);
    const found = fetched.find((f) => f.id === fb.id);
    expect(found).toBeDefined();
    expect(found!.computedReward).toBeCloseTo(0.78);
    expect(found!.noveltyScore).toBe(8);
    expect(found!.feedbackText).toBe("Confirmed: drug X works");
  });

  it("getAllFeedbackForSession returns all entries for the session", () => {
    const fb2 = makeFeedback(hyp.id, "Second observation", 0.5);
    store.saveExperimentalFeedback(fb2);

    const all = store.getAllFeedbackForSession(sessionId);
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.every((f) => f.sessionId === sessionId)).toBe(true);
  });

  it("feedbackCount on hypothesis reflects stored entries", () => {
    const loaded = store.getHypothesis(hyp.id);
    expect(loaded?.feedbackCount).toBeGreaterThanOrEqual(2);
  });

  it("multiple feedback on same hypothesis all retrievable", () => {
    const ids = [uuidv4(), uuidv4(), uuidv4()];
    for (const id of ids) {
      store.saveExperimentalFeedback(makeFeedback(hyp.id, `Observation ${id}`, 0.4));
    }
    const all = store.getExperimentalFeedback(hyp.id);
    expect(all.length).toBeGreaterThanOrEqual(5);
  });
});

// ── Task 6: Prompt Injection ──────────────────────────────────────────────────
describe("buildRLEFMetaReviewBlock", () => {
  it("returns empty string when no strong-signal feedback", () => {
    const neutral = [makeFeedback(hyp.id, "experiment ran", 0.1)];
    expect(buildRLEFMetaReviewBlock(neutral)).toBe("");
  });

  it("includes VALIDATED section for positive feedback", () => {
    const feedbacks = [makeFeedback(hyp.id, "Confirmed: drug X works via apoptosis", 0.78)];
    const block = buildRLEFMetaReviewBlock(feedbacks);
    expect(block).toContain("VALIDATED HYPOTHESES");
    expect(block).toContain("+0.78");
  });

  it("includes REFUTED section for negative feedback", () => {
    const feedbacks = [makeFeedback(hyp.id, "Failed to replicate", -0.65)];
    const block = buildRLEFMetaReviewBlock(feedbacks);
    expect(block).toContain("REFUTED HYPOTHESES");
    expect(block).toContain("-0.65");
    expect(block).toContain("Avoid similar approaches");
  });

  it("includes both sections when mixed feedback", () => {
    const feedbacks = [
      makeFeedback(hyp.id, "Confirmed: works", 0.8),
      makeFeedback(hyp.id, "Failed: no effect", -0.7),
    ];
    const block = buildRLEFMetaReviewBlock(feedbacks);
    expect(block).toContain("VALIDATED");
    expect(block).toContain("REFUTED");
  });

  it("prompt injection block appended to metaCritique is non-empty", () => {
    const feedbacks = store.getAllFeedbackForSession(sessionId);
    const block = buildRLEFMetaReviewBlock(feedbacks);
    const combined = "existing critique" + block;
    expect(combined.length).toBeGreaterThan("existing critique".length);
  });
});

// ── Task 7: RewardStore (keyword extraction + recordFeedback gate) ─────────────
describe("RewardStore", () => {
  // rewardStore is constructed in beforeAll (after DB reset) — see top of file.

  it("extractKeywords filters stop-words and short words", () => {
    const kw = rewardStore.extractKeywords("Drug X reduces tumor volume via apoptosis pathway");
    expect(kw).toContain("drug");
    expect(kw).toContain("tumor");
    expect(kw).toContain("apoptosis");
    expect(kw).not.toContain("via");   // stop-word
    expect(kw).not.toContain("the");   // stop-word
  });

  it("extractKeywords deduplicates", () => {
    const kw = rewardStore.extractKeywords("tumor tumor tumor apoptosis apoptosis");
    expect(kw.filter((k) => k === "tumor").length).toBe(1);
  });

  it("recordFeedback does NOT insert weak signal (|reward| ≤ 0.3)", async () => {
    const before = (getSqlite().query("SELECT count(*) as n FROM reward_memory").get() as { n: number }).n;
    const fb = makeFeedback(hyp.id, "neutral observation", 0.1);
    await rewardStore.recordFeedback(fb, hyp);
    const after = (getSqlite().query("SELECT count(*) as n FROM reward_memory").get() as { n: number }).n;
    expect(after).toBe(before);
  });

  it("recordFeedback inserts strong positive signal", async () => {
    const before = (getSqlite().query("SELECT count(*) as n FROM reward_memory").get() as { n: number }).n;
    const fb = makeFeedback(hyp.id, "Confirmed: drug X reduces tumor via apoptosis", 0.78, 8, 9, 8);
    await rewardStore.recordFeedback(fb, hyp);
    const after = (getSqlite().query("SELECT count(*) as n FROM reward_memory").get() as { n: number }).n;
    expect(after).toBe(before + 1);
  });

  it("recordFeedback inserts strong negative signal", async () => {
    const before = (getSqlite().query("SELECT count(*) as n FROM reward_memory").get() as { n: number }).n;
    const fb = makeFeedback(hyp.id, "Failed to replicate. No effect observed.", -0.65);
    await rewardStore.recordFeedback(fb, hyp);
    const after = (getSqlite().query("SELECT count(*) as n FROM reward_memory").get() as { n: number }).n;
    expect(after).toBe(before + 1);
  });

  it("recordFeedback is idempotent (INSERT OR IGNORE)", async () => {
    const fb = makeFeedback(hyp.id, "Confirmed again", 0.8);
    // First insert
    await rewardStore.recordFeedback(fb, hyp);
    const before = (getSqlite().query("SELECT count(*) as n FROM reward_memory").get() as { n: number }).n;
    // Second insert with same id — should be ignored
    await rewardStore.recordFeedback(fb, hyp);
    const after = (getSqlite().query("SELECT count(*) as n FROM reward_memory").get() as { n: number }).n;
    expect(after).toBe(before);
  });

  it("getRelevantPriors returns entries with |reward| > 0.3", async () => {
    const priors = await rewardStore.getRelevantPriors("cancer therapy targeting apoptosis", 5);
    expect(Array.isArray(priors)).toBe(true);
    for (const p of priors) {
      expect(Math.abs(p.computedReward)).toBeGreaterThan(0.3);
    }
  });
});

// ── End-to-end flow ───────────────────────────────────────────────────────────
describe("RLEF end-to-end flow", () => {
  it("submit feedback → reward extraction → Glicko-2 update → prompt injection", () => {
    const originalElo = hyp.eloRating;

    // 1. Extract reward (scores 9,9,9 produce reward > 0.33 → maps to a win)
    const reward = extractRewardFromFeedback(
      "Confirmed: drug X reduces tumor volume significantly",
      9, 9, 9,
    );
    expect(reward).toBeGreaterThan(0.33);

    // 2. Apply via Glicko-2 match (proper RD/volatility update)
    const updated = applyFeedbackAsGlicko2Match({
      rating: originalElo, rd: 350, volatility: 0.06,
      matchesPlayed: 0, wins: 0, losses: 0, draws: 0,
    }, reward);
    expect(updated.rating).toBeGreaterThan(originalElo);
    expect(updated.rd).toBeLessThan(350);
    expect(updated.matchesPlayed).toBe(1);

    // 3. Persist feedback
    const fb = makeFeedback(hyp.id, "Confirmed: drug X reduces tumor volume significantly", reward, 9, 9, 9);
    store.saveExperimentalFeedback(fb);
    store.updateHypothesisRating(hyp.id, updated.rating, updated.rd, updated.volatility, updated.wins, updated.losses, updated.matchesPlayed);

    // 4. Verify state updated in DB
    const fromDb = store.getHypothesis(hyp.id);
    expect(fromDb!.eloRating).toBeCloseTo(updated.rating);
    expect(fromDb!.ratingDeviation).toBeCloseTo(updated.rd);
    expect(fromDb!.matchesPlayed).toBe(1);

    // 5. Prompt injection block contains the feedback
    const allFeedback = store.getAllFeedbackForSession(sessionId);
    const block = buildRLEFMetaReviewBlock(allFeedback);
    // At least one strong-signal entry exists → block is non-empty
    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain("EXPERIMENTAL FEEDBACK");
  });

  it("extreme scores (0,0,0) → strongly negative reward", () => {
    const r = extractRewardFromFeedback("experiment ran", 0, 0, 0);
    expect(r).toBeLessThan(-0.5);
  });

  it("extreme scores (10,10,10) with positive text → near-max reward", () => {
    const r = extractRewardFromFeedback("confirmed validated success", 10, 10, 10);
    expect(r).toBeGreaterThan(0.2);
  });
});
