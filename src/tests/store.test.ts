import { describe, test, expect } from "bun:test";
import { createStore } from "../../src/cli/tui/store/store.js";

describe("createStore", () => {
  test("getState returns initial state", () => {
    const store = createStore({ count: 0 });
    expect(store.getState().count).toBe(0);
  });

  test("setState updates via updater", () => {
    const store = createStore({ count: 0 });
    store.setState((prev) => ({ count: prev.count + 1 }));
    expect(store.getState().count).toBe(1);
  });

  test("setState does not notify if value is Object.is equal", () => {
    const store = createStore({ count: 0 });
    let calls = 0;
    store.subscribe(() => calls++);
    store.setState((prev) => prev); // same reference
    expect(calls).toBe(0);
  });

  test("subscribe is called on state change", () => {
    const store = createStore({ count: 0 });
    let calls = 0;
    store.subscribe(() => calls++);
    store.setState((prev) => ({ count: prev.count + 1 }));
    expect(calls).toBe(1);
  });

  test("unsubscribe stops notifications", () => {
    const store = createStore({ count: 0 });
    let calls = 0;
    const unsub = store.subscribe(() => calls++);
    store.setState((prev) => ({ count: prev.count + 1 }));
    unsub();
    store.setState((prev) => ({ count: prev.count + 2 }));
    expect(calls).toBe(1);
  });

  test("multiple subscribers all fire", () => {
    const store = createStore({ count: 0 });
    let a = 0, b = 0;
    store.subscribe(() => a++);
    store.subscribe(() => b++);
    store.setState((prev) => ({ count: prev.count + 1 }));
    expect(a).toBe(1);
    expect(b).toBe(1);
  });
});
