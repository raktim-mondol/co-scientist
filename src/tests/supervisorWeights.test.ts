import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SupervisorAgent } from "../agents/supervisor.js";

// Isolate DB so this test can run alongside a live co-scientist instance.
const originalDbPath = process.env.DB_PATH;

describe("SupervisorAgent.getCurrentWeights", () => {
  beforeEach(() => {
    process.env.DB_PATH = `/tmp/test-supervisor-weights-${process.pid}.db`;
  });
  afterEach(() => {
    if (originalDbPath !== undefined) process.env.DB_PATH = originalDbPath;
    else delete process.env.DB_PATH;
  });
  it("returns a valid AgentWeights with all six task types before any loop iteration", () => {
    const sup = new SupervisorAgent();
    const w = sup.getCurrentWeights();
    for (const k of ["generation", "reflection", "ranking", "evolution", "proximity", "meta_review"] as const) {
      expect(typeof w[k]).toBe("number");
      expect(w[k]).toBeGreaterThanOrEqual(0);
    }
    // Fresh session is generation-heavy.
    expect(w.generation).toBeGreaterThan(0);
  });
});
