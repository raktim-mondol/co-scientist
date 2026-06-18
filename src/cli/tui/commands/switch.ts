import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

/**
 * Switch to a different session. If an ID prefix is provided, tries to load it.
 * Without args, shows a picker via a view switch (reuses the existing session list).
 */
const switchCommand: CommandHandler = {
  name: "switch",
  description: "Switch to a different session",
  category: "System",
  async execute(args, ctx) {
    const sessions = ctx.memory.listSessions();

    if (args.length > 0) {
      const query = args.join(" ").toLowerCase();
      const match = sessions.find(
        (s) => s.id.startsWith(query) || s.name.toLowerCase().includes(query),
      );
      if (!match) {
        return {
          type: "error",
          message: `No session matching "${query}". Use /sessions to list all.`,
        };
      }
      if (match.id === ctx.sessionId) {
        return { type: "immediate", message: "Already on this session." };
      }
      if (match.status === "running") {
        return {
          type: "error",
          message: `Session "${match.name}" is currently running. Use /stop first, or connect via CLI.`,
        };
      }
      // Load the session into App state — we need a callback for this
      // For now, report the session info and ask the user to use CLI
      return {
        type: "immediate",
        message: `Session found: "${match.name}" (${match.id.slice(0, 8)}).\nUse co-scientist resume ${match.id.slice(0, 8)} from CLI to load this session in the TUI.`,
      };
    }

    // No args — show session list inline
    if (sessions.length === 0) {
      return { type: "error", message: "No sessions available to switch to." };
    }

    const lines: string[] = ["", "Available sessions (use /switch <id-or-name>):"];
    for (const s of sessions) {
      if (s.id === ctx.sessionId) continue; // skip current
      const hyps = s.stats?.totalHypotheses ?? 0;
      const name = s.name.length > 45 ? s.name.slice(0, 42) + "..." : s.name;
      lines.push(`  ${s.id.slice(0, 8)} | ${s.status} | ${hyps}h | ${name}`);
    }
    if (lines.length === 2) {
      lines.push("  (no other sessions)");
    }

    return { type: "immediate", message: lines.join("\n") };
  },
};

registerCommand(switchCommand);
