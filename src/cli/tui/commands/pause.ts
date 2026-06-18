import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const pauseCommand: CommandHandler = {
  name: "pause",
  description: "Pause the running session",
  category: "Lifecycle",
  activeWhen: (ctx) => ctx.sessionId !== null && ctx.supervisor !== null && !ctx.paused,
  async execute(_args, ctx) {
    ctx.togglePause();
    return { type: "immediate", message: "Session paused." };
  },
};

registerCommand(pauseCommand);
