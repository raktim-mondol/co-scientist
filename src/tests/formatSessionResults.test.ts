import { describe, it, expect } from "bun:test";
import { formatSessionResults } from "../cli/tui/formatters.js";
import type { ContextStore } from "../memory/contextStore.js";

function fakeMemory(): ContextStore {
  return {
    getSession: (_id: string) => ({
      id: "a1b2c3d4-1111-2222-3333-444455556666",
      name: "Histopathology fairness review",
      status: "completed",
      createdAt: new Date("2026-06-14T00:00:00Z"),
      stats: { totalHypotheses: 12 },
    }),
    getAllActiveHypotheses: (_id: string) => [
      { id: "h1", title: "Tumor-stroma bias", summary: "s", content: "", eloRating: 1623, status: "active" },
    ],
  } as unknown as ContextStore;
}

describe("formatSessionResults", () => {
  it("prepends a metadata header with full id, status, date and count", () => {
    const entry = formatSessionResults(fakeMemory(), "a1b2c3d4-1111-2222-3333-444455556666");
    expect(entry.kind).toBe("block");
    expect(entry.title).toBe("Histopathology fairness review");
    const text = (entry.lines ?? []).join("\n");
    expect(text).toContain("a1b2c3d4-1111-2222-3333-444455556666");
    expect(text).toContain("completed");
    expect(text).toContain("2026-06-14");
    expect(text).toContain("12 hypotheses");
    expect(text).toContain("Tumor-stroma bias"); // body from formatResults
  });

  it("falls back to the id as title when the session is missing", () => {
    const mem = { getSession: () => null, getAllActiveHypotheses: () => [] } as unknown as ContextStore;
    const entry = formatSessionResults(mem, "deadbeef");
    expect(entry.title).toContain("deadbeef");
  });
});
