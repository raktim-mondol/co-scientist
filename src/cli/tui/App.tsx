import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useApp, useInput, Static } from "../ink.js";
import EventEmitter from "events";
import type { ContextStore } from "../../memory/contextStore.js";
import type { SupervisorAgent } from "../../agents/supervisor.js";
import { useSessionData } from "./useSessionData.js";
import { Header } from "./Header.js";
import type { SessionState } from "./Header.js";
import { MainView } from "./MainView.js";
import { InputBar } from "./InputBar.js";
import { Toast } from "./Toast.js";
import { KillModal } from "./modals/KillModal.js";
import { BoostModal } from "./modals/BoostModal.js";
import { InjectModal } from "./modals/InjectModal.js";
import { RunModal } from "./modals/RunModal.js";
import { BudgetModal } from "./modals/BudgetModal.js";
import { StrategyModal } from "./modals/StrategyModal.js";
import { ExportModal } from "./modals/ExportModal.js";
import { FeedbackModal } from "./modals/FeedbackModal.js";
import { DesignModal } from "./modals/DesignModal.js";
import { DeleteModal } from "./modals/DeleteModal.js";
import { killHypothesis, boostHypothesis, injectHypothesis } from "./actions.js";
import { extractRewardFromFeedback } from "../../rlef/reward-signal.js";
import { exportCommand } from "../commands/export.js";
import { v4 as uuidv4 } from "uuid";
import type { MainViewName, ModalName, AppContext, RouteResult } from "./CommandRouter.js";
import type { SessionStartResult } from "./index.js";
// Command registrations (side-effect imports)
import "./commands/run.js";
import "./commands/pause.js";
import "./commands/resume.js";
import "./commands/stop.js";
import "./commands/dashboard.js";
import "./commands/boost.js";
import "./commands/kill.js";
import "./commands/inject.js";
import "./commands/budget.js";
import "./commands/strategy.js";
import "./commands/results.js";
import "./commands/compare.js";
import "./commands/diff.js";
import "./commands/graph.js";
import "./commands/overview.js";
import "./commands/activity.js";
// Task 11 — Action commands
import "./commands/exportCmd.js";
import "./commands/feedbackCmd.js";
import "./commands/designCmd.js";
import "./commands/deleteCmd.js";
// Task 12 — Navigation & system commands
import "./commands/sessions.js";
import "./commands/switch.js";
import "./commands/login.js";
import "./commands/logout.js";
import "./commands/help.js";
import "./commands/quit.js";

const NOOP_EMITTER = new EventEmitter();

export interface AppProps {
  memory: ContextStore;
  sessionId: string | null;
  goal: string | null;
  supervisor: SupervisorAgent | null;
  emitter: EventEmitter | null;
  startTime: number | null;
  budgetTokens: number;
  onStartSession: (goal: string, opts?: { name?: string; budget?: number; maxHypotheses?: number }) => Promise<SessionStartResult>;
  onStop: () => void;
  onTogglePause: () => boolean;
  onQuit: () => void;
}

type Focus = "input" | "dashboard";

export function App(props: AppProps) {
  const {
    memory, budgetTokens, onQuit,
    onStartSession: externalOnStartSession,
    onStop: externalOnStop,
    onTogglePause: externalOnTogglePause,
  } = props;
  const { exit } = useApp();

  // ── Internal session state ─────────────────────────────────────────────
  // Initialized from props (non-interactive path: session already exists).
  // Updated via onStartSession → SessionStartResult (interactive path).
  const [sessionId, setSessionId] = useState<string | null>(props.sessionId);
  const [goal, setGoal] = useState<string | null>(props.goal);
  const [supervisor, setSupervisor] = useState<SupervisorAgent | null>(props.supervisor);
  const [emitter, setEmitter] = useState<EventEmitter | null>(props.emitter);
  const [startTime, setStartTime] = useState<number | null>(props.startTime);
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
  const activeHypCount = stats?.activeHypotheses ?? 0;

  // ── Session completion / error event handling ──────────────────────────
  useEffect(() => {
    if (!emitter || !sessionId) return;
    const onCompleted = (overview: string) => {
      setActiveView("overview");
      setToastMsg("Session completed! Research overview available.");
      setToastType("success");
      setToastVisible(true);
    };
    const onError = (err: Error) => {
      setToastMsg(`Session error: ${err.message}`);
      setToastType("error");
      setToastVisible(true);
    };
    emitter.on("completed", onCompleted);
    emitter.on("error", onError);
    return () => {
      emitter.off("completed", onCompleted);
      emitter.off("error", onError);
    };
  }, [emitter, sessionId]);

  // Derived session state for Header
  const sessionState: SessionState = !hasSession ? null : paused ? "paused" : "running";

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
    startSession: async (goalText, opts) => {
      const result = await externalOnStartSession(goalText, opts);
      setSessionId(result.sessionId);
      setGoal(goalText);
      setSupervisor(result.supervisor);
      setEmitter(result.emitter);
      setStartTime(Date.now());
      setPaused(false);
      setActiveView("dashboard");
    },
    stopSession: () => {
      externalOnStop();
      setSessionId(null);
      setGoal(null);
      setSupervisor(null);
      setEmitter(null);
      setStartTime(null);
      setPaused(false);
      setActiveView("empty");
    },
    togglePause: () => {
      const np = externalOnTogglePause();
      setPaused(np);
      return np;
    },
    paused,
  };

  // ── Memoized lists for modals ─────────────────────────────────────────────
  const allHypotheses = useMemo(
    () => (sessionId ? memory.getAllActiveHypotheses(sessionId) : []),
    [sessionId, memory, stats], // stats changes trigger refresh
  );

  const allSessions = useMemo(
    () => memory.listSessions(),
    [memory],
  );

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
        appContext.startSession(result.goal);
        break;
      case "exit":
        onQuit();
        exit();
        break;
      // immediate / error toasts are shown by InputBar
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  // FullscreenLayout pattern: scrollable content area + fixed bottom + modal overlay.
  // Matches claude_code's REPL.tsx layout structure.
  return (
    <Box flexDirection="column" height="100%">
      {/* Scrollable content area: Header + MainView */}
      <Box flexGrow={1} flexDirection="column">
        <Header
          sessionState={sessionState}
          sessionId={sessionId}
          goal={goal}
          stats={stats}
          startTime={startTime}
          now={now}
          budgetTokens={budgetTokens}
        />

        <MainView
          activeView={activeView}
          appContext={appContext}
          focus={focus}
          leaderboard={leaderboard}
          ticker={ticker}
          selected={selected}
          setSelected={setSelected}
        />
      </Box>

      {/* Modal overlay — renders above the fixed bottom section */}
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
            await appContext.startSession(goal, name ? { name } : undefined);
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === "budget" && (
        <BudgetModal
          currentBudget={budgetTokens}
          onConfirm={(newBudget) => {
            process.env.COMPUTE_BUDGET_TOKENS = String(newBudget);
            setActiveModal(null);
            appContext.showToast(`Budget set to ${newBudget.toLocaleString()} tokens.`, "success");
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === "strategy" && (
        <StrategyModal
          weights={{
            generation: activeHypCount < 3 ? 0.60 : 0.30,
            reflection: 0.20,
            ranking: activeHypCount >= 2 ? 0.30 : 0.03,
            evolution: 0.10,
            proximity: 0.07,
            meta_review: 0.03,
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}

      {/* Action modals */}
      {activeModal === "export" && (
        <ExportModal
          onConfirm={(format, outputPath) => {
            setActiveModal(null);
            exportCommand(sessionId!, { format, output: outputPath }).then(() => {
              appContext.showToast(`Session exported as ${format}.`, "success");
            }).catch((err) => {
              appContext.showToast(`Export failed: ${(err as Error).message}`, "error");
            });
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === "feedback" && (
        <FeedbackModal
          hypotheses={allHypotheses.map((h) => ({ id: h.id, title: h.title }))}
          onConfirm={(data) => {
            const reward = extractRewardFromFeedback(
              data.feedbackText,
              data.noveltyScore ?? undefined,
              data.correctnessScore ?? undefined,
              data.testabilityScore ?? undefined,
            );
            memory.saveExperimentalFeedback({
              id: uuidv4(),
              hypothesisId: data.hypothesisId,
              sessionId: sessionId!,
              feedbackText: data.feedbackText,
              noveltyScore: data.noveltyScore,
              correctnessScore: data.correctnessScore,
              testabilityScore: data.testabilityScore,
              metadata: {},
              computedReward: reward,
              recordedBy: "human",
              createdAt: new Date(),
            });
            setActiveModal(null);
            appContext.showToast("Feedback saved.", "success");
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === "design" && (
        <DesignModal
          sessionId={sessionId!}
          hypotheses={allHypotheses}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === "delete" && (
        <DeleteModal
          sessions={allSessions}
          onConfirm={(ids) => {
            for (const id of ids) {
              memory.deleteSession(id);
            }
            setActiveModal(null);
            appContext.showToast(`Deleted ${ids.length} session(s).`, "success");
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}

      {/* Fixed bottom section */}
      <Box flexShrink={0} flexDirection="column">
        {/* App-level toast (for command handlers) */}
        {toastVisible && (
          <Toast
            message={toastMsg}
            type={toastType}
            visible={toastVisible}
            onDismiss={() => setToastVisible(false)}
          />
        )}

        {/* Input bar at the bottom — clears on view switch */}
        <InputBar focus={focus === "input"} appContext={appContext} onRoute={handleRoute} clearKey={activeView} />
      </Box>
    </Box>
  );
}
