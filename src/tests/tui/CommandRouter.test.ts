import { describe, it, expect, beforeEach } from "bun:test";
import { EventEmitter } from "events";
import type { ContextStore } from "../../memory/contextStore.js";
import type { SupervisorAgent } from "../../agents/supervisor.js";
import {
  route,
  registerCommand,
  resetRegistry,
  getSuggestions,
  type AppContext,
  type CommandHandler,
  type RouteResult,
} from "../../cli/tui/CommandRouter.js";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function createMockContext(overrides?: Partial<AppContext>): AppContext {
  return {
    memory: {} as ContextStore,
    sessionId: null,
    goal: null,
    supervisor: null,
    emitter: null,
    setMainView: () => {},
    openModal: () => {},
    closeModal: () => {},
    showToast: () => {},
    startSession: async () => {},
    stopSession: () => {},
    togglePause: () => false,
    paused: false,
    ...overrides,
  };
}

const dummyHandler: CommandHandler = {
  name: "testcmd",
  description: "A test command",
  category: "System",
  execute: async (_args: string[], _ctx: AppContext): Promise<RouteResult> => ({
    type: "immediate",
  }),
};

beforeEach(() => {
  resetRegistry();
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("route()", () => {
  it("free text returns session_start", async () => {
    const ctx = createMockContext();
    const result = await route("test goal", ctx);
    expect(result.type).toBe("session_start");
    if (result.type === "session_start") {
      expect(result.goal).toBe("test goal");
    }
  });

  it("slash command dispatches to registered handler", async () => {
    let executed = false;
    const handler: CommandHandler = {
      name: "mycmd",
      description: "My command",
      category: "System",
      execute: async () => {
        executed = true;
        return { type: "immediate" };
      },
    };
    registerCommand(handler);
    const result = await route("/mycmd", createMockContext());
    expect(executed).toBe(true);
    expect(result.type).toBe("immediate");
  });

  it("unknown command returns error", async () => {
    const ctx = createMockContext();
    const result = await route("/nonexistent", ctx);
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.message).toContain("Unknown command");
    }
  });

  it("empty input returns error with empty message", async () => {
    const ctx = createMockContext();
    const result = await route("", ctx);
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.message).toBe("");
    }
  });

  it("spaces-only input returns error with empty message", async () => {
    const ctx = createMockContext();
    const result = await route("   ", ctx);
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.message).toBe("");
    }
  });

  it("handler.activeWhen returns false -> error", async () => {
    const handler: CommandHandler = {
      name: "conditional",
      description: "Conditional command",
      category: "System",
      execute: async () => ({ type: "immediate" }),
      activeWhen: () => false,
    };
    registerCommand(handler);
    const result = await route("/conditional", createMockContext());
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.message).toContain("not available");
    }
  });

  it("free text when session already running -> error", async () => {
    const ctx = createMockContext({
      sessionId: "session-123",
      supervisor: {} as SupervisorAgent,
      paused: false,
    });
    const result = await route("another goal", ctx);
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.message).toContain("already running");
    }
  });

  it("free text allowed when session is paused", async () => {
    const ctx = createMockContext({
      sessionId: "session-123",
      supervisor: {} as SupervisorAgent,
      paused: true,
    });
    const result = await route("new goal while paused", ctx);
    expect(result.type).toBe("session_start");
  });

  it("passes arguments to handler", async () => {
    let capturedArgs: string[] | null = null;
    const handler: CommandHandler = {
      name: "echo",
      description: "Echo args",
      category: "System",
      execute: async (args: string[]) => {
        capturedArgs = args;
        return { type: "immediate" };
      },
    };
    registerCommand(handler);
    await route("/echo foo bar baz", createMockContext());
    expect(capturedArgs).toEqual(["foo", "bar", "baz"]);
  });
});

describe("getSuggestions()", () => {
  it("returns matching commands for partial slash input", () => {
    registerCommand({
      name: "help",
      description: "Show help",
      category: "System",
      execute: async () => ({ type: "immediate" }),
    });
    registerCommand({
      name: "history",
      description: "Show history",
      category: "System",
      execute: async () => ({ type: "immediate" }),
    });
    const suggestions = getSuggestions("/h", createMockContext());
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((s) => s.name.startsWith("/h"))).toBe(true);
  });

  it("returns empty list for non-slash input", () => {
    registerCommand(dummyHandler);
    const suggestions = getSuggestions("help", createMockContext());
    expect(suggestions).toEqual([]);
  });

  it("returns all commands for bare slash", () => {
    registerCommand({
      name: "help",
      description: "Show help",
      category: "System",
      execute: async () => ({ type: "immediate" }),
    });
    registerCommand({
      name: "quit",
      description: "Quit the TUI",
      category: "Lifecycle",
      execute: async () => ({ type: "exit" }),
    });
    const suggestions = getSuggestions("/", createMockContext());
    expect(suggestions.length).toBe(2);
  });

  it("marks inactive commands based on activeWhen", () => {
    registerCommand({
      name: "stop",
      description: "Stop session",
      category: "Control",
      execute: async () => ({ type: "immediate" }),
      activeWhen: (ctx: AppContext) => !!ctx.sessionId,
    });
    // No session → inactive
    const suggestions = getSuggestions("/", createMockContext());
    expect(suggestions[0].active).toBe(false);
    // With session → active
    const ctxWithSession = createMockContext({ sessionId: "s1" });
    const suggestionsActive = getSuggestions("/", ctxWithSession);
    expect(suggestionsActive[0].active).toBe(true);
  });
});
