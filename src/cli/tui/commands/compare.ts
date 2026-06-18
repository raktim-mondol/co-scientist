import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const compareCommand: CommandHandler = {
  name: "compare",
  description: "Compare two hypotheses side-by-side",
  category: "Results",
  activeWhen: (ctx) => ctx.sessionId !== null,
  async execute(args, ctx) {
    if (args.length < 2) {
      return {
        type: "error",
        message: "Usage: /compare <id1_prefix> <id2_prefix>. Use /results to see IDs.",
      };
    }
    const hyps = ctx.memory.getAllActiveHypotheses(ctx.sessionId!);
    const h1 = hyps.find((h) => h.id.startsWith(args[0]));
    const h2 = hyps.find((h) => h.id.startsWith(args[1]));
    if (!h1) return { type: "error", message: `Hypothesis not found: ${args[0]}` };
    if (!h2) return { type: "error", message: `Hypothesis not found: ${args[1]}` };

    const fmt = (h: typeof h1) =>
      [
        `Title:    ${h.title}`,
        `Elo:      ${Math.round(h.eloRating)}`,
        `Status:   ${h.status}`,
        `Matches:  ${h.matchesPlayed} (W${h.wins}/L${h.losses}/D${h.draws})`,
        `Strategy: ${h.generationStrategy}`,
        `Summary:  ${h.summary.slice(0, 200)}`,
      ].join("\n");

    // Show as an info toast — the message is formatted for display
    return {
      type: "immediate",
      message: [
        `Comparing ${args[0]} vs ${args[1]}:`,
        `─── ${args[0]} ───`,
        fmt(h1),
        `─── ${args[1]} ───`,
        fmt(h2),
      ].join("\n"),
    };
  },
};

registerCommand(compareCommand);
