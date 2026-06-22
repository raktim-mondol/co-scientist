# TUI Cleanup, Fixes & Correctness — Design

**Date:** 2026-06-23
**Status:** Approved
**Scope:** `src/cli/tui/` (commands, App, InputBar, Footer), `src/agents/supervisor.ts`, related tests

## Problem

The TUI has accumulated redundant/dead commands, one command that displays fabricated data, and two interaction bugs:

1. **Redundant / dead commands** — `/dashboard` (no-op), `/switch` (never switches; duplicates `/sessions`), `/delete` (opens the identical `SessionsModal` as `/sessions`), `/resume` (overlaps conceptually with session-resume in the `/sessions` picker).
2. **Fake data** — `/strategy` shows **hardcoded** sampling weights (`App.tsx:370-377`), not the live `TaskScheduler` weights.
3. **Cursor doesn't blink** — the input caret `▌` (`InputBar.tsx:181`) is a static glyph.
4. **Verbose output vanishes** — informational results returned as `type: "immediate"` render as a `Toast` that auto-dismisses after 3s instead of persisting in the scrollback transcript.
5. **Dead code (found during investigation)** — `closeModal` in `AppContext` is never called; `openModal`'s typed `data` param is silently dropped by the `App.tsx` implementation.

## Goals

- Remove the four redundant/dead commands and any code they uniquely depended on.
- Make `/pause` pause-only; route all resuming through the `/sessions` picker, including unpausing the current paused session.
- Make `/strategy` reflect the real scheduler weights.
- Make the input cursor blink.
- Ensure informational/verbose command output persists in the transcript; reserve toasts for trivial confirmations.
- Remove the identified dead code and honor the `openModal` data contract.
- Keep the full `bun test` suite green.

## Non-Goals

- No redesign of the `/sessions` picker UX, the leaderboard, or the modal system.
- No new commands.
- No changes to agent/LLM behavior beyond exposing already-computed scheduler weights.

## Design

### A. Remove redundant/dead commands

For each of `/dashboard`, `/switch`, `/delete`, `/resume`:
- Delete the command file under `src/cli/tui/commands/`.
- Remove its side-effect `import "./commands/<name>.js";` line in `App.tsx`.

`/sessions` already provides browse / view / overview / export / **resume** / **delete**, so `/switch` and `/delete` are fully covered. `/dashboard` only toasted that the leaderboard is always visible. `/resume` is replaced by Section B.

### B. `/pause` is pause-only; resume via `/sessions`

- **`commands/pause.ts`**: `activeWhen` stays `sessionId !== null && supervisor !== null && !paused`. `execute` calls `ctx.togglePause()` and returns `{ type: "immediate" }` **with no message** — `togglePause()` in `App.tsx` already pushes a persistent "Session paused." transcript notice, so the old toast was a duplicate.
- **`commands/resume.ts`**: deleted (Section A).
- **`App.tsx` `SessionsModal` `onResume`**: when the picked session is the current **paused** session (`id === sessionId && paused`), call `appContext.togglePause()` to unpause it and close the modal, instead of the current "Already on this session." no-op. All other paths (completed, running-elsewhere, stopped/DB reload) keep existing behavior.
- **`Footer.tsx`**: in the `paused` branch, replace the `/resume` hint with `/sessions` (the place resume now lives).

### C. `/strategy` shows real weights

- **`src/agents/supervisor.ts`**:
  - Add a private field `lastWeights: AgentWeights | null = null`, assigned from each `this.scheduler.computeWeights(...)` call in the supervisor loop.
  - Add a public method `getCurrentWeights(): AgentWeights`. It returns `lastWeights` if present; otherwise it computes weights from the current session stats (the same `SchedulerStats` shape the loop builds) so `/strategy` works before the first loop iteration. Reuses `this.scheduler.computeWeights(...)`.
- **`App.tsx`**: replace the hardcoded `weights={{ ... }}` object passed to `StrategyModal` with `supervisor?.getCurrentWeights() ?? <neutral fallback>`. `StrategyModal`'s prop shape stays `AgentWeights`.

### D. Cursor blink

- **`InputBar.tsx`**: add `cursorVisible` state, toggled by a `setInterval(~530ms)` inside a `useEffect` (cleared on unmount). Render:
  - End-of-text caret: `▌` when `cursorVisible`, a single space when not.
  - Mid-text caret: the character under the cursor with the inverse highlight when `cursorVisible`, plain when not.
- InputBar lives **outside** `<Static>`, so the periodic re-render is contained to the input region and does not disturb scrollback.

### E. Informational output persists; toasts only for trivial acks

**Rule:** `type: "transcript"` for anything the user should be able to read after a few seconds (state reports, multi-line output, file-write confirmations). `type: "immediate"` (toast) only for trivial acknowledgements and validation errors.

Reclassify existing `type: "immediate"` returns:

| Command | Today | Change |
|---|---|---|
| `/budget` (arg form) | immediate "Token budget set to …" | → `transcript` |
| `/logout` | immediate provider status lines | → `transcript` |
| `/export` (arg form) | immediate "Exported session as …" | → `transcript` |
| `/boost` (id form) | immediate "Boosted … to N Elo" | → `transcript` |
| `/kill` (id form) | immediate "Killed …" | → `transcript` |
| `/pause` | immediate "Session paused." | → no message (Section B; already persisted) |
| Validation errors / "Already on this session" | immediate/error | unchanged (toast) |

Each reclassified command builds a small block `TranscriptEntry` (via existing `formatters` helpers or an inline block) and returns `{ type: "transcript", entries: [...] }`. Toast auto-dismiss stays 3s for the trivial cases.

### F. Dead-code cleanup

- Remove `closeModal` from the `AppContext` interface (`CommandRouter.ts`) and its implementation in `App.tsx` (no call sites).
- Fix `openModal` in `App.tsx` to honor its declared `data` param: `openModal: (modal, data) => { setModalData(data ?? null); setActiveModal(modal); }`, so the typed contract is real.

## Testing

- **Update** `src/tests/tui/sessionsCommands.test.ts`: drop the `/switch` and `/delete` cases and their imports.
- **Reconcile** `src/tests/tui/CommandRouter.test.ts` if it asserts a command count or references removed commands.
- **Add** a test for `/pause` pause-only behavior (calls `togglePause`, no toast message) and for the `/sessions` unpause-current-paused path if reachable at the command/handler layer.
- **Add** a test for `supervisor.getCurrentWeights()` returning a valid `AgentWeights` (sums/shape) before and after a computed iteration.
- `bun test` must stay green (baseline 272 passing).

## Risks & Mitigations

- **Unpause gap**: removing `/resume` without wiring `/sessions` unpause would strand paused sessions. Section B's `onResume` change closes this; covered by manual verification in the TUI.
- **Cursor blink re-renders**: contained to InputBar (outside `<Static>`); interval cleared on unmount.
- **Removed commands referenced by tests**: addressed in Testing.

## Files Touched

- Delete: `commands/dashboard.ts`, `commands/switch.ts`, `commands/deleteCmd.ts`, `commands/resume.ts`
- Edit: `App.tsx`, `Footer.tsx`, `InputBar.tsx`, `commands/pause.ts`, `commands/budget.ts`, `commands/logout.ts`, `commands/exportCmd.ts`, `commands/boost.ts`, `commands/kill.ts`, `CommandRouter.ts`, `src/agents/supervisor.ts`
- Tests: `src/tests/tui/sessionsCommands.test.ts`, `src/tests/tui/CommandRouter.test.ts` (+ new cases)
