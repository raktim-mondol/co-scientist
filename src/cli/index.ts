#!/usr/bin/env bun
import { Command } from "commander";
import "dotenv/config";
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

const program = new Command();

program
  .name("co-scientist")
  .description(
    "Multi-agent AI system for accelerating scientific discovery\n" +
    "Based on: Gottweis et al., \"Accelerating scientific discovery with Co-Scientist\" (Nature, 2026)"
  )
  .version("1.0.0");

program
  .command("run")
  .description("Start a new scientific research session")
  .option("-g, --goal <text>", "Research goal (or omit to enter interactively)")
  .option("-n, --name <name>", "Session name")
  .option("--max-hypotheses <n>", "Maximum hypotheses to generate", "50")
  .option("--max-rounds <n>", "Maximum tournament rounds", "100")
  .option("--budget <tokens>", "Token budget (0 = unlimited)", "500000")
  .option("--no-tui", "Disable interactive TUI (plain log output)")
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
  .description("Display ranked hypotheses for a session")
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
  .description("Export session results to a file")
  .option("-f, --format <fmt>", "Output format: markdown | json", "markdown")
  .option("-o, --output <path>", "Output file path")
  .option("--all", "Export all active hypotheses (default: top 20)")
  .action(exportCommand);

program
  .command("delete [sessionId]")
  .description("Delete a session and all its data")
  .option("-f, --force", "Skip confirmation prompt")
  .option("--all", "Delete all sessions")
  .action(deleteCommand);

program
  .command("design <sessionId>")
  .description("Generate a structured experimental protocol for a hypothesis")
  .option("--hypothesis-id <id>", "Target a specific hypothesis (default: top-1 by Elo)")
  .action(designCommand);

program
  .command("graph <sessionId>")
  .description("Display or export the knowledge graph for a session")
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

program.action(() => {
  printBanner();
  program.help();
});

program.parse(process.argv);
