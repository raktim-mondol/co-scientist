# Welcome Screen Redesign

## Summary

Replace the current startup experience — ora spinners followed by a screen-wipe and a large boxed ASCII banner — with a clean, silent startup that immediately renders a Claude Code-style welcome screen.

## Current Behaviour

1. Ora spinners print to stdout: `✔ Database ready`, `✔ Consensus connected`
2. Terminal is cleared with `\x1B[2J\x1B[H`
3. Ink TUI renders: `Header` (app name) + `EmptyState` (box-art + 6-line getting-started list) + `InputBar`

## Target Behaviour

1. DB migrations and MCP init run silently (no spinner output)
2. Terminal is cleared (same as today)
3. Ink TUI renders: `Header` (unchanged) + `EmptyState` (ASCII art title + two-line hint) + `InputBar`

Terminal on launch:

```
   ████   ████          ████   ████  ██ █████ ███  ██ ██████ ██  ████  ██████
   ██     ██  ██        ██     ██     ██ ██    ████ ██   ██   ██ ██       ██
   ██     ██  ██  ████   ████  ██     ██ ████  ██ ████   ██   ██  ████    ██
   ██     ██  ██            ██ ██     ██ ██    ██  ███   ██   ██     ██   ██
    ████   ████          ████   ████  ██ █████ ██   ██   ██   ██  ████    ██

                     AI-Powered Scientific Discovery

   Type a research topic and press Enter to begin
   /help for commands · /sessions to resume · /quit to exit

 > ▌
```

## Changes

### 1. `src/cli/banner.ts`

Extract a `getBannerLines(): string[]` function that returns only the five ASCII art lines (no box frame, no surrounding `+===+` border). Keep `printBanner()` working for any existing callers.

### 2. `src/cli/index.ts`

- Remove the two `ora` spinner blocks (DB and MCP). Replace with bare `await` calls.
- Keep `process.stdout.write("\x1B[2J\x1B[H")` so the terminal is clean before the TUI renders.
- MCP init failure is still caught and silently swallowed (no user-visible output).

### 3. `src/cli/tui/views/EmptyState.tsx`

Replace the current content with:
- The five ASCII art lines from `getBannerLines()`, rendered in the success colour, bold
- One blank line
- Subtitle: `AI-Powered Scientific Discovery` (dim)
- One blank line  
- Hint line 1: `Type a research topic and press Enter to begin` (dim)
- Hint line 2: `/help for commands · /sessions to resume · /quit to exit` (dim, with command tokens in text colour)

## Out of Scope

- Header component: unchanged
- InputBar: unchanged
- Any session-active views (Dashboard, Results, etc.): unchanged
- The `--no-interactive` / non-TUI code path: unchanged
