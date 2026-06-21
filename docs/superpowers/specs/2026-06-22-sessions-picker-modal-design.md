# Sessions Picker Modal — Design

**Date:** 2026-06-22
**Status:** Approved (pending spec review)
**Area:** `src/cli/tui`

## Problem

The `/sessions` command dumps a multi-line block into the transcript — three lines per
session (name, metadata, blank) — which grows long and unwieldy. The user wants a compact,
navigable picker in the same UX family as the existing `/delete` modal, from which they can:

1. **View a past session's results** (read-only), and
2. **Delete sessions**,

all from one list. Separately, some content-bearing command output is shown as a
**transient toast that auto-dismisses**, when it should be **permanently visible** in the
scrollback.

## Goals

- Replace the long `/sessions` transcript dump with a compact, flicker-free, windowed modal.
- Single unified picker reachable from both `/sessions` and `/delete`.
- `enter` on a highlighted session shows that session's ranked results as a **permanent**
  transcript block (read-only), including the full session ID.
- `space` marks sessions for deletion; `d` confirms and deletes the marked set.
- Make the **sessions/switch flow** output permanent: `/switch <id>` "session found" details
  become a permanent transcript block instead of a transient toast.

## Non-goals

- Truly switching the live/active session inside the TUI (still done via
  `co-scientist resume <id>` from the CLI). `/switch` remains a pointer to that.
- A broad audit of every command's toast vs. block behaviour — out of scope. Only the
  sessions/switch flow changes. Quick acknowledgements (`Session paused`, `Already on this
  session`) stay as toasts.

## Architecture

### New component: `src/cli/tui/modals/SessionsModal.tsx`

Adapts the proven windowing logic from `DeleteModal.tsx` (fixed-height list container,
`startIndex`/`endIndex` window centred on the selection, edge arrows, spacer rows) so it
remains flicker-free via Ink in-place updates.

Two stages:

- `"browse"` — navigate, view, or mark for deletion.
- `"confirm"` — delete confirmation (warning + list of marked sessions).

Props:

```ts
interface SessionsModalProps {
  sessions: CoScientistSession[];
  activeSessionId: string | null;        // highlight/annotate the current session
  onView: (sessionId: string) => void;   // enter → show results, closes modal
  onDelete: (sessionIds: string[]) => void; // d → confirm → delete
  onCancel: () => void;
}
```

### Keybindings

**Browse stage:**

| Key      | Action                                                            |
|----------|-------------------------------------------------------------------|
| `↑` / `↓`| Move selection                                                    |
| `enter`  | View highlighted session's results → `onView(id)`, close modal    |
| `space`  | Toggle delete-mark on highlighted session (`[ ]` ⇄ `[*]`)         |
| `d`      | If ≥1 marked → go to `confirm` stage                              |
| `esc`    | Close → `onCancel()`                                              |

**Confirm stage** (mirrors `DeleteModal`'s confirm):

| Key            | Action                                  |
|----------------|-----------------------------------------|
| `y` / `enter`  | `onDelete(markedIds)`                    |
| `n` / `esc`    | Back to `browse` stage                  |

### Layout (browse stage)

```
╭─ SESSIONS ────────────────────────────────────────────╮
│ [enter] view · [space] mark · [d] delete · [esc] close │
│                                                        │
│ ❯ [ ] ✓ Histopathology fairness review (a1b2c3d4) 12h  │
│   [ ] ▶ Scanner bias study (e5f6a7b8) 4h               │
│   [*] ⏸ Old draft (99aa00bb) 2h                        │
│                                                        │
│ ▲▼ 1/3 · 1 marked · [d] delete marked                  │
╰────────────────────────────────────────────────────────╯
```

The active session is annotated (e.g. a `•` or `(current)` marker) using `activeSessionId`.

## Data flow / wiring

### Command handlers

- **`src/cli/tui/commands/sessions.ts`** — drop the line-builder; return
  `{ type: "modal", modal: "sessions" }` (becomes a thin trigger like `deleteCmd.ts`).
- **`src/cli/tui/commands/deleteCmd.ts`** — return `{ type: "modal", modal: "sessions" }`
  so `/delete` opens the same unified picker. `/delete` keeps working.

### `CommandRouter.ts`

- Add `"sessions"` to the `ModalName` union. Keep or drop `"delete"` from the union — it is
  no longer emitted, so remove it to avoid dead states.

### `App.tsx`

- Replace the `activeModal === "delete"` render block with `activeModal === "sessions"`
  rendering `<SessionsModal>`:
  - `onView(id)`: push **one** permanent block built by extending `formatResults(memory, id)`
    — prepend two metadata header lines to its `lines`, and set the block title to the
    session name:
    ```
    Results · <session name>
    <full session id> · <status> · <YYYY-MM-DD> · <N hypotheses>
    ─────────────────────────────────────────────────────────────
    <existing formatResults rows…>
    ```
    Then `setActiveModal(null)`. Implemented via a small `formatSessionResults(memory, id)`
    helper in `formatters.ts` that wraps `formatResults` and prepends the header lines, so the
    header/metadata logic is unit-testable and `formatResults` stays unchanged.
  - `onDelete(ids)`: reuse the existing delete loop + "Deleted N session(s)" confirmation
    block (unchanged).
  - `onCancel`: `setActiveModal(null)`.
- `allSessions` is already passed to the current delete modal, so the data is available.

### `src/cli/tui/commands/switch.ts`

- Change the "session found" success path from `{ type: "immediate", message }` to
  `{ type: "transcript", entries: [block] }` so the details (id, name, resume hint) persist
  in scrollback.
- Keep `Already on this session` and "no match" as toast (`immediate` / `error`).

### Removal

- Delete `src/cli/tui/modals/DeleteModal.tsx` and its import in `App.tsx` once
  `SessionsModal` is wired in (no other callers).

## Error / edge handling

- **Empty list:** modal shows "No sessions yet" with `[esc] close`.
- **Session with no hypotheses:** `formatResults` already returns a "(no hypotheses yet)"
  block — header still shows the session metadata.
- **Marking the active/running session for deletion:** allowed (matches current
  `DeleteModal` behaviour); deletion uses existing `memory.deleteSession`.
- **Long lists:** windowed to a fixed visible height (reused from `DeleteModal`), so the
  modal never grows unbounded and never flickers.

## Testing

Add `src/tests/tui/sessionsModal.test.tsx` using the existing headless `tui-render`
harness:

- Renders a windowed list when sessions exceed the visible height (asserts not all rows
  rendered; edge arrows present).
- `enter` on the highlighted row calls `onView` with that session's id.
- `space` then `d` then `y` calls `onDelete` with exactly the marked ids.
- `esc` from browse calls `onCancel`; `esc` from confirm returns to browse.
- Empty-sessions render shows the empty-state text.

## Files touched

- **New:** `src/cli/tui/modals/SessionsModal.tsx`
- **New:** `src/tests/tui/sessionsModal.test.tsx`
- **Edit:** `src/cli/tui/commands/sessions.ts` (thin modal trigger)
- **Edit:** `src/cli/tui/commands/deleteCmd.ts` (open `sessions` modal)
- **Edit:** `src/cli/tui/commands/switch.ts` (persistent block on match)
- **Edit:** `src/cli/tui/CommandRouter.ts` (`ModalName`: add `sessions`, drop `delete`)
- **Edit:** `src/cli/tui/App.tsx` (render `SessionsModal`, view/delete handlers)
- **Edit:** `src/cli/tui/formatters.ts` (`formatSessionResults` helper)
- **Remove:** `src/cli/tui/modals/DeleteModal.tsx`
