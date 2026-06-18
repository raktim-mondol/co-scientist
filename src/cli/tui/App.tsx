import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import EventEmitter from "events";
import type { ContextStore } from "../../memory/contextStore.js";
import type { SupervisorAgent } from "../../agents/supervisor.js";
import { useSessionData } from "./useSessionData.js";
import { Header } from "./Header.js";
import { MainView } from "./MainView.js";
import { InputBar } from "./InputBar.js";
import { Toast } from "./Toast.js";
import { KillModal } from "./modals/KillModal.js";
import { BoostModal } from "./modals/BoostModal.js";
import { InjectModal } from "./modals/InjectModal.js";
import { RunModal } from "./modals/RunModal.js";
import { killHypothesis, boostHypothesis, injectHypothesis } from "./actions.js";
import type { MainViewName, ModalName, AppContext, RouteResult } from "./CommandRouter.js";
import "./commands/run.js";

const NOOP_EMITTER = new EventEmitter();

export interface AppProps {
  memory: ContextStore;
  sessionId: string | null;
  goal: string | null;
  supervisor: SupervisorAgent | null;
  emitter: EventEmitter | null;
  startTime: number | null;
  budgetTokens: number;
  onStartSession: (goal: string, opts?: { name?: string; budget?: number; maxHypotheses?: number }) => Promise<void>;
  onStop: () => void;
  onTogglePause: () => boolean;
  onQuit: () => void;
}

type Focus = "input" | "dashboard";

export function App(props: AppProps) {
  const {
    memory, sessionId, goal, supervisor, emitter,
    startTime, budgetTokens, onStartSession, onStop, onTogglePause, onQuit,
  } = props;
  const { exit } = useApp();
  const hasSession = sessionId !== null;

  const { stats, leaderboard, ticker, now } = useSessionData(
    emitter ?? NOOP_EMITTER,
    memory,
    sessionId ?? "",
  );

  const [focus, setFocus] = useState<Focus>("input");
  const [activeView, setActiveView] = useState<MainViewName>(
    hasSession ? "dashboard" : "empty",
  );
  const [activeModal, setActiveModal] = useState<ModalName>(null);
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState(0);
  const [toastMsg, setToastMsg] = useState("");
  const [toastType, setToastType] = useState<"success" | "error" | "info">("info");
  const [toastVisible, setToastVisible] = useState(false);

  const selectedHyp = leaderboard[selected];
  const currentRound = stats?.currentRound ?? 0;

  // ── Build AppContext ──────────────────────────────────────────────────────
  const appContext: AppContext = {
    memory,
    sessionId,
    goal,
    supervisor,
    emitter,
    setMainView: setActiveView,
    openModal: (modal) => setActiveModal(modal),
    closeModal: () => setActiveModal(null),
    showToast: (message, type = "info") => {
      setToastMsg(message);
      setToastType(type);
      setToastVisible(true);
    },
    startSession: onStartSession,
    stopSession: onStop,
    togglePause: () => {
      const np = onTogglePause();
      setPaused(np);
      return np;
    },
    paused,
  };

  // ── Global Esc: dismiss modal first, then toggle focus ────────────────────
  useInput((_input, key) => {
    if (!key.escape) return;
    if (activeModal) {
      setActiveModal(null);
      return;
    }
    setFocus((f) => (f === "input" ? "dashboard" : "input"));
  });

  // ── Route handler (view switches, modals, session start, exit) ────────────
  const handleRoute = (result: RouteResult | { type: "session_start"; goal: string }) => {
    switch (result.type) {
      case "view_switch":
        setActiveView(result.view);
        break;
      case "modal":
        setActiveModal(result.modal);
        break;
      case "session_start":
        onStartSession(result.goal);
        break;
      case "exit":
        onQuit();
        exit();
        break;
      // immediate / error toasts are shown by InputBar
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column">
      {/* Header: full when session exists, minimal otherwise */}
      {hasSession ? (
        <Header
          sessionId={sessionId!}
          goal={goal ?? ""}
          stats={stats}
          startTime={startTime ?? 0}
          now={now}
          budgetTokens={budgetTokens}
          paused={paused}
        />
      ) : (
        <Box paddingX={1} paddingY={1}>
          <Text color="cyan" bold>🧬 co-scientist</Text>
        </Box>
      )}

      {/* Content area: always rendered through MainView */}
      <MainView
        activeView={activeView}
        appContext={appContext}
        focus={focus}
        leaderboard={leaderboard}
        ticker={ticker}
        selected={selected}
        setSelected={setSelected}
      />

      {/* Existing modals (Kill, Boost, Inject) — wired as modal overlay */}
      {activeModal === "kill" && selectedHyp && (
        <KillModal
          title={selectedHyp.title}
          onConfirm={() => {
            killHypothesis(memory, selectedHyp.id);
            setActiveModal(null);
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === "boost" && selectedHyp && (
        <BoostModal
          title={selectedHyp.title}
          currentElo={selectedHyp.eloRating}
          onConfirm={(newElo) => {
            boostHypothesis(memory, selectedHyp.id, newElo);
            setActiveModal(null);
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === "inject" && (
        <InjectModal
          onConfirm={(title, content) => {
            injectHypothesis(memory, {
              sessionId: sessionId!,
              title,
              summary: "",
              content,
              generationRound: currentRound,
            });
            setActiveModal(null);
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === "run" && (
        <RunModal
          onConfirm={async (goal, name) => {
            setActiveModal(null);
            await onStartSession(goal, name ? { name } : undefined);
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}

      {/* Input bar at the bottom */}
      <InputBar focus={focus === "input"} appContext={appContext} onRoute={handleRoute} />

      {/* App-level toast (for command handlers) */}
      {toastVisible && (
        <Toast
          message={toastMsg}
          type={toastType}
          visible={toastVisible}
          onDismiss={() => setToastVisible(false)}
        />
      )}
    </Box>
  );
}
