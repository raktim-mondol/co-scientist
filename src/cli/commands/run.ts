import { EventEmitter } from "events";
import chalk from "chalk";
import ora from "ora";
import { printBanner } from "../banner.js";
// eslint-disable-next-line @typescript-eslint/no-var-requires
import inquirer from "inquirer";
import { v4 as uuidv4 } from "uuid";
import { SupervisorAgent } from "../../agents/supervisor.js";
import { getContextStore } from "../../memory/contextStore.js";
import { getMCPManager } from "../../tools/mcpClient.js";
import { runMigrations } from "../../db/migrate.js";
import { closeDb } from "../../db/index.js";
import { resetConfig, getConfig } from "../../config.js";
import { seedRng } from "../../util/rng.js";
import type { ResearchGoal } from "../../models/researchGoal.js";
import type { SessionStats } from "../../models/session.js";
import { renderTUI } from "../tui/index.js";

interface RunOptions {
  goal?: string;
  name?: string;
  maxHypotheses?: string;
  maxRounds?: string;
  budget?: string;
  seed?: string;
  tui?: boolean;
}

export async function runCommand(options: RunOptions): Promise<void> {
  printBanner();

  // Override config from CLI flags, then reset singleton so changes take effect
  if (options.maxHypotheses) process.env.MAX_HYPOTHESES = options.maxHypotheses;
  if (options.maxRounds) process.env.MAX_TOURNAMENT_ROUNDS = options.maxRounds;
  if (options.budget) process.env.COMPUTE_BUDGET_TOKENS = options.budget;
  if (options.seed) process.env.SEED = options.seed;
  resetConfig(); // force re-read of env vars into config singleton

  // Seed the global RNG so scheduling/sampling is reproducible when --seed is set.
  const seed = getConfig().seed;
  seedRng(seed);
  if (seed !== undefined) {
    console.log(
      chalk.gray(
        `🎲 Deterministic seed: ${seed} ` +
        `(scheduling/sampling reproducible — add --max-workers 1 for stricter determinism)`
      )
    );
  }

  // Get research goal
  let rawGoal = options.goal;
  if (!rawGoal) {
    const { goal } = await inquirer.prompt([
      {
        type: "input",
        name: "goal",
        message: "Enter your research goal:",
      },
    ] as unknown as Parameters<typeof inquirer.prompt>[0]);
    rawGoal = goal as string;
  }

  if (!rawGoal?.trim()) {
    console.error(chalk.red("❌ Research goal cannot be empty"));
    process.exit(1);
  }

  // Get session name
  let sessionName = options.name;
  if (!sessionName) {
    const { name } = await inquirer.prompt([
      {
        type: "input",
        name: "name",
        message: "Session name (optional, press Enter to auto-generate):",
        default: `session-${new Date().toISOString().slice(0, 10)}`,
      },
    ] as unknown as Parameters<typeof inquirer.prompt>[0]);
    sessionName = name as string;
  }

  // Initialize DB
  const initSpinner = ora("Initializing database...").start();
  await runMigrations();
  initSpinner.succeed("Database ready");

  // Initialize MCP tools (academic search)
  const acProvider = getMCPManager().providerPriority()[0];
  const acLabel = acProvider.charAt(0).toUpperCase() + acProvider.slice(1);
  const mcpSpinner = ora(`Connecting to ${acLabel} MCP (academic search)...`).start();
  try {
    await getMCPManager().initialize();
    mcpSpinner.succeed(`${acLabel} MCP connected`);
  } catch {
    mcpSpinner.warn(`${acLabel} MCP connection degraded — academic search may be limited`);
  }

  // Create research goal
  const goal: ResearchGoal = {
    id: uuidv4(),
    rawGoal: rawGoal.trim(),
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

  // Create supervisor and session
  const supervisor = new SupervisorAgent();
  const emitter = new EventEmitter();
  supervisor.setEmitter(emitter);

  const sessionSpinner = ora("Parsing research goal...").start();
  let sessionId: string;

  try {
    sessionId = await supervisor.initSession(goal, sessionName);
    sessionSpinner.succeed(`Session created: ${chalk.cyan(sessionId)}`);
  } catch (err) {
    sessionSpinner.fail(`Failed to initialize: ${(err as Error).message}`);
    process.exit(1);
  }

  console.log(chalk.yellow("\n📋 Research Goal:\n") + chalk.white(rawGoal.trim()));
  console.log(chalk.yellow("\n🚀 Starting Co-Scientist...\n"));

  // Set up progress display
  const startTime = Date.now();
  const budgetTokens = getConfig().compute.budgetTokens;
  const useTui = options.tui !== false && Boolean(process.stdout.isTTY);

  let tui: { unmount: () => void; waitUntilExit: () => Promise<void> } | null = null;
  let lastActivity = "Initializing...";
  let lastStats: (SessionStats & { activity: string }) | null = null;

  if (useTui) {
    tui = renderTUI({
      emitter,
      memory: getContextStore(),
      sessionId,
      goal: rawGoal.trim(),
      startTime,
      budgetTokens,
      onTogglePause: () => {
        if (supervisor.isPaused()) {
          supervisor.resume();
          return false;
        }
        supervisor.pause();
        return true;
      },
      onQuit: () => {
        supervisor.stop();
        getContextStore().updateSessionStatus(sessionId, "paused");
      },
    });
  } else {
    emitter.on("progress", (stats: SessionStats & { activity: string }) => {
      lastStats = stats;
      lastActivity = stats.activity;
      printProgress(stats, startTime);
    });

    emitter.on("hypothesis_added", (count: number) => {
      if (lastStats) {
        lastStats = { ...lastStats, totalHypotheses: count };
        printProgress(lastStats, startTime);
      }
      console.log(chalk.green(`\n  ✓ Hypotheses: ${count}`));
    });

    emitter.on("match_completed", (round: number) => {
      console.log(chalk.blue(`  ⚔  Tournament round ${round} complete`));
    });

    emitter.on("completed", (overview: string) => {
      console.log(chalk.bold.green("\n✅ Session completed!\n"));
      if (overview) {
        console.log(chalk.cyan("📄 Research Overview Preview:"));
        console.log(overview.slice(0, 500) + (overview.length > 500 ? "\n..." : ""));
      }
    });

    emitter.on("error", (err: Error) => {
      console.error(chalk.red(`\n❌ Error: ${err.message}`));
    });
  }
  void lastActivity;

  // ── Graceful shutdown handler ──────────────────────────────────────────────
  // Ensures WAL is checkpointed, DB connection is closed, and the PID lock
  // file is removed — so the next session starts cleanly even after Ctrl+C.
  let shuttingDown = false;
  const gracefulShutdown = (signal: string) => {
    if (shuttingDown) return; // Prevent double-cleanup races
    shuttingDown = true;

    if (tui) tui.unmount();
    console.log(chalk.yellow(`\n\n⏸  ${signal} received — pausing session...`));

    supervisor.stop();

    const memory = getContextStore();
    try {
      memory.updateSessionStatus(sessionId, "paused");
      console.log(chalk.gray("  Session status saved."));
    } catch (err) {
      console.log(chalk.gray(`  (Could not update session status: ${(err as Error).message})`));
    }

    // Checkpoint WAL + close DB + remove PID lock file
    try {
      closeDb();
      console.log(chalk.gray("  Database checkpointed and closed."));
    } catch (err) {
      console.log(chalk.gray(`  (Database cleanup: ${(err as Error).message})`));
    }

    console.log(
      chalk.cyan(`\n  Resume later with: co-scientist resume ${sessionId}`)
    );
    process.exit(0);
  };

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  // SIGHUP: terminal closed / SSH disconnected — best-effort cleanup
  process.on("SIGHUP", () => gracefulShutdown("SIGHUP"));

  // Run the main orchestration loop
  try {
    await supervisor.run(sessionId);
    // Checkpoint WAL + close DB + remove PID lock file after normal completion.
    // (Graceful shutdown via SIGINT/SIGTERM also calls closeDb in the handler above.)
    closeDb();
    if (tui) tui.unmount();
  } catch (err) {
    if (tui) tui.unmount();
    console.error(chalk.red(`\n❌ Session error: ${(err as Error).message}`));
    const memory = getContextStore();
    memory.updateSessionStatus(sessionId, "error");
    process.exit(1);
  }

  // Show final results
  const memory = getContextStore();
  const topHyps = memory.getTopHypotheses(sessionId, 5);

  console.log(chalk.bold.cyan(`\n🏆 TOP ${topHyps.length} HYPOTHESES:\n`));
  topHyps.forEach((h, i) => {
    console.log(
      chalk.yellow(`${i + 1}. [Rating: ${Math.round(h.eloRating)}] `) +
      chalk.white.bold(h.title)
    );
    console.log(chalk.gray(`   ${h.summary}\n`));
  });

  console.log(
    chalk.cyan(`\n📊 Full results: `) +
    chalk.white(`co-scientist results ${sessionId}`)
  );
  console.log(
    chalk.cyan(`📄 Research overview: `) +
    chalk.white(`co-scientist overview ${sessionId}`)
  );
  console.log(
    chalk.cyan(`💾 Export: `) +
    chalk.white(`co-scientist export ${sessionId}`)
  );

  await getMCPManager().cleanup();
}

function printProgress(
  stats: SessionStats & { activity: string },
  startTime: number
): void {
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = `${mins}m ${secs}s`;

  const budget = getConfig().compute.budgetTokens;
  const budgetPct =
    budget > 0 && stats.tokensUsed > 0
      ? Math.round((stats.tokensUsed / budget) * 100)
      : 0;

  process.stdout.write(
    `\r${chalk.cyan("⚡")} ${chalk.gray(stats.activity.padEnd(50))} ` +
    `${chalk.yellow(`Hyp:${stats.totalHypotheses}`)} ` +
    `${chalk.blue(`Rating:${Math.round(stats.avgTopTenElo)}`)} ` +
    `${chalk.gray(`Tok:${formatTokens(stats.tokensUsed)}`)}` +
    `${budget > 0 ? chalk.gray(`(${budgetPct}%)`) : ""} ` +
    `${chalk.gray(timeStr)}   `
  );
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
