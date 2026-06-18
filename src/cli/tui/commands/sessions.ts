import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

/**
 * Lists all sessions inline. Returns a formatted view as an "immediate" message
 * that displays in a toast-like output. Not a separate MainView.
 */
const sessionsCommand: CommandHandler = {
  name: "sessions",
  description: "List all research sessions",
  category: "System",
  async execute(_args, ctx) {
    const sessions = ctx.memory.listSessions();
    if (sessions.length === 0) {
      return { type: "immediate", message: "No sessions found. Start one with /run or type a research topic." };
    }

    // Build a compact table
    const lines: string[] = ["", "Sessions:"];
    const statusGlyph = (s: string) =>
      s === "completed" ? "✓" : s === "running" ? "▶" : s === "paused" ? "⏸" : "·";
    for (const s of sessions) {
      const glyph = statusGlyph(s.status);
      const hyps = s.stats?.totalHypotheses ?? 0;
      const elo = s.stats?.topEloRating ? ` top:${Math.round(s.stats.topEloRating)}` : "";
      const name = s.name.length > 40 ? s.name.slice(0, 37) + "..." : s.name;
      lines.push(`  ${glyph} ${name}`);
      lines.push(`    ${s.id.slice(0, 8)} | ${s.status} | ${hyps}h${elo} | ${s.createdAt.toISOString().slice(0, 10)}`);
    }

    return { type: "immediate", message: lines.join("\n") };
  },
};

registerCommand(sessionsCommand);
