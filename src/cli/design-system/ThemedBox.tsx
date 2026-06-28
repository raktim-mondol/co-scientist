import type { ReactNode } from "react";
import React from "react";
import { Box as InkBox } from "ink";
import { theme } from "./theme.js";
import type { Theme } from "./theme.js";

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

function resolveColor(color: AnyColor | undefined): string | undefined {
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
  // NOTE: Ink's Box does NOT support backgroundColor. Use it on <Text> instead.
  // The prop is accepted for API documentation but not forwarded.
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
  // Only forward props that are actually set. Passing `undefined` for layout
  // props (notably `display`) overrides Ink's own defaults and can collapse
  // the box to nothing rendered — so we omit undefined values entirely.
  const boxProps: Record<string, unknown> = {
    borderColor: resolveColor(borderColor),
    borderTopColor: resolveColor(borderTopColor),
    borderBottomColor: resolveColor(borderBottomColor),
    borderLeftColor: resolveColor(borderLeftColor),
    borderRightColor: resolveColor(borderRightColor),
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
