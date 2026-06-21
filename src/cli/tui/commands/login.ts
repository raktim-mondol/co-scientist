import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const loginCmdHandler: CommandHandler = {
  name: "login",
  description: "Authenticate with search providers (Consensus, Scite)",
  category: "System",
  async execute(args, _ctx) {
    const provider = args[0] ?? "all";
    if (provider !== "consensus" && provider !== "scite" && provider !== "all") {
      return { type: "error", message: 'Provider must be "consensus", "scite", or "all".' };
    }

    // The OAuth flow runs inside the TUI via LoginModal — never via the
    // console.log-based CLI loginCommand, which would corrupt the live frame.
    return { type: "modal", modal: "login", data: { provider } };
  },
};

registerCommand(loginCmdHandler);
