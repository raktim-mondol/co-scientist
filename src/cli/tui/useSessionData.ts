import { useState, useEffect, useRef } from "react";
import type EventEmitter from "events";
import type { ContextStore } from "../../memory/contextStore.js";
import type { TranscriptEntry } from "./Transcript.js";
import { formatActivityEntry } from "./formatters.js";

export interface ProgressStats {
  tokensUsed: number;
  totalHypotheses: number;
  avgTopTenElo: number;
  currentRound: number;
  activeHypotheses: number;
  phase?: string;
}

interface LeaderboardEntry {
  id: string;
  title: string;
  summary: string;
  content: string;
  eloRating: number;
  rank: number;
}

let _entryId = 0;
function nextId(): string {
  return `entry_${_entryId++}`;
}

export function useSessionData(
  emitter: EventEmitter,
  memory: ContextStore,
  sessionId: string,
  onPushEntry?: (entry: TranscriptEntry) => void,
) {
  const [stats, setStats] = useState<ProgressStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [now, setNow] = useState(Date.now());
  const leaderInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refresh the top-10 leaderboard from DB on each progress event and on a
  // 2 s fallback interval so scores keep updating even between events.
  const refreshLeaderboard = () => {
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
  };

  useEffect(() => {
    const onProgress = (s: ProgressStats & { activity?: string; phase?: string }) => {
      const { activity, phase, ...rest } = s;
      setStats({ ...rest, phase: phase ?? rest.phase });
      setNow(Date.now());

      if (activity && onPushEntry) {
        onPushEntry(formatActivityEntry(
          phase ?? rest.phase,
          activity,
        ));
      }

      // Refresh the leaderboard on each progress tick.
      refreshLeaderboard();
    };

    const onHypothesisAdded = (count: number) => {
      setStats((prev) => (prev ? { ...prev, totalHypotheses: count } : prev));
      refreshLeaderboard();
    };

    emitter.on("progress", onProgress);
    emitter.on("hypothesis_added", onHypothesisAdded);

    // Fallback leaderboard refresh every 2 s, so Elo changes from ranking
    // matches show up even when no progress event fires.
    leaderInterval.current = setInterval(refreshLeaderboard, 2000);

    // Initial fetch if session already has hypotheses.
    refreshLeaderboard();

    return () => {
      emitter.off("progress", onProgress);
      emitter.off("hypothesis_added", onHypothesisAdded);
      if (leaderInterval.current) clearInterval(leaderInterval.current);
    };
  }, [emitter, sessionId, memory]);

  return { stats, leaderboard, now };
}
