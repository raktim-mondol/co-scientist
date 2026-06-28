import React from "react";
import { Box, Text } from "../ink.js";

// Transcript entries are the immutable, append-only records that get committed
// to the terminal scrollback via Ink's <Static>. Each entry is printed exactly
// once and never re-renders — this is what keeps the REPL flicker-free while a
// session streams activity. The live region (LiveStatus + InputBar) renders
// below the Static block and is the only part that re-renders.

export type ToastTone = "success" | "error" | "info";

export type TranscriptEntry =
  // The startup welcome panel — always the first entry so it scrolls into history.
  | { id: string; kind: "welcome" }
  // A line of agent activity streamed from the supervisor's `progress` events.
  | { id: string; kind: "activity"; agent?: string; text: string }
  // The research goal / a command the user typed, echoed back into the stream.
  | { id: string; kind: "user"; text: string }
  // A one-line system notice (command success/error, lifecycle change).
  | { id: string; kind: "system"; text: string; tone?: ToastTone }
  // A multi-line block printed on demand (/results, /overview, /graph, …).
  | { id: string; kind: "block"; title: string; lines: string[]; color?: string };

// Colour hints for activity/system entries. The welcome block uses the
// "claude" border applied by the caller (App.tsx) rather than anything here.
const TONE_COLORS: Record<string, string> = {
  success: "success",
  error: "error",
  info: "claude",
};

const AGENT_COLORS: Record<string, string> = {
  GenerationAgent: "claude",
  ReflectionAgent: "warning",
  RankingAgent: "warning",
  EvolutionAgent: "suggestion",
  ProximityAgent: "permission",
  MetaReviewAgent: "text",
  KnowledgeGraphAgent: "claude",
  LiteratureResearchAgent: "success",
  ExperimentDesignAgent: "success",
};

function agentColor(agent?: string): string | undefined {
  if (!agent) return undefined;
  // Try exact match first, then substring
  if (AGENT_COLORS[agent]) return AGENT_COLORS[agent];
  for (const [key, c] of Object.entries(AGENT_COLORS)) {
    if (agent.includes(key)) return c;
  }
  return undefined;
}

// Each entry is rendered inside Ink's <Static>. It is printed exactly once
// and never re-rendered — that's what keeps the REPL flicker-free.
// `isSelected` is honoured when the entry is rendered by the
// VirtualMessageList (live-frame windowed list); <Static> callers omit it.
export function TranscriptItem({ entry, isSelected }: { entry: TranscriptEntry; isSelected?: boolean }) {
  switch (entry.kind) {
    case "welcome":
      // Rendered as its own <Static> item — handled by App.tsx which renders
      // WelcomeBox inside a <Box> wrapper.
      return null;

    case "activity": {
      const ac = agentColor(entry.agent);
      return (
        <Box paddingX={1}>
          {isSelected
            ? <Text color="claude" bold>▶ </Text>
            : <Text dimColor>⏺ </Text>}
          {entry.agent && <Text color={ac}>{entry.agent.padEnd(24)}</Text>}
          <Text color="text">{entry.text}</Text>
        </Box>
      );
    }

    case "user":
      return (
        <Box paddingX={1}>
          <Text color="success" bold>▸ </Text>
          <Text color="text">{entry.text}</Text>
        </Box>
      );

    case "system": {
      const color = entry.tone ? TONE_COLORS[entry.tone] ?? "text" : "text";
      const glyph = entry.tone === "success" ? "✓" : entry.tone === "error" ? "✗" : "·";
      return (
        <Box paddingX={1}>
          <Text color={color}>{glyph} </Text>
          <Text dimColor>{entry.text}</Text>
        </Box>
      );
    }

    case "block":
      return (
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Text color={entry.color ?? "claude"} bold>{entry.title}</Text>
          {entry.lines.map((line, i) => (
            <Text key={i} color="text">{line}</Text>
          ))}
        </Box>
      );

    default:
      return null;
  }
}
