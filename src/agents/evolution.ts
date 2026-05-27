import { BaseAgent } from "./base.js";
import type { Hypothesis } from "../models/hypothesis.js";
import { buildRLEFMetaReviewBlock } from "../rlef/prompt-injection.js";

type EvolutionStrategy =
  | "grounding"
  | "coherence"
  | "cross_pollination"
  | "combination"
  | "simplification"
  | "out_of_box";

interface EvolvedHypothesis {
  title: string;
  summary: string;
  content: string;
  rationale: string;
  experimentalPlan?: string;
  noveltyAssessment?: string;
  keyAssumptions: string[];
  citations: string[];
}

export class EvolutionAgent extends BaseAgent {
  get agentName() { return "Evolution"; }

  async execute(sessionId: string, round: number): Promise<void> {
    const topHypotheses = this.memory.getTopHypotheses(sessionId, 5);
    if (topHypotheses.length === 0) {
      this.log("debug", "No top hypotheses to evolve yet");
      return;
    }

    const strategy = this._selectStrategy(round);
    this.log("info", `Running evolution strategy: ${strategy}`);

    const metaCritique = this.memory.getMetaReviewCritique(sessionId);
    const rlefBlock = buildRLEFMetaReviewBlock(
      this.memory.getAllFeedbackForSession(sessionId)
    );
    const metaCritiqueWithRLEF = (metaCritique ?? "") + rlefBlock;
    let evolved: EvolvedHypothesis | null = null;
    let parentIds: string[] = [];

    switch (strategy) {
      case "grounding": {
        const target = topHypotheses[0];
        evolved = await this._groundingEnhancement(target, metaCritiqueWithRLEF);
        parentIds = [target.id];
        break;
      }
      case "coherence": {
        const target = topHypotheses[0];
        evolved = await this._coherenceImprovement(target);
        parentIds = [target.id];
        break;
      }
      case "cross_pollination": {
        const target = topHypotheses[Math.floor(Math.random() * topHypotheses.length)];
        evolved = await this._crossPollination(target, topHypotheses);
        parentIds = [target.id];
        break;
      }
      case "combination": {
        const sources = topHypotheses.slice(0, Math.min(3, topHypotheses.length));
        evolved = await this._combination(sources);
        parentIds = sources.map((h) => h.id);
        break;
      }
      case "simplification": {
        const target = topHypotheses[0];
        evolved = await this._simplification(target);
        parentIds = [target.id];
        break;
      }
      case "out_of_box": {
        const seed = topHypotheses[Math.floor(Math.random() * topHypotheses.length)];
        const planConfig = this.memory.getPlanConfig(sessionId);
        evolved = await this._outOfBox(seed, planConfig?.parsedTitle ?? "", metaCritiqueWithRLEF);
        parentIds = [seed.id];
        break;
      }
    }

    if (evolved) {
      // ── ELO Bootstrap: evolved hypotheses inherit from their best parent ───
      // Using 85% of the top parent's ELO rewards proven lineage while still
      // leaving room to climb (or fall) based on actual match performance.
      const parentElo = this._bestParentElo(parentIds);
      const startingElo = parentElo !== null
        ? Math.round(parentElo * 0.85)
        : 1200;

      this.memory.saveHypothesis({
        sessionId,
        ...evolved,
        eloRating: startingElo,
        ratingDeviation: 350,  // Fully uncertain — hasn't competed yet
        volatility: 0.06,
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        status: "pending_review",
        parentIds,
        generationStrategy: `evolution:${strategy}`,
        generationRound: round,
      });
      this.log(
        "info",
        `Evolved hypothesis: "${evolved.title}" ` +
        `(starting ELO: ${startingElo}${ parentElo !== null ? ` ← parent ${parentElo} × 0.85` : " (no parent ELO)" })`
      );
    }
  }

  private async _groundingEnhancement(
    hyp: Hypothesis,
    metaCritique: string | null
  ): Promise<EvolvedHypothesis | null> {
    // Search for supporting evidence to fill gaps
    const results = await this.search.search(
      `${hyp.title} evidence mechanism`,
      "academic",
      { maxResults: 6 }
    );
    const context = this.formatSearchContext(results);

    const { system, userPrompt } = this.loadPrompt("evolution", "grounding", {
      originalTitle: hyp.title,
      originalContent: hyp.content,
      originalRationale: hyp.rationale,
      keyAssumptions: hyp.keyAssumptions.join("; "),
      literatureContext: context,
      metaCritique: metaCritique ?? "",
    });

    return this.callLLMForJSON<EvolvedHypothesis>(system, userPrompt, {
      mode: "reason",
      maxTokens: 5000,
    });
  }

  private async _coherenceImprovement(hyp: Hypothesis): Promise<EvolvedHypothesis | null> {
    const { system, userPrompt } = this.loadPrompt("evolution", "coherence", {
      originalTitle: hyp.title,
      originalContent: hyp.content,
      originalRationale: hyp.rationale,
      experimentalPlan: hyp.experimentalPlan ?? "",
    });

    return this.callLLMForJSON<EvolvedHypothesis>(system, userPrompt, {
      mode: "reason",
      maxTokens: 5000,
    });
  }

  private async _crossPollination(
    target: Hypothesis,
    others: Hypothesis[]
  ): Promise<EvolvedHypothesis | null> {
    const inspirations = others
      .filter((h) => h.id !== target.id)
      .slice(0, 3)
      .map((h) => `- ${h.title}: ${h.summary}`)
      .join("\n");

    const { system, userPrompt } = this.loadPrompt("evolution", "cross_pollination", {
      primaryHypothesis: `${target.title}: ${target.content}`,
      inspirations,
    });

    return this.callLLMForJSON<EvolvedHypothesis>(system, userPrompt, {
      mode: "reason",
      maxTokens: 5000,
    });
  }

  private async _combination(sources: Hypothesis[]): Promise<EvolvedHypothesis | null> {
    const hypothesesText = sources
      .map((h, i) => `[${i + 1}] ${h.title}\n${h.summary}\n${h.rationale}`)
      .join("\n\n");

    const { system, userPrompt } = this.loadPrompt("evolution", "combination", {
      primaryHypothesis: hypothesesText,
      inspirations: "",
      strategy: "combination",
    });

    return this.callLLMForJSON<EvolvedHypothesis>(system, userPrompt, {
      mode: "reason",
      maxTokens: 6000,
    });
  }

  private async _simplification(hyp: Hypothesis): Promise<EvolvedHypothesis | null> {
    const { system, userPrompt } = this.loadPrompt("evolution", "simplification", {
      title: hyp.title,
      content: hyp.content,
      experimentalPlan: hyp.experimentalPlan ?? "Not specified",
    });

    return this.callLLMForJSON<EvolvedHypothesis>(system, userPrompt, {
      mode: "chat",
      maxTokens: 4000,
    });
  }

  private async _outOfBox(
    seed: Hypothesis,
    researchGoal: string,
    metaCritique = ""
  ): Promise<EvolvedHypothesis | null> {
    const { system, userPrompt } = this.loadPrompt("evolution", "out_of_box", {
      seedHypothesis: `${seed.title}: ${seed.summary}`,
      researchGoal,
    });

    return this.callLLMForJSON<EvolvedHypothesis>(system, userPrompt + metaCritique, {
      mode: "reason",
      maxTokens: 5000,
    });
  }

  private _selectStrategy(round: number): EvolutionStrategy {
    const strategies: EvolutionStrategy[] = [
      "grounding",
      "coherence",
      "cross_pollination",
      "combination",
      "simplification",
      "out_of_box",
    ];
    return strategies[round % strategies.length];
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Look up the highest ELO among a set of parent hypothesis IDs.
   * Returns null if none of the IDs resolve to a known hypothesis.
   */
  private _bestParentElo(parentIds: string[]): number | null {
    if (parentIds.length === 0) return null;
    const elos = parentIds
      .map((id) => this.memory.getHypothesis(id)?.eloRating)
      .filter((e): e is number => e !== undefined);
    if (elos.length === 0) return null;
    return Math.max(...elos);
  }
}
