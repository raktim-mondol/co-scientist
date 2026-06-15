import chalk from "chalk";
import {
  getConsensusAccessToken,
  clearConsensusTokens,
  hasValidConsensusTokens,
  CONSENSUS_TOKEN_PATH,
} from "../../tools/consensusAuth.js";
import {
  getSciteAccessToken,
  clearSciteTokens,
  hasValidSciteTokens,
  SCITE_TOKEN_PATH,
} from "../../tools/sciteAuth.js";
import { resetMCPManager } from "../../tools/mcpClient.js";

type Provider = "consensus" | "scite" | "all";

function showAuthStatus() {
  const consensusOk = hasValidConsensusTokens();
  const sciteOk = hasValidSciteTokens();

  console.log(chalk.bold.cyan("\n🔐 Auth Status\n"));
  console.log(chalk.gray("─".repeat(50)));

  const cIcon = consensusOk ? chalk.green("✓") : chalk.red("✗");
  const sIcon = sciteOk ? chalk.green("✓") : chalk.red("✗");
  const cStatus = consensusOk ? chalk.green("logged in") : chalk.red("not logged in");
  const sStatus = sciteOk ? chalk.green("logged in") : chalk.red("not logged in");

  console.log(`  ${cIcon} Consensus: ${cStatus}`);
  console.log(`    Tokens: ${CONSENSUS_TOKEN_PATH}`);
  console.log(`  ${sIcon} Scite:     ${sStatus}`);
  console.log(`    Tokens: ${SCITE_TOKEN_PATH}`);
  console.log(chalk.gray("─".repeat(50)) + "\n");
}

export async function loginCommand(options: { provider: string }) {
  const provider = options.provider as Provider;

  if (provider !== "consensus" && provider !== "scite" && provider !== "all") {
    console.log(
      chalk.red(`Invalid provider "${provider}". Use: consensus, scite, or all.`)
    );
    process.exit(1);
  }

  showAuthStatus();

  const wantConsensus = provider === "consensus" || provider === "all";
  const wantScite = provider === "scite" || provider === "all";

  let anySucceeded = false;

  // ── Consensus ──────────────────────────────────────────────────────────
  if (wantConsensus) {
    console.log(chalk.bold.yellow("Consensus — Starting OAuth login...\n"));

    // Clear any existing tokens so we always get a fresh login
    clearConsensusTokens();

    try {
      const token = await getConsensusAccessToken();
      if (token) {
        console.log(
          chalk.green("✓") + " Consensus login successful.\n"
        );
        anySucceeded = true;
      } else {
        console.log(chalk.red("✗") + " Consensus login failed — no token returned.\n");
      }
    } catch (err) {
      console.log(
        chalk.red(`✗ Consensus login failed: ${(err as Error).message}\n`)
      );
    }
  }

  // ── Scite ──────────────────────────────────────────────────────────────
  if (wantScite) {
    console.log(chalk.bold.yellow("Scite — Starting OAuth login...\n"));

    // Clear any existing tokens so we always get a fresh login
    clearSciteTokens();

    try {
      const token = await getSciteAccessToken();
      if (token) {
        console.log(
          chalk.green("✓") + " Scite login successful.\n"
        );
        anySucceeded = true;
      } else {
        console.log(chalk.red("✗") + " Scite login failed — no token returned.\n");
      }
    } catch (err) {
      console.log(
        chalk.red(`✗ Scite login failed: ${(err as Error).message}\n`)
      );
    }
  }

  // Reset the MCP manager singleton so the next session picks up the new tokens
  resetMCPManager();

  // ── Final status ───────────────────────────────────────────────────────
  showAuthStatus();

  if (anySucceeded) {
    console.log(
      chalk.green("Login complete. You can now run ") +
        chalk.bold.cyan("co-scientist run") +
        chalk.green(" to start a session.\n")
    );
  } else {
    console.log(
      chalk.red("Login failed for all requested providers.\n")
    );
    process.exit(1);
  }
}
