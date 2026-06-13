import React from "react";
import { Box, Text } from "ink";
import type { Hypothesis } from "../../models/hypothesis.js";

interface LeaderboardProps {
  hypotheses: Hypothesis[];
  selectedIndex: number;
}

function statusGlyph(status: string): string {
  switch (status) {
    case "active": return "✓";        // check
    case "pending_review":
    case "reviewing": return "⧖";      // hourglass-ish
    case "rejected": return "✗";       // cross
    case "evolved": return "✨";        // sparkle
    default: return "·";
  }
}

export function Leaderboard({ hypotheses, selectedIndex }: LeaderboardProps) {
  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="cyan" bold>{"  #   Elo   St  Hypothesis"}</Text>
      {hypotheses.length === 0 ? (
        <Text color="gray">  (no hypotheses yet)</Text>
      ) : (
        hypotheses.map((h, i) => {
          const selected = i === selectedIndex;
          const bg = selected ? "cyan" : undefined;
          const fg = selected ? "black" : "white";
          const cursor = selected ? "▶" : " ";
          const rank = String(i + 1).padStart(2);
          const elo = String(Math.round(h.eloRating)).padStart(4);
          const glyph = statusGlyph(h.status);
          return (
            <Box key={h.id} flexDirection="column">
              <Text color={fg} backgroundColor={bg}>
                {cursor} {rank}  {elo}  {glyph} {h.title}
              </Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}
