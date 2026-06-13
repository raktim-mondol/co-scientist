import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";

const TEST_DIR = join(tmpdir(), `safety-test-${Date.now()}`);
mkdirSync(TEST_DIR, { recursive: true });
process.env.DB_PATH = join(TEST_DIR, "test.db");
process.env.DEEPSEEK_API_KEY = "stub-for-tests";

import { resetDb } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { getContextStore, resetContextStore } from "../memory/contextStore.js";
import { resetConfig } from "../config.js";
import { decideSafety, normalizeSeverity, SafetyAgent } from "../agents/safety.js";
import type { Hypothesis } from "../models/hypothesis.js";

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
     VALUES ('${sessionId}','Safety Test','running','{}','{}',1,1)`
  );
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function addHyp(status = "reviewing"): Hypothesis {
  return store.saveHypothesis({
    sessionId,
    title: "H", summary: "s", content: "c", rationale: "r",
    generationStrategy: "literature_exploration",
    eloRating: 1200, ratingDeviation: 350, volatility: 0.06,
    matchesPlayed: 0, wins: 0, losses: 0, draws: 0,
    status: status as Hypothesis["status"], parentIds: [], generationRound: 1,
    keyAssumptions: [], citations: [],
  });
}

describe("normalizeSeverity", () => {
  it("accepts valid severities case-insensitively", () => {
    expect(normalizeSeverity("HIGH")).toBe("high");
    expect(normalizeSeverity(" Moderate ")).toBe("moderate");
  });
  it("defaults unknown / empty input to none", () => {
    expect(normalizeSeverity("catastrophic")).toBe("none");
    expect(normalizeSeverity(undefined)).toBe("none");
    expect(normalizeSeverity("")).toBe("none");
  });
});

describe("decideSafety", () => {
  it("quarantines at or above the threshold", () => {
    expect(decideSafety({ severity: "high" }, "high").decision).toBe("quarantined");
    expect(decideSafety({ severity: "moderate" }, "moderate").decision).toBe("quarantined");
    expect(decideSafety({ severity: "high" }, "moderate").decision).toBe("quarantined");
  });
  it("allows below the threshold", () => {
    expect(decideSafety({ severity: "moderate" }, "high").decision).toBe("allowed");
    expect(decideSafety({ severity: "low" }, "moderate").decision).toBe("allowed");
    expect(decideSafety({ severity: "none" }, "low").decision).toBe("allowed");
  });
  it("priorSafetyFlag lifts none to low (floor)", () => {
    const r = decideSafety({ severity: "none", priorSafetyFlag: true }, "high");
    expect(r.severity).toBe("low");
    expect(r.decision).toBe("allowed"); // low < high, still allowed
    expect(decideSafety({ severity: "none", priorSafetyFlag: true }, "low").decision).toBe("quarantined");
  });
  it("priorSafetyFlag never lowers a higher severity", () => {
    expect(decideSafety({ severity: "high", priorSafetyFlag: true }, "high").severity).toBe("high");
  });
});

describe("ContextStore safety assessments", () => {
  it("saves and reads back the latest assessment", () => {
    const h = addHyp();
    store.saveSafetyAssessment(h.id, sessionId, {
      severity: "moderate", category: "dual_use", reasoning: "why", decision: "allowed", threshold: "high",
    });
    const a = store.getLatestSafetyAssessment(h.id);
    expect(a?.severity).toBe("moderate");
    expect(a?.category).toBe("dual_use");
    expect(a?.decision).toBe("allowed");
    expect(a?.overriddenBy).toBeNull();
  });

  it("lists quarantined hypotheses and releases them with an audit trail", () => {
    const h = addHyp("quarantined");
    store.saveSafetyAssessment(h.id, sessionId, {
      severity: "high", category: "bioweapon", reasoning: "uplift", decision: "quarantined", threshold: "high",
    });

    expect(store.getQuarantinedHypotheses(sessionId).some((q) => q.id === h.id)).toBe(true);

    const released = store.releaseQuarantine(h.id, "alice", "false positive, defensive only");
    expect(released).toBe(true);
    expect(store.getHypothesis(h.id)?.status).toBe("active");
    expect(store.getQuarantinedHypotheses(sessionId).some((q) => q.id === h.id)).toBe(false);

    const a = store.getLatestSafetyAssessment(h.id);
    expect(a?.overriddenBy).toBe("alice");
    expect(a?.overrideReason).toContain("defensive");
  });

  it("releaseQuarantine returns false for a non-quarantined hypothesis", () => {
    const h = addHyp("active");
    expect(store.releaseQuarantine(h.id, "bob", "nope")).toBe(false);
  });
});

describe("SafetyAgent.assess", () => {
  it("quarantines when severity meets the threshold and persists the assessment", async () => {
    process.env.SAFETY_QUARANTINE_THRESHOLD = "high";
    resetConfig();
    const agent = new SafetyAgent(async () => ({
      severity: "high", category: "bioweapon", reasoning: "actionable uplift",
    }));
    const h = addHyp();
    const a = await agent.assess(sessionId, h);
    expect(a.decision).toBe("quarantined");
    expect(store.getLatestSafetyAssessment(h.id)?.decision).toBe("quarantined");
  });

  it("allows benign hypotheses", async () => {
    process.env.SAFETY_QUARANTINE_THRESHOLD = "high";
    resetConfig();
    const agent = new SafetyAgent(async () => ({
      severity: "none", category: "none", reasoning: "routine science",
    }));
    const h = addHyp();
    const a = await agent.assess(sessionId, h);
    expect(a.decision).toBe("allowed");
  });

  it("fails safe to 'none' (allowed) when the classifier throws", async () => {
    process.env.SAFETY_QUARANTINE_THRESHOLD = "high";
    resetConfig();
    const agent = new SafetyAgent(async () => { throw new Error("LLM down"); });
    const h = addHyp();
    const a = await agent.assess(sessionId, h, false);
    expect(a.severity).toBe("none");
    expect(a.decision).toBe("allowed");
  });

  it("respects a stricter threshold via env", async () => {
    process.env.SAFETY_QUARANTINE_THRESHOLD = "moderate";
    resetConfig();
    const agent = new SafetyAgent(async () => ({
      severity: "moderate", category: "dual_use", reasoning: "plausible misuse",
    }));
    const h = addHyp();
    const a = await agent.assess(sessionId, h);
    expect(a.decision).toBe("quarantined");
    // restore default for any later tests
    delete process.env.SAFETY_QUARANTINE_THRESHOLD;
    resetConfig();
  });
});
