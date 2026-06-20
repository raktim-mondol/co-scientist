import { registerCommand, getAllCommands } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";
import { formatHelp } from "../formatters.js";

const helpCommand: CommandHandler = {
  name: "help",
  description: "Show all available commands",
  category: "System",
  async execute(_args, ctx) {
    const commands = getAllCommands().map((c) => ({
      name: c.name,
      description: c.description,
      category: c.category,
      activeWhen: c.activeWhen,
    }));

    const entry = formatHelp(commands, ctx);
    return { type: "transcript", entries: [entry] };
  },
};

registerCommand(helpCommand);
