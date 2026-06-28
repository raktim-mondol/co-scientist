// Multi-notification queue with priority, fold, and auto-dismiss.
// Pattern adapted from x_code/src/context/notifications.tsx.
//
// The store is pure TypeScript — the React binding lives in
// contexts/NotificationContext.tsx (Phase 3).

import type { ToastTone } from "../Transcript.js";
import { createStore } from "./store.js";

// ─── Types ────────────────────────────────────────────────────────────────────────

export type NotificationPriority = "immediate" | "high" | "medium" | "low";

export interface Notification {
  id: string;
  message: string;
  tone: ToastTone;
  priority: NotificationPriority;
  /** Timestamp when this notification was created (ms since epoch). */
  timestamp: number;
  /** Time-to-live in ms. The notification auto-dismisses after this. */
  ttl: number;
  /**
   * Optional fold key. When multiple notifications share the same fold key,
   * they are merged into one (e.g. "3 new hypotheses" instead of three
   * separate toasts). The most recent message wins.
   */
  foldKey?: string;
  /** Count of notifications folded into this one. */
  foldCount?: number;
}

export interface NotificationState {
  /** Active (visible) notifications, ordered by priority then recency. */
  active: Notification[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<NotificationPriority, number> = {
  immediate: 0,
  high: 1,
  medium: 2,
  low: 3,
};

let _nextId = 0;
function nextId(): string {
  return `notif_${++_nextId}_${Date.now()}`;
}

// ─── Store ────────────────────────────────────────────────────────────────────────

function createNotificationStore() {
  const store = createStore<NotificationState>({ active: [] });

  /** Add a notification. If a foldKey is provided and a notification with
   *  the same foldKey is already active, the existing notification is
   *  updated (message replaced, foldCount incremented) instead of adding
   *  a duplicate. */
  function add(
    message: string,
    opts?: {
      tone?: ToastTone;
      priority?: NotificationPriority;
      ttl?: number;
      foldKey?: string;
    },
  ): string {
    const tone = opts?.tone ?? "info";
    const priority = opts?.priority ?? "medium";
    const ttl = opts?.ttl ?? 3000;
    const foldKey = opts?.foldKey;

    const prev = store.getState();

    // If foldKey is set, try to fold into an existing notification
    if (foldKey) {
      const existing = prev.active.find((n) => n.foldKey === foldKey);
      if (existing) {
        const updated: Notification = {
          ...existing,
          message,
          timestamp: Date.now(),
          ttl,
          foldCount: (existing.foldCount ?? 1) + 1,
        };
        store.setState((s) => ({
          active: s.active.map((n) => (n.id === existing.id ? updated : n)),
        }));
        return existing.id;
      }
    }

    const id = nextId();
    const notification: Notification = {
      id,
      message,
      tone,
      priority,
      timestamp: Date.now(),
      ttl,
      foldKey,
    };

    store.setState((s) => {
      const active = [...s.active, notification];
      // Sort: higher priority first, then more recent first
      active.sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority];
        const pb = PRIORITY_ORDER[b.priority];
        if (pa !== pb) return pa - pb;
        return b.timestamp - a.timestamp;
      });
      return { active };
    });

    return id;
  }

  /** Dismiss a notification by id. */
  function dismiss(id: string): void {
    store.setState((s) => ({
      active: s.active.filter((n) => n.id !== id),
    }));
  }

  /** Dismiss all notifications. */
  function dismissAll(): void {
    store.setState({ active: [] });
  }

  /** Remove expired notifications (call periodically). */
  function prune(): void {
    const now = Date.now();
    store.setState((s) => ({
      active: s.active.filter((n) => now - n.timestamp < n.ttl),
    }));
  }

  return {
    ...store,
    add,
    dismiss,
    dismissAll,
    prune,
  };
}

export type NotificationStore = ReturnType<typeof createNotificationStore>;

// Singleton for the TUI session. Reset between sessions.
let _instance: NotificationStore | null = null;

export function getNotificationStore(): NotificationStore {
  if (!_instance) _instance = createNotificationStore();
  return _instance;
}

/** Reset the singleton (called when a new TUI session starts). */
export function resetNotificationStore(): void {
  _instance = null;
}
