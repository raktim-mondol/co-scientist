import React from "react";
import { Box, Text } from "../../ink.js";
import { getBannerLines } from "../../banner.js";

const ART = getBannerLines();

export function EmptyState() {
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {ART.map((line, i) => (
        <Text key={i} color="success" bold>
          {line}
        </Text>
      ))}
      <Box marginTop={1} />
      <Text dimColor>AI-Powered Scientific Discovery</Text>
      <Box marginTop={1} />
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
