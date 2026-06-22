import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";
import { exportCommand } from "../../commands/export.js";
import { formatSystemNotice } from "../formatters.js";

const exportCmdHandler: CommandHandler = {
  name: "export",
  description: "Export session as markdown or JSON",
  category: "Actions",
  activeWhen: (ctx) => ctx.sessionId !== null,
  async execute(args, ctx) {
    if (args.length > 0) {
      // Direct export with format argument
      const format = args[0] as "md" | "json";
      if (format !== "md" && format !== "json") {
        return { type: "error", message: "Format must be 'md' or 'json'." };
      }
      try {
        await exportCommand(ctx.sessionId!, { format });
        return { type: "transcript", entries: [formatSystemNotice(`Exported session as ${format}.`, "success")] };
      } catch (err) {
        return { type: "error", message: `Export failed: ${(err as Error).message}` };
      }
    }
    // No args — open ExportModal
    return { type: "modal", modal: "export" };
  },
};

registerCommand(exportCmdHandler);
