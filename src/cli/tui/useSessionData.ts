import { useState, useEffect } from "react";
import type EventEmitter from "events";
import type { ContextStore } from "../../memory/contextStore.js";

export interface ProgressStats {
  tokensUsed: number;
  totalHypotheses: number;
  avgTopTenElo: number;
  currentRound: number;
  activeHypotheses: number;
}

interface LeaderboardEntry {
  id: string;
  title: string;
  summary: string;
  content: string;
  eloRating: number;
  rank: number;
}

export function useSessionData(
  emitter: EventEmitter,
  _memory: ContextStore,
  _sessionId: string,
) {
  const [stats, setStats] = useState<ProgressStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [ticker, setTicker] = useState<string[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const onProgress = (s: ProgressStats & { activity?: string }) => {
      const { activity, ...rest } = s;
      setStats(rest);
      setNow(Date.now());
      if (activity) {
        setTicker((prev) => {
          const next = [activity, ...prev];
          return next.slice(0, 100);
        });
      }
    };

    const onHypothesisAdded = (count: number) => {
      setStats((prev) => (prev ? { ...prev, totalHypotheses: count } : prev));
    };

    emitter.on("progress", onProgress);
    emitter.on("hypothesis_added", onHypothesisAdded);

    return () => {
      emitter.off("progress", onProgress);
      emitter.off("hypothesis_added", onHypothesisAdded);
    };
  }, [emitter]);

  return { stats, leaderboard, ticker, now };
}
