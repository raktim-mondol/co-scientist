import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type { CoScientistSession } from "../../../models/session.js";

interface DeleteModalProps {
  sessions: CoScientistSession[];
  onConfirm: (sessionIds: string[]) => void;
  onCancel: () => void;
}

type Stage = "select" | "confirm";

/**
 * Two-stage modal: select sessions (Space to toggle), then confirm with warning.
 */
export function DeleteModal({ sessions, onConfirm, onCancel }: DeleteModalProps) {
  const [stage, setStage] = useState<Stage>("select");
  const [selected, setSelected] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toDelete = useMemo(
    () => sessions.filter((s) => checked.has(s.id)),
    [sessions, checked],
  );

  useInput((input, key) => {
    if (key.escape) {
      if (stage === "confirm") {
        setStage("select");
        return;
      }
      onCancel();
      return;
    }

    if (stage === "select") {
      if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
      else if (key.downArrow) setSelected((s) => Math.min(sessions.length - 1, s + 1));
      else if (input === " ") {
        const sid = sessions[selected]?.id;
        if (sid) toggle(sid);
      } else if (key.return && checked.size > 0) {
        setStage("confirm");
      }
      return;
    }

    if (stage === "confirm") {
      if (key.return || input === "y") {
        onConfirm(toDelete.map((s) => s.id));
      } else if (input === "n") {
        setStage("select");
      }
    }
  });

  // Confirm stage
  if (stage === "confirm") {
    return (
      <Box flexDirection="column" borderStyle="double" borderColor="red" paddingX={1}>
        <Text color="red" bold>CONFIRM DELETE</Text>
        <Box marginTop={1} />
        <Text color="red">
          This will permanently delete {toDelete.length} session(s) and all associated
          hypotheses, reviews, matches, and data. This cannot be undone.
        </Text>
        <Box marginTop={1} />
        {toDelete.map((s) => (
          <Text key={s.id} color="white">
            ⨯ {s.name} ({s.id.slice(0, 8)}) — {s.stats?.totalHypotheses ?? 0} hypotheses
          </Text>
        ))}
        <Box marginTop={1} />
        <Text color="gray">[y/enter] confirm delete   [n/esc] cancel</Text>
      </Box>
    );
  }

  // Select stage
  return (
    <Box flexDirection="column" borderStyle="double" borderColor="red" paddingX={1}>
      <Text color="red" bold>DELETE SESSIONS</Text>
      <Text color="gray">Space to select, Enter to confirm:</Text>
      <Box marginTop={1} />
      {sessions.length === 0 ? (
        <Text color="gray">No sessions to delete.</Text>
      ) : (
        sessions.map((s, i) => {
          const sel = i === selected;
          const chk = checked.has(s.id);
          const status = s.status === "completed" ? "✓" : s.status === "running" ? "▶" : "⏸";
          return (
            <Text key={s.id} color={sel ? "white" : "gray"}>
              {sel ? "▶" : " "} [{chk ? "*" : " "}] {status} {s.name} ({s.id.slice(0, 8)})
              {"  "}[{s.stats?.totalHypotheses ?? 0}h]
            </Text>
          );
        })
      )}
      <Box marginTop={1} />
      <Text color="gray">[▲▼] navigate   [space] toggle   [enter] confirm ({checked.size} selected)   [esc] cancel</Text>
    </Box>
  );
}
