# TUI Redesign — Claude Code-Style Interactive Terminal: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Ink-based TUI from a passive live-dashboard into a unified text-driven interface with a Claude Code-style text input bar, slash-command system, and full session-lifecycle control — all layered on top of the existing multi-agent pipeline without touching the data layer.

**Architecture:** Three layers. View (Ink React components — rebuilt), Command Router (parse + dispatch — new), Data/Agent (ContextStore + SupervisorAgent — untouched). The TUI becomes the primary interactive interface; all 18 CLI commands continue to work standalone via `--no-tui`.

**Tech Stack:** Ink v5.0.1, React v18.3.1, TypeScript, bun:test

## Global Constraints

- Ink v5 has no built-in `<TextInput>` — all text editing is built from `useInput` raw keystrokes (following existing `InjectModal` pattern)
- Only one `useInput({isActive: true})` can consume keyboard input at a time → explicit focus management required
- Data layer (ContextStore, agents, DB, models) must not be modified
- Existing CLI commands in `src/cli/commands/` must not be modified
- `--no-tui` fallback path in `run.ts` must be preserved
- `bun test` must pass after every task
- Commit after every task with descriptive message
- Keep the docs file local — do not push to GitHub

---

## File Map

**New files (28):**
`src/cli/tui/CommandRouter.ts`, `src/cli/tui/CommandPalette.tsx`, `src/cli/tui/InputBar.tsx`, `src/cli/tui/Toast.tsx`, `src/cli/tui/MainView.tsx`, `src/cli/tui/commands/{run,pause,resume,stop,dashboard,boost,kill,inject,budget,strategy,results,compare,diff,graph,overview,thinking,activity,exportCmd,feedbackCmd,designCmd,deleteCmd,sessions,switch,login,logout,help,quit}.ts`, `src/cli/tui/views/{EmptyState,Dashboard,Results,Graph,Overview,Thinking,Activity}.tsx`, `src/cli/tui/modals/{RunModal,FeedbackModal,ExportModal,DesignModal,DeleteModal,BudgetModal,StrategyModal}.tsx`

**Modified files (4):**
`src/cli/tui/App.tsx` (rewrite), `src/cli/tui/index.tsx` (update renderTUI signature), `src/cli/tui/Header.tsx` (add sessionState variants), `src/cli/tui/useSessionData.ts` (add thinking/activity fetch methods)

**Removed files (1):**
`src/cli/tui/Footer.tsx` (replaced by InputBar)

**Unchanged (all other files):**
`src/cli/commands/*.ts`, `src/cli/index.ts`, `src/agents/*.ts`, `src/memory/*.ts`, `src/db/*.ts`, `src/cli/tui/{Spinner,Ticker,Leaderboard,actions}.tsx`, `src/cli/tui/modals/{Kill,Boost,Inject}Modal.tsx`

---

### Task 1: Command Router — Types, Registry, and Routing Logic

**Files:** Create `src/cli/tui/CommandRouter.ts`

**Interfaces produced:**
- `AppContext` — the shared context object passed to every command handler
- `MainViewName = "dashboard" | "results" | "graph" | "overview" | "thinking" | "activity" | "empty"`
- `ModalName = "run" | "feedback" | "inject" | "export" | "design" | "delete" | "budget" | "strategy" | null`
- `CommandHandler = { name, description, category, execute(args, ctx): Promise<RouteResult>, autocomplete?(partial, ctx): CommandSuggestion[], activeWhen?(ctx): boolean }`
- `RouteResult = { type: "immediate" | "view_switch" | "modal" | "session_start" | "error" | "exit", message?: string }`
- `CommandSuggestion = { name, description, category, active }`
- `CommandRouter` class with `route(input, ctx)` and `getSuggestions(partial, ctx)`
- `registerCommand(handler)` function, `getAllCommands()` function

**Key design decisions:**
- `COMMAND_REGISTRY` is a module-level `Map<string, CommandHandler>`. Each command file calls `registerCommand()` at import time.
- The router distinguishes free text (`"session_start"`) from slash commands (lookup in registry).
- `activeWhen` checks gate commands on session state (e.g., `/pause` only active when session is running and not already paused).

- [ ] **Step 1: Implement CommandRouter.ts** — all types, the registry, the `CommandRouter` class, and the `route()` method. ~120 lines.

```typescript
// src/cli/tui/CommandRouter.ts
import type { EventEmitter } from "events";
import type { ContextStore } from "../../memory/contextStore.js";
import type { SupervisorAgent } from "../../agents/supervisor.js";

export type MainViewName = "dashboard" | "results" | "graph" | "overview" | "thinking" | "activity" | "empty";
export type ModalName = "run" | "feedback" | "inject" | "export" | "design" | "delete" | "budget" | "strategy" | null;

export interface AppContext {
  memory: ContextStore;
  sessionId: string | null;
  goal: string | null;
  supervisor: SupervisorAgent | null;
  emitter: EventEmitter | null;
  setMainView: (view: MainViewName) => void;
  openModal: (modal: ModalName, data?: unknown) => void;
  closeModal: () => void;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
  startSession: (goal: string, opts?: { name?: string; budget?: number; maxHypotheses?: number }) => Promise<void>;
  stopSession: () => void;
  togglePause: () => boolean;
  paused: boolean;
}

export interface CommandSuggestion { name: string; description: string; category: string; active: boolean; }

export type RouteResult =
  | { type: "immediate"; message?: string }
  | { type: "view_switch"; view: MainViewName; message?: string }
  | { type: "modal"; modal: ModalName; message?: string }
  | { type: "session_start"; goal: string }
  | { type: "error"; message: string }
  | { type: "exit" };

export interface CommandHandler {
  readonly name: string;
  readonly description: string;
  readonly category: "Lifecycle" | "Control" | "Results" | "Actions" | "System";
  execute(args: string[], ctx: AppContext): Promise<RouteResult>;
  autocomplete?(partial: string, ctx: AppContext): CommandSuggestion[];
  activeWhen?(ctx: AppContext): boolean;
}

const registry = new Map<string, CommandHandler>();

export function registerCommand(h: CommandHandler): void { registry.set(h.name, h); }
export function getCommand(name: string): CommandHandler | undefined { return registry.get(name); }
export function getAllCommands(): CommandHandler[] { return [...registry.values()]; }

export function route(input: string, ctx: AppContext): RouteResult | { type: "session_start"; goal: string } {
  const trimmed = input.trim();
  if (!trimmed) return { type: "error", message: "" };
  
  if (!trimmed.startsWith("/")) {
    if (ctx.sessionId && ctx.supervisor && !ctx.paused) {
      return { type: "error", message: "Session already running. Use /stop first, or /pause to pause." };
    }
    return { type: "session_start", goal: trimmed };
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const name = parts[0];
  const args = parts.slice(1);
  const handler = registry.get(name);
  
  if (!handler) return { type: "error", message: `Unknown command: /${name}. Type /help for available commands.` };
  if (handler.activeWhen && !handler.activeWhen(ctx)) {
    return { type: "error", message: `/${name} is not available right now.` };
  }
  return handler.execute(args, ctx);
}

export function getSuggestions(partial: string, ctx: AppContext): CommandSuggestion[] {
  if (!partial.startsWith("/")) return [];
  const query = partial.slice(1).toLowerCase();
  const all = getAllCommands();
  const matching = query ? all.filter(c => c.name.startsWith(query) || c.name.includes(query)) : all;
  return matching.map(c => ({
    name: `/${c.name}`,
    description: c.description,
    category: c.category,
    active: c.activeWhen ? c.activeWhen(ctx) : true,
  }));
}
```

- [ ] **Step 2: Run tests and commit**

```bash
bun test && git add src/cli/tui/CommandRouter.ts && git commit -m "feat(tui): add CommandRouter with types, registry, and routing logic"
```

---

### Task 2: InputBar, CommandPalette, Toast

**Files:**
- Create `src/cli/tui/Toast.tsx`
- Create `src/cli/tui/CommandPalette.tsx`
- Create `src/cli/tui/InputBar.tsx`

**Interfaces:**
- `<Toast message type visible onDismiss durationMs?>` — transient 3s notification
- `<CommandPalette suggestions selectedIndex visible>` — grouped autocomplete dropdown
- `<InputBar focus appContext onRoute>` — composes text editing + palette + toast

**Why one task:** These three components are tightly coupled — InputBar owns the toast state and palette state and text editing state, all within a single `useInput` handler. Separating them would require threading callbacks through multiple layers with no benefit.

- [ ] **Step 1: Write Toast.tsx** — `useEffect` with setTimeout to auto-dismiss after `durationMs`. Renders nothing when `!visible || !message`. Colors: green (success), red (error), cyan (info). ~35 lines.

- [ ] **Step 2: Write CommandPalette.tsx** — receives `CommandSuggestion[]`, groups by `category` with colored headers, highlights `selectedIndex` with cyan background. Renders nothing when `!visible || suggestions.length === 0`. ~50 lines.

- [ ] **Step 3: Write InputBar.tsx** — the core component. Single `useInput({isActive: focus})` handler that implements:
  - **Text editing**: append printable chars at cursor, backspace, left/right/home/end cursor movement
  - **Tab**: auto-complete the highlighted palette suggestion
  - **Up/Down arrows**: when palette is open, navigate suggestions; otherwise pass through
  - **Enter**: submit — either the selected palette suggestion (if palette open) or the raw text
  - **Slash detection**: when input starts with `/`, compute suggestions via `getSuggestions()` and show palette
  - **Toast management**: local state for toast message, type, visibility; exposed via `appContext.showToast` override
  
  Renders: Toast row (if visible), text input row (`> ` prefix + cursor-highlighted text), CommandPalette row. ~100 lines.

- [ ] **Step 4: Run tests and commit**

```bash
bun test && git add src/cli/tui/Toast.tsx src/cli/tui/CommandPalette.tsx src/cli/tui/InputBar.tsx && git commit -m "feat(tui): add InputBar with text editing, command palette, and toast"
```

---

### Task 3: MainView, EmptyState, Dashboard Stub

**Files:**
- Create `src/cli/tui/MainView.tsx`
- Create `src/cli/tui/views/EmptyState.tsx`
- Create `src/cli/tui/views/Dashboard.tsx` (stub — full implementation in Task 6)

**Interfaces:**
- `<MainView activeView appContext>` — renders the current view component
- `<EmptyState />` — welcome screen with hints
- `<Dashboard appContext />` — stub showing session ID

- [ ] **Step 1: Write EmptyState.tsx** — centered welcome message: "🧬 co-scientist", "Multi-Agent Research Hypothesis Generation", hint to type a topic, hint about /sessions, /login, /help, /quit. ~40 lines.

- [ ] **Step 2: Write Dashboard.tsx stub** — placeholder that shows "Dashboard — coming in Task 6" and the current session ID. ~15 lines.

- [ ] **Step 3: Write MainView.tsx** — `switch (activeView)` rendering the correct view component. Stub text for results/graph/overview/thinking/activity (filled in Tasks 9-10). ~30 lines.

- [ ] **Step 4: Run tests and commit**

```bash
bun test && git add src/cli/tui/MainView.tsx src/cli/tui/views/ && git commit -m "feat(tui): add MainView switcher, EmptyState welcome screen, and Dashboard stub"
```

---

### Task 4: App Shell Rewrite + renderTUI Update

**Files:**
- Rewrite `src/cli/tui/App.tsx`
- Modify `src/cli/tui/index.tsx`
- Remove `src/cli/tui/Footer.tsx`

**Interfaces changed:**
- `RenderTUIOptions` now accepts `sessionId: string | null`, `goal: string | null`, `supervisor: SupervisorAgent | null`, `emitter: EventEmitter | null`, `startTime: number | null` — all nullable for the "no session yet" state
- New props: `onStartSession`, `onStop`
- `AppProps` matches — nullable session fields, plus `onStartSession` and `onStop` callbacks

**Purpose:** The new App manages focus (`"input" | "dashboard"`), routes commands from InputBar to handlers, switches MainView, and overlays modals. Esc toggles focus. `useSessionData` is called conditionally (passes null emitter/sessionId when no session — hook is a no-op).

- [ ] **Step 1: Rewrite App.tsx**

State: `focus`, `activeView`, `activeModal`. Build `appContext` object. Pass to `<Header>`, `<MainView>`, `<InputBar>`. Modal stub (single `useInput` for Esc dismissal). Esc handler: dismiss modal first, else toggle focus. Dashboard `useInput` placeholder consumes input when dashboard has focus. ~100 lines.

- [ ] **Step 2: Update index.tsx**

`renderTUI` now accepts nullable `sessionId`, `goal`, `supervisor`, `emitter`, `startTime` plus new `onStartSession` and `onStop` callbacks. Passes through to `<App>`. ~30 lines.

- [ ] **Step 3: Update run.ts call site** — make `renderTUI` call compatible with the new signature (session info still required at call time for `run.ts`, so pass as before; the nullable signature just enables empty-state start for future use). ~5 line change.

- [ ] **Step 4: Delete Footer.tsx** — no longer needed; keybinding hints are in the command palette.

- [ ] **Step 5: Run tests and commit**

```bash
bun test && git add src/cli/tui/App.tsx src/cli/tui/index.tsx src/cli/commands/run.ts && git rm src/cli/tui/Footer.tsx && git commit -m "feat(tui): rewrite App shell with focus management, nullable session, remove Footer"
```

---

### Task 5: RunModal + Session Creation Wiring

**Files:**
- Create `src/cli/tui/modals/RunModal.tsx`
- Create `src/cli/tui/commands/run.ts`

**Interfaces:**
- `<RunModal onConfirm onCancel>` — two-field form (goal text, optional name), Tab/Enter navigation, Esc cancel
- `runCommand` handler registered as `/run`

**Purpose:** Enables starting a new research session from within the TUI. The RunModal collects the goal and optional name. On confirm, it calls `ctx.startSession(goal, opts)` which triggers the App's `onStartSession` callback → creates supervisor + session and updates App state.

- [ ] **Step 1: Write RunModal.tsx** — follows existing `InjectModal` pattern. Two fields: `goal` (focused first) and `name` (optional). Tab switches fields. Enter on goal moves to name; Enter on name confirms if goal is non-empty. Shows hint text. ~60 lines.

- [ ] **Step 2: Write commands/run.ts** — registers `/run` with `category: "Lifecycle"`, `activeWhen: ctx => !ctx.sessionId`. Execute: if args provided, starts session with args[0] as goal. If no args, opens RunModal. ~30 lines.

- [ ] **Step 3: Wire RunModal into App.tsx** — add case for `"run"` modal in the ModalOverlay. The modal's `onConfirm` calls `appContext.startSession(goal, {name})` and `appContext.closeModal()`. ~10 lines.

- [ ] **Step 4: Run tests and commit**

```bash
bun test && git add src/cli/tui/modals/RunModal.tsx src/cli/tui/commands/run.ts src/cli/tui/App.tsx && git commit -m "feat(tui): add RunModal and /run command for starting sessions from TUI"
```

---

### Task 6: Dashboard View — Refactor Existing Live Dashboard

**Files:**
- Rewrite `src/cli/tui/views/Dashboard.tsx` (replace stub)
- Modify `src/cli/tui/App.tsx` (wire Dashboard with sessionData)

**Interfaces:**
- `<Dashboard appContext>` — renders Leaderboard + Ticker with keyboard navigation
- Consumes `useSessionData` from App (passed via appContext or props)

**Purpose:** Extract the existing dashboard logic (Leaderboard + Ticker + keyboard shortcuts) from the old `App.tsx` into the new `Dashboard.tsx`. The existing `useSessionData` hook is already called in App. Dashboard receives the data via appContext or a separate prop. Arrow key navigation, k/b/i shortcuts are preserved but re-mapped: `k` → calls `/kill`-equivalent logic, `b` → `/boost`, `i` → `/inject`. These shortcuts only work when dashboard has focus.

- [ ] **Step 1: Add sessionData to AppContext** — extend `AppContext` with `leaderboard`, `ticker`, `stats` fields (or pass sessionData as a separate prop to MainView/Dashboard). Keep it simple: pass sessionData as a prop to `<Dashboard>`.

- [ ] **Step 2: Write Dashboard.tsx** — copy Leaderboard + Ticker rendering from old App.tsx. Add `useInput({isActive: focus === "dashboard"})` for arrow-key selection, `k`/`b`/`i` shortcuts. When `k` is pressed, open KillModal via `appContext.openModal("kill")`. When `b` is pressed, open BoostModal. When `i` is pressed, open InjectModal. ~80 lines.

- [ ] **Step 3: Wire existing KillModal, BoostModal, InjectModal** — these already exist and work. Add modal cases in App's ModalOverlay for `"kill"`, `"boost"`, `"inject"`. Each renders the existing modal component with callbacks wired to `actions.ts` functions.

- [ ] **Step 4: Run tests and commit**

```bash
bun test && git add src/cli/tui/views/Dashboard.tsx src/cli/tui/App.tsx && git commit -m "feat(tui): refactor live dashboard into Dashboard view with keyboard shortcuts"
```

---

### Task 7: Session Lifecycle Commands

**Files:**
- Create `src/cli/tui/commands/pause.ts`
- Create `src/cli/tui/commands/resume.ts`
- Create `src/cli/tui/commands/stop.ts`
- Create `src/cli/tui/commands/dashboard.ts`

**Interfaces:** Each file registers one command handler. All are `category: "Lifecycle"`.

- [ ] **Step 1: Write pause.ts** — `activeWhen: ctx => ctx.sessionId !== null && ctx.supervisor !== null && !ctx.paused`. Execute: calls `ctx.togglePause()`, returns `{type: "immediate", message: "Session paused."}`. ~15 lines.

- [ ] **Step 2: Write resume.ts** — `activeWhen: ctx => ctx.sessionId !== null && ctx.supervisor !== null && ctx.paused`. Execute: calls `ctx.togglePause()`, returns `{type: "immediate", message: "Session resumed."}`. ~15 lines.

- [ ] **Step 3: Write stop.ts** — `activeWhen: ctx => ctx.sessionId !== null && ctx.supervisor !== null`. Execute: calls `ctx.stopSession()`, returns `{type: "view_switch", view: "results", message: "Session stopped."}`. ~15 lines.

- [ ] **Step 4: Write dashboard.ts** — `activeWhen: ctx => ctx.sessionId !== null`. Execute: returns `{type: "view_switch", view: "dashboard"}`. ~10 lines.

- [ ] **Step 5: Import all four in App.tsx** (side-effect import triggers `registerCommand`). Run tests and commit.

```bash
bun test && git add src/cli/tui/commands/{pause,resume,stop,dashboard}.ts src/cli/tui/App.tsx && git commit -m "feat(tui): add session lifecycle commands — /pause, /resume, /stop, /dashboard"
```

---

### Task 8: Live Control Commands + Modals

**Files:**
- Create `src/cli/tui/commands/boost.ts`, `kill.ts`, `inject.ts`
- Create `src/cli/tui/modals/BudgetModal.tsx`, `StrategyModal.tsx`
- Create `src/cli/tui/commands/budget.ts`, `strategy.ts`

**Interfaces:**
- `/boost <id>` — calls `boostHypothesis(memory, id, newElo)`, opens BoostModal if no id
- `/kill <id>` — calls `killHypothesis(memory, id)`, opens KillModal if no id
- `/inject` — opens InjectModal
- `/budget [tokens]` — opens BudgetModal (number input) if no arg, else sets directly
- `/strategy` — opens StrategyModal showing current task weights

All `activeWhen: ctx => ctx.sessionId !== null && ctx.supervisor !== null && !ctx.paused`.

- [ ] **Step 1: Write boost.ts, kill.ts, inject.ts** — each ~20 lines. `/boost` and `/kill` accept optional hypothesis ID arg; without it, open their respective existing modals. `/inject` always opens InjectModal.

- [ ] **Step 2: Write BudgetModal.tsx** — single numeric text field showing current budget. Built on `useInput` pattern (like BoostModal). Enter confirms new value. Esc cancels. ~40 lines.

- [ ] **Step 3: Write StrategyModal.tsx** — displays current task sampling weights as editable fields. For simplicity v1: show the weights as read-only text and allow a "reset to defaults" action. Full editing deferred. ~40 lines.

- [ ] **Step 4: Write budget.ts and strategy.ts** — ~20 lines each. `/budget [tokens]` — with arg, directly updates budget; without, opens BudgetModal. `/strategy` opens StrategyModal.

- [ ] **Step 5: Wire new modals into App.tsx ModalOverlay** — cases for `"budget"` and `"strategy"`. Import command files in App.tsx for side-effect registration. Run tests and commit.

```bash
bun test && git add src/cli/tui/commands/{boost,kill,inject,budget,strategy}.ts src/cli/tui/modals/{BudgetModal,StrategyModal}.tsx src/cli/tui/App.tsx && git commit -m "feat(tui): add live control commands — /boost, /kill, /inject, /budget, /strategy"
```

---

### Task 9: Results View + /results, /compare, /diff Commands

**Files:**
- Create `src/cli/tui/views/Results.tsx`
- Create `src/cli/tui/commands/results.ts`, `compare.ts`, `diff.ts`

**Interfaces:**
- `<Results appContext>` — ranked hypotheses table with selection, detail expand
- `/results` — switches to Results view
- `/compare <id1> <id2>` — side-by-side comparison (or opens picker if no args)
- `/diff <id>` — lineage/evolution chain view (or opens picker if no args)

- [ ] **Step 1: Write Results.tsx** — renders a table of all hypotheses from `memory.getAllActiveHypotheses(sessionId)` (refetched on mount and on focus). Columns: rank, Elo, status glyph, title, matches played. Arrow keys navigate, Enter expands detail (shows summary, rationale, citations). `/` returns focus to InputBar. ~80 lines.

- [ ] **Step 2: Write results.ts** — switches MainView to `"results"`. `activeWhen: ctx => ctx.sessionId !== null`. ~15 lines.

- [ ] **Step 3: Write compare.ts** — with two args: shows side-by-side text diff in a modal-like overlay. Without args: opens a picker (select two hypotheses from list). ~40 lines.

- [ ] **Step 4: Write diff.ts** — with arg: shows hypothesis lineage (parent chain) by querying `memory.getHypothesis(id)` and walking `parentIds`. Without arg: opens a picker. ~40 lines.

- [ ] **Step 5: Wire into MainView and App. Import commands. Run tests and commit.**

```bash
bun test && git add src/cli/tui/views/Results.tsx src/cli/tui/commands/{results,compare,diff}.ts src/cli/tui/MainView.tsx src/cli/tui/App.tsx && git commit -m "feat(tui): add Results view and /results, /compare, /diff commands"
```

---

### Task 10: Exploration Views + Commands

**Files:**
- Create `src/cli/tui/views/Graph.tsx`, `Overview.tsx`, `Thinking.tsx`, `Activity.tsx`
- Create `src/cli/tui/commands/graph.ts`, `overview.ts`, `thinking.ts`, `activity.ts`

**Interfaces:** Each view reads from ContextStore and renders text content. Each command switches MainView.

- [ ] **Step 1: Write Graph.tsx** — reads `memory.getKnowledgeGraph(sessionId)` (or equivalent query), renders nodes and edges as text tree / adjacency list. ~50 lines.

- [ ] **Step 2: Write Overview.tsx** — reads `memory.getResearchOverview(sessionId)`, renders formatted markdown text. `activeWhen` only when session is completed. ~30 lines.

- [ ] **Step 3: Write Thinking.tsx** — reads `memory.getThinkingTraces(sessionId)`, renders scrollable list with timestamps and truncated content. ~50 lines.

- [ ] **Step 4: Write Activity.tsx** — reads `memory.getSessionActivity(sessionId)`, renders chronological event log. ~40 lines.

- [ ] **Step 5: Write command files** — each ~15 lines, switch MainView. `overview` has `activeWhen` gated on completed status.

- [ ] **Step 6: Wire into MainView. Import commands. Run tests and commit.**

```bash
bun test && git add src/cli/tui/views/{Graph,Overview,Thinking,Activity}.tsx src/cli/tui/commands/{graph,overview,thinking,activity}.ts src/cli/tui/MainView.tsx src/cli/tui/App.tsx && git commit -m "feat(tui): add exploration views — /graph, /overview, /thinking, /activity"
```

---

### Task 11: Action Commands + Modals

**Files:**
- Create `src/cli/tui/modals/ExportModal.tsx`, `FeedbackModal.tsx`, `DesignModal.tsx`, `DeleteModal.tsx`
- Create `src/cli/tui/commands/exportCmd.ts`, `feedbackCmd.ts`, `designCmd.ts`, `deleteCmd.ts`

**Interfaces:**
- `/export [fmt]` — md or json. Opens ExportModal (format picker + optional path) if no arg.
- `/feedback [id]` — opens FeedbackModal (type, text, N/C/T scores). If id provided, pre-selects that hypothesis.
- `/design [id]` — opens DesignModal (hypothesis picker, detail level). Generates protocol via `ExperimentDesignAgent`.
- `/delete` — opens DeleteModal (select session(s), confirm with warning).

- [ ] **Step 1: Write ExportModal.tsx** — format selection (md/json via Tab/Enter), optional path input. Calls the existing export logic from `src/cli/commands/export.ts`. ~50 lines.

- [ ] **Step 2: Write FeedbackModal.tsx** — type selector (experimental/review), text input, N/C/T numeric inputs (3 fields, Tab between). On confirm, calls `memory.saveExperimentalFeedback()`. ~60 lines.

- [ ] **Step 3: Write DesignModal.tsx** — shows hypothesis picker (if no id in ctx), then detail level selector. On confirm, calls `ExperimentDesignAgent.execute()` and streams result into a scrollable view. ~70 lines.

- [ ] **Step 4: Write DeleteModal.tsx** — lists sessions with checkboxes (Space to toggle), confirm step with red warning text. On confirm, calls `memory.deleteSession()` for each selected. ~50 lines.

- [ ] **Step 5: Write command files** — each ~25 lines, open respective modal. `/delete` active always. `/export`, `/feedback`, `/design` active when session exists.

- [ ] **Step 6: Wire modals and commands into App. Run tests and commit.**

```bash
bun test && git add src/cli/tui/modals/{ExportModal,FeedbackModal,DesignModal,DeleteModal}.tsx src/cli/tui/commands/{exportCmd,feedbackCmd,designCmd,deleteCmd}.ts src/cli/tui/App.tsx && git commit -m "feat(tui): add action commands and modals — /export, /feedback, /design, /delete"
```

---

### Task 12: Navigation & System Commands

**Files:**
- Create `src/cli/tui/commands/sessions.ts`, `switch.ts`, `login.ts`, `logout.ts`, `help.ts`, `quit.ts`

**Interfaces:** Each registers one command handler. Most are `category: "System"`.

- [ ] **Step 1: Write sessions.ts** — lists sessions in a formatted view (inline, not a separate MainView). Execute: reads `memory.listSessions()`, renders session table (name, date, status, hypothesis count). `activeWhen: always`. ~30 lines.

- [ ] **Step 2: Write switch.ts** — switches to a different session. With arg: loads that session into App state via a callback. Without arg: shows picker. `activeWhen: always`. ~30 lines.

- [ ] **Step 3: Write login.ts** — triggers OAuth for Scite/Consensus. `activeWhen: always`. ~20 lines.

- [ ] **Step 4: Write logout.ts** — logs out of search providers. `activeWhen: always`. ~15 lines.

- [ ] **Step 5: Write help.ts** — renders all registered commands grouped by category in a formatted overlay. `activeWhen: always`. ~25 lines.

- [ ] **Step 6: Write quit.ts** — returns `{type: "exit"}`. `activeWhen: always`. ~10 lines.

- [ ] **Step 7: Wire into App. For `/switch`, add `onSwitchSession` callback to AppProps. Import all commands. Run tests and commit.**

```bash
bun test && git add src/cli/tui/commands/{sessions,switch,login,logout,help,quit}.ts src/cli/tui/App.tsx && git commit -m "feat(tui): add navigation and system commands — /sessions, /switch, /login, /logout, /help, /quit"
```

---

### Task 13: Header Update

**Files:** Modify `src/cli/tui/Header.tsx`

**Changes:**
- The existing Header already supports `paused` prop and shows "PAUSED" in yellow
- Update `sessionState` prop to accept `"running" | "paused" | null`
- When no session (state is null): show minimal header — just "🧬 co-scientist" with app name, no session ID, no stats
- When running: existing behavior with spinner
- When paused: existing "PAUSED" text
- Keep existing token gauge, hypothesis count, Elo display for running/paused states

- [ ] **Step 1: Update Header.tsx** — add `sessionState` prop. Conditional rendering: null state shows minimal header; running/paused show full header. ~15 lines changed.

- [ ] **Step 2: Update App.tsx** — pass `sessionState` derived from `sessionId` and `paused`. ~3 lines.

- [ ] **Step 3: Run tests and commit**

```bash
bun test && git add src/cli/tui/Header.tsx src/cli/tui/App.tsx && git commit -m "feat(tui): update Header for no-session, running, and paused states"
```

---

### Task 14: Integration — Empty-State Startup Path

**Files:** Modify `src/cli/tui/index.tsx`, `src/cli/commands/run.ts`

**Purpose:** Wire the empty-state startup path so the TUI can be launched without a session, show EmptyState, and start a session when the user types a topic or uses `/run`.

- [ ] **Step 1: Update run.ts** — add a new mode: when `--interactive` flag is passed (or when no `--goal` and TTY), launch TUI in empty-state mode. The `onStartSession` callback creates the supervisor, initializes the session, and updates App state (sessionId, goal, supervisor, emitter). The TUI transitions from EmptyState to Dashboard.

  Key wiring: `onStartSession` must call `supervisor.initSession(goal, name)`, create an EventEmitter, call `supervisor.setEmitter(emitter)`, update App state, and start `supervisor.run(sessionId)` in the background. The TUI's `useSessionData` hook starts polling once `sessionId` is non-null.

- [ ] **Step 2: Ensure graceful shutdown** — `onStop` calls `supervisor.stop()`. `onQuit` calls `supervisor.stop()`, updates session status to "paused", closes DB, exits.

- [ ] **Step 3: Manual integration test** — launch `bun run src/cli/index.ts --interactive`, verify EmptyState appears, type a research topic, verify Dashboard appears with leaderboard populating. Type `/pause`, verify session pauses. Type `/resume`, verify it resumes. Type `/quit`, verify clean exit.

- [ ] **Step 4: Run tests and commit**

```bash
bun test && git add src/cli/tui/index.tsx src/cli/commands/run.ts && git commit -m "feat(tui): wire empty-state startup path with session creation from TUI"
```

---

### Task 15: Polish — Edge Cases, Toast Timing, Autocomplete Refinement

**Files:** Various touch-ups across the new TUI files.

- [ ] **Step 1: Toast stacking** — if a new toast fires while one is showing, dismiss the old one and show the new one (don't queue). Fix in `InputBar.tsx`: dismiss previous toast on new message.

- [ ] **Step 2: Input clearing on context switch** — when MainView changes (e.g., after `/results`), clear the input bar. Implement via `useEffect` on `activeView` in InputBar or by passing a `clearKey` prop.

- [ ] **Step 3: Palette dismissal** — clicking Esc when palette is open should close palette but keep the `/` text in the input bar (for re-editing). Currently Esc toggles focus. Fix: first Esc closes palette (if open), second Esc toggles focus.

- [ ] **Step 4: Session completion handling** — when the supervisor emits `"completed"`, switch MainView to `"overview"` and show a toast.

- [ ] **Step 5: Session error handling** — when the supervisor emits `"error"`, show error toast with the message, keep Dashboard visible.

- [ ] **Step 6: Empty leaderboard handling in Dashboard** — show "No hypotheses yet — waiting for generation..." instead of blank space.

- [ ] **Step 7: Run full test suite and commit**

```bash
bun test && git add -A src/cli/tui/ && git commit -m "fix(tui): polish — toast stacking, input clearing, palette Esc, completion/error handling"
```

---

## Testing Strategy

Each task includes `bun test` in its commit step. The existing test suite (`src/tests/`) must continue to pass. No new unit tests are written for Ink React components — they render to terminal ANSI and are tested via manual integration (launching the TUI). The `CommandRouter` is pure logic and testable:

```typescript
// src/tests/tui/CommandRouter.test.ts (create in Task 1)
import { describe, test, expect } from "bun:test";
import { route, registerCommand } from "../../cli/tui/CommandRouter.js";
import type { AppContext, CommandHandler } from "../../cli/tui/CommandRouter.js";

const mockCtx = (overrides: Partial<AppContext> = {}): AppContext => ({
  memory: null as any, sessionId: null, goal: null, supervisor: null, emitter: null,
  setMainView: () => {}, openModal: () => {}, closeModal: () => {},
  showToast: () => {}, startSession: async () => {}, stopSession: () => {},
  togglePause: () => false, paused: false,
  ...overrides,
});

test("free text returns session_start", () => {
  const r = route("cancer biomarker discovery", mockCtx());
  expect(r.type).toBe("session_start");
  expect((r as any).goal).toBe("cancer biomarker discovery");
});

test("slash command dispatches to registered handler", async () => {
  registerCommand({
    name: "test", description: "test cmd", category: "System",
    execute: async () => ({ type: "immediate", message: "ok" }),
  } as CommandHandler);
  const r = route("/test", mockCtx());
  expect(r.type).toBe("immediate");
});

test("unknown command returns error", () => {
  const r = route("/nonexistent", mockCtx());
  expect(r.type).toBe("error");
});
```

---

## Implementation Order Summary

| Task | Deliverable | Depends On |
|------|------------|------------|
| 1 | CommandRouter types + registry | — |
| 2 | InputBar + CommandPalette + Toast | — |
| 3 | MainView + EmptyState + Dashboard stub | — |
| 4 | App shell rewrite + renderTUI update | 1, 2, 3 |
| 5 | RunModal + /run + session creation | 4 |
| 6 | Dashboard view (refactored) | 4 |
| 7 | /pause, /resume, /stop, /dashboard | 4, 6 |
| 8 | /boost, /kill, /inject, /budget, /strategy | 4, 6 |
| 9 | Results view + /results, /compare, /diff | 4 |
| 10 | Graph, Overview, Thinking, Activity views | 4 |
| 11 | /export, /feedback, /design, /delete modals | 4 |
| 12 | /sessions, /switch, /login, /logout, /help, /quit | 4 |
| 13 | Header update | 4 |
| 14 | Empty-state startup wiring | 5, 6, 7 |
| 15 | Polish — edge cases, toast, focus | all |

Tasks 1-3 can run in parallel. Tasks 4 blocks on 1+2+3. Tasks 5-13 can run in parallel after 4. Task 14 blocks on 5+6+7. Task 15 is last.
