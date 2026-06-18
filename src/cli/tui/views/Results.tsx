import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type { AppContext } from "../CommandRouter.js";
import type { Hypothesis } from "../../../models/hypothesis.js";

interface ResultsProps {
  appContext: AppContext;
  focus: boolean;
}

function statusGlyph(status: string): string {
  switch (status) {
    case "active": return "✓";
    case "pending_review":
    case "reviewing": return "⧖";
    case "rejected": return "✗";
    case "evolved": return "✨";
    default: return "·";
  }
}

/**
 * Displays all hypotheses in a ranked table with selection and detail expansion.
 * Arrow keys navigate, Enter expands detail, / returns focus to InputBar.
 */
export function Results({ appContext, focus }: ResultsProps) {
  const hypotheses = useMemo(
    () => (appContext.sessionId ? appContext.memory.getAllActiveHypotheses(appContext.sessionId) : []),
    [appContext.sessionId, appContext.memory],
  );
  const [selected, setSelected] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  useInput(
    (input, key) => {
      if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
      else if (key.downArrow) setSelected((s) => Math.min(hypotheses.length - 1, s + 1));
      else if (key.return && hypotheses[selected]) {
        const id = hypotheses[selected].id;
        setExpanded((prev) => (prev === id ? null : id));
      } else if (input === "/") {
        // Focus returns to InputBar — handled by App's Esc handler
      }
    },
    { isActive: focus && hypotheses.length > 0 },
  );

  if (hypotheses.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text color="gray">No hypotheses yet.</Text>
      </Box>
    );
  }

  const expandedHyp = expanded ? hypotheses.find((h) => h.id === expanded) : null;

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} flexGrow={1}>
        <Text color="cyan" bold>{"  #   Elo   St  Hypothesis"}</Text>
        {hypotheses.map((h, i) => {
          const sel = i === selected;
          const bg = sel ? "cyan" : undefined;
          const fg = sel ? "black" : "white";
          const cursor = sel ? "▶" : " ";
          const rank = String(i + 1).padStart(2);
          const elo = String(Math.round(h.eloRating)).padStart(4);
          const glyph = statusGlyph(h.status);
          return (
            <Box key={h.id} flexDirection="column">
              <Text color={fg} backgroundColor={bg}>
                {cursor} {rank}  {elo}  {glyph} {h.title}
              </Text>
            </Box>
          );
        })}
      </Box>

      {expandedHyp && (
        <Box flexDirection="column" borderStyle="single" borderColor="blue" paddingX={1} paddingY={1}>
          <Text color="blue" bold>{expandedHyp.title}</Text>
          <Text color="gray">Elo: {Math.round(expandedHyp.eloRating)}  |  Matches: {expandedHyp.matchesPlayed}  |  W/L/D: {expandedHyp.wins}/{expandedHyp.losses}/{expandedHyp.draws}</Text>
          {expandedHyp.summary && (
            <Box marginTop={1}>
              <Text color="white">{expandedHyp.summary}</Text>
            </Box>
          )}
          {expandedHyp.rationale && (
            <Box marginTop={1}>
              <Text color="gray">Rationale: {expandedHyp.rationale.slice(0, 300)}</Text>
            </Box>
          )}
          {expandedHyp.citations && expandedHyp.citations.length > 0 && (
            <Box marginTop={1}>
              <Text color="gray">Citations: {expandedHyp.citations.length} source(s)</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text color="gray">[enter] collapse  [▲▼] navigate  [/] input</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
