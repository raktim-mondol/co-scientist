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
