import chalk from "chalk";
import { theme } from "./theme.js";
import type { Theme } from "./theme.js";

/**
 * Returns a chalk instance pre-configured with the theme color.
 * For use in non-TUI CLI output (banners, logs, interactive prompts).
 *
 * Usage:
 *   import { color } from "../design-system/color.js";
 *   console.log(color("claude")("Hello world"));
 *   console.log(color("error")("Something went wrong"));
 */
export function color(themeKey: keyof Theme): chalk.Chalk {
  const raw = theme[themeKey];

  // RGB format: rgb(R,G,B)
  const rgbMatch = raw.match(/rgb\(\s?(\d+),\s?(\d+),\s?(\d+)\s?\)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]!, 10);
    const g = parseInt(rgbMatch[2]!, 10);
    const b = parseInt(rgbMatch[3]!, 10);
    return chalk.rgb(r, g, b);
  }

  // Hex format: #RRGGBB
  if (raw.startsWith("#")) {
    return chalk.hex(raw);
  }

  // ansi256 format
  if (raw.startsWith("ansi256(")) {
    const n = parseInt(raw.slice(8, -1), 10);
    return chalk.ansi256(n);
  }

  // Named ANSI: ansi:red, ansi:blue, etc.
  if (raw.startsWith("ansi:")) {
    const name = raw.slice(5) as
      | "black" | "red" | "green" | "yellow" | "blue" | "magenta"
      | "cyan" | "white" | "blackBright" | "gray" | "grey"
      | "redBright" | "greenBright" | "yellowBright" | "blueBright"
      | "magentaBright" | "cyanBright" | "whiteBright";
    return (chalk as Record<string, chalk.Chalk>)[name] ?? chalk.white;
  }

  return chalk.white;
}
