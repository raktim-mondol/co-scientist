import chalk from "chalk";
import inquirer from "inquirer";
import { getContextStore } from "../../memory/contextStore.js";

interface DeleteOptions {
  force?: boolean;
  all?: boolean;
}

export async function deleteCommand(
  sessionId: string | undefined,
  options: DeleteOptions
): Promise<void> {
  const memory = getContextStore();

  // ── Delete ALL sessions ──────────────────────────────────────────────────
  if (options.all) {
    const sessions = memory.listSessions();

    if (sessions.length === 0) {
      console.log(chalk.yellow("No sessions found. Nothing to delete."));
      return;
    }

    // Block if any session is actively running
    const running = sessions.filter((s) => s.status === "running");
    if (running.length > 0) {
      console.error(
        chalk.red(
          `Cannot delete all sessions: ${running.length} session(s) are currently running.\n` +
          `Stop or pause them before deleting.`
        )
      );
      running.forEach((s) =>
        console.error(chalk.red(`  • ${s.name} (${s.id})`))
      );
      process.exit(1);
    }

    if (!options.force) {
      console.log(chalk.bold.yellow(`\nThis will permanently delete ALL ${sessions.length} session(s):\n`));
      sessions.forEach((s) => {
        const statusColor =
          s.status === "completed" ? chalk.green :
          s.status === "paused" ? chalk.yellow : chalk.red;
        console.log(
          `  ${chalk.gray("•")} ${chalk.bold(s.name.padEnd(30))} ` +
          `${statusColor(s.status.padEnd(12))} ` +
          `${chalk.gray(s.id)}`
        );
      });

      const { confirmed } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirmed",
          message: chalk.red(`Delete all ${sessions.length} session(s)? This cannot be undone.`),
          default: false,
        },
      ]);

      if (!confirmed) {
        console.log(chalk.gray("Aborted. No sessions were deleted."));
        return;
      }
    }

    let deleted = 0;
    for (const s of sessions) {
      memory.deleteSession(s.id);
      deleted++;
    }

    console.log(chalk.green(`✓ Deleted ${deleted} session(s).`));
    return;
  }

  // ── Delete a single session ──────────────────────────────────────────────
  if (!sessionId) {
    console.error(chalk.red("Error: provide a session ID or use --all to delete all sessions."));
    console.error(chalk.gray("Usage: co-scientist delete <sessionId> [--force]"));
    console.error(chalk.gray("       co-scientist delete --all [--force]"));
    process.exit(1);
  }

  const session = memory.getSession(sessionId);

  // Edge case: session not found
  if (!session) {
    console.error(chalk.red(`Session not found: ${sessionId}`));
    console.error(chalk.gray("Run `co-scientist list` to see available sessions."));
    process.exit(1);
  }

  // Edge case: session is actively running
  if (session.status === "running") {
    console.error(
      chalk.red(
        `Session "${session.name}" is currently running.\n` +
        `Stop or pause it before deleting (Ctrl+C in the running session).`
      )
    );
    process.exit(1);
  }

  // Confirm unless --force
  if (!options.force) {
    const hypCount = session.stats.totalHypotheses ?? 0;
    const statusColor =
      session.status === "completed" ? chalk.green :
      session.status === "paused" ? chalk.yellow : chalk.red;

    console.log(chalk.bold.yellow("\nSession to delete:\n"));
    console.log(`  ${chalk.gray("Name:")}    ${chalk.bold(session.name)}`);
    console.log(`  ${chalk.gray("ID:")}      ${chalk.gray(session.id)}`);
    console.log(`  ${chalk.gray("Status:")}  ${statusColor(session.status)}`);
    console.log(`  ${chalk.gray("Created:")} ${session.createdAt.toLocaleString()}`);
    console.log(`  ${chalk.gray("Hyp:")}     ${hypCount}`);

    if (session.status === "completed" && hypCount > 0) {
      console.log(
        chalk.yellow(
          `\n  Warning: This session has ${hypCount} hypothesis/hypotheses.\n` +
          `  Export first? co-scientist export ${sessionId}`
        )
      );
    }

    console.log();

    const { confirmed } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmed",
        message: chalk.red("Permanently delete this session and all its data? This cannot be undone."),
        default: false,
      },
    ]);

    if (!confirmed) {
      console.log(chalk.gray("Aborted. Session was not deleted."));
      return;
    }
  }

  memory.deleteSession(sessionId);
  console.log(chalk.green(`✓ Session "${session.name}" (${sessionId}) deleted.`));
}
