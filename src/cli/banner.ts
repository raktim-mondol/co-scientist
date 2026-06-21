import { color } from "./design-system/color.js";

// Clean 5-line block-letter "CO-SCIENTIST".  Every letter's rows are the same
// width, so when joined with a single space the five lines are exactly equal
// length (51 chars) and the surrounding box border stays flush.
const C    = ["████", "█   ", "█   ", "█   ", "████"];
const O    = ["████", "█  █", "█  █", "█  █", "████"];
const DASH = ["    ", "    ", "██  ", "    ", "    "];
const S    = ["████", "█   ", "████", "   █", "████"];
const I    = ["█", "█", "█", "█", "█"];
const E    = ["████", "█   ", "███ ", "█   ", "████"];
const N    = ["█  █", "██ █", "█ ██", "█  █", "█  █"];
const T    = ["███", " █ ", " █ ", " █ ", " █ "];

const LETTERS = [C, O, DASH, S, C, I, E, N, T, I, S, T];

const RAW = [0, 1, 2, 3, 4].map((row) =>
  LETTERS.map((l) => l[row]).join(" "),
);

export function getBannerLines(): string[] {
  return RAW;
}

const SUBTITLE = "AI-Powered Scientific Discovery";

export function printBanner(): void {
  const width = Math.max(RAW[0].length, SUBTITLE.length);
  const pad = " ".repeat(Math.max(0, Math.floor((width - SUBTITLE.length) / 2)));
  const banner = [
    `╭${"─".repeat(width + 2)}╮`,
    ...RAW.map((l) => `│ ${l.padEnd(width)} │`),
    `│ ${(pad + SUBTITLE).padEnd(width)} │`,
    `╰${"─".repeat(width + 2)}╯`,
  ].join("\n");
  console.log(color("claude").bold("\n" + banner + "\n"));
}
