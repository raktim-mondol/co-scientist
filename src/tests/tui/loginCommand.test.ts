import { describe, it, expect } from "bun:test";
import "../../cli/tui/commands/login.js"; // side-effect: registers the command
import { getCommand, type AppContext } from "../../cli/tui/CommandRouter.js";

// Capture the handler at module-eval time so another suite's resetRegistry()
// (run in beforeEach) can't wipe it out from under us.
const loginHandler = getCommand("login");

function ctx(): AppContext {
  return {
    memory: {} as AppContext["memory"],
    sessionId: null,
    goal: null,
    supervisor: null,
    emitter: null,
    openModal: () => {},
    showToast: () => {}, cycleTheme: () => {},
    startSession: async () => {},
    resumeSession: async () => {},
    stopSession: () => {},
    togglePause: () => false,
    paused: false,
    pushEntry: () => {},
  };
}

// Regression: /login used to call the console.log-based CLI loginCommand, which
// wrote to raw stdout and corrupted the Ink frame (ghost prompt). It must now
// open the in-TUI LoginModal instead.
describe("/login command (TUI)", () => {
  it("is registered", () => {
    expect(loginHandler).toBeDefined();
  });

  it("routes to the login modal carrying the provider, never writes stdout", async () => {
    const result = await loginHandler!.execute([], ctx());
    expect(result).toEqual({ type: "modal", modal: "login", data: { provider: "all" } });
  });

  it("passes through an explicit provider", async () => {
    const result = await loginHandler!.execute(["scite"], ctx());
    expect(result).toEqual({ type: "modal", modal: "login", data: { provider: "scite" } });
  });

  it("rejects an invalid provider with an error", async () => {
    const result = await loginHandler!.execute(["bogus"], ctx());
    expect(result.type).toBe("error");
  });
});
