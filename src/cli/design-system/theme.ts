// Theme system for co-scientist TUI. Ported from claude_code's design system.
// Provides semantic color keys that resolve to raw color values (rgb(), ansi:, etc.)
// so components never hardcode terminal colors.

export type Theme = {
  // Brand
  claude: string
  claudeShimmer: string
  // Core text
  text: string
  inverseText: string
  inactive: string
  inactiveShimmer: string
  subtle: string
  // Semantic
  success: string
  error: string
  warning: string
  warningShimmer: string
  // UI elements
  suggestion: string
  permission: string
  promptBorder: string
  promptBorderShimmer: string
  background: string
  // Layout
  bashBorder: string
  // Agent colors
  red_FOR_SUBAGENTS_ONLY: string
  blue_FOR_SUBAGENTS_ONLY: string
  green_FOR_SUBAGENTS_ONLY: string
  yellow_FOR_SUBAGENTS_ONLY: string
  purple_FOR_SUBAGENTS_ONLY: string
  orange_FOR_SUBAGENTS_ONLY: string
  pink_FOR_SUBAGENTS_ONLY: string
  cyan_FOR_SUBAGENTS_ONLY: string
}

export const THEME_NAMES = ["dark", "light"] as const
export type ThemeName = (typeof THEME_NAMES)[number]
export type ThemeSetting = ThemeName

/**
 * Dark theme using explicit RGB values to avoid inconsistencies
 * from users' custom terminal ANSI color definitions.
 * Colors match claude_code's dark theme palette.
 */
const darkTheme: Theme = {
  claude: "rgb(215,119,87)", // Claude orange
  claudeShimmer: "rgb(235,159,127)", // Lighter claude orange
  text: "rgb(255,255,255)", // White
  inverseText: "rgb(0,0,0)", // Black
  inactive: "rgb(153,153,153)", // Light gray
  inactiveShimmer: "rgb(193,193,193)", // Lighter gray
  subtle: "rgb(80,80,80)", // Dark gray
  success: "rgb(78,186,101)", // Bright green
  error: "rgb(255,107,128)", // Bright red
  warning: "rgb(255,193,7)", // Bright amber
  warningShimmer: "rgb(255,223,57)", // Lighter amber
  suggestion: "rgb(177,185,249)", // Light blue-purple
  permission: "rgb(177,185,249)", // Light blue-purple
  promptBorder: "rgb(136,136,136)", // Medium gray
  promptBorderShimmer: "rgb(166,166,166)", // Lighter gray
  background: "rgb(0,204,204)", // Bright cyan
  bashBorder: "rgb(253,93,177)", // Bright pink
  red_FOR_SUBAGENTS_ONLY: "rgb(220,38,38)",
  blue_FOR_SUBAGENTS_ONLY: "rgb(37,99,235)",
  green_FOR_SUBAGENTS_ONLY: "rgb(22,163,74)",
  yellow_FOR_SUBAGENTS_ONLY: "rgb(202,138,4)",
  purple_FOR_SUBAGENTS_ONLY: "rgb(147,51,234)",
  orange_FOR_SUBAGENTS_ONLY: "rgb(234,88,12)",
  pink_FOR_SUBAGENTS_ONLY: "rgb(219,39,119)",
  cyan_FOR_SUBAGENTS_ONLY: "rgb(8,145,178)",
}

/**
 * Light theme using explicit RGB values.
 * Colors match claude_code's light theme palette.
 */
const lightTheme: Theme = {
  claude: "rgb(215,119,87)", // Claude orange
  claudeShimmer: "rgb(245,149,117)", // Lighter claude orange
  text: "rgb(0,0,0)", // Black
  inverseText: "rgb(255,255,255)", // White
  inactive: "rgb(102,102,102)", // Dark gray
  inactiveShimmer: "rgb(142,142,142)", // Lighter gray
  subtle: "rgb(175,175,175)", // Light gray
  success: "rgb(44,122,57)", // Green
  error: "rgb(171,43,63)", // Red
  warning: "rgb(150,108,30)", // Amber
  warningShimmer: "rgb(200,158,80)", // Lighter amber
  suggestion: "rgb(87,105,247)", // Medium blue
  permission: "rgb(87,105,247)", // Medium blue
  promptBorder: "rgb(153,153,153)", // Medium gray
  promptBorderShimmer: "rgb(183,183,183)", // Lighter gray
  background: "rgb(0,153,153)", // Cyan
  bashBorder: "rgb(255,0,135)", // Vibrant pink
  red_FOR_SUBAGENTS_ONLY: "rgb(220,38,38)",
  blue_FOR_SUBAGENTS_ONLY: "rgb(37,99,235)",
  green_FOR_SUBAGENTS_ONLY: "rgb(22,163,74)",
  yellow_FOR_SUBAGENTS_ONLY: "rgb(202,138,4)",
  purple_FOR_SUBAGENTS_ONLY: "rgb(147,51,234)",
  orange_FOR_SUBAGENTS_ONLY: "rgb(234,88,12)",
  pink_FOR_SUBAGENTS_ONLY: "rgb(219,39,119)",
  cyan_FOR_SUBAGENTS_ONLY: "rgb(8,145,178)",
}

export function getTheme(themeName: ThemeName): Theme {
  switch (themeName) {
    case "light":
      return lightTheme
    default:
      return darkTheme
  }
}
