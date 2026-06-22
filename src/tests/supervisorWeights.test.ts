import { describe, it, expect } from "bun:test";
import { SupervisorAgent } from "../agents/supervisor.js";

describe("SupervisorAgent.getCurrentWeights", () => {
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
