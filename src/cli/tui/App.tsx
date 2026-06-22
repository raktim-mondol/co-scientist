import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Box, Text, useApp, useInput, Static } from "../ink.js";
import EventEmitter from "events";
import type { ContextStore } from "../../memory/contextStore.js";
import type { SupervisorAgent } from "../../agents/supervisor.js";
import { useSessionData } from "./useSessionData.js";
import { WelcomeBox } from "./WelcomeBox.js";
import { TranscriptItem } from "./Transcript.js";
import { LiveStatus } from "./LiveStatus.js";
import type { SessionState } from "./LiveStatus.js";
import { InputBar } from "./InputBar.js";
import { Footer } from "./Footer.js";
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
import { SessionsModal } from "./modals/SessionsModal.js";
import { LoginModal } from "./modals/LoginModal.js";
import { killHypothesis, boostHypothesis, injectHypothesis } from "./actions.js";
import { extractRewardFromFeedback } from "../../rlef/reward-signal.js";
import { exportCommand } from "../commands/export.js";
import { v4 as uuidv4 } from "uuid";
import type { TranscriptEntry } from "./Transcript.js";
import { formatUserGoal, formatSystemNotice, formatResults, formatSessionResults, formatOverview } from "./formatters.js";
import type { ModalName, AppContext, RouteResult } from "./CommandRouter.js";
import type { SessionStartResult } from "./index.js";

// Command registrations (side-effect imports — keep exactly as-is)
import "./commands/run.js";
import "./commands/pause.js";
import "./commands/stop.js";
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
// Task 12 — Navigation & system commands
import "./commands/sessions.js";
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
  onResumeSession: (sessionId: string) => Promise<SessionStartResult & { goal: string }>;
  onStop: () => void;
  onTogglePause: () => boolean;
  onQuit: () => void;
}

export function App(props: AppProps) {
  const {
    memory, budgetTokens, onQuit,
    onStartSession: externalOnStartSession,
    onResumeSession: externalOnResumeSession,
    onStop: externalOnStop,
    onTogglePause: externalOnTogglePause,
  } = props;
  const { exit } = useApp();

  // ── Internal session state ─────────────────────────────────────────────
  const [sessionId, setSessionId] = useState<string | null>(props.sessionId);
  const [goal, setGoal] = useState<string | null>(props.goal);
  const [supervisor, setSupervisor] = useState<SupervisorAgent | null>(props.supervisor);
  const [emitter, setEmitter] = useState<EventEmitter | null>(props.emitter);
  const [startTime, setStartTime] = useState<number | null>(props.startTime);
  const hasSession = sessionId !== null;

  // ── Transcript (<Static> scrollback) ───────────────────────────────────
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const pushEntry = useCallback((entry: TranscriptEntry) => {
    setTranscript((prev) => [...prev, entry]);
  }, []);

  // Pass memory + pushEntry into useSessionData so progress events push
  // activity lines into the transcript and refresh the leaderboard.
  const { stats, leaderboard, now } = useSessionData(
    emitter ?? NOOP_EMITTER,
    memory,
    sessionId ?? "",
    pushEntry,
  );

  const [activeModal, setActiveModal] = useState<ModalName>(null);
  const [modalData, setModalData] = useState<unknown>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [selected, setSelected] = useState(0);
  const [toastMsg, setToastMsg] = useState("");
  const [toastType, setToastType] = useState<"success" | "error" | "info">("info");
  const [toastVisible, setToastVisible] = useState(false);

  const selectedHyp = leaderboard[selected];

  // ── Session completion / error event handling ──────────────────────────
  useEffect(() => {
    if (!emitter || !sessionId) return;
    const onCompleted = (_overview: string) => {
      setCompleted(true);
      // Push a results block into the transcript so the user sees the
      // final rankings printed in scrollback.
      pushEntry(formatResults(memory, sessionId));
      pushEntry(formatSystemNotice("Session completed.", "success"));
    };
    const onError = (err: Error) => {
      pushEntry(formatSystemNotice(`Session error: ${err.message}`, "error"));
    };
    emitter.on("completed", onCompleted);
    emitter.on("error", onError);
    return () => {
      emitter.off("completed", onCompleted);
      emitter.off("error", onError);
    };
  }, [emitter, sessionId, memory, pushEntry]);

  // Derived session state for LiveStatus.
  const sessionState: SessionState = !hasSession
    ? null
    : completed
      ? "completed"
      : paused
        ? "paused"
        : "running";

  // ── Build AppContext ───────────────────────────────────────────────────
  const appContext: AppContext = {
    memory,
    sessionId,
    goal,
    supervisor,
    emitter,
    openModal: (modal) => setActiveModal(modal),
    closeModal: () => setActiveModal(null),
    showToast: (message, type = "info") => {
      setToastMsg(message);
      setToastType(type);
      setToastVisible(true);
    },
    startSession: async (goalText, opts) => {
      // Echo the goal into the transcript
      pushEntry(formatUserGoal(goalText));

      const result = await externalOnStartSession(goalText, opts);
      setSessionId(result.sessionId);
      setGoal(goalText);
      setSupervisor(result.supervisor);
      setEmitter(result.emitter);
      setStartTime(Date.now());
      setPaused(false);
      setCompleted(false);

      pushEntry(formatSystemNotice("Session started.", "success"));
    },
    resumeSession: async (id) => {
      const result = await externalOnResumeSession(id);
      setSessionId(result.sessionId);
      setGoal(result.goal);
      setSupervisor(result.supervisor);
      setEmitter(result.emitter);
      setStartTime(Date.now());
      setPaused(false);
      setCompleted(false);
      pushEntry(formatSystemNotice(`Resuming session ${result.sessionId.slice(0, 8)}…`, "info"));
    },
    stopSession: () => {
      externalOnStop();
      setSessionId(null);
      setGoal(null);
      setSupervisor(null);
      setEmitter(null);
      setStartTime(null);
      setPaused(false);
      setCompleted(false);
    },
    togglePause: () => {
      const np = externalOnTogglePause();
      setPaused(np);
      pushEntry(formatSystemNotice(np ? "Session paused." : "Session resumed.", "info"));
      return np;
    },
    paused,
    pushEntry,
  };

  // ── Memoized lists for modals ──────────────────────────────────────────
  const allHypotheses = useMemo(
    () => (sessionId ? memory.getAllActiveHypotheses(sessionId) : []),
    [sessionId, memory, stats],
  );

  const allSessions = useMemo(
    () => memory.listSessions(),
    [memory],
  );

  // ── Global Esc: dismiss modal ──────────────────────────────────────────
  useInput((_input, key) => {
    if (!key.escape) return;
    if (activeModal) {
      setActiveModal(null);
    }
  });

  // ── Route handler ──────────────────────────────────────────────────────
  const handleRoute = (result: RouteResult | { type: "session_start"; goal: string }) => {
    switch (result.type) {
      case "transcript":
        // Push the formatted block(s) into scrollback
        for (const entry of result.entries) {
          pushEntry(entry);
        }
        if (result.message) {
          setToastMsg(result.message);
          setToastType("success");
          setToastVisible(true);
        }
        break;
      case "modal":
        setModalData(result.data ?? null);
        setActiveModal(result.modal);
        if (result.message) {
          setToastMsg(result.message);
          setToastType("info");
          setToastVisible(true);
        }
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

  // ── Render: REPL layout ────────────────────────────────────────────────
  // Top → bottom:
  //   1. <Static> WelcomeBox + transcript (scrollback, never re-renders)
  //   2. LiveStatus (re-renders on progress, shows spinner + token gauge + leaderboard)
  //   3. Modal overlay (renders above the live region, below it logically)
  //   4. Toast + InputBar + Footer (fixed at bottom)
  return (
    <Box flexDirection="column">
      {/* ── Scrollback (Static: print-and-forget, no flicker) ────────── */}
      <Static items={[
        <Box key="welcome_static" flexDirection="column">
          <WelcomeBox />
        </Box>,
        ...transcript.map((entry) => (
          <Box key={entry.id} flexDirection="column">
            <TranscriptItem entry={entry} />
          </Box>
        )),
      ]}>
        {(item) => item}
      </Static>

      {/* ── Live region (re-renders on every progress tick) ──────────── */}
      <LiveStatus
        sessionState={sessionState}
        sessionId={sessionId}
        goal={goal}
        stats={stats}
        startTime={startTime}
        now={now}
        budgetTokens={budgetTokens}
        leaderboard={leaderboard}
        selected={selected}
        compact={paletteOpen}
      />

      {/* ── Modal overlay ────────────────────────────────────────────── */}
      {activeModal === "kill" && selectedHyp && (
        <KillModal
          title={selectedHyp.title}
          onConfirm={() => {
            killHypothesis(memory, selectedHyp.id);
            pushEntry(formatSystemNotice(`Killed: ${selectedHyp.title.slice(0, 40)}`));
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
            pushEntry(formatSystemNotice(`Boosted ${selectedHyp.title.slice(0, 40)} to Elo ${newElo}`));
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
              generationRound: stats?.currentRound ?? 0,
            });
            pushEntry(formatSystemNotice(`Injected: ${title.slice(0, 40)}`));
            setActiveModal(null);
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === "run" && (
        <RunModal
          onConfirm={async (goalText, name) => {
            setActiveModal(null);
            await appContext.startSession(goalText, name ? { name } : undefined);
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === "budget" && (
        <BudgetModal
          currentBudget={budgetTokens}
          onConfirm={(newBudget) => {
            process.env.COMPUTE_BUDGET_TOKENS = String(newBudget);
            pushEntry(formatSystemNotice(
              `Budget set to ${newBudget.toLocaleString()} tokens.`,
              "success",
            ));
            setActiveModal(null);
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === "strategy" && (
        <StrategyModal
          weights={{
            generation: (stats?.activeHypotheses ?? 0) < 3 ? 0.60 : 0.30,
            reflection: 0.20,
            ranking: (stats?.activeHypotheses ?? 0) >= 2 ? 0.30 : 0.03,
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
            const targetId = (modalData as { sessionId?: string } | null)?.sessionId ?? sessionId!;
            setActiveModal(null);
            setModalData(null);
            exportCommand(targetId, { format, output: outputPath }).then(() => {
              pushEntry(formatSystemNotice(`Session exported as ${format}.`, "success"));
            }).catch((err) => {
              pushEntry(formatSystemNotice(`Export failed: ${(err as Error).message}`, "error"));
            });
          }}
          onCancel={() => { setActiveModal(null); setModalData(null); }}
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
            pushEntry(formatSystemNotice("Feedback saved.", "success"));
            setActiveModal(null);
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === "design" && (
        <DesignModal
          sessionId={sessionId!}
          hypotheses={allHypotheses}
          onDone={(entry) => {
            pushEntry({
              id: uuidv4(),
              kind: "block",
              title: entry.title,
              lines: [
                entry.hypothesisTitle.slice(0, 80),
                "",
                ...entry.steps.slice(0, 20),
              ],
              color: "permission",
            });
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === "sessions" && (
        <SessionsModal
          sessions={allSessions}
          activeSessionId={sessionId}
          onView={(id) => {
            pushEntry(formatSessionResults(memory, id));
            setActiveModal(null);
          }}
          onOverview={(id) => {
            for (const entry of formatOverview(memory, id)) pushEntry(entry);
            setActiveModal(null);
          }}
          onExport={(id) => {
            setModalData({ sessionId: id });
            setActiveModal("export");
          }}
          onResume={(id) => {
            const target = memory.getSession(id);
            if (!target) { setActiveModal(null); return; }
            if (id === sessionId) {
              if (paused) {
                // Unpause the current in-memory session in place.
                appContext.togglePause();
              } else {
                appContext.showToast("Already on this session.", "info");
              }
              setActiveModal(null);
              return;
            }
            if (target.status === "completed") {
              appContext.showToast("Session completed — press enter to view results.", "info");
              setActiveModal(null);
              return;
            }
            if (supervisor && !paused && !completed) {
              appContext.showToast("Stop the current session first (/stop).", "error");
              setActiveModal(null);
              return;
            }
            setActiveModal(null);
            appContext.resumeSession(id).catch((err) => {
              pushEntry(formatSystemNotice(`Resume failed: ${(err as Error).message}`, "error"));
            });
          }}
          onDelete={(ids) => {
            const names = ids.map((id) => memory.getSession(id)?.name ?? id.slice(0, 8));
            for (const id of ids) memory.deleteSession(id);
            pushEntry({
              id: uuidv4(),
              kind: "block",
              title: `Deleted ${ids.length} session(s)`,
              lines: names.map((n) => `  ⨯ ${n}`),
              color: "error",
            });
            setActiveModal(null);
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === "login" && (
        <LoginModal
          provider={
            ((modalData as { provider?: "consensus" | "scite" | "all" } | null)?.provider) ?? "all"
          }
          onDone={(lines, success) => {
            setActiveModal(null);
            setModalData(null);
            pushEntry({
              id: uuidv4(),
              kind: "block",
              title: "Authentication",
              lines,
              color: success ? "success" : "error",
            });
          }}
        />
      )}

      {/* ── Fixed bottom: toast + bordered input + footer ─────────────── */}
      <Box flexShrink={0} flexDirection="column">
        {/* App-level toast */}
        {toastVisible && (
          <Toast
            message={toastMsg}
            type={toastType}
            visible={toastVisible}
            onDismiss={() => setToastVisible(false)}
          />
        )}

        <InputBar
          active={activeModal === null}
          appContext={appContext}
          onRoute={handleRoute}
          onPaletteChange={setPaletteOpen}
        />

        <Footer
          hasSession={hasSession}
          paused={paused}
          completed={completed}
        />
      </Box>
    </Box>
  );
}
