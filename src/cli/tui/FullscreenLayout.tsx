// Fullscreen multi-zone layout (x_code-style). Slots render top → bottom:
//
//   status     — LiveStatus (spinner + token gauge + leaderboard)
//   scrollable — transcript virtual list (bounded height via useLayout)
//   modal      — modal overlay (renders above the input bar)
//   bottom     — NotificationBar + InputBar + Footer (pinned at the bottom)
//
// No fixed root height: the scrollable zone's height is bounded by
// `transcriptMaxRows` (the virtual list only renders that many rows), so the
// frame never grows unbounded and the input bar stays visible. Rendering the
// root without a fixed height also lets tall modals push the bottom bar
// naturally instead of being clipped — matching the prior behaviour.

import React from "react";
import { Box } from "../ink.js";

interface FullscreenLayoutProps {
  status?: React.ReactNode;
  scrollable: React.ReactNode;
  modal?: React.ReactNode;
  bottom: React.ReactNode;
}

export function FullscreenLayout({ status, scrollable, modal, bottom }: FullscreenLayoutProps) {
  return (
    <Box flexDirection="column">
      {status}
      {/* Scrollable zone — transcript window. */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {scrollable}
      </Box>
      {/* Modal overlay — above the bottom bar so the input stays below it. */}
      {modal}
      {/* Bottom zone — pinned. */}
      <Box flexShrink={0} flexDirection="column">
        {bottom}
      </Box>
    </Box>
  );
}