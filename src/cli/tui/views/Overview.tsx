import React, { useMemo } from "react";
import { Box, Text, useInput } from "../../ink.js";
import type { AppContext } from "../CommandRouter.js";

interface OverviewProps {
  appContext: AppContext;
  focus: boolean;
}

/**
 * Displays the research overview / meta-review for a completed session.
 * Only meaningful when the session has finished and the MetaReviewAgent has run.
 */
export function Overview({ appContext, focus }: OverviewProps) {
  const session = useMemo(
    () => (appContext.sessionId ? appContext.memory.getSession(appContext.sessionId) : null),
    [appContext.sessionId, appContext.memory],
  );

  useInput(() => {}, { isActive: focus });

  if (!session) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text dimColor>No session loaded.</Text>
      </Box>
    );
  }

  const overview = session.researchOverview;
  const critique = session.metaReviewCritique;
  const hasContent = overview || critique;

  if (!hasContent) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text color="warning">Session is still running — overview will be available when complete.</Text>
        <Text dimColor>Status: {session.status}</Text>
      </Box>
    );
  }

  // Break overview text into displayable lines
  const overviewLines = overview ? overview.split("\n").filter((l) => l.trim()) : [];
  const critiqueLines = critique ? critique.split("\n").filter((l) => l.trim()) : [];

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text color="claude" bold>Research Overview</Text>
      <Text dimColor>Status: {session.status}</Text>

      {overviewLines.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="text" bold>Summary</Text>
          {overviewLines.slice(0, 20).map((line, i) => (
            <Text key={i} color="text">{line}</Text>
          ))}
          {overviewLines.length > 20 && (
            <Text dimColor>... {overviewLines.length - 20} more lines</Text>
          )}
        </Box>
      )}

      {critiqueLines.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="warning" bold>Meta-Review Critique</Text>
          {critiqueLines.slice(0, 15).map((line, i) => (
            <Text key={i} color="text">{line}</Text>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>[/] return to input</Text>
      </Box>
    </Box>
  );
}
