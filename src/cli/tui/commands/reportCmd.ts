import { registerCommand } from "../CommandRouter.js";
import type { CommandHandler } from "../CommandRouter.js";
import { reportCommand } from "../../commands/report.js";
import { formatSystemNotice } from "../formatters.js";

const VALID = new Set(["md", "latex", "docx", "pdf"]);

const reportCmdHandler: CommandHandler = {
  name: "report",
  description: "Generate a publication-style manuscript (md | latex | docx | pdf)",
  category: "Actions",
  activeWhen: (ctx) => ctx.sessionId !== null,
  async execute(args, ctx) {
    const format = (args[0] ?? "md").toLowerCase();
    if (!VALID.has(format)) {
      return { type: "error", message: "Format must be one of: md, latex, docx, pdf." };
    }
    try {
      await reportCommand(ctx.sessionId!, { format });
      return {
        type: "transcript",
        entries: [formatSystemNotice(`Generated ${format} report.`, "success")],
      };
    } catch (err) {
      return { type: "error", message: `Report failed: ${(err as Error).message}` };
    }
  },
};

registerCommand(reportCmdHandler);
