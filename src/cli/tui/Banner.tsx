import React from "react";
import { Box, Text } from "../ink.js";
import { getBannerLines } from "../banner.js";

const ART = getBannerLines();

// Pinned banner rendered as the first row of the Ink frame so it never scrolls
// off or gets overwritten by stray console output. Shown for every view.
export function Banner() {
  return (
    <Box flexDirection="column" flexShrink={0} paddingX={1}>
      {ART.map((line, i) => (
        <Text key={i} color="success" bold>
          {line}
        </Text>
      ))}
      <Text dimColor>AI-Powered Scientific Discovery</Text>
    </Box>
  );
}
