import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";
import { formatResults } from "../formatters.js";

const resultsCommand: CommandHandler = {
  name: "results",
  description: "View ranked hypotheses",
  category: "Results",
  activeWhen: (ctx) => ctx.sessionId !== null,
  async execute(_args, ctx) {
    const entry = formatResults(ctx.memory, ctx.sessionId!);
    return { type: "transcript", entries: [entry] };
  },
};

registerCommand(resultsCommand);
