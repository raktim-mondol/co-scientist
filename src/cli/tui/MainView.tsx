import React from "react";
import { Box, Text } from "ink";
import type { MainViewName, AppContext } from "./CommandRouter.js";
import type { Hypothesis } from "../../models/hypothesis.js";
import { EmptyState } from "./views/EmptyState.js";
import { Dashboard } from "./views/Dashboard.js";
import { Results } from "./views/Results.js";

interface MainViewProps {
  activeView: MainViewName;
  appContext: AppContext;
  focus: "input" | "dashboard";
  leaderboard: Hypothesis[];
  ticker: string[];
  selected: number;
  setSelected: (s: number) => void;
}

export function MainView({
  activeView,
  appContext,
  focus,
  leaderboard,
  ticker,
  selected,
  setSelected,
}: MainViewProps) {
  switch (activeView) {
    case "empty":
      return <EmptyState />;
    case "dashboard":
      return (
        <Dashboard
          appContext={appContext}
          focus={focus === "dashboard"}
          leaderboard={leaderboard}
          ticker={ticker}
          selected={selected}
          setSelected={setSelected}
        />
      );
    case "results":
      return (
        <Results
          appContext={appContext}
          focus={focus === "dashboard"}
        />
      );
    case "graph":
      return (
        <Box paddingX={1} paddingY={1}>
          <Text color="gray">Graph view — coming in Task 10</Text>
        </Box>
      );
    case "overview":
      return (
        <Box paddingX={1} paddingY={1}>
          <Text color="gray">Overview — coming in Task 10</Text>
        </Box>
      );
    case "thinking":
      return (
        <Box paddingX={1} paddingY={1}>
          <Text color="gray">Thinking traces — coming in Task 10</Text>
        </Box>
      );
    case "activity":
      return (
        <Box paddingX={1} paddingY={1}>
          <Text color="gray">Activity log — coming in Task 10</Text>
        </Box>
      );
    default:
      return <EmptyState />;
  }
}
