import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface ExportModalProps {
  onConfirm: (format: "md" | "json", outputPath?: string) => void;
  onCancel: () => void;
}

type Field = "format" | "path";

/**
 * Format picker (md or json) with optional file path input.
 * Uses Tab/Enter navigation following the existing modal pattern.
 */
export function ExportModal({ onConfirm, onCancel }: ExportModalProps) {
  const [format, setFormat] = useState<"md" | "json">("md");
  const [path, setPath] = useState("");
  const [field, setField] = useState<Field>("format");

  const setActive = (fn: (s: string) => string) => {
    if (field === "path") setPath(fn);
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.tab) {
      setField(field === "format" ? "path" : "format");
      return;
    }
    if (field === "format") {
      // Toggle format with left/right or f key
      if (key.leftArrow || key.rightArrow || input === " " || input === "f") {
        setFormat((f) => (f === "md" ? "json" : "md"));
        return;
      }
      if (key.return) {
        onConfirm(format, path.trim() || undefined);
        return;
      }
    }
    if (field === "path") {
      if (key.return) {
        onConfirm(format, path.trim() || undefined);
        return;
      }
      if (key.backspace || key.delete) {
        setActive((v) => v.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta && input.length === 1 && input >= " ") {
        setActive((v) => v + input);
      }
    }
  });

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="green" paddingX={1}>
      <Text color="green" bold>EXPORT SESSION</Text>
      <Box marginTop={1} />
      <Text color={field === "format" ? "white" : "gray"}>
        {field === "format" ? "▶" : " "} Format:   <Text color="cyan">{format === "md" ? "markdown" : "json"}</Text>
        {"  "}
        <Text color="gray">[space/←→] toggle</Text>
      </Text>
      <Text color={field === "path" ? "white" : "gray"}>
        {field === "path" ? "▶" : " "} Path:     {path || "(default)"}
      </Text>
      <Box marginTop={1} />
      <Text color="gray">[tab] switch field   [enter] confirm   [esc] cancel</Text>
    </Box>
  );
}
