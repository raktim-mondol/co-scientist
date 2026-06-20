import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";
import { formatOverview } from "../formatters.js";

const overviewCommand: CommandHandler = {
  name: "overview",
  description: "View the research overview and meta-review",
  category: "Results",
  activeWhen: (ctx) => {
    if (!ctx.sessionId) return false;
    const session = ctx.memory.getSession(ctx.sessionId);
    return session !== null && (session.status === "completed" || session.researchOverview !== null);
  },
  async execute(_args, ctx) {
    const entries = formatOverview(ctx.memory, ctx.sessionId!);
    return { type: "transcript", entries };
  },
};

registerCommand(overviewCommand);
