import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";
import { formatActivity } from "../formatters.js";

const activityCommand: CommandHandler = {
  name: "activity",
  description: "View session activity log",
  category: "Results",
  activeWhen: (ctx) => ctx.sessionId !== null,
  async execute(_args, ctx) {
    const entry = formatActivity(ctx.memory, ctx.sessionId!);
    return { type: "transcript", entries: [entry] };
  },
};

registerCommand(activityCommand);
