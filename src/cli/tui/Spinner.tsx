import React, { useState, useEffect, memo } from "react";
import { Text } from "ink";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Isolated spinner — renders in its own memoised subtree so that the
 * 80 ms frame tick does NOT cause the parent tree to re-diff.
 */
export const Spinner = memo(function Spinner() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length);
    }, 80);
    return () => clearInterval(id);
  }, []);

  return <Text>{FRAMES[frame]}</Text>;
});
