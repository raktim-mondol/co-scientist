import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

/** Opens the unified, windowed sessions picker (view / resume / overview / export / delete). */
const sessionsCommand: CommandHandler = {
  name: "sessions",
  description: "Browse, resume, and manage research sessions",
  category: "System",
  async execute(_args, _ctx) {
    return { type: "modal", modal: "sessions" };
  },
};

registerCommand(sessionsCommand);
