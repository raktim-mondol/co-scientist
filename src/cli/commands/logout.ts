import chalk from "chalk";
import {
  clearConsensusTokens,
  hasValidConsensusTokens,
  CONSENSUS_TOKEN_PATH,
} from "../../tools/consensusAuth.js";
import {
  clearSciteTokens,
  hasValidSciteTokens,
  SCITE_TOKEN_PATH,
} from "../../tools/sciteAuth.js";
import { resetMCPManager } from "../../tools/mcpClient.js";

type Provider = "consensus" | "scite" | "all";

export async function logoutCommand(options: { provider: string }) {
  const provider = options.provider as Provider;

  if (provider !== "consensus" && provider !== "scite" && provider !== "all") {
    console.log(
      chalk.red(`Invalid provider "${provider}". Use: consensus, scite, or all.`)
    );
    process.exit(1);
  }

  const wantConsensus = provider === "consensus" || provider === "all";
  const wantScite = provider === "scite" || provider === "all";

  // ── Show current status ────────────────────────────────────────────────
  console.log(chalk.bold.cyan("\n🔐 Current Auth Status\n"));
  console.log(chalk.gray("─".repeat(50)));

  if (wantConsensus) {
    const wasLoggedIn = hasValidConsensusTokens();
    const icon = wasLoggedIn ? chalk.green("✓ logged in") : chalk.yellow("~ not logged in");
    console.log(`  Consensus: ${icon}`);
    console.log(`    Tokens: ${CONSENSUS_TOKEN_PATH}`);
  }
  if (wantScite) {
    const wasLoggedIn = hasValidSciteTokens();
    const icon = wasLoggedIn ? chalk.green("✓ logged in") : chalk.yellow("~ not logged in");
    console.log(`  Scite:     ${icon}`);
    console.log(`    Tokens: ${SCITE_TOKEN_PATH}`);
  }
  console.log(chalk.gray("─".repeat(50)) + "\n");

  // ── Logout ─────────────────────────────────────────────────────────────
  let anyCleared = false;

  if (wantConsensus) {
    const wasLoggedIn = hasValidConsensusTokens();
    clearConsensusTokens();
    if (wasLoggedIn) {
      console.log(chalk.green("✓") + " Consensus — logged out. Tokens cleared.");
      anyCleared = true;
    } else {
      console.log(chalk.yellow("~") + " Consensus — was not logged in (no tokens to clear).");
    }
  }

  if (wantScite) {
    const wasLoggedIn = hasValidSciteTokens();
    clearSciteTokens();
    if (wasLoggedIn) {
      console.log(chalk.green("✓") + " Scite — logged out. Tokens cleared.");
      anyCleared = true;
    } else {
      console.log(chalk.yellow("~") + " Scite — was not logged in (no tokens to clear).");
    }
  }

  // Reset the MCP manager singleton so any running session re-auths fresh
  resetMCPManager();

  if (anyCleared) {
    console.log(
      `\n${chalk.green("✓")} You can log back in with ` +
        chalk.bold.cyan("co-scientist login") +
        chalk.green(" at any time.\n")
    );
  } else {
    console.log(
      `\n${chalk.yellow("~")} No active sessions to log out from.\n`
    );
  }
}
