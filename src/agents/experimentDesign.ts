import { BaseAgent } from "./base.js";
import type { Hypothesis } from "../models/hypothesis.js";

export interface ExperimentProtocol {
  hypothesisId: string;
  hypothesisTitle: string;
  overview: string;
  steps: Array<{ step: number; action: string; details: string }>;
  reagentsAndEquipment: string[];
  datasets: string[];
  expectedOutcomes: string;
  controls: string;
  timelineWeeks: number;
  costTier: "low" | "medium" | "high";
  generatedAt: string;
}

export class ExperimentDesignAgent extends BaseAgent {
  get agentName() { return "ExperimentDesign"; }

  /**
   * Generate a structured experimental protocol for the given hypothesis.
   * Called either automatically (post-plateau) or on-demand via CLI.
   */
  async execute(sessionId: string, hypothesisId?: string): Promise<ExperimentProtocol | null> {
    // Resolve target: explicit ID or top-1 by Elo
    let hypothesis: Hypothesis | null = null;
    if (hypothesisId) {
      hypothesis = this.memory.getHypothesis(hypothesisId);
      if (!hypothesis) {
        this.log("warn", `Hypothesis ${hypothesisId} not found`);
        return null;
      }
    } else {
      const top = this.memory.getTopHypotheses(sessionId, 1);
      if (top.length === 0) {
        this.log("warn", "No active hypotheses to design experiment for");
        return null;
      }
      hypothesis = top[0];
    }

    this.log("info", `Designing experiment for: "${hypothesis.title}"`);

    // Optional: search for methodological context
    const results = await this.search.search(
      `experimental protocol methodology ${hypothesis.title}`,
      "academic",
      { maxResults: 5 }
    );
    const literatureContext = this.formatSearchContext(results);

    const { system, userPrompt } = this.loadPrompt("experiment_design", "protocol", {
      hypothesisTitle: hypothesis.title,
      hypothesisSummary: hypothesis.summary,
      hypothesisContent: hypothesis.content,
      hypothesisRationale: hypothesis.rationale,
      keyAssumptions: hypothesis.keyAssumptions.join("; "),
      existingPlan: hypothesis.experimentalPlan ?? "None provided",
      literatureContext,
    });

    const parsed = await this.callLLMForJSON<
      Omit<ExperimentProtocol, "hypothesisId" | "hypothesisTitle" | "generatedAt">
    >(system, userPrompt, {

      maxTokens: 6000,
    });

    if (!parsed) {
      this.log("error", "Failed to parse protocol JSON from LLM response (even after retry)");
      return null;
    }

    const protocol: ExperimentProtocol = {
      hypothesisId: hypothesis.id,
      hypothesisTitle: hypothesis.title,
      generatedAt: new Date().toISOString(),
      ...parsed,
    };

    // Cast needed because ExperimentProtocol lacks an index signature; the
    // receiving method accepts Record<string,unknown> which is equivalent at runtime.
    this.memory.saveExperimentProtocol(hypothesis.id, protocol as unknown as Record<string, unknown>);
    this.log("info", `Protocol saved for hypothesis ${hypothesis.id}`);

    return protocol;
  }
}
