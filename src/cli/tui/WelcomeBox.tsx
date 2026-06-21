import React from "react";
import { Box, Text } from "../ink.js";
import { getBannerLines } from "../banner.js";

const ART = getBannerLines();
const ART_WIDTH = Math.max(...ART.map((l) => l.length));
const SUBTITLE = "AI-Powered Scientific Discovery";
const SUBTITLE_PAD = " ".repeat(
  Math.max(0, Math.floor((ART_WIDTH - SUBTITLE.length) / 2)),
);

// Rendered as the first <Static> item — scrolls into terminal history after
// the first session starts. Replaces the always-pinned Banner.
// x_code theme: claude (orange/peach) border + text, dim subtitle.
export function WelcomeBox() {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} paddingY={1}>
      {ART.map((line, i) => (
        <Text key={i} color="claude" bold>
          {line}
        </Text>
      ))}
      <Text dimColor>{SUBTITLE_PAD}{SUBTITLE}</Text>
    </Box>
  );
}
