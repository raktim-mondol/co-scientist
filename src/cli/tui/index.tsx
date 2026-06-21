import React from "react";
import { render } from "../ink.js";
import type { EventEmitter } from "events";
import type { ContextStore } from "../../memory/contextStore.js";
import type { SupervisorAgent } from "../../agents/supervisor.js";
import { App } from "./App.js";

// Bun compat: ensure process.stdin has isTTY and setRawMode.
// Ink needs these for keyboard input handling.
function ensureStdinCompat() {
  const s = process.stdin as Record<string, unknown>;
  const isTTY = s.isTTY === true
    || process.stdout.isTTY === true
    || (typeof process.stdout.columns === "number" && process.stdout.columns > 0);
  if (!s.isTTY) (s as any).isTTY = isTTY;
  if (typeof s.setRawMode !== "function") (s as any).setRawMode = (_enable: boolean) => {};
}
ensureStdinCompat();

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
  onResumeSession: (sessionId: string) => Promise<SessionStartResult & { goal: string }>;
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
      onResumeSession={opts.onResumeSession}
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
