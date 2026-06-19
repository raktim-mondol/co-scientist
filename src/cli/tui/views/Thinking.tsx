import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "../../ink.js";
import type { AppContext } from "../CommandRouter.js";

interface ThinkingProps {
  appContext: AppContext;
  focus: boolean;
}

const MAX_DISPLAY = 50;

/**
 * Displays thinking traces from the session — reasoning excerpts logged by agents.
 * Scrollable list with timestamps and truncated content.
 */
export function Thinking({ appContext, focus }: ThinkingProps) {
  const traces = useMemo(
    () => (appContext.sessionId ? appContext.memory.getThinkingTraces(appContext.sessionId) : []),
    [appContext.sessionId, appContext.memory],
  );

  const [scroll, setScroll] = useState(0);
  const maxScroll = Math.max(0, traces.length - MAX_DISPLAY);

  useInput(
    (input, key) => {
      if (key.upArrow) setScroll((s) => Math.max(0, s - 1));
      else if (key.downArrow) setScroll((s) => Math.min(maxScroll, s + 1));
      else if (input === "/") {
        // Focus returns to InputBar
      }
    },
    { isActive: focus && traces.length > 0 },
  );

  if (traces.length === 0) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text dimColor>No thinking traces recorded for this session.</Text>
      </Box>
    );
  }

  const visible = traces.slice(scroll, scroll + MAX_DISPLAY);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text color="claude" bold>
        Thinking Traces ({traces.length} total, showing {scroll + 1}-{Math.min(scroll + MAX_DISPLAY, traces.length)})
      </Text>
      {maxScroll > 0 && (
        <Text dimColor>Scroll: ▲▼ arrows (offset {scroll}/{maxScroll})</Text>
      )}

      {visible.map((t) => (
        <Box key={t.id} flexDirection="column" marginTop={1}>
          <Text color="warning">
            [{t.createdAt.toISOString().slice(11, 19)}] {t.agent} ({t.tokens.toLocaleString()} tok)
          </Text>
          <Text color="text">{t.reasoning.slice(0, 200)}{t.reasoning.length > 200 ? "…" : ""}</Text>
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>[▲▼] scroll  [/] return to input</Text>
      </Box>
    </Box>
  );
}
