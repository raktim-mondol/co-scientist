import { BaseAgent } from "./base.js";
import {
  computeGlicko2Update,
  type Glicko2State,
} from "../models/tournament.js";
import type { Hypothesis } from "../models/hypothesis.js";
import type { MatchResult } from "../models/tournament.js";

interface DebateResult {
  winner: "A" | "B" | "draw";
  rationale: string;
  transcript: string;
}

export interface MatchSummary {
  winner: "A" | "B" | "draw";
  rationale: string;
  transcript: string;
  matchType: "debate" | "simple";
  ratingA: { before: number; after: number; rd: number };
  ratingB: { before: number; after: number; rd: number };
}

// ─── Uncertainty priority ────────────────────────────────────────────────────
// Hypotheses with a high Rating Deviation (RD) are uncertain — they should be
// matched more often so the system converges on a reliable ranking faster.
const HIGH_RD_THRESHOLD = 150; // above this → "provisional" — prioritise for matching

export class RankingAgent extends BaseAgent {
  get agentName() { return "Ranking"; }

  async execute(sessionId: string, round: number): Promise<void> {
    const hypotheses = this.memory.getAllActiveHypotheses(sessionId);
    if (hypotheses.length < 2) {
      this.log("debug", "Not enough active hypotheses for ranking");
      return;
    }

    // Run 1-3 matches per round
    const numMatches = Math.min(3, Math.floor(hypotheses.length / 2));
    for (let i = 0; i < numMatches; i++) {
      const [hypA, hypB] = this._selectMatchup(hypotheses);
      if (!hypA || !hypB || hypA.id === hypB.id) continue;

      await this._runMatch(sessionId, hypA, hypB, round);
    }
  }

  async runManualMatch(
    sessionId: string,
    hypA: Hypothesis,
    hypB: Hypothesis,
    round: number
  ): Promise<MatchSummary> {
    return this._runMatch(sessionId, hypA, hypB, round);
  }

  // ─── Format ClaimCitations for prompt injection ───────────────────────────
  private _formatProvenance(hypothesisId: string): string {
    const claims = this.memory.getClaimCitations(hypothesisId);
    if (!claims || claims.length === 0) {
      return "No provenance data available for this hypothesis.";
    }
    const lines = claims.map((c, i) => {
      const icon =
        c.support === "supports"
          ? "✅ SUPPORTS"
          : c.support === "contradicts"
          ? "❌ CONTRADICTS"
          : "⚠️  UNADDRESSED";
      return [
        `Claim ${i + 1}: "${c.claimText}"`,
        `  ${icon} (confidence: ${(c.confidence * 100).toFixed(0)}%)`,
        `  Paper: ${c.paperTitle} — ${c.paperAuthors} (${c.paperYear ?? "n/a"})`,
      ].join("\n");
    });
    const contradicted = claims.filter((c) => c.support === "contradicts").length;
    const supported = claims.filter((c) => c.support === "supports").length;
    const summary = `Summary: ${supported} supported, ${contradicted} contradicted, ${claims.length - supported - contradicted} unaddressed out of ${claims.length} claims.`;
    return [summary, "", ...lines].join("\n");
  }

  private async _runMatch(
    sessionId: string,
    hypA: Hypothesis,
    hypB: Hypothesis,
    round: number
  ): Promise<MatchSummary> {
    const avgRating = (hypA.eloRating + hypB.eloRating) / 2;
    const isTopRanked = avgRating >= 1400;

    this.log("info", `Match: "${hypA.title}" vs "${hypB.title}" (round ${round})`);

    // Load provenance for both hypotheses
    const provenanceA = this._formatProvenance(hypA.id);
    const provenanceB = this._formatProvenance(hypB.id);

    let result: DebateResult;
    if (isTopRanked) {
      result = await this._runDebateMatch(hypA, hypB, provenanceA, provenanceB);
    } else {
      result = await this._runSimpleMatch(hypA, hypB, provenanceA, provenanceB);
    }

    const matchResult: MatchResult =
      result.winner === "A" ? "A_wins" : result.winner === "B" ? "B_wins" : "draw";

    // ── Build Glicko-2 state from current DB values ───────────────────────────
    const stateA: Glicko2State = {
      rating:       hypA.eloRating,
      rd:           hypA.ratingDeviation ?? 350,
      volatility:   hypA.volatility      ?? 0.06,
      matchesPlayed: hypA.matchesPlayed,
      wins:          hypA.wins,
      losses:        hypA.losses,
      draws:         0,
    };
    const stateB: Glicko2State = {
      rating:       hypB.eloRating,
      rd:           hypB.ratingDeviation ?? 350,
      volatility:   hypB.volatility      ?? 0.06,
      matchesPlayed: hypB.matchesPlayed,
      wins:          hypB.wins,
      losses:        hypB.losses,
      draws:         0,
    };

    const { newA, newB } = computeGlicko2Update(stateA, stateB, matchResult);

    // Re-fetch fresh state from DB so concurrent matches don't lose updates
    const freshA = this.memory.getHypothesis(hypA.id) ?? hypA;
    const freshB = this.memory.getHypothesis(hypB.id) ?? hypB;

    // Persist Glicko-2 state
    this.memory.updateHypothesisRating(
      freshA.id,
      newA.rating,
      newA.rd,
      newA.volatility,
      freshA.wins   + (result.winner === "A" ? 1 : 0),
      freshA.losses + (result.winner === "B" ? 1 : 0),
      freshA.matchesPlayed + 1
    );
    this.memory.updateHypothesisRating(
      freshB.id,
      newB.rating,
      newB.rd,
      newB.volatility,
      freshB.wins   + (result.winner === "B" ? 1 : 0),
      freshB.losses + (result.winner === "A" ? 1 : 0),
      freshB.matchesPlayed + 1
    );

    const winner = result.winner === "A" ? freshA : result.winner === "B" ? freshB : null;

    this.memory.saveTournamentMatch({
      sessionId,
      hypothesisAId: hypA.id,
      hypothesisBId: hypB.id,
      matchType: isTopRanked ? "debate" : "simple",
      result: matchResult,
      winnerEloAfter: result.winner === "A" ? newA.rating : result.winner === "B" ? newB.rating : newA.rating,
      loserEloAfter:  result.winner === "A" ? newB.rating : result.winner === "B" ? newA.rating : newB.rating,
      debateTranscript: result.transcript,
      rationale: result.rationale,
      round,
    });

    if (winner) {
      const winnerNewRating = result.winner === "A" ? newA.rating : newB.rating;
      const winnerNewRd     = result.winner === "A" ? newA.rd     : newB.rd;
      this.log(
        "info",
        `Winner: "${winner.title}" (${winner.eloRating} → ${winnerNewRating}, RD: ${winnerNewRd})`
      );
    } else {
      this.log("info", `Draw: "${freshA.title}" vs "${freshB.title}"`);
    }

    return {
      winner: result.winner,
      rationale: result.rationale,
      transcript: result.transcript,
      matchType: isTopRanked ? "debate" : "simple",
      ratingA: { before: hypA.eloRating, after: newA.rating, rd: newA.rd },
      ratingB: { before: hypB.eloRating, after: newB.rating, rd: newB.rd },
    };
  }

  // ─── Multi-turn Scientific Debate ────────────────────────────────────────
  private async _runDebateMatch(
    hypA: Hypothesis,
    hypB: Hypothesis,
    provenanceA: string,
    provenanceB: string
  ): Promise<DebateResult> {
    const { system, userPrompt } = this.loadPrompt("ranking", "debate_match", {
      hypothesisA: `Title: ${hypA.title}\n\nSummary: ${hypA.summary}\n\nRationale: ${hypA.rationale}`,
      hypothesisB: `Title: ${hypB.title}\n\nSummary: ${hypB.summary}\n\nRationale: ${hypB.rationale}`,
      provenanceA,
      provenanceB,
    });

    const transcript: string[] = [];

    // Turn 1: Advocate for each hypothesis
    const turn1 = await this.callLLM(system, userPrompt, { mode: "reason", maxTokens: 3000 });
    transcript.push(`[Round 1 - Advocacy]\n${turn1.content}`);

    // Turn 2: Cross-examination
    const turn2 = await this.callLLMMultiTurn(
      system,
      [
        { role: "user", content: userPrompt },
        { role: "assistant", content: turn1.content },
        {
          role: "user",
          content:
            "Now conduct a rigorous cross-examination. Advocate B challenges the weaknesses of Hypothesis A, and Advocate A challenges Hypothesis B. Focus on: novelty flaws, experimental feasibility issues, logical gaps, and any contradicted provenance claims.",
        },
      ],
      { mode: "reason", maxTokens: 3000 }
    );
    transcript.push(`[Round 2 - Cross-examination]\n${turn2.content}`);

    // Turn 3: Final judgment
    const turn3 = await this.callLLMMultiTurn(
      system,
      [
        { role: "user", content: userPrompt },
        { role: "assistant", content: turn1.content },
        { role: "user", content: "Cross-examination phase..." },
        { role: "assistant", content: turn2.content },
        {
          role: "user",
          content:
            'As the scientific judge, deliver your verdict. Which hypothesis is superior in novelty, correctness, evidence credibility (provenance), testability, and overall scientific merit? Respond with JSON: {"winner": "A" | "B" | "draw", "rationale": "detailed explanation"}',
        },
      ],
      { mode: "reason", maxTokens: 2000, jsonMode: true }
    );

    const judgment = this.extractJSON<{ winner: "A" | "B" | "draw"; rationale: string }>(
      turn3.content
    );

    return {
      winner: judgment?.winner ?? "draw",
      rationale: judgment?.rationale ?? "Debate inconclusive",
      transcript: transcript.join("\n\n---\n\n"),
    };
  }

  // ─── Single-turn Simple Comparison ────────────────────────────────────────
  private async _runSimpleMatch(
    hypA: Hypothesis,
    hypB: Hypothesis,
    provenanceA: string,
    provenanceB: string
  ): Promise<DebateResult> {
    const { system, userPrompt } = this.loadPrompt("ranking", "simple_comparison", {
      hypothesisA: `Title: ${hypA.title}\n\nSummary: ${hypA.summary}`,
      hypothesisB: `Title: ${hypB.title}\n\nSummary: ${hypB.summary}`,
      provenanceA,
      provenanceB,
    });

    const response = await this.callLLM(system, userPrompt, {
      mode: "chat",
      maxTokens: 1500,
      jsonMode: true,
    });

    const result = this.extractJSON<{ winner: "A" | "B" | "draw"; rationale: string }>(
      response.content
    );

    return {
      winner: result?.winner ?? "draw",
      rationale: result?.rationale ?? "Comparison inconclusive",
      transcript: response.content,
    };
  }

  // ─── Matchup Selection ────────────────────────────────────────────────────
  /**
   * Select two hypotheses for a match.
   *
   * Priority (descending):
   * 1. Pair a high-RD (uncertain) hypothesis with a similar one from the
   *    proximity graph — converges uncertain ratings fastest.
   * 2. Pair any high-RD hypothesis from the pool with a random opponent.
   * 3. Random pair from the top-10 pool.
   */
  private _selectMatchup(
    hypotheses: Hypothesis[]
  ): [Hypothesis | null, Hypothesis | null] {
    if (hypotheses.length < 2) return [null, null];

    // Compute a "priority score": high RD → match urgently
    const scored = hypotheses.map((h) => ({
      hyp: h,
      priority: (h.ratingDeviation ?? 350) / (h.matchesPlayed + 1),
    }));
    scored.sort((a, b) => b.priority - a.priority);

    const primary = scored[0].hyp;

    // Try to find a similar opponent from proximity graph
    const similarIds = this.memory.getSimilarHypotheses(primary.id, 3);
    const similar = hypotheses.find(
      (h) => similarIds.includes(h.id) && h.id !== primary.id
    );
    if (similar) return [primary, similar];

    // Otherwise, pick the second-highest-priority hypothesis
    const secondaryPool = scored.slice(1, Math.min(10, scored.length));
    if (secondaryPool.length === 0) return [null, null];
    const secondary = secondaryPool[Math.floor(Math.random() * secondaryPool.length)].hyp;

    return [primary, secondary];
  }
}
