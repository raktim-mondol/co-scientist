import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const resultsCommand: CommandHandler = {
  name: "results",
  description: "View ranked hypotheses",
  category: "Results",
  activeWhen: (ctx) => ctx.sessionId !== null,
  async execute(_args, _ctx) {
    return { type: "view_switch", view: "results" };
  },
};

registerCommand(resultsCommand);
