import chalk from "chalk";
import { getContextStore } from "../../memory/contextStore.js";
import { runMigrations } from "../../db/migrate.js";

export async function listCommand(): Promise<void> {
  await runMigrations();
  const memory = getContextStore();
  const sessions = memory.listSessions();

  if (sessions.length === 0) {
    console.log(chalk.yellow("No sessions found. Run: co-scientist run"));
    return;
  }

  console.log(chalk.bold.cyan("\n📋 Research Sessions\n"));
  console.log(
    chalk.gray("─".repeat(80))
  );

  for (const session of sessions) {
    const statusColor =
      session.status === "completed" ? chalk.green :
      session.status === "running" ? chalk.cyan :
      session.status === "paused" ? chalk.yellow :
      chalk.red;

    const elapsed = session.completedAt
      ? Math.round((session.completedAt.getTime() - session.createdAt.getTime()) / 1000)
      : null;

    console.log(
      `${chalk.bold(session.name.padEnd(30))} ` +
      `${statusColor(session.status.padEnd(12))} ` +
      `${chalk.gray(session.id)}`
    );
    console.log(
      `  ${chalk.gray("Created:")} ${session.createdAt.toLocaleString().padEnd(25)} ` +
      `${chalk.yellow("Hyp:")} ${session.stats.totalHypotheses || 0} ` +
      `${chalk.blue("TopRating:")} ${Math.round(session.stats.topEloRating || 1200)} ` +
      `${elapsed ? chalk.gray(`(${elapsed}s)`) : ""}`
    );
    console.log(chalk.gray("─".repeat(80)));
  }

  console.log(
    `\n${chalk.gray(`${sessions.length} session(s) total`)}\n`
  );
}

// ─── Results command ──────────────────────────────────────────────────────────
export async function resultsCommand(
  sessionId: string,
  options: { top?: string; all?: boolean; showFeedback?: boolean }
): Promise<void> {
  await runMigrations();
  const memory = getContextStore();
  const session = memory.getSession(sessionId);

  if (!session) {
    console.error(chalk.red(`Session not found: ${sessionId}`));
    process.exit(1);
  }

  const n = parseInt(options.top ?? "10", 10);
  const hypotheses = options.all
    ? memory.getAllActiveHypotheses(sessionId)
    : memory.getTopHypotheses(sessionId, n);

  // Fetch all dimension scores in one query
  const scores = memory.getAvgScoresForSession(sessionId);

  console.log(chalk.bold.cyan(`\n🏆 Results for: ${session.name}\n`));
  console.log(chalk.gray(`Status: ${session.status} | Hypotheses: ${session.stats.totalHypotheses}`));
  console.log(chalk.gray("─".repeat(80)));

  if (hypotheses.length === 0) {
    console.log(chalk.yellow("No active hypotheses yet. Session may still be running."));
    return;
  }

  hypotheses.forEach((h, i) => {
    const rank = i + 1;
    const rd   = h.ratingDeviation ?? 350;

    // Color-code the rating based on value
    const ratingColor =
      h.eloRating >= 1400 ? chalk.green :
      h.eloRating >= 1300 ? chalk.yellow :
      chalk.white;

    // Color-code and label RD (uncertainty)
    const rdLabel =
      rd > 200  ? chalk.gray(`±${Math.round(rd)} provisional`) :
      rd > 100  ? chalk.yellow(`±${Math.round(rd)} uncertain`) :
                  chalk.green(`±${Math.round(rd)} established`);

    console.log(
      `\n${chalk.bold.cyan(`#${rank}`)} ` +
      `${ratingColor(`[Rating: ${Math.round(h.eloRating)}]`)} ` +
      `${rdLabel} ` +
      `${memory.hasProvenanceFlag(h.id) ? chalk.red("⚠ provenance") + " " : ""}` +
      `${chalk.bold.white(h.title)}`
    );
    console.log(chalk.gray(`   ID: ${h.id}`));
    console.log(chalk.gray(`   Strategy: ${h.generationStrategy} | W:${h.wins} L:${h.losses} | Round: ${h.generationRound}`));
    console.log(chalk.white(`   ${h.summary}`));

    if (h.keyAssumptions.length > 0) {
      console.log(chalk.gray(`   Assumptions: ${h.keyAssumptions.slice(0, 2).join("; ")}`));
    }

    // Dimension scores
    const s = scores[h.id];
    if (s) {
      const fmt = (label: string, val: number | null, color: (s: string) => string) => {
        if (val === null || val === undefined) return chalk.gray(`${label}: n/a`);
        const bar = "▓".repeat(Math.round(val)).padEnd(10, "░");
        return color(`${label}: ${val.toFixed(1)} ${bar}`);
      };
      console.log(
        `   ` +
        fmt("N", s.novelty, chalk.magenta) + "  " +
        fmt("C", s.correctness, chalk.blue) + "  " +
        fmt("T", s.testability, chalk.cyan) +
        (s.novelty !== null && s.correctness !== null && s.testability !== null
          ? chalk.gray(`  avg: ${(((s.novelty ?? 0) + (s.correctness ?? 0) + (s.testability ?? 0)) / 3).toFixed(1)}`)
          : "")
      );
    }

    // Provenance claim detail (only flagged claims)
    const claims = memory.getClaimCitations(h.id);
    if (claims.length > 0) {
      const flagged = claims.filter(c => c.support !== "supports");
      const supported = claims.length - flagged.length;
      console.log(chalk.gray(`   Citations: ${supported}/${claims.length} claims anchored`) +
        (flagged.length > 0 ? chalk.red(` | ${flagged.length} unverified`) : chalk.green(" ✓")));
      for (const c of flagged.slice(0, 2)) {
        const icon = c.support === "contradicts" ? chalk.red("✗") : chalk.yellow("?");
        console.log(`     ${icon} ${chalk.gray(c.claimText.slice(0, 80))}${c.claimText.length > 80 ? "…" : ""}`);
        if (c.paperTitle) console.log(`       ${chalk.gray("→")} ${chalk.dim(c.paperTitle.slice(0, 70))}`);
      }
    }

    // RLEF: feedback summary
    const feedbacks = memory.getExperimentalFeedback(h.id);
    if (feedbacks.length > 0) {
      const avgReward = feedbacks.reduce((s, f) => s + f.computedReward, 0) / feedbacks.length;
      const rewardColor = avgReward > 0.3 ? chalk.green : avgReward < -0.3 ? chalk.red : chalk.yellow;
      const latest = feedbacks[0]; // ordered newest-first
      console.log(
        chalk.magenta(`   🧪 Feedback: `) +
        chalk.white(`${feedbacks.length} entr${feedbacks.length === 1 ? "y" : "ies"}`) +
        `  avg reward: ${rewardColor(avgReward >= 0 ? `+${avgReward.toFixed(2)}` : avgReward.toFixed(2))}` +
        chalk.gray(`  latest: "${latest.feedbackText.slice(0, 60)}${latest.feedbackText.length > 60 ? "…" : ""}"`)
      );
      if (options.showFeedback) {
        for (const f of feedbacks) {
          const sign = f.computedReward >= 0 ? chalk.green(`+${f.computedReward.toFixed(3)}`) : chalk.red(f.computedReward.toFixed(3));
          console.log(`     ${sign}  ${chalk.white(f.feedbackText.slice(0, 100))}${f.feedbackText.length > 100 ? "…" : ""}`);
          if (f.noveltyScore !== undefined || f.correctnessScore !== undefined || f.testabilityScore !== undefined) {
            console.log(chalk.gray(`           N:${f.noveltyScore ?? "—"}  C:${f.correctnessScore ?? "—"}  T:${f.testabilityScore ?? "—"}  by:${f.recordedBy}  ${f.createdAt.toLocaleDateString()}`));
          }
        }
      }
    }

    console.log(chalk.gray("─".repeat(80)));
  });

  console.log(`\n${chalk.gray(`Showing ${hypotheses.length} hypotheses`)}`);

  // Per-agent token breakdown
  const tokensByAgent = session.stats.tokensByAgent ?? {};
  const agentEntries = Object.entries(tokensByAgent).sort((a, b) => b[1] - a[1]);
  if (agentEntries.length > 0) {
    const totalTracked = agentEntries.reduce((s, [, v]) => s + v, 0);
    console.log(chalk.bold.cyan("\n📊 Token Usage by Agent\n"));
    for (const [agent, tokens] of agentEntries) {
      const pct = totalTracked > 0 ? Math.round((tokens / totalTracked) * 100) : 0;
      const bar = "█".repeat(Math.round(pct / 5)).padEnd(20);
      console.log(
        `  ${chalk.white(agent.padEnd(18))} ${chalk.yellow(tokens.toLocaleString().padStart(8))} tokens  ` +
        `${chalk.gray(bar)} ${chalk.gray(`${pct}%`)}`
      );
    }
    console.log(chalk.gray(`  ${"Total".padEnd(18)} ${totalTracked.toLocaleString().padStart(8)} tokens`));
  }

  console.log(chalk.cyan(`\nFull overview: co-scientist overview ${sessionId}`));
}

// ─── Overview command ─────────────────────────────────────────────────────────
export async function overviewCommand(sessionId: string): Promise<void> {
  await runMigrations();
  const memory = getContextStore();
  const session = memory.getSession(sessionId);

  if (!session) {
    console.error(chalk.red(`Session not found: ${sessionId}`));
    process.exit(1);
  }

  if (!session.researchOverview) {
    if (session.status === "running") {
      console.log(chalk.yellow("Session is still running. Overview will be available when completed."));
    } else {
      console.log(chalk.yellow("No research overview available yet."));
    }
    return;
  }

  console.log(chalk.bold.cyan(`\n📄 Research Overview: ${session.name}\n`));
  console.log(chalk.gray("─".repeat(80)));
  const cleaned = session.researchOverview.trim().replace(/\n{3,}/g, "\n\n");
  console.log(cleaned);
  console.log(chalk.gray("\n" + "─".repeat(80)));
  console.log(chalk.cyan(`\nExport: co-scientist export ${sessionId}`));
}

// ─── Resume command ───────────────────────────────────────────────────────────
export async function resumeCommand(sessionId: string): Promise<void> {
  await runMigrations();
  const memory = getContextStore();
  const session = memory.getSession(sessionId);

  if (!session) {
    console.error(chalk.red(`Session not found: ${sessionId}`));
    process.exit(1);
  }

  if (session.status === "completed") {
    console.log(chalk.yellow(`Session ${sessionId} is already completed.`));
    console.log(chalk.cyan(`View results: co-scientist results ${sessionId}`));
    return;
  }

  console.log(chalk.green(`Resuming session: ${session.name} (${sessionId})`));
  memory.updateSessionStatus(sessionId, "running");
  console.log(chalk.yellow("Note: Re-running supervisor on existing session state..."));

  const { EventEmitter } = await import("events");
  const { SupervisorAgent } = await import("../../agents/supervisor.js");
  const { getMCPManager } = await import("../../tools/mcpClient.js");
  const { getConfig } = await import("../../config.js");

  // Initialize MCP tools (Consensus academic search)
  try {
    await getMCPManager().initialize();
  } catch {
    console.warn(chalk.yellow("Consensus MCP connection degraded — academic search may be limited"));
  }

  const supervisor = new SupervisorAgent();
  const emitter = new EventEmitter();
  supervisor.setEmitter(emitter);

  const startTime = Date.now();

  emitter.on("progress", (stats: Record<string, unknown> & { activity: string }) => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const budget = getConfig().compute.budgetTokens;
    const tokensUsed = (stats.tokensUsed as number) ?? 0;
    const budgetPct = budget > 0 && tokensUsed > 0 ? Math.round((tokensUsed / budget) * 100) : 0;
    process.stdout.write(
      `\r${chalk.cyan("⚡")} ${chalk.gray(stats.activity.padEnd(50))} ` +
      `${chalk.yellow(`Hyp:${stats.totalHypotheses}`)} ` +
      `${chalk.gray(`Tok:${tokensUsed}`)}${budget > 0 ? chalk.gray(`(${budgetPct}%)`) : ""} ` +
      `${chalk.gray(`${mins}m ${secs}s`)}   `
    );
  });

  emitter.on("completed", (overview: string) => {
    console.log(chalk.bold.green("\n✅ Session completed!\n"));
    if (overview) {
      console.log(chalk.cyan("📄 Research Overview Preview:"));
      console.log(overview.slice(0, 500) + (overview.length > 500 ? "\n..." : ""));
    }
  });

  emitter.on("error", (err: Error) => {
    console.error(chalk.red(`\n❌ Error: ${err.message}`));
  });

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log(chalk.yellow("\n\n⏸  Pausing session... (data saved to SQLite)"));
    supervisor.stop();
    memory.updateSessionStatus(sessionId, "paused");
    console.log(chalk.cyan(`Resume later with: co-scientist resume ${sessionId}`));
    process.exit(0);
  });

  try {
    await supervisor.run(sessionId);
  } catch (err) {
    console.error(chalk.red(`\n❌ Session error: ${(err as Error).message}`));
    memory.updateSessionStatus(sessionId, "error");
    process.exit(1);
  }

  const topHyps = memory.getTopHypotheses(sessionId, 5);
  console.log(chalk.bold.cyan(`\n🏆 TOP ${topHyps.length} HYPOTHESES:\n`));
  topHyps.forEach((h, i) => {
    console.log(
      chalk.yellow(`${i + 1}. [Rating: ${Math.round(h.eloRating)}] `) +
      chalk.white.bold(h.title)
    );
    console.log(chalk.gray(`   ${h.summary}\n`));
  });

  console.log(chalk.cyan(`\n📊 Full results: `) + chalk.white(`co-scientist results ${sessionId}`));
  console.log(chalk.cyan(`💾 Export: `) + chalk.white(`co-scientist export ${sessionId}`));

  await getMCPManager().cleanup();
}

// ─── Feedback command ─────────────────────────────────────────────────────────
export async function feedbackCommand(
  sessionId: string,
  options: { hypothesis?: boolean; review?: string; experimental?: boolean }
): Promise<void> {
  await runMigrations();
  const { default: inquirer } = await import("inquirer");
  const memory = getContextStore();
  const session = memory.getSession(sessionId);

  if (!session) {
    console.error(chalk.red(`Session not found: ${sessionId}`));
    process.exit(1);
  }

  // ── Experimental feedback (RLEF) ──────────────────────────────────────────
  if (options.experimental) {
    const { extractRewardFromFeedback, applyRewardToElo } = await import("../../rlef/reward-signal.js");
    const { getSqlite } = await import("../../db/index.js");
    const { v4: uuidv4 } = await import("uuid");

    const answers = await inquirer.prompt([
      { type: "input",  name: "hypothesisId", message: "Hypothesis ID:" },
      { type: "input",  name: "feedbackText",  message: "Empirical feedback:" },
      { type: "number", name: "noveltyScore",      message: "Novelty score (0-10, blank=skip):", default: undefined },
      { type: "number", name: "correctnessScore",  message: "Correctness score (0-10, blank=skip):", default: undefined },
      { type: "number", name: "testabilityScore",  message: "Testability score (0-10, blank=skip):", default: undefined },
      { type: "input",  name: "summary", message: "Summary (optional, blank=skip):", default: "" },
    ]);

    const hypId = (answers.hypothesisId as string).trim();
    const hyp = memory.getHypothesis(hypId);
    if (!hyp) {
      console.error(chalk.red(`Hypothesis not found: ${hypId}`));
      return;
    }

    const novelty      = isFinite(answers.noveltyScore as number)      ? (answers.noveltyScore as number)      : undefined;
    const correctness  = isFinite(answers.correctnessScore as number)  ? (answers.correctnessScore as number)  : undefined;
    const testability  = isFinite(answers.testabilityScore as number)  ? (answers.testabilityScore as number)  : undefined;

    const computedReward = extractRewardFromFeedback(
      answers.feedbackText as string,
      novelty,
      correctness,
      testability,
    );

    const summary = (answers.summary as string).trim();
    const metadata: Record<string, unknown> = summary ? { summary } : {};

    // Persist to experimental_feedback
    getSqlite().query(`
      INSERT INTO experimental_feedback
        (id, hypothesis_id, session_id, feedback_text,
         novelty_score, correctness_score, testability_score,
         metadata_json, computed_reward, recorded_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'human', ?)
    `).run(
      uuidv4(),
      hypId,
      sessionId,
      answers.feedbackText as string,
      novelty  ?? null,
      correctness ?? null,
      testability ?? null,
      JSON.stringify(metadata),
      computedReward,
      Date.now(),
    );

    // Update hypothesis Elo (K=48 for empirical feedback)
    const newElo = applyRewardToElo(hyp.eloRating, computedReward);
    memory.updateHypothesisRating(
      hypId,
      newElo,
      hyp.ratingDeviation ?? 350,
      hyp.volatility ?? 0.06,
      hyp.wins,
      hyp.losses,
      hyp.matchesPlayed,
    );

    const rewardSign = computedReward >= 0 ? chalk.green(`+${computedReward.toFixed(3)}`) : chalk.red(computedReward.toFixed(3));
    const eloChange  = newElo - hyp.eloRating;
    const eloSign    = eloChange >= 0 ? chalk.green(`+${eloChange.toFixed(1)}`) : chalk.red(eloChange.toFixed(1));

    console.log(chalk.bold.cyan("\n✓ Experimental feedback recorded\n"));
    console.log(`  Hypothesis : ${chalk.white(hyp.title)}`);
    console.log(`  Reward     : ${rewardSign}`);
    console.log(`  Elo        : ${Math.round(hyp.eloRating)} → ${chalk.bold(Math.round(newElo))} (${eloSign})`);
    console.log();
    return;
  }

  if (options.hypothesis) {
    // Submit a new expert hypothesis
    const answers = await inquirer.prompt([
      { type: "input", name: "title", message: "Hypothesis title:" },
      { type: "input", name: "content", message: "Hypothesis content:" },
      { type: "input", name: "rationale", message: "Scientific rationale:" },
    ]);

    memory.saveHypothesis({
      sessionId,
      title: answers.title as string,
      summary: (answers.content as string).slice(0, 200),
      content: answers.content as string,
      rationale: answers.rationale as string,
      experimentalPlan: undefined,
      noveltyAssessment: undefined,
      keyAssumptions: [],
      citations: [],
      generationStrategy: "expert_submission",
      eloRating: 1200,
      ratingDeviation: 350,
      volatility: 0.06,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      status: "active", // Expert hypotheses skip review
      parentIds: [],
      generationRound: 0,
    });

    console.log(chalk.green("✓ Expert hypothesis submitted and entered into tournament"));
  }

  if (options.review) {
    const hyp = memory.getHypothesis(options.review);
    if (!hyp) {
      console.error(chalk.red(`Hypothesis not found: ${options.review}`));
      return;
    }

    const answers = await inquirer.prompt([
      {
        type: "list",
        name: "verdict",
        message: "Your verdict:",
        choices: ["pass", "fail", "uncertain"],
      },
      { type: "number", name: "noveltyScore", message: "Novelty (0-10):" },
      { type: "number", name: "correctnessScore", message: "Correctness (0-10):" },
      { type: "input", name: "critique", message: "Detailed critique:" },
    ]);

    const critique = answers.critique as string;

    memory.saveReview({
      hypothesisId: options.review,
      sessionId,
      type: "expert",
      verdict: answers.verdict as "pass" | "fail" | "uncertain",
      noveltyScore: answers.noveltyScore as number,
      correctnessScore: answers.correctnessScore as number,
      testabilityScore: undefined,
      safetyFlag: false,
      summary: critique.split(/[.!?]+/)[0].trim().slice(0, 200) || critique.slice(0, 200),
      critique,
      supportingEvidence: [],
    });

    console.log(chalk.green("✓ Expert review submitted"));
  }
}


