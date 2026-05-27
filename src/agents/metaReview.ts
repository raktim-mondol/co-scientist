import { BaseAgent } from "./base.js";

export class MetaReviewAgent extends BaseAgent {
  get agentName() { return "MetaReview"; }

  /**
   * Synthesize patterns from all reviews and tournament debates into a critique.
   * This critique is appended to all agent prompts in subsequent iterations.
   */
  async synthesizeCritique(sessionId: string): Promise<void> {
    const topHypotheses = this.memory.getTopHypotheses(sessionId, 10);
    if (topHypotheses.length < 3) return;

    this.log("info", "Synthesizing meta-review critique...");

    // Collect review summaries
    const reviewSummaries = topHypotheses
      .flatMap((h) => {
        const reviews = this.memory.getReviews(h.id);
        return reviews.map((r) => `[${r.type}] "${h.title}": ${r.summary}`);
      })
      .slice(0, 20)
      .join("\n");

    // Collect recent debate transcripts
    const recentMatches = this.memory.getRecentMatches(sessionId, 10);
    const debateSummaries = recentMatches
      .filter((m) => m.debateTranscript)
      .map((m) => `Match: ${m.rationale}`)
      .join("\n");

    const { system, userPrompt } = this.loadPrompt("meta_review", "synthesis", {
      reviewSummaries,
      debateSummaries,
      topHypothesesCount: topHypotheses.length,
      topHypothesisTitles: topHypotheses
        .slice(0, 5)
        .map((h) => h.title)
        .join(", "),
    });

    const response = await this.callLLM(system, userPrompt, {
      mode: "reason",
      maxTokens: 4000,
    });

    // Store critique — will be injected into all subsequent agent prompts
    this.memory.saveMetaReviewCritique(sessionId, response.content);
    this.log("info", "Meta-review critique saved");
  }

  /**
   * Generate the final comprehensive research overview at session end.
   */
  async generateResearchOverview(sessionId: string): Promise<void> {
    const topHypotheses = this.memory.getTopHypotheses(sessionId, 10);
    const session = this.memory.getSession(sessionId);
    const metaCritique = this.memory.getMetaReviewCritique(sessionId);

    if (!session || topHypotheses.length === 0) {
      this.log("warn", "Cannot generate overview: no session or hypotheses found");
      return;
    }

    const planConfig = this.memory.getPlanConfig(sessionId);

    const hypothesisSummaries = topHypotheses
      .map(
        (h, i) =>
          `## Hypothesis ${i + 1} [Elo: ${Math.round(h.eloRating)}]\n**${h.title}**\n\n${h.content}\n\n**Rationale:** ${h.rationale}\n\n**Proposed Experiments:** ${h.experimentalPlan ?? "See full text"}`
      )
      .join("\n\n---\n\n");

    const { system, userPrompt } = this.loadPrompt("meta_review", "research_overview", {
      researchGoal: planConfig?.parsedTitle ?? "Research Goal",
      domain: planConfig?.parsedDomain ?? "Science",
      hypothesisSummaries,
      metaCritique: metaCritique ?? "",
      stats: JSON.stringify(session.stats),
    });

    const response = await this.callLLM(system, userPrompt, {
      mode: "reason",
      maxTokens: 8000,
    });

    this.memory.saveResearchOverview(sessionId, response.content);
    this.log("info", "Research overview generated and session marked complete");
  }
}
