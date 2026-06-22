import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const pauseCommand: CommandHandler = {
  name: "pause",
  description: "Pause the running session (resume via /sessions)",
  category: "Lifecycle",
  activeWhen: (ctx) => ctx.sessionId !== null && ctx.supervisor !== null && !ctx.paused,
  async execute(_args, ctx) {
    // togglePause() in App.tsx pushes a persistent "Session paused." notice,
    // so we return no toast message to avoid a duplicate.
    ctx.togglePause();
    return { type: "immediate" };
  },
};

registerCommand(pauseCommand);
