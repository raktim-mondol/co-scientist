import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const killCommand: CommandHandler = {
  name: "kill",
  description: "Kill (reject) a hypothesis",
  category: "Control",
  activeWhen: (ctx) => ctx.sessionId !== null && ctx.supervisor !== null && !ctx.paused,
  async execute(args, ctx) {
    if (args.length > 0) {
      const hyp = ctx.memory.getAllActiveHypotheses(ctx.sessionId!).find(
        (h) => h.id.startsWith(args[0]),
      );
      if (!hyp) {
        return { type: "error", message: `Hypothesis not found: ${args[0]}` };
      }
      ctx.memory.updateHypothesisStatus(hyp.id, "rejected");
      return { type: "immediate", message: `Killed "${hyp.title.slice(0, 40)}".` };
    }
    // No args — open KillModal
    return { type: "modal", modal: "kill" };
  },
};

registerCommand(killCommand);
