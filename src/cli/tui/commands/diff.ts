import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

/**
 * Walk the parent chain of a hypothesis to reconstruct its evolution lineage.
 */
function getLineage(
  memory: import("../../../memory/contextStore.js").ContextStore,
  sessionId: string,
  hypothesisId: string,
): Array<{ id: string; title: string; strategy: string }> {
  const chain: Array<{ id: string; title: string; strategy: string }> = [];
  const visited = new Set<string>();
  let current = memory.getHypothesis(hypothesisId);

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    chain.unshift({
      id: current.id,
      title: current.title,
      strategy: current.generationStrategy,
    });
    // Follow the first parent (most hypotheses have one parent)
    const parentId = current.parentIds?.[0];
    current = parentId ? memory.getHypothesis(parentId) : null;
  }

  return chain;
}

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
    const hyps = ctx.memory.getAllActiveHypotheses(ctx.sessionId!);
    const hyp = hyps.find((h) => h.id.startsWith(args[0]));
    if (!hyp) return { type: "error", message: `Hypothesis not found: ${args[0]}` };

    const chain = getLineage(ctx.memory, ctx.sessionId!, hyp.id);

    const lines = chain.map(
      (h, i) => `${i === chain.length - 1 ? "└─" : "├─"} ${h.title.slice(0, 60)} [${h.strategy}]`,
    );

    return {
      type: "immediate",
      message: [`Lineage for ${hyp.title.slice(0, 50)} (${chain.length} nodes):`, ...lines].join("\n"),
    };
  },
};

registerCommand(diffCommand);
