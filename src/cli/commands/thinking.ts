import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { runMigrations } from "../../db/migrate.js";
import { getContextStore } from "../../memory/contextStore.js";

export async function thinkingCommand(
  sessionId: string,
  options: { export?: string } = {}
): Promise<void> {
  await runMigrations();
  const memory = getContextStore();
  const session = memory.resolveSession(sessionId);

  if (!session) {
    console.error(chalk.red(`Session not found: ${sessionId}`));
    process.exit(1);
  }

  // Collect traces from DB
  const traces = memory.getThinkingTraces(sessionId);

  // Also try log file as fallback
  const logPath = join(homedir(), ".co-scientist", `thinking-${sessionId}.log`);
  let fileContent = "";
  if (existsSync(logPath)) {
    fileContent = readFileSync(logPath, "utf-8").trim();
  }

  const hasDb = traces.length > 0;
  const hasFile = fileContent.length > 0;

  if (!hasDb && !hasFile) {
    console.log(chalk.yellow(`No thinking traces found for session: ${sessionId}`));
    console.log(chalk.gray("Reasoning-mode capture is not currently enabled, so no traces are recorded."));
    return;
  }

  // ── Export path ──────────────────────────────────────────────────────────
  if (options.export) {
    const md = buildMarkdown(session.name, sessionId, traces, fileContent);
    writeFileSync(options.export, md, "utf-8");
    console.log(chalk.green(`Thinking traces exported to: ${options.export}`));
    return;
  }

  // ── Terminal output ──────────────────────────────────────────────────────
  if (hasDb) {
    console.log(
      chalk.bold.cyan(`\n🧠 Thinking Traces: ${session.name} (${sessionId})\n`)
    );
    console.log(chalk.gray(`${traces.length} reasoning call(s)\n`));

    for (let i = 0; i < traces.length; i++) {
      const t = traces[i];
      console.log(
        chalk.yellow(`#${i + 1}  ${chalk.white(t.agent)}  ${chalk.gray(`${t.tokens.toLocaleString()} tokens  ${t.createdAt.toLocaleTimeString()}`)}`)
      );
      console.log(chalk.gray("─".repeat(80)));
      console.log(chalk.gray(t.reasoning));
      console.log(chalk.gray("─".repeat(80)) + "\n");
    }
  } else if (hasFile) {
    console.log(chalk.bold.cyan(`\n🧠 Thinking Trace (log file): ${sessionId}\n`));
    console.log(chalk.gray("─".repeat(80)));
    console.log(chalk.gray(fileContent));
    console.log(chalk.gray("─".repeat(80)) + "\n");
  }

  console.log(chalk.cyan(`Export: co-scientist thinking ${sessionId} --export <file.md>\n`));
}

// ── Markdown export ─────────────────────────────────────────────────────────
function buildMarkdown(
  sessionName: string,
  sessionId: string,
  traces: Array<{ id: string; agent: string; reasoning: string; tokens: number; createdAt: Date }>,
  fileContent: string
): string {
  const lines: string[] = [];
  lines.push(`# Thinking Traces`);
  lines.push("");
  lines.push(`**Session:** ${sessionName}`);
  lines.push(`**ID:** \`${sessionId}\``);
  lines.push(`**Traces:** ${traces.length} reasoning call(s)`);
  lines.push(`**Exported:** ${new Date().toISOString()}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  if (traces.length > 0) {
    for (let i = 0; i < traces.length; i++) {
      const t = traces[i];
      lines.push(`## #${i + 1} — ${t.agent}`);
      lines.push("");
      lines.push(`- **Tokens:** ${t.tokens.toLocaleString()}`);
      lines.push(`- **Time:** ${t.createdAt.toISOString()}`);
      lines.push("");
      lines.push("```");
      lines.push(t.reasoning);
      lines.push("```");
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  } else if (fileContent) {
    lines.push("## Log file (legacy)");
    lines.push("");
    lines.push("```");
    lines.push(fileContent);
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}
