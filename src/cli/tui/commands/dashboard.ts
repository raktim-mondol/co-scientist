import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const dashboardCommand: CommandHandler = {
  name: "dashboard",
  description: "Switch to the live dashboard view",
  category: "Lifecycle",
  activeWhen: (ctx) => ctx.sessionId !== null,
  async execute(_args, _ctx) {
    return { type: "view_switch", view: "dashboard" };
  },
};

registerCommand(dashboardCommand);
