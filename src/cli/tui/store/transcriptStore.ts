// Append-only transcript entry store with subscribe.
// Enables event-driven transcript updates without React state threading.
//
// The store holds the array of TranscriptEntry objects that were
// previously managed as React state inside App.tsx. Components can
// subscribe to be notified when new entries are pushed.

import { createStore } from "./store.js";
import type { TranscriptEntry } from "../Transcript.js";

export interface TranscriptState {
  entries: TranscriptEntry[];
}

function createTranscriptStore() {
  const store = createStore<TranscriptState>({ entries: [] });

  /** Append one or more entries to the transcript. */
  function push(...entries: TranscriptEntry[]): void {
    if (entries.length === 0) return;
    store.setState((s) => ({
      entries: [...s.entries, ...entries],
    }));
  }

  /** Replace all entries (used when clearing or loading history). */
  function replace(entries: TranscriptEntry[]): void {
    store.setState({ entries });
  }

  /** Clear all transcript entries. */
  function clear(): void {
    store.setState({ entries: [] });
  }

  return {
    ...store,
    push,
    replace,
    clear,
  };
}

export type TranscriptStore = ReturnType<typeof createTranscriptStore>;

// Singleton for the TUI session. Reset between sessions.
let _instance: TranscriptStore | null = null;

export function getTranscriptStore(): TranscriptStore {
  if (!_instance) _instance = createTranscriptStore();
  return _instance;
}

/** Reset the singleton (called when a new TUI session starts). */
export function resetTranscriptStore(): void {
  _instance = null;
}
