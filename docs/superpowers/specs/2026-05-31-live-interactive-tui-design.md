# Live Interactive TUI — Design

**Date:** 2026-05-31
**Status:** Approved
**Component:** `co-scientist run --tui`

## Summary

Add a live, interactive terminal UI to the `run` command that displays a real-time
leaderboard, status header, and activity ticker while a research session executes,
and lets the operator steer the run via keyboard: kill, boost, or inject hypotheses,
plus pause/resume. Built with Ink + React (both already present in `package.json` but
currently unused) and wired through the already-declared `--no-tui` flag in
`src/cli/index.ts` (TUI is on by default; `--no-tui` opts out).

## Goals

- Real-time visibility into a running session (leaderboard, tokens/budget, activity).
- Mid-run human steering: reject, Elo-boost, and inject hypotheses.
- Genuine in-process pause/resume.
- Zero changes to agent reasoning logic; reuse existing `ContextStore` mutation paths.
- TUI is the default `run` experience on a TTY; `--no-tui` (and non-TTY) keep the
  existing plain output.

## Non-Goals (YAGNI)

- Redirecting generation focus / sub-goal steering (explicitly deferred).
- A web dashboard.
- Adding `ink-testing-library`; Ink rendering is verified manually.

## Activation & Fallback

- Consume the existing `tui?: boolean` flag in `RunOptions` (`run.ts:22`), already
  registered as `--no-tui` in `src/cli/index.ts:34`. Commander sets `options.tui`
  to `true` by default and `false` when `--no-tui` is passed — so the TUI runs by
  default on a real terminal.
- When `options.tui` is false, the current `ora`/`chalk` single-line progress output is
  used (existing behavior, unchanged).
- If `process.stdout.isTTY` is falsy (piped/CI), the TUI is skipped regardless of the
  flag and the plain renderer is used.

## Architecture

New directory `src/cli/tui/`. `run.ts` continues to construct the `SupervisorAgent`,
an `EventEmitter`, and the `ContextStore` exactly as today. When `--tui` is set, instead
of attaching the chalk event handlers it calls:

```
renderTUI({ emitter, sessionId, supervisor, memory })
```

then `await supervisor.run(sessionId)`. On the `completed` event (or stop) the TUI
unmounts and `run.ts` prints the existing final summary.

### Components

Each component is focused and independently readable:

- `index.tsx` — `renderTUI()`. Owns Ink `render()`, returns the instance, unmounts on
  completion.
- `App.tsx` — root state container + keyboard routing via `useInput`. Holds the
  selected leaderboard index and which modal (if any) is open.
- `Header.tsx` — session id, goal, elapsed time, token-budget gauge, hypothesis count,
  average top-10 Elo.
- `Leaderboard.tsx` — selectable list (↑↓ moves selection), shows rank, Elo, title,
  status glyph.
- `Ticker.tsx` — single-line rolling activity feed.
- `Footer.tsx` — hotkey hints.
- `modals/KillModal.tsx` — confirm rejection.
- `modals/BoostModal.tsx` — set new Elo for the selected hypothesis.
- `modals/InjectModal.tsx` — multi-field text input for a new hypothesis.
- `useSessionData.ts` — hook subscribing to emitter events (`progress`,
  `hypothesis_added`, `match_completed`, `completed`) and polling
  `memory.getTopHypotheses()` every ~1s and on events. Returns `{ header, leaderboard,
  ticker }` state.
- `actions.ts` — **pure functions** `killHypothesis`, `boostHypothesis`,
  `injectHypothesis`, each taking `(memory, …)`. Extracted here specifically so they are
  unit-testable without rendering Ink.

## Data Flow & Steering

The supervisor re-reads hypothesis state from SQLite every loop iteration
(`countHypotheses`, `getTopHypotheses`, `getAllActiveHypotheses`,
`getPendingReviewHypotheses`). Therefore steering actions only need to write to
`ContextStore`; the supervisor picks up the change on its next iteration. The TUI and
supervisor share one event loop, so synchronous `bun:sqlite` writes are race-free.

- **Kill** → `memory.updateHypothesisStatus(id, "rejected")`. Confirm modal first.
- **Boost** → `memory.atomicGlicko2Update(id, c => ({ ...c, rating: newElo }))`. Uses the
  existing transaction so it cannot clobber a concurrent tournament write. Modal lets the
  operator type the new Elo (default = current + 100).
- **Inject** → `memory.saveHypothesis({ …, status: "pending_review", eloRating: 1200,
  ratingDeviation: 350, volatility: 0.06, matchesPlayed: 0, wins: 0, losses: 0,
  generationStrategy: "manual_injection", parentIds: [], generationRound: <current> })`.
  Enters as `pending_review` so reflection + provenance vet it like any generated
  hypothesis before it competes.

## Supervisor Changes (small, additive)

- Add a `paused` boolean flag and `pause()` / `resume()` methods.
- `pause()` sets the flag and calls `this.queue.pause()`; `resume()` clears the flag and
  calls `this.queue.start()`.
- In the orchestration loop, before the termination check, idle while paused:
  `while (this.paused && this.running) await sleep(200)`.
- `[p]` toggles pause live. `[q]` performs the existing graceful stop → marks the session
  `paused` (resumable via the existing `resume` command).
- No changes to event payloads or any agent logic.

## Error Handling

- Non-TTY → fall back to the plain renderer.
- Empty inject title/content → modal validation rejects; nothing is saved.
- Boost/kill with an empty leaderboard or no selection → no-op.
- Terminal resize → components use flex/percentage widths so Ink reflows.
- SIGINT while the TUI is mounted → unmount cleanly, mark the session `paused`, print the
  resume hint.

## Testing

- `actions.ts` pure functions, tested with `bun:test` against a temp DB:
  - kill sets status to `rejected`,
  - boost raises Elo via the atomic path (and leaves other Glicko fields coherent),
  - inject lands a hypothesis with status `pending_review` and a fresh Elo.
- Supervisor `pause()`/`resume()`: assert the flag toggles and that the loop idles while
  paused (does not advance rounds / drain the queue).
- Ink rendering: manual verification (`co-scientist run --tui --goal "…"`).

## Files Touched

- New: `src/cli/tui/index.tsx`, `App.tsx`, `Header.tsx`, `Leaderboard.tsx`, `Ticker.tsx`,
  `Footer.tsx`, `useSessionData.ts`, `actions.ts`, `modals/{Kill,Boost,Inject}Modal.tsx`.
- New test: `src/tests/tui-actions.test.ts`.
- Modified: `src/cli/commands/run.ts` (consume `options.tui` + TTY check, branch to TUI
  vs plain, fallback), `src/agents/supervisor.ts` (pause/resume).
- `src/cli/index.ts` needs no change — `--no-tui` is already registered.
</content>
</invoke>
