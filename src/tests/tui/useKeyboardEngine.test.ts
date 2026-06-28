import { describe, test, expect } from "bun:test";
import { keyMatches, KEYBOARD_BINDINGS } from "../../cli/tui/hooks/useKeyboardEngine.js";

describe("useKeyboardEngine keyMatches", () => {
  test("matches named escape key", () => {
    expect(keyMatches("esc", "", { escape: true })).toBe(true);
    expect(keyMatches("esc", "", { escape: false })).toBe(false);
  });

  test("matches return and arrows", () => {
    expect(keyMatches("return", "", { return: true })).toBe(true);
    expect(keyMatches("upArrow", "", { upArrow: true })).toBe(true);
    expect(keyMatches("downArrow", "", { downArrow: true })).toBe(true);
  });

  test("matches ctrl+char and rejects without ctrl", () => {
    expect(keyMatches("ctrl+c", "c", { ctrl: true })).toBe(true);
    expect(keyMatches("ctrl+c", "c", { ctrl: false })).toBe(false);
    expect(keyMatches("ctrl+p", "p", { ctrl: true })).toBe(true);
    // ctrl held with a different char
    expect(keyMatches("ctrl+c", "p", { ctrl: true })).toBe(false);
  });

  test("matches literal char only without modifiers", () => {
    expect(keyMatches("j", "j", {})).toBe(true);
    expect(keyMatches("j", "j", { ctrl: true })).toBe(false);
    expect(keyMatches("j", "j", { meta: true })).toBe(false);
    expect(keyMatches("j", "k", {})).toBe(false);
    expect(keyMatches("/", "/", {})).toBe(true);
  });
});

describe("KEYBOARD_BINDINGS schema", () => {
  test("every binding has a non-empty keys list and an action", () => {
    for (const b of KEYBOARD_BINDINGS) {
      expect(b.keys.length).toBeGreaterThan(0);
      expect(b.action.length).toBeGreaterThan(0);
      expect(b.context.length).toBeGreaterThan(0);
    }
  });

  test("global bindings include quit and togglePause", () => {
    const globals = KEYBOARD_BINDINGS.filter((b) => b.context === "global");
    expect(globals.some((b) => b.action === "quit")).toBe(true);
    expect(globals.some((b) => b.action === "togglePause")).toBe(true);
  });

  test("transcript context binds j and k to scroll", () => {
    const transcript = KEYBOARD_BINDINGS.filter((b) => b.context === "transcript");
    const keys = transcript.flatMap((b) => b.keys);
    expect(keys).toContain("j");
    expect(keys).toContain("k");
  });
});