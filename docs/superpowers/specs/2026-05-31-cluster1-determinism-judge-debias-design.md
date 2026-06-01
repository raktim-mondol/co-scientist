# Cluster 1 — Reproducibility (seed-only) + Tournament Judge Debiasing

**Date:** 2026-05-31
**Status:** Awaiting approval
**Branch:** `feature/cluster1-determinism-judge-debias`
**Scope:** Features **#1** (judge debiasing) and **#5** (reproducibility, *seed-only*) from the agreed phased roadmap. This is the first of ~4 clusters; each ships on its own branch.

> Process note: part of this cluster was implemented before this doc existed. The code described here is in place and the full suite passes (140 tests), but nothing is committed and the CLI flag is not yet wired — those steps wait on your approval of this design. The LLM response cache (the "cache replay" half of #5) was built and then **reverted** because you chose **"Seed only."**

---

## 1. Context

`co-scientist` makes several stochastic decisions per run:

- `TaskScheduler.sampleNextTaskType` — weighted-random choice of the next agent task (`src/taskQueue/queue.ts`)
- `EvolutionAgent` — random pick of the target/seed hypothesis for `cross_pollination` and `out_of_box` (`src/agents/evolution.ts`)
- `RankingAgent._selectMatchup` — random secondary opponent (`src/agents/ranking.ts`)

All used `Math.random()`, so two runs of the same goal diverge immediately and bugs are hard to reproduce.

Separately, the ranking tournament uses an LLM as judge. The matchup selector always places the higher-priority (higher rating-deviation) hypothesis in **slot "A"**, and the judge prompt always presents A first. LLM judges have a documented **position bias** toward the first candidate — so slot-A hypotheses get a systematic, rating-distorting advantage that is also *correlated with uncertainty*.

## 2. Goals / Non-goals

**Goals**
- A `--seed <n>` makes every stochastic *scheduling/sampling* decision reproducible.
- Remove systematic position bias from tournament judging.
- No behavioural change when no seed is set and (for judging) keep added LLM cost minimal.

**Non-goals (explicitly out of scope for this cluster)**
- LLM response cache / byte-for-byte "replay" determinism (you chose seed-only).
- Forcing single-worker execution under a seed.
- Changing the Glicko-2 math or matchup *selection* heuristics.

## 3. Design — #5 Reproducibility (seed-only)

### 3.1 `src/util/rng.ts` (new)
A tiny seeded PRNG module (mulberry32) with three entry points:
- `rng(): number` — float in `[0, 1)`. If a seed is configured it is deterministic; otherwise it falls back to `Math.random()`.
- `rngInt(n): number` — integer in `[0, n)`; returns `0` for `n <= 0` (no out-of-range indexing).
- `seedRng(seed | undefined)` / `resetRng()` — explicit control, used by the CLI and tests.

It lazily initializes from `getConfig().seed` on first use, wrapped in try/catch so it is safe to call before config exists (returns `Math.random()` in that case). This means call sites need no wiring beyond importing `rng`/`rngInt`.

### 3.2 Config & CLI
- `config.ts`: add optional `seed: z.number().int().optional()`, read from `SEED` env (NaN-guarded → undefined).
- `cli/index.ts` + `cli/commands/run.ts`: add `--seed <n>`; the handler sets `process.env.SEED` before `resetConfig()`, matching the existing `--budget`/`--max-hypotheses` pattern, then calls `seedRng(getConfig().seed)`.
- `resume` is not given a flag in this cluster; resuming deterministically is done via the `SEED` env var (the lazy init picks it up).

### 3.3 Call-site changes
Replace `Math.random()` with `rng()`/`rngInt()` in the three files listed in §1. No other logic changes.

### 3.4 Determinism caveat (documented, not enforced)
With `MAX_WORKERS > 1`, task-*completion* order is still non-deterministic, so a seed alone does not guarantee identical end-to-end runs. For stricter reproducibility a user can add `--max-workers 1`. We document this rather than forcing it, to avoid silently degrading performance (that trade-off belonged to the "full replay" option you declined).

## 4. Design — #1 Judge debiasing

### 4.1 `src/agents/judgeDebias.ts` (new, pure/testable)
- `type Verdict = "A" | "B" | "draw"`
- `mapPresentedVerdict(presented, swapped)` — translate a verdict from the *presented* layout back to real A/B terms (`draw` is orientation-independent).
- `combineSwappedVerdicts(normal, swapped)` — reconcile two real-terms verdicts: agree → that winner; one decisive + one draw → the decisive winner; contradiction (A vs B) → **draw** (the verdict was position-dependent, so it is treated as inconclusive).

### 4.2 `RankingAgent._judgeMatch(...)` (new private method)
Replaces the direct `_runSimpleMatch`/`_runDebateMatch` call in `_runMatch`. Returns a `DebateResult` whose `winner` is always in real A/B terms.

- **Simple matches** (1 cheap LLM call each → affordable to double): **swap-and-average** — judge both `A,B` and `B,A`, map the swapped verdict back, and combine. A winner that flips with order collapses to a draw. Rationale + transcript record both orientations.
- **Debate matches** (3 expensive `reason` calls): a single **seeded-random** orientation via `rng() < 0.5`, mapped back to real terms. This removes the *systematic* slot-A advantage across the tournament without doubling the most expensive path. The chosen order is noted in the rationale.

Downstream Glicko-2 update, match persistence, and logging are unchanged — they consume the real-terms `winner`.

## 5. Components & interfaces summary

| Unit | Purpose | Depends on |
|------|---------|-----------|
| `util/rng.ts` | Seeded RNG, fallback to `Math.random` | `config` (lazy) |
| `judgeDebias.ts` | Pure verdict orientation/reconciliation | none |
| `RankingAgent._judgeMatch` | Orchestrate order-robust judging | `judgeDebias`, `rng`, existing match methods |
| `config.seed` + `--seed` | Surface the seed | `commander`, env |

## 6. Testing

- `src/tests/rng.test.ts` — determinism for a fixed seed, divergence for different seeds, range bounds, `rngInt(0)`, fallback behaviour, reset. (7 tests, passing)
- `src/tests/judgeDebias.test.ts` — full truth table for `combineSwappedVerdicts` + `mapPresentedVerdict`, incl. "winner survives order swap" and "contradiction → draw". (13 tests, passing)
- Full suite: **140 pass / 0 fail**. The LLM-dependent `_judgeMatch` orchestration is exercised indirectly; its decision logic lives in the pure, fully-tested `judgeDebias` helpers.

## 7. Remaining work after approval
1. Wire the `--seed` CLI flag on `run` (config + `cli/index.ts` + `run.ts`).
2. Update `README` / `.env.example` with `SEED` and the determinism caveat.
3. Commit on the feature branch.
