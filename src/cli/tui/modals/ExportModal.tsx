import React, { useState } from "react";
import { Box, Text, useInput } from "../../ink.js";

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
    <Box flexDirection="column" paddingX={1}>
      <Text color="success" bold>EXPORT SESSION</Text>
      <Box marginTop={1} />
      <Text color="text" dimColor={field !== "format"} backgroundColor="bg">
        {field === "format" ? "▶" : " "} Format:   <Text color="claude">{format === "md" ? "markdown" : "json"}</Text>
        {"  "}
        <Text dimColor>[space/←→] toggle</Text>
      </Text>
      <Text color="text" dimColor={field !== "path"} backgroundColor="bg">
        {field === "path" ? "▶" : " "} Path:     {path || "(default)"}
      </Text>
      <Box marginTop={1} />
      <Text dimColor>[tab] switch field   [enter] confirm   [esc] cancel</Text>
    </Box>
  );
}
