import chalk from "chalk";
import { getContextStore } from "../../memory/contextStore.js";
import { runMigrations } from "../../db/migrate.js";

function severityColor(sev: string): (s: string) => string {
  switch (sev) {
    case "high":     return chalk.red.bold;
    case "moderate": return chalk.red;
    case "low":      return chalk.yellow;
    default:         return chalk.gray;
  }
}

/**
 * Inspect and manage hypotheses withheld by the safety gate.
 *
 *   co-scientist safety <sessionId>
 *   co-scientist safety <sessionId> --release <hypothesisId> --reason "..."
 */
export async function safetyCommand(
  sessionId: string,
  options: { release?: string; reason?: string; by?: string }
): Promise<void> {
  await runMigrations();
  const memory = getContextStore();

  const session = memory.resolveSession(sessionId);
  if (!session) {
    console.error(chalk.red(`Session not found: ${sessionId}\nRun \`co-scientist list\` to see available sessions (UUID or name accepted).`));
    process.exit(1);
  }
  sessionId = session.id;

  // ── Release (override) mode ────────────────────────────────────────────────
  if (options.release) {
    const reason = options.reason?.trim();
    if (!reason) {
      console.error(chalk.red("A justification is required to release a quarantined hypothesis."));
      console.error(chalk.gray(`Usage: co-scientist safety ${sessionId} --release ${options.release} --reason "..."`));
      process.exit(1);
    }
    const hyp = memory.getHypothesis(options.release);
    if (!hyp || hyp.sessionId !== sessionId) {
      console.error(chalk.red(`Hypothesis not found in this session: ${options.release}`));
      process.exit(1);
    }
    const released = memory.releaseQuarantine(options.release, options.by?.trim() || "operator", reason);
    if (!released) {
      console.error(chalk.yellow(`Hypothesis ${options.release} is not quarantined (status: ${hyp.status}).`));
      process.exit(1);
    }
    console.log(chalk.green(`✓ Released "${hyp.title}" into the active pool.`));
    console.log(chalk.gray(`  It will compete in future tournament rounds if the session is resumed.`));
    return;
  }

  // ── List mode ──────────────────────────────────────────────────────────────
  const quarantined = memory.getQuarantinedHypotheses(sessionId);

  console.log(chalk.bold.red(`\n🛡  Safety Gate — ${session.name}\n`));

  if (quarantined.length === 0) {
    console.log(chalk.green("No hypotheses are currently quarantined."));
    return;
  }

  console.log(chalk.gray(`${quarantined.length} hypothesis(es) withheld for safety review:\n`));
  console.log(chalk.gray("─".repeat(80)));

  for (const h of quarantined) {
    const a = memory.getLatestSafetyAssessment(h.id);
    const sev = a?.severity ?? "unknown";
    const color = severityColor(sev);
    console.log(`\n${color(`[${sev.toUpperCase()}]`)} ${chalk.bold.white(h.title)}`);
    console.log(chalk.gray(`   ID: ${h.id}`));
    if (a) {
      console.log(chalk.gray(`   Category: ${a.category}  (threshold: ${a.threshold})`));
      console.log(chalk.white(`   ${a.reasoning}`));
    }
    console.log(chalk.white(`   ${h.summary}`));
    console.log(chalk.cyan(`   Release: co-scientist safety ${sessionId} --release ${h.id} --reason "<justification>"`));
    console.log(chalk.gray("─".repeat(80)));
  }

  console.log(
    chalk.yellow(
      `\nReleasing a hypothesis overrides the safety gate. Review each one carefully before doing so.`
    )
  );
}
