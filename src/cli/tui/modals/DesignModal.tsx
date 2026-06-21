import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "../../ink.js";
import type { Hypothesis } from "../../../models/hypothesis.js";
import { ExperimentDesignAgent } from "../../../agents/experimentDesign.js";
import type { ExperimentProtocol } from "../../../agents/experimentDesign.js";
import { useTerminalSize } from "../useTerminalSize.js";

interface DesignModalProps {
  sessionId: string;
  hypothesisId?: string;
  hypotheses: Hypothesis[];
  onDone?: (entry: { title: string; hypothesisTitle: string; steps: string[] }) => void;
  onCancel: () => void;
}

type Stage = "pick" | "loading" | "done";

// Rows consumed by modal chrome (title, subtitle, margins, hints, border).
const PICKER_CHROME = 6;
const PROTOCOL_CHROME = 5;
const MAX_VISIBLE = 8;
const MIN_VISIBLE = 2;

/**
 * Hypothesis picker → ExperimentDesignAgent → scrollable protocol view.
 * Both the picker and the protocol view are windowed to a fixed height so Ink
 * can do in-place updates — eliminating flicker during ↑/↓ navigation.
 */
export function DesignModal({
  sessionId,
  hypothesisId: preSelectedId,
  hypotheses,
  onDone,
  onCancel,
}: DesignModalProps) {
  const { rows } = useTerminalSize();
  const [stage, setStage] = useState<Stage>("pick");
  const [selectedIdx, setSelectedIdx] = useState(
    preSelectedId ? Math.max(0, hypotheses.findIndex((h) => h.id === preSelectedId)) : 0,
  );
  const [protocol, setProtocol] = useState<ExperimentProtocol | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scrollOff, setScrollOff] = useState(0);

  const selectedHyp = hypotheses[selectedIdx];

  // Scroll with arrow keys when viewing protocol
  const protocolLines = protocol
    ? [
        `Overview: ${protocol.overview}`,
        ...(protocol.steps ?? []).map(
          (s) => `  ${s.step}. ${s.action} — ${s.details}`,
        ),
        `Reagents: ${(protocol.reagentsAndEquipment ?? []).join(", ") || "—"}`,
        `Datasets: ${(protocol.datasets ?? []).join(", ") || "—"}`,
        `Expected: ${protocol.expectedOutcomes}`,
        `Controls: ${protocol.controls}`,
        `Timeline: ${protocol.timelineWeeks} weeks | Cost: ${protocol.costTier}`,
      ]
    : [];

  const protocolMaxVisible = Math.max(2, Math.min(8, rows - PROTOCOL_CHROME));
  const maxScroll = Math.max(0, protocolLines.length - protocolMaxVisible);

  const pickerVisibleCount = Math.max(MIN_VISIBLE, Math.min(MAX_VISIBLE, rows - PICKER_CHROME));

  const startDesign = async () => {
    if (!selectedHyp) return;
    setStage("loading");
    setError(null);
    try {
      const agent = new ExperimentDesignAgent();
      const result = await agent.execute(sessionId, selectedHyp.id);
      if (result) {
        setProtocol(result);
        setStage("done");
        // Push the result to the transcript for the scrollback history.
        onDone?.({
          title: "Experimental Design Protocol",
          hypothesisTitle: result.hypothesisTitle,
          steps: (result.steps ?? []).map((s: { step: number; action: string; details: string }) =>
            `  ${s.step}. ${s.action} — ${s.details}`),
        });
      } else {
        setError("Failed to generate experimental protocol. The agent returned no result.");
        setStage("pick");
      }
    } catch (err) {
      setError(`Error: ${(err as Error).message}`);
      setStage("pick");
    }
  };

  useInput((input, key) => {
    if (key.escape) {
      if (stage === "done") {
        setStage("pick");
        setProtocol(null);
        return;
      }
      onCancel();
      return;
    }

    if (stage === "pick") {
      if (key.upArrow) setSelectedIdx((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSelectedIdx((i) => Math.min(hypotheses.length - 1, i + 1));
      else if (key.return && selectedHyp) {
        startDesign();
      }
      return;
    }

    if (stage === "done") {
      if (key.upArrow) setScrollOff((s) => Math.max(0, s - 1));
      else if (key.downArrow) setScrollOff((s) => Math.min(maxScroll, s + 1));
      else if (input === "/") {
        setStage("pick");
        setProtocol(null);
      }
      return;
    }
    // stage === "loading" — no interaction except Esc (handled above)
  });

  // Render: loading state
  if (stage === "loading") {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="permission" paddingX={1}>
        <Text color="permission" bold>EXPERIMENTAL DESIGN</Text>
        <Box marginTop={1} />
        <Text color="warning">⏳ Generating experimental protocol for:</Text>
        <Text color="text">{selectedHyp?.title.slice(0, 60)}</Text>
        <Text dimColor>(this may take a moment)</Text>
      </Box>
    );
  }

  // Render: protocol view (windowed)
  if (stage === "done" && protocol) {
    const visible = protocolLines.slice(scrollOff, scrollOff + protocolMaxVisible);
    const hasMoreUp = scrollOff > 0;
    const hasMoreDown = scrollOff < maxScroll;
    const spacerCount = protocolMaxVisible - visible.length;

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="permission" paddingX={1}>
        <Text color="permission" bold>EXPERIMENTAL PROTOCOL</Text>
        <Text color="claude">{protocol.hypothesisTitle.slice(0, 60)}</Text>
        <Box marginTop={1} />
        {/* Locked-height viewport for protocol lines. */}
        <Box flexDirection="column" height={protocolMaxVisible} flexShrink={0}>
          {visible.map((line, i) => {
            const isEdge = !(i === 0 && hasMoreUp) && i === visible.length - 1 && hasMoreDown;
            return (
              <Text key={i} color="text" dimColor={isEdge}>
                {line}
              </Text>
            );
          })}
          {spacerCount > 0 &&
            Array.from({ length: spacerCount }).map((_, i) => (
              <Text key={`sp-${i}`} dimColor> </Text>
            ))}
        </Box>
        <Box marginTop={1} />
        <Text dimColor wrap="truncate">
          {hasMoreUp ? "▲" : " "}{hasMoreDown ? "▼" : " "} {scrollOff + 1}-{Math.min(scrollOff + protocolMaxVisible, protocolLines.length)} of {protocolLines.length} · [▲▼] scroll · [/] picker · [esc] back
        </Text>
      </Box>
    );
  }

  // Render: picker (windowed, x_code FuzzyPicker style)
  if (hypotheses.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="permission" paddingX={1}>
        <Text color="permission" bold>DESIGN EXPERIMENT</Text>
        <Box marginTop={1} />
        <Text dimColor>No hypotheses available.</Text>
        <Box marginTop={1} />
        <Text dimColor>[esc] cancel</Text>
      </Box>
    );
  }

  const sel = Math.max(0, Math.min(selectedIdx, hypotheses.length - 1));
  const pickerStart =
    hypotheses.length <= pickerVisibleCount
      ? 0
      : Math.max(0, Math.min(sel - Math.floor(pickerVisibleCount / 2), hypotheses.length - pickerVisibleCount));
  const pickerEnd = Math.min(pickerStart + pickerVisibleCount, hypotheses.length);
  const pickerVisible = hypotheses.slice(pickerStart, pickerEnd);
  const hasAbove = pickerStart > 0;
  const hasBelow = pickerEnd < hypotheses.length;
  const pickerSpacerCount = pickerVisibleCount - pickerVisible.length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="permission" paddingX={1}>
      <Text color="permission" bold>DESIGN EXPERIMENT</Text>
      <Text dimColor>Select a hypothesis to generate experimental protocol:</Text>
      <Box marginTop={1} />

      {/* Locked-height picker list. */}
      <Box flexDirection="column" height={pickerVisibleCount} flexShrink={0}>
        {pickerVisible.map((h, i) => {
          const globalIdx = pickerStart + i;
          const isSel = globalIdx === sel;
          const isEdge = !isSel && ((i === 0 && hasAbove) || (i === pickerVisible.length - 1 && hasBelow));
          const glyph = isSel ? "❯" : isEdge ? (i === 0 ? "↑" : "↓") : " ";
          const title = h.title.length > 55 ? h.title.slice(0, 52) + "..." : h.title;
          return (
            <Text key={h.id} dimColor={!isSel && !isEdge} wrap="truncate">
              {glyph} [{Math.round(h.eloRating)}] {title}
            </Text>
          );
        })}
        {pickerSpacerCount > 0 &&
          Array.from({ length: pickerSpacerCount }).map((_, i) => (
            <Text key={`sp-${i}`} dimColor> </Text>
          ))}
      </Box>

      {error && <Text color="error">{error}</Text>}
      <Box marginTop={1} />
      <Text dimColor wrap="truncate">
        {hasAbove ? "▲" : " "}{hasBelow ? "▼" : " "} {sel + 1}/{hypotheses.length} · [▲▼] navigate · [enter] generate · [esc] cancel
      </Text>
    </Box>
  );
}

// Re-export for convenience
export type { ExperimentProtocol };
