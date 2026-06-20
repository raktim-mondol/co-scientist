import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";
import { formatUserGoal, formatSystemNotice } from "../formatters.js";

const runCommand: CommandHandler = {
  name: "run",
  description: "Start a new research session",
  category: "Lifecycle",
  activeWhen: (ctx) => !ctx.sessionId,
  async execute(args, ctx) {
    if (args.length > 0) {
      const goal = args.join(" ");
      await ctx.startSession(goal);
      return {
        type: "transcript",
        entries: [
          formatUserGoal(goal),
          formatSystemNotice("Session started.", "success"),
        ],
        message: "Session started.",
      };
    }
    return { type: "modal", modal: "run" };
  },
};

registerCommand(runCommand);
