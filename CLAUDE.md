# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install              # Install dependencies
bun test                 # Run all tests
bun test src/tests/core.test.ts   # Run a single test file
bun run dev              # Run CLI without installing globally
bun link                 # Install `co-scientist` command globally
bun build src/cli/index.ts --outdir dist  # Build distributable
bun run src/db/migrate.ts  # Run migrations manually (auto-runs on session start)
```

Tests use `bun:test` (not Jest/Vitest). Run a single test by name: `bun test --test-name-pattern "Elo plateau"`.

The CLI entry point is `src/cli/index.ts`. When running in dev mode use `bun run src/cli/index.ts <command>` in place of `co-scientist <command>`.

## Architecture

### Multi-Agent Pipeline

`SupervisorAgent` (`src/agents/supervisor.ts`) orchestrates all other agents using a priority queue (`AgentTaskQueue`) and a weighted sampler (`TaskScheduler`). Each iteration of the supervisor loop samples one task type (generation, reflection, ranking, evolution, proximity, meta_review) using dynamic weights that shift based on session state (hypothesis count, pending reviews, Elo plateau). Termination is triggered by token budget exhaustion, Elo plateau detection, or hypothesis cap + all-ranked.

Agents:
- **GenerationAgent** — produces new hypotheses via 4 strategies (literature exploration, scientific debate, assumption chaining, research expansion). The `generate_queries` prompt is a sub-step within `literature_exploration`, not a separate strategy.
- **LiteratureResearchAgent** — bounded DeepResearch-style loop (search → plan → read → bank); builds the per-session evidence bank that grounds `literature_exploration` with actual page content instead of search snippets
- **ReflectionAgent** — 3-stage review pipeline (initial → full → deep verification), runs `ProvenanceAgent` inline to fact-check claims against literature
- **RankingAgent** — Glicko-2 tournament; runs multi-turn LLM debates between hypothesis pairs
- **EvolutionAgent** — mutates top hypotheses using 6 strategies (coherence, combination, cross_pollination, grounding, out_of_box, simplification)
- **ProximityAgent** — computes cosine similarity between hypothesis embeddings; triggers `KnowledgeGraphAgent` after each run
- **KnowledgeGraphAgent** — builds a concept/citation/hypothesis graph from session data
- **MetaReviewAgent** — periodic critique synthesis + final research overview
- **ExperimentDesignAgent** — generates a step-by-step experimental protocol for the top-ranked hypothesis after session completes
- **ReportAgent** (`src/agents/report.ts`) — builds a publication-style manuscript from a completed session for the `report` command. Narrative sections (abstract/background/discussion/limitations) are one LLM call (`src/prompts/report/manuscript.yaml`); Methods, Results and the global numbered bibliography are assembled deterministically from the DB. The de-duplicated bibliography is built by `reportBibliography.ts` (reusing the CrossRef resolver in `src/tools/citationResolver.ts`); Markdown/LaTeX are pure string builders in `reportRenderers.ts`, and DOCX/PDF shell out to `pandoc`. The result is cached in the `manuscripts` table (`ManuscriptStore`) so re-exports skip the LLM unless `--regenerate` is passed.

### BaseAgent

All agents extend `BaseAgent` (`src/agents/base.ts`), which provides:
- `loadPrompt(category, name, vars)` — loads a Handlebars YAML template from `src/prompts/{category}/{name}.yaml`, compiles it, and returns `{ system, userPrompt, maxTokens }`
- `callLLM(system, prompt, opts)` — wraps DeepSeek; supports `maxTokens`, `temperature`, and `jsonMode` options
- `callLLMForJSON<T>(...)` — calls LLM with `jsonMode: true` and retries if JSON extraction fails
- `extractJSON<T>(text)` — multi-strategy JSON extraction (direct parse → code block → balanced-brace scan → jsonrepair)
- `memory` — singleton `ContextStore` for all DB reads/writes
- `search` — `SearchTool` (Parallel AI + Consensus MCP, with Scite MCP fallback)

### Prompt Templates

All LLM prompts live in `src/prompts/{category}/{name}.yaml`. Each file has three keys:
```yaml
system: "..."   # Handlebars template
user: "..."     # Handlebars template
mode: chat | reason
max_tokens: 8192
```

To add or change agent behavior, edit the corresponding YAML — no TypeScript changes needed for prompt-only adjustments.

### Database

SQLite at `~/.co-scientist/co-scientist.db` (override with `DB_PATH` env var). Schema is managed in two places:
- `src/db/schema.ts` — Drizzle ORM table definitions (source of truth for types)
- `src/db/migrate.ts` — `runMigrations()` uses raw SQL `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` for idempotent inline migrations; called automatically on every `run`/`resume`

`drizzle-kit generate` / `bun run db:migrate` are available but not used in the normal flow — migrations run inline. The `drizzle.config.ts` exists for schema introspection tooling.

`ContextStore` (`src/memory/contextStore.ts`) is the only layer that touches the DB. All agents use `this.memory.*` methods rather than querying directly.

**Concurrency guards** (`src/db/index.ts`):
- **PID lock file** (`co-scientist.db.lock`) — prevents concurrent instances from corrupting the DB. On startup, if a lock file exists and the PID is alive, the new instance errors with a clear message. Stopped/zombie processes are auto-killed. Stale locks (dead PID) are auto-replaced. Cleaned up on normal exit via `closeDb()` and `process.on("exit")`.
- **WAL checkpoint on startup** — `PRAGMA wal_checkpoint(TRUNCATE)` runs when the connection opens, folding stale WAL pages from a crashed session back into the main DB.
- **`withRetry(fn, maxRetries)`** — wraps DB writes with exponential-backoff retry (100ms → 200ms → 400ms) on transient `SQLITE_LOCKED` errors. Used by `createSession()` and `saveHypothesis()`.
- **`busy_timeout = 5000`** — SQLite-level retry for `SQLITE_BUSY` (separate from `SQLITE_LOCKED`).

Two storage mechanisms for embeddings:
- `embedding_cache` table — raw Float32Array blob for retrieval
- `vec_embeddings` sqlite-vec virtual table — FLOAT[384] columns for KNN/ANN search; accessed via raw prepared statements (Drizzle does not support virtual tables)

### RLEF Pipeline

Reinforcement Learning from Experimental Feedback lives in `src/rlef/`:
- `reward-signal.ts` — `extractRewardFromFeedback()` derives a reward in `[-1, +1]` from free-text sentiment + N/C/T scores; `applyFeedbackAsGlicko2Match()` updates the hypothesis's Glicko-2 rating against a virtual opponent
- `reward-store.ts` — persists strong-signal feedback to `reward_memory` table; `getRelevantPriors()` does semantic KNN lookup to prime new sessions
- `prompt-injection.ts` — injects validated/refuted hypotheses into generation, reflection, and evolution prompts

### Config

`src/config.ts` exports a Zod-validated singleton `getConfig()` and a `logger` with agent-colour-coded output. Call `resetConfig()` after programmatically setting `process.env` overrides (done by CLI flag handlers before the first `getConfig()` call).

### LLM Client

`src/llm/deepseek.ts` uses the `openai` SDK pointed at the DeepSeek base URL. It exposes a single `call()` method that always runs in **non-thinking mode** (`buildRequestBody()` hard-sets `thinking: { type: "disabled" }`) plus an `embed()` method that delegates to a local all-MiniLM-L6-v2 pipeline (DeepSeek has no embedding endpoint). `buildRequestBody()` is pure and exported for testing. `call()` retries up to 3× with exponential backoff and strips any `<think>…</think>` blocks from the returned content.

The `mode: chat | reason` tag in each prompt YAML is currently advisory only — it is parsed by `loadPrompt()` but does not change request behaviour (all calls are non-thinking). DeepSeek thinking mode is **not** wired up: there is no `reason()`/`chat()` split and no `reasoning_content` capture. Token accounting (`getTotalTokensUsed()` / `getTokensDelta()`) drives `COMPUTE_BUDGET_TOKENS` termination.
