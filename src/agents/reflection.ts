import { BaseAgent } from "./base.js";
import type { Hypothesis } from "../models/hypothesis.js";
import type { ReviewVerdict } from "../models/hypothesis.js";
import { ReviewVerdictSchema } from "../models/hypothesis.js";
import { z } from "zod";
import { seededGlicko2Rating } from "../models/tournament.js";
import { ProvenanceAgent } from "./provenance.js";
import { CitationIntegrityAgent } from "./citationIntegrity.js";
import { SafetyAgent } from "./safety.js";
import { buildRLEFMetaReviewBlock } from "../rlef/prompt-injection.js";

interface ReviewResult {
  verdict: ReviewVerdict;
  noveltyScore?: number | null;
  correctnessScore?: number | null;
  testabilityScore?: number | null;
  safetyFlag?: boolean;
  summary: string;
  /** LLMs may return this as a string or a string array. Schema transforms to string. */
  critique: string | string[];
  supportingEvidence?: string[];
}

/**
 * Zod schema that validates required ReviewResult fields are present.
 *
 * Several reflection prompts (deep_verification, observation_review,
 * simulation_review) instruct the LLM to output `"noveltyScore": null` and
 * `"testabilityScore": null` when those dimensions are not assessed.  We
 * therefore accept `null` (in addition to a 0–10 number or `undefined`) for
 * the three score fields — otherwise schema validation fails, extractJSON
 * returns null, and the review is discarded even though the LLM obeyed the
 * prompt correctly.
 */
const ReviewResultSchema = z.object({
  verdict: ReviewVerdictSchema,
  noveltyScore: z.number().min(0).max(10).nullable().optional(),
  correctnessScore: z.number().min(0).max(10).nullable().optional(),
  testabilityScore: z.number().min(0).max(10).nullable().optional(),
  safetyFlag: z.boolean().default(false),
  summary: z.string(),
  // LLMs sometimes return critique as a string array (bullet points) instead of
  // a single string. Accept both and join array elements with newlines.
  critique: z.union([z.string(), z.array(z.string())]).transform(
    (v) => (Array.isArray(v) ? v.join("\n") : v)
  ),
  supportingEvidence: z.array(z.string()).default([]),
});

export class ReflectionAgent extends BaseAgent {
  get agentName() { return "Reflection"; }

  private provenance = new ProvenanceAgent();
  private citationIntegrity = new CitationIntegrityAgent();
  private safety = new SafetyAgent();

  async execute(sessionId: string): Promise<void> {
    // Get hypotheses pending review
    const pending = this.memory.getPendingReviewHypotheses(sessionId, 3);
    if (pending.length === 0) {
      this.log("debug", "No hypotheses pending review");
      return;
    }

    // Append RLEF block to each hypothesis review so the LLM is aware of
    // empirically validated/refuted hypotheses in this session.
    const rlefBlock = buildRLEFMetaReviewBlock(
      this.memory.getAllFeedbackForSession(sessionId)
    );

    for (const hyp of pending) {
      await this._reviewHypothesis(sessionId, hyp, rlefBlock);
    }
  }

  private async _reviewHypothesis(sessionId: string, hyp: Hypothesis, rlefBlock = ""): Promise<void> {
    this.memory.updateHypothesisStatus(hyp.id, "reviewing");

    try {

    // Step 1: Quick initial review (no search)
    const initial = this._normaliseScores(await this._initialReview(hyp, rlefBlock));
    this.memory.saveReview({
      hypothesisId: hyp.id,
      sessionId,
      type: "initial",
      ...initial,
      safetyFlag: initial.safetyFlag ?? false,
    });

    if (initial.verdict === "fail") {
      this.memory.updateHypothesisStatus(hyp.id, "rejected");
      this.log("info", `Rejected hypothesis: "${hyp.title}"`);
      return;
    }

    // Safety gate: screen for dual-use / harm risk before spending compute on the
    // full review, provenance, citation, and tournament-seeding stages. A
    // quarantined hypothesis is withheld (status `quarantined`) — it never enters
    // the tournament until a human releases it via `co-scientist safety`.
    if (this.config.safety.gateEnabled) {
      const assessment = await this.safety.assess(sessionId, hyp, initial.safetyFlag ?? false);
      if (assessment.decision === "quarantined") {
        this.memory.updateHypothesisStatus(hyp.id, "quarantined");
        return;
      }
    }

    // Step 2: Full review with literature search
    const full = this._normaliseScores(await this._fullReview(hyp));
    this.memory.saveReview({
      hypothesisId: hyp.id,
      sessionId,
      type: "full",
      ...full,
      safetyFlag: full.safetyFlag ?? false,
    });

    if (full.verdict === "fail") {
      this.memory.updateHypothesisStatus(hyp.id, "rejected");
      this.log("info", `Rejected hypothesis after full review: "${hyp.title}"`);
      return;
    }

    // Provenance: anchor claims to literature before entering tournament
    await this.provenance.execute(sessionId, hyp);

    // Citation integrity: verify cited papers exist; penalty folded into seeding below.
    const citePenalty = await this.citationIntegrity.execute(sessionId, hyp);

    // Step 3: Deep verification — each sub-claim holds independently?
    const deepReview = this._normaliseScores(await this._deepVerificationReview(hyp));
    this.memory.saveReview({
      hypothesisId: hyp.id,
      sessionId,
      type: "deep_verification",
      ...deepReview,
      safetyFlag: deepReview.safetyFlag ?? false,
    });

    // Step 4: Simulation — at which mechanistic step does it break?
    const simReview = this._normaliseScores(await this._simulationReview(hyp));
    this.memory.saveReview({
      hypothesisId: hyp.id,
      sessionId,
      type: "simulation",
      ...simReview,
      safetyFlag: simReview.safetyFlag ?? false,
    });

    // Step 5: Observation — does it explain known anomalous observations?
    // fail/uncertain here does NOT auto-reject: these are nuanced reviews that
    // contribute to the seeded Glicko-2 rating but the hypothesis still enters
    // the tournament so debates can surface the weaknesses.
    const obsReview = this._normaliseScores(await this._observationReview(hyp));
    this.memory.saveReview({
      hypothesisId: hyp.id,
      sessionId,
      type: "observation",
      ...obsReview,
      safetyFlag: obsReview.safetyFlag ?? false,
    });

    // Mark as active (enters tournament)
    this.memory.updateHypothesisStatus(hyp.id, "active");

    // ── Glicko-2 Bootstrap: seed initial rating from all five review stages ──
    const reviews = [initial, full, deepReview, simReview, obsReview];
    const bestNovelty     = this._bestScore(reviews.map(r => r.noveltyScore));
    const bestCorrectness = this._bestScore(reviews.map(r => r.correctnessScore));
    const bestTestability = this._bestScore(reviews.map(r => r.testabilityScore));

    const seededRating = seededGlicko2Rating(bestNovelty, bestCorrectness, bestTestability);
    // Fold the citation-integrity penalty into the seed: lower rating, wider RD.
    const finalRating = Math.max(1000, seededRating.rating + citePenalty.ratingDelta);
    const finalRd = Math.min(350, seededRating.rd + citePenalty.rdDelta);
    if (finalRating !== 1200 || finalRd !== seededRating.rd) {
      // Only write back if the seeded/penalized value actually differs from default.
      this.memory.updateHypothesisRating(
        hyp.id, finalRating, finalRd, seededRating.volatility, 0, 0, 0
      );
      this.log(
        "info",
        `Seeded Glicko-2 rating for "${hyp.title}": ${finalRating} (RD=${finalRd}) ` +
        `(novelty=${bestNovelty ?? "n/a"}, correctness=${bestCorrectness ?? "n/a"}, testability=${bestTestability ?? "n/a"}` +
        (citePenalty.ratingDelta !== 0 ? `, citation penalty=${citePenalty.ratingDelta}` : "") + ")"
      );
    }

    this.log("info", `Hypothesis passed review and is now active: "${hyp.title}"`);
    } catch (err) {
      // Revert status so the hypothesis is retried next round instead of
      // being stuck in "reviewing" forever after a transient failure.
      this.memory.updateHypothesisStatus(hyp.id, "pending_review");
      throw err;
    }
  }

  // ─── Initial Review (no search) ───────────────────────────────────────────
  private async _initialReview(hyp: Hypothesis, rlefBlock = ""): Promise<ReviewResult> {
    const { system, userPrompt } = this.loadPrompt("reflection", "initial_review", {
      title: hyp.title,
      content: hyp.content,
      rationale: hyp.rationale,
      keyAssumptions: hyp.keyAssumptions.join("; "),
    });

    const response = await this.callLLM(system, userPrompt + rlefBlock, {

      maxTokens: 2048,
      jsonMode: true,
    });

    const parsed = this.extractJSON<ReviewResult>(response.content, ReviewResultSchema);
    return parsed ?? {
      verdict: "uncertain",
      summary: "Could not parse review",
      critique: response.content.slice(0, 500),
      supportingEvidence: [],
    };
  }

  // ─── Full Review (with Consensus search) ─────────────────────────────────
  private async _fullReview(hyp: Hypothesis): Promise<ReviewResult> {
    // Search for related work
    const searchQueries = [
      hyp.title,
      ...hyp.keyAssumptions.slice(0, 2),
    ];
    const results = await this.search.multiSearch(searchQueries, "academic");
    const context = this.formatSearchContext(results);

    const { system, userPrompt } = this.loadPrompt("reflection", "full_review", {
      title: hyp.title,
      content: hyp.content,
      rationale: hyp.rationale,
      experimentalPlan: hyp.experimentalPlan ?? "Not specified",
      literatureContext: context,
    });

    const parsed = await this.callLLMForJSON<ReviewResult>(system, userPrompt, {

      maxTokens: 4096,
      schema: ReviewResultSchema,
    });
    if (parsed) {
      parsed.supportingEvidence = results.slice(0, 5).map((r) => r.url).filter(Boolean);
    }
    return parsed ?? {
      verdict: "uncertain",
      summary: "Full review parsing failed",
      critique: "",
      supportingEvidence: [],
    };
  }

  // ─── Deep Verification (assumption decomposition) ─────────────────────────
  private async _deepVerificationReview(hyp: Hypothesis): Promise<ReviewResult> {
    const { system, userPrompt } = this.loadPrompt("reflection", "deep_verification", {
      title: hyp.title,
      content: hyp.content,
      keyAssumptions: hyp.keyAssumptions.join("\n- "),
      rationale: hyp.rationale,
    });

    const parsed = await this.callLLMForJSON<ReviewResult>(system, userPrompt, {

      maxTokens: 4096,
      schema: ReviewResultSchema,
    });
    return parsed ?? {
      verdict: "uncertain",
      summary: "Deep verification inconclusive",
      critique: "",
      supportingEvidence: [],
    };
  }

  // ─── Observation Review ────────────────────────────────────────────────────
  private async _observationReview(hyp: Hypothesis): Promise<ReviewResult> {
    const queries = [
      `${hyp.title} experimental observations results`,
      ...(hyp.keyAssumptions[0] ? [`${hyp.keyAssumptions[0]} anomalous findings`] : []),
    ];
    const results = await this.search.multiSearch(queries, "web");
    const context = this.formatSearchContext(results);

    const { system, userPrompt } = this.loadPrompt("reflection", "observation_review", {
      title: hyp.title,
      content: hyp.content,
      observations: context,
    });

    return this.callLLMForJSON<ReviewResult>(system, userPrompt, {

      maxTokens: 3500,
      schema: ReviewResultSchema,
    }).then((parsed) => parsed ?? {
      verdict: "uncertain" as const,
      summary: "Observation review inconclusive",
      critique: "",
      supportingEvidence: [],
    });
  }

  /** Public on-demand entry point (CLI / external callers). */
  async runObservationReview(sessionId: string, hyp: Hypothesis): Promise<void> {
    const result = this._normaliseScores(await this._observationReview(hyp));
    this.memory.saveReview({
      hypothesisId: hyp.id,
      sessionId,
      type: "observation",
      ...result,
      safetyFlag: result.safetyFlag ?? false,
    });
  }

  // ─── Simulation Review ────────────────────────────────────────────────────
  private async _simulationReview(hyp: Hypothesis): Promise<ReviewResult> {
    const { system, userPrompt } = this.loadPrompt("reflection", "simulation_review", {
      title: hyp.title,
      content: hyp.content,
      experimentalPlan: hyp.experimentalPlan ?? "Not specified",
    });

    return this.callLLMForJSON<ReviewResult>(system, userPrompt, {

      maxTokens: 3000,
      schema: ReviewResultSchema,
    }).then((parsed) => parsed ?? {
      verdict: "uncertain" as const,
      summary: "Simulation review inconclusive",
      critique: "",
      supportingEvidence: [],
    });
  }

  /** Public on-demand entry point (CLI / external callers). */
  async runSimulationReview(sessionId: string, hyp: Hypothesis): Promise<void> {
    const result = this._normaliseScores(await this._simulationReview(hyp));
    this.memory.saveReview({
      hypothesisId: hyp.id,
      sessionId,
      type: "simulation",
      ...result,
      safetyFlag: result.safetyFlag ?? false,
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Normalise `null` score fields and optional `supportingEvidence` before
   * persisting through `ContextStore.saveReview()`, whose schema expects
   * `number | undefined` (not `number | null`) and a required `string[]`.
   *
   * The `critique` array→string join here is intentionally redundant with
   * `ReviewResultSchema`'s transform: it covers the code paths that build a
   * `ReviewResult` WITHOUT going through the schema — the per-stage fallback
   * objects (parse failures) and any `extractJSON` call made without a schema.
   */
  private _normaliseScores(r: ReviewResult): Omit<ReviewResult, "noveltyScore" | "correctnessScore" | "testabilityScore" | "supportingEvidence" | "critique"> & {
    noveltyScore?: number;
    correctnessScore?: number;
    testabilityScore?: number;
    supportingEvidence: string[];
    critique: string;
  } {
    return {
      ...r,
      noveltyScore: r.noveltyScore ?? undefined,
      correctnessScore: r.correctnessScore ?? undefined,
      testabilityScore: r.testabilityScore ?? undefined,
      supportingEvidence: r.supportingEvidence ?? [],
      critique: Array.isArray(r.critique) ? r.critique.join("\n") : r.critique,
    };
  }

  /**
   * Return the highest defined score from an array of optional numbers.
   * Using the best (most optimistic) score across review stages rewards
   * hypotheses that excelled in at least one review dimension.
   */
  private _bestScore(scores: (number | null | undefined)[]): number | undefined {
    const defined = scores.filter((s): s is number => s !== undefined && s !== null);
    if (defined.length === 0) return undefined;
    return Math.max(...defined);
  }
}
