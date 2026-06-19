import { BaseAgent } from "./base.js";
import {
  computeGlicko2Update,
  type Glicko2State,
} from "../models/tournament.js";
import type { Hypothesis } from "../models/hypothesis.js";
import type { MatchResult } from "../models/tournament.js";
import { rng, rngInt } from "../util/rng.js";
import { combineSwappedVerdicts, mapPresentedVerdict, type Verdict } from "./judgeDebias.js";

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

    const result = await this._judgeMatch(hypA, hypB, provenanceA, provenanceB, isTopRanked);

    const matchResult: MatchResult =
      result.winner === "A" ? "A_wins" : result.winner === "B" ? "B_wins" : "draw";

    // ── Atomic Glicko-2 update ────────────────────────────────────────────────
    // Both hypotheses are updated inside a SINGLE transaction that reads fresh
    // pre-match state for BOTH players, computes BOTH Glicko-2 updates from the
    // same snapshot, and writes both back.  This ensures the zero-sum invariant:
    // newA + newB ≈ oldA + oldB.  Using separate atomicGlicko2Update calls would
    // cause B to see A's post-match state, violating symmetry.
    let ratingAfterA = { rating: hypA.eloRating, rd: hypA.ratingDeviation ?? 350 };
    let ratingAfterB = { rating: hypB.eloRating, rd: hypB.ratingDeviation ?? 350 };

    this.memory.atomicDualGlicko2Update(hypA.id, hypB.id, (stateA, stateB) => {
      const resultAB = computeGlicko2Update(
        { ...stateA } as Glicko2State,
        { ...stateB } as Glicko2State,
        matchResult
      );
      ratingAfterA = { rating: resultAB.newA.rating, rd: resultAB.newA.rd };
      ratingAfterB = { rating: resultAB.newB.rating, rd: resultAB.newB.rd };
      return { newA: resultAB.newA, newB: resultAB.newB };
    });

    const freshA = this.memory.getHypothesis(hypA.id) ?? hypA;
    const freshB = this.memory.getHypothesis(hypB.id) ?? hypB;
    const winner = result.winner === "A" ? freshA : result.winner === "B" ? freshB : null;

    this.memory.saveTournamentMatch({
      sessionId,
      hypothesisAId: hypA.id,
      hypothesisBId: hypB.id,
      matchType: isTopRanked ? "debate" : "simple",
      result: matchResult,
      // On a draw there is no winner/loser: these columns fall back to A's and
      // B's post-match ratings respectively (read `result` to interpret them).
      winnerEloAfter: result.winner === "A" ? ratingAfterA.rating : result.winner === "B" ? ratingAfterB.rating : ratingAfterA.rating,
      loserEloAfter:  result.winner === "A" ? ratingAfterB.rating : result.winner === "B" ? ratingAfterA.rating : ratingAfterB.rating,
      debateTranscript: result.transcript,
      rationale: result.rationale,
      round,
    });

    if (winner) {
      const winnerNewRating = result.winner === "A" ? ratingAfterA.rating : ratingAfterB.rating;
      const winnerNewRd     = result.winner === "A" ? ratingAfterA.rd     : ratingAfterB.rd;
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
      ratingA: { before: hypA.eloRating, after: ratingAfterA.rating, rd: ratingAfterA.rd },
      ratingB: { before: hypB.eloRating, after: ratingAfterB.rating, rd: ratingAfterB.rd },
    };
  }

  // ─── Position-bias-robust judging ─────────────────────────────────────────
  /**
   * Judge a pair while controlling for LLM position bias.
   *
   * - Simple matches (1 cheap call each) → **swap-and-average**: judge both
   *   A,B and B,A orderings and reconcile (a verdict that flips with order is
   *   downgraded to a draw).
   * - Debate matches (3 expensive reason calls) → a single **seeded-random**
   *   orientation, so doubling the cost is avoided while the *systematic* slot-A
   *   advantage is removed across the tournament.
   *
   * The returned `winner` is always in real A/B terms (hypA = "A").
   */
  private async _judgeMatch(
    hypA: Hypothesis,
    hypB: Hypothesis,
    provenanceA: string,
    provenanceB: string,
    isTopRanked: boolean
  ): Promise<DebateResult> {
    if (isTopRanked) {
      const swapped = rng() < 0.5;
      const raw = swapped
        ? await this._runDebateMatch(hypB, hypA, provenanceB, provenanceA)
        : await this._runDebateMatch(hypA, hypB, provenanceA, provenanceB);
      const winner = mapPresentedVerdict(raw.winner as Verdict, swapped);
      return {
        winner,
        rationale: `[presentation order: ${swapped ? "B,A" : "A,B"}] ${raw.rationale}`,
        transcript: raw.transcript,
      };
    }

    // Cheap path: judge both orderings and reconcile.
    const normal = await this._runSimpleMatch(hypA, hypB, provenanceA, provenanceB);
    const swappedRaw = await this._runSimpleMatch(hypB, hypA, provenanceB, provenanceA);
    const swappedReal = mapPresentedVerdict(swappedRaw.winner as Verdict, true);
    const winner = combineSwappedVerdicts(normal.winner as Verdict, swappedReal);
    return {
      winner,
      rationale:
        `Order-robust verdict: ${winner} (A,B→${normal.winner}; B,A→${swappedReal}).\n\n` +
        `[A,B] ${normal.rationale}\n\n[B,A] ${swappedRaw.rationale}`,
      transcript:
        `=== Orientation A,B ===\n${normal.transcript}\n\n` +
        `=== Orientation B,A ===\n${swappedRaw.transcript}`,
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
    const turn1 = await this.callLLM(system, userPrompt, { maxTokens: 3000 });
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
      { maxTokens: 3000 }
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
      { maxTokens: 2000, jsonMode: true }
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
    const secondary = secondaryPool[rngInt(secondaryPool.length)].hyp;

    return [primary, secondary];
  }
}
