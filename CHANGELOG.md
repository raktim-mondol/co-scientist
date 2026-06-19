# Changelog

All notable changes to Co-Scientist will be documented in this file.

## [1.0.0] — 2026-06-19

### ⚡ Highlights

First stable release. Co-Scientist is a multi-agent AI system for automated scientific hypothesis generation, tournament ranking, and experimental protocol design — inspired by Gottweis et al., Nature (2026).

### ✨ Features

- **Multi-agent pipeline**: Generation, Literature Research, Reflection, Ranking (Glicko-2), Evolution, Proximity, Knowledge Graph, Meta-Review, and Experiment Design agents
- **Interactive REPL** with slash commands (Claude Code-style persistent input box)
  - `/list`, `/kill`, `/boost`, `/inject`, `/pause`, `/resume`, `/quit`, `/status`, `/search`, `/debate`, `/why`
  - Command history (Up/Down arrows, 50 entries)
  - Output batching via `queueMicrotask` — zero flicker
  - Confirmation prompts for destructive actions
- **Deep evidence pipeline**: Bounded search→plan→read→bank loop grounds hypotheses in actual page content
- **Citation verification**: DOI extraction, Crossref validation, fabrication-rate penalty in Glicko-2
- **Safety gate**: Dual-use/biosecurity quarantine with human-in-the-loop override
- **RLEF pipeline**: Reinforcement Learning from Experimental Feedback with cross-session semantic memory
- **Knowledge graph**: Concept/citation/hypothesis lineage tracking
- **Academic search**: Consensus MCP (primary) + Scite MCP (fallback) with OAuth PKCE
- **Headless CLI**: Full `--no-tui` support for scripted/automated runs
- **242 tests** across 14 test files (3,944 assertions)

### 🔒 Security

- Prompt injection defense: `wrapContent()` XML delimiters on 10 hypothesis injection points
- ANSI/C0 control character stripping on all user and DB input
- Input buffer capped at 2048 chars
- Concurrent dispatch guard on slash commands
- Bounded Elo (0–5000), inject title (500), and content (10,000) length caps
- PID lock file prevents concurrent DB corruption
- WAL mode with checkpoint-on-startup for crash recovery

### 🏗️ Architecture

- **Runtime**: Bun (not Node.js) — `bun:sqlite` + `drizzle-orm/bun-sqlite`
- **Vector search**: sqlite-vec for KNN/ANN hypothesis embedding search
- **Embeddings**: Local `all-MiniLM-L6-v2` via `@huggingface/transformers`
- **LLM**: DeepSeek v4 Pro via OpenAI-compatible SDK
- **Database**: SQLite at `~/.co-scientist/co-scientist.db`

### 🐛 Bug Fixes (from 3 audit rounds)

- Fixed Glicko-2 zero-sum invariant violation (atomic dual-entity update)
- Fixed search cache poisoning on transient failures
- Fixed Glicko-2 RD not updated for average reviews
- Fixed evolution agent exceeding `maxHypotheses` with multiple workers
- Fixed `deleteSession` without transaction (orphaned rows on SQLITE_BUSY)
- Fixed TOCTOU in `releaseQuarantine` (check inside transaction)
- Fixed JSON.parse safety on 4 unguarded DB fields
- Fixed rejected hypothesis embeddings polluting ANN index
- Fixed evidence digest context overflow (capped at 8000 chars)
- Fixed Glicko-2 division by zero with extreme ratings
- Fixed Illinois algorithm infinite loop (added k < 1000 guard)
- Fixed hypotheses stuck in "reviewing" after crash (auto-recovery)
- Fixed `closeDb()` must reset ContextStore singleton
- Fixed MCP provider permanent failure (60s TTL auto-reset)
- Fixed terminal cleanup on `/quit` and natural session completion
- Fixed exit handler accumulation across sessions
- Fixed command history leaking between sessions

### 📦 Dependencies

- `openai` ^4.52.7 — DeepSeek API client
- `@huggingface/transformers` ^3.0.0 — Local embedding model
- `@modelcontextprotocol/sdk` ^1.12.0 — Consensus/Scite MCP
- `drizzle-orm` ^0.45.2 — SQLite ORM
- `commander` ^12.1.0 — CLI framework
- `handlebars` ^4.7.8 — Prompt templates
- `chalk` ^5.3.0 — Terminal colors
- `inquirer` ^13.4.3 — Interactive prompts
