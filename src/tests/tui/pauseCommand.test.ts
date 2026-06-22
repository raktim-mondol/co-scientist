import { describe, it, expect } from "bun:test";
import "../../cli/tui/commands/pause.js";
import { getCommand, type AppContext } from "../../cli/tui/CommandRouter.js";

const pause = getCommand("pause");

function ctx(over: Partial<AppContext> = {}): AppContext {
  let toggled = false;
  return {
    memory: {} as AppContext["memory"],
    sessionId: "s1", goal: "g", supervisor: {} as AppContext["supervisor"], emitter: null,
    openModal: () => {}, showToast: () => {},
    startSession: async () => {}, resumeSession: async () => {},
    stopSession: () => {},
    togglePause: () => { toggled = true; return true; },
    paused: false, pushEntry: () => {},
    ...over,
  } as AppContext;
}

describe("/pause command", () => {
  it("calls togglePause and returns immediate with NO message (no duplicate toast)", async () => {
    let toggled = false;
    const c = ctx({ togglePause: () => { toggled = true; return true; } });
    const r = await pause!.execute([], c);
    expect(toggled).toBe(true);
    expect(r.type).toBe("immediate");
    if (r.type === "immediate") expect(r.message).toBeUndefined();
  });

  it("is not active when already paused", () => {
    expect(pause!.activeWhen?.(ctx({ paused: true }))).toBe(false);
  });
});
