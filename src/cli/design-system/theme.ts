// Theme system for co-scientist TUI. Ported from claude_code's design system.
// Provides semantic color keys that resolve to raw color values (rgb(), ansi:, etc.)
// so components never hardcode terminal colors.
//
// The palette is organized in groups:
//   - Brand: claude orange family
//   - Text hierarchy: text, textSecondary, textMuted, inverseText, subtle, inactive
//   - Surface hierarchy: bg, surface, surfaceAlt, overlay, background
//   - Borders: border, borderSubtle, borderFocus, promptBorder, bashBorder
//   - Semantic: success, error, warning, info (+ muted variants)
//   - Agent state: agentActive, agentWaiting, agentComplete (+ 8 subagent colors)
//   - Leaderboard medals: gold, silver, bronze
//   - Accents: accent, accentMuted, suggestion, permission, highlight
//
// Backward compatibility: every key present before the Phase 5 expansion
// (claude, text, inverseText, inactive, subtle, success, error, warning,
// suggestion, permission, promptBorder, background, bashBorder, and the eight
// *_FOR_SUBAGENTS_ONLY colors) still resolves to the same value. New keys are
// purely additive.

export type Theme = {
  // Brand
  claude: string
  claudeShimmer: string
  brand: string
  brandMuted: string
  // Core text hierarchy
  text: string
  textSecondary: string
  textMuted: string
  inverseText: string
  inactive: string
  inactiveShimmer: string
  subtle: string
  // Surface hierarchy
  bg: string
  surface: string
  surfaceAlt: string
  overlay: string
  background: string
  // Borders
  border: string
  borderSubtle: string
  borderFocus: string
  promptBorder: string
  promptBorderShimmer: string
  bashBorder: string
  // Semantic
  success: string
  successMuted: string
  error: string
  errorMuted: string
  warning: string
  warningShimmer: string
  warningMuted: string
  info: string
  infoMuted: string
  // Accents
  accent: string
  accentMuted: string
  suggestion: string
  permission: string
  highlight: string
  // Agent state
  agentActive: string
  agentWaiting: string
  agentComplete: string
  // Leaderboard medals
  gold: string
  silver: string
  bronze: string
  // Subagent palette (used for per-agent coloring in activity lines)
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
  // Brand
  claude: "rgb(215,119,87)", // Claude orange
  claudeShimmer: "rgb(235,159,127)", // Lighter claude orange
  brand: "rgb(215,119,87)", // Alias of claude for semantic "brand" slot
  brandMuted: "rgb(160,90,65)", // Dimmer brand for secondary brand affordances
  // Core text hierarchy
  text: "rgb(255,255,255)", // White
  textSecondary: "rgb(180,180,180)", // Light gray — secondary copy
  textMuted: "rgb(120,120,120)", // Mid gray — tertiary / hint copy
  inverseText: "rgb(0,0,0)", // Black (used on light fills)
  inactive: "rgb(153,153,153)", // Light gray
  inactiveShimmer: "rgb(193,193,193)", // Lighter gray
  subtle: "rgb(80,80,80)", // Dark gray
  // Surface hierarchy
  bg: "rgb(0,0,0)", // True black background
  surface: "rgb(28,28,30)", // Slightly lifted surface
  surfaceAlt: "rgb(44,44,46)", // Alternate surface banding
  overlay: "rgb(20,20,20)", // Modal overlay backdrop
  background: "rgb(0,204,204)", // Bright cyan (legacy accent — kept for back-compat)
  // Borders
  border: "rgb(80,80,80)", // Default border
  borderSubtle: "rgb(50,50,50)", // Whisper-quiet separator border
  borderFocus: "rgb(215,119,87)", // Focused input border (brand)
  promptBorder: "rgb(136,136,136)", // Medium gray
  promptBorderShimmer: "rgb(166,166,166)", // Lighter gray
  bashBorder: "rgb(253,93,177)", // Bright pink
  // Semantic
  success: "rgb(78,186,101)", // Bright green
  successMuted: "rgb(60,120,75)", // Dim green for backgrounds/tracks
  error: "rgb(255,107,128)", // Bright red
  errorMuted: "rgb(120,60,70)", // Dim red
  warning: "rgb(255,193,7)", // Bright amber
  warningShimmer: "rgb(255,223,57)", // Lighter amber
  warningMuted: "rgb(150,130,40)", // Dim amber
  info: "rgb(100,180,255)", // Bright blue
  infoMuted: "rgb(60,90,140)", // Dim blue
  // Accents
  accent: "rgb(177,185,249)", // Light blue-purple
  accentMuted: "rgb(120,120,180)", // Dim blue-purple
  suggestion: "rgb(177,185,249)", // Light blue-purple
  permission: "rgb(177,185,249)", // Light blue-purple
  highlight: "rgb(60,60,60)", // Highlight background band
  // Agent state
  agentActive: "rgb(78,186,101)", // Running — success green
  agentWaiting: "rgb(255,193,7)", // Waiting — warning amber
  agentComplete: "rgb(177,185,249)", // Done — suggestion blue
  // Leaderboard medals
  gold: "rgb(255,200,60)",
  silver: "rgb(192,192,192)",
  bronze: "rgb(205,127,50)",
  // Subagent palette
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
  // Brand
  claude: "rgb(215,119,87)", // Claude orange
  claudeShimmer: "rgb(245,149,117)", // Lighter claude orange
  brand: "rgb(215,119,87)", // Alias of claude for semantic "brand" slot
  brandMuted: "rgb(230,180,160)", // Dimmer brand on light
  // Core text hierarchy
  text: "rgb(0,0,0)", // Black
  textSecondary: "rgb(90,90,90)", // Dark gray — secondary copy
  textMuted: "rgb(140,140,140)", // Mid gray — tertiary / hint copy
  inverseText: "rgb(255,255,255)", // White (used on dark fills)
  inactive: "rgb(102,102,102)", // Dark gray
  inactiveShimmer: "rgb(142,142,142)", // Lighter gray
  subtle: "rgb(175,175,175)", // Light gray
  // Surface hierarchy
  bg: "rgb(255,255,255)", // White background
  surface: "rgb(245,245,245)", // Slightly lifted surface
  surfaceAlt: "rgb(235,235,235)", // Alternate surface banding
  overlay: "rgb(250,250,250)", // Modal overlay backdrop
  background: "rgb(0,153,153)", // Cyan (legacy accent — kept for back-compat)
  // Borders
  border: "rgb(180,180,180)", // Default border
  borderSubtle: "rgb(220,220,220)", // Whisper-quiet separator border
  borderFocus: "rgb(215,119,87)", // Focused input border (brand)
  promptBorder: "rgb(153,153,153)", // Medium gray
  promptBorderShimmer: "rgb(183,183,183)", // Lighter gray
  bashBorder: "rgb(255,0,135)", // Vibrant pink
  // Semantic
  success: "rgb(44,122,57)", // Green
  successMuted: "rgb(180,210,185)", // Dim green
  error: "rgb(171,43,63)", // Red
  errorMuted: "rgb(220,190,195)", // Dim red
  warning: "rgb(150,108,30)", // Amber
  warningShimmer: "rgb(200,158,80)", // Lighter amber
  warningMuted: "rgb(225,210,170)", // Dim amber
  info: "rgb(60,130,200)", // Blue
  infoMuted: "rgb(185,200,225)", // Dim blue
  // Accents
  accent: "rgb(87,105,247)", // Medium blue
  accentMuted: "rgb(150,160,210)", // Dim blue-purple
  suggestion: "rgb(87,105,247)", // Medium blue
  permission: "rgb(87,105,247)", // Medium blue
  highlight: "rgb(220,220,220)", // Highlight background band
  // Agent state
  agentActive: "rgb(44,122,57)", // Running — success green
  agentWaiting: "rgb(150,108,30)", // Waiting — warning amber
  agentComplete: "rgb(87,105,247)", // Done — accent blue
  // Leaderboard medals
  gold: "rgb(180,140,30)",
  silver: "rgb(130,130,130)",
  bronze: "rgb(160,100,40)",
  // Subagent palette
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