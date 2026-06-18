import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { Hypothesis } from "../../../models/hypothesis.js";
import { ExperimentDesignAgent } from "../../../agents/experimentDesign.js";
import type { ExperimentProtocol } from "../../../agents/experimentDesign.js";

interface DesignModalProps {
  sessionId: string;
  hypothesisId?: string;
  hypotheses: Hypothesis[];
  onCancel: () => void;
}

type Stage = "pick" | "loading" | "done";

/**
 * Hypothesis picker → ExperimentDesignAgent → scrollable protocol view.
 * Supports pre-selection via hypothesisId prop.
 */
export function DesignModal({ sessionId, hypothesisId: preSelectedId, hypotheses, onCancel }: DesignModalProps) {
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

  const maxScroll = Math.max(0, protocolLines.length - 8);

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
        // Go back to picker
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
        // Return to picker
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
      <Box flexDirection="column" borderStyle="double" borderColor="blue" paddingX={1}>
        <Text color="blue" bold>EXPERIMENTAL DESIGN</Text>
        <Box marginTop={1} />
        <Text color="yellow">⏳ Generating experimental protocol for:</Text>
        <Text color="white">{selectedHyp?.title.slice(0, 60)}</Text>
        <Text color="gray">(this may take a moment)</Text>
      </Box>
    );
  }

  // Render: protocol view
  if (stage === "done" && protocol) {
    const visible = protocolLines.slice(scrollOff, scrollOff + 8);
    return (
      <Box flexDirection="column" borderStyle="double" borderColor="blue" paddingX={1}>
        <Text color="blue" bold>EXPERIMENTAL PROTOCOL</Text>
        <Text color="cyan">{protocol.hypothesisTitle.slice(0, 60)}</Text>
        <Box marginTop={1} />
        {visible.map((line, i) => (
          <Text key={i} color="white">{line}</Text>
        ))}
        <Box marginTop={1} />
        <Text color="gray">[▲▼] scroll ({scrollOff + 1}-{Math.min(scrollOff + 8, protocolLines.length)} of {protocolLines.length})   [esc] picker   [/] back</Text>
      </Box>
    );
  }

  // Render: picker (default)
  return (
    <Box flexDirection="column" borderStyle="double" borderColor="blue" paddingX={1}>
      <Text color="blue" bold>DESIGN EXPERIMENT</Text>
      <Text color="gray">Select a hypothesis to generate experimental protocol:</Text>
      <Box marginTop={1} />
      {hypotheses.length === 0 ? (
        <Text color="gray">No hypotheses available.</Text>
      ) : (
        hypotheses.slice(0, 15).map((h, i) => {
          const sel = i === selectedIdx;
          return (
            <Text key={h.id} color={sel ? "white" : "gray"}>
              {sel ? "▶" : " "} [{Math.round(h.eloRating)}] {h.title.slice(0, 55)}
            </Text>
          );
        })
      )}
      {error && (
        <Text color="red">{error}</Text>
      )}
      <Box marginTop={1} />
      <Text color="gray">[▲▼] navigate   [enter] generate   [esc] cancel</Text>
    </Box>
  );
}

// Re-export for convenience
export type { ExperimentProtocol };
