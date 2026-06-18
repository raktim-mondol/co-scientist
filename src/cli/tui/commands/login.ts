import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";
import { loginCommand } from "../../commands/login.js";
import { hasValidConsensusTokens } from "../../../tools/consensusAuth.js";
import { hasValidSciteTokens } from "../../../tools/sciteAuth.js";

const loginCmdHandler: CommandHandler = {
  name: "login",
  description: "Authenticate with search providers (Consensus, Scite)",
  category: "System",
  async execute(args, _ctx) {
    const provider = args[0] ?? "all";
    if (provider !== "consensus" && provider !== "scite" && provider !== "all") {
      return { type: "error", message: 'Provider must be "consensus", "scite", or "all".' };
    }

    try {
      // loginCommand writes to stdout via console.log — capture the result
      await loginCommand({ provider });
    } catch (_err) {
      // loginCommand calls process.exit(1) on failure — but in TUI we intercept that
    }

    // Check auth status after login attempt
    const consensusOk = provider === "all" || provider === "consensus" ? hasValidConsensusTokens() : null;
    const sciteOk = provider === "all" || provider === "scite" ? hasValidSciteTokens() : null;

    const parts: string[] = [];
    if (consensusOk !== null) parts.push(`Consensus: ${consensusOk ? "✓" : "✗"}`);
    if (sciteOk !== null) parts.push(`Scite: ${sciteOk ? "✓" : "✗"}`);

    return {
      type: "immediate",
      message: `Login attempt complete. ${parts.join(" | ")}. Check terminal output for details.`,
    };
  },
};

registerCommand(loginCmdHandler);
