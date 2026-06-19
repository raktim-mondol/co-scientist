import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "../../ink.js";
import type { AppContext } from "../CommandRouter.js";

interface ActivityProps {
  appContext: AppContext;
  focus: boolean;
}

const MAX_DISPLAY = 30;

const TYPE_COLORS: Record<string, string> = {
  llm_call: "permission",
  search: "success",
  tool_call: "suggestion",
  generation: "claude",
  reflection: "warning",
  ranking: "warning",
  evolution: "suggestion",
  meta_review: "text",
  experiment_design: "success",
  proximity: "permission",
  knowledge_graph: "claude",
  session_lifecycle: "inactive",
  report: "text",
};

/**
 * Chronological activity log for the session — shows what agents did and when.
 */
export function Activity({ appContext, focus }: ActivityProps) {
  const entries = useMemo(
    () => (appContext.sessionId ? appContext.memory.getSessionActivity(appContext.sessionId) : []),
    [appContext.sessionId, appContext.memory],
  );

  const [scroll, setScroll] = useState(0);
  const maxScroll = Math.max(0, entries.length - MAX_DISPLAY);

  useInput(
    (input, key) => {
      if (key.upArrow) setScroll((s) => Math.max(0, s - 1));
      else if (key.downArrow) setScroll((s) => Math.min(maxScroll, s + 1));
      else if (input === "/") {
        // Focus returns to InputBar
      }
    },
    { isActive: focus && entries.length > 0 },
  );

  if (entries.length === 0) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text dimColor>No activity recorded for this session.</Text>
      </Box>
    );
  }

  const visible = entries.slice(scroll, scroll + MAX_DISPLAY);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text color="claude" bold>
        Activity Log ({entries.length} entries, showing {scroll + 1}-{Math.min(scroll + MAX_DISPLAY, entries.length)})
      </Text>
      {maxScroll > 0 && (
        <Text dimColor>Scroll: ▲▼ arrows (offset {scroll}/{maxScroll})</Text>
      )}

      {visible.map((e) => {
        const color = TYPE_COLORS[e.type] ?? "inactive";
        const tokens =
          e.tokensIn !== null || e.tokensOut !== null
            ? ` [${e.tokensIn ?? 0}↑ ${e.tokensOut ?? 0}↓]`
            : "";
        return (
          <Box key={e.id}>
            <Text dimColor>[{e.createdAt.toISOString().slice(11, 19)}] </Text>
            <Text color={color}>{e.agent.padEnd(14)}</Text>
            <Text dimColor> {e.type.padEnd(18)}</Text>
            <Text color="text">{e.message.slice(0, 60)}</Text>
            <Text dimColor>{tokens}</Text>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text dimColor>[▲▼] scroll  [/] return to input</Text>
      </Box>
    </Box>
  );
}
