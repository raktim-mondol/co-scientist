import chalk from "chalk";
import { getContextStore } from "../../memory/contextStore.js";
import { RankingAgent } from "../../agents/ranking.js";
import { runMigrations } from "../../db/migrate.js";

export async function compareCommand(
  sessionId: string,
  hypId1: string,
  hypId2: string
): Promise<void> {
  await runMigrations();
  const memory = getContextStore();

  const session = memory.resolveSession(sessionId);
  if (!session) {
    console.error(chalk.red(`Session not found: ${sessionId}\nRun \`co-scientist list\` to see available sessions (UUID or name accepted).`));
    process.exit(1);
  }
  sessionId = session.id;

  const hypA = memory.getHypothesis(hypId1);
  const hypB = memory.getHypothesis(hypId2);

  if (!hypA || hypA.sessionId !== sessionId) {
    console.error(chalk.red(`Hypothesis not found in this session: ${hypId1}`));
    process.exit(1);
  }
  if (!hypB || hypB.sessionId !== sessionId) {
    console.error(chalk.red(`Hypothesis not found in this session: ${hypId2}`));
    process.exit(1);
  }
  if (hypId1 === hypId2) {
    console.error(chalk.red("Cannot compare a hypothesis against itself."));
    process.exit(1);
  }

  console.log(chalk.bold.cyan("\n⚔  Head-to-Head Comparison\n"));
  console.log(chalk.gray("─".repeat(80)));
  console.log(
    `  ${chalk.bold.yellow("[A]")} ${chalk.white(hypA.title)}\n` +
    `      ${chalk.gray(`Elo: ${Math.round(hypA.eloRating)}  RD: ${Math.round(hypA.ratingDeviation ?? 350)}  |  ${hypA.id}`)}`
  );
  console.log(
    `  ${chalk.bold.yellow("[B]")} ${chalk.white(hypB.title)}\n` +
    `      ${chalk.gray(`Elo: ${Math.round(hypB.eloRating)}  RD: ${Math.round(hypB.ratingDeviation ?? 350)}  |  ${hypB.id}`)}`
  );
  console.log(chalk.gray("─".repeat(80)));
  console.log(chalk.cyan("\n⏳ Running match...\n"));

  const agent = new RankingAgent();
  const summary = await agent.runManualMatch(sessionId, hypA, hypB, session.stats.currentRound ?? 0);

  // Transcript (debate matches only)
  if (summary.transcript && summary.matchType === "debate") {
    console.log(chalk.bold("─── Debate Transcript " + "─".repeat(58)));
    console.log(chalk.gray(summary.transcript));
    console.log();
  }

  // Verdict
  const winnerLabel =
    summary.winner === "A" ? `[A] "${hypA.title}"` :
    summary.winner === "B" ? `[B] "${hypB.title}"` :
    "Draw";

  console.log(chalk.bold("─── Verdict " + "─".repeat(68)));
  console.log(`  🏆 ${summary.winner === "draw" ? chalk.yellow(winnerLabel) : chalk.bold.green(winnerLabel)}`);
  console.log(`  ${chalk.gray(summary.rationale)}\n`);

  // Rating update
  const fmtDelta = (before: number, after: number) => {
    const d = Math.round(after - before);
    return d >= 0 ? chalk.green(`+${d}`) : chalk.red(`${d}`);
  };
  console.log(chalk.bold("─── Rating Update " + "─".repeat(62)));
  console.log(
    `  [A] ${Math.round(summary.ratingA.before)} → ${Math.round(summary.ratingA.after)}` +
    `  (${fmtDelta(summary.ratingA.before, summary.ratingA.after)})` +
    `  RD: ${Math.round(summary.ratingA.rd)}`
  );
  console.log(
    `  [B] ${Math.round(summary.ratingB.before)} → ${Math.round(summary.ratingB.after)}` +
    `  (${fmtDelta(summary.ratingB.before, summary.ratingB.after)})` +
    `  RD: ${Math.round(summary.ratingB.rd)}`
  );
  console.log(chalk.gray("\n" + "─".repeat(80) + "\n"));
}
