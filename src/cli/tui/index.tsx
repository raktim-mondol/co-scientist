import React from "react";
import { render } from "ink";
import type { EventEmitter } from "events";
import type { ContextStore } from "../../memory/contextStore.js";
import type { SupervisorAgent } from "../../agents/supervisor.js";
import { App } from "./App.js";

/** Returned by onStartSession so the TUI can update its internal session state. */
export interface SessionStartResult {
  sessionId: string;
  supervisor: SupervisorAgent;
  emitter: EventEmitter;
}

export interface RenderTUIOptions {
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

export function renderTUI(opts: RenderTUIOptions): { unmount: () => void; waitUntilExit: () => Promise<void> } {
  const instance = render(
    <App
      memory={opts.memory}
      sessionId={opts.sessionId}
      goal={opts.goal}
      supervisor={opts.supervisor}
      emitter={opts.emitter}
      startTime={opts.startTime}
      budgetTokens={opts.budgetTokens}
      onStartSession={opts.onStartSession}
      onStop={opts.onStop}
      onTogglePause={opts.onTogglePause}
      onQuit={opts.onQuit}
    />,
  );
  return {
    unmount: () => instance.unmount(),
    waitUntilExit: () => instance.waitUntilExit(),
  };
}
