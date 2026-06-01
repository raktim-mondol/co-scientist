import { z } from "zod";
import { homedir } from "os";
import { join } from "path";
import "dotenv/config";
import chalk from "chalk";

const ConfigSchema = z.object({
  // DeepSeek LLM
  deepseek: z.object({
    apiKey: z.string().min(1, "DEEPSEEK_API_KEY is required"),
    baseURL: z.string().url().default("https://api.deepseek.com"),
    model: z.string().default("deepseek-v4-pro"),
  }),

  // MCP Tools
  tools: z.object({
    parallelAi: z.object({
      apiKey: z.string().default(""),
    }),
    consensus: z.object({
      url: z.string().url().default("https://mcp.consensus.app/mcp"),
      apiKey: z.string().optional(),
    }),
  }),

  // Database
  db: z.object({
    path: z.string().default(join(homedir(), ".co-scientist", "co-scientist.db")),
  }),

  // Compute Budget
  compute: z.object({
    maxWorkers: z.number().int().positive().default(3),
    maxHypotheses: z.number().int().positive().default(5),
    maxTournamentRounds: z.number().int().positive().default(100),
    budgetTokens: z.number().int().nonnegative().default(500_000), // 0 = unlimited
  }),

  // Generation quality
  generation: z.object({
    // Save-time near-duplicate cosine threshold. 1 (or >1) disables the gate.
    diversityThreshold: z.number().min(0).max(1).default(0.92),
  }),

  // Reproducibility
  seed: z.number().int().optional(),         // seeds all scheduling/sampling RNG

  // Logging
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

function loadConfig(): AppConfig {
  // ── Reproducibility prelude ──────────────────────────────────────────────
  const seedRaw =
    process.env.SEED !== undefined && process.env.SEED !== ""
      ? parseInt(process.env.SEED, 10)
      : undefined;
  const seed = seedRaw !== undefined && !Number.isNaN(seedRaw) ? seedRaw : undefined;

  const raw = {
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY ?? "",
      baseURL: process.env.DEEPSEEK_BASE_URL,
      model: process.env.DEEPSEEK_MODEL,
    },
    tools: {
      parallelAi: {
        apiKey: process.env.PARALLEL_AI_API_KEY ?? "",
      },
      consensus: {
        url: process.env.CONSENSUS_MCP_URL,
        apiKey: process.env.CONSENSUS_API_KEY,
      },
    },
    db: {
      path: process.env.DB_PATH,
    },
    compute: {
      maxWorkers: process.env.MAX_WORKERS
        ? parseInt(process.env.MAX_WORKERS, 10)
        : undefined,
      maxHypotheses: process.env.MAX_HYPOTHESES
        ? parseInt(process.env.MAX_HYPOTHESES, 10)
        : undefined,
      maxTournamentRounds: process.env.MAX_TOURNAMENT_ROUNDS
        ? parseInt(process.env.MAX_TOURNAMENT_ROUNDS, 10)
        : undefined,
      budgetTokens: process.env.COMPUTE_BUDGET_TOKENS
        ? parseInt(process.env.COMPUTE_BUDGET_TOKENS, 10)
        : undefined,
    },
    generation: {
      diversityThreshold: (() => {
        const v = process.env.GENERATION_DIVERSITY_THRESHOLD;
        if (!v) return undefined;
        const n = parseFloat(v);
        return Number.isNaN(n) ? undefined : n;
      })(),
    },
    seed,
    logLevel: process.env.LOG_LEVEL,
  };

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  • ${e.path.join(".")}: ${e.message}`)
      .join("\n");
    throw new Error(`Configuration error:\n${errors}`);
  }
  return result.data;
}

// Singleton config
let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

/**
 * Invalidate the cached config so the next getConfig() call re-reads env vars.
 * Call this after programmatically setting process.env overrides (e.g. from CLI flags).
 */
export function resetConfig(): void {
  _config = null;
}

// Logger utility
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
  // Match the leading [AgentName] or [AgentName:Sub] bracket
  return msg.replace(/^\[([^\]]+)\]/, (_full, tag) => {
    const base = tag.split(":")[0].split(" ")[0];
    const colorFn = AGENT_COLORS[base];
    return colorFn ? colorFn(`[${tag}]`) : `[${tag}]`;
  });
}

export const logger = {
  debug: (msg: string, ...args: unknown[]) => {
    if (LOG_LEVELS[getConfig().logLevel] <= LOG_LEVELS.debug) {
      console.debug(`[DEBUG] ${colorizeTag(msg)}`, ...args);
    }
  },
  info: (msg: string, ...args: unknown[]) => {
    if (LOG_LEVELS[getConfig().logLevel] <= LOG_LEVELS.info) {
      const isThinking = msg.includes("] Thinking:");
      const body = `[INFO]  ${colorizeTag(msg)}`;
      console.info(isThinking ? chalk.dim(body) : body, ...args);
    }
  },
  warn: (msg: string, ...args: unknown[]) => {
    if (LOG_LEVELS[getConfig().logLevel] <= LOG_LEVELS.warn) {
      console.warn(chalk.yellow(`[WARN]  ${colorizeTag(msg)}`), ...args);
    }
  },
  error: (msg: string, ...args: unknown[]) => {
    if (LOG_LEVELS[getConfig().logLevel] <= LOG_LEVELS.error) {
      console.error(chalk.red(`[ERROR] ${colorizeTag(msg)}`), ...args);
    }
  },
};
