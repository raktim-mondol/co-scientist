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
    // Thinking (chain-of-thought) mode. Applies to reason() calls only — chat()
    // is always non-thinking. reasoningBudgetTokens is added on top of a call's
    // max_tokens so reasoning can't starve the answer (see DeepSeek client).
    thinking: z.object({
      enabled: z.boolean().default(true),
      reasoningEffort: z.enum(["high", "max"]).default("high"),
      reasoningBudgetTokens: z.number().int().nonnegative().default(8000),
      // Stream reasoning_content to stderr in real-time (light gray).
      // Off by default — set DEEPSEEK_STREAM_THINKING=true to watch the model think.
      streamThinking: z.boolean().default(false),
    }).default({}),
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
    scite: z.object({
      url: z.string().url().default("https://api.scite.ai/mcp"),
      apiKey: z.string().optional(),       // static API key (skips OAuth)
    }),
    // Priority-ordered academic search providers. Comma-separated:
    // "consensus,scite" (default), "scite,consensus", "consensus", "scite".
    academicSearchProviders: z.string().default("consensus,scite"),

    // How to use the provider list:
    //   priority — try in order, first success wins (default)
    //   parallel — call all configured providers, merge results
    //   fallback — try first; only use next if first returns zero results or errors
    academicSearchMode: z.enum(["priority", "parallel", "fallback"]).default("priority"),

    // Headless browser fallback for JS-heavy citation URLs (Cloudflare, SPAs).
    // Requires: bun add playwright && npx playwright install chromium (~200MB).
    // Disabled by default. Set CITATION_HEADLESS_BROWSER=true to enable.
    citationHeadlessBrowser: z.boolean().default(false),
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

  // Deep evidence pipeline (DeepResearch-style literature loop)
  research: z.object({
    maxRounds: z.number().int().min(0).default(2),        // 0 disables the loop
    urlsPerRound: z.number().int().positive().default(3),
    maxContentChars: z.number().int().positive().default(40_000),
  }),

  // Generation quality
  generation: z.object({
    // Save-time near-duplicate cosine threshold. 1 (or >1) disables the gate.
    diversityThreshold: z.number().min(0).max(1).default(0.92),
  }),

  // Safety gate — withholds (quarantines) hypotheses whose dual-use / harm
  // severity meets the threshold, so they never enter the tournament.
  safety: z.object({
    gateEnabled: z.boolean().default(true),
    // Quarantine a hypothesis when its assessed severity is >= this level.
    quarantineThreshold: z.enum(["low", "moderate", "high"]).default("high"),
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
      thinking: {
        // DEEPSEEK_THINKING=false disables; unset/other leaves the default (enabled).
        enabled: process.env.DEEPSEEK_THINKING === "false" ? false : undefined,
        reasoningEffort: (() => {
          const v = process.env.DEEPSEEK_REASONING_EFFORT?.trim().toLowerCase();
          return v === "high" || v === "max" ? v : undefined;
        })(),
        reasoningBudgetTokens: process.env.DEEPSEEK_REASONING_BUDGET_TOKENS
          ? parseInt(process.env.DEEPSEEK_REASONING_BUDGET_TOKENS, 10)
          : undefined,
        streamThinking: process.env.DEEPSEEK_STREAM_THINKING === "true",
      },
    },
    tools: {
      parallelAi: {
        apiKey: process.env.PARALLEL_AI_API_KEY ?? "",
      },
      consensus: {
        url: process.env.CONSENSUS_MCP_URL,
        apiKey: process.env.CONSENSUS_API_KEY,
      },
      scite: {
        url: process.env.SCITE_MCP_URL,
        apiKey: process.env.SCITE_API_KEY,
      },
      academicSearchProviders: process.env.ACADEMIC_SEARCH_PROVIDERS,
      academicSearchMode: process.env.ACADEMIC_SEARCH_MODE,
      citationHeadlessBrowser: process.env.CITATION_HEADLESS_BROWSER === "true",
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
    research: {
      maxRounds: process.env.DEEP_RESEARCH_MAX_ROUNDS
        ? parseInt(process.env.DEEP_RESEARCH_MAX_ROUNDS, 10)
        : undefined,
      urlsPerRound: process.env.DEEP_RESEARCH_URLS_PER_ROUND
        ? parseInt(process.env.DEEP_RESEARCH_URLS_PER_ROUND, 10)
        : undefined,
      maxContentChars: process.env.DEEP_RESEARCH_MAX_CONTENT_CHARS
        ? parseInt(process.env.DEEP_RESEARCH_MAX_CONTENT_CHARS, 10)
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
    safety: {
      // SAFETY_GATE=false disables the gate; any other value (or unset) leaves the default (enabled).
      gateEnabled: process.env.SAFETY_GATE === "false" ? false : undefined,
      quarantineThreshold: (() => {
        const v = process.env.SAFETY_QUARANTINE_THRESHOLD?.trim().toLowerCase();
        return v === "low" || v === "moderate" || v === "high" ? v : undefined;
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
