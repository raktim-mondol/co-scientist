import React from "react";
import { Box, Text } from "../ink.js";
import type { CommandSuggestion } from "./CommandRouter.js";

interface CommandPaletteProps {
  suggestions: CommandSuggestion[];
  selectedIndex: number;
  visible: boolean;
}

const CATEGORY_COLORS: Record<string, string> = {
  Lifecycle: "claude",
  Control: "warning",
  Results: "permission",
  Actions: "success",
  System: "inactive",
};

export function CommandPalette({ suggestions, selectedIndex, visible }: CommandPaletteProps) {
  if (!visible || suggestions.length === 0) return null;

  const grouped: Record<string, CommandSuggestion[]> = {};
  for (const s of suggestions) {
    if (!grouped[s.category]) grouped[s.category] = [];
    grouped[s.category].push(s);
  }

  let globalIndex = 0;
  const rows: React.ReactNode[] = [];

  for (const [category, items] of Object.entries(grouped)) {
    const headerColor = CATEGORY_COLORS[category] || "text";
    rows.push(
      <Box key={`header-${category}`} paddingX={1}>
        <Text color={headerColor} bold>
          {category}
        </Text>
      </Box>
    );
    for (const item of items) {
      const isSelected = globalIndex === selectedIndex;
      const isActive = item.active;
      rows.push(
        <Box key={`item-${item.name}`} paddingX={2}>
          {isSelected ? (
            <Text color="inverseText" backgroundColor="text" bold>
              {item.name}  {item.description}
            </Text>
          ) : (
            <Text color={isActive ? "text" : undefined} dimColor={!isActive}>
              {item.name}
              <Text dimColor>  {item.description}</Text>
            </Text>
          )}
        </Box>
      );
      globalIndex++;
    }
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
      {rows}
    </Box>
  );
}
