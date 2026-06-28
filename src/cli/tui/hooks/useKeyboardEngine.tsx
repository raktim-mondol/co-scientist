// Schema-driven keyboard engine.
//
// Keybindings are declared as a schema (`Binding[]`) rather than scattered
// `useInput` calls. Each binding targets a `context`; only bindings for the
// active context (plus the always-on `global` context) fire. This lets the
// TUI avoid key conflicts (e.g. `j`/`k` are text in `command-entry` but
// navigate in `transcript`).
//
// Default bindings:
//   ctrl+c → quit            (global)
//   ctrl+p → toggle pause   (global)
//   esc     → close overlay  (modal, picker)
//   j / k   → scroll transcript (transcript)
//   /       → focus command entry (command-entry)
//
// The schema is exported so the Footer can render context-aware hints without
// duplicating the binding list.

import { useInput } from "../../ink.js";

export type KeyContext = "global" | "transcript" | "command-entry" | "modal" | "picker";

export interface Binding {
  /** One or more key specifiers. A specifier is either a named key ("esc",
   *  "return", "upArrow", …) or a literal character ("j", "/"). */
  keys: string[];
  /** Logical action name; mapped to a callback in the `actions` record. */
  action: string;
  context: KeyContext;
  description: string;
}

export const KEYBOARD_BINDINGS: Binding[] = [
  { keys: ["ctrl+c"], action: "quit", context: "global", description: "Quit" },
  { keys: ["ctrl+p"], action: "togglePause", context: "global", description: "Pause/resume" },
  { keys: ["esc"], action: "closeOverlay", context: "modal", description: "Close modal" },
  { keys: ["esc"], action: "closeOverlay", context: "picker", description: "Close palette" },
  { keys: ["j"], action: "scrollDown", context: "transcript", description: "Scroll down" },
  { keys: ["k"], action: "scrollUp", context: "transcript", description: "Scroll up" },
  { keys: ["/"], action: "focusCommandEntry", context: "command-entry", description: "Command" },
];

// ─── Key matching ──────────────────────────────────────────────────────────────

interface InkKey {
  escape?: boolean;
  return?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  backspace?: boolean;
  delete?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  tab?: boolean;
}

export function keyMatches(spec: string, input: string, key: InkKey): boolean {
  // Named keys
  switch (spec) {
    case "esc": return !!key.escape;
    case "return": return !!key.return;
    case "upArrow": return !!key.upArrow;
    case "downArrow": return !!key.downArrow;
    case "leftArrow": return !!key.leftArrow;
    case "rightArrow": return !!key.rightArrow;
    case "backspace": return !!key.backspace;
    case "delete": return !!key.delete;
    case "tab": return !!key.tab;
  }
  // Modifier+char: "ctrl+c", "ctrl+p", "meta+x", …
  const modMatch = spec.match(/^(ctrl|meta)\+(.+)$/);
  if (modMatch) {
    const [, mod, ch] = modMatch;
    if (mod === "ctrl" && !key.ctrl) return false;
    if (mod === "meta" && !key.meta) return false;
    return input === ch;
  }
  // Literal character (no modifiers): e.g. "j", "k", "/"
  if (key.ctrl || key.meta) return false;
  return input === spec;
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export interface UseKeyboardEngineArgs {
  /** Active context — bindings for this context plus `global` are eligible. */
  context: KeyContext;
  /** Action name → callback. Unmapped actions are ignored. */
  actions: Record<string, () => void>;
  /** When false, the engine does not capture input. Defaults to true. */
  isActive?: boolean;
}

export function useKeyboardEngine({ context, actions, isActive = true }: UseKeyboardEngineArgs) {
  useInput(
    (input, key) => {
      // Build the eligible binding set: global bindings always active, plus
      // the current context's bindings.
      const eligible = KEYBOARD_BINDINGS.filter(
        (b) => b.context === "global" || b.context === context,
      );
      for (const binding of eligible) {
        if (binding.keys.some((spec) => keyMatches(spec, input, key))) {
          const handler = actions[binding.action];
          if (handler) handler();
          // First match wins — prevents a single key from firing two actions.
          return;
        }
      }
    },
    { isActive },
  );
}

export { KEYBOARD_BINDINGS as KEYBINDINGS };