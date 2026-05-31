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
