import chalk from "chalk";
import { getContextStore } from "../../memory/contextStore.js";
import { runMigrations } from "../../db/migrate.js";
import type { Hypothesis } from "../../models/hypothesis.js";

export async function diffCommand(sessionId: string, hypothesisId: string): Promise<void> {
  await runMigrations();
  const memory = getContextStore();

  const session = memory.getSession(sessionId);
  if (!session) {
    console.error(chalk.red(`Session not found: ${sessionId}`));
    process.exit(1);
  }

  const target = memory.getHypothesis(hypothesisId);
  if (!target || target.sessionId !== sessionId) {
    console.error(chalk.red(`Hypothesis not found in this session: ${hypothesisId}`));
    process.exit(1);
  }

  // ── Build ancestry chain (walk first parentId at each level) ─────────────
  const chain: Hypothesis[] = [target];
  let current = target;
  const visited = new Set<string>([target.id]);

  while (current.parentIds.length > 0) {
    const parentId = current.parentIds[0];
    if (visited.has(parentId)) break; // cycle guard
    const parent = memory.getHypothesis(parentId);
    if (!parent) break;
    visited.add(parentId);
    chain.unshift(parent);
    current = parent;
  }

  // ── Header ────────────────────────────────────────────────────────────────
  console.log(chalk.bold.cyan(`\n🧬 Lineage for: "${target.title}"`));
  console.log(chalk.gray(`   ID: ${target.id}  |  Elo: ${Math.round(target.eloRating)} ±${Math.round(target.ratingDeviation ?? 350)}  |  Session: ${session.name}`));

  // ── Ancestry chain ────────────────────────────────────────────────────────
  console.log(chalk.bold(`\n${"─".repeat(80)}`));
  console.log(chalk.bold("  Ancestry Chain\n"));

  chain.forEach((h, i) => {
    const isTarget = h.id === target.id;
    const label = i === 0 ? chalk.gray("[root]") : chalk.gray(`[gen ${i}]`);
    const rd = Math.round(h.ratingDeviation ?? 350);
    const ratingColor = h.eloRating >= 1400 ? chalk.green : h.eloRating >= 1300 ? chalk.yellow : chalk.white;

    console.log(
      `  ${label}  ${ratingColor(`Elo: ${Math.round(h.eloRating)} ±${rd}`)}  ` +
      `${isTarget ? chalk.bold.white(h.title) : chalk.white(h.title)}` +
      (isTarget ? chalk.cyan("  ← target") : "")
    );
    console.log(chalk.gray(`         strategy: ${h.generationStrategy}  |  round ${h.generationRound}`));

    if (i < chain.length - 1) {
      const child = chain[i + 1];
      const via = child.generationStrategy.replace("evolution:", "");
      console.log(chalk.gray(`      └─ evolved via ${via} (round ${child.generationRound})`));
    }
  });

  if (chain.length === 1) {
    console.log(chalk.yellow("\n  This hypothesis has no recorded parents (root hypothesis)."));
    console.log(chalk.gray("─".repeat(80) + "\n"));
    return;
  }

  // ── Diff vs immediate parent ──────────────────────────────────────────────
  const parent = chain[chain.length - 2];

  console.log(chalk.bold(`\n${"─".repeat(80)}`));
  console.log(chalk.bold(`  Diff vs Parent: "${parent.title}"\n`));

  diffField("title", parent.title, target.title, "line");
  diffField("summary", parent.summary, target.summary, "sentence");
  diffField("rationale", parent.rationale, target.rationale, "sentence");
  diffField("content", parent.content, target.content, "line");
  diffArrayField("keyAssumptions", parent.keyAssumptions, target.keyAssumptions);
  diffArrayField("citations", parent.citations, target.citations);

  console.log(chalk.gray("─".repeat(80) + "\n"));
}

// ── Diff helpers ──────────────────────────────────────────────────────────────

function diffField(
  name: string,
  before: string,
  after: string,
  mode: "line" | "sentence"
): void {
  if (before === after) return;

  const split = (s: string) =>
    mode === "sentence"
      ? s.split(/(?<=\.)\s+/).filter(Boolean)
      : s.split("\n").filter(Boolean);

  const aLines = split(before);
  const bLines = split(after);

  // Simple LCS-based diff
  const removed = aLines.filter((l) => !bLines.includes(l));
  const added   = bLines.filter((l) => !aLines.includes(l));

  if (removed.length === 0 && added.length === 0) return;

  const cap = 15; // max lines shown per side
  console.log(chalk.bold.white(`  Field: ${name}`) +
    chalk.gray(` (+${added.length} added, -${removed.length} removed)`));

  removed.slice(0, cap).forEach((l) =>
    console.log(chalk.red(`  - ${l.slice(0, 120)}`))
  );
  if (removed.length > cap) console.log(chalk.gray(`    ... and ${removed.length - cap} more removed`));

  added.slice(0, cap).forEach((l) =>
    console.log(chalk.green(`  + ${l.slice(0, 120)}`))
  );
  if (added.length > cap) console.log(chalk.gray(`    ... and ${added.length - cap} more added`));

  console.log();
}

function diffArrayField(name: string, before: string[], after: string[]): void {
  const beforeSet = new Set(before);
  const afterSet  = new Set(after);
  const removed = before.filter((x) => !afterSet.has(x));
  const added   = after.filter((x) => !beforeSet.has(x));
  if (removed.length === 0 && added.length === 0) return;

  console.log(chalk.bold.white(`  Field: ${name}`) +
    chalk.gray(` (+${added.length} added, -${removed.length} removed)`));
  removed.forEach((x) => console.log(chalk.red(`  - ${x.slice(0, 120)}`)));
  added.forEach((x)   => console.log(chalk.green(`  + ${x.slice(0, 120)}`)));
  console.log();
}
