// Color-coded status indicator — a single-character glyph + optional label
// rendered with a semantic theme color.
//
// States map to theme slots:
//   - running    → agentActive   (success-green glyph, e.g. ◉)
//   - paused     → agentWaiting  (warning-amber glyph, e.g. ⏸)
//   - completed  → agentComplete (accent-blue   glyph, e.g. ✓)
//   - waiting    → textMuted     (dimmed         glyph, e.g. ◌)
//
// Used by LiveStatus for the spinner/glyph line and by modals for status badges.
import React from "react";
import { Text as ThemedText } from "../ink.js";

export type StatusState = "running" | "paused" | "completed" | "waiting";

interface StatusIconProps {
  state: StatusState;
  /** Optional label rendered after the glyph. */
  label?: string;
  /** When true, render only the glyph (no label). */
  compact?: boolean;
}

const STATE_CONFIG: Record<StatusState, { glyph: string; color: string; defaultLabel: string }> = {
  running:   { glyph: "◉", color: "agentActive",   defaultLabel: "RUNNING" },
  paused:    { glyph: "⏸", color: "agentWaiting",  defaultLabel: "PAUSED" },
  completed: { glyph: "✓", color: "agentComplete", defaultLabel: "COMPLETE" },
  waiting:   { glyph: "◌", color: "textMuted",     defaultLabel: "WAITING" },
};

export function StatusIcon({ state, label, compact }: StatusIconProps) {
  const cfg = STATE_CONFIG[state];
  const displayLabel = compact ? "" : ` ${label ?? cfg.defaultLabel}`;
  return (
    <ThemedText color={cfg.color} bold={state === "running"}>
      {cfg.glyph}{displayLabel}
    </ThemedText>
  );
}