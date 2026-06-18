# TUI Redesign: Claude Code-Style Interactive Terminal

**Date:** 2026-06-18
**Status:** Design approved
**Approach:** A — Command Palette + Live Dashboard Hybrid

## Goal

Transform the existing Ink-based TUI from a passive live-dashboard into a unified text-driven interface supporting the full session lifecycle: start sessions naturally, control them live, and explore results — all from one persistent UI with a Claude Code-style text input bar and slash commands.

## Non-Goals

- Not a conversational AI assistant — the multi-agent pipeline remains the engine
- Not replacing the standalone CLI — `co-scientist run`, `co-scientist results`, etc. continue to work
- Not touching the data layer (ContextStore, DB, agents) — view layer + command router only

## Architecture

```
┌─────────────────────────────────────────┐
│              View Layer                  │
│  Ink React components (App, Dashboard,  │
│  InputBar, CommandPalette, Modals)       │
├─────────────────────────────────────────┤
│            Command Router                │
│  Parses text input → dispatches to       │
│  command handlers or starts session      │
├─────────────────────────────────────────┤
│           Data / Agent Layer             │
│  ContextStore + SupervisorAgent          │
│  (reused as-is, no changes needed)       │
└─────────────────────────────────────────┘
```

Three layers. Only the top two change. The data layer (ContextStore, agents, DB) is untouched. Existing CLI commands remain as standalone entry points — the TUI is an alternative interface, not a replacement.

## Screen Layout

```
┌─ Header ─────────────────────────────────────────┐
│ 🧬 co-scientist · Session: cancer-biomarker · 12m │
│ ████████░░░░ 62% token budget · ⏸ Paused          │
├─ Main View ──────────────────────────────────────┤
│                                                    │
│  [Leaderboard / Results / Graph / Overview]         │
│  (switches based on active command context)         │
│                                                    │
│  ┌─ Toast (transient) ──────────────────────────┐ │
│  │ ✓ Session paused                              │ │
│  └──────────────────────────────────────────────┘ │ │
│                                                    │
├─ Input Bar ──────────────────────────────────────┤ │
│ > cancer immunotherapy biomarker discov█           │
│                                                    │
│  [autocomplete palette appears here when / typed]  │
│  /run  /pause  /results  /export  /feedback ...    │
└────────────────────────────────────────────────────┘
```

## Component Tree

```
<App>
  <Header />           — session name, elapsed time, token gauge, pause indicator
  <MainView>           — context-switchable content area
    <Dashboard />      — live leaderboard + ticker (when session running)
    <Results />        — ranked hypotheses table (after /results)
    <Graph />          — knowledge graph visualization (after /graph)
    <Overview />       — final research overview (after /overview)
    <EmptyState />     — welcome message + hint to type a topic (when no session)
  </MainView>
  <Toast />            — transient 3s confirmation messages
  <InputBar>           — text input + autocomplete
    <TextInput />      — the actual editable text field
    <CommandPalette /> — dropdown list of matching slash commands
  </InputBar>
  <Modal />            — overlay for complex workflows (feedback, inject, export, etc.)
</App>
```

## Navigation Rules

- Typing a topic (no `/`) and pressing Enter → if no session running, starts a session with that text as goal, MainView switches to Dashboard. If session IS running, shows a warning toast.
- `/` opens the CommandPalette; as you type, it filters matching commands grouped by category
- Selecting a command either acts immediately, switches MainView, or opens a Modal
- `Esc` clears input, closes palette, dismisses toasts
- Tab completes the highlighted autocomplete suggestion

## Input Routing Logic

```
User presses Enter
        │
        ▼
  ┌─ Text starts with "/"? ──┐
  │ Yes                      │ No
  ▼                          ▼
Parse command + args    ┌─ Session running? ──┐
  │                     │ Yes                 │ No
  ▼                     ▼                     ▼
Look up in           Show warning toast    Treat as research
COMMAND_REGISTRY     "Session already      goal → start a
  │                  running. /stop        new session via
  ├─ Found → execute    first?"           SupervisorAgent
  ├─ Not found →
  │  show "Unknown
  │  command" toast
  ▼
Execute handler:
  ├─ Immediate: /pause, /resume, /stop, /boost, /kill, /budget
  │   → call ContextStore/Agent method, show confirmation toast
  ├─ View switch: /results, /graph, /overview, /thinking, /activity
  │   → change MainView active component
  ├─ Modal: /feedback, /inject, /export, /design, /delete
  │   → open Modal overlay, collect input, execute on confirm
  └─ App exit: /quit → graceful shutdown, process.exit
```

## Command Registry

A `Map<string, CommandHandler>` where each handler is:

```typescript
type CommandHandler = {
  execute: (args: string[], context: AppContext) => Promise<ActionResult>;
  autocomplete?: (partial: string, context: AppContext) => Suggestion[];
  activeWhen?: (context: AppContext) => boolean;  // gray out when inactive
};
```

`AppContext` provides: `memory` (ContextStore), `sessionId` (string | null), `supervisor` (SupervisorAgent | null), `emitter` (EventEmitter), `setMainView` (setter), `openModal` (setter), `showToast` (setter).

## Slash Commands

### Session Lifecycle
| Command | Action | Active When |
|---------|--------|-------------|
| `/run [goal]` | Start a new research session (with goal text) or open RunModal (no args) | No session running |
| `/pause` | Pause running session | Session running |
| `/resume` | Resume paused session | Session paused |
| `/stop` | Gracefully stop current session | Session running |
| `/dashboard` | Return to live dashboard view | Session exists |

### Live Control (during session)
| Command | Action | Active When |
|---------|--------|-------------|
| `/boost <id>` | Manually boost hypothesis Elo rating | Session running |
| `/kill <id>` | Reject/quarantine a hypothesis | Session running |
| `/inject` | Open modal to inject custom hypothesis | Session running |
| `/budget <tokens>` | Change remaining token budget | Session running |
| `/strategy` | View/edit task sampling weights | Session running |

### Results & Exploration
| Command | Action | Active When |
|---------|--------|-------------|
| `/results` | Switch to ranked hypotheses table | Session exists |
| `/compare <id1> <id2>` | Head-to-head hypothesis diff | Session exists |
| `/diff <id>` | Hypothesis lineage view | Session exists |
| `/graph` | Knowledge graph visualization | Session exists |
| `/overview` | Final research summary | Session completed |
| `/thinking` | Chain-of-thought traces | Session exists |
| `/activity` | Session activity log | Session exists |

### Actions
| Command | Action | Active When |
|---------|--------|-------------|
| `/export <fmt>` | Export results (md, json) | Session exists |
| `/design <id>` | Generate experimental protocol | Session exists |
| `/feedback <id>` | Submit experimental feedback | Session exists |
| `/delete` | Delete current/all sessions | Always |

### Navigation & System
| Command | Action | Active When |
|---------|--------|-------------|
| `/sessions` | List all saved sessions | Always |
| `/switch <id>` | Switch to a different session | Always |
| `/login` / `/logout` | OAuth for search providers | Always |
| `/help` | Show command reference | Always |
| `/quit` | Exit co-scientist | Always |

### Removed from old CLI

- `list` → folded into `/sessions`
- `safety` → folded into dashboard views
- `resume` (CLI) → `/switch <id>`
- `compare`/`diff` with no args → opens a picker modal to select hypotheses

### New commands

`/pause`, `/resume`, `/stop`, `/dashboard`, `/budget`, `/strategy`, `/switch`, `/help`, `/quit`

## Modal Workflows

Commands that need multi-step input open a modal overlay (extending the existing pattern in `src/cli/tui/modals/`).

| Command | Modal | Steps |
|---------|-------|-------|
| `/run [goal]` | `RunModal` (if no goal) or direct start (if goal provided) | Enter goal → optional name, budget, max-hypotheses → Confirm |
| `/feedback <id>` | `FeedbackModal` | Select type → Enter text → N/C/T scores → Confirm |
| `/inject` | `InjectModal` | Reuse existing modal as-is |
| `/export` | `ExportModal` | Select format (md/json) → Optional path → Confirm |
| `/design <id>` | `DesignModal` | Show hypothesis → Select detail level → Confirm → Stream result |
| `/delete` | `DeleteModal` | Select session(s) → Confirm with warning |
| `/budget` | `BudgetModal` | Show current budget → Enter new token count → Confirm |
| `/strategy` | `StrategyModal` | Show current task weights as form → Edit values → Confirm |

**Modal behavior:**
- Overlays center of screen with border
- Tab/Shift+Tab between fields
- Enter to confirm, Esc to cancel
- Reuses existing modal patterns from `KillModal`, `BoostModal`, `InjectModal`

## Autocomplete Behavior

- `/` with nothing else → show all commands grouped by category (Lifecycle, Control, Results, Actions, System)
- `/r` → filter to `/run`, `/results`, `/resume`, with best match highlighted
- Tab → complete to highlighted suggestion
- Commands inactive in current context render dimmed/grayed (e.g., `/boost` grayed when no session running)
- Trailing space after known command → show argument hints (e.g., `/export ` → hint `[md | json]`)

## Files to Create / Modify

### New files
| File | Purpose |
|------|---------|
| `src/cli/tui/App.tsx` | Rewrite root component with new layout |
| `src/cli/tui/InputBar.tsx` | Text input + CommandPalette container |
| `src/cli/tui/TextInput.tsx` | Editable text field component (Ink text input) |
| `src/cli/tui/CommandPalette.tsx` | Autocomplete dropdown |
| `src/cli/tui/CommandRouter.ts` | Parse + dispatch logic, COMMAND_REGISTRY |
| `src/cli/tui/commands/*.ts` | One file per command handler |
| `src/cli/tui/MainView.tsx` | View switcher component |
| `src/cli/tui/views/Dashboard.tsx` | Refactored from current App.tsx dashboard |
| `src/cli/tui/views/EmptyState.tsx` | Welcome screen |
| `src/cli/tui/views/Results.tsx` | Ranked hypotheses table |
| `src/cli/tui/views/Graph.tsx` | Knowledge graph viewer |
| `src/cli/tui/views/Overview.tsx` | Research overview viewer |
| `src/cli/tui/views/Thinking.tsx` | Chain-of-thought traces viewer |
| `src/cli/tui/views/Activity.tsx` | Activity log viewer |
| `src/cli/tui/Toast.tsx` | Transient confirmation messages |
| `src/cli/tui/modals/RunModal.tsx` | Session start modal |
| `src/cli/tui/modals/FeedbackModal.tsx` | Feedback submission modal |
| `src/cli/tui/modals/ExportModal.tsx` | Export format/path modal |
| `src/cli/tui/modals/DesignModal.tsx` | Protocol generation modal |
| `src/cli/tui/modals/DeleteModal.tsx` | Session deletion modal |
| `src/cli/tui/modals/BudgetModal.tsx` | Budget adjustment modal |
| `src/cli/tui/modals/StrategyModal.tsx` | Task weight editing modal |

### Modified files
| File | Change |
|------|--------|
| `src/cli/tui/index.tsx` | Export updated `renderTUI()` with new App |
| `src/cli/tui/Header.tsx` | Add pause indicator, minor layout changes |
| `src/cli/tui/useSessionData.ts` | Add new fields needed by views (thinking traces, activity) |
| `src/cli/tui/modals/KillModal.tsx` | Ensure compatible with new modal system |
| `src/cli/tui/modals/BoostModal.tsx` | Ensure compatible with new modal system |
| `src/cli/tui/modals/InjectModal.tsx` | Ensure compatible with new modal system |

### Unchanged files
| File | Why |
|------|-----|
| `src/cli/commands/*.ts` | Standalone CLI path preserved |
| `src/cli/index.ts` | CLI entry still works, `--no-tui` flag preserved |
| `src/agents/*.ts` | No changes needed |
| `src/memory/*.ts` | No changes needed |
| `src/db/*.ts` | No changes needed |
| `src/models/*.ts` | No changes needed |
| `src/cli/tui/Spinner.tsx` | Reused |
| `src/cli/tui/Ticker.tsx` | Reused |
| `src/cli/tui/actions.ts` | Reused (boost, kill, inject) |

## Implementation Order

1. **Command Router + TextInput + CommandPalette** — the core new infrastructure
2. **App shell rewrite** — new layout with MainView switcher, Header, Toast
3. **EmptyState + RunModal** — ability to start sessions from the TUI
4. **Dashboard view** — refactor existing dashboard into a MainView slot
5. **Session control commands** — `/pause`, `/resume`, `/stop`, `/boost`, `/kill`, `/inject`, `/budget`, `/strategy`
6. **Results & Exploration views** — `/results`, `/graph`, `/overview`, `/thinking`, `/activity`
7. **Action commands + modals** — `/export`, `/feedback`, `/design`, `/delete`
8. **Navigation & System commands** — `/sessions`, `/switch`, `/login`, `/logout`, `/help`, `/quit`
9. **Polish** — toast animations, autocomplete refinement, edge cases

## Risk / Unknowns

- **Ink text input**: Ink v5 does not have a built-in `<TextInput>`. We'll need to use `useInput` or `useStdin` to capture raw keystrokes and manage cursor/selection manually. This is the highest-risk component.
- **Focus management**: Only one component can consume keyboard input in Ink. With the text input bar always visible, we need a focus system — when input bar is focused, arrow keys go to text editing; when unfocused, they navigate the dashboard. The `Esc` key toggles focus.
- **Scrolling in Ink**: The Results, Thinking, and Activity views may have more content than fits on screen. Ink v5 has limited built-in scrolling. We may need a simple scroll offset with PgUp/PgDn or j/k navigation.
