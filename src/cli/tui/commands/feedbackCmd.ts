import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const feedbackCmdHandler: CommandHandler = {
  name: "feedback",
  description: "Submit experimental feedback on a hypothesis",
  category: "Actions",
  activeWhen: (ctx) => ctx.sessionId !== null && ctx.supervisor !== null,
  async execute(_args, _ctx) {
    // Always open the FeedbackModal — hypothesis picker is inside
    return { type: "modal", modal: "feedback" };
  },
};

registerCommand(feedbackCmdHandler);
