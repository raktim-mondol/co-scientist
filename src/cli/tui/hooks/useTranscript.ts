// React subscription to the transcript store.
//
// The transcript lives in `transcriptStore` (Phase 1) so that `pushEntry` can
// be called from anywhere (commands, the AppProvider, event handlers) without
// threading React state. This hook subscribes to the store and re-renders the
// component when entries are appended.

import { useState, useEffect } from "react";
import { getTranscriptStore } from "../store/transcriptStore.js";
import type { TranscriptEntry } from "../Transcript.js";

export function useTranscript(): TranscriptEntry[] {
  const store = getTranscriptStore();
  const [entries, setEntries] = useState<TranscriptEntry[]>(() => store.getState().entries);

  useEffect(() => {
    const unsub = store.subscribe(() => setEntries(store.getState().entries));
    setEntries(store.getState().entries);
    return unsub;
  }, [store]);

  return entries;
}