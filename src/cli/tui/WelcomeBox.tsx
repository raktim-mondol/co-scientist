import React from "react";
import { Box, Text } from "../ink.js";
import { getBannerLines } from "../banner.js";

const ART = getBannerLines();

// Rendered as the first <Static> item — scrolls into terminal history after
// the first session starts. Replaces the always-pinned Banner.
export function WelcomeBox() {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} paddingY={1}>
      {ART.map((line, i) => (
        <Text key={i} color="success" bold>
          {line}
        </Text>
      ))}
      <Text dimColor>AI-Powered Scientific Discovery</Text>
    </Box>
  );
}
