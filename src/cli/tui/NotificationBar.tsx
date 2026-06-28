// Multi-notification display bar — replaces the single App-level <Toast>.
//
// Reads from the NotificationContext (which wraps the notification store from
// Phase 1) and renders the active notifications as a stacked list, ordered by
// priority. Each notification auto-dismisses via its TTL (handled in the store
// prune loop) or can be dismissed by the user with Esc.

import React from "react";
import { Box, Text } from "../ink.js";
import { useNotifications } from "./contexts/NotificationContext.js";
import type { Notification } from "./store/notificationStore.js";

const TONE_COLOR: Record<string, string> = {
  success: "success",
  error: "error",
  info: "claude",
};

const TONE_GLYPH: Record<string, string> = {
  success: "✓",
  error: "✗",
  info: "ℹ",
};

function NotificationRow({ notif }: { notif: Notification }) {
  const color = TONE_COLOR[notif.tone] ?? "claude";
  const glyph = TONE_GLYPH[notif.tone] ?? "·";
  const foldSuffix = notif.foldCount && notif.foldCount > 1 ? ` (×${notif.foldCount})` : "";
  return (
    <Box paddingX={1}>
      <Text color={color}>{glyph} </Text>
      <Text color={color}>{notif.message}{foldSuffix}</Text>
    </Box>
  );
}

export function NotificationBar() {
  const { notifications } = useNotifications();
  if (notifications.length === 0) return null;
  return (
    <Box flexDirection="column">
      {notifications.map((n) => (
        <NotificationRow key={n.id} notif={n} />
      ))}
    </Box>
  );
}