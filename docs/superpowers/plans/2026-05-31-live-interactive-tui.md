# Live Interactive TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live, keyboard-steerable Ink terminal UI to `co-scientist run` that shows a real-time leaderboard, status header, and activity ticker, and lets the operator kill, boost, or inject hypotheses and pause/resume the session.

**Architecture:** A new `src/cli/tui/` directory holds Ink+React components plus a pure `actions.ts` for the three DB mutations. The supervisor gains additive `pause()`/`resume()`/`isPaused()`. `run.ts` branches to the TUI when `options.tui` is true and `stdout` is a TTY, otherwise keeps the existing plain renderer. Steering writes directly to `ContextStore`; the supervisor re-reads DB state every loop iteration, so changes propagate with no two-way protocol.

**Tech Stack:** Bun, TypeScript, Ink 5, React 18, Drizzle/`bun:sqlite`, `bun:test`. (`ink`, `ink-spinner`, `react` are already in `package.json`; `tsconfig.json` already sets `"jsx": "react-jsx"`.)

**Spec:** `docs/superpowers/specs/2026-05-31-live-interactive-tui-design.md`

---

## File Structure

- `src/cli/tui/actions.ts` — pure steering functions over `ContextStore` (`killHypothesis`, `boostHypothesis`, `injectHypothesis`). Testable without rendering.
- `src/cli/tui/useSessionData.ts` — React hook: subscribes to supervisor events + polls `getTopHypotheses`, returns `{ stats, leaderboard, ticker, now }`.
- `src/cli/tui/Header.tsx` — status bar (session, goal, elapsed, token gauge, counts, avg Elo, paused indicator).
- `src/cli/tui/Leaderboard.tsx` — selectable hypothesis list.
- `src/cli/tui/Ticker.tsx` — one-line activity feed.
- `src/cli/tui/Footer.tsx` — hotkey hints.
- `src/cli/tui/modals/KillModal.tsx` — confirm rejection.
- `src/cli/tui/modals/BoostModal.tsx` — numeric Elo entry.
- `src/cli/tui/modals/InjectModal.tsx` — title + content text entry.
- `src/cli/tui/App.tsx` — root state + keyboard routing.
- `src/cli/tui/index.tsx` — `renderTUI()` entry point.
- `src/agents/supervisor.ts` — add `pause()`/`resume()`/`isPaused()` + loop idle guard (modify).
- `src/cli/commands/run.ts` — branch to TUI vs plain renderer (modify).
- `src/tests/tui-actions.test.ts` — tests for `actions.ts`.
- `src/tests/supervisor-pause.test.ts` — tests for pause/resume.

---

## Task 1: Steering actions module

**Files:**
- Create: `src/cli/tui/actions.ts`
- Test: `src/tests/tui-actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tests/tui-actions.test.ts`:

```ts
/**
 * TUI steering actions — unit tests against a real (temp) SQLite database.
 * No LLM calls. Mirrors the DB-isolation pattern used in knowledgeGraph.test.ts.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";

const TEST_DIR = join(tmpdir(), `tui-actions-test-${Date.now()}`);
mkdirSync(TEST_DIR, { recursive: true });
process.env.DB_PATH = join(TEST_DIR, "test.db");
process.env.DEEPSEEK_API_KEY = "stub-for-tests";

import { resetDb } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { getContextStore, resetContextStore } from "../memory/contextStore.js";
import { resetConfig } from "../config.js";
import { killHypothesis, boostHypothesis, injectHypothesis } from "../cli/tui/actions.js";
import type { ContextStore } from "../memory/contextStore.js";

let store: ContextStore;
let sessionId: string;

function seedHypothesis(elo = 1200): string {
  const hyp = store.saveHypothesis({
    sessionId,
    title: "Seed hypothesis",
    summary: "seed",
    content: "seed content",
    rationale: "seed rationale",
    keyAssumptions: [],
    citations: [],
    generationStrategy: "test",
    eloRating: elo,
    ratingDeviation: 350,
    volatility: 0.06,
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    status: "active",
    parentIds: [],
    generationRound: 1,
  });
  return hyp.id;
}

beforeAll(async () => {
  resetConfig();
  resetDb();
  resetContextStore();
  store = getContextStore();
  await runMigrations();
  sessionId = uuidv4();
  store["sqlite"].run(
    `INSERT INTO sessions (id,name,status,research_goal_json,stats_json,created_at,updated_at)
     VALUES ('${sessionId}','TUI Test','running','{}','{}',1,1)`
  );
});

describe("killHypothesis", () => {
  it("sets the hypothesis status to rejected", () => {
    const id = seedHypothesis();
    killHypothesis(store, id);
    expect(store.getHypothesis(id)?.status).toBe("rejected");
  });
});

describe("boostHypothesis", () => {
  it("sets the Elo to the requested absolute value", () => {
    const id = seedHypothesis(1200);
    boostHypothesis(store, id, 1500);
    expect(Math.round(store.getHypothesis(id)!.eloRating)).toBe(1500);
  });
});

describe("injectHypothesis", () => {
  it("inserts a pending_review hypothesis with seed Elo", () => {
    const created = injectHypothesis(store, {
      sessionId,
      title: "Operator idea",
      summary: "",
      content: "A bold manual hypothesis",
      generationRound: 7,
    });
    const fetched = store.getHypothesis(created.id)!;
    expect(fetched.status).toBe("pending_review");
    expect(fetched.eloRating).toBe(1200);
    expect(fetched.generationStrategy).toBe("manual_injection");
    expect(fetched.summary).toBe("Operator idea"); // empty summary falls back to title
  });

  it("rejects empty title or content", () => {
    expect(() =>
      injectHypothesis(store, { sessionId, title: "  ", summary: "", content: "x", generationRound: 1 })
    ).toThrow();
    expect(() =>
      injectHypothesis(store, { sessionId, title: "x", summary: "", content: "  ", generationRound: 1 })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tests/tui-actions.test.ts`
Expected: FAIL — `Cannot find module '../cli/tui/actions.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/cli/tui/actions.ts`:

```ts
import type { ContextStore } from "../../memory/contextStore.js";
import type { Hypothesis } from "../../models/hypothesis.js";

/** Reject a hypothesis so the supervisor stops scheduling work on it. */
export function killHypothesis(memory: ContextStore, hypothesisId: string): void {
  memory.updateHypothesisStatus(hypothesisId, "rejected");
}

/**
 * Set a hypothesis's Elo to an absolute value using the atomic Glicko-2 path,
 * so a concurrent tournament write cannot clobber it.
 */
export function boostHypothesis(memory: ContextStore, hypothesisId: string, newElo: number): void {
  memory.atomicGlicko2Update(hypothesisId, (c) => ({ ...c, rating: newElo }));
}

export interface InjectInput {
  sessionId: string;
  title: string;
  summary: string;
  content: string;
  generationRound: number;
}

/**
 * Insert a human-authored hypothesis as `pending_review` so it goes through the
 * normal reflection + provenance pipeline before competing.
 */
export function injectHypothesis(memory: ContextStore, input: InjectInput): Hypothesis {
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title || !content) {
    throw new Error("Injected hypothesis requires a non-empty title and content");
  }
  return memory.saveHypothesis({
    sessionId: input.sessionId,
    title,
    summary: input.summary.trim() || title,
    content,
    rationale: "Manually injected by operator during run.",
    keyAssumptions: [],
    citations: [],
    generationStrategy: "manual_injection",
    eloRating: 1200,
    ratingDeviation: 350,
    volatility: 0.06,
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    status: "pending_review",
    parentIds: [],
    generationRound: input.generationRound,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/tests/tui-actions.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/tui/actions.ts src/tests/tui-actions.test.ts
git commit -m "feat(tui): pure steering actions (kill/boost/inject)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Supervisor pause/resume

**Files:**
- Modify: `src/agents/supervisor.ts`
- Test: `src/tests/supervisor-pause.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tests/supervisor-pause.test.ts`:

```ts
/**
 * Supervisor pause/resume — verifies the additive pause flag and queue control
 * without running the full LLM orchestration loop.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DIR = join(tmpdir(), `supervisor-pause-test-${Date.now()}`);
mkdirSync(TEST_DIR, { recursive: true });
process.env.DB_PATH = join(TEST_DIR, "test.db");
process.env.DEEPSEEK_API_KEY = "stub-for-tests";

import { resetConfig } from "../config.js";
import { SupervisorAgent } from "../agents/supervisor.js";

let supervisor: SupervisorAgent;

beforeAll(() => {
  resetConfig();
  supervisor = new SupervisorAgent();
});

describe("SupervisorAgent pause/resume", () => {
  it("starts unpaused", () => {
    expect(supervisor.isPaused()).toBe(false);
  });

  it("reports paused after pause()", () => {
    supervisor.pause();
    expect(supervisor.isPaused()).toBe(true);
  });

  it("reports unpaused after resume()", () => {
    supervisor.resume();
    expect(supervisor.isPaused()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tests/supervisor-pause.test.ts`
Expected: FAIL — `supervisor.isPaused is not a function`.

- [ ] **Step 3: Add the paused field**

In `src/agents/supervisor.ts`, find the existing private field declarations (around the `private pendingGeneration = 0;` line near the top of the class) and add directly after it:

```ts
  private paused = false;
```

- [ ] **Step 4: Add the pause/resume/isPaused methods**

In `src/agents/supervisor.ts`, find the existing `stop()` method:

```ts
  stop(): void {
    this.running = false;
    this.queue.pause();
  }
```

Add these three methods immediately after it:

```ts
  /** Pause the orchestration loop and stop scheduling new task execution. */
  pause(): void {
    this.paused = true;
    this.queue.pause();
    this.log("info", "Session paused by operator");
  }

  /** Resume a paused orchestration loop. */
  resume(): void {
    this.paused = false;
    this.queue.resume();
    this.log("info", "Session resumed by operator");
  }

  isPaused(): boolean {
    return this.paused;
  }
```

- [ ] **Step 5: Add the loop idle guard**

In `src/agents/supervisor.ts`, inside `run()`, find the start of the while-loop body:

```ts
    while (this.running && round < maxRounds) {
      // Block until at least one worker slot is free, so we don't spiral ahead
      // of actual LLM execution. This makes the round counter meaningful.
      while (this.queue.running >= this.config.compute.maxWorkers) {
        await sleep(200);
      }
```

Insert the pause guard as the very first statement inside the while-loop, before the worker-slot wait:

```ts
    while (this.running && round < maxRounds) {
      // Idle here while paused so no new rounds advance until resume().
      while (this.paused && this.running) {
        await sleep(200);
      }
      // Block until at least one worker slot is free, so we don't spiral ahead
      // of actual LLM execution. This makes the round counter meaningful.
      while (this.queue.running >= this.config.compute.maxWorkers) {
        await sleep(200);
      }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test src/tests/supervisor-pause.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 7: Run the full suite to confirm no regression**

Run: `bun test`
Expected: PASS — all pre-existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/agents/supervisor.ts src/tests/supervisor-pause.test.ts
git commit -m "feat(supervisor): add pause/resume/isPaused with loop idle guard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Session data hook + presentational components

**Files:**
- Create: `src/cli/tui/useSessionData.ts`
- Create: `src/cli/tui/Header.tsx`
- Create: `src/cli/tui/Leaderboard.tsx`
- Create: `src/cli/tui/Ticker.tsx`
- Create: `src/cli/tui/Footer.tsx`

No automated tests for these (Ink rendering is verified manually per the spec). They are wired and verified end-to-end in Task 6.

- [ ] **Step 1: Create the data hook**

Create `src/cli/tui/useSessionData.ts`:

```ts
import { useEffect, useState } from "react";
import type { EventEmitter } from "events";
import type { ContextStore } from "../../memory/contextStore.js";
import type { Hypothesis } from "../../models/hypothesis.js";
import type { SessionStats } from "../../models/session.js";

export type ProgressStats = SessionStats & { activity: string };

export interface SessionData {
  stats: ProgressStats | null;
  leaderboard: Hypothesis[];
  ticker: string[];
  now: number;
}

const MAX_TICKER = 6;

/**
 * Subscribes to supervisor events and polls the leaderboard from SQLite once a
 * second (and on every event). Returns render-ready state. All reads are local
 * synchronous SQLite calls, so polling is cheap.
 */
export function useSessionData(
  emitter: EventEmitter,
  memory: ContextStore,
  sessionId: string
): SessionData {
  const [stats, setStats] = useState<ProgressStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<Hypothesis[]>([]);
  const [ticker, setTicker] = useState<string[]>([]);
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    const refresh = () => {
      setLeaderboard(memory.getTopHypotheses(sessionId, 12));
      setNow(Date.now());
    };
    const push = (line: string) =>
      setTicker((prev) => [...prev, line].slice(-MAX_TICKER));

    const onProgress = (s: ProgressStats) => {
      setStats(s);
      if (s.activity) push(s.activity);
    };
    const onHyp = (count: number) => {
      refresh();
      push(`+ hypothesis #${count} added`);
    };
    const onMatch = (round: number) => {
      refresh();
      push(`tournament round ${round} complete`);
    };

    refresh();
    emitter.on("progress", onProgress);
    emitter.on("hypothesis_added", onHyp);
    emitter.on("match_completed", onMatch);
    const interval = setInterval(refresh, 1000);

    return () => {
      emitter.off("progress", onProgress);
      emitter.off("hypothesis_added", onHyp);
      emitter.off("match_completed", onMatch);
      clearInterval(interval);
    };
  }, [emitter, memory, sessionId]);

  return { stats, leaderboard, ticker, now };
}
```

- [ ] **Step 2: Create the Header component**

Create `src/cli/tui/Header.tsx`:

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { ProgressStats } from "./useSessionData.js";

interface HeaderProps {
  sessionId: string;
  goal: string;
  stats: ProgressStats | null;
  startTime: number;
  now: number;
  budgetTokens: number;
  paused: boolean;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function gauge(pct: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return "▓".repeat(filled) + "░".repeat(width - filled);
}

export function Header({ sessionId, goal, stats, startTime, now, budgetTokens, paused }: HeaderProps) {
  const elapsed = Math.round((now - startTime) / 1000);
  const timeStr = `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  const tokens = stats?.tokensUsed ?? 0;
  const pct = budgetTokens > 0 ? Math.round((tokens / budgetTokens) * 100) : 0;
  const hyp = stats?.totalHypotheses ?? 0;
  const avgElo = Math.round(stats?.avgTopTenElo ?? 1200);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between">
        <Text color="cyan" bold>co-scientist</Text>
        <Text color="gray">sess:{sessionId.slice(0, 8)}</Text>
        <Text color={paused ? "yellow" : "green"}>{paused ? "PAUSED" : "running"}</Text>
        <Text color="gray">{timeStr}</Text>
      </Box>
      <Text color="white">Goal: {goal.length > 70 ? goal.slice(0, 67) + "..." : goal}</Text>
      <Box>
        <Text color="gray">
          Tokens {gauge(pct)} {formatTokens(tokens)}
          {budgetTokens > 0 ? `/${formatTokens(budgetTokens)} (${pct}%)` : ""}
        </Text>
        <Text>{"   "}</Text>
        <Text color="yellow">Hyp:{hyp}</Text>
        <Text>{"  "}</Text>
        <Text color="blue">AvgElo:{avgElo}</Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 3: Create the Leaderboard component**

Create `src/cli/tui/Leaderboard.tsx`:

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { Hypothesis } from "../../models/hypothesis.js";

interface LeaderboardProps {
  hypotheses: Hypothesis[];
  selectedIndex: number;
}

function statusGlyph(status: string): string {
  switch (status) {
    case "active": return "✓";        // check
    case "pending_review":
    case "reviewing": return "⧖";      // hourglass-ish
    case "rejected": return "✗";       // cross
    case "evolved": return "✨";        // sparkle
    default: return "·";
  }
}

export function Leaderboard({ hypotheses, selectedIndex }: LeaderboardProps) {
  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="cyan" bold>{"  #  Elo   Hypothesis"}</Text>
      {hypotheses.length === 0 ? (
        <Text color="gray">  (no hypotheses yet)</Text>
      ) : (
        hypotheses.map((h, i) => {
          const selected = i === selectedIndex;
          const title = h.title.length > 48 ? h.title.slice(0, 45) + "..." : h.title;
          return (
            <Text key={h.id} color={selected ? "black" : "white"} backgroundColor={selected ? "cyan" : undefined}>
              {selected ? "▶" : " "} {String(i + 1).padStart(2)} {String(Math.round(h.eloRating)).padStart(4)}  {statusGlyph(h.status)} {title}
            </Text>
          );
        })
      )}
    </Box>
  );
}
```

- [ ] **Step 4: Create the Ticker component**

Create `src/cli/tui/Ticker.tsx`:

```tsx
import React from "react";
import { Box, Text } from "ink";

interface TickerProps {
  lines: string[];
}

export function Ticker({ lines }: TickerProps) {
  const latest = lines.length > 0 ? lines[lines.length - 1] : "starting...";
  return (
    <Box paddingX={1}>
      <Text color="gray">ticker: </Text>
      <Text color="magenta">{latest}</Text>
    </Box>
  );
}
```

- [ ] **Step 5: Create the Footer component**

Create `src/cli/tui/Footer.tsx`:

```tsx
import React from "react";
import { Box, Text } from "ink";

export function Footer({ paused }: { paused: boolean }) {
  return (
    <Box paddingX={1}>
      <Text color="gray">
        {"↑↓ select   "}
        <Text color="white">[k]</Text>ill   <Text color="white">[b]</Text>oost   <Text color="white">[i]</Text>nject   <Text color="white">[p]</Text>{paused ? "resume" : "pause"}   <Text color="white">[q]</Text>uit
      </Text>
    </Box>
  );
}
```

- [ ] **Step 6: Type-check**

Run: `bunx tsc --noEmit`
Expected: No errors from the new files. (Pre-existing project errors, if any, are out of scope — confirm no *new* errors reference `src/cli/tui/`.)

- [ ] **Step 7: Commit**

```bash
git add src/cli/tui/useSessionData.ts src/cli/tui/Header.tsx src/cli/tui/Leaderboard.tsx src/cli/tui/Ticker.tsx src/cli/tui/Footer.tsx
git commit -m "feat(tui): session data hook and presentational components

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Modals

**Files:**
- Create: `src/cli/tui/modals/KillModal.tsx`
- Create: `src/cli/tui/modals/BoostModal.tsx`
- Create: `src/cli/tui/modals/InjectModal.tsx`

Each modal owns its own `useInput` handler, activated only while it is mounted. They are mounted conditionally by `App` (Task 5), so only one is ever active at a time.

- [ ] **Step 1: Create the KillModal**

Create `src/cli/tui/modals/KillModal.tsx`:

```tsx
import React from "react";
import { Box, Text, useInput } from "ink";

interface KillModalProps {
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function KillModal({ title, onConfirm, onCancel }: KillModalProps) {
  useInput((input, key) => {
    if (key.escape || input === "n") onCancel();
    else if (key.return || input === "y") onConfirm();
  });

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="red" paddingX={1}>
      <Text color="red" bold>KILL HYPOTHESIS</Text>
      <Text color="white">{title.length > 50 ? title.slice(0, 47) + "..." : title}</Text>
      <Text color="gray">Reject this hypothesis? [y] confirm   [esc/n] cancel</Text>
    </Box>
  );
}
```

- [ ] **Step 2: Create the BoostModal**

Create `src/cli/tui/modals/BoostModal.tsx`:

```tsx
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface BoostModalProps {
  title: string;
  currentElo: number;
  onConfirm: (newElo: number) => void;
  onCancel: () => void;
}

export function BoostModal({ title, currentElo, onConfirm, onCancel }: BoostModalProps) {
  const [value, setValue] = useState<string>(String(Math.round(currentElo) + 100));

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
    } else if (key.return) {
      const parsed = parseInt(value, 10);
      if (!Number.isNaN(parsed)) onConfirm(parsed);
    } else if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
    } else if (/^[0-9]$/.test(input)) {
      setValue((v) => (v.length < 5 ? v + input : v));
    }
  });

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>BOOST HYPOTHESIS</Text>
      <Text color="white">{title.length > 50 ? title.slice(0, 47) + "..." : title}</Text>
      <Text color="gray">
        New Elo: [{Math.round(currentElo)}] {"→"} <Text color="white">{value || "_"}</Text>
      </Text>
      <Text color="gray">[enter] confirm   [esc] cancel</Text>
    </Box>
  );
}
```

- [ ] **Step 3: Create the InjectModal**

Create `src/cli/tui/modals/InjectModal.tsx`:

```tsx
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface InjectModalProps {
  onConfirm: (title: string, content: string) => void;
  onCancel: () => void;
}

type Field = "title" | "content";

/**
 * Minimal two-field text entry built on useInput (avoids adding an external
 * text-input dependency). Tab/Enter moves title -> content; Enter on content
 * submits if both fields are non-empty.
 */
export function InjectModal({ onConfirm, onCancel }: InjectModalProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [field, setField] = useState<Field>("title");

  const setActive = (fn: (s: string) => string) => {
    if (field === "title") setTitle(fn);
    else setContent(fn);
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.tab) {
      setField(field === "title" ? "content" : "title");
      return;
    }
    if (key.return) {
      if (field === "title") {
        setField("content");
      } else if (title.trim() && content.trim()) {
        onConfirm(title.trim(), content.trim());
      }
      return;
    }
    if (key.backspace || key.delete) {
      setActive((v) => v.slice(0, -1));
      return;
    }
    // Append printable characters only (ignore control keys / arrows).
    if (input && !key.ctrl && !key.meta && input.length === 1 && input >= " ") {
      setActive((v) => v + input);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="green" paddingX={1}>
      <Text color="green" bold>INJECT HYPOTHESIS</Text>
      <Text color={field === "title" ? "white" : "gray"}>
        {field === "title" ? "▶" : " "} Title:   {title || "_"}
      </Text>
      <Text color={field === "content" ? "white" : "gray"}>
        {field === "content" ? "▶" : " "} Content: {content || "_"}
      </Text>
      <Text color="gray">[tab] switch field   [enter] next/submit   [esc] cancel</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `bunx tsc --noEmit`
Expected: No new errors referencing `src/cli/tui/modals/`.

- [ ] **Step 5: Commit**

```bash
git add src/cli/tui/modals/
git commit -m "feat(tui): kill/boost/inject modal components

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: App root + renderTUI entry point

**Files:**
- Create: `src/cli/tui/App.tsx`
- Create: `src/cli/tui/index.tsx`

- [ ] **Step 1: Create the App component**

Create `src/cli/tui/App.tsx`:

```tsx
import React, { useState } from "react";
import { Box, useApp, useInput } from "ink";
import type { EventEmitter } from "events";
import type { ContextStore } from "../../memory/contextStore.js";
import { useSessionData } from "./useSessionData.js";
import { Header } from "./Header.js";
import { Leaderboard } from "./Leaderboard.js";
import { Ticker } from "./Ticker.js";
import { Footer } from "./Footer.js";
import { KillModal } from "./modals/KillModal.js";
import { BoostModal } from "./modals/BoostModal.js";
import { InjectModal } from "./modals/InjectModal.js";
import { killHypothesis, boostHypothesis, injectHypothesis } from "./actions.js";

export interface AppProps {
  emitter: EventEmitter;
  memory: ContextStore;
  sessionId: string;
  goal: string;
  startTime: number;
  budgetTokens: number;
  onTogglePause: () => boolean; // returns the new paused state
  onQuit: () => void;
}

type Mode = "browse" | "kill" | "boost" | "inject";

export function App(props: AppProps) {
  const { emitter, memory, sessionId, goal, startTime, budgetTokens } = props;
  const { stats, leaderboard, ticker, now } = useSessionData(emitter, memory, sessionId);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<Mode>("browse");
  const [paused, setPaused] = useState(false);
  const { exit } = useApp();

  const selectedHyp = leaderboard[selected];
  const currentRound = stats?.currentRound ?? 0;

  // Main browse-mode keyboard handler — disabled while a modal is open.
  useInput(
    (input, key) => {
      if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
      else if (key.downArrow) setSelected((s) => Math.min(leaderboard.length - 1, s + 1));
      else if (input === "k" && selectedHyp) setMode("kill");
      else if (input === "b" && selectedHyp) setMode("boost");
      else if (input === "i") setMode("inject");
      else if (input === "p") setPaused(props.onTogglePause());
      else if (input === "q") {
        props.onQuit();
        exit();
      }
    },
    { isActive: mode === "browse" }
  );

  return (
    <Box flexDirection="column">
      <Header
        sessionId={sessionId}
        goal={goal}
        stats={stats}
        startTime={startTime}
        now={now}
        budgetTokens={budgetTokens}
        paused={paused}
      />
      <Leaderboard hypotheses={leaderboard} selectedIndex={selected} />
      <Ticker lines={ticker} />

      {mode === "kill" && selectedHyp && (
        <KillModal
          title={selectedHyp.title}
          onConfirm={() => {
            killHypothesis(memory, selectedHyp.id);
            setMode("browse");
          }}
          onCancel={() => setMode("browse")}
        />
      )}
      {mode === "boost" && selectedHyp && (
        <BoostModal
          title={selectedHyp.title}
          currentElo={selectedHyp.eloRating}
          onConfirm={(newElo) => {
            boostHypothesis(memory, selectedHyp.id, newElo);
            setMode("browse");
          }}
          onCancel={() => setMode("browse")}
        />
      )}
      {mode === "inject" && (
        <InjectModal
          onConfirm={(title, content) => {
            injectHypothesis(memory, { sessionId, title, summary: "", content, generationRound: currentRound });
            setMode("browse");
          }}
          onCancel={() => setMode("browse")}
        />
      )}

      <Footer paused={paused} />
    </Box>
  );
}
```

- [ ] **Step 2: Create the renderTUI entry point**

Create `src/cli/tui/index.tsx`:

```tsx
import React from "react";
import { render } from "ink";
import type { EventEmitter } from "events";
import type { ContextStore } from "../../memory/contextStore.js";
import { App } from "./App.js";

export interface RenderTUIOptions {
  emitter: EventEmitter;
  memory: ContextStore;
  sessionId: string;
  goal: string;
  startTime: number;
  budgetTokens: number;
  onTogglePause: () => boolean;
  onQuit: () => void;
}

export function renderTUI(opts: RenderTUIOptions): { unmount: () => void; waitUntilExit: () => Promise<void> } {
  const instance = render(
    <App
      emitter={opts.emitter}
      memory={opts.memory}
      sessionId={opts.sessionId}
      goal={opts.goal}
      startTime={opts.startTime}
      budgetTokens={opts.budgetTokens}
      onTogglePause={opts.onTogglePause}
      onQuit={opts.onQuit}
    />
  );
  return {
    unmount: () => instance.unmount(),
    waitUntilExit: () => instance.waitUntilExit(),
  };
}
```

- [ ] **Step 3: Type-check**

Run: `bunx tsc --noEmit`
Expected: No new errors referencing `src/cli/tui/`.

- [ ] **Step 4: Commit**

```bash
git add src/cli/tui/App.tsx src/cli/tui/index.tsx
git commit -m "feat(tui): App root with keyboard routing and renderTUI entry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Wire the TUI into the run command

**Files:**
- Modify: `src/cli/commands/run.ts`

The current `run.ts` always attaches chalk/ora event handlers and prints a single-line progress bar. We branch: when `options.tui !== false` AND `process.stdout.isTTY`, render the TUI instead; otherwise keep the existing handlers untouched.

- [ ] **Step 1: Import renderTUI and getConfig usage**

In `src/cli/commands/run.ts`, find the import block (lines 1-14) and add after the existing imports:

```ts
import { renderTUI } from "../tui/index.js";
```

- [ ] **Step 2: Branch the progress display**

In `src/cli/commands/run.ts`, locate the block that begins with `// Set up progress display` (around line 122) and ends just before `// Handle graceful shutdown` (around line 156). This is the block that declares `startTime`, `lastActivity`, `lastStats`, and the four `emitter.on(...)` handlers plus `printProgress`.

Replace that entire block with:

```ts
  // Set up progress display
  const startTime = Date.now();
  const budgetTokens = getConfig().compute.budgetTokens;
  const useTui = options.tui !== false && Boolean(process.stdout.isTTY);

  let tui: { unmount: () => void; waitUntilExit: () => Promise<void> } | null = null;
  let lastActivity = "Initializing...";
  let lastStats: (SessionStats & { activity: string }) | null = null;

  if (useTui) {
    tui = renderTUI({
      emitter,
      memory: getContextStore(),
      sessionId,
      goal: rawGoal.trim(),
      startTime,
      budgetTokens,
      onTogglePause: () => {
        if (supervisor.isPaused()) {
          supervisor.resume();
          return false;
        }
        supervisor.pause();
        return true;
      },
      onQuit: () => {
        supervisor.stop();
        getContextStore().updateSessionStatus(sessionId, "paused");
      },
    });
  } else {
    emitter.on("progress", (stats: SessionStats & { activity: string }) => {
      lastStats = stats;
      lastActivity = stats.activity;
      printProgress(stats, startTime);
    });

    emitter.on("hypothesis_added", (count: number) => {
      if (lastStats) {
        lastStats = { ...lastStats, totalHypotheses: count };
        printProgress(lastStats, startTime);
      }
      console.log(chalk.green(`\n  ✓ Hypotheses: ${count}`));
    });

    emitter.on("match_completed", (round: number) => {
      console.log(chalk.blue(`  ⚔  Tournament round ${round} complete`));
    });

    emitter.on("completed", (overview: string) => {
      console.log(chalk.bold.green("\n✅ Session completed!\n"));
      if (overview) {
        console.log(chalk.cyan("📄 Research Overview Preview:"));
        console.log(overview.slice(0, 500) + (overview.length > 500 ? "\n..." : ""));
      }
    });

    emitter.on("error", (err: Error) => {
      console.error(chalk.red(`\n❌ Error: ${err.message}`));
    });
  }
```

Note: `lastActivity` is retained only for parity with the original file; it is unused by the TUI branch. If the project's lint config flags unused vars and the build fails on it, prefix with `void lastActivity;` after the block. (Confirm in Step 6 whether this is necessary.)

- [ ] **Step 3: Unmount the TUI after the run resolves**

In `src/cli/commands/run.ts`, find the block that runs the orchestration loop:

```ts
  // Run the main orchestration loop
  try {
    await supervisor.run(sessionId);
  } catch (err) {
    console.error(chalk.red(`\n❌ Session error: ${(err as Error).message}`));
    const memory = getContextStore();
    memory.updateSessionStatus(sessionId, "error");
    process.exit(1);
  }
```

Replace it with (adds TUI unmount in both the success and error paths):

```ts
  // Run the main orchestration loop
  try {
    await supervisor.run(sessionId);
    if (tui) tui.unmount();
  } catch (err) {
    if (tui) tui.unmount();
    console.error(chalk.red(`\n❌ Session error: ${(err as Error).message}`));
    const memory = getContextStore();
    memory.updateSessionStatus(sessionId, "error");
    process.exit(1);
  }
```

- [ ] **Step 4: Update the SIGINT handler to unmount the TUI**

In `src/cli/commands/run.ts`, find the SIGINT handler:

```ts
  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log(chalk.yellow("\n\n⏸  Pausing session... (data saved to SQLite)"));
    supervisor.stop();
```

Insert a TUI unmount as the first statement inside the handler:

```ts
  // Handle graceful shutdown
  process.on("SIGINT", () => {
    if (tui) tui.unmount();
    console.log(chalk.yellow("\n\n⏸  Pausing session... (data saved to SQLite)"));
    supervisor.stop();
```

- [ ] **Step 5: Run the full test suite**

Run: `bun test`
Expected: PASS — all tests still pass (this task changes only the CLI wiring, no tested logic).

- [ ] **Step 6: Type-check the whole project**

Run: `bunx tsc --noEmit`
Expected: No errors. If an unused-variable error fires for `lastActivity`, apply the `void lastActivity;` note from Step 2 and re-run.

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/run.ts
git commit -m "feat(run): render interactive TUI by default on a TTY (--no-tui to disable)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Launch a short TUI session**

Run (uses real API keys from `.env`; keep it tiny):

```bash
bun run src/cli/index.ts run --goal "Test goal: novel mechanisms of cellular senescence" --max-hypotheses 3 --budget 60000
```

Expected: The banner prints, then the Ink TUI takes over showing the bordered Header, Leaderboard, Ticker, and Footer. Hypotheses appear in the leaderboard within a minute.

- [ ] **Step 2: Exercise each control**

Verify by direct interaction:
- `↑`/`↓` move the `▶` selection in the leaderboard.
- `b` opens the yellow BOOST modal; type a number, press Enter; the selected row's Elo jumps to that value within ~1s.
- `k` opens the red KILL modal; press `y`; the row's status glyph changes to `✗` (rejected) and it drops out of the top list shortly after.
- `i` opens the green INJECT modal; type a title, Enter, type content, Enter; a new row appears with the hourglass (pending_review) glyph within ~1s.
- `p` toggles the header between `running` and `PAUSED`; while paused the ticker stops advancing.
- `q` exits the TUI and prints the resume hint.

- [ ] **Step 3: Verify the non-TTY fallback**

Run:

```bash
bun run src/cli/index.ts run --goal "Fallback check" --max-hypotheses 2 --budget 40000 | cat
```

Expected: No Ink UI; the plain single-line `⚡ ... Hyp:N Rating:N Tok:Nk` progress output is used instead (piping makes `stdout.isTTY` falsy).

- [ ] **Step 4: Verify --no-tui fallback on a TTY**

Run:

```bash
bun run src/cli/index.ts run --no-tui --goal "Explicit no-tui" --max-hypotheses 2 --budget 40000
```

Expected: Plain progress output even though stdout is a TTY.

- [ ] **Step 5: Confirm the data persisted**

After any of the runs above, run:

```bash
bun run src/cli/index.ts list
```

Find the session id, then:

```bash
bun run src/cli/index.ts results <session-id> --all
```

Expected: Injected hypothesis present; killed hypothesis shows rejected; boosted hypothesis shows the elevated Elo.

- [ ] **Step 6: Final full verification**

Run: `bun test`
Expected: PASS — entire suite green.

---

## Self-Review Notes

- **Spec coverage:** Activation/fallback (Task 6 + Task 7 steps 3-4), architecture/components (Tasks 3-5), steering data flow (Task 1 + App wiring in Task 5), supervisor pause/resume (Task 2), error handling — non-TTY (Task 6 step 2), empty inject (Task 1 + InjectModal validation), SIGINT (Task 6 step 4) — testing (Tasks 1, 2 automated; Task 7 manual). All spec sections map to a task.
- **Type consistency:** `ContextStore` (class) imported as a type from `../../memory/contextStore.js`; `renderTUI` options match `AppProps` (minus the two callbacks vs props naming — both use `onTogglePause`/`onQuit`); `ProgressStats = SessionStats & { activity: string }` reused across hook/Header; `injectHypothesis` signature `(memory, InjectInput)` matches both the test (Task 1) and the App call site (Task 5).
- **No placeholders:** every code step contains complete code.
</content>
