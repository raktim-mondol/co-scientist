// Windowed transcript renderer.
//
// Previously every transcript entry was committed to Ink's <Static> scrollback
// and never re-rendered. That kept the live region small but caused the known
// viewport-jump: <Static> children render outside the live frame, so a growing
// transcript pushed the bottom-anchored input bar off-screen.
//
// VirtualMessageList renders only a bounded window of entries inside the live
// frame (flexGrow=1). The window height comes from `useLayout().transcriptMaxRows`,
// so the list never exceeds the terminal and the input bar stays pinned. It
// auto-tails to the newest entries and exposes an imperative scroll handle so
// j/k (wired via the keyboard engine / InputBar) can scroll back through
// history. A "↓ N new" indicator shows how many entries sit below the window.

import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { Box, Text } from "../ink.js";
import type { TranscriptEntry } from "./Transcript.js";
import { TranscriptItem } from "./Transcript.js";

export interface VirtualMessageListHandle {
  scrollUp: () => void;
  scrollDown: () => void;
  scrollToBottom: () => void;
}

interface VirtualMessageListProps {
  entries: TranscriptEntry[];
  /** Maximum number of entry-rows to render. From useLayout().transcriptMaxRows. */
  maxRows: number;
  /** Optional renderer override; defaults to <TranscriptItem>. */
  renderItem?: (props: { entry: TranscriptEntry; isSelected?: boolean }) => React.ReactNode;
}

export const VirtualMessageList = forwardRef<VirtualMessageListHandle, VirtualMessageListProps>(
  function VirtualMessageList({ entries, maxRows, renderItem: Item = TranscriptItem }: VirtualMessageListProps, ref) {
    const total = entries.length;
    const windowSize = Math.max(1, maxRows);
    const maxOffset = Math.max(0, total - windowSize);
    const [offset, setOffset] = useState(maxOffset);

    // Track whether the user is pinned to the bottom *before* new entries
    // arrive, so we can auto-tail only when they were already watching the
    // latest output (not scrolled back reading history).
    const wasAtBottomRef = useRef(true);

    // Clamp offset into range when the entry count or window changes.
    const effOffset = Math.min(offset, maxOffset);
    const atBottom = effOffset >= maxOffset;

    // Auto-tail: when new entries land and the user was at the bottom, keep
    // them pinned to the bottom. Declared before the wasAtBottomRef sync so
    // the ref still holds the previous-tick value when this runs.
    useEffect(() => {
      if (wasAtBottomRef.current) setOffset(maxOffset);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [maxOffset]);

    useEffect(() => {
      wasAtBottomRef.current = atBottom;
    }, [atBottom]);

    useImperativeHandle(ref, () => ({
      scrollUp: () => setOffset((o) => Math.max(0, o - 1)),
      scrollDown: () => setOffset((o) => Math.min(maxOffset, o + 1)),
      scrollToBottom: () => setOffset(maxOffset),
    }));

    const visible = entries.slice(effOffset, effOffset + windowSize);
    const newBelow = atBottom ? 0 : Math.max(0, total - (effOffset + windowSize));

    return (
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visible.map((entry) => (
          <Box key={entry.id} flexDirection="column">
            <Item entry={entry} />
          </Box>
        ))}
        {newBelow > 0 && (
          <Box paddingX={1}>
            <Text color="claude" bold>↓ {newBelow} new</Text>
            <Text dimColor> · press j to scroll down</Text>
          </Box>
        )}
      </Box>
    );
  },
);