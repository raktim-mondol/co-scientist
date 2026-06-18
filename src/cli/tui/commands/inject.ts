import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const injectCommand: CommandHandler = {
  name: "inject",
  description: "Inject a new hypothesis",
  category: "Control",
  activeWhen: (ctx) => ctx.sessionId !== null && ctx.supervisor !== null && !ctx.paused,
  async execute(_args, _ctx) {
    return { type: "modal", modal: "inject" };
  },
};

registerCommand(injectCommand);
