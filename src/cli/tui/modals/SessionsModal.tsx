import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "../../ink.js";
import type { CoScientistSession } from "../../../models/session.js";
import { useTerminalSize } from "../useTerminalSize.js";

interface SessionsModalProps {
  sessions: CoScientistSession[];
  activeSessionId: string | null;
  onView: (sessionId: string) => void;
  onResume: (sessionId: string) => void;
  onOverview: (sessionId: string) => void;
  onExport: (sessionId: string) => void;
  onDelete: (sessionIds: string[]) => void;
  onCancel: () => void;
}

type Stage = "browse" | "confirm";
type Mode = "navigate" | "filter";

// Rows occupied by modal chrome (title, hints, margins, footer, border).
const CHROME_ROWS = 6;
const MAX_VISIBLE = 8;
const MIN_VISIBLE = 2;

const statusGlyph = (s: string) =>
  s === "completed" ? "✓" : s === "running" ? "▶" : s === "paused" ? "⏸" : "·";

/**
 * Unified, windowed sessions picker. Navigate mode drives single-letter actions
 * (enter view, r resume, o overview, e export, space mark, d delete); `/` enters
 * filter mode where typed characters narrow the list. Windowed to a fixed height
 * so Ink does in-place updates (no flicker).
 */
export function SessionsModal({
  sessions, activeSessionId, onView, onResume, onOverview, onExport, onDelete, onCancel,
}: SessionsModalProps) {
  const { rows } = useTerminalSize();
  const [stage, setStage] = useState<Stage>("browse");
  const [mode, setMode] = useState<Mode>("navigate");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const visibleCount = Math.max(MIN_VISIBLE, Math.min(MAX_VISIBLE, rows - CHROME_ROWS));

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q),
    );
  }, [sessions, filter]);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toDelete = useMemo(
    () => sessions.filter((s) => checked.has(s.id)),
    [sessions, checked],
  );

  const sel = Math.max(0, Math.min(selected, Math.max(0, filtered.length - 1)));
  const startIndex =
    filtered.length <= visibleCount
      ? 0
      : Math.max(0, Math.min(sel - Math.floor(visibleCount / 2), filtered.length - visibleCount));
  const endIndex = Math.min(startIndex + visibleCount, filtered.length);
  const visibleItems = filtered.slice(startIndex, endIndex);
  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < filtered.length;
  const spacerCount = visibleCount - visibleItems.length;

  useInput((input, key) => {
    if (stage === "confirm") {
      if (key.return || input === "y") onDelete(toDelete.map((s) => s.id));
      else if (input === "n" || key.escape) setStage("browse");
      return;
    }

    if (mode === "filter") {
      if (key.escape) { setFilter(""); setMode("navigate"); setSelected(0); return; }
      if (key.return) { setMode("navigate"); setSelected(0); return; }
      if (key.backspace || key.delete) { setFilter((f) => f.slice(0, -1)); setSelected(0); return; }
      if (input && !key.ctrl && !key.meta && input.length === 1 && input >= " ") {
        setFilter((f) => f + input);
        setSelected(0);
      }
      return;
    }

    // navigate mode
    if (key.escape) { onCancel(); return; }
    if (key.upArrow) { setSelected((s) => Math.max(0, s - 1)); return; }
    if (key.downArrow) { setSelected((s) => Math.min(filtered.length - 1, s + 1)); return; }
    if (input === "/") { setMode("filter"); return; }

    const cur = filtered[sel];
    if (!cur) return;
    if (key.return) { onView(cur.id); return; }
    if (input === "r") { onResume(cur.id); return; }
    if (input === "o") { onOverview(cur.id); return; }
    if (input === "e") { onExport(cur.id); return; }
    if (input === " ") { toggle(cur.id); return; }
    if (input === "d" && checked.size > 0) { setStage("confirm"); return; }
  });

  // ── Confirm stage ──────────────────────────────────────────────────────
  if (stage === "confirm") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="error" bold>CONFIRM DELETE</Text>
        <Box marginTop={1} />
        <Text color="error">
          This will permanently delete {toDelete.length} session(s) and all associated
          hypotheses, reviews, matches, and data. This cannot be undone.
        </Text>
        <Box marginTop={1} />
        {toDelete.slice(0, 10).map((s) => (
          <Text key={s.id} color="text">
            ⨯ {s.name.length > 50 ? s.name.slice(0, 47) + "..." : s.name} ({s.id.slice(0, 8)}) — {s.stats?.totalHypotheses ?? 0} hypotheses
          </Text>
        ))}
        {toDelete.length > 10 && <Text dimColor>  …and {toDelete.length - 10} more</Text>}
        <Box marginTop={1} />
        <Text dimColor>[y/enter] confirm delete   [n/esc] cancel</Text>
      </Box>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────
  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="claude" bold>SESSIONS</Text>
        <Box marginTop={1} />
        <Text dimColor>No sessions yet — type a research topic to begin.</Text>
        <Box marginTop={1} />
        <Text dimColor>[esc] close</Text>
      </Box>
    );
  }

  // ── Browse stage ───────────────────────────────────────────────────────
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="claude" bold>SESSIONS</Text>
      {mode === "filter"
        ? <Text dimColor>Filter: <Text color="text">{filter}</Text>▌</Text>
        : <Text dimColor>enter view · r resume · o overview · e export · space mark · / filter</Text>}
      <Box marginTop={1} />

      <Box flexDirection="column" height={visibleCount} flexShrink={0}>
        {filtered.length === 0 ? (
          <Text dimColor>No sessions match "{filter}"</Text>
        ) : (
          visibleItems.map((s, i) => {
            const globalIdx = startIndex + i;
            const isSel = globalIdx === sel;
            const chk = checked.has(s.id);
            const isEdge = !isSel && ((i === 0 && hasMoreAbove) || (i === visibleItems.length - 1 && hasMoreBelow));
            const glyph = isSel ? "❯" : isEdge ? (i === 0 ? "↑" : "↓") : " ";
            const name = s.name.length > 42 ? s.name.slice(0, 39) + "..." : s.name;
            const current = s.id === activeSessionId ? " •" : "";
            return (
              <Text key={s.id} dimColor={!isSel && !isEdge} wrap="truncate">
                {glyph} [{chk ? "*" : " "}] {statusGlyph(s.status)} {name} ({s.id.slice(0, 8)})
                {"  "}[{s.stats?.totalHypotheses ?? 0}h]{current}
              </Text>
            );
          })
        )}
        {filtered.length > 0 && spacerCount > 0 &&
          Array.from({ length: spacerCount }).map((_, i) => (
            <Text key={`sp-${i}`} dimColor> </Text>
          ))}
      </Box>

      <Box marginTop={1} />
      <Text dimColor wrap="truncate">
        {hasMoreAbove ? "▲" : " "}{hasMoreBelow ? "▼" : " "} {filtered.length === 0 ? 0 : sel + 1}/{filtered.length}
        {filter ? ` (of ${sessions.length})` : ""} · {checked.size} marked · [d] delete · [esc]
      </Text>
    </Box>
  );
}
