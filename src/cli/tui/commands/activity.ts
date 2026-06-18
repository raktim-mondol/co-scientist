import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const activityCommand: CommandHandler = {
  name: "activity",
  description: "View session activity log",
  category: "Results",
  activeWhen: (ctx) => ctx.sessionId !== null,
  async execute(_args, _ctx) {
    return { type: "view_switch", view: "activity" };
  },
};

registerCommand(activityCommand);
