import React from "react";
import { Box, Text } from "../ink.js";
import type { Hypothesis } from "../../models/hypothesis.js";

interface LeaderboardProps {
  hypotheses: Hypothesis[];
  selectedIndex: number;
}

export function Leaderboard({ hypotheses, selectedIndex }: LeaderboardProps) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="claude">🏆 Leaderboard</Text>
      {hypotheses.map((h, i) => {
        const isSelected = i === selectedIndex;
        return (
          <Box key={h.id ?? i}>
            <Text color={isSelected ? "success" : undefined}>
              {isSelected ? "▶" : " "} #{i + 1} {h.title} (Elo: {Math.round(h.eloRating ?? 1200)})
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
