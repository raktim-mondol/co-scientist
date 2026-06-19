import React, { useState, useEffect } from "react";
import { Text } from "../ink.js";

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setI((prev) => (prev + 1) % frames.length), 80);
    return () => clearInterval(id);
  }, []);

  return <Text color="claude">{frames[i]}</Text>;
}
