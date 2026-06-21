# Sessions Picker Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the long `/sessions` transcript dump with a single windowed, filterable picker modal (opened by `/sessions` and `/delete`) that can view, resume, overview, export, and delete sessions.

**Architecture:** A new `SessionsModal` Ink component adapts the existing `DeleteModal` windowing and adds a navigate/filter two-mode input loop. Command handlers (`sessions`, `delete`) just open the modal; `App.tsx` wires the per-session action callbacks. Resume reuses the CLI resume mechanics via a new `onResumeSession` prop threaded through `index.tsx` → `App`.

**Tech Stack:** TypeScript, React + Ink (via `src/cli/ink.js` wrapper), `bun:test`, `ink-testing-library`.

## Global Constraints

- Tests use `bun:test` (import from `"bun:test"`), not Jest/Vitest.
- All TUI components import Ink primitives from `../../ink.js` (modals) or `../ink.js` (tui root), never directly from `ink`.
- Relative imports use the `.js` extension (NodeNext resolution), even for `.tsx`/`.ts` source.
- Run a single test file with `bun test <path>`; run everything with `bun test`.
- Theme colors used by modals: `error`, `success`, `claude`, `warning`, `text`, `permission` (already defined in the design system).

---

### Task 1: `formatSessionResults` helper

**Files:**
- Modify: `src/cli/tui/formatters.ts`
- Test: `src/tests/formatSessionResults.test.ts` (create)

**Interfaces:**
- Consumes: existing `formatResults(memory, sessionId): TranscriptEntry` and `memory.getSession(id)`.
- Produces: `formatSessionResults(memory: ContextStore, sessionId: string): TranscriptEntry` — a single block whose title is the session name and whose first lines are a metadata header (full id · status · date · hypothesis count), a divider, then the `formatResults` rows.

- [ ] **Step 1: Write the failing test**

Create `src/tests/formatSessionResults.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { formatSessionResults } from "../cli/tui/formatters.js";
import type { ContextStore } from "../memory/contextStore.js";

function fakeMemory(): ContextStore {
  return {
    getSession: (_id: string) => ({
      id: "a1b2c3d4-1111-2222-3333-444455556666",
      name: "Histopathology fairness review",
      status: "completed",
      createdAt: new Date("2026-06-14T00:00:00Z"),
      stats: { totalHypotheses: 12 },
    }),
    getAllActiveHypotheses: (_id: string) => [
      { id: "h1", title: "Tumor-stroma bias", summary: "s", content: "", eloRating: 1623, status: "active" },
    ],
  } as unknown as ContextStore;
}

describe("formatSessionResults", () => {
  it("prepends a metadata header with full id, status, date and count", () => {
    const entry = formatSessionResults(fakeMemory(), "a1b2c3d4-1111-2222-3333-444455556666");
    expect(entry.kind).toBe("block");
    expect(entry.title).toBe("Histopathology fairness review");
    const text = (entry.lines ?? []).join("\n");
    expect(text).toContain("a1b2c3d4-1111-2222-3333-444455556666");
    expect(text).toContain("completed");
    expect(text).toContain("2026-06-14");
    expect(text).toContain("12 hypotheses");
    expect(text).toContain("Tumor-stroma bias"); // body from formatResults
  });

  it("falls back to the id as title when the session is missing", () => {
    const mem = { getSession: () => null, getAllActiveHypotheses: () => [] } as unknown as ContextStore;
    const entry = formatSessionResults(mem, "deadbeef");
    expect(entry.title).toContain("deadbeef");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tests/formatSessionResults.test.ts`
Expected: FAIL — `formatSessionResults` is not exported.

- [ ] **Step 3: Implement the helper**

In `src/cli/tui/formatters.ts`, directly after the `formatResults` function, add:

```ts
/**
 * Like {@link formatResults} but for an arbitrary (possibly non-active) session:
 * prepends a metadata header (full id, status, date, hypothesis count) and a
 * divider, and titles the block with the session name. Used by the sessions picker.
 */
export function formatSessionResults(
  memory: ContextStore,
  sessionId: string,
): TranscriptEntry {
  const base = formatResults(memory, sessionId);
  const session = memory.getSession(sessionId);
  if (!session) {
    return { ...base, title: `Results · ${sessionId.slice(0, 8)}` };
  }
  const count = session.stats?.totalHypotheses ?? 0;
  const date = session.createdAt.toISOString().slice(0, 10);
  const header = [
    `${session.id}  ·  ${session.status}  ·  ${date}  ·  ${count} hypotheses`,
    "─".repeat(72),
  ];
  return {
    ...base,
    title: session.name,
    lines: [...header, ...(base.lines ?? [])],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/tests/formatSessionResults.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli/tui/formatters.ts src/tests/formatSessionResults.test.ts
git commit -m "feat(tui): formatSessionResults helper for picker results view"
```

---

### Task 2: `SessionsModal` component

**Files:**
- Create: `src/cli/tui/modals/SessionsModal.tsx`
- Test: `src/tests/tui/sessionsModal.test.tsx` (create)

**Interfaces:**
- Consumes: `CoScientistSession` type; `useTerminalSize()` (returns `{ rows, columns }`, falls back to 24×80 headless).
- Produces: `SessionsModal` React component with props:
  ```ts
  interface SessionsModalProps {
    sessions: CoScientistSession[];
    activeSessionId: string | null;
    onView: (sessionId: string) => void;
    onResume: (sessionId: string) => void;
    onOverview: (sessionId: string) => void;
    onExport: (sessionId: string) => void;
    onDelete: (sessionIds: string[]) => void;
    onCancel: () => void;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `src/tests/tui/sessionsModal.test.tsx`:

```tsx
import { describe, it, expect } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../cli/design-system/ThemeProvider.js";
import { SessionsModal } from "../../cli/tui/modals/SessionsModal.js";
import type { CoScientistSession } from "../../models/session.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeSessions(n: number): CoScientistSession[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id${String(i).padStart(2, "0")}-aaaa-bbbb-cccc-000000000000`,
    name: `session-2026-06-${String((i % 28) + 1).padStart(2, "0")}`,
    status: i % 2 === 0 ? "completed" : "paused",
    createdAt: new Date("2026-06-14T00:00:00Z"),
    stats: { totalHypotheses: i },
  })) as unknown as CoScientistSession[];
}

interface Spies {
  onView: string[]; onResume: string[]; onOverview: string[];
  onExport: string[]; onDelete: string[][]; onCancel: number;
}

function mount(sessions: CoScientistSession[]) {
  const calls: Spies = { onView: [], onResume: [], onOverview: [], onExport: [], onDelete: [], onCancel: 0 };
  const node = React.createElement(ThemeProvider, null,
    React.createElement(SessionsModal, {
      sessions,
      activeSessionId: null,
      onView: (id: string) => calls.onView.push(id),
      onResume: (id: string) => calls.onResume.push(id),
      onOverview: (id: string) => calls.onOverview.push(id),
      onExport: (id: string) => calls.onExport.push(id),
      onDelete: (ids: string[]) => calls.onDelete.push(ids),
      onCancel: () => { calls.onCancel++; },
    }),
  );
  const r = render(node as React.ReactElement);
  return { calls, ...r };
}

describe("SessionsModal", () => {
  it("windows a long list far below the full count", async () => {
    const { lastFrame } = mount(makeSessions(77));
    await delay(10);
    const f = lastFrame() ?? "";
    const shown = makeSessions(77).filter((s) => f.includes(s.id.slice(0, 6))).length;
    expect(shown).toBeLessThanOrEqual(8);
    expect(f).toContain("/77");
  });

  it("enter views the highlighted session", async () => {
    const { calls, stdin } = mount(makeSessions(5));
    await delay(10);
    stdin.write("\r");
    await delay(10);
    expect(calls.onView).toEqual(["id00-aaaa-bbbb-cccc-000000000000"]);
  });

  it("r/o/e fire resume/overview/export on the highlighted session", async () => {
    const { calls, stdin } = mount(makeSessions(5));
    await delay(10);
    stdin.write("r"); await delay(5);
    stdin.write("o"); await delay(5);
    stdin.write("e"); await delay(5);
    expect(calls.onResume).toEqual(["id00-aaaa-bbbb-cccc-000000000000"]);
    expect(calls.onOverview).toEqual(["id00-aaaa-bbbb-cccc-000000000000"]);
    expect(calls.onExport).toEqual(["id00-aaaa-bbbb-cccc-000000000000"]);
  });

  it("space marks and d+y deletes exactly the marked ids", async () => {
    const { calls, stdin, lastFrame } = mount(makeSessions(5));
    await delay(10);
    stdin.write(" "); await delay(5);   // mark id00
    stdin.write("[B"); await delay(5); // down to id01
    stdin.write(" "); await delay(5);   // mark id01
    stdin.write("d"); await delay(5);   // go to confirm
    expect(lastFrame() ?? "").toContain("CONFIRM DELETE");
    stdin.write("y"); await delay(5);
    expect(calls.onDelete).toHaveLength(1);
    expect(calls.onDelete[0].sort()).toEqual([
      "id00-aaaa-bbbb-cccc-000000000000",
      "id01-aaaa-bbbb-cccc-000000000000",
    ]);
  });

  it("slash enters filter mode; typed letters narrow the list and do not act", async () => {
    const { calls, stdin, lastFrame } = mount(makeSessions(40));
    await delay(10);
    stdin.write("/"); await delay(5);
    stdin.write("r"); await delay(5); // would be 'resume' in navigate mode
    expect(calls.onResume).toHaveLength(0);
    expect(lastFrame() ?? "").toContain("Filter:");
  });

  it("esc cancels", async () => {
    const { calls, stdin } = mount(makeSessions(5));
    await delay(10);
    stdin.write(""); await delay(50);
    expect(calls.onCancel).toBe(1);
  });

  it("renders an empty state with no sessions", async () => {
    const { lastFrame } = mount([]);
    await delay(10);
    expect(lastFrame() ?? "").toContain("No sessions");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tests/tui/sessionsModal.test.tsx`
Expected: FAIL — cannot find module `SessionsModal`.

- [ ] **Step 3: Implement the component**

Create `src/cli/tui/modals/SessionsModal.tsx`:

```tsx
import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "../../ink.js";
import type { CoScientistSession } from "../../../models/session.js";
import { useTerminalSize } from "../useTerminalSize.js";

interface SessionsModalProps {
  sessions: CoScientistSession[];
  activeSessionId: string | null;
  onView: (sessionId: string) => void;
  onResume: (sessionId: string) => void;
  onOverview: (sessionId: string) => void;
  onExport: (sessionId: string) => void;
  onDelete: (sessionIds: string[]) => void;
  onCancel: () => void;
}

type Stage = "browse" | "confirm";
type Mode = "navigate" | "filter";

// Rows occupied by modal chrome (title, hints, margins, footer, border).
const CHROME_ROWS = 6;
const MAX_VISIBLE = 8;
const MIN_VISIBLE = 2;

const statusGlyph = (s: string) =>
  s === "completed" ? "✓" : s === "running" ? "▶" : s === "paused" ? "⏸" : "·";

/**
 * Unified, windowed sessions picker. Navigate mode drives single-letter actions
 * (enter view, r resume, o overview, e export, space mark, d delete); `/` enters
 * filter mode where typed characters narrow the list. Windowed to a fixed height
 * so Ink does in-place updates (no flicker).
 */
export function SessionsModal({
  sessions, activeSessionId, onView, onResume, onOverview, onExport, onDelete, onCancel,
}: SessionsModalProps) {
  const { rows } = useTerminalSize();
  const [stage, setStage] = useState<Stage>("browse");
  const [mode, setMode] = useState<Mode>("navigate");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const visibleCount = Math.max(MIN_VISIBLE, Math.min(MAX_VISIBLE, rows - CHROME_ROWS));

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q),
    );
  }, [sessions, filter]);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toDelete = useMemo(
    () => sessions.filter((s) => checked.has(s.id)),
    [sessions, checked],
  );

  const sel = Math.max(0, Math.min(selected, Math.max(0, filtered.length - 1)));
  const startIndex =
    filtered.length <= visibleCount
      ? 0
      : Math.max(0, Math.min(sel - Math.floor(visibleCount / 2), filtered.length - visibleCount));
  const endIndex = Math.min(startIndex + visibleCount, filtered.length);
  const visibleItems = filtered.slice(startIndex, endIndex);
  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < filtered.length;
  const spacerCount = visibleCount - visibleItems.length;

  useInput((input, key) => {
    if (stage === "confirm") {
      if (key.return || input === "y") onDelete(toDelete.map((s) => s.id));
      else if (input === "n" || key.escape) setStage("browse");
      return;
    }

    if (mode === "filter") {
      if (key.escape) { setFilter(""); setMode("navigate"); setSelected(0); return; }
      if (key.return) { setMode("navigate"); setSelected(0); return; }
      if (key.backspace || key.delete) { setFilter((f) => f.slice(0, -1)); setSelected(0); return; }
      if (input && !key.ctrl && !key.meta && input.length === 1 && input >= " ") {
        setFilter((f) => f + input);
        setSelected(0);
      }
      return;
    }

    // navigate mode
    if (key.escape) { onCancel(); return; }
    if (key.upArrow) { setSelected((s) => Math.max(0, s - 1)); return; }
    if (key.downArrow) { setSelected((s) => Math.min(filtered.length - 1, s + 1)); return; }
    if (input === "/") { setMode("filter"); return; }

    const cur = filtered[sel];
    if (!cur) return;
    if (key.return) { onView(cur.id); return; }
    if (input === "r") { onResume(cur.id); return; }
    if (input === "o") { onOverview(cur.id); return; }
    if (input === "e") { onExport(cur.id); return; }
    if (input === " ") { toggle(cur.id); return; }
    if (input === "d" && checked.size > 0) { setStage("confirm"); return; }
  });

  // ── Confirm stage ──────────────────────────────────────────────────────
  if (stage === "confirm") {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX={1}>
        <Text color="error" bold>CONFIRM DELETE</Text>
        <Box marginTop={1} />
        <Text color="error">
          This will permanently delete {toDelete.length} session(s) and all associated
          hypotheses, reviews, matches, and data. This cannot be undone.
        </Text>
        <Box marginTop={1} />
        {toDelete.slice(0, 10).map((s) => (
          <Text key={s.id} color="text">
            ⨯ {s.name.length > 50 ? s.name.slice(0, 47) + "..." : s.name} ({s.id.slice(0, 8)}) — {s.stats?.totalHypotheses ?? 0} hypotheses
          </Text>
        ))}
        {toDelete.length > 10 && <Text dimColor>  …and {toDelete.length - 10} more</Text>}
        <Box marginTop={1} />
        <Text dimColor>[y/enter] confirm delete   [n/esc] cancel</Text>
      </Box>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────
  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        <Text color="claude" bold>SESSIONS</Text>
        <Box marginTop={1} />
        <Text dimColor>No sessions yet — type a research topic to begin.</Text>
        <Box marginTop={1} />
        <Text dimColor>[esc] close</Text>
      </Box>
    );
  }

  // ── Browse stage ───────────────────────────────────────────────────────
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
      <Text color="claude" bold>SESSIONS</Text>
      {mode === "filter"
        ? <Text dimColor>Filter: <Text color="text">{filter}</Text>▌</Text>
        : <Text dimColor>enter view · r resume · o overview · e export · space mark · / filter</Text>}
      <Box marginTop={1} />

      <Box flexDirection="column" height={visibleCount} flexShrink={0}>
        {filtered.length === 0 ? (
          <Text dimColor>No sessions match "{filter}"</Text>
        ) : (
          visibleItems.map((s, i) => {
            const globalIdx = startIndex + i;
            const isSel = globalIdx === sel;
            const chk = checked.has(s.id);
            const isEdge = !isSel && ((i === 0 && hasMoreAbove) || (i === visibleItems.length - 1 && hasMoreBelow));
            const glyph = isSel ? "❯" : isEdge ? (i === 0 ? "↑" : "↓") : " ";
            const name = s.name.length > 42 ? s.name.slice(0, 39) + "..." : s.name;
            const current = s.id === activeSessionId ? " •" : "";
            return (
              <Text key={s.id} dimColor={!isSel && !isEdge} wrap="truncate">
                {glyph} [{chk ? "*" : " "}] {statusGlyph(s.status)} {name} ({s.id.slice(0, 8)})
                {"  "}[{s.stats?.totalHypotheses ?? 0}h]{current}
              </Text>
            );
          })
        )}
        {filtered.length > 0 && spacerCount > 0 &&
          Array.from({ length: spacerCount }).map((_, i) => (
            <Text key={`sp-${i}`} dimColor> </Text>
          ))}
      </Box>

      <Box marginTop={1} />
      <Text dimColor wrap="truncate">
        {hasMoreAbove ? "▲" : " "}{hasMoreBelow ? "▼" : " "} {filtered.length === 0 ? 0 : sel + 1}/{filtered.length}
        {filter ? ` (of ${sessions.length})` : ""} · {checked.size} marked · [d] delete · [esc]
      </Text>
    </Box>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/tests/tui/sessionsModal.test.tsx`
Expected: PASS (7 tests). If the `esc` test is flaky due to Ink's escape-sequence debounce, increase its `delay(50)` to `delay(100)`.

- [ ] **Step 5: Commit**

```bash
git add src/cli/tui/modals/SessionsModal.tsx src/tests/tui/sessionsModal.test.tsx
git commit -m "feat(tui): SessionsModal windowed picker with filter and per-session actions"
```

---

### Task 3: Route `/sessions` and `/delete` to the picker; persist `/switch` output

**Files:**
- Modify: `src/cli/tui/commands/sessions.ts` (replace body)
- Modify: `src/cli/tui/commands/deleteCmd.ts`
- Modify: `src/cli/tui/commands/switch.ts`
- Modify: `src/cli/tui/CommandRouter.ts:8-20` (`ModalName` union)
- Test: `src/tests/tui/sessionsCommands.test.ts` (create)

**Interfaces:**
- Consumes: `RouteResult`, `AppContext` from `CommandRouter.js`; `ctx.memory.listSessions()`.
- Produces: `/sessions` and `/delete` return `{ type: "modal", modal: "sessions" }`; `/switch <id-or-name>` returns `{ type: "transcript", entries: [block] }` on a match.

- [ ] **Step 1: Write the failing test**

Create `src/tests/tui/sessionsCommands.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import "../../cli/tui/commands/sessions.js";
import "../../cli/tui/commands/deleteCmd.js";
import "../../cli/tui/commands/switch.js";
import { getCommand, type AppContext } from "../../cli/tui/CommandRouter.js";

const sessionsHandler = getCommand("sessions");
const deleteHandler = getCommand("delete");
const switchHandler = getCommand("switch");

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

  it("/delete opens the same sessions modal", async () => {
    const r = await deleteHandler!.execute([], ctx());
    expect(r).toEqual({ type: "modal", modal: "sessions" });
  });

  it("/switch <id> returns a persistent transcript block on match", async () => {
    const sessions = [{ id: "abcd1234-0000-0000-0000-000000000000", name: "My Session", status: "paused", stats: { totalHypotheses: 3 } }];
    const r = await switchHandler!.execute(["abcd1234"], ctx(sessions));
    expect(r.type).toBe("transcript");
    if (r.type === "transcript") {
      expect(r.entries[0].title).toContain("My Session");
      expect(r.entries[0].lines?.join("\n")).toContain("abcd1234-0000-0000-0000-000000000000");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tests/tui/sessionsCommands.test.ts`
Expected: FAIL — `/sessions` returns the old transcript dump, and the `AppContext` literal errors because `resumeSession` is not yet on the interface (added in Task 4). If TypeScript blocks the run, that is the expected failing state; proceed.

- [ ] **Step 3: Replace `sessions.ts` body**

Overwrite `src/cli/tui/commands/sessions.ts` with:

```ts
import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

/** Opens the unified, windowed sessions picker (view / resume / overview / export / delete). */
const sessionsCommand: CommandHandler = {
  name: "sessions",
  description: "Browse, resume, and manage research sessions",
  category: "System",
  async execute(_args, _ctx) {
    return { type: "modal", modal: "sessions" };
  },
};

registerCommand(sessionsCommand);
```

- [ ] **Step 4: Point `/delete` at the picker**

In `src/cli/tui/commands/deleteCmd.ts`, change the returned modal:

```ts
  async execute(_args, _ctx) {
    return { type: "modal", modal: "sessions" };
  },
```

- [ ] **Step 5: Make `/switch` output persistent**

In `src/cli/tui/commands/switch.ts`, replace the success branch (the `return { type: "immediate", ... }` block that currently fires when a `match` is found and is not running) with a transcript block. Add a module-level id counter at the top of the file (after the imports):

```ts
let _switchSeq = 0;
```

Then replace the matched-success return with:

```ts
      return {
        type: "transcript",
        entries: [{
          id: `switch_${++_switchSeq}`,
          kind: "block",
          title: `Session: ${match.name}`,
          lines: [
            match.id,
            `${match.status}  ·  ${match.stats?.totalHypotheses ?? 0} hypotheses`,
            "",
            "Resume in the TUI: open /sessions, highlight it, press r.",
            `Or from the CLI: co-scientist resume ${match.id.slice(0, 8)}`,
          ],
        }],
      };
```

Leave the `Already on this session` (`immediate`) and `running`/no-match (`error`) branches unchanged.

- [ ] **Step 6: Add `"sessions"` to `ModalName`, drop `"delete"`**

In `src/cli/tui/CommandRouter.ts`, edit the `ModalName` union (lines 8-20): add `| "sessions"` and remove the `| "delete"` line.

- [ ] **Step 7: Run the test (expect the AppContext type error to remain until Task 4)**

Run: `bun test src/tests/tui/sessionsCommands.test.ts`
Expected: The three assertions are correct, but compilation may still fail on the `resumeSession` property until Task 4 adds it to `AppContext`. If so, that is expected — do not work around it here. Commit and proceed; Task 4 makes this green.

- [ ] **Step 8: Commit**

```bash
git add src/cli/tui/commands/sessions.ts src/cli/tui/commands/deleteCmd.ts src/cli/tui/commands/switch.ts src/cli/tui/CommandRouter.ts src/tests/tui/sessionsCommands.test.ts
git commit -m "feat(tui): route /sessions and /delete to picker; persist /switch output"
```

---

### Task 4: Resume plumbing (`AppContext.resumeSession` + `onResumeSession` prop)

**Files:**
- Modify: `src/cli/tui/CommandRouter.ts` (`AppContext` interface — add `resumeSession`)
- Modify: `src/cli/tui/index.tsx` (`RenderTUIOptions` + pass-through to `App`)
- Modify: `src/cli/tui/App.tsx` (`AppProps` + `resumeSession` context method)
- Modify: `src/cli/index.ts` (`onResumeSession` implementation)
- Modify: `src/tests/tui/loginCommand.test.ts` and `src/tests/tui/CommandRouter.test.ts` (add `resumeSession` to ctx factories)

**Interfaces:**
- Consumes: `memory.resolveSession(id)`, `memory.getSession(id)`, `memory.getResearchGoal(id)`, `memory.updateSessionStatus(id, status)`, `new SupervisorAgent()`, `supervisor.setEmitter`, `supervisor.run(id)`, `getMCPManager().initialize()`.
- Produces:
  - `AppContext.resumeSession(sessionId: string): Promise<void>`
  - `RenderTUIOptions.onResumeSession(sessionId: string): Promise<SessionStartResult & { goal: string }>`
  - `AppProps.onResumeSession` (same signature).

- [ ] **Step 1: Add `resumeSession` to the `AppContext` interface**

In `src/cli/tui/CommandRouter.ts`, in the `AppContext` interface (after the `startSession` line ~31), add:

```ts
  resumeSession: (sessionId: string) => Promise<void>;
```

- [ ] **Step 2: Update the two test ctx factories so the suite compiles**

In `src/tests/tui/loginCommand.test.ts` and `src/tests/tui/CommandRouter.test.ts`, find the `ctx()` factory's `startSession: async () => {},` line and add directly below it:

```ts
    resumeSession: async () => {},
```

- [ ] **Step 3: Run the existing command tests to confirm they still pass**

Run: `bun test src/tests/tui/loginCommand.test.ts src/tests/tui/CommandRouter.test.ts src/tests/tui/sessionsCommands.test.ts`
Expected: PASS — `sessionsCommands.test.ts` (from Task 3) now compiles and goes green too.

- [ ] **Step 4: Extend `RenderTUIOptions` and pass the prop to `App`**

In `src/cli/tui/index.tsx`:

After the `onStartSession` line in `RenderTUIOptions` (line ~35), add:

```ts
  onResumeSession: (sessionId: string) => Promise<SessionStartResult & { goal: string }>;
```

In the `renderTUI` JSX, after `onStartSession={opts.onStartSession}` (line ~51), add:

```tsx
      onResumeSession={opts.onResumeSession}
```

- [ ] **Step 5: Extend `AppProps` and implement `resumeSession`**

In `src/cli/tui/App.tsx`:

In `AppProps` (after the `onStartSession` line ~74), add:

```ts
  onResumeSession: (sessionId: string) => Promise<SessionStartResult & { goal: string }>;
```

In the destructure at the top of `App` (the block that aliases `onStartSession: externalOnStartSession` ~83), add:

```ts
    onResumeSession: externalOnResumeSession,
```

In the `appContext` object, directly after the `startSession: async (...) => { ... },` method (ends ~182), add:

```ts
    resumeSession: async (id) => {
      const result = await externalOnResumeSession(id);
      setSessionId(result.sessionId);
      setGoal(result.goal);
      setSupervisor(result.supervisor);
      setEmitter(result.emitter);
      setStartTime(Date.now());
      setPaused(false);
      setCompleted(false);
      pushEntry(formatSystemNotice(`Resuming session ${result.sessionId.slice(0, 8)}…`, "info"));
    },
```

- [ ] **Step 6: Implement `onResumeSession` in `index.ts`**

In `src/cli/index.ts`, inside the `renderTUI({ ... })` options object, directly after the `onStartSession: async (...) => { ... },` block (ends ~295), add:

```ts
    onResumeSession: async (sessionId: string) => {
      const session = memory.resolveSession(sessionId) ?? memory.getSession(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);

      // Best-effort academic search init, mirroring the CLI resume path.
      await getMCPManager().initialize().catch(() => {});

      const supervisor = new SupervisorAgent();
      const emitter = new EventEmitter();
      supervisor.setEmitter(emitter);

      currentSupervisor = supervisor;
      currentSessionId = session.id;

      memory.updateSessionStatus(session.id, "running");
      supervisor.run(session.id).catch((err) => {
        if (!(err instanceof Error) || !err.message.includes("Session stopped")) {
          // Errors surface via the emitter 'error' event.
        }
      });

      const goalText = memory.getResearchGoal(session.id)?.rawGoal ?? session.name;
      return { sessionId: session.id, goal: goalText, supervisor, emitter };
    },
```

Confirm `EventEmitter`, `SupervisorAgent`, and `getMCPManager` are already in scope in this file (they are: imported around lines 203-206 / used by `onStartSession`). If `EventEmitter` is locally imported via dynamic import in the start path, reuse that same `EventEmitter` binding.

- [ ] **Step 7: Typecheck / build to verify the plumbing compiles**

Run: `bun build src/cli/index.ts --outdir /tmp/cosci-build`
Expected: Build succeeds with no type errors about `onResumeSession` or `resumeSession`.

- [ ] **Step 8: Commit**

```bash
git add src/cli/tui/CommandRouter.ts src/cli/tui/index.tsx src/cli/tui/App.tsx src/cli/index.ts src/tests/tui/loginCommand.test.ts src/tests/tui/CommandRouter.test.ts
git commit -m "feat(tui): wire resumeSession through renderTUI into the live TUI"
```

---

### Task 5: Render `SessionsModal` in `App.tsx`; remove `DeleteModal`

**Files:**
- Modify: `src/cli/tui/App.tsx` (imports; replace the `activeModal === "delete"` block; export handler targets `modalData.sessionId`)
- Remove: `src/cli/tui/modals/DeleteModal.tsx`

**Interfaces:**
- Consumes: `SessionsModal` (Task 2); `formatSessionResults` (Task 1); `formatOverview` (existing, returns `TranscriptEntry[]`); `appContext.resumeSession` (Task 4); `allSessions` (already memoized in `App.tsx`); `modalData`/`setModalData` state (already present).
- Produces: nothing downstream — final integration.

- [ ] **Step 1: Swap the imports**

In `src/cli/tui/App.tsx`:
- Remove line 23: `import { DeleteModal } from "./modals/DeleteModal.js";`
- Add (next to the other modal imports): `import { SessionsModal } from "./modals/SessionsModal.js";`
- Extend the formatters import (line 30) to include the new helper and overview:
  ```ts
  import { formatUserGoal, formatSystemNotice, formatResults, formatSessionResults, formatOverview } from "./formatters.js";
  ```

- [ ] **Step 2: Make the export handler target a picked session**

In `src/cli/tui/App.tsx`, in the `activeModal === "export"` block, change the export call so it prefers a session id passed via `modalData`:

```tsx
          onConfirm={(format, outputPath) => {
            const targetId = (modalData as { sessionId?: string } | null)?.sessionId ?? sessionId!;
            setActiveModal(null);
            setModalData(null);
            exportCommand(targetId, { format, output: outputPath }).then(() => {
              pushEntry(formatSystemNotice(`Session exported as ${format}.`, "success"));
            }).catch((err) => {
              pushEntry(formatSystemNotice(`Export failed: ${(err as Error).message}`, "error"));
            });
          }}
```

- [ ] **Step 3: Replace the delete-modal render block with the picker**

In `src/cli/tui/App.tsx`, replace the entire `{activeModal === "delete" && ( <DeleteModal ... /> )}` block with:

```tsx
      {activeModal === "sessions" && (
        <SessionsModal
          sessions={allSessions}
          activeSessionId={sessionId}
          onView={(id) => {
            pushEntry(formatSessionResults(memory, id));
            setActiveModal(null);
          }}
          onOverview={(id) => {
            for (const entry of formatOverview(memory, id)) pushEntry(entry);
            setActiveModal(null);
          }}
          onExport={(id) => {
            setModalData({ sessionId: id });
            setActiveModal("export");
          }}
          onResume={(id) => {
            const target = memory.getSession(id);
            if (!target) { setActiveModal(null); return; }
            if (id === sessionId) {
              showToastMsg("Already on this session.", "info");
              setActiveModal(null);
              return;
            }
            if (target.status === "completed") {
              showToastMsg("Session completed — press enter to view results.", "info");
              setActiveModal(null);
              return;
            }
            if (supervisor && !paused && !completed) {
              showToastMsg("Stop the current session first (/stop).", "error");
              setActiveModal(null);
              return;
            }
            setActiveModal(null);
            appContext.resumeSession(id).catch((err) => {
              pushEntry(formatSystemNotice(`Resume failed: ${(err as Error).message}`, "error"));
            });
          }}
          onDelete={(ids) => {
            const names = ids.map((id) => memory.getSession(id)?.name ?? id.slice(0, 8));
            for (const id of ids) memory.deleteSession(id);
            pushEntry({
              id: uuidv4(),
              kind: "block",
              title: `Deleted ${ids.length} session(s)`,
              lines: names.map((n) => `  ⨯ ${n}`),
              color: "error",
            });
            setActiveModal(null);
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}
```

Notes for the implementer:
- `showToastMsg` is the local toast helper. Verify the exact name in `App.tsx` — the `appContext.showToast` method wraps `setToastMsg/setToastType/setToastVisible`. Use `appContext.showToast(msg, type)` if no standalone `showToastMsg` exists. Pick whichever is already defined in this file and use it consistently.
- `completed` is the local state variable already used by `<Footer>` and `stopSession`; confirm it is in scope (it is destructured/declared near the other session state).

- [ ] **Step 4: Delete the now-unused `DeleteModal`**

```bash
git rm src/cli/tui/modals/DeleteModal.tsx
```

- [ ] **Step 5: Build and run the full test suite**

Run: `bun build src/cli/index.ts --outdir /tmp/cosci-build && bun test`
Expected: Build succeeds; all tests pass (including Task 1-3 suites). No reference to `DeleteModal` remains:

Run: `grep -rn "DeleteModal" src/`
Expected: no output.

- [ ] **Step 6: Manual smoke check**

Run: `bun run src/cli/index.ts` then, in the TUI:
- `/sessions` → picker opens windowed; `↑/↓` navigate; `/` then type to filter; `enter` pushes a results block with full id; `o` pushes overview; `e` opens export scoped to the highlighted session; `space`+`d`+`y` deletes; `r` on a paused session resumes it live (LiveStatus shows it running); `esc` closes.
- `/delete` → opens the same picker.
- `/switch <id>` → details persist as a block (do not vanish).

- [ ] **Step 7: Commit**

```bash
git add src/cli/tui/App.tsx
git commit -m "feat(tui): render SessionsModal for /sessions and /delete; remove DeleteModal"
```

---

## Self-Review Notes

- **Spec coverage:** windowed picker (Task 2) · `/sessions`+`/delete` unified (Task 3, 5) · filter-as-you-type (Task 2) · view w/ full id (Task 1, 5) · resume into live TUI (Task 4, 5) · overview (Task 5) · export scoped to picked session (Task 5) · delete multi-select (Task 2, 5) · persistent `/switch` (Task 3) · `formatSessionResults` (Task 1) · `DeleteModal` removed (Task 5). All covered.
- **Cross-task type consistency:** `resumeSession(id): Promise<void>` (AppContext) vs `onResumeSession(id): Promise<SessionStartResult & { goal: string }>` (renderTUI/App) — distinct on purpose: the context method wraps the prop. `formatSessionResults` returns one `TranscriptEntry`; `formatOverview` returns `TranscriptEntry[]` (iterated). `SessionsModal` callbacks all take a single `sessionId: string` except `onDelete(ids: string[])`.
- **Known fragility:** the `esc` test depends on Ink's escape-sequence debounce; bump its delay if flaky. Task 3's test stays red until Task 4 adds `resumeSession` to `AppContext` — sequencing is intentional and documented.
