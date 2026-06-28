import React from "react";
import { Box, Text } from "../ink.js";
import { Spinner } from "./Spinner.js";
import { verbForTask } from "./spinnerVerbs.js";
import { StatusIcon } from "../design-system/StatusIcon.js";
import type { StatusState } from "../design-system/StatusIcon.js";
import { ProgressBar } from "../design-system/ProgressBar.js";
import { Divider } from "../design-system/Divider.js";
import { useLayout } from "./hooks/useLayout.js";
import type { ProgressStats } from "./hooks/useEventDrivenSessionData.js";

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
  /** When true, render only the one-line status (no gauge/leaderboard). Used
   *  while the command palette is open so the live region stays within the
   *  viewport and Ink doesn't full-frame redraw (flicker) on each spinner tick. */
  compact?: boolean;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

// Live region that re-renders on each progress event: spinner + verb,
// token gauge + elapsed time, and the adaptive leaderboard.
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
  compact,
}: LiveStatusProps) {
  const { leaderboardMax } = useLayout({
    sessionActive: true,
    leaderboardRows: leaderboard.length,
    compact: !!compact,
  });

  if (!sessionState) return null;

  const elapsed = startTime != null ? Math.round((now - startTime) / 1000) : 0;
  const timeStr = `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  const tokens = stats?.tokensUsed ?? 0;
  const pct = budgetTokens > 0 ? Math.min(100, Math.round((tokens / budgetTokens) * 100)) : 0;

  const phase = stats?.phase ?? "generation";
  const verb = verbForTask(phase);

  // ── Status → StatusIcon state mapping ───────────────────────────────────
  const statusState: StatusState =
    sessionState === "completed" ? "completed"
    : sessionState === "paused" ? "paused"
    : "running";

  // ── Spinner / status line ───────────────────────────────────────────────
  const statusLine = (
    <Box paddingX={1}>
      {sessionState === "running" ? (
        <Box>
          <Spinner />
          <Text color="agentActive"> {verb}</Text>
        </Box>
      ) : (
        <StatusIcon state={statusState} />
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

  // Compact mode: just the spinner/status line, nothing tall. Keeps the live
  // region small while the command palette is open.
  if (compact) {
    return <Box flexDirection="column">{statusLine}</Box>;
  }

  // Gold / silver / bronze for the podium, then default text for the rest.
  const medalColor = (rank: number): string | undefined => {
    if (rank === 0) return "gold";
    if (rank === 1) return "silver";
    if (rank === 2) return "bronze";
    return undefined;
  };

  const medalGlyph = (rank: number): string => {
    if (rank === 0) return "🥇";
    if (rank === 1) return "🥈";
    if (rank === 2) return "🥉";
    return " ";
  };

  // ── Leaderboard pane ───────────────────────────────────────────────────
  const topN = leaderboard.slice(0, leaderboardMax);

  return (
    <Box flexDirection="column">
      <Divider />
      {statusLine}

      {/* Token gauge — Phase 5 ProgressBar replacing inline gauge() */}
      <Box paddingX={1}>
        <ProgressBar
          value={budgetTokens > 0 ? tokens / budgetTokens : 0}
          width={10}
          tone={pct > 90 ? "error" : pct > 70 ? "warning" : "neutral"}
          label="Tokens"
        />
        {goal && (
          <Text dimColor>
            {"  "}{sessionId ? `sess:${sessionId.slice(0, 8)}` : ""}
          </Text>
        )}
      </Box>

      {/* Leaderboard — adaptive height via leaderboardMax */}
      {topN.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Box paddingX={1}>
            <Text bold color="claude">🏆 Top Hypotheses</Text>
          </Box>
          {topN.map((h, i) => {
            const isSel = i === selected;
            const elo = Math.round(h.eloRating ?? 1200);
            const color = isSel ? "success" : medalColor(i);
            const prefix = isSel ? "▶" : medalGlyph(i);
            return (
              <Box key={h.id ?? i} paddingX={1}>
                <Text color={color} wrap="truncate">
                  {prefix} #{i + 1} {h.title}
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

      <Divider />
    </Box>
  );
}