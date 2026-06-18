import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const resumeCommand: CommandHandler = {
  name: "resume",
  description: "Resume the paused session",
  category: "Lifecycle",
  activeWhen: (ctx) => ctx.sessionId !== null && ctx.supervisor !== null && ctx.paused,
  async execute(_args, ctx) {
    ctx.togglePause();
    return { type: "immediate", message: "Session resumed." };
  },
};

registerCommand(resumeCommand);
