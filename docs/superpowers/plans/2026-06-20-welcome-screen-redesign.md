# Welcome Screen Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the spinner-polluted startup with a silent init + clean ASCII-art welcome screen, matching Claude Code's minimal style.

**Architecture:** Three isolated file changes in dependency order — `banner.ts` exports a new helper, `EmptyState.tsx` imports it, `index.ts` removes the ora spinner calls. No new dependencies introduced.

**Tech Stack:** Bun, TypeScript, Ink (React for terminals), existing `color()` design-system helper from `src/cli/design-system/color.ts`.

## Global Constraints

- Runtime: Bun (not Node). Test runner: `bun test` (not Jest/Vitest).
- No new npm packages.
- `printBanner()` must keep working — it is called by `interactive.ts:580` and `commands/run.ts:32` (non-TUI paths).
- The screen-clear escape `\x1B[2J\x1B[H` in `index.ts` must stay.
- MCP init failures must still be silently swallowed (no crash, no output).

---

### Task 1: Extract `getBannerLines()` from `banner.ts`

**Files:**
- Modify: `src/cli/banner.ts`

**Interfaces:**
- Produces: `getBannerLines(): string[]` — returns the five ASCII-art content lines, stripped of the `|` frame characters and trailing whitespace. Used by Task 2.

- [ ] **Step 1: Open `src/cli/banner.ts` and add `getBannerLines()` above the existing `printBanner()`**

Keep `printBanner()` exactly as it is today — do not touch it. Only add the new export at the top:

```ts
import { color } from "./design-system/color.js";

// The five ASCII-art content lines, stripped of the box frame.
// Used by EmptyState to render the welcome screen inside the TUI.
export function getBannerLines(): string[] {
  return [
    "    .     .   +    ████   ████          ████   ████  ██ █████ ███  ██ ██████ ██  ████  ██████",
    "      . .         ██     ██  ██        ██     ██     ██ ██    ████ ██   ██   ██ ██       ██",
    "      | |         ██     ██  ██  ████   ████  ██     ██ ████  ██ ████   ██   ██  ████    ██",
    "     / _ \\        ██     ██  ██            ██ ██     ██ ██    ██  ███   ██   ██     ██   ██",
    "    / . . \\        ████   ████          ████   ████  ██ █████ ██   ██   ██   ██  ████    ██",
  ];
}

export function printBanner(): void {
  const banner = [
    "+==================================================================================================+",
    "|       o                                                                                          |",
    "|    .     .   +    ████   ████          ████   ████  ██ █████ ███  ██ ██████ ██  ████  ██████     |",
    "|      . .         ██     ██  ██        ██     ██     ██ ██    ████ ██   ██   ██ ██       ██       |",
    "|      | |         ██     ██  ██  ████   ████  ██     ██ ████  ██ ████   ██   ██  ████    ██       |",
    "|     / _ \\        ██     ██  ██            ██ ██     ██ ██    ██  ███   ██   ██     ██   ██       |",
    "|    / . . \\        ████   ████          ████   ████  ██ █████ ██   ██   ██   ██  ████    ██       |",
    "|   / . . . \\                                                                                      |",
    "|  ( . . . . )                                                                                     |",
    "|   \\_______/                            AI-Powered Scientific Discovery                           |",
    "+==================================================================================================+",
  ].join("\n");
  console.log(color("success").bold("\n" + banner + "\n"));
}
```

- [ ] **Step 2: Verify `printBanner` still produces the same visual output**

```bash
bun -e "import { printBanner } from './src/cli/banner.ts'; printBanner();"
```

Expected: the full bordered ASCII banner prints to stdout with green colouring. Confirm the five art lines appear inside the frame.

- [ ] **Step 3: Commit**

```bash
git add src/cli/banner.ts
git commit -m "refactor(banner): extract getBannerLines() for use in EmptyState"
```

---

### Task 2: Rewrite `EmptyState.tsx` with ASCII-art welcome

**Files:**
- Modify: `src/cli/tui/views/EmptyState.tsx`

**Interfaces:**
- Consumes: `getBannerLines(): string[]` from `../../banner.js` (Task 1)
- Consumes: `color` is not used here — Ink `<Text>` props (`bold`, `dimColor`, `color`) handle styling.

- [ ] **Step 1: Replace the contents of `src/cli/tui/views/EmptyState.tsx`**

```tsx
import React from "react";
import { Box, Text } from "../../ink.js";
import { getBannerLines } from "../../banner.js";

const ART = getBannerLines();

export function EmptyState() {
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {ART.map((line, i) => (
        <Text key={i} color="success" bold>
          {line}
        </Text>
      ))}
      <Box marginTop={1} />
      <Text dimColor>AI-Powered Scientific Discovery</Text>
      <Box marginTop={1} />
      <Text dimColor>
        Type a research topic and press Enter to begin
      </Text>
      <Text dimColor>
        <Text color="text">/help</Text>
        <Text dimColor> for commands · </Text>
        <Text color="text">/sessions</Text>
        <Text dimColor> to resume · </Text>
        <Text color="text">/quit</Text>
        <Text dimColor> to exit</Text>
      </Text>
    </Box>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /mnt/c/Users/rakti/Downloads/co-scientist && bun run tsc --noEmit 2>&1 | head -30
```

Expected: zero errors. If `tsc` is not a script, run: `bunx tsc --noEmit 2>&1 | head -30`.

- [ ] **Step 3: Commit**

```bash
git add src/cli/tui/views/EmptyState.tsx
git commit -m "feat(tui): replace box-art EmptyState with compact ASCII-art welcome"
```

---

### Task 3: Remove ora spinners from `index.ts`

**Files:**
- Modify: `src/cli/index.ts` (lines 199–215 approximately)

**Interfaces:**
- No new exports. Pure cleanup of the no-args action handler.

- [ ] **Step 1: Open `src/cli/index.ts` and replace the spinner blocks**

Find this block (around line 199):

```ts
const ora = (await import("ora")).default;

// Initialize database
const dbSpinner = ora("Initializing database...").start();
await runMigrations();
dbSpinner.succeed("Database ready");

// Initialize MCP tools
const acProvider = getMCPManager().providerPriority()[0];
const acLabel = acProvider.charAt(0).toUpperCase() + acProvider.slice(1);
const mcpSpinner = ora(`Connecting to ${acLabel} (academic search)...`).start();
try {
  await getMCPManager().initialize();
  mcpSpinner.succeed(`${acLabel} connected`);
} catch {
  mcpSpinner.warn(`${acLabel} connection degraded — search may be limited`);
}
```

Replace with:

```ts
// Initialize database and MCP silently — output would be wiped by the
// screen clear below anyway.
await runMigrations();
await getMCPManager().initialize().catch(() => {});
```

- [ ] **Step 2: Verify no remaining `ora` references in the no-args action handler**

```bash
grep -n "ora\|spinner\|Spinner" /mnt/c/Users/rakti/Downloads/co-scientist/src/cli/index.ts
```

Expected: zero matches (the `Spinner` import in TUI components is unrelated and won't appear here).

- [ ] **Step 3: Type-check**

```bash
cd /mnt/c/Users/rakti/Downloads/co-scientist && bunx tsc --noEmit 2>&1 | head -30
```

Expected: zero errors.

- [ ] **Step 4: Smoke-test the full launch**

```bash
bun run src/cli/index.ts
```

Expected:
- No spinner text appears
- Terminal clears
- ASCII art banner renders in green/bold
- `AI-Powered Scientific Discovery` subtitle appears dim below it
- Two hint lines appear below subtitle
- `> ▌` prompt is ready for input
- Press `/quit` + Enter to exit cleanly

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat(cli): silent startup — remove ora spinners before TUI launch"
```
