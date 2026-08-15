import { writeFileSync, statSync } from "fs";
import chalk from "chalk";
import { getContextStore } from "../../memory/contextStore.js";
import { runMigrations } from "../../db/migrate.js";
import { getConfig } from "../../config.js";
import { ReportAgent } from "../../agents/report.js";
import { toMarkdown, toLatex, convertWithPandoc } from "../../agents/reportRenderers.js";
import type { Manuscript } from "../../models/manuscript.js";

type ReportFormat = "md" | "markdown" | "latex" | "tex" | "docx" | "pdf";

const EXT: Record<string, string> = {
  markdown: "md",
  md: "md",
  latex: "tex",
  tex: "tex",
  docx: "docx",
  pdf: "pdf",
};

export async function reportCommand(
  sessionId: string,
  options: { format?: string; output?: string; top?: string; regenerate?: boolean }
): Promise<void> {
  await runMigrations();
  const memory = getContextStore();
  const config = getConfig();

  const session = memory.resolveSession(sessionId);
  if (!session) {
    console.error(
      chalk.red(
        `Session not found: ${sessionId}\nRun \`co-scientist list\` to see available sessions (UUID or name accepted).`
      )
    );
    process.exit(1);
  }
  sessionId = session.id;

  const rawFormat = (options.format ?? "md").toLowerCase() as ReportFormat;
  const ext = EXT[rawFormat];
  if (!ext) {
    console.error(chalk.red(`Unknown format '${options.format}'. Use one of: md, latex, docx, pdf.`));
    process.exit(1);
  }

  // Reuse the cached manuscript unless --regenerate is set.
  let manuscript: Manuscript | null = options.regenerate ? null : memory.getManuscript(sessionId);
  if (!manuscript) {
    console.log(chalk.cyan(`⏳ Generating manuscript (this calls the LLM once)…`));
    const agent = new ReportAgent();
    const topN = options.top ? parseInt(options.top, 10) : config.report.topN;
    manuscript = await agent.generateManuscript(sessionId, { topN });
  } else {
    console.log(chalk.dim(`Using cached manuscript (pass --regenerate to rebuild).`));
  }

  const outputPath =
    options.output ??
    `co-scientist-report-${session.name.replace(/\s+/g, "-").toLowerCase()}-${sessionId.slice(0, 8)}.${ext}`;

  try {
    if (ext === "md") {
      writeFileSync(outputPath, toMarkdown(manuscript), "utf-8");
    } else if (ext === "tex") {
      writeFileSync(outputPath, toLatex(manuscript), "utf-8");
    } else {
      // docx / pdf via pandoc from the Markdown rendering
      convertWithPandoc(toMarkdown(manuscript), ext as "docx" | "pdf", outputPath);
    }
  } catch (err) {
    console.error(chalk.red(`✗ ${(err as Error).message}`));
    process.exit(1);
  }

  const kb = (statSync(outputPath).size / 1024).toFixed(1);
  console.log(
    chalk.green(
      `✓ Report written to: ${chalk.bold(outputPath)} (${kb} KB) — ${manuscript.references.length} references, ${manuscript.hypotheses.length} hypotheses`
    )
  );
}
