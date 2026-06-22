import { describe, it, expect } from "bun:test";
import "../../cli/tui/commands/logout.js";
import { getCommand, type AppContext } from "../../cli/tui/CommandRouter.js";

const logout = getCommand("logout");

function ctx(): AppContext {
  return {
    memory: {} as AppContext["memory"],
    sessionId: "s1", goal: null, supervisor: null, emitter: null,
    openModal: () => {}, showToast: () => {},
    startSession: async () => {}, resumeSession: async () => {},
    stopSession: () => {}, togglePause: () => false, paused: false, pushEntry: () => {},
  } as AppContext;
}

describe("informational output persists", () => {
  it("/logout returns a persistent transcript entry, not a toast", async () => {
    const r = await logout!.execute([], ctx());
    expect(r.type).toBe("transcript");
    if (r.type === "transcript") {
      expect(r.entries.length).toBeGreaterThan(0);
    }
  });

  it("/logout still rejects an invalid provider with an error", async () => {
    const r = await logout!.execute(["bogus"], ctx());
    expect(r.type).toBe("error");
  });
});
