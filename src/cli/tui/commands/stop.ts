import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const stopCommand: CommandHandler = {
  name: "stop",
  description: "Stop the running session",
  category: "Lifecycle",
  activeWhen: (ctx) => ctx.sessionId !== null && ctx.supervisor !== null,
  async execute(_args, ctx) {
    ctx.stopSession();
    return { type: "view_switch", view: "results", message: "Session stopped." };
  },
};

registerCommand(stopCommand);
