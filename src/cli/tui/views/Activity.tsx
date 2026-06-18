import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { AppContext } from "../CommandRouter.js";

interface ActivityProps {
  appContext: AppContext;
  focus: boolean;
}

const MAX_DISPLAY = 30;

const TYPE_COLORS: Record<string, string> = {
  llm_call: "blue",
  search: "green",
  tool_call: "magenta",
  generation: "cyan",
  reflection: "yellow",
  ranking: "yellow",
  evolution: "magenta",
  meta_review: "white",
  experiment_design: "green",
  proximity: "blue",
  knowledge_graph: "cyan",
  session_lifecycle: "gray",
  report: "white",
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
        <Text color="gray">No activity recorded for this session.</Text>
      </Box>
    );
  }

  const visible = entries.slice(scroll, scroll + MAX_DISPLAY);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text color="cyan" bold>
        Activity Log ({entries.length} entries, showing {scroll + 1}-{Math.min(scroll + MAX_DISPLAY, entries.length)})
      </Text>
      {maxScroll > 0 && (
        <Text color="gray">Scroll: ▲▼ arrows (offset {scroll}/{maxScroll})</Text>
      )}

      {visible.map((e) => {
        const color = TYPE_COLORS[e.type] ?? "gray";
        const tokens =
          e.tokensIn !== null || e.tokensOut !== null
            ? ` [${e.tokensIn ?? 0}↑ ${e.tokensOut ?? 0}↓]`
            : "";
        return (
          <Box key={e.id}>
            <Text color="gray">[{e.createdAt.toISOString().slice(11, 19)}] </Text>
            <Text color={color}>{e.agent.padEnd(14)}</Text>
            <Text color="gray"> {e.type.padEnd(18)}</Text>
            <Text color="white">{e.message.slice(0, 60)}</Text>
            <Text color="gray">{tokens}</Text>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text color="gray">[▲▼] scroll  [/] return to input</Text>
      </Box>
    </Box>
  );
}
