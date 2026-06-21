import { useState, useEffect } from "react";
import { useStdout } from "../ink.js";

export interface TerminalSize {
  rows: number;
  columns: number;
}

// Tracks the live terminal dimensions and updates on SIGWINCH/resize.
// Falls back to a sane 24×80 when stdout isn't a TTY (tests, pipes), so
// height-bounded layout math never divides by zero or goes negative.
export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();

  const read = (): TerminalSize => ({
    rows: stdout?.rows && stdout.rows > 0 ? stdout.rows : 24,
    columns: stdout?.columns && stdout.columns > 0 ? stdout.columns : 80,
  });

  const [size, setSize] = useState<TerminalSize>(read);

  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setSize(read);
    stdout.on("resize", onResize);
    // Read once on mount in case the terminal changed before the listener attached.
    onResize();
    return () => {
      stdout.off("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stdout]);

  return size;
}
