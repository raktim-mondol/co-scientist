import React, { memo } from "react";
import { Box, Text } from "ink";

interface TickerProps {
  lines: string[];
}

export const Ticker = memo(function Ticker({ lines }: TickerProps) {
  const latest = lines.length > 0 ? lines[lines.length - 1] : "starting...";
  return (
    <Box paddingX={1}>
      <Text color="gray">ticker: </Text>
      <Text color="magenta">{latest}</Text>
    </Box>
  );
});
