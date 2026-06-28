import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";
const themeCommand: CommandHandler = {
  name: "theme",
  description: "Toggle between dark and light themes",
  category: "System",
  async execute(_args, ctx) {
    ctx.cycleTheme();
    // The theme provider state is reactive — after cycleTheme() the full
    // tree re-renders with the new theme. We show a brief toast to confirm.
    return { type: "immediate", message: "theme toggled" };
  },
};

registerCommand(themeCommand);