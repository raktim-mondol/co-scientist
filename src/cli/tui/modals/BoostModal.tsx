import React, { useState } from "react";
import { Box, Text, useInput } from "../../ink.js";

interface BoostModalProps {
  title: string;
  currentElo: number;
  onConfirm: (newElo: number) => void;
  onCancel: () => void;
}

export function BoostModal({
  title,
  currentElo,
  onConfirm,
  onCancel,
}: BoostModalProps) {
  const [value, setValue] = useState(String(currentElo + 50));

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      const newElo = parseInt(value, 10);
      if (!isNaN(newElo)) onConfirm(newElo);
      else onCancel();
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    // Only allow digits
    if (input && !key.ctrl && !key.meta && input.length === 1 && input >= "0" && input <= "9") {
      setValue((v) => v + input);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text color="warning" bold>⚡ Boost Hypothesis</Text>
      <Text>Adjust Elo for: {title}</Text>
      <Text dimColor>Current: {currentElo} | New: {value || "_"}</Text>
      <Text dimColor>[enter] confirm   [esc] cancel</Text>
    </Box>
  );
}
