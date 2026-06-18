import { useEffect, useState, useRef } from "react";
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
  completed: boolean;
  overview: string;
}

const MAX_TICKER = 6;

/**
 * Stable equality check for the leaderboard — avoids triggering a re-render
 * (and thus a full Ink diff) when the underlying data hasn't changed.
 */
function leaderboardChanged(prev: Hypothesis[], next: Hypothesis[]): boolean {
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) {
    if (
      prev[i].id !== next[i].id ||
      prev[i].title !== next[i].title ||
      prev[i].status !== next[i].status ||
      prev[i].eloRating !== next[i].eloRating
    ) {
      return true;
    }
  }
  return false;
}

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
  const [completed, setCompleted] = useState(false);
  const [overview, setOverview] = useState("");

  // Use a ref to hold the latest leaderboard so the interval callback
  // doesn't need to be recreated on every render.
  const lbRef = useRef(leaderboard);
  lbRef.current = leaderboard;

  useEffect(() => {
    const refresh = () => {
      const next = memory.getTopHypotheses(sessionId, 12);
      if (leaderboardChanged(lbRef.current, next)) {
        setLeaderboard(next);
      }
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
    const onCompleted = (ov: string) => {
      setCompleted(true);
      setOverview(ov);
      push("✅ session completed");
      refresh(); // final leaderboard refresh
    };

    refresh();
    emitter.on("progress", onProgress);
    emitter.on("hypothesis_added", onHyp);
    emitter.on("match_completed", onMatch);
    emitter.on("completed", onCompleted);
    const interval = setInterval(refresh, 1000);

    return () => {
      emitter.off("progress", onProgress);
      emitter.off("hypothesis_added", onHyp);
      emitter.off("match_completed", onMatch);
      emitter.off("completed", onCompleted);
      clearInterval(interval);
    };
  }, [emitter, memory, sessionId]);

  return { stats, leaderboard, ticker, now, completed, overview };
}
