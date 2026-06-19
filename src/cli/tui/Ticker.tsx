import React from "react";
import { Box, Text } from "../ink.js";

interface TickerProps {
  lines: string[];
}

export function Ticker({ lines }: TickerProps) {
  const recent = lines.slice(0, 10);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>── Activity ──</Text>
      {recent.length === 0 && <Text dimColor>No activity yet...</Text>}
      {recent.map((line, i) => (
        <Text key={i} dimColor={i > 2}>
          {line}
        </Text>
      ))}
    </Box>
  );
}
