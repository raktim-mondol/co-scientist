#!/usr/bin/env bun
import { Command } from "@commander-js/extra-typings";
import "dotenv/config";
import type { ResearchGoal } from "../models/researchGoal.js";
import { color } from "./design-system/color.js";
import { withDb } from "./commands/withDb.js";
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

import { activityCommand } from "./commands/activity.js";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";

const program = new Command();

program
  .name("co-scientist")
  .description("Multi-agent AI system for accelerating scientific discovery")
  .version("1.0.0")
  .showHelpAfterError()
  .showSuggestionAfterError();

program
  .command("run")
  .description("Start a new scientific research session")
  .option("-g, --goal <text>", "Research goal (or omit to enter interactively)")
  .option("-n, --name <name>", "Session name")
  .option("--max-hypotheses <n>", "Maximum hypotheses to generate", "5")
  .option("--max-rounds <n>", "Maximum tournament rounds", "100")
  .option("--budget <tokens>", "Token budget (0 = unlimited)", "500000")
  .option("--seed <n>", "Deterministic seed for reproducible scheduling/sampling")
  .option("--no-interactive", "Disable interactive slash commands (plain log output)")
  .option("--no-tui", "Alias for --no-interactive (deprecated)")
  .option("--interactive", "Launch TUI in empty-state mode — type a research topic to begin")
  .action(runCommand);

program
  .command("resume <sessionId>")
  .description("Resume a paused or interrupted session")
  .action(resumeCommand);

program
  .command("list")
  .description("List all research sessions")
  .action(() => withDb(listCommand));

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
  .action((sessionId, opts) => withDb(() => resultsCommand(sessionId, opts)));

program
  .command("overview <sessionId>")
  .description("Display the final research overview")
  .action((sessionId) => withDb(() => overviewCommand(sessionId)));

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
  .action((sessionId, opts) => withDb(() => feedbackCommand(sessionId, opts)));

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
  .action((sessionId, opts) => withDb(() => exportCommand(sessionId, opts)));

program
  .command("delete [sessionId]")
  .description(
    "Delete a session and all its data\n" +
    "  --all     Delete all sessions\n" +
    "  --force   Skip confirmation prompt"
  )
  .option("-f, --force", "Skip confirmation prompt")
  .option("--all", "Delete all sessions")
  .action((sessionId, opts) => withDb(() => deleteCommand(sessionId, opts)));

program
  .command("design <sessionId>")
  .description(
    "Generate a structured experimental protocol for a hypothesis\n" +
    "  --hypothesis-id <id>   Target hypothesis (default: top-1 by Elo)"
  )
  .option("--hypothesis-id <id>", "Target a specific hypothesis (default: top-1 by Elo)")
  .action((sessionId, opts) => withDb(() => designCommand(sessionId, opts)));

program
  .command("graph <sessionId>")
  .description(
    "Display or export the knowledge graph for a session\n" +
    "  --format text|dot|json   Output format (default: text)\n" +
    "  --output <path>          Write output to file instead of stdout"
  )
  .option("-f, --format <fmt>", "Output format: text | dot | json", "text")
  .option("-o, --output <path>", "Write output to file instead of stdout")
  .action((sessionId, opts) => withDb(() => graphCommand(sessionId, opts)));

program
  .command("compare <sessionId> <hypothesisId1> <hypothesisId2>")
  .description("Run a manual head-to-head match between two hypotheses")
  .action((s, h1, h2) => withDb(() => compareCommand(s, h1, h2)));

program
  .command("diff <sessionId> <hypothesisId>")
  .description("Show lineage and diff of an evolved hypothesis vs its parent")
  .action((sessionId, hypId) => withDb(() => diffCommand(sessionId, hypId)));

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
  .action((sessionId, opts) => withDb(() => safetyCommand(sessionId, opts)));

program
  .command("activity <sessionId>")
  .description("Display the full activity log for a session")
  .option("--export <path>", "Export activity log to a markdown file")
  .action((sessionId, opts) => withDb(() => activityCommand(sessionId, opts)));

program
  .command("login")
  .description(
    "Sign in to Scite and/or Consensus via OAuth\n" +
    "  --provider <name>   consensus | scite | all (default: all)"
  )
  .option("-p, --provider <name>", "Provider to log in to: consensus | scite | all", "all")
  .action((opts) => withDb(() => loginCommand(opts)));

program
  .command("logout")
  .description(
    "Sign out of Scite and/or Consensus\n" +
    "  --provider <name>   consensus | scite | all (default: all)"
  )
  .option("-p, --provider <name>", "Provider to log out of: consensus | scite | all", "all")
  .action((opts) => withDb(() => logoutCommand(opts)));

program.action(async () => {
  // Only launch REPL when run with no arguments at all
  // (Commander fires this for unknown commands too — reject those)
  if (process.argv.length > 2) {
    console.error(color("error")("Unknown command: " + process.argv[2]));
    console.error(color("inactive")("Run `co-scientist --help` to see available commands."));
    process.exit(1);
  }

  // ── Launch Ink TUI (Claude Code-style) ──────────────────────────────────
  const { runMigrations } = await import("../db/migrate.js");
  const { closeDb } = await import("../db/index.js");
  const { getContextStore } = await import("../memory/contextStore.js");
  const { getConfig } = await import("../config.js");
  const { getMCPManager } = await import("../tools/mcpClient.js");
  const { SupervisorAgent } = await import("../agents/supervisor.js");
  const { EventEmitter } = await import("events");
  const { v4: uuidv4 } = await import("uuid");
  const { renderTUI } = await import("./tui/index.js");

  // Suppress [INFO] log output during init — screen clear below wipes it
  // anyway, and MCP logs pollute the terminal before the TUI takes over.
  const prevLogLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = "warn";
  const { resetConfig } = await import("../config.js");
  resetConfig();
  await runMigrations();
  await getMCPManager().initialize().catch(() => {});
  process.env.LOG_LEVEL = prevLogLevel ?? "";
  resetConfig();

  const memory = getContextStore();
  const budgetTokens = getConfig().compute.budgetTokens;

  // Clear terminal before Ink takes over — ora spinners and [INFO] logs
  // pollute the display otherwise.
  process.stdout.write("\x1B[2J\x1B[H"); // clear screen + cursor home

  // Closure variables set by onStartSession, read by other callbacks
  let currentSupervisor: SupervisorAgent | null = null;
  let currentSessionId: string | null = null;

  const tui = renderTUI({
    memory,
    sessionId: null,
    goal: null,
    supervisor: null,
    emitter: null,
    startTime: null,
    budgetTokens,
    onStartSession: async (goalText, opts) => {
      const goal: ResearchGoal = {
        id: uuidv4(),
        rawGoal: goalText.trim(),
        constraints: {
          noveltyRequired: true,
          allowedMethodologies: [],
          excludedMethodologies: [],
          targetOrganisms: [],
        },
        evaluationCriteria: {
          noveltyWeight: 0.35,
          correctnessWeight: 0.35,
          testabilityWeight: 0.20,
          impactWeight: 0.10,
          customCriteria: [],
        },
        outputFormat: "standard",
        attachedDocuments: [],
        expertHypotheses: [],
        createdAt: new Date(),
      };

      const supervisor = new SupervisorAgent();
      const emitter = new EventEmitter();
      supervisor.setEmitter(emitter);

      const name = opts?.name || `session-${new Date().toISOString().slice(0, 10)}`;
      const sessionId = await supervisor.initSession(goal, name);

      currentSupervisor = supervisor;
      currentSessionId = sessionId;

      // Start the supervisor loop in the background
      supervisor.run(sessionId).catch((err) => {
        if (!(err instanceof Error) || !err.message.includes("Session stopped")) {
          // Error surfaced via emitter 'error' event
        }
      });

      return { sessionId, supervisor, emitter };
    },
    onStop: () => {
      currentSupervisor?.stop();
    },
    onTogglePause: () => {
      if (!currentSupervisor) return false;
      if (currentSupervisor.isPaused()) {
        currentSupervisor.resume();
        return false;
      }
      currentSupervisor.pause();
      return true;
    },
    onQuit: () => {
      currentSupervisor?.stop();
      if (currentSessionId) {
        memory.updateSessionStatus(currentSessionId, "paused");
      }
      closeDb();
    },
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────
  let shuttingDown = false;
  const gracefulShutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    tui.unmount();
    currentSupervisor?.stop();
    if (currentSessionId) {
      try { memory.updateSessionStatus(currentSessionId, "paused"); } catch { /* ignore */ }
    }
    try { closeDb(); } catch { /* ignore */ }
    process.exit(0);
  };

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGHUP", () => gracefulShutdown("SIGHUP"));

  try {
    await tui.waitUntilExit();
  } catch (err) {
    console.error(color("error")("TUI crashed: " + (err as Error).message));
    console.error((err as Error).stack || "");
  }

  // Clean up signal handlers after normal exit
  process.removeAllListeners("SIGINT");
  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGHUP");

  await getMCPManager().cleanup();
});

program.parse(process.argv);
