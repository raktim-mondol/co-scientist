import type { TranscriptEntry } from "./Transcript.js";

// Re-export the command-facing context type from its new home in
// contexts/AppContext.tsx (Phase 3). Existing imports of `AppContext` from
// this module keep working.
export type { AppContext } from "./contexts/AppContext.js";
import type { AppContext } from "./contexts/AppContext.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ModalName =
  | "run"
  | "feedback"
  | "inject"
  | "kill"
  | "boost"
  | "export"
  | "design"
  | "sessions"
  | "budget"
  | "strategy"
  | "login"
  | null;

export interface CommandSuggestion {
  name: string;
  description: string;
  category: string;
  active: boolean;
}

export type RouteResult =
  | { type: "immediate"; message?: string }
  | { type: "transcript"; entries: TranscriptEntry[]; message?: string }
  | { type: "modal"; modal: ModalName; message?: string; data?: unknown }
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

/**
 * Returns true when every character of `query` appears in `name` in order
 * (subsequence match). E.g. "gp" is a fuzzy subsequence match for "graph"
 * even though "graph".includes("gp") is false.
 */
export function fuzzySubsequenceMatch(query: string, name: string): boolean {
  let qi = 0;
  for (let ni = 0; ni < name.length && qi < query.length; ni++) {
    if (name[ni] === query[qi]) qi++;
  }
  return qi === query.length;
}

export function getSuggestions(partial: string, ctx: AppContext): CommandSuggestion[] {
  if (!partial.startsWith("/")) return [];
  const query = partial.slice(1).toLowerCase();
  const all = getAllCommands();
  if (!query) {
    return all.map((c) => ({
      name: `/${c.name}`,
      description: c.description,
      category: c.category,
      active: c.activeWhen ? c.activeWhen(ctx) : true,
    }));
  }

  // Tier 1: prefix or substring matches (existing behavior, preserved).
  const tier1 = all.filter(
    (c) => c.name.startsWith(query) || c.name.includes(query),
  );

  // Tier 2: fuzzy subsequence matches that aren't already in tier 1.
  const tier1Names = new Set(tier1.map((c) => c.name));
  const tier2 = all.filter(
    (c) => !tier1Names.has(c.name) && fuzzySubsequenceMatch(query, c.name),
  );

  const matching = [...tier1, ...tier2];
  return matching.map((c) => ({
    name: `/${c.name}`,
    description: c.description,
    category: c.category,
    active: c.activeWhen ? c.activeWhen(ctx) : true,
  }));
}
