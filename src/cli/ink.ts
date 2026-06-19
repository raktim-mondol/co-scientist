// Ink wrapper that auto-injects ThemeProvider into all render calls,
// so every component gets theme resolution without wiring it manually.
// All TUI components should import from this file instead of "ink" directly.

import React, { type ReactNode } from "react";
import {
  render as inkRender,
  Box as InkBox,
  Text as InkText,
  Newline as InkNewline,
  Spacer as InkSpacer,
  Static as InkStatic,
  Transform as InkTransform,
  useInput as inkUseInput,
  useApp as inkUseApp,
  useStdin as inkUseStdin,
  useStdout as inkUseStdout,
  useStderr as inkUseStderr,
  useFocus as inkUseFocus,
  useFocusManager as inkUseFocusManager,
  measureElement as inkMeasureElement,
} from "ink";
import type { Instance as InkInstance } from "ink";
import { ThemeProvider } from "./design-system/ThemeProvider.js";

// Re-export themed components as Box/Text
export { default as Box } from "./design-system/ThemedBox.js";
export type { Props as BoxProps } from "./design-system/ThemedBox.js";
export { default as Text } from "./design-system/ThemedText.js";
export type { Props as TextProps } from "./design-system/ThemedText.js";

// Re-export theme hooks and types
export { ThemeProvider, useTheme, useThemeSetting } from "./design-system/ThemeProvider.js";
export type { Theme, ThemeName, ThemeSetting } from "./design-system/theme.js";

// Re-export color utility
export { color } from "./design-system/color.js";

// Re-export raw Ink components (for edge cases that need them)
export const BaseBox = InkBox;
export const BaseText = InkText;

// Re-export Ink hooks
export const useInput = inkUseInput;
export const useApp = inkUseApp;
export const useStdin = inkUseStdin;
export const useStdout = inkUseStdout;
export const useStderr = inkUseStderr;
export const useFocus = inkUseFocus;
export const useFocusManager = inkUseFocusManager;

// Re-export Ink components
export const Newline = InkNewline;
export const Spacer = InkSpacer;
export const Static = InkStatic;
export const Transform = InkTransform;

// Re-export measureElement
export const measureElement = inkMeasureElement;

// Re-export types
export type Instance = InkInstance;

// Wrap render() to auto-inject ThemeProvider
function withTheme(node: ReactNode): ReactNode {
  return React.createElement(ThemeProvider, null, node);
}

export function render(
  node: ReactNode,
  options?: NodeJS.WriteStream | Parameters<typeof inkRender>[1],
): InkInstance {
  return inkRender(withTheme(node), options as Parameters<typeof inkRender>[1]);
}
