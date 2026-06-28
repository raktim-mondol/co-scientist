// Persist theme preference to ~/.co-scientist/theme.json so the TUI
// remembers the last-chosen theme across launches.
//
// ThemeProvider reads from this on init (no explicit `initialTheme`) and
// writes on every `setTheme` / `cycleTheme` call.
import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import type { ThemeName } from "./theme.js";

const DATA_DIR = join(homedir(), ".co-scientist");
const THEME_PATH = join(DATA_DIR, "theme.json");

interface ThemeFile {
  theme: ThemeName;
}

export function loadThemePreference(): ThemeName | null {
  try {
    if (!existsSync(THEME_PATH)) return null;
    const raw = readFileSync(THEME_PATH, "utf-8");
    const parsed: ThemeFile = JSON.parse(raw);
    if (parsed.theme === "dark" || parsed.theme === "light") return parsed.theme;
    return null;
  } catch {
    return null;
  }
}

export function saveThemePreference(theme: ThemeName): void {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(THEME_PATH, JSON.stringify({ theme }, null, 2), "utf-8");
  } catch {
    // Best-effort persistence — a missing ~/.co-scientist doesn't break the TUI.
  }
}