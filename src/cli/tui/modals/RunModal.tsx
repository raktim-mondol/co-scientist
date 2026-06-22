import React, { useState } from "react";
import { Box, Text, useInput } from "../../ink.js";

interface RunModalProps {
  onConfirm: (goal: string, name?: string) => void;
  onCancel: () => void;
}

type Field = "goal" | "name";

/**
 * Two-field form for starting a new research session.
 * Goal is required; name is optional. Follows the same useInput pattern as InjectModal.
 */
export function RunModal({ onConfirm, onCancel }: RunModalProps) {
  const [goal, setGoal] = useState("");
  const [name, setName] = useState("");
  const [field, setField] = useState<Field>("goal");

  const setActive = (fn: (s: string) => string) => {
    if (field === "goal") setGoal(fn);
    else setName(fn);
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.tab) {
      setField(field === "goal" ? "name" : "goal");
      return;
    }
    if (key.return) {
      if (field === "goal") {
        setField("name");
      } else if (goal.trim()) {
        onConfirm(goal.trim(), name.trim() || undefined);
      }
      return;
    }
    if (key.backspace || key.delete) {
      setActive((v) => v.slice(0, -1));
      return;
    }
    // Append printable characters only.
    if (input && !key.ctrl && !key.meta && input.length === 1 && input >= " ") {
      setActive((v) => v + input);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="claude" bold>START NEW SESSION</Text>
      <Text dimColor={field !== "goal"}>
        {field === "goal" ? "▶" : " "} Goal:     {goal || "_"}
      </Text>
      <Text dimColor={field !== "name"}>
        {field === "name" ? "▶" : " "} Name:     {name || "(optional)"}
      </Text>
      <Text dimColor>[tab] switch field   [enter] next/confirm   [esc] cancel</Text>
    </Box>
  );
}
