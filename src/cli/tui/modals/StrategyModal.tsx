import React from "react";
import { Box, Text, useInput } from "ink";

interface StrategyModalProps {
  weights: Record<string, number>;
  onCancel: () => void;
}

const TASK_LABELS: Record<string, string> = {
  generation: "Generate new hypotheses",
  reflection: "Review & reflect",
  ranking: "Tournament ranking",
  evolution: "Evolve top hypotheses",
  proximity: "Compute similarity",
  meta_review: "Meta-review synthesis",
};

/**
 * Read-only display of current task sampling weights.
 * Press any key (Esc/Enter) to dismiss. Full editing deferred to v2.
 */
export function StrategyModal({ weights, onCancel }: StrategyModalProps) {
  useInput((_input, key) => {
    if (key.escape || key.return) onCancel();
  });

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="blue" paddingX={1}>
      <Text color="blue" bold>TASK SAMPLING WEIGHTS</Text>
      {Object.entries(TASK_LABELS).map(([key, label]) => {
        const pct = ((weights[key] ?? 0) * 100).toFixed(0);
        return (
          <Box key={key}>
            <Text color="gray">
              {label.padEnd(26)}
            </Text>
            <Text color="white">{pct}%</Text>
          </Box>
        );
      })}
      <Text color="gray">[esc/enter] close</Text>
    </Box>
  );
}
