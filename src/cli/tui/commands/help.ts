import { registerCommand, getAllCommands } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";

/**
 * Renders all registered commands grouped by category as a formatted overlay.
 * Since this returns an immediate result, the formatted message is displayed
 * as a multi-line toast. For a richer view, callers can check the result.
 */
const helpCommand: CommandHandler = {
  name: "help",
  description: "Show all available commands",
  category: "System",
  async execute(_args, ctx) {
    const all = getAllCommands();
    const byCategory = new Map<string, typeof all>();
    for (const cmd of all) {
      const cat = cmd.category;
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(cmd);
    }

    const categoryOrder = ["Lifecycle", "Control", "Results", "Actions", "System"];
    const lines: string[] = ["", "Available Commands:"];

    for (const cat of categoryOrder) {
      const cmds = byCategory.get(cat);
      if (!cmds || cmds.length === 0) continue;

      // Category header
      lines.push(`  ${cat}:`);
      for (const c of cmds) {
        const isActive = !c.activeWhen || c.activeWhen(ctx);
        const mark = isActive ? " " : "✗";
        const prefix = isActive ? `/${c.name}` : `✗ /${c.name} (unavailable)`;
        lines.push(`    ${mark} ${prefix.padEnd(28)} ${c.description}`);
      }
    }

    lines.push("");
    lines.push('Type a research topic to start a session, or "/" to see autocomplete.');

    return { type: "immediate", message: lines.join("\n") };
  },
};

registerCommand(helpCommand);
