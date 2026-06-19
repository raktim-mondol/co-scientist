import React, { useState } from "react";
import { Box, Text, useInput } from "../../ink.js";

interface FeedbackModalProps {
  hypothesisId?: string;
  hypotheses: Array<{ id: string; title: string }>;
  onConfirm: (data: {
    hypothesisId: string;
    feedbackText: string;
    noveltyScore?: number;
    correctnessScore?: number;
    testabilityScore?: number;
  }) => void;
  onCancel: () => void;
}

type Field = "hypothesis" | "text" | "novelty" | "correctness" | "testability";
const FIELDS: Field[] = ["hypothesis", "text", "novelty", "correctness", "testability"];
const FIELD_LABELS: Record<Field, string> = {
  hypothesis: "Hypothesis",
  text: "Feedback",
  novelty: "Novelty (0-10)",
  correctness: "Correctness (0-10)",
  testability: "Testability (0-10)",
};

/**
 * Form for submitting experimental feedback on a hypothesis.
 * Hypothesis picker, free-text input, and optional N/C/T numeric scores.
 * Follows the same useInput pattern as InjectModal.
 */
export function FeedbackModal({ hypothesisId: preSelectedId, hypotheses, onConfirm, onCancel }: FeedbackModalProps) {
  const [field, setField] = useState<Field>("hypothesis");
  const [fieldIdx, setFieldIdx] = useState(0);
  const [hypIdx, setHypIdx] = useState(
    preSelectedId ? Math.max(0, hypotheses.findIndex((h) => h.id === preSelectedId)) : 0,
  );
  const [text, setText] = useState("");
  const [novelty, setNovelty] = useState("");
  const [correctness, setCorrectness] = useState("");
  const [testability, setTestability] = useState("");

  const setActive = (fn: (s: string) => string) => {
    switch (field) {
      case "text": setText(fn); break;
      case "novelty": setNovelty(fn); break;
      case "correctness": setCorrectness(fn); break;
      case "testability": setTestability(fn); break;
    }
  };

  const getValue = (f: Field): string => {
    switch (f) {
      case "hypothesis": return hypotheses[hypIdx]?.title ?? "(none)";
      case "text": return text;
      case "novelty": return novelty;
      case "correctness": return correctness;
      case "testability": return testability;
    }
  };

  const parseScore = (s: string): number | undefined => {
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? undefined : Math.max(0, Math.min(10, n));
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.tab) {
      const next = (fieldIdx + 1) % FIELDS.length;
      setFieldIdx(next);
      setField(FIELDS[next]);
      return;
    }
    if (field === "hypothesis") {
      if (key.upArrow) setHypIdx((i) => Math.max(0, i - 1));
      else if (key.downArrow) setHypIdx((i) => Math.min(hypotheses.length - 1, i + 1));
      else if (key.return) {
        // Move to next field
        const next = (fieldIdx + 1) % FIELDS.length;
        setFieldIdx(next);
        setField(FIELDS[next]);
      }
      return;
    }
    if (field === "text") {
      if (key.return) {
        const hypId = hypotheses[hypIdx]?.id;
        if (hypId && text.trim()) {
          onConfirm({
            hypothesisId: hypId,
            feedbackText: text.trim(),
            noveltyScore: parseScore(novelty),
            correctnessScore: parseScore(correctness),
            testabilityScore: parseScore(testability),
          });
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
      return;
    }
    // Numeric fields
    if (key.return) {
      // Submit on Enter from last numeric field
      const hypId = hypotheses[hypIdx]?.id;
      if (hypId && text.trim()) {
        onConfirm({
          hypothesisId: hypId,
          feedbackText: text.trim(),
          noveltyScore: parseScore(novelty),
          correctnessScore: parseScore(correctness),
          testabilityScore: parseScore(testability),
        });
      }
      return;
    }
    if (key.backspace || key.delete) {
      setActive((v) => v.slice(0, -1));
      return;
    }
    if (/^[0-9]$/.test(input)) {
      setActive((v) => (v.length < 2 ? v + input : v));
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1}>
      <Text color="suggestion" bold>SUBMIT FEEDBACK</Text>
      <Box marginTop={1} />
      {FIELDS.map((f) => {
        const active = field === f;
        const val = getValue(f);
        const display = f === "hypothesis"
          ? (val.length > 50 ? val.slice(0, 47) + "..." : val)
          : (val || "_");
        return (
          <Text key={f} dimColor={!active}>
            {active ? "▶" : " "} {FIELD_LABELS[f].padEnd(18)} {display}
            {f === "hypothesis" && active ? " [▲▼]" : ""}
          </Text>
        );
      })}
      <Box marginTop={1} />
      <Text dimColor>[tab] switch field   [enter] next/submit   [esc] cancel</Text>
    </Box>
  );
}
