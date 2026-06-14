import chalk from "chalk";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { runMigrations } from "../../db/migrate.js";
import { getContextStore } from "../../memory/contextStore.js";

export async function thinkingCommand(sessionId: string): Promise<void> {
  await runMigrations();
  const memory = getContextStore();
  const session = memory.getSession(sessionId);

  if (!session) {
    console.error(chalk.red(`Session not found: ${sessionId}`));
    process.exit(1);
  }

  // Try DB first
  const traces = memory.getThinkingTraces(sessionId);

  if (traces.length > 0) {
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
    return;
  }

  // Fall back to log file (legacy)
  const logPath = join(homedir(), ".co-scientist", `thinking-${sessionId}.log`);

  if (!existsSync(logPath)) {
    console.log(chalk.yellow(`No thinking traces found for session: ${sessionId}`));
    console.log(chalk.gray("Thinking traces are saved when DEEPSEEK_THINKING=true."));
    console.log(chalk.gray("They persist in the DB and (optionally) as log files."));
    return;
  }

  const content = readFileSync(logPath, "utf-8");
  if (!content.trim()) {
    console.log(chalk.yellow(`Thinking log is empty for session: ${sessionId}`));
    return;
  }

  console.log(chalk.bold.cyan(`\n🧠 Thinking Trace (log file): ${sessionId}\n`));
  console.log(chalk.gray("─".repeat(80)));
  console.log(chalk.gray(content.trim()));
  console.log(chalk.gray("─".repeat(80)) + "\n");
}
