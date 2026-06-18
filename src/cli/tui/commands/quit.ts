import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const quitCommand: CommandHandler = {
  name: "quit",
  description: "Exit co-scientist",
  category: "System",
  async execute(_args, _ctx) {
    return { type: "exit" };
  },
};

registerCommand(quitCommand);
