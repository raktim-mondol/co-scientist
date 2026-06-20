import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const dashboardCommand: CommandHandler = {
  name: "dashboard",
  description: "View the live dashboard (always visible above the prompt)",
  category: "Lifecycle",
  activeWhen: (ctx) => ctx.sessionId !== null,
  async execute(_args, _ctx) {
    return {
      type: "immediate",
      message: "The live leaderboard is always visible above the prompt when a session runs.",
    };
  },
};

registerCommand(dashboardCommand);
