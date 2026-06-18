import React from "react";
import { Box, Text } from "ink";
import type { MainViewName, AppContext } from "./CommandRouter.js";
import { EmptyState } from "./views/EmptyState.js";
import { Dashboard } from "./views/Dashboard.js";

interface MainViewProps {
  activeView: MainViewName;
  appContext: AppContext;
}

export function MainView({ activeView, appContext }: MainViewProps) {
  switch (activeView) {
    case "empty":
      return <EmptyState />;
    case "dashboard":
      return <Dashboard sessionId={appContext.sessionId} />;
    case "results":
      return (
        <Box paddingX={1} paddingY={1}>
          <Text color="gray">Results view — coming in Task 9</Text>
        </Box>
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
