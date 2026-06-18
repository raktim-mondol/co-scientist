import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const boostCommand: CommandHandler = {
  name: "boost",
  description: "Boost a hypothesis Elo rating",
  category: "Control",
  activeWhen: (ctx) => ctx.sessionId !== null && ctx.supervisor !== null && !ctx.paused,
  async execute(args, ctx) {
    if (args.length > 0) {
      // Hypothesis ID provided — boost directly to a default +100 Elo
      const hyp = ctx.memory.getAllActiveHypotheses(ctx.sessionId!).find(
        (h) => h.id.startsWith(args[0]),
      );
      if (!hyp) {
        return { type: "error", message: `Hypothesis not found: ${args[0]}` };
      }
      const newElo = Math.round(hyp.eloRating) + 100;
      ctx.memory.atomicGlicko2Update(hyp.id, (c) => ({ ...c, rating: newElo }));
      return { type: "immediate", message: `Boosted "${hyp.title.slice(0, 40)}" to ${newElo} Elo.` };
    }
    // No args — open BoostModal
    return { type: "modal", modal: "boost" };
  },
};

registerCommand(boostCommand);
