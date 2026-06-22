import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";
import { clearConsensusTokens, hasValidConsensusTokens } from "../../../tools/consensusAuth.js";
import { clearSciteTokens, hasValidSciteTokens } from "../../../tools/sciteAuth.js";
import { resetMCPManager } from "../../../tools/mcpClient.js";
import { formatSystemNotice } from "../formatters.js";

const logoutCmdHandler: CommandHandler = {
  name: "logout",
  description: "Log out of search providers",
  category: "System",
  async execute(args, _ctx) {
    const provider = args[0] ?? "all";
    if (provider !== "consensus" && provider !== "scite" && provider !== "all") {
      return { type: "error", message: 'Provider must be "consensus", "scite", or "all".' };
    }

    const results: string[] = [];

    if (provider === "consensus" || provider === "all") {
      const wasLoggedIn = hasValidConsensusTokens();
      clearConsensusTokens();
      results.push(`Consensus: ${wasLoggedIn ? "logged out ✓" : "was not logged in"}`);
    }

    if (provider === "scite" || provider === "all") {
      const wasLoggedIn = hasValidSciteTokens();
      clearSciteTokens();
      results.push(`Scite: ${wasLoggedIn ? "logged out ✓" : "was not logged in"}`);
    }

    resetMCPManager();

    return { type: "transcript", entries: [formatSystemNotice(results.join(" | "), "success")] };
  },
};

registerCommand(logoutCmdHandler);
