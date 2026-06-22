# TUI Cleanup, Fixes & Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove four redundant/dead TUI commands, fix `/strategy` to show real scheduler weights, make the input cursor blink, ensure informational command output persists in the transcript, and clean up identified dead code.

**Architecture:** The TUI is an Ink/React REPL. Slash commands self-register into a `Map` registry (`CommandRouter.ts`) via side-effect imports in `App.tsx`; each returns a `RouteResult` discriminated union (`immediate` → ephemeral toast, `transcript` → persistent `<Static>` scrollback, `modal`, `error`, `exit`). Removing a command = delete its file + its import line. The supervisor owns the `TaskScheduler`; `/strategy` will read live weights from it.

**Tech Stack:** TypeScript, Bun, Ink (React for terminals), `bun:test`.

## Global Constraints

- Test runner is `bun:test` (not Jest/Vitest). Run all tests with `bun test`; a single file with `bun test <path>`.
- Typecheck with `bunx tsc --noEmit` — must stay clean.
- Baseline: 272 tests passing. The full suite must stay green after every task.
- Toasts are for trivial acknowledgements and validation errors only; informational/multi-line output returns `type: "transcript"`.
- Commit message trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Work happens on branch `tui-cleanup-fixes` (already created; design spec already committed there).

---

## File Structure

- **Delete:** `src/cli/tui/commands/dashboard.ts`, `src/cli/tui/commands/switch.ts`, `src/cli/tui/commands/deleteCmd.ts`, `src/cli/tui/commands/resume.ts`
- **Edit:** `src/cli/tui/App.tsx` (imports, `openModal`, `closeModal`, `StrategyModal` weights, `SessionsModal` `onResume`), `src/cli/tui/Footer.tsx`, `src/cli/tui/InputBar.tsx`, `src/cli/tui/CommandRouter.ts` (drop `closeModal`), `src/agents/supervisor.ts` (weights exposure), and commands `pause.ts`, `budget.ts`, `logout.ts`, `exportCmd.ts`, `boost.ts`, `kill.ts`
- **Tests:** `src/tests/tui/sessionsCommands.test.ts`, `src/tests/tui/CommandRouter.test.ts`, plus new assertions in `src/agents/__` (see Task 3) and command tests.

---

## Task 1: Remove redundant/dead commands (`/dashboard`, `/switch`, `/delete`, `/resume`)

**Files:**
- Delete: `src/cli/tui/commands/dashboard.ts`, `src/cli/tui/commands/switch.ts`, `src/cli/tui/commands/deleteCmd.ts`, `src/cli/tui/commands/resume.ts`
- Modify: `src/cli/tui/App.tsx` (remove four import lines)
- Test: `src/tests/tui/sessionsCommands.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a registry without `dashboard`/`switch`/`delete`/`resume` handlers. `/sessions` (unchanged) remains the single entry point for browse/view/overview/export/resume/delete.

- [ ] **Step 1: Update the failing test first**

Replace the entire contents of `src/tests/tui/sessionsCommands.test.ts` with (removes `/switch` and `/delete` imports + cases, and the now-removed `closeModal` mock field):

```typescript
import { describe, it, expect } from "bun:test";
import "../../cli/tui/commands/sessions.js";
import { getCommand, type AppContext } from "../../cli/tui/CommandRouter.js";

const sessionsHandler = getCommand("sessions");

function ctx(sessions: unknown[] = []): AppContext {
  return {
    memory: { listSessions: () => sessions } as unknown as AppContext["memory"],
    sessionId: null, goal: null, supervisor: null, emitter: null,
    openModal: () => {}, closeModal: () => {}, showToast: () => {},
    startSession: async () => {}, resumeSession: async () => {},
    stopSession: () => {}, togglePause: () => false, paused: false, pushEntry: () => {},
  };
}

describe("session picker commands", () => {
  it("/sessions opens the sessions modal", async () => {
    const r = await sessionsHandler!.execute([], ctx());
    expect(r).toEqual({ type: "modal", modal: "sessions" });
  });

  it("/switch and /delete are no longer registered", async () => {
    expect(getCommand("switch")).toBeUndefined();
    expect(getCommand("delete")).toBeUndefined();
    expect(getCommand("dashboard")).toBeUndefined();
    expect(getCommand("resume")).toBeUndefined();
  });
});
```

(Keep `closeModal: () => {},` in the mock for now — the `AppContext` interface still declares it until Task 6, which removes it from both the interface and this mock together.)

- [ ] **Step 2: Run the test — it fails to import removed modules? No — verify current state fails**

Run: `bun test src/tests/tui/sessionsCommands.test.ts`
Expected: FAIL — the new "not registered" test fails because `switch`/`delete`/`dashboard`/`resume` are still registered (their files still exist and are imported transitively via other test setup is NOT the case here, but `sessions.js` import does not register them, so they are actually undefined already). If the test PASSES at this step, that is acceptable — the deletions in Step 3 still need doing for `App.tsx`. Proceed to Step 3 regardless.

- [ ] **Step 3: Delete the four command files**

```bash
git rm src/cli/tui/commands/dashboard.ts \
       src/cli/tui/commands/switch.ts \
       src/cli/tui/commands/deleteCmd.ts \
       src/cli/tui/commands/resume.ts
```

- [ ] **Step 4: Remove the four import lines in `App.tsx`**

Delete these exact lines from `src/cli/tui/App.tsx`:

```typescript
import "./commands/resume.js";
```
```typescript
import "./commands/dashboard.js";
```
```typescript
import "./commands/deleteCmd.js";
```
```typescript
import "./commands/switch.js";
```

- [ ] **Step 5: Verify no dangling references**

Run: `grep -rn "commands/dashboard\|commands/switch\|commands/deleteCmd\|commands/resume" src/`
Expected: no output.

- [ ] **Step 6: Typecheck and test**

Run: `bunx tsc --noEmit && bun test`
Expected: clean typecheck; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(tui): remove redundant /dashboard, /switch, /delete, /resume commands

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `/pause` is pause-only; resume routed through `/sessions`

**Files:**
- Modify: `src/cli/tui/commands/pause.ts`, `src/cli/tui/Footer.tsx`, `src/cli/tui/App.tsx` (`SessionsModal` `onResume`)
- Test: `src/tests/tui/pauseCommand.test.ts` (new)

**Interfaces:**
- Consumes: `AppContext.togglePause(): boolean` (already pushes a persistent "Session paused."/"Session resumed." transcript notice in `App.tsx`).
- Produces: `/pause` returns `{ type: "immediate" }` with **no** `message`. `App.tsx` `onResume` unpauses the current paused session in-place.

- [ ] **Step 1: Write the failing test**

Create `src/tests/tui/pauseCommand.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import "../../cli/tui/commands/pause.js";
import { getCommand, type AppContext } from "../../cli/tui/CommandRouter.js";

const pause = getCommand("pause");

function ctx(over: Partial<AppContext> = {}): AppContext {
  let toggled = false;
  return {
    memory: {} as AppContext["memory"],
    sessionId: "s1", goal: "g", supervisor: {} as AppContext["supervisor"], emitter: null,
    openModal: () => {}, showToast: () => {},
    startSession: async () => {}, resumeSession: async () => {},
    stopSession: () => {},
    togglePause: () => { toggled = true; return true; },
    paused: false, pushEntry: () => {},
    ...over,
  } as AppContext;
}

describe("/pause command", () => {
  it("calls togglePause and returns immediate with NO message (no duplicate toast)", async () => {
    let toggled = false;
    const c = ctx({ togglePause: () => { toggled = true; return true; } });
    const r = await pause!.execute([], c);
    expect(toggled).toBe(true);
    expect(r.type).toBe("immediate");
    if (r.type === "immediate") expect(r.message).toBeUndefined();
  });

  it("is not active when already paused", () => {
    expect(pause!.activeWhen?.(ctx({ paused: true }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/tests/tui/pauseCommand.test.ts`
Expected: FAIL — current `pause.ts` returns `{ type: "immediate", message: "Session paused." }`.

- [ ] **Step 3: Rewrite `commands/pause.ts`**

Replace the file body's `execute` with the no-message version:

```typescript
import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

const pauseCommand: CommandHandler = {
  name: "pause",
  description: "Pause the running session (resume via /sessions)",
  category: "Lifecycle",
  activeWhen: (ctx) => ctx.sessionId !== null && ctx.supervisor !== null && !ctx.paused,
  async execute(_args, ctx) {
    // togglePause() in App.tsx pushes a persistent "Session paused." notice,
    // so we return no toast message to avoid a duplicate.
    ctx.togglePause();
    return { type: "immediate" };
  },
};

registerCommand(pauseCommand);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/tests/tui/pauseCommand.test.ts`
Expected: PASS.

- [ ] **Step 5: Update `Footer.tsx` paused-branch hint**

In `src/cli/tui/Footer.tsx`, change the `paused` branch (currently `["/resume", "/results", "/graph", "/activity", "/stop"]`) to:

```typescript
  } else if (paused) {
    hints = ["/sessions", "/results", "/graph", "/activity", "/stop"];
```

- [ ] **Step 6: Wire `App.tsx` `onResume` to unpause the current paused session**

In `src/cli/tui/App.tsx`, inside the `SessionsModal`'s `onResume={(id) => { ... }}`, replace the existing `if (id === sessionId) { ... }` block:

```typescript
            if (id === sessionId) {
              appContext.showToast("Already on this session.", "info");
              setActiveModal(null);
              return;
            }
```

with:

```typescript
            if (id === sessionId) {
              if (paused) {
                // Unpause the current in-memory session in place.
                appContext.togglePause();
              } else {
                appContext.showToast("Already on this session.", "info");
              }
              setActiveModal(null);
              return;
            }
```

- [ ] **Step 7: Typecheck and full test**

Run: `bunx tsc --noEmit && bun test`
Expected: clean; all pass.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(tui): /pause is pause-only; resume (incl. unpause) via /sessions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `/strategy` shows real scheduler weights

**Files:**
- Modify: `src/agents/supervisor.ts` (store + expose weights)
- Modify: `src/cli/tui/App.tsx` (`StrategyModal` weights prop)
- Test: `src/tests/supervisorWeights.test.ts` (new)

**Interfaces:**
- Consumes: `TaskScheduler.computeWeights(stats: SchedulerStats): AgentWeights` and the `AgentWeights` type (`generation, reflection, ranking, evolution, proximity, meta_review`, all `number`), both exported from `src/taskQueue/queue.ts`.
- Produces: `SupervisorAgent.getCurrentWeights(): AgentWeights` — returns the last weights the loop computed, or a freshly computed default (generation-heavy, for a not-yet-started session) so the modal always has real numbers.

- [ ] **Step 1: Write the failing test**

Create `src/tests/supervisorWeights.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { SupervisorAgent } from "../agents/supervisor.js";

describe("SupervisorAgent.getCurrentWeights", () => {
  it("returns a valid AgentWeights with all six task types before any loop iteration", () => {
    const sup = new SupervisorAgent();
    const w = sup.getCurrentWeights();
    for (const k of ["generation", "reflection", "ranking", "evolution", "proximity", "meta_review"] as const) {
      expect(typeof w[k]).toBe("number");
      expect(w[k]).toBeGreaterThanOrEqual(0);
    }
    // Fresh session is generation-heavy.
    expect(w.generation).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/tests/supervisorWeights.test.ts`
Expected: FAIL — `getCurrentWeights` is not a function.

- [ ] **Step 3: Add `lastWeights` field + import in `supervisor.ts`**

Ensure the import of `AgentWeights` exists at the top of `src/agents/supervisor.ts`. The line currently is:

```typescript
import { AgentTaskQueue, TaskScheduler } from "../taskQueue/queue.js";
```

Change it to:

```typescript
import { AgentTaskQueue, TaskScheduler } from "../taskQueue/queue.js";
import type { AgentWeights } from "../taskQueue/queue.js";
```

Then add a field next to the other private fields (after `private scheduler = new TaskScheduler();`):

```typescript
  private lastWeights: AgentWeights | null = null;
```

- [ ] **Step 4: Capture weights in the loop**

In `src/agents/supervisor.ts`, the loop currently has:

```typescript
      const weights = this.scheduler.computeWeights({
```

Immediately **after** the closing `});` of that `computeWeights({...})` call (before `const taskType = this.scheduler.sampleNextTaskType(weights);`), add:

```typescript
      this.lastWeights = weights;
```

- [ ] **Step 5: Add the `getCurrentWeights` method**

Add this public method to the `SupervisorAgent` class (e.g. just below the constructor or near other public methods):

```typescript
  /** Live task-sampling weights for the /strategy view. Returns the last
   *  weights computed by the loop, or generation-heavy defaults for a
   *  session that has not yet iterated. */
  getCurrentWeights(): AgentWeights {
    if (this.lastWeights) return this.lastWeights;
    return this.scheduler.computeWeights({
      totalHypotheses: 0,
      activeHypotheses: 0,
      pendingReview: 0,
      totalMatches: 0,
      currentRound: 0,
      tokensUsed: 0,
      budgetTokens: this.config.compute.budgetTokens,
      maxHypotheses: this.config.compute.maxHypotheses,
    });
  }
```

(`this.config` is available on `BaseAgent`; it is already used in the loop at `this.config.compute.budgetTokens`.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test src/tests/supervisorWeights.test.ts`
Expected: PASS.

- [ ] **Step 7: Use real weights in `App.tsx` `StrategyModal`**

In `src/cli/tui/App.tsx`, replace the hardcoded `weights={{ ... }}` block:

```typescript
      {activeModal === "strategy" && (
        <StrategyModal
          weights={{
            generation: (stats?.activeHypotheses ?? 0) < 3 ? 0.60 : 0.30,
            reflection: 0.20,
            ranking: (stats?.activeHypotheses ?? 0) >= 2 ? 0.30 : 0.03,
            evolution: 0.10,
            proximity: 0.07,
            meta_review: 0.03,
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}
```

with:

```typescript
      {activeModal === "strategy" && (
        <StrategyModal
          weights={supervisor?.getCurrentWeights() ?? {
            generation: 1, reflection: 0, ranking: 0,
            evolution: 0, proximity: 0, meta_review: 0,
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}
```

(The `??` branch is only a TypeScript null-guard; `/strategy`'s `activeWhen` already requires a non-null supervisor.)

- [ ] **Step 8: Typecheck and full test**

Run: `bunx tsc --noEmit && bun test`
Expected: clean; all pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "fix(tui): /strategy shows real TaskScheduler weights instead of hardcoded values

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Blinking input cursor

**Files:**
- Modify: `src/cli/tui/InputBar.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: a visibly blinking caret. No exported API change.

- [ ] **Step 1: Add `cursorVisible` state + blink interval**

In `src/cli/tui/InputBar.tsx`, the existing state declarations start with:

```typescript
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
```

Add immediately after them:

```typescript
  const [cursorVisible, setCursorVisible] = useState(true);
```

Then add this effect alongside the other `useEffect`s (e.g. after the "Clamp cursor to text length" effect):

```typescript
  // Blink the caret on a ~530ms cadence. InputBar lives outside <Static>,
  // so this re-render is contained to the input region.
  useEffect(() => {
    const id = setInterval(() => setCursorVisible((v) => !v), 530);
    return () => clearInterval(id);
  }, []);
```

- [ ] **Step 2: Render the blinking caret**

In the JSX, the current caret block is:

```typescript
        <Text color="text">{text.slice(0, cursor)}</Text>
        {cursor < text.length ? (
          <Text color="inverseText" backgroundColor="text">{text[cursor]}</Text>
        ) : (
          <Text color="text">▌</Text>
        )}
        <Text color="text">{text.slice(cursor + 1)}</Text>
```

Replace it with:

```typescript
        <Text color="text">{text.slice(0, cursor)}</Text>
        {cursor < text.length ? (
          cursorVisible ? (
            <Text color="inverseText" backgroundColor="text">{text[cursor]}</Text>
          ) : (
            <Text color="text">{text[cursor]}</Text>
          )
        ) : (
          <Text color="text">{cursorVisible ? "▌" : " "}</Text>
        )}
        <Text color="text">{text.slice(cursor + 1)}</Text>
```

- [ ] **Step 3: Typecheck and full test**

Run: `bunx tsc --noEmit && bun test`
Expected: clean; all pass (no test targets this rendering directly).

- [ ] **Step 4: Manual verification**

Run: `bun run dev` (or `bun run src/cli/index.ts`), confirm the caret in the input box blinks at the end of an empty prompt and over a character when the cursor is mid-text. Press Ctrl+C to exit.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(tui): blink the input cursor on a 530ms cadence

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Informational command output persists in the transcript

**Files:**
- Modify: `src/cli/tui/commands/budget.ts`, `src/cli/tui/commands/logout.ts`, `src/cli/tui/commands/exportCmd.ts`, `src/cli/tui/commands/boost.ts`, `src/cli/tui/commands/kill.ts`
- Test: `src/tests/tui/persistentOutput.test.ts` (new)

**Interfaces:**
- Consumes: `formatSystemNotice(text: string, tone?: "info" | "success" | "error"): TranscriptEntry` from `src/cli/tui/formatters.js`.
- Produces: these five commands' info/confirmation paths return `{ type: "transcript", entries: [TranscriptEntry] }` instead of `{ type: "immediate", message }`. Validation-error paths stay `{ type: "error", message }`.

- [ ] **Step 1: Write the failing test**

Create `src/tests/tui/persistentOutput.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import "../../cli/tui/commands/logout.js";
import { getCommand, type AppContext } from "../../cli/tui/CommandRouter.js";

const logout = getCommand("logout");

function ctx(): AppContext {
  return {
    memory: {} as AppContext["memory"],
    sessionId: "s1", goal: null, supervisor: null, emitter: null,
    openModal: () => {}, showToast: () => {},
    startSession: async () => {}, resumeSession: async () => {},
    stopSession: () => {}, togglePause: () => false, paused: false, pushEntry: () => {},
  } as AppContext;
}

describe("informational output persists", () => {
  it("/logout returns a persistent transcript entry, not a toast", async () => {
    const r = await logout!.execute([], ctx());
    expect(r.type).toBe("transcript");
    if (r.type === "transcript") {
      expect(r.entries.length).toBeGreaterThan(0);
    }
  });

  it("/logout still rejects an invalid provider with an error", async () => {
    const r = await logout!.execute(["bogus"], ctx());
    expect(r.type).toBe("error");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/tests/tui/persistentOutput.test.ts`
Expected: FAIL — `/logout` currently returns `{ type: "immediate", ... }`.

- [ ] **Step 3: Convert `logout.ts`**

In `src/cli/tui/commands/logout.ts`, add the formatter import at the top:

```typescript
import { formatSystemNotice } from "../formatters.js";
```

Change the final `return { type: "immediate", message: results.join(" | ") };` to:

```typescript
    return { type: "transcript", entries: [formatSystemNotice(results.join(" | "), "success")] };
```

- [ ] **Step 4: Convert `budget.ts`**

In `src/cli/tui/commands/budget.ts`, add at the top:

```typescript
import { formatSystemNotice } from "../formatters.js";
```

Change the arg-form success return:

```typescript
      return {
        type: "immediate",
        message: `Token budget set to ${cfg.compute.budgetTokens.toLocaleString()}.`,
      };
```

to:

```typescript
      return {
        type: "transcript",
        entries: [formatSystemNotice(
          `Token budget set to ${cfg.compute.budgetTokens.toLocaleString()}.`,
          "success",
        )],
      };
```

(Leave the `"Budget must be a positive integer."` error return as `type: "error"`.)

- [ ] **Step 5: Convert `exportCmd.ts`**

In `src/cli/tui/commands/exportCmd.ts`, add at the top:

```typescript
import { formatSystemNotice } from "../formatters.js";
```

Change `return { type: "immediate", message: \`Exported session as ${format}.\` };` to:

```typescript
        return { type: "transcript", entries: [formatSystemNotice(`Exported session as ${format}.`, "success")] };
```

(Leave the format-validation and export-failure returns as `type: "error"`.)

- [ ] **Step 6: Convert `boost.ts`**

In `src/cli/tui/commands/boost.ts`, add at the top:

```typescript
import { formatSystemNotice } from "../formatters.js";
```

Change `return { type: "immediate", message: \`Boosted "${hyp.title.slice(0, 40)}" to ${newElo} Elo.\` };` to:

```typescript
      return { type: "transcript", entries: [formatSystemNotice(`Boosted "${hyp.title.slice(0, 40)}" to ${newElo} Elo.`, "success")] };
```

(Leave the "Hypothesis not found" error and the no-arg `{ type: "modal", modal: "boost" }` returns unchanged.)

- [ ] **Step 7: Convert `kill.ts`**

In `src/cli/tui/commands/kill.ts`, add at the top:

```typescript
import { formatSystemNotice } from "../formatters.js";
```

Change `return { type: "immediate", message: \`Killed "${hyp.title.slice(0, 40)}".\` };` to:

```typescript
      return { type: "transcript", entries: [formatSystemNotice(`Killed "${hyp.title.slice(0, 40)}".`, "success")] };
```

(Leave the "Hypothesis not found" error and the no-arg modal return unchanged.)

- [ ] **Step 8: Run the test to verify it passes**

Run: `bun test src/tests/tui/persistentOutput.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck and full test**

Run: `bunx tsc --noEmit && bun test`
Expected: clean; all pass.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "fix(tui): persist /budget, /logout, /export, /boost, /kill output in transcript

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Dead-code cleanup (`closeModal`, `openModal` data param)

**Files:**
- Modify: `src/cli/tui/CommandRouter.ts` (drop `closeModal` from `AppContext`), `src/cli/tui/App.tsx` (drop `closeModal` impl; fix `openModal` to honor `data`), `src/tests/tui/CommandRouter.test.ts` and `src/tests/tui/sessionsCommands.test.ts` (drop `closeModal` from mocks)

**Interfaces:**
- Consumes: nothing.
- Produces: `AppContext` no longer declares `closeModal`. `openModal(modal, data?)` now actually stores `data` via `setModalData`.

- [ ] **Step 1: Remove `closeModal` from the `AppContext` interface**

In `src/cli/tui/CommandRouter.ts`, delete this line from the `AppContext` interface:

```typescript
  closeModal: () => void;
```

- [ ] **Step 2: Remove the `closeModal` implementation and fix `openModal` in `App.tsx`**

In `src/cli/tui/App.tsx`, the `appContext` object currently has:

```typescript
    openModal: (modal) => setActiveModal(modal),
    closeModal: () => setActiveModal(null),
```

Replace both lines with:

```typescript
    openModal: (modal, data) => { setModalData(data ?? null); setActiveModal(modal); },
```

- [ ] **Step 3: Remove `closeModal` from the two test mocks**

In `src/tests/tui/CommandRouter.test.ts`, delete the line `closeModal: () => {},` from `createMockContext`.

In `src/tests/tui/sessionsCommands.test.ts`, delete the `closeModal: () => {},` line from the `ctx` helper (added in Task 1).

- [ ] **Step 4: Verify no remaining references**

Run: `grep -rn "closeModal" src/`
Expected: no output.

- [ ] **Step 5: Typecheck and full test**

Run: `bunx tsc --noEmit && bun test`
Expected: clean typecheck; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(tui): drop unused closeModal; honor openModal data param

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run the complete suite and typecheck once more:

Run: `bunx tsc --noEmit && bun test`
Expected: clean typecheck; all tests pass (≥ baseline 272).

- [ ] Manual smoke test in `bun run dev`:
  - `/help` lists no `/dashboard`, `/switch`, `/delete`, `/resume`.
  - Start a session, `/pause`, then `/sessions` → highlight the current session → resume unpauses it.
  - `/strategy` shows non-fabricated weights that change as the session progresses.
  - `/budget 50000`, `/logout` output stays on screen (does not vanish after 3s).
  - Input caret blinks.

---

## Self-Review Notes

- **Spec coverage:** A→Task 1; B→Task 2; C→Task 3; D→Task 4; E→Task 5; F→Task 6; testing requirements distributed across tasks + Final verification. All spec sections mapped.
- **Type consistency:** `AgentWeights` (six numeric keys) used identically in Task 3's supervisor method, test, and `StrategyModal` prop. `formatSystemNotice(text, tone)` signature used consistently in Task 5. `openModal(modal, data?)` matches the `CommandRouter.ts` declaration.
- **Ordering caveat:** Task 1's mock keeps `closeModal`; Task 6 removes it from both the interface and the mocks together, so typecheck stays green between tasks.
