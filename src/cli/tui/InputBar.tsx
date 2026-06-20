import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "../ink.js";
import { Toast } from "./Toast.js";
import { CommandPalette } from "./CommandPalette.js";
import type { AppContext, RouteResult } from "./CommandRouter.js";
import { getSuggestions, route } from "./CommandRouter.js";

interface InputBarProps {
  active: boolean;
  appContext: AppContext;
  onRoute: (result: RouteResult | { type: "session_start"; goal: string }) => void;
}

export function InputBar({ active, appContext, onRoute }: InputBarProps) {
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [toastMessage, setToastMessage] = useState("");
  const [toastType, setToastType] = useState<"success" | "error" | "info">("info");
  const [toastVisible, setToastVisible] = useState(false);
  const [toastKey, setToastKey] = useState(0);
  const [paletteDismissed, setPaletteDismissed] = useState(false);
  const [paletteIndex, setPaletteIndex] = useState(0);

  // Compute suggestions from partial input
  const suggestions = text.startsWith("/") ? getSuggestions(text, appContext) : [];
  const paletteVisible = text.startsWith("/") && suggestions.length > 0 && !paletteDismissed;

  // Reset palette dismissal when text changes
  useEffect(() => {
    setPaletteDismissed(false);
    setPaletteIndex(0);
  }, [text]);

  // Clamp cursor to text length
  useEffect(() => {
    if (cursor > text.length) setCursor(text.length);
  }, [text, cursor]);

  // Local toast helper
  const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
    if (toastVisible) {
      setToastVisible(false);
    }
    setTimeout(() => {
      setToastMessage(message);
      setToastType(type);
      setToastKey((k) => k + 1);
      setToastVisible(true);
    }, 0);
  };

  const dismissToast = () => setToastVisible(false);

  useInput(
    (input, key) => {
      // Escape: close palette first, then dismiss toast, otherwise close modal
      if (key.escape) {
        if (paletteVisible) {
          setPaletteDismissed(true);
          return;
        }
        if (toastVisible) {
          dismissToast();
          return;
        }
        return;
      }

      // Tab: auto-complete the highlighted palette suggestion
      if (key.tab) {
        if (paletteVisible && suggestions[paletteIndex]) {
          const completed = suggestions[paletteIndex].name;
          setText(completed);
          setCursor(completed.length);
          setPaletteDismissed(true);
        }
        return;
      }

      // Up/Down arrows: navigate palette when open
      if (key.upArrow) {
        if (paletteVisible) {
          setPaletteIndex((i) => (i > 0 ? i - 1 : suggestions.length - 1));
        }
        return;
      }
      if (key.downArrow) {
        if (paletteVisible) {
          setPaletteIndex((i) => (i < suggestions.length - 1 ? i + 1 : 0));
        }
        return;
      }

      // Enter: submit the highlighted palette suggestion or raw text
      if (key.return) {
        const cmd =
          paletteVisible && suggestions[paletteIndex]
            ? suggestions[paletteIndex].name
            : text;
        if (!cmd.trim()) return;
        setText("");
        setCursor(0);
        route(cmd, appContext).then((result) => {
          if ((result.type === "immediate" || result.type === "error") && result.message) {
            showToast(result.message, result.type === "error" ? "error" : "success");
          }
          onRoute(result);
        });
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

      // Printable characters: insert at cursor
      if (input && !key.ctrl && !key.meta && input.length === 1 && input >= " ") {
        setText((v) => v.slice(0, cursor) + input + v.slice(cursor));
        setCursor((c) => c + 1);
      }
    },
    { isActive: active },
  );

  return (
    <Box flexDirection="column">
      {toastVisible && (
        <Toast
          key={toastKey}
          message={toastMessage}
          type={toastType}
          visible={toastVisible}
          onDismiss={dismissToast}
        />
      )}

      {/* Rounded bordered prompt — x_code style */}
      <Box borderStyle="round" borderColor="claude" paddingX={1}>
        <Text color="claude" bold>&gt; </Text>
        <Text color="text">{text.slice(0, cursor)}</Text>
        {cursor < text.length ? (
          <Text color="inverseText" backgroundColor="text">{text[cursor]}</Text>
        ) : (
          <Text color="text">▌</Text>
        )}
        <Text color="text">{text.slice(cursor + 1)}</Text>
      </Box>

      {paletteVisible && (
        <CommandPalette
          suggestions={suggestions}
          selectedIndex={paletteIndex}
          visible={paletteVisible}
        />
      )}
    </Box>
  );
}
