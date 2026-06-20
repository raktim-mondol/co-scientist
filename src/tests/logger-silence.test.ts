import { describe, it, expect, afterEach } from "bun:test";
import { logger, setLoggerSilenced } from "../config.js";

// When the Ink TUI owns the screen, the logger must produce zero console
// output — otherwise stray writes corrupt/roll over the live frame (the bug
// where the banner disappeared and verbose logs rolled over the TUI box).
describe("setLoggerSilenced", () => {
  afterEach(() => setLoggerSilenced(false));

  function captureConsole(fn: () => void): string[] {
    const lines: string[] = [];
    const methods = ["debug", "info", "warn", "error"] as const;
    const originals = methods.map((m) => console[m]);
    for (const m of methods) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (console as any)[m] = (...args: unknown[]) => lines.push(args.join(" "));
    }
    try {
      fn();
    } finally {
      methods.forEach((m, i) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (console as any)[m] = originals[i];
      });
    }
    return lines;
  }

  it("suppresses all logger output when silenced", () => {
    setLoggerSilenced(true);
    const lines = captureConsole(() => {
      logger.debug("[Supervisor] debug line");
      logger.info("[Generation] info line");
      logger.warn("[Safety] warn line");
      logger.error("[Reflection] error line");
    });
    expect(lines).toEqual([]);
  });

  it("emits logger output again once un-silenced", () => {
    setLoggerSilenced(false);
    const lines = captureConsole(() => {
      logger.error("[Reflection] error line");
    });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).toContain("error line");
  });
});
