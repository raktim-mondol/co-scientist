import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const thinkingCommand: CommandHandler = {
  name: "thinking",
  description: "View agent thinking traces",
  category: "Results",
  activeWhen: (ctx) => {
    if (!ctx.sessionId) return false;
    return ctx.memory.hasThinkingTraces(ctx.sessionId);
  },
  async execute(_args, _ctx) {
    return { type: "view_switch", view: "thinking" };
  },
};

registerCommand(thinkingCommand);
