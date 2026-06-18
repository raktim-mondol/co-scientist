import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const deleteCmdHandler: CommandHandler = {
  name: "delete",
  description: "Delete sessions and their data",
  category: "Actions",
  // Always active — you can delete past sessions even when no session is running
  async execute(_args, _ctx) {
    return { type: "modal", modal: "delete" };
  },
};

registerCommand(deleteCmdHandler);
