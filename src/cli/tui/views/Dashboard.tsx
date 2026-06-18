import React from "react";
import { Box, Text, useInput } from "ink";
import type { Hypothesis } from "../../../models/hypothesis.js";
import type { AppContext } from "../CommandRouter.js";
import { Leaderboard } from "../Leaderboard.js";
import { Ticker } from "../Ticker.js";

interface DashboardProps {
  appContext: AppContext;
  focus: boolean;
  leaderboard: Hypothesis[];
  ticker: string[];
  selected: number;
  setSelected: (s: number) => void;
}

/**
 * Live dashboard view showing the leaderboard, ticker, and keyboard shortcuts.
 * Keyboard navigation (arrows, k/b/i/p) only works when the dashboard has focus.
 */
export function Dashboard({
  appContext,
  focus,
  leaderboard,
  ticker,
  selected,
  setSelected,
}: DashboardProps) {
  const selectedHyp = leaderboard[selected];

  useInput(
    (input, key) => {
      if (key.upArrow) setSelected(Math.max(0, selected - 1));
      else if (key.downArrow) setSelected(Math.min(Math.max(0, leaderboard.length - 1), selected + 1));
      else if (input === "k" && selectedHyp) appContext.openModal("kill");
      else if (input === "b" && selectedHyp) appContext.openModal("boost");
      else if (input === "i") appContext.openModal("inject");
      else if (input === "p") {
        const np = appContext.togglePause();
        appContext.showToast(np ? "Session paused." : "Session resumed.", "info");
      } else if (input === "/") {
        // Focus returns to InputBar — handled by App's Esc handler
      }
    },
    { isActive: focus },
  );

  return (
    <>
      {leaderboard.length === 0 ? (
        <Box paddingY={2} paddingX={4}>
          <Text color="gray">No hypotheses yet — waiting for generation...</Text>
        </Box>
      ) : (
        <Leaderboard hypotheses={leaderboard} selectedIndex={selected} />
      )}
      <Ticker lines={ticker} />
    </>
  );
}
