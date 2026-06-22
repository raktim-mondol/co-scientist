import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";
import { formatSystemNotice } from "../formatters.js";

const budgetCommand: CommandHandler = {
  name: "budget",
  description: "View or set the token budget",
  category: "Control",
  activeWhen: (ctx) => ctx.sessionId !== null && ctx.supervisor !== null,
  async execute(args, ctx) {
    if (args.length > 0) {
      const budget = parseInt(args[0], 10);
      if (Number.isNaN(budget) || budget <= 0) {
        return { type: "error", message: "Budget must be a positive integer." };
      }
      process.env.COMPUTE_BUDGET_TOKENS = String(budget);
      // Re-read config so the new budget takes effect immediately
      const { resetConfig, getConfig } = await import("../../../config.js");
      resetConfig();
      const cfg = getConfig();
      return {
        type: "transcript",
        entries: [formatSystemNotice(
          `Token budget set to ${cfg.compute.budgetTokens.toLocaleString()}.`,
          "success",
        )],
      };
    }
    // No args — open BudgetModal
    return { type: "modal", modal: "budget" };
  },
};

registerCommand(budgetCommand);
