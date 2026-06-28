// React hook that returns computed layout values, re-computing on terminal
// resize. Wraps the pure `getLayout()` from the design system.

import { useMemo } from "react";
import { getLayout } from "../../design-system/layout.js";
import type { LayoutValues } from "../../design-system/layout.js";
import { useTerminalSize } from "../useTerminalSize.js";

export interface UseLayoutArgs {
  sessionActive?: boolean;
  leaderboardRows?: number;
  compact?: boolean;
}

export function useLayout(args: UseLayoutArgs = {}): LayoutValues {
  const size = useTerminalSize();
  const { sessionActive, leaderboardRows, compact } = args;
  return useMemo(
    () => getLayout(size, { sessionActive, leaderboardRows, compact }),
    [size, sessionActive, leaderboardRows, compact],
  );
}