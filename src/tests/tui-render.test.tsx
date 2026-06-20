import { describe, it, expect } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../cli/design-system/ThemeProvider.js";
import { Banner } from "../cli/tui/Banner.js";
import { Header } from "../cli/tui/Header.js";

// Headless render checks for the TUI. Ink can't run in CI without a TTY, but
// ink-testing-library renders components to a string so we can assert layout
// without a terminal or API keys.

const wrap = (node: React.ReactNode) =>
  render(React.createElement(ThemeProvider, null, node) as React.ReactElement);

// The running spinner frames; their presence/absence is how we detect whether
// the perpetual 80ms re-render loop is active.
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function header(state: "running" | "completed" | "paused" | null) {
  return React.createElement(Header, {
    sessionState: state,
    sessionId: "6086e234-aaaa-bbbb-cccc-000000000000",
    goal: "deep learning and image classification",
    stats: {
      tokensUsed: 1000,
      totalHypotheses: 0,
      avgTopTenElo: 1200,
      currentRound: 5,
      activeHypotheses: 0,
    },
    startTime: Date.now() - 5000,
    now: Date.now(),
    budgetTokens: 500000,
  });
}

describe("TUI headless render", () => {
  it("Banner renders the ASCII art and tagline", () => {
    const f = wrap(React.createElement(Banner)).lastFrame() ?? "";
    expect(f).toContain("AI-Powered Scientific Discovery");
    expect(f).toContain("█"); // block art present
  });

  it("running header shows a spinner frame", () => {
    const f = wrap(header("running")).lastFrame() ?? "";
    expect(f).toContain("running");
    expect(SPINNER.some((c) => f.includes(c))).toBe(true);
  });

  it("completed header has NO spinner (flicker guard)", () => {
    // A completed session must stop animating, otherwise the Spinner's 80ms
    // interval re-renders the whole frame forever and the screen flickers.
    const f = wrap(header("completed")).lastFrame() ?? "";
    expect(f).toContain("✓ complete");
    expect(SPINNER.some((c) => f.includes(c))).toBe(false);
  });
});
