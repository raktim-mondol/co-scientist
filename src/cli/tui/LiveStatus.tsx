import React from "react";
import { Box, Text } from "../ink.js";
import { Spinner } from "./Spinner.js";
import { verbForTask } from "./spinnerVerbs.js";
import type { ProgressStats } from "./useSessionData.js";

export type SessionState = "running" | "paused" | "completed" | null;

interface LeaderboardEntry {
  id: string;
  title: string;
  summary: string;
  content: string;
  eloRating: number;
  rank: number;
}

interface LiveStatusProps {
  sessionState: SessionState;
  sessionId: string | null;
  goal: string | null;
  stats: ProgressStats | null;
  startTime: number | null;
  now: number;
  budgetTokens: number;
  leaderboard: LeaderboardEntry[];
  selected: number;
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

// Live region that re-renders on each progress event: spinner + verb,
// token gauge + elapsed time, and the top-10 leaderboard.
// Only renders while a session is running/paused/completed.
export function LiveStatus({
  sessionState,
  sessionId,
  goal,
  stats,
  startTime,
  now,
  budgetTokens,
  leaderboard,
  selected,
}: LiveStatusProps) {
  if (!sessionState) return null;

  const elapsed = startTime != null ? Math.round((now - startTime) / 1000) : 0;
  const timeStr = `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  const tokens = stats?.tokensUsed ?? 0;
  const pct = budgetTokens > 0 ? Math.round((tokens / budgetTokens) * 100) : 0;

  const phase = stats?.phase ?? "generation";
  const verb = verbForTask(phase);

  const isPaused = sessionState === "paused";
  const isCompleted = sessionState === "completed";

  // ── Spinner + verb line ────────────────────────────────────────────────
  const statusLine = (
    <Box paddingX={1}>
      {isCompleted ? (
        <Text color="success">✓ complete</Text>
      ) : isPaused ? (
        <Text color="warning">⏸ PAUSED</Text>
      ) : (
        <Box>
          <Spinner />
          <Text color="claude"> {verb}</Text>
        </Box>
      )}
      <Text dimColor> · {timeStr}</Text>
      <Text dimColor> · {formatTokens(tokens)}</Text>
      {budgetTokens > 0 && (
        <Text dimColor>/{formatTokens(budgetTokens)}</Text>
      )}
      <Text dimColor> ({pct}%)</Text>
      {stats && (
        <Text dimColor> · R{stats.currentRound}</Text>
      )}
      {stats && (
        <Text dimColor> · H{stats.activeHypotheses}</Text>
      )}
    </Box>
  );

  // ── Leaderboard pane ───────────────────────────────────────────────────
  const topN = leaderboard.slice(0, 10);

  return (
    <Box flexDirection="column">
      {/* Separator */}
      <Box paddingX={1}>
        <Text dimColor>───</Text>
      </Box>

      {statusLine}

      {/* Token gauge bar */}
      <Box paddingX={1}>
        <Text dimColor>
          {gauge(pct)} Tokens
        </Text>
        {goal && (
          <Text dimColor>
            {"  "}{sessionId ? `sess:${sessionId.slice(0, 8)}` : ""}
          </Text>
        )}
      </Box>

      {/* Leaderboard */}
      {topN.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Box paddingX={1}>
            <Text bold color="claude">🏆 Top Hypotheses</Text>
          </Box>
          {topN.map((h, i) => {
            const isSel = i === selected;
            const elo = Math.round(h.eloRating ?? 1200);
            return (
              <Box key={h.id ?? i} paddingX={1}>
                <Text color={isSel ? "success" : undefined}>
                  {isSel ? "▶" : " "} #{i + 1} {h.title.slice(0, 48)}
                  {"  "}
                  <Text dimColor>Elo: {elo}</Text>
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Empty state before first generation */}
      {topN.length === 0 && sessionState === "running" && (
        <Box paddingX={1}>
          <Text dimColor>  Waiting for first hypotheses…</Text>
        </Box>
      )}

      {/* Spacer */}
      <Box paddingX={1}>
        <Text dimColor>───</Text>
      </Box>
    </Box>
  );
}
