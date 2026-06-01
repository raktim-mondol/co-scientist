# Co-Scientist Feature Roadmap

Features identified from codebase analysis (2026-05-31). Clusters 1 (#1, #5) and 2 (#6) are already shipped.

---

## Chosen — Not Yet Implemented

### #4 Diversity-Aware Generation (MMR)

**Problem:** `GenerationAgent` deduplicates search *queries* but nothing stops hypotheses from converging on the same idea. Mode collapse wastes the budget and skews the tournament.

**Fix:** At hypothesis save-time in `GenerationAgent.execute`, compute cosine similarity between the new hypothesis embedding and all existing ones via `ContextStore.findSimilarByVector` (the sqlite-vec ANN index already exists). If the nearest neighbour exceeds a threshold (e.g. 0.92), discard or flag the new hypothesis as a near-duplicate. Optionally, feed "here is what already exists in embedding space — explore elsewhere" into the generation prompt.

**Key files:** `src/agents/generation.ts`, `src/memory/contextStore.ts` (`findSimilarByVector`), `src/util/rng.ts` (already seeded)

**No new dependencies** — reuses existing embeddings + sqlite-vec infrastructure.

---

### #8 Mid-Run Steering

**Problem:** Human feedback is currently post-hoc only (RLEF per hypothesis after the session ends). There is no way to redirect a running session — e.g. "focus on mechanism X, deprioritise Y" — without stopping and restarting.

**Fix:** Add a CLI command `co-scientist steer <sessionId>` (and a TUI keybind) that:
1. Calls `supervisor.pause()` (already implemented).
2. Prompts the user for a free-text directive.
3. Persists the directive to a new `session_directives` table.
4. Resumes; `GenerationAgent` and `EvolutionAgent` prepend the directive to their prompts on the next round; `TaskScheduler.computeWeights` can accept an optional directive-driven weight override.

**Key files:** `src/agents/supervisor.ts` (`pause`/`resume`), `src/taskQueue/queue.ts`, `src/agents/generation.ts`, `src/agents/evolution.ts`, `src/cli/index.ts`, `src/cli/tui/` (keybind)

---

### #9 Contradiction Detection → Decisive Experiment

**Problem:** The system outputs a ranked list of hypotheses but does not surface when two top-ranked ones make *opposing* predictions — which is the most scientifically interesting situation and the clearest pointer to what experiment to run next.

**Fix:**
1. After each `ProximityAgent` run, add a contradiction-detection pass: for every high-similarity pair, call the LLM to classify the relationship as `supports | neutral | contradicts`.
2. Store `contradicts` edges in `kg_edges` (`relation = "contradicts"`).
3. In `MetaReviewAgent` or a new `ContradictionAgent`, surface the top contradicting pair and call `ExperimentDesignAgent` to propose the *single experiment* that would discriminate between them. Persist and display in `overview` / `export`.

**Key files:** `src/agents/proximity.ts`, `src/agents/knowledgeGraph.ts`, `src/agents/experimentDesign.ts`, `src/agents/metaReview.ts`, `src/memory/contextStore.ts` (`kgEdges`), `src/db/schema.ts`

---

## Original Suggestions — Not Yet Selected

### #2 Real Model Tiering

**Problem:** `DeepSeekClient.reason()` (`src/llm/deepseek.ts:63`) is currently an alias for `chat()` — both call the same model with thinking disabled. The `mode: "reason"` vs `"chat"` distinction that agents carefully choose has no effect at the API level.

**Fix:** Route `reason()` calls to a stronger model or re-enable thinking for ranking and deep-verification tasks. The simplest path: add a `DEEPSEEK_REASON_MODEL` env var (e.g. pointing to a thinking-enabled variant) and use it in `reason()` while keeping `chat()` on the cheaper model. Agents already split their calls correctly — only the LLM client needs to honour the split.

**Key files:** `src/llm/deepseek.ts`, `src/config.ts`

---

### #3 LLM-Based RLEF Reward Extraction

**Problem:** `analyzeSentiment()` in `src/rlef/reward-signal.ts:38` counts keyword substrings and does not handle negation. "Not effective", "failed to show harm", "no significant improvement" all score incorrectly. This drives the K=48 Glicko-2 update with a noisy signal.

**Fix:** Replace the lexicon with a small structured LLM call: `{ sentiment: -1..1, confidence: 0..1, reasoning: "..." }`. Keep the lexicon as an offline fallback when the LLM is unavailable. The public `extractRewardFromFeedback` signature stays identical.

**Key files:** `src/rlef/reward-signal.ts`, `src/agents/base.ts` (for LLM access)

---

### #7 Multi-Model Judge Ensemble

**Problem:** Every review and tournament verdict comes from one DeepSeek model, sharing its blind spots. A hypothesis that happens to be phrased in a style that model prefers gets an unfair advantage.

**Fix:**
1. Generalise `DeepSeekClient` behind an `LLMProvider` interface (`chat`, `reason`, `embed`).
2. Add a second provider (e.g. a Claude or OpenAI client implementing the same interface).
3. In `RankingAgent._judgeMatch`, run the verdict through both providers and take a majority vote (or treat disagreement as a draw). The Glicko-2 update is unchanged.

**Key files:** `src/llm/deepseek.ts` → extract `src/llm/provider.ts` interface, `src/agents/ranking.ts`, `src/agents/base.ts`, `src/config.ts`

---

### #10 Cost-Aware Scheduling

**Problem:** The scheduler optimises for Elo convergence but is blind to cost. An expensive generation step that produces a weak hypothesis is treated the same as a cheap one that produces a strong one.

**Fix:** Add per-agent cost tracking in `ContextStore.getTokensByAgent` (already exists) converted to dollars using a price table keyed by model. Compute an `eloGainPerDollar` metric per agent type after each round and blend it into `TaskScheduler.computeWeights` as a multiplicative factor. Expose the cost breakdown in `results` and `export`.

**Key files:** `src/taskQueue/queue.ts` (`TaskScheduler`), `src/memory/contextStore.ts`, `src/config.ts` (price table), `src/cli/commands/list.ts`, `src/cli/commands/export.ts`

---

## Implementation Notes (All Features)

- Follow the established delivery pattern: design spec in `docs/superpowers/specs/`, implementation plan in `docs/superpowers/plans/`, feature branch off `main`, PR.
- Run `bun test` + `bunx tsc --noEmit` before every commit.
- Each feature is independent — they can be implemented in any order.
