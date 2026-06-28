// Horizontal rule with optional centered label.
// Used to separate sections in LiveStatus, modals, and transcript blocks.
// Color resolves through the theme's `borderSubtle` slot by default.
//
// Based on x_code's <Divider /> pattern — a single thin line that can carry
// a centered label (e.g. "─── Top Hypotheses ───").
import React from "react";
import { Box as ThemedBox, Text as ThemedText } from "../ink.js";

interface DividerProps {
  /** Optional label rendered in the center (dimmed). */
  label?: string;
  /** Width in characters. Defaults to "fill". */
  width?: number;
  /** Theme color key or raw RGB string. Defaults to borderSubtle. */
  color?: string;
}

export function Divider({ label, width, color = "borderSubtle" }: DividerProps) {
  if (label) {
    if (width !== undefined) {
      const barLen = Math.max(1, Math.floor((width - label.length - 2) / 2));
      const left = "─".repeat(barLen);
      const right = "─".repeat(width - barLen - label.length - 2);
      return (
        <ThemedBox paddingX={1}>
          <ThemedText dimColor color={color}>
            {left} {label} {right}
          </ThemedText>
        </ThemedBox>
      );
    }
    return (
      <ThemedBox paddingX={1}>
        <ThemedText dimColor color={color}>
          ─── {label} ───
        </ThemedText>
      </ThemedBox>
    );
  }

  return (
    <ThemedBox paddingX={1}>
      <ThemedText dimColor color={color}>
        {width !== undefined ? "─".repeat(width) : "───"}
      </ThemedText>
    </ThemedBox>
  );
}