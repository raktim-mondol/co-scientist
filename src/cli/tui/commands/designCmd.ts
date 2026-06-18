import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const designCmdHandler: CommandHandler = {
  name: "design",
  description: "Generate experimental protocol for a hypothesis",
  category: "Actions",
  activeWhen: (ctx) => ctx.sessionId !== null && ctx.supervisor !== null,
  async execute(_args, _ctx) {
    // Open DesignModal — hypothesis picker is inside
    // The modal calls ExperimentDesignAgent internally
    return { type: "modal", modal: "design" };
  },
};

registerCommand(designCmdHandler);
