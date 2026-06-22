import React from "react";
import { Box, Text } from "../ink.js";
import type { CommandSuggestion } from "./CommandRouter.js";
import { useTerminalSize } from "./useTerminalSize.js";

interface CommandPaletteProps {
  suggestions: CommandSuggestion[];
  selectedIndex: number;
  visible: boolean;
}

// Hard ceiling on visible rows regardless of terminal height — keeps the
// palette compact even on very tall terminals.
const MAX_ITEMS = 8;
// Rows reserved for the prompt box, footer, indicator line, and palette border
// so the whole live region stays within the viewport.
const RESERVED_ROWS = 9;

// A flat, windowed command list. Only a bounded slice is rendered at any time
// and each row is a single truncated line, so the palette's height is capped no
// matter how many commands match — this is what keeps the REPL flicker-free.
//
// Follows x_code's list patterns:
// 1. Locked height container (flexShrink={0}) — prevents box resizing when
//    the filter narrows from 26→3 items, which would jitter layout.
// 2. Per-row scroll arrows (↑↓ on edges, ❯ on selected) — the user can see
//    that more items exist above/below without scanning the footer.
// 3. Empty-row padding — when fewer items than maxVisible, the remaining
//    rows are dim spacer lines so the box height never changes.
export function CommandPalette({ suggestions, selectedIndex, visible }: CommandPaletteProps) {
  const { rows } = useTerminalSize();

  if (!visible || suggestions.length === 0) return null;

  const total = suggestions.length;
  const maxVisible = Math.max(1, Math.min(MAX_ITEMS, rows - RESERVED_ROWS));

  // Clamp the selection into range, then window around it so the highlighted
  // row is always on-screen.
  const selected = Math.max(0, Math.min(selectedIndex, total - 1));
  const startIndex =
    total <= maxVisible
      ? 0
      : Math.max(
          0,
          Math.min(selected - Math.floor(maxVisible / 2), total - maxVisible),
        );
  const endIndex = Math.min(startIndex + maxVisible, total);
  const visibleItems = suggestions.slice(startIndex, endIndex);

  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < total;

  // Build the visible rows, adding spacer rows to fill the fixed height when
  // the slice is shorter than maxVisible.
  const rows_ = Math.min(maxVisible, endIndex - startIndex);
  const spacerCount = maxVisible - rows_;

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Locked-height list container — x_code's `Box height={visibleCount}
          flexShrink={0}` pattern. Prevents the palette from resizing when the
          filter narrows (e.g. 26→3 items), eliminating layout jitter. */}
      <Box flexDirection="column" height={maxVisible} flexShrink={0}>
        {visibleItems.map((item, i) => {
          const isFirst = i === 0;
          const isLast = i === rows_ - 1;
          const globalIndex = startIndex + i;
          const isSelected = globalIndex === selected;

          // Per-row scroll guards — show ▲ on the first visible row when more
          // items exist above, ▼ on the last when more exist below. These are
          // separate from the ❯ pointer: when a row is *selected*, the pointer
          // takes priority; when it's an *edge* row that isn't selected, the
          // scroll arrow appears instead.  x_code's ListItem does the same:
          //   - focused → figures.pointer (❯)
          //   - showScrollDown → figures.arrowDown (↓)
          //   - showScrollUp → figures.arrowUp (↑)
          //   - otherwise → " " (blank)
          const showScrollUp = isFirst && hasMoreAbove && !isSelected;
          const showScrollDown = isLast && hasMoreBelow && !isSelected;
          const glyph = isSelected ? "❯" : showScrollUp ? "↑" : showScrollDown ? "↓" : " ";

          return (
            <Text key={item.name} wrap="truncate">
              {isSelected ? (
                <Text color="inverseText" backgroundColor="text" bold>
                  {glyph} {item.name}{"  "}{item.description}
                </Text>
              ) : (
                <Text dimColor={!item.active}>
                  {glyph} {item.name}{"  "}
                  <Text dimColor>{item.description}</Text>
                </Text>
              )}
            </Text>
          );
        })}

        {/* Pad remaining rows so the container never resizes. */}
        {spacerCount > 0 &&
          Array.from({ length: spacerCount }).map((_, i) => (
            <Text key={`spacer-${i}`} dimColor>
              {" "}
            </Text>
          ))}
      </Box>

      {/* Scroll / count indicator — single fixed line. */}
      <Text dimColor wrap="truncate">
        {hasMoreAbove ? "▲" : " "}
        {hasMoreBelow ? "▼" : " "} {selected + 1}/{total} · ↑↓ select · ⏎ run · esc close
      </Text>
    </Box>
  );
}
