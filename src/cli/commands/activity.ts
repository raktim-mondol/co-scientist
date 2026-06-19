import chalk from "chalk";
import { writeFileSync } from "fs";
import { runMigrations } from "../../db/migrate.js";
import { getContextStore } from "../../memory/contextStore.js";

const TYPE_ICONS: Record<string, string> = {
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

const TYPE_COLORS: Record<string, (s: string) => string> = {
  llm_call: chalk.magenta,
  search: chalk.yellow,
  session_lifecycle: chalk.cyan,
  generation: chalk.green,
  reflection: chalk.blue,
  ranking: chalk.yellow,
  report: chalk.bold.white,
};

export async function activityCommand(
  sessionId: string,
  options: { export?: string } = {}
): Promise<void> {
  await runMigrations();
  const memory = getContextStore();
  const session = memory.resolveSession(sessionId);
  if (!session) {
    console.error(chalk.red(`Session not found: ${sessionId}\nRun \`co-scientist list\` to see available sessions (UUID or name accepted).`));
    process.exit(1);
  }
  sessionId = session.id;

  const entries = memory.getSessionActivity(sessionId);

  if (entries.length === 0) {
    console.log(chalk.yellow(`No activity log found for session: ${sessionId}`));
    console.log(chalk.gray("No activity recorded for this session."));
    return;
  }

  // ── Export path ──────────────────────────────────────────────────────────
  if (options.export) {
    const md = buildMarkdown(session.name, sessionId, entries);
    writeFileSync(options.export, md, "utf-8");
    console.log(chalk.green(`Activity log exported to: ${options.export}`));
    return;
  }

  // ── Terminal output ──────────────────────────────────────────────────────
  console.log(
    chalk.bold.cyan(`\n📋 Activity Log: ${session.name} (${sessionId})\n`)
  );
  console.log(chalk.gray(`${entries.length} entries\n`));

  for (const e of entries) {
    const icon = TYPE_ICONS[e.type] ?? "•";
    const color = TYPE_COLORS[e.type] ?? chalk.gray;
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

    // Show search results inline if available
    if (e.type === "search" && e.detailJson) {
      try {
        const detail = JSON.parse(e.detailJson);
        const results = detail.results as Array<{ title: string; url: string; source?: string; year?: number }> | undefined;
        if (results && results.length > 0) {
          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            console.log(
              chalk.gray(`     ${i + 1}. ${r.title}`) +
              chalk.dim(`  [${r.source ?? "web"}]`)
            );
            console.log(chalk.dim(`        ${r.url}`));
          }
        }
      } catch { /* ignore parse errors */ }
    }
  }

  console.log(chalk.gray(`\n${entries.length} entries`));
  console.log(chalk.cyan(`Export: co-scientist activity ${sessionId} --export <file.md>\n`));
}

// ── Markdown export ─────────────────────────────────────────────────────────
function buildMarkdown(
  sessionName: string,
  sessionId: string,
  entries: Array<{
    agent: string;
    type: string;
    message: string;
    detailJson: string | null;
    tokensIn: number | null;
    tokensOut: number | null;
    createdAt: Date;
  }>
): string {
  const lines: string[] = [];
  lines.push(`# Session Activity Log`);
  lines.push("");
  lines.push(`**Session:** ${sessionName}`);
  lines.push(`**ID:** \`${sessionId}\``);
  lines.push(`**Entries:** ${entries.length}`);
  lines.push(`**Exported:** ${new Date().toISOString()}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const e of entries) {
    const icon = TYPE_ICONS[e.type] ?? "•";
    const time = e.createdAt.toISOString();
    const tokens =
      e.tokensIn || e.tokensOut
        ? ` (${(e.tokensIn ?? 0).toLocaleString()}+${(e.tokensOut ?? 0).toLocaleString()} tokens)`
        : "";

    lines.push(`### ${icon} ${e.type} — ${e.agent}${tokens}`);
    lines.push("");
    lines.push(`> ${e.message}`);
    lines.push("");
    lines.push(`*${time}*`);
    lines.push("");

    // Expand detail for known types
    if (e.detailJson) {
      try {
        const detail = JSON.parse(e.detailJson);

        if (e.type === "search" && detail.results) {
          lines.push("**Search Results:**");
          lines.push("");
          for (let i = 0; i < detail.results.length; i++) {
            const r = detail.results[i];
            lines.push(`${i + 1}. **[${r.title}](${r.url})**${r.year ? ` (${r.year})` : ""}`);
            if (r.snippet) lines.push(`   > ${r.snippet}`);
          }
          lines.push("");
        }

        if (e.type === "llm_call") {
          if (detail.mode) lines.push(`- **Mode:** ${detail.mode}`);
          if (detail.reasoningLen) lines.push(`- **Thinking:** ${detail.reasoningLen.toLocaleString()} chars`);
          if (detail.jsonMode) lines.push(`- **JSON mode:** yes`);

          if (detail.reasoning) {
            lines.push("");
            lines.push("<details><summary>Reasoning (chain-of-thought)</summary>");
            lines.push("");
            lines.push("```");
            lines.push(detail.reasoning);
            lines.push("```");
            lines.push("");
            lines.push("</details>");
            lines.push("");
          }

          if (detail.system) {
            lines.push("");
            lines.push("<details><summary>System prompt</summary>");
            lines.push("");
            lines.push("```");
            lines.push(detail.system);
            lines.push("```");
            lines.push("");
            lines.push("</details>");
            lines.push("");
          }
          if (detail.userPrompt) {
            lines.push("");
            lines.push("<details><summary>User prompt</summary>");
            lines.push("");
            lines.push("```");
            lines.push(detail.userPrompt);
            lines.push("```");
            lines.push("");
            lines.push("</details>");
            lines.push("");
          }
          if (detail.response) {
            lines.push("");
            lines.push("<details><summary>Response</summary>");
            lines.push("");
            lines.push("```");
            lines.push(detail.response);
            lines.push("```");
            lines.push("");
            lines.push("</details>");
            lines.push("");
          }
        }

        if (e.type === "session_lifecycle" && detail.goal) {
          lines.push(`- **Goal:** ${detail.goal}`);
          if (detail.topHypotheses) {
            lines.push("- **Top Hypotheses:**");
            for (const h of detail.topHypotheses) {
              lines.push(`  - ${h.title} (Elo: ${h.elo})`);
            }
          }
          lines.push("");
        }
      } catch { /* ignore */ }
    }

    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}
