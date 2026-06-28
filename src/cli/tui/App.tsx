import React, { useState, useMemo, useCallback, useRef } from "react";
import { Box, useApp, Static } from "../ink.js";
import { AppProvider, useAppContext } from "./contexts/AppContext.js";
import { NotificationProvider } from "./contexts/NotificationContext.js";
import { useEventDrivenSessionData } from "./hooks/useEventDrivenSessionData.js";
import { useTranscript } from "./hooks/useTranscript.js";
import { useLayout } from "./hooks/useLayout.js";
import { useKeyboardEngine } from "./hooks/useKeyboardEngine.js";
import { WelcomeBox } from "./WelcomeBox.js";
import { FullscreenLayout } from "./FullscreenLayout.js";
import { VirtualMessageList } from "./VirtualMessageList.js";
import type { VirtualMessageListHandle } from "./VirtualMessageList.js";
import { LiveStatus } from "./LiveStatus.js";
import type { SessionState } from "./LiveStatus.js";
import { InputBar } from "./InputBar.js";
import { Footer } from "./Footer.js";
import { NotificationBar } from "./NotificationBar.js";
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
import { formatUserGoal, formatSystemNotice, formatResults, formatSessionResults, formatOverview } from "./formatters.js";
import type { RouteResult } from "./CommandRouter.js";
import type { AppProviderProps } from "./contexts/AppContext.js";

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

export type AppProps = AppProviderProps;

export function App(props: AppProps) {
  return (
    <AppProvider {...props}>
      <NotificationProvider>
        <AppInner />
      </NotificationProvider>
    </AppProvider>
  );
}

function AppInner() {
  const ctx = useAppContext();
  const {
    memory, sessionId, goal, supervisor, emitter, startTime, budgetTokens,
    paused, completed, activeModal, modalData,
    openModal, closeModal, setModalData, showToast,
    startSession, resumeSession, togglePause, pushEntry,
  } = ctx;
  const { exit } = useApp();

  const hasSession = sessionId !== null;

  // ── Event-driven session data (replaces polling useSessionData) ─────────
  const { stats, leaderboard, now } = useEventDrivenSessionData(
    emitter,
    memory,
    sessionId,
    pushEntry,
  );

  // ── Transcript (read from transcriptStore) ──────────────────────────────
  const transcript = useTranscript();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [selected, setSelected] = useState(0);

  const selectedHyp = leaderboard[selected];

  // ── Layout (adaptive to terminal size) + virtual list ref ───────────────
  const listRef = useRef<VirtualMessageListHandle>(null);
  const layout = useLayout({
    sessionActive: hasSession,
    leaderboardRows: leaderboard.length,
    compact: paletteOpen,
  });

  // ── Keyboard engine (schema-driven, context-aware) ─────────────────────
  // `global` context when idle (ctrl+p pause), `modal` context when a modal
  // is open (esc closes it). j/k transcript navigation is handled in InputBar
  // (gated on empty input) so it never conflicts with text entry.
  useKeyboardEngine({
    context: activeModal ? "modal" : "global",
    actions: {
      togglePause: () => togglePause(),
      closeOverlay: () => closeModal(),
    },
  });

  // Derived session state for LiveStatus.
  const sessionState: SessionState = !hasSession
    ? null
    : completed
      ? "completed"
      : paused
        ? "paused"
        : "running";

  // ── Echo helper for direct startSession calls (RunModal / free text) ────
  // The /run command path returns its own transcript entries via handleRoute,
  // so it does not use this helper (avoids double-echoing).
  const startSessionWithEcho = useCallback(
    async (goalText: string, opts?: { name?: string; budget?: number; maxHypotheses?: number }) => {
      pushEntry(formatUserGoal(goalText));
      await startSession(goalText, opts);
      pushEntry(formatSystemNotice("Session started.", "success"));
    },
    [pushEntry, startSession],
  );

  // ── Memoized lists for modals ──────────────────────────────────────────
  const allHypotheses = useMemo(
    () => (sessionId ? memory.getAllActiveHypotheses(sessionId) : []),
    [sessionId, memory, stats],
  );

  const allSessions = useMemo(
    () => memory.listSessions(),
    [memory],
  );

  // ── Route handler ──────────────────────────────────────────────────────
  const handleRoute = (result: RouteResult | { type: "session_start"; goal: string }) => {
    switch (result.type) {
      case "transcript":
        // Entries are the persistent verbose output.  `message` (when set) is
        // a brief toast-only confirmation — don't push a duplicate entry.
        for (const entry of result.entries) pushEntry(entry);
        if (result.message) showToast(result.message, "success");
        break;
      case "modal":
        openModal(result.modal, result.data ?? null);
        if (result.message) showToast(result.message, "info");
        break;
      case "session_start":
        startSessionWithEcho(result.goal);
        break;
      case "exit":
        exit();
        break;
      case "error":
        // Error messages were toast-only (no transcript entry), so they
        // vanished after the 3s notification TTL.  Persist them so the user
        // can read the error while correcting their input.
        if (result.message) {
          pushEntry(formatSystemNotice(result.message, "error"));
        }
        break;
      case "immediate":
        // Same as error — immediate feedback with a message should persist
        // so it doesn't disappear before the user can act on it.
        if (result.message) {
          pushEntry(formatSystemNotice(result.message, "success"));
        }
        break;
    }
  };

  // ── Render: fullscreen layout ─────────────────────────────────────────
  // The welcome banner is the only <Static> item (one-time scrollback).
  // The transcript lives in the live frame via VirtualMessageList so it can
  // no longer push the input bar off-screen (the viewport-jump bug). The
  // virtual list renders only a bounded window of entries, keeping re-render
  // cost bounded on every progress tick.
  return (
    <>
      {/* ── Welcome banner (Static: print-and-forget) ─────────────────── */}
      <Static items={[
        <Box key="welcome_static" flexDirection="column">
          <WelcomeBox />
        </Box>,
      ]}>
        {(item) => item}
      </Static>

      <FullscreenLayout
        status={
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
        }
        scrollable={
          <VirtualMessageList
            ref={listRef}
            entries={transcript}
            maxRows={layout.transcriptMaxRows}
          />
        }
        modal={
          <>
            {activeModal === "kill" && selectedHyp && (
              <KillModal
                title={selectedHyp.title}
                onConfirm={() => {
                  killHypothesis(memory, selectedHyp.id);
                  pushEntry(formatSystemNotice(`Killed: ${selectedHyp.title.slice(0, 40)}`));
                  closeModal();
                }}
                onCancel={closeModal}
              />
            )}
            {activeModal === "boost" && selectedHyp && (
              <BoostModal
                title={selectedHyp.title}
                currentElo={selectedHyp.eloRating}
                onConfirm={(newElo) => {
                  boostHypothesis(memory, selectedHyp.id, newElo);
                  pushEntry(formatSystemNotice(`Boosted ${selectedHyp.title.slice(0, 40)} to Elo ${newElo}`));
                  closeModal();
                }}
                onCancel={closeModal}
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
                  closeModal();
                }}
                onCancel={closeModal}
              />
            )}
            {activeModal === "run" && (
              <RunModal
                onConfirm={async (goalText, name) => {
                  closeModal();
                  await startSessionWithEcho(goalText, name ? { name } : undefined);
                }}
                onCancel={closeModal}
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
                  closeModal();
                }}
                onCancel={closeModal}
              />
            )}
            {activeModal === "strategy" && (
              <StrategyModal
                weights={supervisor?.getCurrentWeights() ?? {
                  generation: 1, reflection: 0, ranking: 0,
                  evolution: 0, proximity: 0, meta_review: 0,
                }}
                onCancel={closeModal}
              />
            )}

            {/* Action modals */}
            {activeModal === "export" && (
              <ExportModal
                onConfirm={(format, outputPath) => {
                  const targetId = (modalData as { sessionId?: string } | null)?.sessionId ?? sessionId!;
                  closeModal();
                  setModalData(null);
                  exportCommand(targetId, { format, output: outputPath }).then(() => {
                    pushEntry(formatSystemNotice(`Session exported as ${format}.`, "success"));
                  }).catch((err) => {
                    pushEntry(formatSystemNotice(`Export failed: ${(err as Error).message}`, "error"));
                  });
                }}
                onCancel={() => { closeModal(); setModalData(null); }}
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
                  closeModal();
                }}
                onCancel={closeModal}
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
                onCancel={closeModal}
              />
            )}
            {activeModal === "sessions" && (
              <SessionsModal
                sessions={allSessions}
                activeSessionId={sessionId}
                onView={(id) => {
                  pushEntry(formatSessionResults(memory, id));
                  closeModal();
                }}
                onOverview={(id) => {
                  for (const entry of formatOverview(memory, id)) pushEntry(entry);
                  closeModal();
                }}
                onExport={(id) => {
                  openModal("export", { sessionId: id });
                }}
                onResume={(id) => {
                  const target = memory.getSession(id);
                  if (!target) { closeModal(); return; }
                  if (id === sessionId) {
                    if (paused) {
                      togglePause();
                    } else {
                      showToast("Already on this session.", "info");
                    }
                    closeModal();
                    return;
                  }
                  if (target.status === "completed") {
                    showToast("Session completed — press enter to view results.", "info");
                    closeModal();
                    return;
                  }
                  if (supervisor && !paused && !completed) {
                    showToast("Stop the current session first (/stop).", "error");
                    closeModal();
                    return;
                  }
                  closeModal();
                  resumeSession(id).catch((err) => {
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
                  closeModal();
                }}
                onCancel={closeModal}
              />
            )}
            {activeModal === "login" && (
              <LoginModal
                provider={
                  ((modalData as { provider?: "consensus" | "scite" | "all" } | null)?.provider) ?? "all"
                }
                onDone={(lines, success) => {
                  closeModal();
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
          </>
        }
        bottom={
          <>
            <NotificationBar />
            <InputBar
              active={activeModal === null}
              onRoute={handleRoute}
              onPaletteChange={setPaletteOpen}
              onScrollUp={() => listRef.current?.scrollUp()}
              onScrollDown={() => listRef.current?.scrollDown()}
            />
            <Footer
              hasSession={hasSession}
              paused={paused}
              completed={completed}
            />
          </>
        }
      />
    </>
  );
}