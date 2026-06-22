import React, { useState } from "react";
import { Box, Text, useInput } from "../../ink.js";

interface InjectModalProps {
  onConfirm: (title: string, content: string) => void;
  onCancel: () => void;
}

export function InjectModal({ onConfirm, onCancel }: InjectModalProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [step, setStep] = useState<"title" | "content">("title");

  const setActive = (fn: (s: string) => string) => {
    if (step === "title") setTitle(fn);
    else setContent(fn);
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      if (step === "title") {
        if (title.trim()) setStep("content");
        else onCancel();
      } else {
        if (content.trim()) onConfirm(title, content);
        else onCancel();
      }
      return;
    }
    if (key.backspace || key.delete) {
      setActive((v) => v.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta && input.length === 1 && input >= " ") {
      setActive((v) => v + input);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text color="suggestion" bold>💉 Inject Hypothesis</Text>
      {step === "title" && (
        <Box flexDirection="column">
          <Text dimColor>Enter hypothesis title (Esc to cancel):</Text>
          <Text>{title || "_"}</Text>
        </Box>
      )}
      {step === "content" && (
        <Box flexDirection="column">
          <Text dimColor>Enter hypothesis content (Esc to cancel):</Text>
          <Text>{content || "_"}</Text>
        </Box>
      )}
      <Text dimColor>[enter] next/confirm   [esc] cancel</Text>
    </Box>
  );
}
