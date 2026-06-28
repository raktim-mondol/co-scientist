import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "../ink.js";
import { CommandPalette } from "./CommandPalette.js";
import type { RouteResult } from "./CommandRouter.js";
import { getSuggestions, route } from "./CommandRouter.js";
import { useAppContext } from "./contexts/AppContext.js";

interface InputBarProps {
  active: boolean;
  onRoute: (result: RouteResult | { type: "session_start"; goal: string }) => void;
  /** Notifies the parent when the command palette opens/closes, so it can
   *  collapse the live status region and keep the frame within the viewport. */
  onPaletteChange?: (open: boolean) => void;
  /** j (empty input) → scroll transcript down. */
  onScrollDown?: () => void;
  /** k (empty input) → scroll transcript up. */
  onScrollUp?: () => void;
}

export function InputBar({ active, onRoute, onPaletteChange, onScrollDown, onScrollUp }: InputBarProps) {
  const appContext = useAppContext();
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [paletteDismissed, setPaletteDismissed] = useState(false);
  const [paletteIndex, setPaletteIndex] = useState(0);

  // Compute suggestions from partial input
  const suggestions = text.startsWith("/") ? getSuggestions(text, appContext) : [];
  const paletteVisible = text.startsWith("/") && suggestions.length > 0 && !paletteDismissed;

  // Keep the highlighted index within the (possibly narrowed) suggestion list.
  const safeIndex = suggestions.length > 0 ? Math.min(paletteIndex, suggestions.length - 1) : 0;

  // Reset palette dismissal when text changes
  useEffect(() => {
    setPaletteDismissed(false);
    setPaletteIndex(0);
  }, [text]);

  // Tell the parent whether the palette is showing (active gates it too, so a
  // modal opening hides it). Lets App collapse the leaderboard while choosing.
  useEffect(() => {
    onPaletteChange?.(paletteVisible && active);
  }, [paletteVisible, active, onPaletteChange]);

  // Clamp cursor to text length
  useEffect(() => {
    if (cursor > text.length) setCursor(text.length);
  }, [text, cursor]);

  // Blink the caret on a ~530ms cadence ONLY when the TUI is truly idle
  // (no session, no palette).  During any session state the blink re-render
  // would interact with Spinner ticks, progress events, and leaderboard
  // refreshes to produce visible flicker in the transcript and menus.
  //
  // When the palette is open the user is browsing suggestions so the blink
  // is unnecessary and would re-render CommandPalette on every tick.
  const idle = !appContext.sessionId;
  useEffect(() => {
    if (paletteVisible || !idle) {
      setCursorVisible(true);
      return;
    }
    setCursorVisible(true);
    const id = setInterval(() => setCursorVisible((v) => !v), 530);
    return () => clearInterval(id);
  }, [paletteVisible, idle]);

  useInput(
    (input, key) => {
      // Escape: close palette first, otherwise no-op (global keyboard
      // engine handles modal close via `esc`).
      if (key.escape) {
        if (paletteVisible) {
          setPaletteDismissed(true);
          return;
        }
        return;
      }

      // Tab: auto-complete the highlighted palette suggestion
      if (key.tab) {
        if (paletteVisible && suggestions[safeIndex]) {
          const completed = suggestions[safeIndex].name;
          setText(completed);
          setCursor(completed.length);
          setPaletteDismissed(true);
        }
        return;
      }

      // Up/Down arrows: navigate palette when open (wraps at both ends)
      if (key.upArrow) {
        if (paletteVisible) {
          setPaletteIndex(safeIndex > 0 ? safeIndex - 1 : suggestions.length - 1);
        }
        return;
      }
      if (key.downArrow) {
        if (paletteVisible) {
          setPaletteIndex(safeIndex < suggestions.length - 1 ? safeIndex + 1 : 0);
        }
        return;
      }

      // Enter: submit the highlighted palette suggestion or raw text
      if (key.return) {
        const cmd =
          paletteVisible && suggestions[safeIndex]
            ? suggestions[safeIndex].name
            : text;
        if (!cmd.trim()) return;
        setText("");
        setCursor(0);
        // All output (transcript entries, errors, toasts) is now handled
        // centrally in App's handleRoute so nothing disappears or duplicates.
        route(cmd, appContext).then(onRoute);
        return;
      }

      // Backspace: remove character before cursor
      if (key.backspace || key.delete) {
        if (cursor > 0) {
          setText((v) => v.slice(0, cursor - 1) + v.slice(cursor));
          setCursor((c) => c - 1);
        }
        return;
      }

      // Left / Right arrows
      if (key.leftArrow) {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.rightArrow) {
        setCursor((c) => Math.min(text.length, c + 1));
        return;
      }

      // Ctrl+A / Ctrl+E: jump to start / end
      if (key.ctrl && input === "a") {
        setCursor(0);
        return;
      }
      if (key.ctrl && input === "e") {
        setCursor(text.length);
        return;
      }

      // j/k transcript navigation when the input is empty. As soon as the user
      // types anything, j/k become text characters — no conflict with entry.
      if (!text && input === "j" && !key.ctrl && !key.meta) { onScrollDown?.(); return; }
      if (!text && input === "k" && !key.ctrl && !key.meta) { onScrollUp?.(); return; }

      // Printable characters: insert at cursor
      if (input && !key.ctrl && !key.meta && input.length === 1 && input >= " ") {
        setText((v) => v.slice(0, cursor) + input + v.slice(cursor));
        setCursor((c) => c + 1);
      }
    },
    { isActive: active },
  );

  return (
    <Box flexDirection="column" backgroundColor="bg">
      {/* Rounded bordered prompt — x_code style.
          Uses borderFocus (brand) border when the palette is open or text is being
          typed, and promptBorder (gray) otherwise — a subtle focus affordance. */}
      <Box
        borderStyle="round"
        borderColor={paletteVisible || text.length > 0 ? "borderFocus" : "promptBorder"}
        backgroundColor="bg"
        paddingX={1}
      >
        <Text color="claude" bold backgroundColor="bg">&gt; </Text>
        <Text color="text" backgroundColor="bg">{text.slice(0, cursor)}</Text>
        {cursor < text.length ? (
          cursorVisible ? (
            <Text color="inverseText" backgroundColor="text">{text[cursor]}</Text>
          ) : (
            <Text color="text" backgroundColor="bg">{text[cursor]}</Text>
          )
        ) : (
          <Text color="text" backgroundColor="bg">{cursorVisible ? "▌" : " "}</Text>
        )}
        <Text color="text" backgroundColor="bg">{text.slice(cursor + 1)}</Text>
      </Box>

      {paletteVisible && (
        <CommandPalette
          suggestions={suggestions}
          selectedIndex={safeIndex}
          visible={paletteVisible}
        />
      )}
    </Box>
  );
}