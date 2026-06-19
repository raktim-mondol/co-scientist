/**
 * interactive.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Top-level interactive REPL — launched when `co-scientist` is run with no
 * arguments. Shows the banner + a persistent text input, Claude Code style.
 *
 * Uses DECSTBM scroll region to pin the input box to the bottom 3 rows.
 * Output scrolls naturally above it. The box is drawn once and never cleared.
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

import { color } from "./design-system/color.js";
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

function hideCursor(): void {
  rawWrite("\x1B[?25l");
}

function showCursor(): void {
  rawWrite("\x1B[?25h");
}

function termWidth(): number {
  return process.stdout.columns || 80;
}

function termHeight(): number {
  return process.stdout.rows || 24;
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B(?:\[[0-9;]*[a-zA-Z]|][^\x07]*\x07|[^[].)/g, "");
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
/** Number of terminal rows reserved for the fixed input box at the bottom. */
const BOX_ROWS = 3;

// ─── Scroll Region & Fixed Box ──────────────────────────────────────────────

/**
 * Set the DECSTBM scroll region to rows 1..(H-BOX_ROWS).
 * This pins the bottom BOX_ROWS rows outside the scroll area — anything
 * written to the scroll region scrolls naturally, leaving the box untouched.
 */
function setScrollRegion(): void {
  const h = termHeight();
  const scrollBottom = h - BOX_ROWS;
  if (scrollBottom < 1) return;
  rawWrite(`\x1B[1;${scrollBottom}r`);
  // Move cursor to the bottom of the scroll region (last output row)
  rawWrite(`\x1B[${scrollBottom};1H`);
}

/**
 * Draw the 3-line input box at the bottom of the terminal.
 * These rows are outside the scroll region, so they stay fixed.
 * Only called once at startup (and on terminal resize).
 */
function drawFixedBox(): void {
  const h = termHeight();
  const inputRow = h - 1; // middle row of the 3-line box

  // Row h-2: top line
  rawWrite(`\x1B[${h - 2};1H`);
  rawWrite("\x1B[2K"); // clear line
  rawWrite(color("inactive")(HLINE));

  // Row h-1: input line (will be updated by redrawInput)
  rawWrite(`\x1B[${inputRow};1H`);
  rawWrite("\x1B[2K");
  rawWrite(buildPrompt() + inputBuffer);

  // Row h: bottom line
  rawWrite(`\x1B[${h};1H`);
  rawWrite("\x1B[2K");
  rawWrite(color("inactive")(HLINE));

  // Position cursor on the input line
  positionCursor();
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

function buildPrompt(): string {
  return color("inactive")(" ") + color("success")(">") + color("text")(" ");
}

/**
 * Update only the input line of the fixed box (row H-1).
 * The top and bottom lines never change.
 */
function redrawInput(): void {
  if (_closed) return;
  const h = termHeight();
  const inputRow = h - 1;

  // Move to the input row, clear it, redraw
  rawWrite(`\x1B[${inputRow};1H`);
  rawWrite("\x1B[2K");
  rawWrite(buildPrompt() + inputBuffer);
  positionCursor();
}

/**
 * Position the cursor at the correct column on the input line.
 */
function positionCursor(): void {
  const h = termHeight();
  const inputRow = h - 1;
  const promptLen = stripAnsi(buildPrompt()).length;
  const col = promptLen + cursorPos + 1;
  rawWrite(`\x1B[${inputRow};${col}H`);
}

// ─── Output ──────────────────────────────────────────────────────────────────

/**
 * Write output into the scroll region. The scroll region handles scrolling
 * automatically — no clearing or redrawing of the input box needed.
 */
function writeOutput(text: string): void {
  if (_closed) {
    process.stdout.write(text + "\n");
    return;
  }
  // Save cursor, move to bottom of scroll region, write, restore cursor
  rawWrite("\x1B[s");
  const scrollBottom = termHeight() - BOX_ROWS;
  rawWrite(`\x1B[${scrollBottom};1H`);
  // Clear from cursor to end of scroll region (makes room for the new line)
  rawWrite("\x1B[J");
  const w = _originalStdoutWrite ?? process.stdout.write.bind(process.stdout);
  w(text + "\n");
  rawWrite("\x1B[u");
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
    writeOutput(color("error")(`  Failed to start: ${(err as Error).message}`));
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
      writeOutput(color("claude").bold(`\nTop ${topHyps.length} Hypotheses:`));
      topHyps.forEach((h, i) => {
        writeOutput(color("warning")(`  ${i + 1}. [${Math.round(h.eloRating)}] `) + color("text")(h.title));
      });
      writeOutput(color("claude")(`\nResults:  co-scientist results ${sessionId}`));
      writeOutput(color("claude")(`Overview: co-scientist overview ${sessionId}`));
      writeOutput(color("claude")(`Export:   co-scientist export ${sessionId}`));
    }
    // Always close slash interface after supervisor completes
    slash.close();
  }).catch((err) => {
    writeOutput(color("error")(`  Session error: ${(err as Error).message}`));
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
    writeOutput(color("inactive")("  Type /help for commands."));
    return;
  }

  const spaceIdx = input.indexOf(" ");
  const cmd = spaceIdx === -1 ? input.slice(1).toLowerCase() : input.slice(1, spaceIdx).toLowerCase();
  const args = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1).trim();

  switch (cmd) {
    case "help":
      writeOutput(color("claude").bold("Commands:"));
      writeOutput(color("text")("  /run <goal>") + color("inactive")("       Start a new research session"));
      writeOutput(color("text")("  /resume <id>") + color("inactive")("      Resume a paused session"));
      writeOutput(color("text")("  /list") + color("inactive")("              List all sessions"));
      writeOutput(color("text")("  /results <id>") + color("inactive")("     Show ranked hypotheses"));
      writeOutput(color("text")("  /overview <id>") + color("inactive")("    Show research overview"));
      writeOutput(color("text")("  /export <id>") + color("inactive")("      Export results to file"));
      writeOutput(color("text")("  /delete <id>") + color("inactive")("      Delete a session"));
      writeOutput(color("text")("  /design <id>") + color("inactive")("      Generate experimental protocol"));
      writeOutput(color("text")("  /graph <id>") + color("inactive")("       Show knowledge graph"));
      writeOutput(color("text")("  /safety <id>") + color("inactive")("      Inspect quarantined hypotheses"));
      writeOutput(color("text")("  /activity <id>") + color("inactive")("   Show activity log"));
      writeOutput(color("text")("  /clear") + color("inactive")("            Clear screen"));
      writeOutput(color("text")("  /quit") + color("inactive")("              Exit co-scientist"));
      writeOutput(color("inactive")("  Up/Down arrows for command history."));
      break;

    case "run": {
      if (!args) {
        writeOutput(color("error")("  Usage: /run <research goal>"));
        writeOutput(color("inactive")("  Example: /run What are effective ML techniques for protein folding?"));
        break;
      }
      // Reset config in case env vars changed
      resetConfig();
      const seed = getConfig().seed;
      seedRng(seed);
      await startSession(args);
      // After session ends, show the REPL prompt again
      writeOutput(color("inactive")("\n  Session ended. Type /help for commands."));
      break;
    }

    case "resume": {
      if (!args) {
        writeOutput(color("error")("  Usage: /resume <sessionId>"));
        break;
      }
      resetConfig();
      await runMigrations();
      const memory = getContextStore();
      const session = memory.resolveSession(args);
      if (!session) {
        writeOutput(color("error")(`  Session not found: ${args}`));
        break;
      }
      if (session.status !== "paused") {
        writeOutput(color("warning")(`  Session "${session.name}" is ${session.status}, not paused.`));
        break;
      }
      const goal = memory.getResearchGoal(session.id);
      if (!goal) {
        writeOutput(color("error")(`  Could not restore research goal for session ${session.id.slice(0, 8)}.`));
        break;
      }
      writeOutput(color("success")(`  Resuming: ${session.name} (${session.id.slice(0, 8)})`));
      await startSession(goal, session.name);
      writeOutput(color("inactive")("\n  Session ended. Type /help for commands."));
      break;
    }

    case "list": {
      await runMigrations();
      const memory = getContextStore();
      const sessions = memory.listSessions();
      if (sessions.length === 0) {
        writeOutput(color("inactive")("  No sessions found."));
        break;
      }
      writeOutput(color("claude").bold(`Sessions (${sessions.length}):`));
      for (const s of sessions) {
        const statusColor = s.status === "completed" ? color("success")
          : s.status === "running" ? color("warning")
          : s.status === "paused" ? color("permission")
          : color("inactive");
        const status = statusColor(s.status.padEnd(12));
        const hyps = s.stats?.totalHypotheses ?? 0;
        const topElo = s.stats?.topEloRating ?? 0;
        writeOutput(
          color("inactive")(`  ${s.id.slice(0, 8)}  `) +
          status +
          color("text")(`  ${s.name}`) +
          color("inactive")(`  Hyp:${hyps} Elo:${Math.round(topElo)}`)
        );
      }
      break;
    }

    case "results": {
      if (!args) {
        writeOutput(color("error")("  Usage: /results <sessionId>"));
        break;
      }
      await runMigrations();
      const memory = getContextStore();
      const session = memory.resolveSession(args);
      if (!session) {
        writeOutput(color("error")(`  Session not found: ${args}`));
        break;
      }
      const hyps = memory.getTopHypotheses(session.id, 10);
      if (hyps.length === 0) {
        writeOutput(color("inactive")("  No hypotheses for this session."));
        break;
      }
      writeOutput(color("claude").bold(`Results: ${session.name}`));
      for (let i = 0; i < hyps.length; i++) {
        const h = hyps[i];
        writeOutput(
          color("warning")(`  ${i + 1}. [${Math.round(h.eloRating)}] `) +
          color("text")(h.title.slice(0, 70))
        );
      }
      writeOutput(color("inactive")(`\n  Full: co-scientist results ${session.id}`));
      break;
    }

    case "overview": {
      if (!args) {
        writeOutput(color("error")("  Usage: /overview <sessionId>"));
        break;
      }
      await runMigrations();
      const memory = getContextStore();
      const session = memory.resolveSession(args);
      if (!session) {
        writeOutput(color("error")(`  Session not found: ${args}`));
        break;
      }
      if (!session.researchOverview) {
        writeOutput(color("inactive")("  No overview yet (session may still be running)."));
        break;
      }
      writeOutput(color("claude").bold(`Overview: ${session.name}`));
      writeOutput(session.researchOverview.slice(0, 2000));
      if (session.researchOverview.length > 2000) {
        writeOutput(color("inactive")("  ... (truncated)"));
      }
      writeOutput(color("inactive")(`\n  Full: co-scientist overview ${session.id}`));
      break;
    }

    case "delete": {
      if (!args) {
        writeOutput(color("error")("  Usage: /delete <sessionId>"));
        break;
      }
      await runMigrations();
      const memory = getContextStore();
      const session = memory.resolveSession(args);
      if (!session) {
        writeOutput(color("error")(`  Session not found: ${args}`));
        break;
      }
      try {
        memory.deleteSession(session.id);
        writeOutput(color("success")(`  Deleted: ${session.name} (${session.id.slice(0, 8)})`));
      } catch (err) {
        writeOutput(color("error")(`  Delete failed: ${(err as Error).message}`));
      }
      break;
    }

    case "export": {
      if (!args) {
        writeOutput(color("error")("  Usage: /export <sessionId>"));
        break;
      }
      await runMigrations();
      const memory = getContextStore();
      const session = memory.resolveSession(args);
      if (!session) {
        writeOutput(color("error")(`  Session not found: ${args}`));
        break;
      }
      const { exportCommand } = await import("./commands/export.js");
      await exportCommand(session.id, { format: "markdown" });
      break;
    }

    case "design": {
      if (!args) {
        writeOutput(color("error")("  Usage: /design <sessionId>"));
        break;
      }
      await runMigrations();
      const memory = getContextStore();
      const session = memory.resolveSession(args);
      if (!session) {
        writeOutput(color("error")(`  Session not found: ${args}`));
        break;
      }
      const { designCommand } = await import("./commands/design.js");
      await designCommand(session.id, {});
      break;
    }

    case "graph": {
      if (!args) {
        writeOutput(color("error")("  Usage: /graph <sessionId>"));
        break;
      }
      await runMigrations();
      const memory = getContextStore();
      const session = memory.resolveSession(args);
      if (!session) {
        writeOutput(color("error")(`  Session not found: ${args}`));
        break;
      }
      const { graphCommand } = await import("./commands/graph.js");
      await graphCommand(session.id, { format: "text" });
      break;
    }

    case "safety": {
      if (!args) {
        writeOutput(color("error")("  Usage: /safety <sessionId>"));
        break;
      }
      await runMigrations();
      const memory = getContextStore();
      const session = memory.resolveSession(args);
      if (!session) {
        writeOutput(color("error")(`  Session not found: ${args}`));
        break;
      }
      const { safetyCommand } = await import("./commands/safety.js");
      await safetyCommand(session.id, {});
      break;
    }

    case "activity": {
      if (!args) {
        writeOutput(color("error")("  Usage: /activity <sessionId>"));
        break;
      }
      await runMigrations();
      const memory = getContextStore();
      const session = memory.resolveSession(args);
      if (!session) {
        writeOutput(color("error")(`  Session not found: ${args}`));
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

    case "clear": {
      // Clear only the scroll region (above the fixed input box)
      const scrollBottom = termHeight() - BOX_ROWS;
      for (let row = 1; row <= scrollBottom; row++) {
        rawWrite(`\x1B[${row};1H`);
        rawWrite("\x1B[2K");
      }
      rawWrite(`\x1B[${scrollBottom};1H`);
      break;
    }

    default:
      writeOutput(color("error")(`  Unknown command: /${cmd}`));
      writeOutput(color("inactive")("  Type /help for commands."));
  }
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

export async function startInteractive(): Promise<void> {
  printBanner();

  console.log(color("claude").bold("  Welcome to Co-Scientist"));
  console.log(color("inactive")("  Multi-agent AI for scientific discovery"));
  console.log(color("inactive")(""));
  console.log(color("inactive")("  Type /run <goal> to start a research session"));
  console.log(color("inactive")("  Type /help for all commands"));
  console.log(color("inactive")("  Up/Down arrows for command history"));
  console.log("");

  // Intercept stdout for input preservation
  _originalStdoutWrite = process.stdout.write.bind(process.stdout);

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  hideCursor();

  // Set scroll region and draw the fixed input box at the bottom
  setScrollRegion();
  drawFixedBox();

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
        writeOutput(color("inactive")("^C"));
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
    // Reset scroll region to full screen
    rawWrite("\x1B[r");
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
  // Reset scroll region to full screen
  rawWrite("\x1B[r");
  process.stdout.write = _originalStdoutWrite;
  console.log(color("inactive")("Goodbye!"));
  closeDb();
}
