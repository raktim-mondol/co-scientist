import { describe, test, expect, beforeEach } from "bun:test";
import {
  getNotificationStore,
  resetNotificationStore,
} from "../../cli/tui/store/notificationStore.js";

beforeEach(() => {
  resetNotificationStore();
  // useFakeTimers isn't available in bun:test; we test store state directly
  // without relying on wall-clock prune.
});

describe("notificationStore", () => {
  test("add places a notification in the active list", () => {
    const s = getNotificationStore();
    s.add("hello", { tone: "info" });
    expect(s.getState().active.length).toBe(1);
    expect(s.getState().active[0]!.message).toBe("hello");
  });

  test("dismiss removes a notification by id", () => {
    const s = getNotificationStore();
    const id = s.add("bye", { tone: "error" });
    expect(s.getState().active.length).toBe(1);
    s.dismiss(id);
    expect(s.getState().active.length).toBe(0);
  });

  test("fold merges same-key notifications and increments foldCount", () => {
    const s = getNotificationStore();
    s.add("hypothesis 1", { foldKey: "new-hyp" });
    s.add("hypothesis 2", { foldKey: "new-hyp" });
    s.add("hypothesis 3", { foldKey: "new-hyp" });
    const active = s.getState().active;
    expect(active.length).toBe(1);
    expect(active[0]!.message).toBe("hypothesis 3"); // most recent wins
    expect(active[0]!.foldCount).toBe(3);
  });

  test("different fold keys produce separate notifications", () => {
    const s = getNotificationStore();
    s.add("a", { foldKey: "k1" });
    s.add("b", { foldKey: "k2" });
    s.add("c", { foldKey: "k1" });
    const active = s.getState().active;
    expect(active.length).toBe(2);
    const k1 = active.find((n) => n.foldKey === "k1");
    expect(k1?.foldCount).toBe(2);
  });

  test("higher priority sorts before lower priority", () => {
    const s = getNotificationStore();
    s.add("low", { priority: "low" });
    s.add("immediate", { priority: "immediate" });
    s.add("high", { priority: "high" });
    const active = s.getState().active;
    expect(active[0]!.priority).toBe("immediate");
    expect(active[1]!.priority).toBe("high");
    expect(active[2]!.priority).toBe("low");
  });

  test("dismissAll clears everything", () => {
    const s = getNotificationStore();
    s.add("a");
    s.add("b");
    s.dismissAll();
    expect(s.getState().active.length).toBe(0);
  });

  test("subscribe fires on state change and unsubscribes cleanly", () => {
    const s = getNotificationStore();
    let calls = 0;
    const unsub = s.subscribe(() => { calls++; });
    s.add("x");
    s.add("y");
    expect(calls).toBe(2);
    unsub();
    s.add("z");
    expect(calls).toBe(2); // no further calls after unsubscribe
  });
});