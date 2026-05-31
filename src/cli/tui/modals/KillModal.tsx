import React from "react";
import { Box, Text, useInput } from "ink";

interface KillModalProps {
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function KillModal({ title, onConfirm, onCancel }: KillModalProps) {
  useInput((input, key) => {
    if (key.escape || input === "n") onCancel();
    else if (key.return || input === "y") onConfirm();
  });

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="red" paddingX={1}>
      <Text color="red" bold>KILL HYPOTHESIS</Text>
      <Text color="white">{title.length > 50 ? title.slice(0, 47) + "..." : title}</Text>
      <Text color="gray">Reject this hypothesis? [y] confirm   [esc/n] cancel</Text>
    </Box>
  );
}
