import React from "react";
import { Box, Text } from "../ink.js";
import { KEYBOARD_BINDINGS } from "./hooks/useKeyboardEngine.js";
import type { KeyContext } from "./hooks/useKeyboardEngine.js";

// One-line keybinding hint row under the bordered prompt.
// Context-aware: shows different command hints when idle vs running vs paused.
// Keybinding hints are derived from the keyboard engine schema so they stay
// in sync with the actual key bindings (Phase 5 — useKeyboardEngine for hints).
interface FooterProps {
  hasSession: boolean;
  paused: boolean;
  completed: boolean;
}

/** Return the set of keybinding descriptions active for a given context. */
function keyHintsForContext(context: KeyContext): string[] {
  return KEYBOARD_BINDINGS
    .filter((b) => b.context === context)
    .map((b) => desc(b.keys, b.description));
}

function desc(keys: string[], description: string): string {
  return `${keys.join("/")} ${description}`;
}

export function Footer({ hasSession, paused, completed }: FooterProps) {
  // ── Slash-command hints (contextual, existing behavior) ─────────────────
  let cmdHints: string[];
  if (completed) {
    cmdHints = ["/results", "/overview", "/graph", "/activity", "/run", "/quit"];
  } else if (paused) {
    cmdHints = ["/sessions", "/results", "/graph", "/activity", "/stop"];
  } else if (hasSession) {
    cmdHints = ["/pause", "/results", "/overview", "/graph", "/compare", "/diff"];
  } else {
    cmdHints = ["/run", "/help", "/sessions", "/theme", "/quit"];
  }

  // ── Keybinding hints (derived from keyboard engine schema) ─────────────
  const globalHints = keyHintsForContext("global");
  const allKeyHints = [...globalHints, "esc close"];

  return (
    <Box paddingX={1} flexDirection="column">
      {/* Slash-command hints */}
      <Box>
        {cmdHints.map((h, i) => (
          <React.Fragment key={h}>
            <Text color="suggestion">{h}</Text>
            {i < cmdHints.length - 1 && <Text dimColor>  </Text>}
          </React.Fragment>
        ))}
        <Text dimColor>  ↵ send</Text>
      </Box>
      {/* Keybinding hints — derived from keyboard engine schema */}
      <Box>
        <Text dimColor>{allKeyHints.join(" · ")}</Text>
      </Box>
    </Box>
  );
}