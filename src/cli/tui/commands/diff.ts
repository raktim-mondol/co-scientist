import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";
import { formatDiff } from "../formatters.js";

const diffCommand: CommandHandler = {
  name: "diff",
  description: "Show hypothesis evolution lineage",
  category: "Results",
  activeWhen: (ctx) => ctx.sessionId !== null,
  async execute(args, ctx) {
    if (args.length < 1) {
      return {
        type: "error",
        message: "Usage: /diff <id_prefix>. Use /results to see IDs.",
      };
    }

    const entry = formatDiff(ctx.memory, ctx.sessionId!, args[0]);
    return { type: "transcript", entries: [entry] };
  },
};

registerCommand(diffCommand);
