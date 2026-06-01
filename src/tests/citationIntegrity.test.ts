import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";

const TEST_DIR = join(tmpdir(), `citation-test-${Date.now()}`);
mkdirSync(TEST_DIR, { recursive: true });
process.env.DB_PATH = join(TEST_DIR, "test.db");
process.env.DEEPSEEK_API_KEY = "stub-for-tests";

import { resetDb } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { getContextStore, resetContextStore } from "../memory/contextStore.js";
import { resetConfig } from "../config.js";
import { citationPenalty } from "../agents/citationIntegrity.js";
import { CitationIntegrityAgent } from "../agents/citationIntegrity.js";
import type { FetchFn } from "../tools/citationResolver.js";

let store: ReturnType<typeof getContextStore>;
let sessionId: string;

beforeAll(async () => {
  resetConfig();
  resetDb();
  resetContextStore();
  store = getContextStore();
  await runMigrations();
  sessionId = uuidv4();
  store["sqlite"].run(
    `INSERT INTO sessions (id,name,status,research_goal_json,stats_json,created_at,updated_at)
     VALUES ('${sessionId}','Cite Test','completed','{}','{}',1,1)`
  );
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function addHyp() {
  return store.saveHypothesis({
    sessionId,
    title: "H", summary: "s", content: "c", rationale: "r",
    generationStrategy: "literature_exploration",
    eloRating: 1200, ratingDeviation: 350, volatility: 0.06,
    matchesPlayed: 0, wins: 0, losses: 0, draws: 0,
    status: "active", parentIds: [], generationRound: 1,
    keyAssumptions: [], citations: [],
  });
}

describe("ContextStore citation verifications", () => {
  it("saves and reads back verification rows", () => {
    const h = addHyp();
    store.saveCitationVerifications(h.id, sessionId, [
      { rawCitation: "10.1/x", status: "verified", canonicalTitle: "T", doi: "10.1/x", authors: "Doe", year: 2020, matchScore: 1 },
      { rawCitation: "fake", status: "fabricated", matchScore: 0 },
    ]);
    const rows = store.getCitationVerifications(h.id);
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.status === "verified")?.doi).toBe("10.1/x");
  });

  it("summarizes counts and fabrication rate", () => {
    const h = addHyp();
    store.saveCitationVerifications(h.id, sessionId, [
      { rawCitation: "a", status: "verified", matchScore: 1 },
      { rawCitation: "b", status: "fabricated", matchScore: 0 },
      { rawCitation: "c", status: "unverified", matchScore: 0.2 },
      { rawCitation: "d", status: "fabricated", matchScore: 0 },
    ]);
    const s = store.getCitationIntegrity(h.id);
    expect(s.total).toBe(4);
    expect(s.verified).toBe(1);
    expect(s.unverified).toBe(1);
    expect(s.fabricated).toBe(2);
    expect(s.fabricationRate).toBeCloseTo(0.5, 5);
  });

  it("re-saving replaces prior rows (idempotent)", () => {
    const h = addHyp();
    store.saveCitationVerifications(h.id, sessionId, [{ rawCitation: "a", status: "verified", matchScore: 1 }]);
    store.saveCitationVerifications(h.id, sessionId, [{ rawCitation: "b", status: "fabricated", matchScore: 0 }]);
    const rows = store.getCitationVerifications(h.id);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("fabricated");
  });

  it("empty summary is zeroed with rate 0", () => {
    const h = addHyp();
    const s = store.getCitationIntegrity(h.id);
    expect(s.total).toBe(0);
    expect(s.fabricationRate).toBe(0);
  });
});

describe("citationPenalty", () => {
  it("no citations → no penalty", () => {
    const p = citationPenalty({ total: 0, unverified: 0, fabricated: 0 });
    expect(p.f).toBe(0);
    expect(p.ratingDelta).toBe(0);
    expect(p.rdDelta).toBe(0);
  });

  it("all verified → no penalty", () => {
    const p = citationPenalty({ total: 4, unverified: 0, fabricated: 0 });
    expect(p.ratingDelta).toBe(0);
    expect(p.rdDelta).toBe(0);
  });

  it("all fabricated → full penalty and full RD widening", () => {
    const p = citationPenalty({ total: 3, unverified: 0, fabricated: 3 });
    expect(p.f).toBeCloseTo(1, 5);
    expect(p.ratingDelta).toBe(-150);
    expect(p.rdDelta).toBe(100);
  });

  it("unverified counts half as much as fabricated", () => {
    const p = citationPenalty({ total: 2, unverified: 2, fabricated: 0 });
    expect(p.f).toBeCloseTo(0.5, 5);
    expect(p.ratingDelta).toBe(-75);
    expect(p.rdDelta).toBe(50);
  });

  it("mixed case is proportional", () => {
    const p = citationPenalty({ total: 4, unverified: 1, fabricated: 1 });
    // f = (1 + 0.5*1)/4 = 0.375
    expect(p.f).toBeCloseTo(0.375, 5);
    expect(p.ratingDelta).toBe(Math.round(-0.375 * 150));
    expect(p.rdDelta).toBe(Math.round(0.375 * 100));
  });
});

describe("CitationIntegrityAgent.execute", () => {
  it("persists per-citation rows and returns the penalty", async () => {
    const h = store.saveHypothesis({
      sessionId,
      title: "Cited Hyp", summary: "s", content: "c", rationale: "r",
      generationStrategy: "literature_exploration",
      eloRating: 1300, ratingDeviation: 200, volatility: 0.06,
      matchesPlayed: 0, wins: 0, losses: 0, draws: 0,
      status: "reviewing", parentIds: [], generationRound: 1,
      keyAssumptions: [],
      citations: ["10.1038/real", "10.9999/fake"],
    });

    // Stub fetch: the "real" DOI resolves (200), the "fake" DOI 404s.
    // Both have 4-digit registrants so extractDoi takes the DOI path.
    const fetchFn: FetchFn = async (url) =>
      url.includes("real")
        ? { ok: true, status: 200, json: async () => ({ message: { title: ["Real"], DOI: "10.1038/real" } }) }
        : { ok: false, status: 404, json: async () => ({}) };

    const agent = new CitationIntegrityAgent(fetchFn);
    const penalty = await agent.execute(sessionId, h);

    const rows = store.getCitationVerifications(h.id);
    expect(rows.length).toBe(2);
    expect(rows.some((r) => r.status === "verified")).toBe(true);
    expect(rows.some((r) => r.status === "fabricated")).toBe(true);
    // f = (1 + 0)/2 = 0.5 → -75
    expect(penalty.ratingDelta).toBe(-75);
  });

  it("no-ops on a hypothesis with no citations", async () => {
    const h = addHyp();
    const agent = new CitationIntegrityAgent(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const penalty = await agent.execute(sessionId, h);
    expect(penalty.ratingDelta).toBe(0);
    expect(store.getCitationVerifications(h.id).length).toBe(0);
  });
});
