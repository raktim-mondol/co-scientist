import type { ReactNode } from "react";
import React from "react";
import { Box as InkBox } from "ink";
import type { Theme } from "./theme.js";
import { getTheme } from "./theme.js";
import { useTheme } from "./ThemeProvider.js";

type ThemeColor = keyof Theme;
type RawColor = string;
type AnyColor = ThemeColor | RawColor;

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

export type Props = {
  readonly borderColor?: AnyColor;
  readonly borderTopColor?: AnyColor;
  readonly borderBottomColor?: AnyColor;
  readonly borderLeftColor?: AnyColor;
  readonly borderRightColor?: AnyColor;
  readonly backgroundColor?: AnyColor;
  // Layout
  readonly flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
  readonly flexGrow?: number;
  readonly flexShrink?: number;
  readonly flexBasis?: number | string;
  readonly alignItems?: "flex-start" | "center" | "flex-end" | "stretch";
  readonly alignSelf?: "flex-start" | "center" | "flex-end" | "stretch";
  readonly justifyContent?: "flex-start" | "center" | "flex-end" | "space-between" | "space-around";
  readonly width?: number | string;
  readonly height?: number | string;
  readonly minWidth?: number | string;
  readonly minHeight?: number | string;
  readonly padding?: number;
  readonly paddingX?: number;
  readonly paddingY?: number;
  readonly paddingTop?: number;
  readonly paddingBottom?: number;
  readonly paddingLeft?: number;
  readonly paddingRight?: number;
  readonly margin?: number;
  readonly marginTop?: number;
  readonly marginBottom?: number;
  readonly marginLeft?: number;
  readonly marginRight?: number;
  readonly gap?: number;
  readonly borderStyle?: "single" | "double" | "round" | "bold" | "singleDouble" | "doubleSingle" | "classic";
  readonly overflow?: "visible" | "hidden";
  readonly display?: "flex" | "none";
  readonly children?: ReactNode;
};

export default function ThemedBox({
  borderColor,
  borderTopColor,
  borderBottomColor,
  borderLeftColor,
  borderRightColor,
  backgroundColor,
  children,
  flexDirection,
  flexGrow,
  flexShrink,
  flexBasis,
  alignItems,
  alignSelf,
  justifyContent,
  width,
  height,
  minWidth,
  minHeight,
  padding,
  paddingX,
  paddingY,
  paddingTop,
  paddingBottom,
  paddingLeft,
  paddingRight,
  margin,
  marginTop,
  marginBottom,
  marginLeft,
  marginRight,
  gap,
  borderStyle,
  overflow,
  display,
}: Props): ReactNode {
  const [themeName] = useTheme();
  const theme = getTheme(themeName);

  // Only forward props that are actually set. Passing `undefined` for layout
  // props (notably `display`) overrides Ink's own defaults and can collapse
  // the box to nothing rendered — so we omit undefined values entirely.
  const boxProps: Record<string, unknown> = {
    borderColor: resolveColor(borderColor, theme),
    borderTopColor: resolveColor(borderTopColor, theme),
    borderBottomColor: resolveColor(borderBottomColor, theme),
    borderLeftColor: resolveColor(borderLeftColor, theme),
    borderRightColor: resolveColor(borderRightColor, theme),
    backgroundColor: resolveColor(backgroundColor, theme),
    flexDirection,
    flexGrow,
    flexShrink,
    flexBasis,
    alignItems,
    alignSelf,
    justifyContent,
    width,
    height,
    minWidth,
    minHeight,
    padding,
    paddingX,
    paddingY,
    paddingTop,
    paddingBottom,
    paddingLeft,
    paddingRight,
    margin,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    gap,
    borderStyle,
    overflow,
    display,
  };
  for (const key of Object.keys(boxProps)) {
    if (boxProps[key] === undefined) delete boxProps[key];
  }

  return <InkBox {...boxProps}>{children}</InkBox>;
}
