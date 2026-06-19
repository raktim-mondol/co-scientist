import React, { useMemo } from "react";
import { Box, Text, useInput } from "../../ink.js";
import type { AppContext } from "../CommandRouter.js";

interface GraphProps {
  appContext: AppContext;
  focus: boolean;
}

/**
 * Renders the hypothesis relationship graph as a text tree.
 * Shows parent-child evolution chains and concept clusters.
 */
export function Graph({ appContext, focus }: GraphProps) {
  const hypotheses = useMemo(
    () => (appContext.sessionId ? appContext.memory.getAllActiveHypotheses(appContext.sessionId) : []),
    [appContext.sessionId, appContext.memory],
  );

  // Build a parent→children adjacency list
  const children = useMemo(() => {
    const map = new Map<string, typeof hypotheses>();
    for (const h of hypotheses) {
      for (const pid of h.parentIds) {
        const list = map.get(pid) ?? [];
        list.push(h);
        map.set(pid, list);
      }
    }
    return map;
  }, [hypotheses]);

  // Roots are hypotheses with no parents
  const roots = useMemo(
    () => hypotheses.filter((h) => h.parentIds.length === 0),
    [hypotheses],
  );

  useInput(() => {}, { isActive: focus });

  function renderTree(hypId: string, depth: number = 0): React.ReactNode[] {
    const hyp = hypotheses.find((h) => h.id === hypId);
    if (!hyp) return [];
    const prefix = "  ".repeat(depth) + (depth > 0 ? "├─ " : "");
    const kids = children.get(hypId) ?? [];

    const nodes: React.ReactNode[] = [
      <Box key={hyp.id}>
        <Text color={depth === 0 ? "claude" : "text"}>
          {prefix}{hyp.title.slice(0, 50)} <Text dimColor>[{Math.round(hyp.eloRating)}]</Text>
        </Text>
      </Box>,
    ];

    for (const child of kids) {
      nodes.push(...renderTree(child.id, depth + 1));
    }
    return nodes;
  }

  if (hypotheses.length === 0) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text dimColor>No hypotheses to graph yet.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text color="claude" bold>Hypothesis Graph ({hypotheses.length} nodes, {roots.length} roots)</Text>
      {roots.map((root) => (
        <React.Fragment key={root.id}>{renderTree(root.id)}</React.Fragment>
      ))}
        <Box marginTop={1}>
          <Text dimColor>[/] return to input</Text>
        </Box>
    </Box>
  );
}
