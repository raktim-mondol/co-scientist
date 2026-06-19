import chalk from "chalk";
import * as readline from "readline";
import { getContextStore } from "../../memory/contextStore.js";
import { ExperimentDesignAgent } from "../../agents/experimentDesign.js";
import { runMigrations } from "../../db/migrate.js";
import type { ExperimentProtocol } from "../../agents/experimentDesign.js";

export async function designCommand(
  sessionId: string,
  options: { hypothesisId?: string }
): Promise<void> {
  await runMigrations();
  const memory = getContextStore();

  const session = memory.resolveSession(sessionId);
  if (!session) {
    console.error(chalk.red(`Session not found: ${sessionId}\nRun \`co-scientist list\` to see available sessions (UUID or name accepted).`));
    process.exit(1);
  }
  sessionId = session.id;

  // Determine target hypothesis
  let hypothesisId = options.hypothesisId;

  if (!hypothesisId) {
    // Show top hypotheses and ask user to pick
    const topHyps = memory.getTopHypotheses(sessionId, 10);
    if (topHyps.length === 0) {
      console.error(chalk.red("No active hypotheses in this session."));
      process.exit(1);
    }

    console.log(chalk.bold.cyan("\n🔬 Select a hypothesis to design an experiment for:\n"));
    console.log(chalk.gray("─".repeat(80)));
    topHyps.forEach((h, i) => {
      console.log(
        `  ${chalk.bold.yellow(`[${i + 1}]`)} ${chalk.white(h.title)}\n` +
        `      ${chalk.gray(`Elo: ${Math.round(h.eloRating)}  |  ${h.id}`)}`
      );
    });
    console.log(chalk.gray("─".repeat(80)));

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question(chalk.cyan("\nEnter number (or hypothesis ID, or press Enter for top-1): "), resolve);
    });
    rl.close();

    const trimmed = answer.trim();
    if (!trimmed) {
      hypothesisId = topHyps[0].id;
    } else if (/^\d+$/.test(trimmed)) {
      const idx = parseInt(trimmed, 10) - 1;
      if (idx < 0 || idx >= topHyps.length) {
        console.error(chalk.red("Invalid selection."));
        process.exit(1);
      }
      hypothesisId = topHyps[idx].id;
    } else {
      hypothesisId = trimmed; // treat as raw ID
    }
  }

  // Check if protocol already exists
  const existing = memory.getExperimentProtocol(hypothesisId);
  if (existing) {
    console.log(chalk.yellow("\n⚠  A protocol already exists for this hypothesis."));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question(chalk.cyan("Regenerate? [y/N]: "), resolve);
    });
    rl.close();
    if (answer.trim().toLowerCase() !== "y") {
      printProtocol(existing as unknown as ExperimentProtocol);
      return;
    }
  }

  console.log(chalk.cyan("\n⏳ Generating experimental protocol...\n"));

  const agent = new ExperimentDesignAgent();
  const protocol = await agent.execute(sessionId, hypothesisId);

  if (!protocol) {
    console.error(chalk.red("Failed to generate protocol. Check logs for details."));
    process.exit(1);
  }

  printProtocol(protocol);
}

function printProtocol(p: ExperimentProtocol): void {
  const costColor =
    p.costTier === "low" ? chalk.green :
    p.costTier === "medium" ? chalk.yellow :
    p.costTier === "high" ? chalk.red : chalk.gray;

  console.log(chalk.bold.cyan("\n🧪 Experimental Protocol\n"));
  console.log(chalk.gray("═".repeat(80)));
  console.log(chalk.bold.white(`Hypothesis: ${p.hypothesisTitle}`));
  console.log(chalk.gray(`ID: ${p.hypothesisId}  |  Generated: ${p.generatedAt}`));
  console.log(chalk.gray("─".repeat(80)));

  console.log(chalk.bold("\n📋 Overview"));
  console.log(`  ${p.overview ?? "(not provided)"}\n`);

  console.log(chalk.bold("🔬 Experimental Steps"));
  const steps = Array.isArray(p.steps) ? p.steps : [];
  if (steps.length === 0) {
    console.log(chalk.gray("  (no steps returned)"));
  }
  for (const s of steps) {
    console.log(`  ${chalk.bold.yellow(`Step ${s.step}:`)} ${chalk.white(s.action)}`);
    console.log(`    ${chalk.gray(s.details)}`);
  }

  const reagents = Array.isArray(p.reagentsAndEquipment) ? p.reagentsAndEquipment : [];
  if (reagents.length > 0) {
    console.log(chalk.bold("\n🧫 Reagents & Equipment"));
    reagents.forEach((r) => console.log(`  • ${r}`));
  }

  const datasets = Array.isArray(p.datasets) ? p.datasets : [];
  if (datasets.length > 0) {
    console.log(chalk.bold("\n📊 Datasets / Data Sources"));
    datasets.forEach((d) => console.log(`  • ${d}`));
  }

  console.log(chalk.bold("\n✅ Expected Outcomes"));
  console.log(`  ${p.expectedOutcomes ?? "(not provided)"}`);

  console.log(chalk.bold("\n🎛  Controls"));
  console.log(`  ${p.controls ?? "(not provided)"}`);

  console.log(chalk.bold("\n📅 Timeline & Cost"));
  const weeks = p.timelineWeeks ?? "?";
  const tier = p.costTier ?? "unknown";
  console.log(
    `  ${chalk.white(`${weeks} weeks`)}  |  Cost tier: ${costColor(tier.toUpperCase())}`
  );

  console.log(chalk.gray("\n" + "═".repeat(80) + "\n"));
}
