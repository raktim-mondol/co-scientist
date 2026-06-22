import { describe, it, expect } from "bun:test";
import "../../cli/tui/commands/sessions.js";
import { getCommand, type AppContext } from "../../cli/tui/CommandRouter.js";

const sessionsHandler = getCommand("sessions");

function ctx(sessions: unknown[] = []): AppContext {
  return {
    memory: { listSessions: () => sessions } as unknown as AppContext["memory"],
    sessionId: null, goal: null, supervisor: null, emitter: null,
    openModal: () => {}, showToast: () => {},
    startSession: async () => {}, resumeSession: async () => {},
    stopSession: () => {}, togglePause: () => false, paused: false, pushEntry: () => {},
  };
}

describe("session picker commands", () => {
  it("/sessions opens the sessions modal", async () => {
    const r = await sessionsHandler!.execute([], ctx());
    expect(r).toEqual({ type: "modal", modal: "sessions" });
  });

  it("/switch and /delete are no longer registered", async () => {
    expect(getCommand("switch")).toBeUndefined();
    expect(getCommand("delete")).toBeUndefined();
    expect(getCommand("dashboard")).toBeUndefined();
    expect(getCommand("resume")).toBeUndefined();
  });
});
