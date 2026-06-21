import { describe, it, expect } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../cli/design-system/ThemeProvider.js";
import { SessionsModal } from "../../cli/tui/modals/SessionsModal.js";
import type { CoScientistSession } from "../../models/session.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeSessions(n: number): CoScientistSession[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id${String(i).padStart(2, "0")}-aaaa-bbbb-cccc-000000000000`,
    name: `session-2026-06-${String((i % 28) + 1).padStart(2, "0")}`,
    status: i % 2 === 0 ? "completed" : "paused",
    createdAt: new Date("2026-06-14T00:00:00Z"),
    stats: { totalHypotheses: i },
  })) as unknown as CoScientistSession[];
}

interface Spies {
  onView: string[]; onResume: string[]; onOverview: string[];
  onExport: string[]; onDelete: string[][]; onCancel: number;
}

function mount(sessions: CoScientistSession[]) {
  const calls: Spies = { onView: [], onResume: [], onOverview: [], onExport: [], onDelete: [], onCancel: 0 };
  const node = React.createElement(ThemeProvider, null,
    React.createElement(SessionsModal, {
      sessions,
      activeSessionId: null,
      onView: (id: string) => calls.onView.push(id),
      onResume: (id: string) => calls.onResume.push(id),
      onOverview: (id: string) => calls.onOverview.push(id),
      onExport: (id: string) => calls.onExport.push(id),
      onDelete: (ids: string[]) => calls.onDelete.push(ids),
      onCancel: () => { calls.onCancel++; },
    }),
  );
  const r = render(node as React.ReactElement);
  return { calls, ...r };
}

describe("SessionsModal", () => {
  it("windows a long list far below the full count", async () => {
    const { lastFrame } = mount(makeSessions(77));
    await delay(10);
    const f = lastFrame() ?? "";
    const shown = makeSessions(77).filter((s) => f.includes(s.id.slice(0, 6))).length;
    expect(shown).toBeLessThanOrEqual(8);
    expect(f).toContain("/77");
  });

  it("enter views the highlighted session", async () => {
    const { calls, stdin } = mount(makeSessions(5));
    await delay(10);
    stdin.write("\r");
    await delay(10);
    expect(calls.onView).toEqual(["id00-aaaa-bbbb-cccc-000000000000"]);
  });

  it("r/o/e fire resume/overview/export on the highlighted session", async () => {
    const { calls, stdin } = mount(makeSessions(5));
    await delay(10);
    stdin.write("r"); await delay(5);
    stdin.write("o"); await delay(5);
    stdin.write("e"); await delay(5);
    expect(calls.onResume).toEqual(["id00-aaaa-bbbb-cccc-000000000000"]);
    expect(calls.onOverview).toEqual(["id00-aaaa-bbbb-cccc-000000000000"]);
    expect(calls.onExport).toEqual(["id00-aaaa-bbbb-cccc-000000000000"]);
  });

  it("space marks and d+y deletes exactly the marked ids", async () => {
    const { calls, stdin, lastFrame } = mount(makeSessions(5));
    await delay(10);
    stdin.write(" "); await delay(5);   // mark id00
    stdin.write("[B"); await delay(5); // down to id01
    stdin.write(" "); await delay(5);   // mark id01
    stdin.write("d"); await delay(5);   // go to confirm
    expect(lastFrame() ?? "").toContain("CONFIRM DELETE");
    stdin.write("y"); await delay(5);
    expect(calls.onDelete).toHaveLength(1);
    expect(calls.onDelete[0].sort()).toEqual([
      "id00-aaaa-bbbb-cccc-000000000000",
      "id01-aaaa-bbbb-cccc-000000000000",
    ]);
  });

  it("slash enters filter mode; typed letters narrow the list and do not act", async () => {
    const { calls, stdin, lastFrame } = mount(makeSessions(40));
    await delay(10);
    stdin.write("/"); await delay(5);
    stdin.write("r"); await delay(5); // would be 'resume' in navigate mode
    expect(calls.onResume).toHaveLength(0);
    expect(lastFrame() ?? "").toContain("Filter:");
  });

  it("esc cancels", async () => {
    const { calls, stdin } = mount(makeSessions(5));
    await delay(10);
    stdin.write(""); await delay(50);
    expect(calls.onCancel).toBe(1);
  });

  it("renders an empty state with no sessions", async () => {
    const { lastFrame } = mount([]);
    await delay(10);
    expect(lastFrame() ?? "").toContain("No sessions");
  });
});
