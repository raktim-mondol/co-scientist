// Animated progress gauge — replaces the inline `gauge()` function in LiveStatus.
//
// Renders a bounded-width bar with a filled portion and an empty track.
// `value` is clamped to [0, 1]; width defaults to 10 characters.
//
// Based on x_code's ProgressBar pattern with semantic theme color slots:
//   - filledColor → the filled portion (defaults to success / error / warning
//     based on the `tone` prop, or a custom color)
//   - trackColor  → the empty background portion (defaults to subtle)
import React from "react";
import { Box as ThemedBox, Text as ThemedText } from "../ink.js";

interface ProgressBarProps {
  /** Value in [0, 1]. Clamped internally. */
  value: number;
  /** Char width of the bar. Default 10. */
  width?: number;
  /** Theme color key or raw RGB for the filled portion. Overrides tone. */
  filledColor?: string;
  /** Theme color key or raw RGB for the empty track. Defaults to subtle. */
  trackColor?: string;
  /** Semantic tone that picks a default filledColor. */
  tone?: "success" | "warning" | "error" | "info" | "neutral";
  /** Optional label rendered after the bar (e.g. "42%", "Tokens"). */
  label?: string;
}

const TONE_COLOR: Record<string, string> = {
  success: "success",
  warning: "warning",
  error: "error",
  info: "info",
  neutral: "textMuted",
};

const FILLED_GLYPH = "▓";
const EMPTY_GLYPH = "░";

export function ProgressBar({
  value,
  width = 10,
  filledColor,
  trackColor = "subtle",
  tone = "neutral",
  label,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const w = Math.max(1, Math.floor(width));
  const filled = Math.max(0, Math.min(w, Math.round(clamped * w)));
  const empty = w - filled;
  const fill = filledColor ?? TONE_COLOR[tone] ?? "textMuted";

  return (
    <ThemedBox>
      <ThemedText color={fill}>{FILLED_GLYPH.repeat(filled)}</ThemedText>
      <ThemedText dimColor color={trackColor}>{EMPTY_GLYPH.repeat(empty)}</ThemedText>
      {label && (
        <ThemedText dimColor> {label}</ThemedText>
      )}
    </ThemedBox>
  );
}