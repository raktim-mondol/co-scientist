import React, { useEffect } from "react";
import { Box, Text } from "ink";

interface ToastProps {
  message: string;
  type: "success" | "error" | "info";
  visible: boolean;
  onDismiss: () => void;
  durationMs?: number;
}

export function Toast({ message, type, visible, onDismiss, durationMs = 3000 }: ToastProps) {
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
  }, [visible, onDismiss, durationMs]);

  if (!visible || !message) return null;

  const color = type === "success" ? "green" : type === "error" ? "red" : "cyan";

  return (
    <Box paddingX={1}>
      <Text color={color}>
        {type === "success" ? "✓" : type === "error" ? "✗" : "ℹ"} {message}
      </Text>
    </Box>
  );
}
