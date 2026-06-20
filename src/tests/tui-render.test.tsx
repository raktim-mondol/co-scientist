import { describe, it, expect } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../cli/design-system/ThemeProvider.js";
import { WelcomeBox } from "../cli/tui/WelcomeBox.js";
import { LiveStatus } from "../cli/tui/LiveStatus.js";

// Headless render checks for the TUI. Ink can't run in CI without a TTY, but
// ink-testing-library renders components to a string so we can assert layout
// without a terminal or API keys.

const wrap = (node: React.ReactNode) =>
  render(React.createElement(ThemeProvider, null, node) as React.ReactElement);

// The running spinner frames; their presence/absence is how we detect whether
// the perpetual 80ms re-render loop is active.
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function liveStatus(state: "running" | "completed" | "paused" | null) {
  return React.createElement(LiveStatus, {
    sessionState: state,
    sessionId: "6086e234-aaaa-bbbb-cccc-000000000000",
    goal: "deep learning and image classification",
    stats: {
      tokensUsed: 1000,
      totalHypotheses: 3,
      avgTopTenElo: 1200,
      currentRound: 5,
      activeHypotheses: 3,
      phase: "ranking",
    },
    startTime: Date.now() - 5000,
    now: Date.now(),
    budgetTokens: 500000,
    leaderboard: [
      { id: "h1", title: "Tumor-stroma bias", summary: "", content: "", eloRating: 1240, rank: 1 },
      { id: "h2", title: "Stain-norm shift", summary: "", content: "", eloRating: 1190, rank: 2 },
      { id: "h3", title: "Site leakage", summary: "", content: "", eloRating: 1150, rank: 3 },
    ],
    selected: 0,
  });
}

describe("TUI headless render", () => {
  it("WelcomeBox renders the ASCII art and tagline", () => {
    const f = wrap(React.createElement(WelcomeBox)).lastFrame() ?? "";
    expect(f).toContain("AI-Powered Scientific Discovery");
    expect(f).toContain("█"); // block art present
  });

  it("running LiveStatus shows a spinner frame", () => {
    const f = wrap(liveStatus("running")).lastFrame() ?? "";
    expect(f).toContain("Ranking");
    expect(SPINNER.some((c) => f.includes(c))).toBe(true);
  });

  it("completed LiveStatus has NO spinner (flicker guard)", () => {
    // A completed session must stop animating, otherwise the Spinner's 80ms
    // interval re-renders the whole frame forever and the screen flickers.
    const f = wrap(liveStatus("completed")).lastFrame() ?? "";
    expect(f).toContain("✓ complete");
    expect(SPINNER.some((c) => f.includes(c))).toBe(false);
  });

  it("running LiveStatus shows top hypotheses from leaderboard", () => {
    const f = wrap(liveStatus("running")).lastFrame() ?? "";
    expect(f).toContain("Tumor-stroma bias");
    expect(f).toContain("1240");
    expect(f).toContain("Stain-norm shift");
  });

  it("null session hides LiveStatus", () => {
    const f = wrap(liveStatus(null)).lastFrame() ?? "";
    expect(f).toBe("");
  });

  it("paused LiveStatus shows PAUSED marker", () => {
    const f = wrap(liveStatus("paused")).lastFrame() ?? "";
    expect(f).toContain("⏸ PAUSED");
    expect(SPINNER.some((c) => f.includes(c))).toBe(false);
  });
});
