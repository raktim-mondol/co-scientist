import React, { createContext, useContext, useState, useMemo } from "react";
import type { ThemeName, ThemeSetting } from "./theme.js";

type ThemeContextValue = {
  /** The resolved theme to render with. */
  currentTheme: ThemeName;
  /** Set the theme (persisted preference). */
  setTheme: (setting: ThemeSetting) => void;
};

const DEFAULT_THEME: ThemeName = "dark";

const ThemeContext = createContext<ThemeContextValue>({
  currentTheme: DEFAULT_THEME,
  setTheme: () => {},
});

type Props = {
  children: React.ReactNode;
  initialTheme?: ThemeSetting;
};

export function ThemeProvider({ children, initialTheme = DEFAULT_THEME }: Props) {
  const [theme, setThemeState] = useState<ThemeSetting>(initialTheme);

  const value = useMemo<ThemeContextValue>(
    () => ({
      currentTheme: theme,
      setTheme: (setting: ThemeSetting) => setThemeState(setting),
    }),
    [theme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/**
 * Returns the resolved theme name for rendering and a setter.
 */
export function useTheme(): [ThemeName, (setting: ThemeSetting) => void] {
  const { currentTheme, setTheme } = useContext(ThemeContext);
  return [currentTheme, setTheme];
}

/**
 * Returns the raw theme setting.
 */
export function useThemeSetting(): ThemeSetting {
  return useContext(ThemeContext).currentTheme;
}
