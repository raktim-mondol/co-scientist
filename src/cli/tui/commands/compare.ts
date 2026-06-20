import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";
import { formatCompare } from "../formatters.js";

const compareCommand: CommandHandler = {
  name: "compare",
  description: "Compare two hypotheses side-by-side",
  category: "Results",
  activeWhen: (ctx) => ctx.sessionId !== null,
  async execute(args, ctx) {
    if (args.length < 2) {
      return {
        type: "error",
        message: "Usage: /compare <id1_prefix> <id2_prefix>. Use /results to see IDs.",
      };
    }

    const entry = formatCompare(ctx.memory, ctx.sessionId!, args[0], args[1]);
    return { type: "transcript", entries: [entry] };
  },
};

registerCommand(compareCommand);
