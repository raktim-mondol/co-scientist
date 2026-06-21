import { describe, it, expect } from "bun:test";
import "../../cli/tui/commands/sessions.js";
import "../../cli/tui/commands/deleteCmd.js";
import "../../cli/tui/commands/switch.js";
import { getCommand, type AppContext } from "../../cli/tui/CommandRouter.js";

const sessionsHandler = getCommand("sessions");
const deleteHandler = getCommand("delete");
const switchHandler = getCommand("switch");

function ctx(sessions: unknown[] = []): AppContext {
  return {
    memory: { listSessions: () => sessions } as unknown as AppContext["memory"],
    sessionId: null, goal: null, supervisor: null, emitter: null,
    openModal: () => {}, closeModal: () => {}, showToast: () => {},
    startSession: async () => {}, resumeSession: async () => {},
    stopSession: () => {}, togglePause: () => false, paused: false, pushEntry: () => {},
  };
}

describe("session picker commands", () => {
  it("/sessions opens the sessions modal", async () => {
    const r = await sessionsHandler!.execute([], ctx());
    expect(r).toEqual({ type: "modal", modal: "sessions" });
  });

  it("/delete opens the same sessions modal", async () => {
    const r = await deleteHandler!.execute([], ctx());
    expect(r).toEqual({ type: "modal", modal: "sessions" });
  });

  it("/switch <id> returns a persistent transcript block on match", async () => {
    const sessions = [{ id: "abcd1234-0000-0000-0000-000000000000", name: "My Session", status: "paused", stats: { totalHypotheses: 3 } }];
    const r = await switchHandler!.execute(["abcd1234"], ctx(sessions));
    expect(r.type).toBe("transcript");
    if (r.type === "transcript") {
      expect(r.entries[0].title).toContain("My Session");
      expect(r.entries[0].lines?.join("\n")).toContain("abcd1234-0000-0000-0000-000000000000");
    }
  });
});
