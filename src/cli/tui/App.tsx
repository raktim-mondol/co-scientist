import React, { useState, useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { EventEmitter } from "events";
import type { ContextStore } from "../../memory/contextStore.js";
import { useSessionData } from "./useSessionData.js";
import { Header } from "./Header.js";
import { Leaderboard } from "./Leaderboard.js";
import { Ticker } from "./Ticker.js";
import { Footer } from "./Footer.js";
import { KillModal } from "./modals/KillModal.js";
import { BoostModal } from "./modals/BoostModal.js";
import { InjectModal } from "./modals/InjectModal.js";
import { killHypothesis, boostHypothesis, injectHypothesis } from "./actions.js";

export interface AppProps {
  emitter: EventEmitter;
  memory: ContextStore;
  sessionId: string;
  goal: string;
  startTime: number;
  budgetTokens: number;
  onTogglePause: () => boolean; // returns the new paused state
  onQuit: () => void;
}

type Mode = "browse" | "kill" | "boost" | "inject";

export function App(props: AppProps) {
  const { emitter, memory, sessionId, goal, startTime, budgetTokens } = props;
  const { stats, leaderboard, ticker, now, completed, overview } = useSessionData(emitter, memory, sessionId);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<Mode>("browse");
  const [paused, setPaused] = useState(false);
  const { exit } = useApp();

  const selectedHyp = leaderboard[selected];
  const currentRound = stats?.currentRound ?? 0;

  // Auto-focus the last entry when new hypotheses arrive
  useEffect(() => {
    if (leaderboard.length > 0) {
      setSelected(leaderboard.length - 1);
    }
  }, [leaderboard.length]);

  // Main browse-mode keyboard handler — disabled while a modal is open.
  useInput(
    (input, key) => {
      if (completed) {
        // When session is done, any key exits
        exit();
        return;
      }
      if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
      else if (key.downArrow) setSelected((s) => Math.min(leaderboard.length - 1, s + 1));
      else if (input === "k" && selectedHyp) setMode("kill");
      else if (input === "b" && selectedHyp) setMode("boost");
      else if (input === "i") setMode("inject");
      else if (input === "p") setPaused(props.onTogglePause());
      else if (input === "q") {
        props.onQuit();
        exit();
      }
    },
    { isActive: mode === "browse" }
  );

  if (completed) {
    const topHyps = leaderboard.slice(0, 5);
    return (
      <Box flexDirection="column">
        <Header
          sessionId={sessionId}
          goal={goal}
          stats={stats}
          startTime={startTime}
          now={now}
          budgetTokens={budgetTokens}
          paused={false}
        />
        <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
          <Text color="green" bold>✅ Session completed!</Text>
          {overview ? (
            <Text color="white">{overview.slice(0, 300)}{overview.length > 300 ? "..." : ""}</Text>
          ) : null}
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text color="yellow" bold>🏆 Top Hypotheses:</Text>
          {topHyps.map((h, i) => (
            <Text key={h.id} color="white">
              {"  "}{i + 1}. [{Math.round(h.eloRating)}] {h.title}
            </Text>
          ))}
        </Box>
        <Box paddingX={1}>
          <Text color="gray">Press any key to exit</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Header
        sessionId={sessionId}
        goal={goal}
        stats={stats}
        startTime={startTime}
        now={now}
        budgetTokens={budgetTokens}
        paused={paused}
      />
      <Leaderboard hypotheses={leaderboard} selectedIndex={selected} />
      <Ticker lines={ticker} />

      {mode === "kill" && selectedHyp && (
        <KillModal
          title={selectedHyp.title}
          onConfirm={() => {
            killHypothesis(memory, selectedHyp.id);
            setMode("browse");
          }}
          onCancel={() => setMode("browse")}
        />
      )}
      {mode === "boost" && selectedHyp && (
        <BoostModal
          title={selectedHyp.title}
          currentElo={selectedHyp.eloRating}
          onConfirm={(newElo) => {
            boostHypothesis(memory, selectedHyp.id, newElo);
            setMode("browse");
          }}
          onCancel={() => setMode("browse")}
        />
      )}
      {mode === "inject" && (
        <InjectModal
          onConfirm={(title, content) => {
            injectHypothesis(memory, { sessionId, title, summary: "", content, generationRound: currentRound });
            setMode("browse");
          }}
          onCancel={() => setMode("browse")}
        />
      )}

      <Footer paused={paused} />
    </Box>
  );
}
