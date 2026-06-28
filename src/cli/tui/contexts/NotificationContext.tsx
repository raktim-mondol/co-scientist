// React binding for the notification store (Phase 1).
//
// Wraps `getNotificationStore()` and exposes `addNotification` / `dismissNotification`
// plus the active notification list via React Context. A prune interval dismisses
// expired notifications so consumers don't each have to run their own timers.

import React, { createContext, useContext, useMemo, useState, useEffect, useCallback } from "react";
import { getNotificationStore } from "../store/notificationStore.js";
import type { Notification, NotificationPriority } from "../store/notificationStore.js";
import type { ToastTone } from "../Transcript.js";

interface NotificationContextValue {
  /** Active notifications, ordered by priority then recency. */
  notifications: Notification[];
  addNotification: (message: string, opts?: {
    tone?: ToastTone;
    priority?: NotificationPriority;
    ttl?: number;
    foldKey?: string;
  }) => string;
  dismissNotification: (id: string) => void;
  dismissAll: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const store = getNotificationStore();
  const [notifications, setNotifications] = useState<Notification[]>(() => store.getState().active);

  // Subscribe to the store — re-read on every change.
  useEffect(() => {
    const unsub = store.subscribe(() => setNotifications(store.getState().active));
    setNotifications(store.getState().active);
    return unsub;
  }, [store]);

  // Prune expired notifications on a 500ms tick.
  useEffect(() => {
    const id = setInterval(() => store.prune(), 500);
    return () => clearInterval(id);
  }, [store]);

  const addNotification = useCallback(
    (message: string, opts?: Parameters<NotificationContextValue["addNotification"]>[1]) =>
      store.add(message, opts),
    [store],
  );

  const dismissNotification = useCallback((id: string) => store.dismiss(id), [store]);
  const dismissAll = useCallback(() => store.dismissAll(), [store]);

  const value = useMemo<NotificationContextValue>(
    () => ({ notifications, addNotification, dismissNotification, dismissAll }),
    [notifications, addNotification, dismissNotification, dismissAll],
  );

  return (
    <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error("useNotifications must be used within a <NotificationProvider>");
  }
  return ctx;
}