import { z } from "zod";
import { homedir } from "os";
import { join } from "path";
import "dotenv/config";

const ConfigSchema = z.object({
  // DeepSeek LLM
  deepseek: z.object({
    apiKey: z.string().min(1, "DEEPSEEK_API_KEY is required"),
    baseURL: z.string().url().default("https://api.deepseek.com"),
    model: z.string().default("deepseek-chat"),
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
      gateEnabled: process.env.SAFETY_GATE?.toLowerCase() === "false" ? false : undefined,
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

// Logger moved to src/util/logger.ts — re-export for backward compatibility.
export { logger, setLoggerSilenced } from "./util/logger.js";
