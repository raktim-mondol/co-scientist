/**
 * slashCommands.ts — Production-grade CLI interface
 * ─────────────────────────────────────────────────────────────────────────────
 * Claude Code-inspired UX:
 *   - Status bar at top with live session metrics
 *   - Syntax-highlighted input (command in cyan, args in white)
 *   - Tab completion for commands with visual menu
 *   - Thinking indicator ("...") while commands process
 *   - Contextual hint showing usage for recognized commands
 *   - Box-drawn structured output
 *   - Command history (Up/Down)
 *   - Confirmation for destructive actions
 *   - Output batching (zero flicker)
 *   - Terminal-width-aware line clearing
 */

import chalk from "chalk";
import type { EventEmitter } from "events";
import type { ContextStore } from "../memory/contextStore.js";
import type { SupervisorAgent } from "../agents/supervisor.js";
import type { SessionStats } from "../models/session.js";
import type { Hypothesis } from "../models/hypothesis.js";
import { killHypothesis, boostHypothesis, injectHypothesis } from "./actions.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SlashCommandContext {
  sessionId: string;
  memory: ContextStore;
  supervisor: SupervisorAgent;
  emitter: EventEmitter;
  startTime: number;
  budgetTokens: number;
  onComplete: () => void;
}

interface SlashCommand {
  name: string;
  description: string;
  usage: string;
  handler: (args: string, ctx: SlashCommandContext) => void | Promise<void>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_INPUT_LENGTH = 2048;
const ELO_MIN = 0;
const ELO_MAX = 5000;
const INJECT_TITLE_MAX = 500;
const INJECT_CONTENT_MAX = 10_000;
const MAX_HISTORY = 100;
/** Max rows for tab-completion menu. */
const COMPLETION_MAX_ROWS = 8;
/** Width of the bordered input box. */
const INPUT_BOX_WIDTH = 80;
const HLINE = "─".repeat(INPUT_BOX_WIDTH);
/** Number of terminal rows reserved for the fixed input box at the bottom. */
const BOX_ROWS = 3;

// ─── Terminal Helpers ─────────────────────────────────────────────────────────

function stripAnsi(str: string): string {
  return (
    str
      // eslint-disable-next-line no-control-regex
      .replace(/\x1B(?:\[[0-9;]*[a-zA-Z]|\][^\x07]*\x07|[^[].)/g, "")
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
  );
}

function rawWrite(str: string): void {
  if (_originalStdoutWrite) {
    _originalStdoutWrite(str);
  } else {
    process.stdout.write(str);
  }
}

function termWidth(): number {
  return process.stdout.columns || 80;
}

function termHeight(): number {
  return process.stdout.rows || 24;
}

function hideCursor(): void { rawWrite("\x1B[?25l"); }
function showCursor(): void { rawWrite("\x1B[?25h"); }

// ─── Output ──────────────────────────────────────────────────────────────────

function writeOutput(text: string): void {
  if (_closed) { process.stdout.write(text + "\n"); return; }
  // Save cursor, write into scroll region, restore cursor
  rawWrite("\x1B[s");
  const scrollBottom = termHeight() - BOX_ROWS;
  rawWrite(`\x1B[${scrollBottom};1H`);
  rawWrite("\x1B[J");
  const w = _originalStdoutWrite ?? process.stdout.write.bind(process.stdout);
  w(text + "\n");
  rawWrite("\x1B[u");
}

// ─── Shared State ────────────────────────────────────────────────────────────

let inputBuffer = "";
let cursorPos = 0;
let lastActivity = "";
let _stats: (SessionStats & { activity: string }) | null = null;
let _ctx: SlashCommandContext | null = null;
let _closed = false;
let _dispatching = false;
/** Original process.stdout.write — saved before interception, used by rawWrite. */
let _originalStdoutWrite: typeof process.stdout.write | null = null;
/** Original process.stderr.write — saved before interception, restored on close. */
let _originalStderrWrite: typeof process.stderr.write | null = null;
let _exitHandler: (() => void) | null = null;
/** Reference to the onData listener for cleanup. */
let _onDataRef: ((data: Buffer | string) => void) | null = null;

// Confirmation prompt state
let _confirming = false;
let _confirmCallback: ((confirmed: boolean) => void) | null = null;

// Tab completion state
let _completing = false;
let _completionMatches: string[] = [];
let _completionIdx = 0;

// Command history
const _history: string[] = [];
let _historyIdx = -1;
let _historySaved = "";

// Status bar timer
let _statusTimer: ReturnType<typeof setInterval> | null = null;

// ─── Visual Primitives ───────────────────────────────────────────────────────

/** Box-drawing characters (Unicode). */
const BOX = { tl: "\u256D", tr: "\u256E", bl: "\u256F", br: "\u2570", h: "\u2500", v: "\u2502" };

function boxLine(content: string, width: number): string {
  const stripped = stripAnsi(content);
  const pad = Math.max(0, width - 2 - stripped.length);
  return chalk.gray(BOX.v) + content + " ".repeat(pad) + chalk.gray(BOX.v);
}

function boxTop(width: number): string {
  return chalk.gray(BOX.tl + BOX.h.repeat(width - 2) + BOX.tr);
}

function boxBottom(width: number): string {
  return chalk.gray(BOX.bl + BOX.h.repeat(width - 2) + BOX.br);
}

/** Wrap text to fit within `width` columns. Returns array of lines. */
function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length + word.length + 1 > width && line.length > 0) {
      lines.push(line);
      line = word;
    } else {
      line = line ? line + " " + word : word;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

/** Print a structured box with a title. */
function writeBox(title: string, bodyLines: string[]): void {
  const width = Math.min(termWidth(), 80);
  const inner = width - 2;
  writeOutput(boxTop(width));
  if (title) {
    writeOutput(boxLine(chalk.bold(title), width));
    writeOutput(boxLine(chalk.gray(BOX.h.repeat(inner)), width));
  }
  for (const line of bodyLines) {
    // Wrap long lines
    const wrapped = wrapText(stripAnsi(line), inner);
    for (const w of wrapped) {
      writeOutput(boxLine("  " + line.slice(0, inner - 2), width));
      break; // first wrapped line only for styled content
    }
  }
  writeOutput(boxBottom(width));
}

// ─── Status Bar ──────────────────────────────────────────────────────────────

function formatTokensShort(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Build the status bar line shown at the top of the terminal. */
function buildStatusBar(): string {
  if (!_ctx) return "";
  const w = termWidth();
  const paused = _ctx.supervisor.isPaused();
  const state = paused ? chalk.bgYellow.black(" PAUSED ") : chalk.bgGreen.black(" RUN ");
  const elapsed = Math.round((Date.now() - _ctx.startTime) / 1000);
  const time = `${Math.floor(elapsed / 60)}m${String(elapsed % 60).padStart(2, "0")}s`;

  const session = _ctx.memory.getSession(_ctx.sessionId);
  const tokens = session?.stats?.tokensUsed ?? 0;
  const budget = _ctx.budgetTokens;
  const tokStr = budget > 0
    ? `${formatTokensShort(tokens)}/${formatTokensShort(budget)}`
    : formatTokensShort(tokens);

  const hyps = _stats?.totalHypotheses ?? 0;
  const round = _stats?.currentRound ?? 0;

  const left = ` ${state} ${chalk.gray(time)} `;
  const right = ` hyp:${hyps} rnd:${round} tok:${tokStr} `;
  const mid = " ".repeat(Math.max(0, w - left.length - right.length - stripAnsi(left).length + left.length - stripAnsi(left).length));
  // Simple approach: pad with spaces
  const bar = left + chalk.gray(" ".repeat(Math.max(1, w - stripAnsi(left + right).length))) + right;
  return chalk.bgHex("#1a1a2e")(bar.slice(0, w));
}

/** Move cursor to row 0 and redraw the status bar. */
function drawStatusBar(): void {
  if (_closed || !_ctx) return;
  // Save cursor, move to top, draw bar, restore cursor
  rawWrite("\x1B[s");       // save cursor position
  rawWrite("\x1B[1;1H");    // move to row 1, col 1
  rawWrite("\x1B[2K");      // clear the line
  rawWrite(buildStatusBar());
  rawWrite("\x1B[u");       // restore cursor position
}

function startStatusBar(): void {
  if (_statusTimer) return;
  drawStatusBar();
  _statusTimer = setInterval(drawStatusBar, 2000);
}

function stopStatusBar(): void {
  if (_statusTimer) {
    clearInterval(_statusTimer);
    _statusTimer = null;
  }
}

// ─── Prompt & Input Rendering ────────────────────────────────────────────────

function buildPrompt(): string {
  if (_dispatching) return chalk.gray(" ") + chalk.gray("...") + chalk.white(" ");
  if (!_ctx) return chalk.gray(" ") + chalk.green(">") + chalk.white(" ");
  const paused = _ctx.supervisor.isPaused();
  const marker = paused ? chalk.yellow(">") : chalk.green(">");
  return chalk.gray(" ") + marker + chalk.white(" ");
}

/**
 * Syntax-highlight the input buffer.
 * Command name in cyan bold, arguments in white.
 */
function highlightInput(): string {
  if (!inputBuffer.startsWith("/")) return inputBuffer;
  const spaceIdx = inputBuffer.indexOf(" ");
  if (spaceIdx === -1) {
    // Just a command name — color it based on whether it's valid
    const cmdName = inputBuffer.slice(1).toLowerCase();
    const valid = commands.some((c) => c.name === cmdName || c.name.startsWith(cmdName));
    return valid ? chalk.cyan.bold(inputBuffer) : chalk.red(inputBuffer);
  }
  const cmd = inputBuffer.slice(0, spaceIdx);
  const args = inputBuffer.slice(spaceIdx);
  const cmdName = cmd.slice(1).toLowerCase();
  const valid = commands.some((c) => c.name === cmdName);
  const cmdColor = valid ? chalk.cyan.bold : chalk.red;
  return cmdColor(cmd) + chalk.white(args);
}

/** Build the hint line shown below input when a command is recognized. */
function buildHint(): string {
  if (!inputBuffer.startsWith("/") || inputBuffer.includes(" ")) return "";
  const cmdName = inputBuffer.slice(1).toLowerCase();
  const cmd = commands.find((c) => c.name === cmdName);
  if (cmd) return chalk.gray(`  ${cmd.usage} — ${cmd.description}`);
  // Partial match — show first match
  const partial = commands.filter((c) => c.name.startsWith(cmdName));
  if (partial.length === 1 && cmdName.length >= 2) {
    return chalk.gray(`  ${partial[0].usage} — ${partial[0].description}`);
  }
  if (partial.length > 1 && partial.length <= 4) {
    return chalk.gray(`  ${partial.map((c) => "/" + c.name).join("  ")}`);
  }
  return "";
}

/**
 * Calculate how many terminal lines a string occupies (for wrapped text).
 */
function visualLineCount(str: string, width: number): number {
  const stripped = stripAnsi(str);
  const lines = stripped.split("\n");
  let total = 0;
  for (const line of lines) {
    total += Math.max(1, Math.ceil(Math.max(1, line.length) / width));
  }
  return total;
}

/**
 * Set the DECSTBM scroll region to rows 1..(H-BOX_ROWS).
 * Bottom BOX_ROWS rows are pinned for the input box.
 */
function setScrollRegion(): void {
  const h = termHeight();
  const scrollBottom = h - BOX_ROWS;
  if (scrollBottom < 1) return;
  rawWrite(`\x1B[1;${scrollBottom}r`);
  rawWrite(`\x1B[${scrollBottom};1H`);
}

/**
 * Draw the 3-line input box at the bottom of the terminal.
 * Called once at startup. Top and bottom lines never change.
 */
function drawFixedBox(): void {
  const h = termHeight();
  const inputRow = h - 1;

  // Row h-2: top line
  rawWrite(`\x1B[${h - 2};1H`);
  rawWrite("\x1B[2K");
  rawWrite(chalk.gray(HLINE));

  // Row h-1: input line
  rawWrite(`\x1B[${inputRow};1H`);
  rawWrite("\x1B[2K");
  rawWrite(buildPrompt() + highlightInput());

  // Row h: bottom line
  rawWrite(`\x1B[${h};1H`);
  rawWrite("\x1B[2K");
  rawWrite(chalk.gray(HLINE));

  // Position cursor
  positionCursor();
}

function redrawInput(): void {
  if (_closed) return;
  const h = termHeight();
  const inputRow = h - 1;

  // Update only the input row
  rawWrite(`\x1B[${inputRow};1H`);
  rawWrite("\x1B[2K");
  rawWrite(buildPrompt() + highlightInput());

  // Show hint on the bottom line if command is partially typed
  const hint = buildHint();
  rawWrite(`\x1B[${h};1H`);
  rawWrite("\x1B[2K");
  rawWrite(hint || chalk.gray(HLINE));

  positionCursor();
}

function positionCursor(): void {
  const h = termHeight();
  const inputRow = h - 1;
  const promptLen = stripAnsi(buildPrompt()).length;
  const col = promptLen + cursorPos + 1;
  rawWrite(`\x1B[${inputRow};${col}H`);
}

// ─── Tab Completion ──────────────────────────────────────────────────────────

function getCompletions(partial: string): string[] {
  if (!partial.startsWith("/")) return [];
  const name = partial.slice(1).toLowerCase();
  return commands
    .filter((c) => c.name.startsWith(name))
    .map((c) => "/" + c.name);
}

function showCompletionMenu(): void {
  if (_completionMatches.length === 0) return;
  _completing = true;
  _completionIdx = 0;

  const items = _completionMatches.slice(0, COMPLETION_MAX_ROWS);
  const lines = items.map((m, i) => {
    const cmd = commands.find((c) => "/" + c.name === m);
    const desc = cmd ? chalk.gray(`  ${cmd.description}`) : "";
    const sel = i === _completionIdx ? chalk.cyan.bold(`> ${m}`) : `  ${m}`;
    return sel + desc;
  });
  if (_completionMatches.length > COMPLETION_MAX_ROWS) {
    lines.push(chalk.gray(`  ... and ${_completionMatches.length - COMPLETION_MAX_ROWS} more`));
  }
  writeOutput(lines.join("\n"));
}

function handleTabCompletion(): void {
  if (_completing) {
    // Cycle through matches
    _completionIdx = (_completionIdx + 1) % _completionMatches.length;
    inputBuffer = _completionMatches[_completionIdx];
    cursorPos = inputBuffer.length;
    redrawInput();
    return;
  }

  const matches = getCompletions(inputBuffer);
  if (matches.length === 0) return;

  if (matches.length === 1) {
    // Single match — auto-complete immediately
    inputBuffer = matches[0] + " ";
    cursorPos = inputBuffer.length;
    redrawInput();
  } else {
    // Multiple matches — show menu and complete to longest common prefix
    _completionMatches = matches;
    _completing = true;
    _completionIdx = 0;

    // Find longest common prefix
    let prefix = matches[0];
    for (const m of matches) {
      while (!m.startsWith(prefix)) {
        prefix = prefix.slice(0, -1);
      }
    }
    if (prefix.length > inputBuffer.length) {
      inputBuffer = prefix;
      cursorPos = inputBuffer.length;
    }

    showCompletionMenu();
    redrawInput();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function getLeaderboard(ctx: SlashCommandContext): Hypothesis[] {
  return ctx.memory.getTopHypotheses(ctx.sessionId, 20);
}

function resolveHypothesis(ctx: SlashCommandContext, raw: string): Hypothesis | null {
  const lb = getLeaderboard(ctx);
  const idx = parseInt(raw, 10);
  if (!Number.isNaN(idx) && idx >= 1 && idx <= lb.length) return lb[idx - 1];
  return lb.find((h) => h.id === raw) ?? null;
}

function pushHistory(cmd: string): void {
  if (!cmd.trim()) return;
  if (_history.length > 0 && _history[_history.length - 1] === cmd) return;
  _history.push(cmd);
  if (_history.length > MAX_HISTORY) _history.shift();
}

// ─── Confirmation Prompt ─────────────────────────────────────────────────────

function confirmPrompt(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    _confirming = true;
    writeOutput(chalk.yellow(`  ${message} [y/N]`));
    _confirmCallback = (ok: boolean) => {
      _confirming = false;
      _confirmCallback = null;
      resolve(ok);
    };
  });
}

// ─── Command Registry ────────────────────────────────────────────────────────

const commands: SlashCommand[] = [
  {
    name: "help",
    description: "Show available commands",
    usage: "/help",
    handler: () => {
      const lines: string[] = [];
      for (const cmd of commands) {
        lines.push(`  ${chalk.cyan.bold(cmd.usage.padEnd(28))} ${chalk.gray(cmd.description)}`);
      }
      lines.push("");
      lines.push(chalk.gray("  Up/Down: history  Tab: autocomplete  Ctrl+C: cancel  Ctrl+D: quit"));
      writeBox("Available Commands", lines);
    },
  },

  {
    name: "status",
    description: "Show current session status",
    usage: "/status",
    handler: (args, ctx) => {
      const lb = getLeaderboard(ctx);
      const session = ctx.memory.getSession(ctx.sessionId);
      const elapsed = Math.round((Date.now() - ctx.startTime) / 1000);
      const timeStr = `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
      const tokens = session?.stats?.tokensUsed ?? 0;
      const pct = ctx.budgetTokens > 0 ? Math.round((tokens / ctx.budgetTokens) * 100) : 0;
      const paused = ctx.supervisor.isPaused();
      const avg = lb.length > 0 ? Math.round(lb.reduce((s, h) => s + h.eloRating, 0) / lb.length) : 0;

      writeBox("Session Status", [
        `  ${chalk.bold("ID:")}      ${ctx.sessionId.slice(0, 8)}  ${paused ? chalk.yellow("PAUSED") : chalk.green("RUNNING")}`,
        `  ${chalk.bold("Time:")}    ${timeStr}`,
        `  ${chalk.bold("Tokens:")}  ${formatTokens(tokens)}${ctx.budgetTokens > 0 ? ` / ${formatTokens(ctx.budgetTokens)} (${pct}%)` : ""}`,
        `  ${chalk.bold("Hyps:")}    ${lb.length}  (avg elo: ${avg})`,
        `  ${chalk.bold("Activity:")} ${lastActivity || "starting..."}`,
      ]);
    },
  },

  {
    name: "list",
    description: "Show hypothesis leaderboard",
    usage: "/list",
    handler: (args, ctx) => {
      const lb = getLeaderboard(ctx);
      if (lb.length === 0) {
        writeOutput(chalk.gray("  (no hypotheses yet)"));
        return;
      }
      const lines: string[] = [];
      lines.push(`  ${"#".padStart(3)}  ${"Elo".padStart(5)}  ${"St".padEnd(2)}  Hypothesis`);
      lines.push(chalk.gray("  " + "-".repeat(Math.min(70, termWidth() - 4))));
      const maxTitle = Math.max(20, termWidth() - 22);
      for (let i = 0; i < lb.length; i++) {
        const h = lb[i];
        const glyph = h.status === "active" ? "+"
          : h.status === "pending_review" || h.status === "reviewing" ? "~"
          : h.status === "rejected" ? "x"
          : h.status === "evolved" ? "*"
          : ".";
        const col = h.status === "active" ? chalk.white
          : h.status === "rejected" ? chalk.red.dim
          : chalk.gray;
        const title = stripAnsi(h.title);
        const trunc = title.length > maxTitle ? title.slice(0, maxTitle - 3) + "..." : title;
        lines.push(col(`  ${String(i + 1).padStart(3)}  ${String(Math.round(h.eloRating)).padStart(5)}  ${glyph.padEnd(2)}  ${trunc}`));
      }
      writeBox(`Leaderboard (${lb.length} hypotheses)`, lines);
    },
  },

  {
    name: "kill",
    description: "Reject a hypothesis (requires confirmation)",
    usage: "/kill <index|id>",
    handler: async (args, ctx) => {
      const raw = args.trim();
      if (!raw) {
        writeOutput(chalk.red("  Usage: /kill <index|id>"));
        return;
      }
      const hyp = resolveHypothesis(ctx, raw);
      if (!hyp) {
        writeOutput(chalk.red(`  Not found: ${stripAnsi(raw)}`) + chalk.gray("  Use /list"));
        return;
      }
      if (hyp.status === "rejected") {
        writeOutput(chalk.yellow(`  Already rejected: ${stripAnsi(hyp.title).slice(0, 50)}`));
        return;
      }
      const ok = await confirmPrompt(`Kill "${stripAnsi(hyp.title).slice(0, 50)}"?`);
      if (!ok) { writeOutput(chalk.gray("  Cancelled.")); return; }
      killHypothesis(ctx.memory, hyp.id);
      writeOutput(chalk.red(`  Killed: ${stripAnsi(hyp.title)}`));
    },
  },

  {
    name: "boost",
    description: "Set hypothesis Elo to an absolute value",
    usage: "/boost <index|id> <elo>",
    handler: (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      if (parts.length < 2) {
        writeOutput(chalk.red("  Usage: /boost <index|id> <elo>"));
        return;
      }
      const [rawId, rawElo] = parts;
      const hyp = resolveHypothesis(ctx, rawId);
      if (!hyp) {
        writeOutput(chalk.red(`  Not found: ${stripAnsi(rawId)}`) + chalk.gray("  Use /list"));
        return;
      }
      const newElo = parseInt(rawElo, 10);
      if (Number.isNaN(newElo)) { writeOutput(chalk.red(`  Invalid: ${stripAnsi(rawElo)}`)); return; }
      if (newElo < ELO_MIN || newElo > ELO_MAX) { writeOutput(chalk.red(`  Range: ${ELO_MIN}-${ELO_MAX}`)); return; }
      const old = Math.round(hyp.eloRating);
      boostHypothesis(ctx.memory, hyp.id, newElo);
      writeOutput(chalk.yellow(`  Boosted: ${stripAnsi(hyp.title).slice(0, 50)}`) + chalk.gray(`  ${old} -> ${newElo}`));
    },
  },

  {
    name: "inject",
    description: "Inject a new expert hypothesis",
    usage: "/inject <title> | <content>",
    handler: (args, ctx) => {
      const sep = args.indexOf("|");
      if (sep === -1 || !args.trim()) {
        writeOutput(chalk.red("  Usage: /inject <title> | <content>"));
        return;
      }
      const rawTitle = args.slice(0, sep).trim();
      const rawContent = args.slice(sep + 1).trim();
      if (!rawTitle || !rawContent) { writeOutput(chalk.red("  Title and content required.")); return; }
      if (rawTitle.length > INJECT_TITLE_MAX) { writeOutput(chalk.red(`  Title max ${INJECT_TITLE_MAX} chars.`)); return; }
      if (rawContent.length > INJECT_CONTENT_MAX) { writeOutput(chalk.red(`  Content max ${INJECT_CONTENT_MAX} chars.`)); return; }
      const title = stripAnsi(rawTitle);
      const content = stripAnsi(rawContent);
      const allHyps = ctx.memory.getTopHypotheses(ctx.sessionId, 50);
      const round = allHyps.length > 0 ? Math.max(...allHyps.map((h: Hypothesis) => h.generationRound)) : 0;
      const hyp = injectHypothesis(ctx.memory, { sessionId: ctx.sessionId, title, summary: "", content, generationRound: round });
      writeOutput(chalk.green(`  Injected: ${title}`) + chalk.gray(`  id=${hyp.id.slice(0, 8)}`));
    },
  },

  {
    name: "pause",
    description: "Pause the supervisor",
    usage: "/pause",
    handler: (args, ctx) => {
      if (ctx.supervisor.isPaused()) { writeOutput(chalk.yellow("  Already paused.")); return; }
      ctx.supervisor.pause();
      writeOutput(chalk.yellow("  Paused. /resume to continue."));
    },
  },

  {
    name: "resume",
    description: "Resume a paused session",
    usage: "/resume",
    handler: (args, ctx) => {
      if (!ctx.supervisor.isPaused()) { writeOutput(chalk.gray("  Not paused.")); return; }
      ctx.supervisor.resume();
      writeOutput(chalk.green("  Resumed."));
    },
  },

  {
    name: "clear",
    description: "Clear the screen",
    usage: "/clear",
    handler: () => {
      const h = termHeight();
      const scrollBottom = h - BOX_ROWS;
      for (let row = 1; row <= scrollBottom; row++) {
        rawWrite(`\x1B[${row};1H`);
        rawWrite("\x1B[2K");
      }
      rawWrite(`\x1B[${scrollBottom};1H`);
    },
  },

  {
    name: "quit",
    description: "Stop session (save as paused, resumable)",
    usage: "/quit",
    handler: () => { gracefulQuit(); },
  },
];

// ─── Command Dispatch ────────────────────────────────────────────────────────

async function dispatchCommand(raw: string, ctx: SlashCommandContext): Promise<void> {
  const input = raw.trim();
  if (!input) return;

  if (input.startsWith("/")) {
    const spaceIdx = input.indexOf(" ");
    const cmdName = spaceIdx === -1 ? input.slice(1).toLowerCase() : input.slice(1, spaceIdx).toLowerCase();
    const args = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1);

    const cmd = commands.find((c) => c.name === cmdName);
    if (cmd) {
      try {
        await cmd.handler(args, ctx);
      } catch (err) {
        const msg = stripAnsi((err as Error).message ?? "Unknown error");
        writeOutput(chalk.red(`  Error: ${msg.slice(0, 300)}`));
      }
    } else {
      writeOutput(chalk.red(`  Unknown: /${stripAnsi(cmdName)}`) + chalk.gray("  /help for commands"));
    }
  } else {
    writeOutput(chalk.gray("  /help for commands"));
  }
}

// ─── Event Listeners ─────────────────────────────────────────────────────────

const _listeners: Array<{ emitter: EventEmitter; event: string; fn: (...args: any[]) => void }> = [];

function on(emitter: EventEmitter, event: string, fn: (...args: any[]) => void): void {
  emitter.on(event, fn);
  _listeners.push({ emitter, event, fn });
}

function removeAllListeners(): void {
  for (const { emitter, event, fn } of _listeners) emitter.off(event, fn);
  _listeners.length = 0;
}

function setupEventListeners(ctx: SlashCommandContext): void {
  on(ctx.emitter, "progress", (stats: SessionStats & { activity: string }) => {
    _stats = stats;
    lastActivity = stats.activity;
    drawStatusBar();
  });

  on(ctx.emitter, "hypothesis_added", (count: number) => {
    writeOutput(chalk.green(`  + hypothesis #${count}`));
  });

  on(ctx.emitter, "match_completed", (round: number) => {
    writeOutput(chalk.blue(`  - round ${round}`));
  });

  on(ctx.emitter, "completed", (overview: string) => {
    writeOutput("");
    writeOutput(chalk.bold.green("  Session completed!"));
    if (overview) {
      const preview = overview.slice(0, 400).split("\n").slice(0, 6).join("\n");
      writeOutput(chalk.gray(preview));
      if (overview.length > 400) writeOutput(chalk.gray("  ..."));
    }
    writeOutput("");
    writeOutput(chalk.cyan(`  Results:  co-scientist results ${ctx.sessionId}`));
    writeOutput(chalk.cyan(`  Overview: co-scientist overview ${ctx.sessionId}`));
    writeOutput(chalk.cyan(`  Export:   co-scientist export ${ctx.sessionId}`));
    ctx.onComplete();
  });

  on(ctx.emitter, "error", (err: Error) => {
    writeOutput(chalk.red(`  Error: ${stripAnsi(err.message ?? "Unknown")}`));
  });
}

// ─── Keypress Handler ────────────────────────────────────────────────────────

function handleKeypress(key: { name?: string; ctrl?: boolean; sequence?: string }): void {
  if (_closed || !_ctx) return;

  // Confirmation mode
  if (_confirming && _confirmCallback) {
    _confirmCallback(key.sequence === "y" || key.sequence === "Y");
    return;
  }

  const { name, ctrl, sequence } = key;

  // Tab completion
  if (name === "tab") {
    handleTabCompletion();
    return;
  }

  // Any other key cancels tab completion mode
  if (_completing && name !== "tab") {
    _completing = false;
    _completionMatches = [];
  }

  // Ctrl+C
  if (ctrl && name === "c") {
    if (inputBuffer.length > 0) {
      inputBuffer = ""; cursorPos = 0; _historyIdx = -1;
      writeOutput(chalk.gray("^C"));
    } else {
      gracefulQuit();
    }
    return;
  }

  // Ctrl+D
  if (ctrl && name === "d") { gracefulQuit(); return; }

  // Enter
  if (name === "return") {
    if (_dispatching) return;
    const cmd = inputBuffer;
    inputBuffer = ""; cursorPos = 0; _historyIdx = -1;
    pushHistory(cmd);
    _dispatching = true;
    redrawInput(); // show "..." prompt
    dispatchCommand(cmd, _ctx).finally(() => { _dispatching = false; redrawInput(); });
    return;
  }

  // Up arrow — history
  if (name === "up") {
    if (_history.length === 0) return;
    if (_historyIdx === -1) { _historySaved = inputBuffer; _historyIdx = _history.length - 1; }
    else if (_historyIdx > 0) _historyIdx--;
    inputBuffer = _history[_historyIdx];
    cursorPos = inputBuffer.length;
    redrawInput();
    return;
  }

  // Down arrow — history
  if (name === "down") {
    if (_historyIdx === -1) return;
    if (_historyIdx < _history.length - 1) {
      _historyIdx++; inputBuffer = _history[_historyIdx];
    } else {
      _historyIdx = -1; inputBuffer = _historySaved;
    }
    cursorPos = inputBuffer.length;
    redrawInput();
    return;
  }

  // Backspace
  if (name === "backspace") {
    if (cursorPos > 0) {
      inputBuffer = inputBuffer.slice(0, cursorPos - 1) + inputBuffer.slice(cursorPos);
      cursorPos--; redrawInput();
    }
    return;
  }

  // Delete
  if (name === "delete") {
    if (cursorPos < inputBuffer.length) {
      inputBuffer = inputBuffer.slice(0, cursorPos) + inputBuffer.slice(cursorPos + 1);
      redrawInput();
    }
    return;
  }

  // Left/Right
  if (name === "left") { if (cursorPos > 0) { cursorPos--; redrawInput(); } return; }
  if (name === "right") { if (cursorPos < inputBuffer.length) { cursorPos++; redrawInput(); } return; }
  if (name === "home") { cursorPos = 0; redrawInput(); return; }
  if (name === "end") { cursorPos = inputBuffer.length; redrawInput(); return; }

  // Escape
  if (name === "escape") { inputBuffer = ""; cursorPos = 0; _historyIdx = -1; redrawInput(); return; }

  // Printable
  if (sequence && sequence.length === 1 && sequence >= " ") {
    if (inputBuffer.length >= MAX_INPUT_LENGTH) return;
    inputBuffer = inputBuffer.slice(0, cursorPos) + sequence + inputBuffer.slice(cursorPos);
    cursorPos++;
    redrawInput();
  }
}

function cleanupTerminal(): void {
  if (_closed) return;
  _closed = true;
  stopStatusBar();
  _ctx = null;
  showCursor();
  removeAllListeners();
  if (_onDataRef) process.stdin.removeListener("data", _onDataRef);
  if (process.stdin.isTTY) try { process.stdin.setRawMode(false); } catch { /* */ }
  process.stdin.pause();
  // Reset scroll region to full screen
  rawWrite("\x1B[r");
  if (_originalStdoutWrite) process.stdout.write = _originalStdoutWrite;
  if (_originalStderrWrite) process.stderr.write = _originalStderrWrite;
  _originalStdoutWrite = null;
  _originalStderrWrite = null;
  if (_exitHandler) { process.removeListener("exit", _exitHandler); _exitHandler = null; }
  process.stdout.write("\n");
}

function gracefulQuit(): void {
  if (!_ctx || _closed) return;
  writeOutput("  Stopping...");
  _ctx.supervisor.stop();
  _ctx.memory.updateSessionStatus(_ctx.sessionId, "paused");
  writeOutput(chalk.cyan(`  Resume: co-scientist resume ${_ctx.sessionId}`));
  _ctx.onComplete();
  // Clean up terminal immediately so user isn't stuck in raw mode
  cleanupTerminal();
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

export function startSlashCommands(ctx: SlashCommandContext): { close: () => void } {
  // Reset all state
  inputBuffer = ""; cursorPos = 0; lastActivity = ""; _stats = null;
  _dispatching = false; _confirming = false; _confirmCallback = null;
  _completing = false; _completionMatches = []; _completionIdx = 0;
  _historyIdx = -1; _historySaved = "";
  _history.length = 0;  // Clear history between sessions
  _listeners.length = 0;

  _ctx = ctx;
  _closed = false;

  setupEventListeners(ctx);

  // Intercept stdout/stderr
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  _originalStdoutWrite = originalStdoutWrite;
  _originalStderrWrite = originalStderrWrite;

  function interceptedWrite(original: typeof process.stdout.write, chunk: any, ...rest: any[]): boolean {
    if (_closed) return original(chunk, ...rest);
    let str: string;
    try { str = typeof chunk === "string" ? chunk : String(chunk); }
    catch { return original(chunk, ...rest); }

    // Write into the scroll region — save cursor, go to scroll bottom, write, restore
    rawWrite("\x1B[s");
    const scrollBottom = termHeight() - BOX_ROWS;
    rawWrite(`\x1B[${scrollBottom};1H`);
    rawWrite("\x1B[J");

    // Strip \r-only progress lines to just the content
    const clean = str.replace(/\r(?!\n)/g, "");
    original(clean, ...rest);

    rawWrite("\x1B[u");
    return true;
  }

  process.stdout.write = ((chunk: any, ...rest: any[]) => interceptedWrite(originalStdoutWrite, chunk, ...rest)) as any;
  process.stderr.write = ((chunk: any, ...rest: any[]) => interceptedWrite(originalStderrWrite, chunk, ...rest)) as any;

  // Raw mode stdin
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  const onData = (data: Buffer | string) => {
    const str = typeof data === "string" ? data : data.toString("utf8");
    if (str === "\r" || str === "\n") handleKeypress({ name: "return" });
    else if (str === "\x03") handleKeypress({ name: "c", ctrl: true });
    else if (str === "\x04") handleKeypress({ name: "d", ctrl: true });
    else if (str === "\x7F" || str === "\x08") handleKeypress({ name: "backspace" });
    else if (str === "\x1B[D") handleKeypress({ name: "left" });
    else if (str === "\x1B[C") handleKeypress({ name: "right" });
    else if (str === "\x1B[A") handleKeypress({ name: "up" });
    else if (str === "\x1B[B") handleKeypress({ name: "down" });
    else if (str === "\x1B[H") handleKeypress({ name: "home" });
    else if (str === "\x1B[F") handleKeypress({ name: "end" });
    else if (str === "\x1B[3~") handleKeypress({ name: "delete" });
    else if (str === "\x1B") handleKeypress({ name: "escape" });
    else if (str === "\t") handleKeypress({ name: "tab" });
    else if (str.length === 1 && str >= " ") handleKeypress({ sequence: str });
  };

  process.stdin.on("data", onData);
  _onDataRef = onData;

  // Safety net
  _exitHandler = () => {
    showCursor();
    stopStatusBar();
    rawWrite("\x1B[r"); // reset scroll region
    if (process.stdin.isTTY) try { process.stdin.setRawMode(false); } catch { /* */ }
    if (_originalStdoutWrite) {
      process.stdout.write = _originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    }
  };
  process.on("exit", _exitHandler);

  // Clear screen and draw initial UI
  rawWrite("\x1B[2J");  // clear entire screen
  rawWrite("\x1B[1;1H"); // cursor to top
  startStatusBar();
  hideCursor();
  writeOutput(chalk.cyan.bold("  Co-Scientist Interactive Mode"));
  writeOutput(chalk.gray("  Type /help for commands. Tab to autocomplete. Up/Down for history."));
  writeOutput("");
  // Set scroll region and draw the fixed input box at the bottom
  setScrollRegion();
  drawFixedBox();

  return {
    close: () => cleanupTerminal(),
  };
}
