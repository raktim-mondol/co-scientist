# Sessions Picker Modal — Design

**Date:** 2026-06-22
**Status:** Approved (pending spec review)
**Area:** `src/cli/tui`

## Problem

The `/sessions` command dumps a multi-line block into the transcript — three lines per
session — which grows unusable (the user has **77 sessions**). The user wants a compact,
navigable picker in the same windowed UX as the existing `/delete` modal, from which they
can find, view, resume, delete, and inspect sessions. Separately, some content-bearing
output is shown as a **transient toast that auto-dismisses** when it should persist in the
scrollback.

## Goals

- Replace the long `/sessions` transcript dump with a compact, flicker-free, windowed modal
  (same layout as today's `DeleteModal`).
- One unified picker reachable from both `/sessions` and `/delete`.
- **Filter-as-you-type** to find a session quickly within a large list.
- Per-session actions: **view results** (read-only), **resume** (into the live TUI),
  **overview**, **export**, and **delete** (multi-select).
- View / overview output is a **permanent** transcript block including the full session ID.
- Make the `/switch <id>` "session found" details a permanent block instead of a toast.

## Non-goals

- A broad audit of every command's toast behaviour — only the sessions/switch flow changes.
  Quick acks (`Session paused`, `Already on this session`) stay as toasts.
- Sorting controls (YAGNI — filter + navigation suffice).

## Interaction model

The picker is **modal with two input modes** to avoid collisions between filter typing and
single-letter actions.

### Navigate mode (default)

| Key       | Action                                                         |
|-----------|----------------------------------------------------------------|
| `↑` / `↓` | Move selection                                                 |
| `enter`   | View highlighted session's results → permanent block, close    |
| `r`       | Resume highlighted session into the live TUI (see Resume)      |
| `o`       | Push highlighted session's overview block, close               |
| `e`       | Open export modal scoped to highlighted session                |
| `space`   | Toggle delete-mark (`[ ]` ⇄ `[*]`)                             |
| `d`       | If ≥1 marked → `confirm` stage                                 |
| `/`       | Enter filter mode                                              |
| `esc`     | Close → `onCancel()`                                           |

### Filter mode (entered via `/`)

| Key         | Action                                                       |
|-------------|--------------------------------------------------------------|
| any char    | Append to filter; list narrows live (matches name or id)     |
| `backspace` | Edit filter                                                  |
| `enter`     | Apply & return to navigate mode (filter stays applied)       |
| `esc`       | Clear filter & return to navigate mode                       |

Filtering is case-insensitive substring match over `name` and `id`. The windowing,
selection clamp, and delete-marks all operate on the **filtered** list. Marks are keyed by
session id so they survive filter changes.

### Confirm (delete) stage

Mirrors today's `DeleteModal` confirm: warning + list of marked sessions; `y`/`enter`
confirms `onDelete(markedIds)`, `n`/`esc` returns to navigate mode.

### Footer

- Navigate: `1/77 · enter view · r resume · o overview · e export · space mark · d delete · / filter · esc`
- Filter:   `Filter: 0614▌ · 2/77 shown · enter apply · esc clear`

Layout/row format is unchanged from the current `DeleteModal` (fixed-height window, edge
arrows `↑`/`↓`, position counter), so it stays flicker-free.

## Architecture

### New component: `src/cli/tui/modals/SessionsModal.tsx`

Adapts `DeleteModal.tsx`'s windowing (fixed-height list container, `startIndex`/`endIndex`
window centred on selection, edge arrows, spacer rows). Adds filter state and the
navigate/filter mode switch.

```ts
interface SessionsModalProps {
  sessions: CoScientistSession[];
  activeSessionId: string | null;            // annotate current session
  onView: (sessionId: string) => void;       // enter
  onResume: (sessionId: string) => void;     // r
  onOverview: (sessionId: string) => void;   // o
  onExport: (sessionId: string) => void;     // e
  onDelete: (sessionIds: string[]) => void;  // space + d + confirm
  onCancel: () => void;
}
```

Internal state: `mode: "navigate" | "filter"`, `stage: "browse" | "confirm"`,
`filter: string`, `selected: number`, `checked: Set<string>`. The filtered list is derived
(`useMemo`) from `sessions` + `filter`.

## Data flow / wiring

### Command handlers

- `commands/sessions.ts` — drop the line-builder; return `{ type: "modal", modal: "sessions" }`.
- `commands/deleteCmd.ts` — return `{ type: "modal", modal: "sessions" }` so `/delete` opens
  the same picker.

### `CommandRouter.ts`

- `ModalName`: add `"sessions"`, drop `"delete"` (no longer emitted).

### `App.tsx`

Replace the `activeModal === "delete"` block with `activeModal === "sessions"` rendering
`<SessionsModal>` with these handlers (each closes the picker after acting):

- `onView(id)` → `pushEntry(formatSessionResults(memory, id))`. (See formatters.)
- `onOverview(id)` → `pushEntry(formatOverview(memory, id))` (existing formatter; already
  handles still-running / no-overview cases).
- `onExport(id)` → `setModalData({ sessionId: id }); setActiveModal("export")`. The existing
  export handler changes from `exportCommand(sessionId!, …)` to
  `exportCommand((modalData as {sessionId?: string})?.sessionId ?? sessionId!, …)`.
- `onResume(id)` → `appContext.resumeSession(id)` (see Resume), then close.
- `onDelete(ids)` → existing delete loop + "Deleted N session(s)" confirmation block.
- `onCancel` → close.

### Resume into the live TUI

The TUI holds a single live supervisor. Resume reuses the CLI `resumeCommand` mechanics
(see `src/cli/commands/list.ts`): resolve session → guard → `updateSessionStatus("running")`
→ init MCP → `new SupervisorAgent()` + `setEmitter` + `supervisor.run(existingId)` in the
background.

**New `renderTUI` prop `onResumeSession(sessionId)`** in `src/cli/index.ts`, parallel to
`onStartSession`. It:
- looks up the session, sets `currentSupervisor`/`currentSessionId`,
- initialises the MCP manager (best-effort, like the CLI path),
- `memory.updateSessionStatus(id, "running")`,
- `supervisor.run(id)` in the background,
- returns `{ sessionId, goal, supervisor, emitter }` (goal text read from the stored
  session so `LiveStatus` shows it).

**New `AppContext.resumeSession(id)`** in `App.tsx`, parallel to `startSession`: calls
`externalOnResumeSession(id)`, then sets `sessionId/goal/supervisor/emitter/startTime`,
`paused=false`, `completed=false`, and pushes a "Resuming session …" block.

**Guards (checked in the `onResume` handler / `resumeSession`):**
- Highlighted session `completed` → toast "Session completed — press enter to view results."
- A live session already running in this TUI (`supervisor && !paused && !completed`) →
  toast "Stop the current session first (/stop)."
- Highlighted session is already the active one → toast "Already on this session."
- Otherwise resume.

### `commands/switch.ts`

- "Session found" success path changes from `{ type: "immediate" }` to
  `{ type: "transcript", entries: [block] }` so details persist. (Could instead resume
  directly, but keep `/switch` as an informational pointer; resume lives in the picker.)
- `Already on this session` / no-match stay as toast.

### `formatters.ts`

- Add `formatSessionResults(memory, id)`: wraps `formatResults`, prepends two header lines
  (`Results · <name>` and `<full id> · <status> · <YYYY-MM-DD> · <N hypotheses>`) and a
  divider, and sets the block title to the session name. `formatResults` stays unchanged.

### Removal

- Delete `src/cli/tui/modals/DeleteModal.tsx` and its `App.tsx` import (no other callers).

## Error / edge handling

- **Empty list:** "No sessions yet" + `[esc] close`.
- **Filter matches nothing:** "No sessions match 'xyz'" inside the list area; `esc` clears.
- **Session with no hypotheses:** `formatResults` returns "(no hypotheses yet)"; header still
  shows metadata.
- **Overview unavailable:** `formatOverview` already returns a "still running" message.
- **Resume of completed/running/active session:** guarded with toasts (see Resume).
- **Long lists:** windowed fixed height — never grows unbounded, never flickers.

## Testing

`src/tests/tui/sessionsModal.test.tsx` (headless `tui-render` harness):

- Windows a long list (not all rows rendered; edge arrows present).
- `enter` → `onView` with highlighted id.
- `space` + `d` + `y` → `onDelete` with exactly the marked ids; marks survive a filter change.
- `r` → `onResume` with highlighted id; `o` → `onOverview`; `e` → `onExport`.
- `/` enters filter mode; typing narrows the list; `esc` clears and restores full list;
  `enter` applies and keeps the filter while letter keys act again.
- Empty-state and no-match renders show their messages.

Plus a `formatters` unit test for `formatSessionResults` header lines.

## Files touched

- **New:** `src/cli/tui/modals/SessionsModal.tsx`
- **New:** `src/tests/tui/sessionsModal.test.tsx`
- **Edit:** `src/cli/tui/commands/sessions.ts` (thin modal trigger)
- **Edit:** `src/cli/tui/commands/deleteCmd.ts` (open `sessions` modal)
- **Edit:** `src/cli/tui/commands/switch.ts` (persistent block on match)
- **Edit:** `src/cli/tui/CommandRouter.ts` (`ModalName`: add `sessions`, drop `delete`)
- **Edit:** `src/cli/tui/App.tsx` (render `SessionsModal`; view/resume/overview/export/delete
  handlers; `resumeSession` context method; export handler targets `modalData.sessionId`)
- **Edit:** `src/cli/tui/formatters.ts` (`formatSessionResults`)
- **Edit:** `src/cli/index.ts` (`onResumeSession` renderTUI prop + wiring)
- **Edit:** `src/cli/tui/index.tsx` (thread `onResumeSession` prop through to `App`)
- **Remove:** `src/cli/tui/modals/DeleteModal.tsx`
