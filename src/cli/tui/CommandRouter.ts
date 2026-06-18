import type { ContextStore } from "../../memory/contextStore.js";
import type { SupervisorAgent } from "../../agents/supervisor.js";
import type { EventEmitter } from "events";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type MainViewName =
  | "dashboard"
  | "results"
  | "graph"
  | "overview"
  | "thinking"
  | "activity"
  | "empty";

export type ModalName =
  | "run"
  | "feedback"
  | "inject"
  | "export"
  | "design"
  | "delete"
  | "budget"
  | "strategy"
  | null;

export interface AppContext {
  memory: ContextStore;
  sessionId: string | null;
  goal: string | null;
  supervisor: SupervisorAgent | null;
  emitter: EventEmitter | null;
  setMainView: (view: MainViewName) => void;
  openModal: (modal: ModalName, data?: unknown) => void;
  closeModal: () => void;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
  startSession: (goal: string, opts?: { name?: string; budget?: number; maxHypotheses?: number }) => Promise<void>;
  stopSession: () => void;
  togglePause: () => boolean;
  paused: boolean;
}

export interface CommandSuggestion {
  name: string;
  description: string;
  category: string;
  active: boolean;
}

export type RouteResult =
  | { type: "immediate"; message?: string }
  | { type: "view_switch"; view: MainViewName; message?: string }
  | { type: "modal"; modal: ModalName; message?: string }
  | { type: "error"; message: string }
  | { type: "exit" };

export interface CommandHandler {
  readonly name: string;
  readonly description: string;
  readonly category: "Lifecycle" | "Control" | "Results" | "Actions" | "System";
  execute(args: string[], ctx: AppContext): Promise<RouteResult>;
  autocomplete?(partial: string, ctx: AppContext): CommandSuggestion[];
  activeWhen?(ctx: AppContext): boolean;
}

// ─── Registry ──────────────────────────────────────────────────────────────────

const registry = new Map<string, CommandHandler>();

export function registerCommand(h: CommandHandler): void {
  registry.set(h.name, h);
}

export function getCommand(name: string): CommandHandler | undefined {
  return registry.get(name);
}

export function getAllCommands(): CommandHandler[] {
  return [...registry.values()];
}

/** Clear all registered commands (useful for testing). */
export function resetRegistry(): void {
  registry.clear();
}

// ─── Routing ───────────────────────────────────────────────────────────────────

export async function route(
  input: string,
  ctx: AppContext,
): Promise<RouteResult | { type: "session_start"; goal: string }> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { type: "error", message: "" };
  }

  if (!trimmed.startsWith("/")) {
    if (ctx.sessionId && ctx.supervisor && !ctx.paused) {
      return {
        type: "error",
        message: "Session already running. Use /stop first, or /pause to pause.",
      };
    }
    return { type: "session_start", goal: trimmed };
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const name = parts[0];
  const args = parts.slice(1);
  const handler = registry.get(name);

  if (!handler) {
    return {
      type: "error",
      message: `Unknown command: /${name}. Type /help for available commands.`,
    };
  }

  if (handler.activeWhen && !handler.activeWhen(ctx)) {
    return { type: "error", message: `/${name} is not available right now.` };
  }

  return handler.execute(args, ctx);
}

// ─── Suggestions ───────────────────────────────────────────────────────────────

export function getSuggestions(partial: string, ctx: AppContext): CommandSuggestion[] {
  if (!partial.startsWith("/")) return [];
  const query = partial.slice(1).toLowerCase();
  const all = getAllCommands();
  const matching = query
    ? all.filter((c) => c.name.startsWith(query) || c.name.includes(query))
    : all;
  return matching.map((c) => ({
    name: `/${c.name}`,
    description: c.description,
    category: c.category,
    active: c.activeWhen ? c.activeWhen(ctx) : true,
  }));
}
