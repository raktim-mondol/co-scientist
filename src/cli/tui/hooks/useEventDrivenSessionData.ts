// Event-driven replacement for the polling `useSessionData` hook.
//
// Previously the leaderboard was refreshed on every `progress` event *and* on a
// 2 s `setInterval` fallback so Elo changes from ranking matches would show up
// between events. The fallback poll exists only because there was no event for
// "the leaderboard changed." We now subscribe to the events that actually
// change the leaderboard (`progress`, `hypothesis_added`) and debounce rapid
// bursts (200ms) before re-reading from the DB — purely event-driven, no timer.
//
// Returns the same shape as the old hook (`{ stats, leaderboard, now }`) so it
// is a drop-in replacement.

import { useState, useEffect, useRef, useCallback } from "react";
import type EventEmitter from "events";
import type { ContextStore } from "../../../memory/contextStore.js";
import type { TranscriptEntry } from "../Transcript.js";
import { formatActivityEntry } from "../formatters.js";

export interface ProgressStats {
  tokensUsed: number;
  totalHypotheses: number;
  avgTopTenElo: number;
  currentRound: number;
  activeHypotheses: number;
  phase?: string;
}

export interface LeaderboardEntry {
  id: string;
  title: string;
  summary: string;
  content: string;
  eloRating: number;
  rank: number;
}

// Debounce window: rapid progress events (a burst of agent activity) collapse
// into a single leaderboard re-read. 200ms is short enough to feel live but
// long enough to skip redundant reads during a 10-event burst.
const DEBOUNCE_MS = 200;

let _entryId = 0;
function nextId(): string {
  return `entry_${_entryId++}`;
}

export function useEventDrivenSessionData(
  emitter: EventEmitter | null,
  memory: ContextStore,
  sessionId: string | null,
  onPushEntry?: (entry: TranscriptEntry) => void,
): { stats: ProgressStats | null; leaderboard: LeaderboardEntry[]; now: number } {
  const [stats, setStats] = useState<ProgressStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // Debounce timer ref. Each progress/hypothesis_added event schedules a
  // single leaderboard refresh; back-to-back events reset the timer so we
  // only read once the burst settles.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshLeaderboard = useCallback(() => {
    if (!sessionId) return;
    try {
      const top = memory.getTopHypotheses(sessionId, 10);
      setLeaderboard(
        top.map((h, i) => ({
          id: h.id,
          title: h.title,
          summary: h.summary ?? "",
          content: h.content ?? "",
          eloRating: h.eloRating,
          rank: i + 1,
        })),
      );
    } catch {
      // Session may have been deleted or table missing — safe to swallow.
    }
  }, [sessionId, memory]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(refreshLeaderboard, DEBOUNCE_MS);
  }, [refreshLeaderboard]);

  useEffect(() => {
    if (!emitter) return;
    const onProgress = (s: ProgressStats & { activity?: string; phase?: string }) => {
      const { activity, phase, ...rest } = s;
      setStats({ ...rest, phase: phase ?? rest.phase });
      setNow(Date.now());

      if (activity && onPushEntry) {
        onPushEntry(formatActivityEntry(phase ?? rest.phase, activity));
      }

      scheduleRefresh();
    };

    const onHypothesisAdded = (count: number) => {
      setStats((prev) => (prev ? { ...prev, totalHypotheses: count } : prev));
      scheduleRefresh();
    };

    emitter.on("progress", onProgress);
    emitter.on("hypothesis_added", onHypothesisAdded);

    // Initial fetch — covers the case where a session already has hypotheses
    // when the hook mounts (e.g. resuming).
    refreshLeaderboard();

    return () => {
      emitter.off("progress", onProgress);
      emitter.off("hypothesis_added", onHypothesisAdded);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [emitter, sessionId, memory, onPushEntry, refreshLeaderboard, scheduleRefresh]);

  return { stats, leaderboard, now };
}

// Keep the legacy export name as a thin alias so any lingering imports keep
// working during the migration. New code should use `useEventDrivenSessionData`.
export { useEventDrivenSessionData as useSessionData };

// Re-export the id generator for callers that build transcript entries
// outside of formatters (kept for parity with the old hook).
export { nextId };