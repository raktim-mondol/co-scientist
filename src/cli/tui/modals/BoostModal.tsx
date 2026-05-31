import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface BoostModalProps {
  title: string;
  currentElo: number;
  onConfirm: (newElo: number) => void;
  onCancel: () => void;
}

export function BoostModal({ title, currentElo, onConfirm, onCancel }: BoostModalProps) {
  const [value, setValue] = useState<string>(String(Math.round(currentElo) + 100));

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
    } else if (key.return) {
      const parsed = parseInt(value, 10);
      if (!Number.isNaN(parsed)) onConfirm(parsed);
    } else if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
    } else if (/^[0-9]$/.test(input)) {
      setValue((v) => (v.length < 5 ? v + input : v));
    }
  });

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>BOOST HYPOTHESIS</Text>
      <Text color="white">{title.length > 50 ? title.slice(0, 47) + "..." : title}</Text>
      <Text color="gray">
        New Elo: [{Math.round(currentElo)}] {"→"} <Text color="white">{value || "_"}</Text>
      </Text>
      <Text color="gray">[enter] confirm   [esc] cancel</Text>
    </Box>
  );
}
