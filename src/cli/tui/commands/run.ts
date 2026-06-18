import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const runCommand: CommandHandler = {
  name: "run",
  description: "Start a new research session",
  category: "Lifecycle",
  activeWhen: (ctx) => !ctx.sessionId,
  async execute(args, ctx) {
    if (args.length > 0) {
      // Goal provided as args — start session directly
      const goal = args.join(" ");
      await ctx.startSession(goal);
      return { type: "view_switch", view: "dashboard", message: "Session started." };
    }
    // No args — open the RunModal for interactive input
    return { type: "modal", modal: "run" };
  },
};

registerCommand(runCommand);
