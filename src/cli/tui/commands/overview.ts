import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const overviewCommand: CommandHandler = {
  name: "overview",
  description: "View the research overview and meta-review",
  category: "Results",
  activeWhen: (ctx) => {
    if (!ctx.sessionId) return false;
    const session = ctx.memory.getSession(ctx.sessionId);
    // Active when session exists AND has an overview or is completed
    return session !== null && (session.status === "completed" || session.researchOverview !== null);
  },
  async execute(_args, _ctx) {
    return { type: "view_switch", view: "overview" };
  },
};

registerCommand(overviewCommand);
