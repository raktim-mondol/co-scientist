/**
 * interactive.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Top-level interactive REPL — launched when `co-scientist` is run with no
 * arguments. Shows the banner + a persistent text input, Claude Code style.
 *
 * Supports:
 *   /run <goal>      — Start a new research session
 *   /resume <id>     — Resume a paused session
 *   /list            — List all sessions
 *   /results <id>    — Show ranked hypotheses
 *   /overview <id>   — Show research overview
 *   /delete <id>     — Delete a session
 *   /help            — Show available commands
 *   /quit            — Exit
 */

import chalk from "chalk";
import { printBanner } from "./banner.js";
import { runMigrations } from "../db/migrate.js";
import { closeDb } from "../db/index.js";
import { getContextStore } from "../memory/contextStore.js";
import { resetConfig, getConfig } from "../config.js";
import { seedRng } from "../util/rng.js";
import { startSlashCommands } from "./slashCommands.js";
import { SupervisorAgent } from "../agents/supervisor.js";
import { getMCPManager } from "../tools/mcpClient.js";
import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import type { ResearchGoal } from "../models/researchGoal.js";

// ─── Terminal Helpers ─────────────────────────────────────────────────────────

let _originalStdoutWrite: typeof process.stdout.write | null = null;

function rawWrite(str: string): void {
  if (_originalStdoutWrite) {
    _originalStdoutWrite(str);
  } else {
    process.stdout.write(str);
  }
}

function clearLine(): void {
  rawWrite("\r\x1B[2K");
}

function hideCursor(): void {
  rawWrite("\x1B[?25l");
}

function showCursor(): void {
  rawWrite("\x1B[?25h");
}

// ─── State ───────────────────────────────────────────────────────────────────

let inputBuffer = "";
let cursorPos = 0;
let _closed = false;
const _history: string[] = [];
let _historyIdx = -1;
let _historySaved = "";

// ─── Constants ──────────────────────────────────────────────────────────────

const INPUT_BOX_WIDTH = 80;
const HLINE = "─".repeat(INPUT_BOX_WIDTH);

function drawTopLine(): void {
  rawWrite(chalk.gray(HLINE) + "\n");
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

function buildPrompt(): string {
  return chalk.gray(" ") + chalk.green(">") + chalk.white(" ");
}

function redrawInput(): void {
  if (_closed) return;
  // Clear from current position down (prompt line + bottom line)
  rawWrite("\r\x1B[J");
  rawWrite(buildPrompt() + inputBuffer);
  const overshoot = inputBuffer.length - cursorPos;
  if (overshoot > 0) {
    rawWrite(`\x1B[${overshoot}D`);
  }
  // Draw bottom line below input
  rawWrite("\n" + chalk.gray(HLINE));
  // Move cursor back up to the input line
  rawWrite("\x1B[1A");
  // Reposition cursor to correct column
  const promptLen = stripAnsi(buildPrompt()).length;
  const targetCol = promptLen + cursorPos + 1;
  rawWrite(`\r\x1B[${targetCol}G`);
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B(?:\[[0-9;]*[a-zA-Z]|][^\x07]*\x07|[^[].)/g, "");
}

// ─── Output ──────────────────────────────────────────────────────────────────

const _outputBuffer: string[] = [];
let _flushScheduled = false;

function scheduleFlush(): void {
  if (_flushScheduled) return;
  _flushScheduled = true;
  queueMicrotask(flushOutput);
}

function flushOutput(): void {
  _flushScheduled = false;
  if (_outputBuffer.length === 0) return;
  const w = _originalStdoutWrite ?? process.stdout.write.bind(process.stdout);
  // Clear the bottom line + prompt line
  rawWrite("\r\x1B[J");
  for (const line of _outputBuffer) {
    w(line + "\n");
  }
  _outputBuffer.length = 0;
  redrawInput();
}

function writeOutput(text: string): void {
  _outputBuffer.push(text);
  scheduleFlush();
}

// ─── History ─────────────────────────────────────────────────────────────────

function pushHistory(cmd: string): void {
  if (!cmd.trim()) return;
  if (_history.length > 0 && _history[_history.length - 1] === cmd) return;
  _history.push(cmd);
  if (_history.length > 50) _history.shift();
}

// ─── Session Runner ──────────────────────────────────────────────────────────

async function startSession(goal: string | ResearchGoal, name?: string): Promise<void> {
  // Init DB + MCP
  await runMigrations();
  try {
    await getMCPManager().initialize();
  } catch {
    // MCP degraded — continue with Parallel AI only
  }

  const supervisor = new SupervisorAgent();
  const emitter = new EventEmitter();
  supervisor.setEmitter(emitter);

  const sessionName = name || `session-${new Date().toISOString().slice(0, 10)}`;
  const researchGoal: ResearchGoal = typeof goal === "string" ? {
    id: uuidv4(),
    rawGoal: goal.trim(),
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
  } : goal;

  let sessionId: string;
  try {
    sessionId = await supervisor.initSession(researchGoal, sessionName);
  } catch (err) {
    writeOutput(chalk.red(`  Failed to start: ${(err as Error).message}`));
    return;
  }

  const startTime = Date.now();
  const budgetTokens = getConfig().compute.budgetTokens;
  let sessionCompleted = false;

  // Hand off to the slash command interface for the running session
  const slash = startSlashCommands({
    sessionId,
    memory: getContextStore(),
    supervisor,
    emitter,
    startTime,
    budgetTokens,
    onComplete: () => {
      sessionCompleted = true;
    },
  });

  // Run the supervisor in the background
  supervisor.run(sessionId).then(() => {
    if (!sessionCompleted) {
      sessionCompleted = true;
      // Show final results
      const memory = getContextStore();
      const topHyps = memory.getTopHypotheses(sessionId, 5);
      writeOutput(chalk.bold.cyan(`\nTop ${topHyps.length} Hypotheses:`));
      topHyps.forEach((h, i) => {
        writeOutput(chalk.yellow(`  ${i + 1}. [${Math.round(h.eloRating)}] `) + chalk.white(h.title));
      });
      writeOutput(chalk.cyan(`\nResults:  co-scientist results ${sessionId}`));
      writeOutput(chalk.cyan(`Overview: co-scientist overview ${sessionId}`));
      writeOutput(chalk.cyan(`Export:   co-scientist export ${sessionId}`));
    }
    // Always close slash interface after supervisor completes
    slash.close();
  }).catch((err) => {
    writeOutput(chalk.red(`  Session error: ${(err as Error).message}`));
    sessionCompleted = true;
    slash.close();
  });

  // Wait for the slash interface to close (user typed /quit or session completed)
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (sessionCompleted) {
        clearInterval(check);
        // Give a moment for output to flush
        setTimeout(resolve, 100);
      }
    }, 500);
  });
}

// ─── Command Handlers ────────────────────────────────────────────────────────

async function handleCommand(raw: string): Promise<void> {
  const input = raw.trim();
  if (!input) return;

  if (!input.startsWith("/")) {
    writeOutput(chalk.gray("  Type /help for commands."));
    return;
  }

  const spaceIdx = input.indexOf(" ");
  const cmd = spaceIdx === -1 ? input.slice(1).toLowerCase() : input.slice(1, spaceIdx).toLowerCase();
  const args = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1).trim();

  switch (cmd) {
    case "help":
      writeOutput(chalk.cyan.bold("Commands:"));
      writeOutput(chalk.white("  /run <goal>") + chalk.gray("       Start a new research session"));
      writeOutput(chalk.white("  /resume <id>") + chalk.gray("      Resume a paused session"));
      writeOutput(chalk.white("  /list") + chalk.gray("              List all sessions"));
      writeOutput(chalk.white("  /results <id>") + chalk.gray("     Show ranked hypotheses"));
      writeOutput(chalk.white("  /overview <id>") + chalk.gray("    Show research overview"));
      writeOutput(chalk.white("  /export <id>") + chalk.gray("      Export results to file"));
      writeOutput(chalk.white("  /delete <id>") + chalk.gray("      Delete a session"));
      writeOutput(chalk.white("  /design <id>") + chalk.gray("      Generate experimental protocol"));
      writeOutput(chalk.white("  /graph <id>") + chalk.gray("       Show knowledge graph"));
      writeOutput(chalk.white("  /safety <id>") + chalk.gray("      Inspect quarantined hypotheses"));
      writeOutput(chalk.white("  /activity <id>") + chalk.gray("   Show activity log"));
      writeOutput(chalk.white("  /quit") + chalk.gray("              Exit co-scientist"));
      writeOutput(chalk.gray("  Up/Down arrows for command history."));
      break;

    case "run": {
      if (!args) {
        writeOutput(chalk.red("  Usage: /run <research goal>"));
        writeOutput(chalk.gray("  Example: /run What are effective ML techniques for protein folding?"));
        break;
      }
      // Reset config in case env vars changed
      resetConfig();
      const seed = getConfig().seed;
      seedRng(seed);
      await startSession(args);
      // After session ends, show the REPL prompt again
      writeOutput(chalk.gray("\n  Session ended. Type /help for commands."));
      break;
    }

    case "resume": {
      if (!args) {
        writeOutput(chalk.red("  Usage: /resume <sessionId>"));
        break;
      }
      resetConfig();
      await runMigrations();
      const memory = getContextStore();
      const session = memory.resolveSession(args);
      if (!session) {
        writeOutput(chalk.red(`  Session not found: ${args}`));
        break;
      }
      if (session.status !== "paused") {
        writeOutput(chalk.yellow(`  Session "${session.name}" is ${session.status}, not paused.`));
        break;
      }
      const goal = memory.getResearchGoal(session.id);
      if (!goal) {
        writeOutput(chalk.red(`  Could not restore research goal for session ${session.id.slice(0, 8)}.`));
        break;
      }
      writeOutput(chalk.green(`  Resuming: ${session.name} (${session.id.slice(0, 8)})`));
      await startSession(goal, session.name);
      writeOutput(chalk.gray("\n  Session ended. Type /help for commands."));
      break;
    }

    case "list": {
      await runMigrations();
      const memory = getContextStore();
      const sessions = memory.listSessions();
      if (sessions.length === 0) {
        writeOutput(chalk.gray("  No sessions found."));
        break;
      }
      writeOutput(chalk.cyan.bold(`Sessions (${sessions.length}):`));
      for (const s of sessions) {
        const statusColor = s.status === "completed" ? chalk.green
          : s.status === "running" ? chalk.yellow
          : s.status === "paused" ? chalk.blue
          : chalk.gray;
        const status = statusColor(s.status.padEnd(12));
        const hyps = s.stats?.totalHypotheses ?? 0;
        const topElo = s.stats?.topEloRating ?? 0;
        writeOutput(
          chalk.gray(`  ${s.id.slice(0, 8)}  `) +
          status +
          chalk.white(`  ${s.name}`) +
          chalk.gray(`  Hyp:${hyps} Elo:${Math.round(topElo)}`)
        );
      }
      break;
    }

    case "results": {
      if (!args) {
        writeOutput(chalk.red("  Usage: /results <sessionId>"));
        break;
      }
      await runMigrations();
      const memory = getContextStore();
      const session = memory.resolveSession(args);
      if (!session) {
        writeOutput(chalk.red(`  Session not found: ${args}`));
        break;
      }
      const hyps = memory.getTopHypotheses(session.id, 10);
      if (hyps.length === 0) {
        writeOutput(chalk.gray("  No hypotheses for this session."));
        break;
      }
      writeOutput(chalk.cyan.bold(`Results: ${session.name}`));
      for (let i = 0; i < hyps.length; i++) {
        const h = hyps[i];
        writeOutput(
          chalk.yellow(`  ${i + 1}. [${Math.round(h.eloRating)}] `) +
          chalk.white(h.title.slice(0, 70))
        );
      }
      writeOutput(chalk.gray(`\n  Full: co-scientist results ${session.id}`));
      break;
    }

    case "overview": {
      if (!args) {
        writeOutput(chalk.red("  Usage: /overview <sessionId>"));
        break;
      }
      await runMigrations();
      const memory = getContextStore();
      const session = memory.resolveSession(args);
      if (!session) {
        writeOutput(chalk.red(`  Session not found: ${args}`));
        break;
      }
      if (!session.researchOverview) {
        writeOutput(chalk.gray("  No overview yet (session may still be running)."));
        break;
      }
      writeOutput(chalk.cyan.bold(`Overview: ${session.name}`));
      writeOutput(session.researchOverview.slice(0, 2000));
      if (session.researchOverview.length > 2000) {
        writeOutput(chalk.gray("  ... (truncated)"));
      }
      writeOutput(chalk.gray(`\n  Full: co-scientist overview ${session.id}`));
      break;
    }

    case "delete": {
      if (!args) {
        writeOutput(chalk.red("  Usage: /delete <sessionId>"));
        break;
      }
      await runMigrations();
      const memory = getContextStore();
      const session = memory.resolveSession(args);
      if (!session) {
        writeOutput(chalk.red(`  Session not found: ${args}`));
        break;
      }
      try {
        memory.deleteSession(session.id);
        writeOutput(chalk.green(`  Deleted: ${session.name} (${session.id.slice(0, 8)})`));
      } catch (err) {
        writeOutput(chalk.red(`  Delete failed: ${(err as Error).message}`));
      }
      break;
    }

    case "export": {
      if (!args) {
        writeOutput(chalk.red("  Usage: /export <sessionId>"));
        break;
      }
      await runMigrations();
      const memory = getContextStore();
      const session = memory.resolveSession(args);
      if (!session) {
        writeOutput(chalk.red(`  Session not found: ${args}`));
        break;
      }
      const { exportCommand } = await import("./commands/export.js");
      await exportCommand(session.id, { format: "markdown" });
      break;
    }

    case "design": {
      if (!args) {
        writeOutput(chalk.red("  Usage: /design <sessionId>"));
        break;
      }
      await runMigrations();
      const memory = getContextStore();
      const session = memory.resolveSession(args);
      if (!session) {
        writeOutput(chalk.red(`  Session not found: ${args}`));
        break;
      }
      const { designCommand } = await import("./commands/design.js");
      await designCommand(session.id, {});
      break;
    }

    case "graph": {
      if (!args) {
        writeOutput(chalk.red("  Usage: /graph <sessionId>"));
        break;
      }
      await runMigrations();
      const memory = getContextStore();
      const session = memory.resolveSession(args);
      if (!session) {
        writeOutput(chalk.red(`  Session not found: ${args}`));
        break;
      }
      const { graphCommand } = await import("./commands/graph.js");
      await graphCommand(session.id, { format: "text" });
      break;
    }

    case "safety": {
      if (!args) {
        writeOutput(chalk.red("  Usage: /safety <sessionId>"));
        break;
      }
      await runMigrations();
      const memory = getContextStore();
      const session = memory.resolveSession(args);
      if (!session) {
        writeOutput(chalk.red(`  Session not found: ${args}`));
        break;
      }
      const { safetyCommand } = await import("./commands/safety.js");
      await safetyCommand(session.id, {});
      break;
    }

    case "activity": {
      if (!args) {
        writeOutput(chalk.red("  Usage: /activity <sessionId>"));
        break;
      }
      await runMigrations();
      const memory = getContextStore();
      const session = memory.resolveSession(args);
      if (!session) {
        writeOutput(chalk.red(`  Session not found: ${args}`));
        break;
      }
      const { activityCommand } = await import("./commands/activity.js");
      await activityCommand(session.id, {});
      break;
    }

    case "quit":
    case "exit":
      _closed = true;
      break;

    default:
      writeOutput(chalk.red(`  Unknown command: /${cmd}`));
      writeOutput(chalk.gray("  Type /help for commands."));
  }
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

export async function startInteractive(): Promise<void> {
  printBanner();

  console.log(chalk.cyan.bold("  Welcome to Co-Scientist"));
  console.log(chalk.gray("  Multi-agent AI for scientific discovery"));
  console.log(chalk.gray(""));
  console.log(chalk.gray("  Type /run <goal> to start a research session"));
  console.log(chalk.gray("  Type /help for all commands"));
  console.log(chalk.gray("  Up/Down arrows for command history"));
  console.log("");

  // Intercept stdout for input preservation
  _originalStdoutWrite = process.stdout.write.bind(process.stdout);

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  hideCursor();
  drawTopLine();
  redrawInput();

  let _dispatching = false;

  const onData = (data: Buffer | string) => {
    if (_closed) return;
    const str = typeof data === "string" ? data : data.toString("utf8");

    if (str === "\r" || str === "\n") {
      if (_dispatching) return;
      const cmd = inputBuffer;
      inputBuffer = "";
      cursorPos = 0;
      _historyIdx = -1;
      pushHistory(cmd);
      _dispatching = true;
      handleCommand(cmd).finally(() => {
        _dispatching = false;
        if (!_closed) redrawInput();
      });
    } else if (str === "\x03") {
      // Ctrl+C
      if (inputBuffer.length > 0) {
        inputBuffer = "";
        cursorPos = 0;
        _historyIdx = -1;
        writeOutput(chalk.gray("^C"));
      } else {
        _closed = true;
      }
    } else if (str === "\x04") {
      // Ctrl+D
      _closed = true;
    } else if (str === "\x7F" || str === "\x08") {
      // Backspace
      if (cursorPos > 0) {
        inputBuffer = inputBuffer.slice(0, cursorPos - 1) + inputBuffer.slice(cursorPos);
        cursorPos--;
        redrawInput();
      }
    } else if (str === "\x1B[D") {
      if (cursorPos > 0) { cursorPos--; redrawInput(); }
    } else if (str === "\x1B[C") {
      if (cursorPos < inputBuffer.length) { cursorPos++; redrawInput(); }
    } else if (str === "\x1B[A") {
      // Up arrow — history
      if (_history.length === 0) return;
      if (_historyIdx === -1) {
        _historySaved = inputBuffer;
        _historyIdx = _history.length - 1;
      } else if (_historyIdx > 0) {
        _historyIdx--;
      }
      inputBuffer = _history[_historyIdx];
      cursorPos = inputBuffer.length;
      redrawInput();
    } else if (str === "\x1B[B") {
      // Down arrow — history
      if (_historyIdx === -1) return;
      if (_historyIdx < _history.length - 1) {
        _historyIdx++;
        inputBuffer = _history[_historyIdx];
      } else {
        _historyIdx = -1;
        inputBuffer = _historySaved;
      }
      cursorPos = inputBuffer.length;
      redrawInput();
    } else if (str === "\x1B[H") {
      cursorPos = 0; redrawInput();
    } else if (str === "\x1B[F") {
      cursorPos = inputBuffer.length; redrawInput();
    } else if (str === "\x1B[3~") {
      if (cursorPos < inputBuffer.length) {
        inputBuffer = inputBuffer.slice(0, cursorPos) + inputBuffer.slice(cursorPos + 1);
        redrawInput();
      }
    } else if (str === "\x1B") {
      inputBuffer = ""; cursorPos = 0; _historyIdx = -1; redrawInput();
    } else if (str === "\t") {
      // ignore tab
    } else if (str.length === 1 && str >= " ") {
      if (inputBuffer.length < 2048) {
        inputBuffer = inputBuffer.slice(0, cursorPos) + str + inputBuffer.slice(cursorPos);
        cursorPos++;
        redrawInput();
      }
    }
  };

  process.stdin.on("data", onData);

  // Safety net: restore terminal on unexpected exit
  const exitHandler = () => {
    showCursor();
    if (process.stdin.isTTY) try { process.stdin.setRawMode(false); } catch { /* */ }
    if (_originalStdoutWrite) process.stdout.write = _originalStdoutWrite;
  };
  process.on("exit", exitHandler);

  // Wait until _closed
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (_closed) {
        clearInterval(check);
        resolve();
      }
    }, 200);
  });

  // Cleanup
  process.removeListener("exit", exitHandler);
  showCursor();
  process.stdin.removeListener("data", onData);
  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(false); } catch { /* */ }
  }
  process.stdin.pause();
  // Clear the bordered input area (bottom line + prompt line)
  rawWrite("\r\x1B[J");
  process.stdout.write = _originalStdoutWrite;
  console.log(chalk.gray("Goodbye!"));
  closeDb();
}
