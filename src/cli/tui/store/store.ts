// Lightweight Zustand-like store. Pure TypeScript — no React dependency.
// Pattern adapted from x_code/src/state/store.ts.
//
// Usage:
//   const store = createStore({ count: 0 });
//   store.subscribe(() => console.log(store.getState().count));
//   store.setState(prev => ({ count: prev.count + 1 }));

type Listener = () => void;

export type SetState<T> = ((updater: (prev: T) => T) => void) & ((value: T) => void);

export interface Store<T> {
  getState: () => T;
  setState: SetState<T>;
  subscribe: (listener: Listener) => () => void;
}

export function createStore<T>(initialState: T): Store<T> {
  let state = initialState;
  const listeners = new Set<Listener>();

  const setState = (nextOrUpdater: T | ((prev: T) => T)) => {
    const prev = state;
    const next =
      typeof nextOrUpdater === "function"
        ? (nextOrUpdater as (prev: T) => T)(prev)
        : nextOrUpdater;
    if (Object.is(next, prev)) return;
    state = next;
    for (const listener of listeners) listener();
  };

  return {
    getState: () => state,

    setState: setState as SetState<T>,

    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
