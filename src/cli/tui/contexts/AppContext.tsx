// React Context that replaces the prop-drilled `appContext` object.
//
// Previously App.tsx constructed a plain `AppContext` value and passed it as a
// prop to InputBar (which forwarded it to CommandRouter.route / getSuggestions).
// Every component that needed session state, the modal opener, or the toast
// helper had to receive it via props. This file exposes the same value through
// React Context so any component can read it via `useAppContext()`.
//
// The value type (`AppContextValue`) extends the narrow command-facing
// `AppContext` interface (defined in CommandRouter.ts) with the extra fields
// the React tree needs: activeModal/modalData for rendering modals, closeModal,
// completed, startTime, budgetTokens. Commands receive the narrow
// `AppContext` and remain structurally compatible (a superset is assignable to
// the subset).

import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from "react";
import type EventEmitter from "events";
import type { ContextStore } from "../../../memory/contextStore.js";
import type { SupervisorAgent } from "../../../agents/supervisor.js";
import type { ModalName } from "../CommandRouter.js";
import type { TranscriptEntry } from "../Transcript.js";
import { getTranscriptStore } from "../store/transcriptStore.js";
import { getNotificationStore } from "../store/notificationStore.js";
import { formatResults, formatSystemNotice } from "../formatters.js";
import type { SessionStartResult } from "../index.js";

// ─── Value type ────────────────────────────────────────────────────────────────

/**
 * The narrow command-facing context shape. This is the surface command
 * handlers see (`execute(args, ctx: AppContext)`). CommandRouter.ts re-exports
 * this as `AppContext` so existing imports keep working.
 */
export interface AppContext {
  memory: ContextStore;
  sessionId: string | null;
  goal: string | null;
  supervisor: SupervisorAgent | null;
  emitter: EventEmitter | null;

  openModal: (modal: ModalName, data?: unknown) => void;
  showToast: (message: string, type?: "success" | "error" | "info") => void;

  startSession: (goal: string, opts?: { name?: string; budget?: number; maxHypotheses?: number }) => Promise<void>;
  resumeSession: (sessionId: string) => Promise<void>;
  stopSession: () => void;
  togglePause: () => boolean;

  paused: boolean;
  /** Push an entry into the transcript scrollback. */
  pushEntry: (entry: TranscriptEntry) => void;
}

/**
 * The full context value consumed by the React tree. Extends the narrow
 * command-facing `AppContext` with modal state, completion state, and layout
 * metadata. Any `AppContextValue` is assignable to `AppContext`, so passing
 * the full value to command handlers is type-safe.
 */
export interface AppContextValue extends AppContext {
  closeModal: () => void;
  setModalData: (data: unknown) => void;
  /** Active modal name, or null. */
  activeModal: ModalName;
  /** Data attached to the active modal (e.g. export target sessionId). */
  modalData: unknown;

  completed: boolean;
  startTime: number | null;
  budgetTokens: number;
}

// ─── Context ───────────────────────────────────────────────────────────────────

const AppContext = createContext<AppContextValue | null>(null);

// ─── Provider props ────────────────────────────────────────────────────────────

export interface AppProviderProps {
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
  children: React.ReactNode;
}

// ─── Provider ───────────────────────────────────────────────────────────────────

export function AppProvider(props: AppProviderProps) {
  const {
    memory, budgetTokens,
    onStartSession: externalOnStartSession,
    onResumeSession: externalOnResumeSession,
    onStop: externalOnStop,
    onTogglePause: externalOnTogglePause,
    children,
  } = props;

  // ── Session lifecycle state ─────────────────────────────────────────────
  const [sessionId, setSessionId] = useState<string | null>(props.sessionId);
  const [goal, setGoal] = useState<string | null>(props.goal);
  const [supervisor, setSupervisor] = useState<SupervisorAgent | null>(props.supervisor);
  const [emitter, setEmitter] = useState<EventEmitter | null>(props.emitter);
  const [startTime, setStartTime] = useState<number | null>(props.startTime);
  const [paused, setPaused] = useState(false);
  const [completed, setCompleted] = useState(false);

  // ── Modal state ─────────────────────────────────────────────────────────
  const [activeModal, setActiveModal] = useState<ModalName>(null);
  const [modalData, setModalDataState] = useState<unknown>(null);

  // ── Stores (singletons) ────────────────────────────────────────────────
  const transcriptStore = getTranscriptStore();
  const notificationStore = getNotificationStore();

  // ── pushEntry → transcript store ───────────────────────────────────────
  const pushEntry = useCallback(
    (entry: TranscriptEntry) => transcriptStore.push(entry),
    [transcriptStore],
  );

  // ── showToast → notification store ─────────────────────────────────────
  const showToast = useCallback(
    (message: string, type: "success" | "error" | "info" = "info") => {
      const priority = type === "error" ? "high" : type === "success" ? "medium" : "low";
      notificationStore.add(message, { tone: type, priority });
    },
    [notificationStore],
  );

  const openModal = useCallback((modal: ModalName, data?: unknown) => {
    setModalDataState(data ?? null);
    setActiveModal(modal);
  }, []);

  const closeModal = useCallback(() => {
    setActiveModal(null);
  }, []);

  const setModalData = useCallback((data: unknown) => {
    setModalDataState(data);
  }, []);

  // ── Lifecycle wrappers ──────────────────────────────────────────────────
  const startSession = useCallback(
    async (goalText: string, opts?: { name?: string; budget?: number; maxHypotheses?: number }) => {
      const result = await externalOnStartSession(goalText, opts);
      setSessionId(result.sessionId);
      setGoal(goalText);
      setSupervisor(result.supervisor);
      setEmitter(result.emitter);
      setStartTime(Date.now());
      setPaused(false);
      setCompleted(false);
    },
    [externalOnStartSession],
  );

  const resumeSession = useCallback(
    async (id: string) => {
      const result = await externalOnResumeSession(id);
      setSessionId(result.sessionId);
      setGoal(result.goal);
      setSupervisor(result.supervisor);
      setEmitter(result.emitter);
      setStartTime(Date.now());
      setPaused(false);
      setCompleted(false);
    },
    [externalOnResumeSession],
  );

  const stopSession = useCallback(() => {
    externalOnStop();
    setSessionId(null);
    setGoal(null);
    setSupervisor(null);
    setEmitter(null);
    setStartTime(null);
    setPaused(false);
    setCompleted(false);
  }, [externalOnStop]);

  const togglePause = useCallback(() => {
    const np = externalOnTogglePause();
    setPaused(np);
    return np;
  }, [externalOnTogglePause]);

  // ── Session completion / error event handling ──────────────────────────
  // The provider owns `emitter` and `completed`, so it subscribes directly
  // rather than threading a markCompleted callback up to App.
  useEffect(() => {
    if (!emitter || !sessionId) return;
    const onCompleted = (_overview: string) => {
      setCompleted(true);
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

  const value = useMemo<AppContextValue>(
    () => ({
      memory,
      sessionId,
      goal,
      supervisor,
      emitter,
      openModal,
      closeModal,
      setModalData,
      activeModal,
      modalData,
      showToast,
      startSession,
      resumeSession,
      stopSession,
      togglePause,
      paused,
      completed,
      startTime,
      budgetTokens,
      pushEntry,
    }),
    [
      memory, sessionId, goal, supervisor, emitter,
      openModal, closeModal, setModalData, activeModal, modalData,
      showToast, startSession, resumeSession, stopSession, togglePause,
      paused, completed, startTime, budgetTokens, pushEntry,
    ],
  );

  return (
    <AppContext.Provider value={value}>{children}</AppContext.Provider>
  );
}

/**
 * Read the AppContext value. Must be called within an <AppProvider>.
 * Throws if used outside a provider so misuse is caught immediately.
 */
export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useAppContext must be used within an <AppProvider>");
  }
  return ctx;
}