import { writeFileSync, statSync } from "fs";
import chalk from "chalk";
import { getContextStore } from "../../memory/contextStore.js";
import { runMigrations } from "../../db/migrate.js";
import type { ExperimentProtocol } from "../../agents/experimentDesign.js";
import { formatCitationIntegrity } from "../../agents/citationIntegrity.js";

export async function exportCommand(
  sessionId: string,
  options: { format?: string; output?: string; all?: boolean }
): Promise<void> {
  await runMigrations();
  const memory = getContextStore();

  const session = memory.resolveSession(sessionId);
  if (!session) {
    console.error(chalk.red(`Session not found: ${sessionId}`));
    process.exit(1);
  }

  const format = options.format ?? "markdown";
  const outputPath =
    options.output ??
    `co-scientist-${session.name.replace(/\s+/g, "-").toLowerCase()}-${sessionId.slice(0, 8)}.${format === "json" ? "json" : "md"}`;

  const hypotheses = options.all
    ? memory.getAllActiveHypotheses(sessionId)
    : memory.getTopHypotheses(sessionId, 20);

  const researchGoal = memory.getResearchGoal(sessionId);

  console.log(chalk.cyan(`⏳ Exporting ${hypotheses.length} hypotheses as ${format}...`));

  let content: string;

  if (format === "json") {
    content = JSON.stringify(
      {
        session: {
          id: session.id,
          name: session.name,
          status: session.status,
          stats: session.stats,
          createdAt: session.createdAt,
          completedAt: session.completedAt,
        },
        researchGoal,
        metaReviewCritique: session.metaReviewCritique,
        researchOverview: session.researchOverview,
        hypotheses: hypotheses.map((h, i) => ({
          rank: i + 1,
          id: h.id,
          title: h.title,
          summary: h.summary,
          content: h.content,
          rationale: h.rationale,
          experimentalPlan: h.experimentalPlan ?? null,
          noveltyAssessment: h.noveltyAssessment ?? null,
          keyAssumptions: h.keyAssumptions,
          citations: h.citations,
          generationStrategy: h.generationStrategy,
          generationRound: h.generationRound,
          parentIds: h.parentIds,
          eloRating: Math.round(h.eloRating),
          ratingDeviation: Math.round(h.ratingDeviation ?? 350),
          wins: h.wins,
          losses: h.losses,
          matchesPlayed: h.matchesPlayed,
          experimentProtocol: memory.getExperimentProtocol(h.id),
          reviews: memory.getReviews(h.id).map((r) => ({
            type: r.type,
            verdict: r.verdict,
            noveltyScore: r.noveltyScore,
            correctnessScore: r.correctnessScore,
            testabilityScore: r.testabilityScore,
            summary: r.summary,
            critique: r.critique,
            supportingEvidence: r.supportingEvidence,
          })),
          citationIntegrity: memory.getCitationIntegrity(h.id),
          citationVerifications: memory.getCitationVerifications(h.id),
          safetyAssessment: memory.getLatestSafetyAssessment(h.id),
        })),
        quarantined: memory.getQuarantinedHypotheses(sessionId).map((h) => ({
          id: h.id,
          title: h.title,
          summary: h.summary,
          safetyAssessment: memory.getLatestSafetyAssessment(h.id),
        })),
      },
      null,
      2
    );
  } else {
    const lines: string[] = [];

    // Header
    lines.push(`# Co-Scientist Research Report: ${session.name}`);
    lines.push("");
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| Session ID | \`${session.id}\` |`);
    lines.push(`| Status | ${session.status} |`);
    lines.push(`| Created | ${session.createdAt.toISOString()} |`);
    if (session.completedAt) lines.push(`| Completed | ${session.completedAt.toISOString()} |`);
    lines.push(`| Hypotheses | ${session.stats.totalHypotheses ?? 0} total, ${session.stats.activeHypotheses ?? 0} active |`);
    lines.push(`| Tournament Matches | ${session.stats.totalMatches ?? 0} |`);
    lines.push(`| Rounds | ${session.stats.currentRound ?? 0} |`);
    lines.push(`| Top Rating | ${Math.round(session.stats.topEloRating ?? 1200)} |`);
    lines.push("");

    // Research Goal
    if (researchGoal) {
      lines.push(`## Research Goal`);
      lines.push("");
      lines.push(researchGoal.rawGoal);
      if (researchGoal.background) {
        lines.push("");
        lines.push(`**Background:** ${researchGoal.background}`);
      }
      if (researchGoal.constraints.domain) {
        lines.push(`**Domain:** ${researchGoal.constraints.domain}`);
      }
      lines.push("");
    }

    // Meta-review critique
    if (session.metaReviewCritique) {
      lines.push(`## Meta-Review Critique`);
      lines.push("");
      lines.push(session.metaReviewCritique);
      lines.push("");
    }

    // Research overview
    if (session.researchOverview) {
      lines.push(`## Research Overview`);
      lines.push("");
      lines.push(session.researchOverview);
      lines.push("");
    }

    // Hypotheses
    lines.push(`## Ranked Hypotheses`);
    lines.push("");

    for (let i = 0; i < hypotheses.length; i++) {
      const h = hypotheses[i];
      const rd = Math.round(h.ratingDeviation ?? 350);
      lines.push(`### #${i + 1} [Rating: ${Math.round(h.eloRating)} ±${rd}] ${h.title}`);
      lines.push("");
      lines.push(`*Strategy: ${h.generationStrategy} | Round: ${h.generationRound} | W:${h.wins} L:${h.losses} | ID: \`${h.id}\`*`);
      lines.push("");
      lines.push(`**Summary:** ${h.summary}`);
      lines.push("");
      lines.push(`**Full Hypothesis:**`);
      lines.push("");
      lines.push(h.content);
      lines.push("");
      lines.push(`**Rationale:**`);
      lines.push("");
      lines.push(h.rationale);
      lines.push("");

      if (h.keyAssumptions.length > 0) {
        lines.push(`**Key Assumptions:**`);
        lines.push("");
        h.keyAssumptions.forEach((a) => lines.push(`- ${a}`));
        lines.push("");
      }

      if (h.citations.length > 0) {
        const integ = memory.getCitationIntegrity(h.id);
        const integLine = formatCitationIntegrity(integ);
        lines.push(`**Citations:**${integLine ? ` _(${integLine})_` : ""}`);
        lines.push("");
        const statusByRaw = new Map(
          memory.getCitationVerifications(h.id).map((v) => [v.rawCitation.trim(), v.status])
        );
        h.citations.forEach((c) => {
          const st = statusByRaw.get(c.trim());
          const mark = st === "fabricated" ? " ⚠️ fabricated" : st === "unverified" ? " ⚠️ unverified" : "";
          lines.push(`- ${c}${mark}`);
        });
        lines.push("");
      }

      if (h.noveltyAssessment) {
        lines.push(`**Novelty Assessment:** ${h.noveltyAssessment}`);
        lines.push("");
      }

      if (h.experimentalPlan) {
        lines.push(`**Experimental Plan:**`);
        lines.push("");
        lines.push(h.experimentalPlan);
        lines.push("");
      }

      // Best review scores
      const reviews = memory.getReviews(h.id);
      const scoredReview = reviews.find(
        (r) => r.noveltyScore != null || r.correctnessScore != null
      );
      if (scoredReview) {
        const parts: string[] = [];
        if (scoredReview.noveltyScore != null) parts.push(`Novelty: ${scoredReview.noveltyScore}/10`);
        if (scoredReview.correctnessScore != null) parts.push(`Correctness: ${scoredReview.correctnessScore}/10`);
        if (scoredReview.testabilityScore != null) parts.push(`Testability: ${scoredReview.testabilityScore}/10`);
        lines.push(`**Review Scores:** ${parts.join(" | ")} *(${scoredReview.verdict})*`);
        lines.push("");
        if (scoredReview.summary) {
          lines.push(`**Review Summary:** ${scoredReview.summary}`);
          lines.push("");
        }
      }

      // Experiment protocol
      const protocol = memory.getExperimentProtocol(h.id) as ExperimentProtocol | null;
      if (protocol) {
        lines.push(`**Experimental Protocol:**`);
        lines.push("");
        lines.push(`> ${protocol.overview}`);
        lines.push("");
        if (protocol.steps?.length > 0) {
          protocol.steps.forEach((s: { step: number; action: string; details: string }) => {
            lines.push(`${s.step}. **${s.action}** — ${s.details}`);
          });
          lines.push("");
        }
        lines.push(`*Timeline: ${protocol.timelineWeeks} weeks | Cost: ${protocol.costTier}*`);
        lines.push("");
      }

      lines.push("---");
      lines.push("");
    }

    // Hypotheses withheld by the safety gate
    const quarantined = memory.getQuarantinedHypotheses(sessionId);
    if (quarantined.length > 0) {
      lines.push(`## Withheld by Safety Gate`);
      lines.push("");
      lines.push(
        `The following ${quarantined.length} hypothesis(es) were withheld from the tournament ` +
        `because their assessed dual-use / harm severity met the configured threshold.`
      );
      lines.push("");
      for (const h of quarantined) {
        const a = memory.getLatestSafetyAssessment(h.id);
        lines.push(`### [${(a?.severity ?? "unknown").toUpperCase()}] ${h.title}`);
        lines.push("");
        lines.push(`*Category: ${a?.category ?? "—"} | ID: \`${h.id}\`*`);
        lines.push("");
        if (a?.reasoning) {
          lines.push(`**Safety rationale:** ${a.reasoning}`);
          lines.push("");
        }
        lines.push(`**Summary:** ${h.summary}`);
        lines.push("");
        if (a?.overriddenBy) {
          lines.push(`> Released by ${a.overriddenBy}: ${a.overrideReason ?? ""}`);
          lines.push("");
        }
        lines.push("---");
        lines.push("");
      }
    }

    content = lines.join("\n");
  }

  writeFileSync(outputPath, content, "utf-8");
  const bytes = statSync(outputPath).size;
  const kb = (bytes / 1024).toFixed(1);
  console.log(chalk.green(`✓ Exported ${hypotheses.length} hypotheses to: ${chalk.bold(outputPath)} (${kb} KB)`));
}
