import { BaseAgent } from "./base.js";
import type { Hypothesis } from "../models/hypothesis.js";
import type { ReviewVerdict } from "../models/hypothesis.js";
import { seededGlicko2Rating } from "../models/tournament.js";
import { ProvenanceAgent } from "./provenance.js";

interface ReviewResult {
  verdict: ReviewVerdict;
  noveltyScore?: number;
  correctnessScore?: number;
  testabilityScore?: number;
  safetyFlag?: boolean;
  summary: string;
  critique: string;
  supportingEvidence: string[];
}

export class ReflectionAgent extends BaseAgent {
  get agentName() { return "Reflection"; }

  private provenance = new ProvenanceAgent();

  async execute(sessionId: string): Promise<void> {
    // Get hypotheses pending review
    const pending = this.memory.getPendingReviewHypotheses(sessionId, 3);
    if (pending.length === 0) {
      this.log("debug", "No hypotheses pending review");
      return;
    }

    for (const hyp of pending) {
      await this._reviewHypothesis(sessionId, hyp);
    }
  }

  private async _reviewHypothesis(sessionId: string, hyp: Hypothesis): Promise<void> {
    this.memory.updateHypothesisStatus(hyp.id, "reviewing");

    // Step 1: Quick initial review (no search)
    const initial = await this._initialReview(hyp);
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

    // Step 2: Full review with literature search
    const full = await this._fullReview(hyp);
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

    // Step 3: Deep verification — each sub-claim holds independently?
    const deepReview = await this._deepVerificationReview(hyp);
    this.memory.saveReview({
      hypothesisId: hyp.id,
      sessionId,
      type: "deep_verification",
      ...deepReview,
      safetyFlag: deepReview.safetyFlag ?? false,
    });

    // Step 4: Simulation — at which mechanistic step does it break?
    const simReview = await this._simulationReview(hyp);
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
    const obsReview = await this._observationReview(hyp);
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
    if (seededRating.rating !== 1200) {
      // Only write back if the seeded value actually differs to avoid a no-op update
      this.memory.updateHypothesisElo(hyp.id, seededRating.rating, 0, 0, 0);
      this.log(
        "info",
        `Seeded Glicko-2 rating for "${hyp.title}": ${seededRating.rating} ` +
        `(novelty=${bestNovelty ?? "n/a"}, correctness=${bestCorrectness ?? "n/a"}, testability=${bestTestability ?? "n/a"})`
      );
    }

    this.log("info", `Hypothesis passed review and is now active: "${hyp.title}"`);
  }

  // ─── Initial Review (no search) ───────────────────────────────────────────
  private async _initialReview(hyp: Hypothesis): Promise<ReviewResult> {
    const { system, userPrompt } = this.loadPrompt("reflection", "initial_review", {
      title: hyp.title,
      content: hyp.content,
      rationale: hyp.rationale,
      keyAssumptions: hyp.keyAssumptions.join("; "),
    });

    const response = await this.callLLM(system, userPrompt, {
      mode: "chat",
      maxTokens: 2048,
      jsonMode: true,
    });

    const parsed = this.extractJSON<ReviewResult>(response.content);
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

    const response = await this.callLLM(system, userPrompt, {
      mode: "reason",
      maxTokens: 4096,
      jsonMode: true,
    });

    const parsed = this.extractJSON<ReviewResult>(response.content);
    if (parsed) {
      parsed.supportingEvidence = results.slice(0, 5).map((r) => r.url).filter(Boolean);
    }
    return parsed ?? {
      verdict: "uncertain",
      summary: "Full review parsing failed",
      critique: response.content.slice(0, 500),
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

    const response = await this.callLLM(system, userPrompt, {
      mode: "reason",
      maxTokens: 4096,
      jsonMode: true,
    });

    const parsed = this.extractJSON<ReviewResult>(response.content);
    return parsed ?? {
      verdict: "uncertain",
      summary: "Deep verification inconclusive",
      critique: response.content.slice(0, 500),
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

    const response = await this.callLLM(system, userPrompt, {
      mode: "reason",
      maxTokens: 3500,
      jsonMode: true,
    });

    return this.extractJSON<ReviewResult>(response.content) ?? {
      verdict: "uncertain",
      summary: "Observation review inconclusive",
      critique: response.content.slice(0, 500),
      supportingEvidence: [],
    };
  }

  /** Public on-demand entry point (CLI / external callers). */
  async runObservationReview(sessionId: string, hyp: Hypothesis): Promise<void> {
    const result = await this._observationReview(hyp);
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

    const response = await this.callLLM(system, userPrompt, {
      mode: "reason",
      maxTokens: 3000,
      jsonMode: true,
    });

    return this.extractJSON<ReviewResult>(response.content) ?? {
      verdict: "uncertain",
      summary: "Simulation review inconclusive",
      critique: response.content.slice(0, 500),
      supportingEvidence: [],
    };
  }

  /** Public on-demand entry point (CLI / external callers). */
  async runSimulationReview(sessionId: string, hyp: Hypothesis): Promise<void> {
    const result = await this._simulationReview(hyp);
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
   * Return the highest defined score from an array of optional numbers.
   * Using the best (most optimistic) score across review stages rewards
   * hypotheses that excelled in at least one review dimension.
   */
  private _bestScore(scores: (number | undefined)[]): number | undefined {
    const defined = scores.filter((s): s is number => s !== undefined && s !== null);
    if (defined.length === 0) return undefined;
    return Math.max(...defined);
  }
}
