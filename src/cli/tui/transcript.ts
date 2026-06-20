// Transcript entries are the immutable, append-only records that get committed
// to the terminal scrollback via Ink's <Static>. Each entry is printed exactly
// once and never re-renders — this is what keeps the REPL flicker-free while a
// session streams activity. The live region (LiveStatus + InputBar) renders
// below the Static block and is the only part that re-renders.

export type ToastTone = "success" | "error" | "info";

export type TranscriptEntry =
  // The startup welcome panel — always the first entry so it scrolls into history.
  | { id: string; kind: "welcome" }
  // A line of agent activity streamed from the supervisor's `progress` events.
  | { id: string; kind: "activity"; agent?: string; text: string }
  // The research goal / a command the user typed, echoed back into the stream.
  | { id: string; kind: "user"; text: string }
  // A one-line system notice (command success/error, lifecycle change).
  | { id: string; kind: "system"; text: string; tone?: ToastTone }
  // A multi-line block printed on demand (/results, /overview, /graph, …).
  | { id: string; kind: "block"; title: string; lines: string[]; color?: string };
