import React from "react";
import { Box, Text } from "../../ink.js";

// The ASCII banner is rendered app-wide by <Banner> (pinned at the top), so the
// empty state only shows the getting-started hints below it.
export function EmptyState() {
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text dimColor>
        Type a research topic and press Enter to begin
      </Text>
      <Text dimColor>
        <Text color="text">/help</Text>
        <Text dimColor> for commands · </Text>
        <Text color="text">/sessions</Text>
        <Text dimColor> to resume · </Text>
        <Text color="text">/quit</Text>
        <Text dimColor> to exit</Text>
      </Text>
    </Box>
  );
}
