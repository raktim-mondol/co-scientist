import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const graphCommand: CommandHandler = {
  name: "graph",
  description: "View hypothesis relationship graph",
  category: "Results",
  activeWhen: (ctx) => ctx.sessionId !== null,
  async execute(_args, _ctx) {
    return { type: "view_switch", view: "graph" };
  },
};

registerCommand(graphCommand);
