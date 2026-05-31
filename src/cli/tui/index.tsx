import React from "react";
import { render } from "ink";
import type { EventEmitter } from "events";
import type { ContextStore } from "../../memory/contextStore.js";
import { App } from "./App.js";

export interface RenderTUIOptions {
  emitter: EventEmitter;
  memory: ContextStore;
  sessionId: string;
  goal: string;
  startTime: number;
  budgetTokens: number;
  onTogglePause: () => boolean;
  onQuit: () => void;
}

export function renderTUI(opts: RenderTUIOptions): { unmount: () => void; waitUntilExit: () => Promise<void> } {
  const instance = render(
    <App
      emitter={opts.emitter}
      memory={opts.memory}
      sessionId={opts.sessionId}
      goal={opts.goal}
      startTime={opts.startTime}
      budgetTokens={opts.budgetTokens}
      onTogglePause={opts.onTogglePause}
      onQuit={opts.onQuit}
    />
  );
  return {
    unmount: () => instance.unmount(),
    waitUntilExit: () => instance.waitUntilExit(),
  };
}
