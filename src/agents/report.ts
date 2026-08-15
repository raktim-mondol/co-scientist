import { z } from "zod";
import { BaseAgent } from "./base.js";
import { buildBibliography, markersFor, type ResolverFn } from "./reportBibliography.js";
import type {
  Manuscript,
  ManuscriptHypothesis,
  ManuscriptProtocol,
} from "../models/manuscript.js";
import type { ExperimentProtocol } from "./experimentDesign.js";

const NarrativeSchema = z.object({
  abstract: z.string(),
  background: z.string(),
  discussion: z.string(),
  limitations: z.string(),
});
type Narrative = z.infer<typeof NarrativeSchema>;

const PIPELINE_AGENTS = [
  "Generation",
  "Reflection",
  "Ranking (Glicko-2)",
  "Evolution",
  "Proximity",
  "MetaReview",
];

export class ReportAgent extends BaseAgent {
  get agentName() {
    return "Report";
  }

  /**
   * Build a publication-style manuscript from a completed session and persist it.
   * Narrative sections are LLM-synthesized; methods, results and references are
   * assembled deterministically from the DB.
   *
   * @param resolver injectable CrossRef resolver (defaults to the shared one) — for tests.
   */
  async generateManuscript(
    sessionId: string,
    opts: { topN?: number; resolver?: ResolverFn } = {},
  ): Promise<Manuscript> {
    const session = this.memory.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const topN = opts.topN ?? 15;
    const hyps = this.memory.getTopHypotheses(sessionId, topN);
    if (hyps.length === 0) {
      throw new Error("Cannot build a report: this session has no ranked hypotheses.");
    }

    const researchGoal = this.memory.getResearchGoal(sessionId);
    const planConfig = this.memory.getPlanConfig(sessionId);
    const metaCritique = this.memory.getMetaReviewCritique(sessionId);
    const goalText = researchGoal?.rawGoal ?? session.name;
    const domain = planConfig?.parsedDomain ?? researchGoal?.constraints?.domain;
    const title = planConfig?.parsedTitle ?? session.name;

    // ── Global numbered bibliography (dedupe + resolve) ──────────────────────
    const citationsByHyp = hyps.map((h) => h.citations ?? []);
    const { references, markerByRaw } = await buildBibliography(
      citationsByHyp,
      opts.resolver,
    );

    // ── Deterministic per-hypothesis records ─────────────────────────────────
    const manuscriptHyps: ManuscriptHypothesis[] = hyps.map((h, i) => {
      const reviews = this.memory.getReviews(h.id);
      const scored = reviews.find(
        (r) => r.noveltyScore != null || r.correctnessScore != null,
      );
      const protocol = this.memory.getExperimentProtocol(h.id) as ExperimentProtocol | null;
      const mp: ManuscriptProtocol | null = protocol
        ? {
            overview: protocol.overview,
            steps: protocol.steps ?? [],
            timelineWeeks: protocol.timelineWeeks,
            costTier: protocol.costTier,
          }
        : null;
      return {
        rank: i + 1,
        id: h.id,
        title: h.title,
        summary: h.summary,
        content: h.content,
        rationale: h.rationale,
        keyAssumptions: h.keyAssumptions ?? [],
        eloRating: h.eloRating,
        ratingDeviation: h.ratingDeviation ?? 350,
        wins: h.wins,
        losses: h.losses,
        citationMarkers: markersFor(h.citations ?? [], markerByRaw),
        noveltyScore: scored?.noveltyScore ?? null,
        correctnessScore: scored?.correctnessScore ?? null,
        testabilityScore: scored?.testabilityScore ?? null,
        verdict: scored?.verdict ?? null,
        protocol: mp,
      };
    });

    // ── LLM narrative (single structured call) ───────────────────────────────
    const hypothesisSummaries = manuscriptHyps
      .map(
        (h) =>
          `## Hypothesis ${h.rank} [Elo ${Math.round(h.eloRating)}]: ${h.title}\n${h.summary}\n\nRationale: ${h.rationale}`,
      )
      .join("\n\n---\n\n");

    const { system, userPrompt, maxTokens } = this.loadPrompt("report", "manuscript", {
      title,
      researchGoal: goalText,
      domain: domain ?? "Science",
      hypothesisSummaries,
      metaCritique: metaCritique ?? "",
      stats: JSON.stringify(session.stats),
    });

    const narrative =
      (await this.callLLMForJSON<Narrative>(system, userPrompt, {
        maxTokens,
        schema: NarrativeSchema,
      })) ??
      ({
        abstract: session.researchOverview?.slice(0, 1500) ?? goalText,
        background: `This report investigates: ${goalText}.`,
        discussion:
          "See the ranked hypotheses and their reviews above for the substantive findings.",
        limitations:
          "Hypotheses are AI-generated and require experimental validation; citations should be independently verified.",
      } as Narrative);

    const manuscript: Manuscript = {
      sessionId,
      sessionName: session.name,
      title,
      generatedAt: new Date().toISOString(),
      researchGoal: goalText,
      domain,
      abstract: narrative.abstract,
      background: narrative.background,
      discussion: narrative.discussion,
      limitations: narrative.limitations,
      methods: {
        model: this.config.deepseek.model,
        seed: this.config.seed ?? null,
        rounds: session.stats.currentRound ?? 0,
        totalHypotheses: session.stats.totalHypotheses ?? hyps.length,
        totalMatches: session.stats.totalMatches ?? 0,
        budgetTokens: this.config.compute.budgetTokens,
        agents: PIPELINE_AGENTS,
      },
      hypotheses: manuscriptHyps,
      references,
    };

    this.memory.saveManuscript(sessionId, manuscript);
    this.log("info", `Manuscript generated (${references.length} references, ${manuscriptHyps.length} hypotheses)`);
    return manuscript;
  }
}
