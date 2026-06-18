import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface BudgetModalProps {
  currentBudget: number;
  onConfirm: (newBudget: number) => void;
  onCancel: () => void;
}

/**
 * Single numeric field for updating the token budget.
 * Built on useInput following the BoostModal pattern.
 */
export function BudgetModal({ currentBudget, onConfirm, onCancel }: BudgetModalProps) {
  const [value, setValue] = useState<string>(String(currentBudget));

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
    } else if (key.return) {
      const parsed = parseInt(value, 10);
      if (!Number.isNaN(parsed) && parsed > 0) onConfirm(parsed);
    } else if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
    } else if (/^[0-9]$/.test(input)) {
      setValue((v) => (v.length < 10 ? v + input : v));
    }
  });

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="magenta" paddingX={1}>
      <Text color="magenta" bold>SET TOKEN BUDGET</Text>
      <Text color="gray">
        Current: <Text color="white">{currentBudget.toLocaleString()}</Text> tokens
      </Text>
      <Text color="white">
        New: {value || "_"}
      </Text>
      <Text color="gray">[enter] confirm   [esc] cancel</Text>
    </Box>
  );
}
