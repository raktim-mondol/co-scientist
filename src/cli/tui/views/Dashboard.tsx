import React from "react";
import { Box, Text } from "ink";

interface DashboardProps {
  sessionId: string | null;
}

export function Dashboard({ sessionId }: DashboardProps) {
  return (
    <Box flexDirection="column" paddingY={1} paddingX={1}>
      <Text color="yellow">Dashboard — coming in Task 6</Text>
      {sessionId && <Text color="gray">Session: {sessionId.slice(0, 8)}</Text>}
    </Box>
  );
}
