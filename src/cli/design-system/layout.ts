// Adaptive layout constants derived from terminal size.
//
// Hardcoded layout values (MAX_ITEMS=8, RESERVED_ROWS=9, topN=10) don't adapt
// to terminal size. This pure function computes layout values from a
// TerminalSize so the TUI scales correctly at 80×24, 120×40, and small
// terminals. Consumed via the `useLayout()` hook.

export interface TerminalSize {
  rows: number;
  columns: number;
}

export interface LayoutValues {
  /** Maximum leaderboard rows to render. Scales with height but capped. */
  leaderboardMax: number;
  /** Maximum visible command-palette rows. */
  paletteMaxVisible: number;
  /** Maximum modal body height. */
  modalMaxHeight: number;
  /**
   * Rows reserved for bottom chrome (LiveStatus + InputBar + Footer +
   * NotificationBar). The transcript virtual list gets `rows - reservedBottom`.
   */
  reservedBottom: number;
  /** Maximum transcript rows visible in the virtual list window. */
  transcriptMaxRows: number;
  /** True when the terminal is too short for the full chrome — triggers a
   *  compact fallback so the frame never overflows. */
  compact: boolean;
}

const MIN_ROWS = 8;

/**
 * Compute layout values from a terminal size. Pure — no React, no side effects.
 *
 * The bottom chrome estimate (`reservedBottom`) is deliberately conservative:
 * LiveStatus (status + gauge + separators ≈ 4) + leaderboard rows + InputBar
 * (bordered box ≈ 1) + Footer (1) + a NotificationBar buffer (1). When no
 * session is active, LiveStatus renders nothing so the transcript gets the
 * full height.
 */
export function getLayout(
  size: TerminalSize,
  opts?: { sessionActive?: boolean; leaderboardRows?: number; compact?: boolean },
): LayoutValues {
  const rows = Math.max(MIN_ROWS, size.rows);
  const sessionActive = opts?.sessionActive ?? false;
  const leaderboardRows = opts?.leaderboardRows ?? 0;
  const compact = opts?.compact ?? false;

  const leaderboardMax = Math.min(10, Math.max(3, rows - 15));
  const paletteMaxVisible = Math.min(16, Math.max(3, rows - 12));
  const modalMaxHeight = Math.min(20, Math.max(4, rows - 6));

  // Bottom chrome: LiveStatus + InputBar + Footer + notification buffer.
  let liveStatusRows = 0;
  if (sessionActive) {
    liveStatusRows = compact ? 1 : 4 + Math.min(leaderboardRows, leaderboardMax);
  }
  const inputBarRows = 1; // bordered prompt box (border draws on the row)
  const footerRows = 1;
  const notificationBuffer = 1;
  const reservedBottom = liveStatusRows + inputBarRows + footerRows + notificationBuffer;

  const transcriptMaxRows = Math.max(1, rows - reservedBottom - 1);

  return {
    leaderboardMax,
    paletteMaxVisible,
    modalMaxHeight,
    reservedBottom,
    transcriptMaxRows,
    compact: rows <= MIN_ROWS,
  };
}