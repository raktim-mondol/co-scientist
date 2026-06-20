import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";
import { formatGraph } from "../formatters.js";

const graphCommand: CommandHandler = {
  name: "graph",
  description: "View hypothesis relationship graph",
  category: "Results",
  activeWhen: (ctx) => ctx.sessionId !== null,
  async execute(_args, ctx) {
    const entry = formatGraph(ctx.memory, ctx.sessionId!);
    return { type: "transcript", entries: [entry] };
  },
};

registerCommand(graphCommand);
