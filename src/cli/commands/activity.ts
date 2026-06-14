import chalk from "chalk";
import { runMigrations } from "../../db/migrate.js";
import { getContextStore } from "../../memory/contextStore.js";

export async function activityCommand(sessionId: string): Promise<void> {
  await runMigrations();
  const memory = getContextStore();
  const session = memory.getSession(sessionId);

  if (!session) {
    console.error(chalk.red(`Session not found: ${sessionId}`));
    process.exit(1);
  }

  const entries = memory.getSessionActivity(sessionId);

  if (entries.length === 0) {
    console.log(chalk.yellow(`No activity log found for session: ${sessionId}`));
    console.log(chalk.gray("Activity is logged for sessions started after this feature was added."));
    return;
  }

  console.log(
    chalk.bold.cyan(`\n📋 Activity Log: ${session.name} (${sessionId})\n`)
  );
  console.log(chalk.gray(`${entries.length} entries\n`));

  const typeIcons: Record<string, string> = {
    llm_call: "🤖",
    search: "🔍",
    tool_call: "🔧",
    generation: "💡",
    reflection: "🪞",
    ranking: "⚔️",
    evolution: "🧬",
    meta_review: "📝",
    experiment_design: "🧪",
    proximity: "📐",
    knowledge_graph: "🕸️",
    session_lifecycle: "📌",
    report: "📄",
  };

  const typeColors: Record<string, (s: string) => string> = {
    llm_call: chalk.magenta,
    search: chalk.yellow,
    session_lifecycle: chalk.cyan,
    generation: chalk.green,
    reflection: chalk.blue,
    ranking: chalk.yellow,
    report: chalk.bold.white,
  };

  for (const e of entries) {
    const icon = typeIcons[e.type] ?? "•";
    const color = typeColors[e.type] ?? chalk.gray;
    const time = e.createdAt.toLocaleTimeString();
    const tokens =
      e.tokensIn || e.tokensOut
        ? chalk.gray(` [${(e.tokensIn ?? 0).toLocaleString()}+${(e.tokensOut ?? 0).toLocaleString()} tok]`)
        : "";

    console.log(
      `${icon} ${chalk.gray(time)} ${color(e.type.padEnd(18))} ` +
      `${chalk.white(e.agent.padEnd(14))} ` +
      `${e.message}${tokens}`
    );
  }

  console.log(chalk.gray(`\n${entries.length} entries\n`));
}
