import React from "react";
import { Box, Text } from "ink";

export function EmptyState() {
  return (
    <Box flexDirection="column" alignItems="center" paddingY={2}>
      <Text color="cyan" bold>
        co-scientist
      </Text>
      <Text color="gray">Multi-Agent Research Hypothesis Generation</Text>
      <Box marginTop={1} />
      <Text color="white">Type a research topic to begin, or use /commands</Text>
      <Box marginTop={1} />
      <Box flexDirection="column" paddingX={2}>
        <Text color="gray">Getting started:</Text>
        <Text color="gray">
          {"  "}* Type any research topic and press Enter
        </Text>
        <Text color="gray">
          {"  "}* Use{" "}
          <Text color="white">/run</Text> to open the session launcher
        </Text>
        <Text color="gray">
          {"  "}* Use{" "}
          <Text color="white">/sessions</Text> to browse past sessions
        </Text>
        <Text color="gray">
          {"  "}* Use{" "}
          <Text color="white">/login</Text> to authenticate search providers
        </Text>
        <Text color="gray">
          {"  "}* Use{" "}
          <Text color="white">/help</Text> for all commands
        </Text>
        <Text color="gray">
          {"  "}* Use{" "}
          <Text color="white">/quit</Text> to exit
        </Text>
      </Box>
    </Box>
  );
}
