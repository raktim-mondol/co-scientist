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
      <Text color="cyan" bold>{"  #  Elo   Hypothesis"}</Text>
      {hypotheses.length === 0 ? (
        <Text color="gray">  (no hypotheses yet)</Text>
      ) : (
        hypotheses.map((h, i) => {
          const selected = i === selectedIndex;
          const title = h.title.length > 48 ? h.title.slice(0, 45) + "..." : h.title;
          return (
            <Text key={h.id} color={selected ? "black" : "white"} backgroundColor={selected ? "cyan" : undefined}>
              {selected ? "▶" : " "} {String(i + 1).padStart(2)} {String(Math.round(h.eloRating)).padStart(4)}  {statusGlyph(h.status)} {title}
            </Text>
          );
        })
      )}
    </Box>
  );
}
