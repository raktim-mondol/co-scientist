#!/usr/bin/env bun
import { Command } from "commander";
import "dotenv/config";
import chalk from "chalk";
import { printBanner } from "./banner.js";
import { runCommand } from "./commands/run.js";
import { resumeCommand } from "./commands/resume.js";
import { resultsCommand } from "./commands/results.js";
import { overviewCommand } from "./commands/overview.js";
import { feedbackCommand } from "./commands/feedback.js";
import { exportCommand } from "./commands/export.js";
import { listCommand } from "./commands/list.js";
import { deleteCommand } from "./commands/delete.js";
import { designCommand } from "./commands/design.js";
import { graphCommand } from "./commands/graph.js";
import { compareCommand } from "./commands/compare.js";
import { diffCommand } from "./commands/diff.js";
import { safetyCommand } from "./commands/safety.js";
import { thinkingCommand } from "./commands/thinking.js";
import { activityCommand } from "./commands/activity.js";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";

const program = new Command();

program
  .name("co-scientist")
  .description("Multi-agent AI system for accelerating scientific discovery")
  .version("1.0.0");

program
  .command("run")
  .description("Start a new scientific research session")
  .option("-g, --goal <text>", "Research goal (or omit to enter interactively)")
  .option("-n, --name <name>", "Session name")
  .option("--max-hypotheses <n>", "Maximum hypotheses to generate", "5")
  .option("--max-rounds <n>", "Maximum tournament rounds", "100")
  .option("--budget <tokens>", "Token budget (0 = unlimited)", "500000")
  .option("--seed <n>", "Deterministic seed for reproducible scheduling/sampling")
  .option("--no-tui", "Disable interactive slash commands (plain log output)")
  .action(runCommand);

program
  .command("resume <sessionId>")
  .description("Resume a paused or interrupted session")
  .action(resumeCommand);

program
  .command("list")
  .description("List all research sessions")
  .action(listCommand);

program
  .command("results <sessionId>")
  .description(
    "Display ranked hypotheses for a session\n" +
    "  --top <n>        Show top N hypotheses (default: 10)\n" +
    "  --all            Show all hypotheses including rejected\n" +
    "  --show-feedback  Show full RLEF feedback details per hypothesis"
  )
  .option("-n, --top <n>", "Show top N hypotheses", "10")
  .option("--all", "Show all hypotheses including rejected")
  .option("--show-feedback", "Show full experimental feedback details per hypothesis")
  .action(resultsCommand);

program
  .command("overview <sessionId>")
  .description("Display the final research overview")
  .action(overviewCommand);

program
  .command("feedback <sessionId>")
  .description(
    "Submit feedback to a session\n" +
    "  --experimental   Real-world experiment result (RLEF: updates Elo, injects into agents)\n" +
    "  --hypothesis     Submit a new expert hypothesis into the tournament\n" +
    "  --review <id>    Expert opinion review on an existing hypothesis"
  )
  .option("--hypothesis", "Submit a new hypothesis")
  .option("--review <hypothesisId>", "Submit a review for a specific hypothesis")
  .option("--experimental", "Submit empirical/experimental feedback (RLEF)")
  .action(feedbackCommand);

program
  .command("export <sessionId>")
  .description(
    "Export session results to a file\n" +
    "  --format markdown|json   Output format (default: markdown)\n" +
    "  --output <path>          Write to file instead of stdout\n" +
    "  --all                    Export all active hypotheses (default: top 20)"
  )
  .option("-f, --format <fmt>", "Output format: markdown | json", "markdown")
  .option("-o, --output <path>", "Output file path")
  .option("--all", "Export all active hypotheses (default: top 20)")
  .action(exportCommand);

program
  .command("delete [sessionId]")
  .description(
    "Delete a session and all its data\n" +
    "  --all     Delete all sessions\n" +
    "  --force   Skip confirmation prompt"
  )
  .option("-f, --force", "Skip confirmation prompt")
  .option("--all", "Delete all sessions")
  .action(deleteCommand);

program
  .command("design <sessionId>")
  .description(
    "Generate a structured experimental protocol for a hypothesis\n" +
    "  --hypothesis-id <id>   Target hypothesis (default: top-1 by Elo)"
  )
  .option("--hypothesis-id <id>", "Target a specific hypothesis (default: top-1 by Elo)")
  .action(designCommand);

program
  .command("graph <sessionId>")
  .description(
    "Display or export the knowledge graph for a session\n" +
    "  --format text|dot|json   Output format (default: text)\n" +
    "  --output <path>          Write to file instead of stdout"
  )
  .option("-f, --format <fmt>", "Output format: text | dot | json", "text")
  .option("-o, --output <path>", "Write output to file instead of stdout")
  .action(graphCommand);

program
  .command("compare <sessionId> <hypothesisId1> <hypothesisId2>")
  .description("Run a manual head-to-head match between two hypotheses")
  .action(compareCommand);

program
  .command("diff <sessionId> <hypothesisId>")
  .description("Show lineage and diff of an evolved hypothesis vs its parent")
  .action(diffCommand);

program
  .command("safety <sessionId>")
  .description(
    "Inspect and manage hypotheses withheld by the safety gate\n" +
    "  --release <id>   Release a quarantined hypothesis into the tournament\n" +
    "  --reason <text>  Justification for the release (required with --release)\n" +
    "  --by <name>      Who is authorising the release (default: operator)"
  )
  .option("--release <hypothesisId>", "Release a quarantined hypothesis (override)")
  .option("--reason <text>", "Justification for the release (required with --release)")
  .option("--by <name>", "Who is authorising the release", "operator")
  .action(safetyCommand);

program
  .command("thinking <sessionId>")
  .description("Display the thinking trace (chain-of-thought) for a session")
  .option("--export <path>", "Export thinking traces to a markdown file")
  .action(thinkingCommand);

program
  .command("activity <sessionId>")
  .description("Display the full activity log for a session")
  .option("--export <path>", "Export activity log to a markdown file")
  .action(activityCommand);

program
  .command("login")
  .description(
    "Sign in to Scite and/or Consensus via OAuth\n" +
    "  --provider <name>   consensus | scite | all (default: all)"
  )
  .option("-p, --provider <name>", "Provider to log in to: consensus | scite | all", "all")
  .action(loginCommand);

program
  .command("logout")
  .description(
    "Sign out of Scite and/or Consensus\n" +
    "  --provider <name>   consensus | scite | all (default: all)"
  )
  .option("-p, --provider <name>", "Provider to log out of: consensus | scite | all", "all")
  .action(logoutCommand);

program.action(async () => {
  const { startInteractive } = await import("./interactive.js");
  await startInteractive();
});

program.parse(process.argv);
