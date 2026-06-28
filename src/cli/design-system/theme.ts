// Theme system for co-scientist TUI. Single dark theme with white text on black
// background. Colors use explicit RGB values so components never hardcode terminal
// colors and are unaffected by users' custom ANSI definitions.

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

export const theme: Theme = {
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
  background: "rgb(0,204,204)", // Bright cyan (accent — legacy key name)
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
