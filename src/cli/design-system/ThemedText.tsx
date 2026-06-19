import type { ReactNode } from "react";
import React from "react";
import { Text as InkText } from "ink";
import type { Theme } from "./theme.js";
import { getTheme } from "./theme.js";
import { useTheme } from "./ThemeProvider.js";

// Color can be a theme key or a raw color value (rgb(), #, ansi:, ansi256())
type ThemeColor = keyof Theme;
type RawColor = string;
type AnyColor = ThemeColor | RawColor;

export type Props = {
  /** Text color. Accepts a theme key or raw color value. */
  readonly color?: AnyColor;
  /** Background color. Accepts a theme key or raw color value. */
  readonly backgroundColor?: AnyColor;
  /** Dim the color using the theme's inactive color. */
  readonly dimColor?: boolean;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strikethrough?: boolean;
  readonly inverse?: boolean;
  /** Wrap or truncate text. Default: "wrap". */
  readonly wrap?: "wrap" | "truncate" | "truncate-start" | "truncate-middle" | "truncate-end";
  readonly children?: ReactNode;
};

function isRawColor(color: string): boolean {
  return (
    color.startsWith("rgb(") ||
    color.startsWith("#") ||
    color.startsWith("ansi256(") ||
    color.startsWith("ansi:")
  );
}

function resolveColor(color: AnyColor | undefined, theme: Theme): string | undefined {
  if (!color) return undefined;
  if (isRawColor(color)) return color;
  return (theme as Record<string, string>)[color];
}

export default function ThemedText({
  color,
  backgroundColor,
  dimColor = false,
  bold = false,
  italic = false,
  underline = false,
  strikethrough = false,
  inverse = false,
  wrap = "wrap",
  children,
}: Props): ReactNode {
  const [themeName] = useTheme();
  const theme = getTheme(themeName);

  const resolvedColor = dimColor
    ? theme.inactive
    : resolveColor(color, theme);

  const resolvedBg = resolveColor(backgroundColor, theme);

  return (
    <InkText
      color={resolvedColor}
      backgroundColor={resolvedBg}
      bold={bold}
      italic={italic}
      underline={underline}
      strikethrough={strikethrough}
      inverse={inverse}
      wrap={wrap}
    >
      {children}
    </InkText>
  );
}
