import React from "react";
import { Box, Text } from "ink";
import { Spinner } from "./Spinner.js";
import type { ProgressStats } from "./useSessionData.js";

export type SessionState = "running" | "paused" | null;

interface HeaderProps {
  sessionState: SessionState;
  sessionId: string | null;
  goal: string | null;
  stats: ProgressStats | null;
  startTime: number | null;
  now: number;
  budgetTokens: number;
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

/**
 * Multi-state header component.
 * - null sessionState: minimal header with just the app name
 * - "running": full header with spinner, token gauge, stats
 * - "paused": full header with "PAUSED" marker
 */
export function Header({ sessionState, sessionId, goal, stats, startTime, now, budgetTokens }: HeaderProps) {
  // ── Empty state ──────────────────────────────────────────────────────────
  if (!sessionState) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text color="cyan" bold>🧬 co-scientist</Text>
      </Box>
    );
  }

  // ── Running / Paused state ───────────────────────────────────────────────
  const elapsed = startTime != null ? Math.round((now - startTime) / 1000) : 0;
  const timeStr = `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  const tokens = stats?.tokensUsed ?? 0;
  const pct = budgetTokens > 0 ? Math.round((tokens / budgetTokens) * 100) : 0;
  const hyp = stats?.totalHypotheses ?? 0;
  const avgElo = Math.round(stats?.avgTopTenElo ?? 1200);
  const isPaused = sessionState === "paused";

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between">
        <Text color="cyan" bold>🧬 co-scientist</Text>
        {sessionId && <Text color="gray">sess:{sessionId.slice(0, 8)}</Text>}
        {isPaused ? (
          <Text color="yellow">⏸ PAUSED</Text>
        ) : (
          <Box>
            <Spinner />
            <Text color="green"> running</Text>
          </Box>
        )}
        <Text color="gray">{timeStr}</Text>
      </Box>
      {goal && (
        <Text color="white">Goal: {goal.length > 70 ? goal.slice(0, 67) + "..." : goal}</Text>
      )}
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
