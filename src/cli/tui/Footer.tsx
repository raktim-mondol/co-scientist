import React from "react";
import { Box, Text } from "../ink.js";

// One-line keybinding hint row under the bordered prompt.
// Context-aware: shows different hints when idle vs running vs paused.
interface FooterProps {
  hasSession: boolean;
  paused: boolean;
  completed: boolean;
}

export function Footer({ hasSession, paused, completed }: FooterProps) {
  let hints: string[];
  if (completed) {
    hints = ["/results", "/overview", "/graph", "/activity", "/run", "/quit"];
  } else if (paused) {
    hints = ["/resume", "/results", "/graph", "/activity", "/stop"];
  } else if (hasSession) {
    hints = ["/pause", "/results", "/overview", "/graph", "/compare", "/diff"];
  } else {
    hints = ["/run", "/help", "/sessions", "/quit"];
  }

  return (
    <Box paddingX={1}>
      {hints.map((h, i) => (
        <React.Fragment key={h}>
          <Text color="suggestion">{h}</Text>
          {i < hints.length - 1 && <Text dimColor>  </Text>}
        </React.Fragment>
      ))}
      <Text dimColor>  esc menu  ↵ send</Text>
    </Box>
  );
}
