import React from "react";
import type { MainViewName, AppContext } from "./CommandRouter.js";
import type { Hypothesis } from "../../models/hypothesis.js";
import { EmptyState } from "./views/EmptyState.js";
import { Dashboard } from "./views/Dashboard.js";
import { Results } from "./views/Results.js";
import { Graph } from "./views/Graph.js";
import { Overview } from "./views/Overview.js";
import { Thinking } from "./views/Thinking.js";
import { Activity } from "./views/Activity.js";

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
        <Graph
          appContext={appContext}
          focus={focus === "dashboard"}
        />
      );
    case "overview":
      return (
        <Overview
          appContext={appContext}
          focus={focus === "dashboard"}
        />
      );
    case "thinking":
      return (
        <Thinking
          appContext={appContext}
          focus={focus === "dashboard"}
        />
      );
    case "activity":
      return (
        <Activity
          appContext={appContext}
          focus={focus === "dashboard"}
        />
      );
    default:
      return <EmptyState />;
  }
}
