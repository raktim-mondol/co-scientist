import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface InjectModalProps {
  onConfirm: (title: string, content: string) => void;
  onCancel: () => void;
}

type Field = "title" | "content";

/**
 * Minimal two-field text entry built on useInput (avoids adding an external
 * text-input dependency). Tab/Enter moves title -> content; Enter on content
 * submits if both fields are non-empty.
 */
export function InjectModal({ onConfirm, onCancel }: InjectModalProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [field, setField] = useState<Field>("title");

  const setActive = (fn: (s: string) => string) => {
    if (field === "title") setTitle(fn);
    else setContent(fn);
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.tab) {
      setField(field === "title" ? "content" : "title");
      return;
    }
    if (key.return) {
      if (field === "title") {
        setField("content");
      } else if (title.trim() && content.trim()) {
        onConfirm(title.trim(), content.trim());
      }
      return;
    }
    if (key.backspace || key.delete) {
      setActive((v) => v.slice(0, -1));
      return;
    }
    // Append printable characters only (ignore control keys / arrows).
    if (input && !key.ctrl && !key.meta && input.length === 1 && input >= " ") {
      setActive((v) => v + input);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="green" paddingX={1}>
      <Text color="green" bold>INJECT HYPOTHESIS</Text>
      <Text color={field === "title" ? "white" : "gray"}>
        {field === "title" ? "▶" : " "} Title:   {title || "_"}
      </Text>
      <Text color={field === "content" ? "white" : "gray"}>
        {field === "content" ? "▶" : " "} Content: {content || "_"}
      </Text>
      <Text color="gray">[tab] switch field   [enter] next/submit   [esc] cancel</Text>
    </Box>
  );
}
