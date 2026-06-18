import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const strategyCommand: CommandHandler = {
  name: "strategy",
  description: "View current task sampling weights",
  category: "Control",
  activeWhen: (ctx) => ctx.sessionId !== null && ctx.supervisor !== null,
  async execute(_args, _ctx) {
    return { type: "modal", modal: "strategy" };
  },
};

registerCommand(strategyCommand);
