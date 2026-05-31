import React from "react";
import { Box, Text } from "ink";

export function Footer({ paused }: { paused: boolean }) {
  return (
    <Box paddingX={1}>
      <Text color="gray">
        {"↑↓ select   "}
        <Text color="white">[k]</Text>ill   <Text color="white">[b]</Text>oost   <Text color="white">[i]</Text>nject   <Text color="white">[p]</Text>{paused ? "resume" : "pause"}   <Text color="white">[q]</Text>uit
      </Text>
    </Box>
  );
}
