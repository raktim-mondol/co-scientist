import React, { createContext, useContext, useState, useMemo, useCallback } from "react";
import type { ThemeName, ThemeSetting } from "./theme.js";
import { THEME_NAMES } from "./theme.js";
import { loadThemePreference, saveThemePreference } from "./themePreference.js";

type ThemeContextValue = {
  /** The resolved theme to render with. */
  currentTheme: ThemeName;
  /** Set the theme (persisted preference). */
  setTheme: (setting: ThemeSetting) => void;
  /** Toggle dark → light → dark (persisted). */
  cycleTheme: () => void;
};

const DEFAULT_THEME: ThemeName = "dark";

const ThemeContext = createContext<ThemeContextValue>({
  currentTheme: DEFAULT_THEME,
  setTheme: () => {},
  cycleTheme: () => {},
});

type Props = {
  children: React.ReactNode;
  initialTheme?: ThemeSetting;
};

export function ThemeProvider({ children, initialTheme }: Props) {
  // Resolve initial: explicit prop > persisted pref > dark
  const resolvedInit = initialTheme ?? loadThemePreference() ?? DEFAULT_THEME;
  const [theme, setThemeState] = useState<ThemeSetting>(resolvedInit);

  const setTheme = useCallback((setting: ThemeSetting) => {
    setThemeState(setting);
    saveThemePreference(setting);
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((prev) => {
      const idx = THEME_NAMES.indexOf(prev as ThemeName);
      const next = THEME_NAMES[(idx + 1) % THEME_NAMES.length];
      saveThemePreference(next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      currentTheme: theme,
      setTheme,
      cycleTheme,
    }),
    [theme, setTheme, cycleTheme],
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

/**
 * Returns a theme cycling function (dark → light → dark).
 */
export function useCycleTheme(): () => void {
  return useContext(ThemeContext).cycleTheme;
}