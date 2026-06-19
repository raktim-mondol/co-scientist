/**
 * TUI steering actions — unit tests against a real (temp) SQLite database.
 * No LLM calls. Mirrors the DB-isolation pattern used in knowledgeGraph.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";

const TEST_DIR = join(tmpdir(), `tui-actions-test-${Date.now()}`);
mkdirSync(TEST_DIR, { recursive: true });
process.env.DB_PATH = join(TEST_DIR, "test.db");
process.env.DEEPSEEK_API_KEY = "stub-for-tests";

import { resetDb } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { getContextStore, resetContextStore } from "../memory/contextStore.js";
import { resetConfig } from "../config.js";
import { killHypothesis, boostHypothesis, injectHypothesis } from "../cli/actions.js";
import type { ContextStore } from "../memory/contextStore.js";

let store: ContextStore;
let sessionId: string;

function seedHypothesis(elo = 1200): string {
  const hyp = store.saveHypothesis({
    sessionId,
    title: "Seed hypothesis",
    summary: "seed",
    content: "seed content",
    rationale: "seed rationale",
    keyAssumptions: [],
    citations: [],
    generationStrategy: "test",
    eloRating: elo,
    ratingDeviation: 350,
    volatility: 0.06,
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    status: "active",
    parentIds: [],
    generationRound: 1,
  });
  return hyp.id;
}

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

beforeAll(async () => {
  resetConfig();
  resetDb();
  resetContextStore();
  store = getContextStore();
  await runMigrations();
  sessionId = uuidv4();
  store["sqlite"].run(
    `INSERT INTO sessions (id,name,status,research_goal_json,stats_json,created_at,updated_at)
     VALUES ('${sessionId}','TUI Test','running','{}','{}',1,1)`
  );
});

describe("killHypothesis", () => {
  it("sets the hypothesis status to rejected", () => {
    const id = seedHypothesis();
    killHypothesis(store, id);
    expect(store.getHypothesis(id)?.status).toBe("rejected");
  });
});

describe("boostHypothesis", () => {
  it("sets the Elo to the requested absolute value", () => {
    const id = seedHypothesis(1200);
    boostHypothesis(store, id, 1500);
    expect(store.getHypothesis(id)!.eloRating).toBe(1500);
  });
});

describe("injectHypothesis", () => {
  it("inserts a pending_review hypothesis with seed Elo", () => {
    const created = injectHypothesis(store, {
      sessionId,
      title: "Operator idea",
      summary: "",
      content: "A bold manual hypothesis",
      generationRound: 7,
    });
    const fetched = store.getHypothesis(created.id)!;
    expect(fetched.status).toBe("pending_review");
    expect(fetched.eloRating).toBe(1200);
    expect(fetched.generationStrategy).toBe("manual_injection");
    expect(fetched.summary).toBe("Operator idea"); // empty summary falls back to title
  });

  it("rejects empty title or content", () => {
    expect(() =>
      injectHypothesis(store, { sessionId, title: "  ", summary: "", content: "x", generationRound: 1 })
    ).toThrow();
    expect(() =>
      injectHypothesis(store, { sessionId, title: "x", summary: "", content: "  ", generationRound: 1 })
    ).toThrow();
  });
});
