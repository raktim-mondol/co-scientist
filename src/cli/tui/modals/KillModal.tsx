import React, { useState } from "react";
import { Box, Text, useInput } from "../../ink.js";

interface KillModalProps {
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function KillModal({ title, onConfirm, onCancel }: KillModalProps) {
  const [confirm, setConfirm] = useState("");

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      if (confirm.toLowerCase() === "yes") onConfirm();
      else onCancel();
      return;
    }
    if (key.backspace || key.delete) {
      setConfirm((v) => v.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta && input.length === 1 && input >= " ") {
      const next = confirm + input;
      setConfirm(next);
      if (next.toLowerCase() === "yes") {
        onConfirm();
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text color="error" bold>⚠ Kill Hypothesis</Text>
      <Text color="text">This will permanently delete: {title}</Text>
      <Text dimColor>Type "yes" to confirm or Esc to cancel:</Text>
      <Text color="text">{confirm || "_"}</Text>
    </Box>
  );
}
