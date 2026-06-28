import chalk from "chalk";
import { getConfig } from "../config.js";

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

// Color palette for agent/component tags — chosen for CLI legibility and contrast:
//   Supervisor   → bold cyan      (orchestrator, high-visibility)
//   Generation   → green          (creative output, "go")
//   Reflection   → yellow         (analytical, caution/thought)
//   Ranking      → magenta        (scoring/competition)
//   MetaReview   → bold blue      (synthesis, authority)
//   ExperimentDesign → bold green (actionable, science)
//   Provenance   → gray           (supporting/metadata)
//   Evolution    → cyan           (growth, iteration)
//   KnowledgeGraph → blue         (structure, data)
//   Proximity    → white          (neutral utility)
//   Search       → bold yellow    (lookup, attention)
const AGENT_COLORS: Record<string, (s: string) => string> = {
  Supervisor:       chalk.bold.cyan,
  Generation:       chalk.green,
  Reflection:       chalk.yellow,
  Ranking:          chalk.magenta,
  MetaReview:       chalk.bold.blue,
  ExperimentDesign: chalk.bold.green,
  Provenance:       chalk.gray,
  Evolution:        chalk.cyan,
  KnowledgeGraph:   chalk.blue,
  Proximity:        chalk.white,
  Search:           chalk.bold.yellow,
};

function colorizeTag(msg: string): string {
  return msg.replace(/^\[([^\]]+)\]/, (_full, tag) => {
    const base = tag.split(":")[0].split(" ")[0];
    const colorFn = AGENT_COLORS[base];
    return colorFn ? colorFn(`[${tag}]`) : `[${tag}]`;
  });
}

// When the Ink TUI owns the screen, any console.* write corrupts the live
// frame (and with patchConsole would be reprinted on every re-render). The TUI
// surfaces progress via its own Activity panel, so the logger is fully muted
// for the TUI's lifetime. Toggled by the CLI around renderTUI()/waitUntilExit().
let loggerSilenced = false;

export function setLoggerSilenced(silenced: boolean): void {
  loggerSilenced = silenced;
}

export const logger = {
  debug: (msg: string, ...args: unknown[]) => {
    if (loggerSilenced) return;
    if (LOG_LEVELS[getConfig().logLevel] <= LOG_LEVELS.debug) {
      console.debug(`[DEBUG] ${colorizeTag(msg)}`, ...args);
    }
  },
  info: (msg: string, ...args: unknown[]) => {
    if (loggerSilenced) return;
    if (LOG_LEVELS[getConfig().logLevel] <= LOG_LEVELS.info) {
      console.info(`[INFO]  ${colorizeTag(msg)}`, ...args);
    }
  },
  warn: (msg: string, ...args: unknown[]) => {
    if (loggerSilenced) return;
    if (LOG_LEVELS[getConfig().logLevel] <= LOG_LEVELS.warn) {
      console.warn(chalk.yellow(`[WARN]  ${colorizeTag(msg)}`), ...args);
    }
  },
  error: (msg: string, ...args: unknown[]) => {
    if (loggerSilenced) return;
    if (LOG_LEVELS[getConfig().logLevel] <= LOG_LEVELS.error) {
      console.error(chalk.red(`[ERROR] ${colorizeTag(msg)}`), ...args);
    }
  },
};
