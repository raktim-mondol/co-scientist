// ThemeProvider — always renders the single dark theme.
// Components use `useTheme()` to get the theme object for color resolution.

import React, { createContext, useContext, useMemo } from "react";
import { theme } from "./theme.js";
import type { Theme } from "./theme.js";

type ThemeContextValue = {
  /** Always the dark theme. */
  currentTheme: Theme;
};

const ThemeContext = createContext<ThemeContextValue>({
  currentTheme: theme,
});

type Props = {
  children: React.ReactNode;
};

export function ThemeProvider({ children }: Props) {
  const value = useMemo<ThemeContextValue>(
    () => ({ currentTheme: theme }),
    [],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/** Returns the current (always dark) theme object. */
export function useTheme(): Theme {
  return useContext(ThemeContext).currentTheme;
}
