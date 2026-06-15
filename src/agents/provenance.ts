import { BaseAgent } from "./base.js";
import type { Hypothesis } from "../models/hypothesis.js";
import type { SearchResult } from "../tools/search.js";

interface ClaimVerdict {
  claimText: string;
  paperTitle: string;
  paperUrl: string;
  paperAuthors: string;
  paperYear?: number;
  paperAbstract: string;
  support: "supports" | "contradicts" | "unaddressed";
  confidence: number;
}

export class ProvenanceAgent extends BaseAgent {
  get agentName() { return "Provenance"; }

  /**
   * Run provenance check for a single hypothesis.
   * Called by ReflectionAgent after full_review passes.
   */
  async execute(sessionId: string, hyp: Hypothesis): Promise<void> {
    // Step 1: Extract discrete factual claims from the hypothesis
    const claims = await this._extractClaims(hyp);
    if (claims.length === 0) {
      this.log("debug", `No claims extracted for "${hyp.title}"`);
      return;
    }

    this.log("info", `Verifying ${claims.length} claims for "${hyp.title}"`);

    // Step 2: For each claim, find the best supporting paper and verify
    const verdicts: ClaimVerdict[] = [];
    for (const claim of claims) {
      const verdict = await this._verifyClaim(claim);
      verdicts.push(verdict);
    }

    // Step 3: Persist
    this.memory.saveClaimCitations(hyp.id, sessionId, verdicts);

    const flagged = verdicts.filter(v => v.support !== "supports").length;
    this.log(
      flagged > 0 ? "warn" : "info",
      `Provenance: ${verdicts.length - flagged}/${verdicts.length} claims supported` +
      (flagged > 0 ? ` — ${flagged} flagged` : "") +
      ` for "${hyp.title}"`
    );
  }

  // ─── Step 1: Extract claims ───────────────────────────────────────────────

  private async _extractClaims(hyp: Hypothesis): Promise<string[]> {
    const system = "You are a scientific fact extractor. Output ONLY a raw JSON object with no prose, no markdown, no explanation.";
    const userPrompt =
      `Extract the 3-6 most specific, verifiable factual claims from this hypothesis. ` +
      `Each claim must be a single sentence independently verifiable against a research paper.\n\n` +
      `TITLE: ${hyp.title}\nCONTENT: ${hyp.content}\nRATIONALE: ${hyp.rationale}\n\n` +
      `Output ONLY this json object and nothing else:\n{"claims": ["claim 1", "claim 2", ...]}`;

    const response = await this.callLLM(system, userPrompt, { maxTokens: 512, jsonMode: true });
    let parsed = this.extractJSON<{ claims: string[] }>(response.content);

    // Fallback: re-prompt with ultra-strict extraction if JSON parsing failed
    if (!parsed?.claims?.length) {
      const fallbackResponse = await this.callLLM(
        "You are a JSON extractor. Output ONLY a raw JSON object, no explanation, no markdown.",
        `Extract the factual claims from the text below and return ONLY valid JSON in this exact format:\n{"claims": ["<first claim>", "<second claim>", ...]}\n\nReplace the placeholders with the actual claim sentences from the text. Do not include any explanation.\n\nText:\n${response.content}`,
        { maxTokens: 512, jsonMode: true }
      );
      parsed = this.extractJSON<{ claims: string[] }>(fallbackResponse.content);
    }

    return parsed?.claims?.slice(0, 6) ?? [];
  }

  // ─── Step 2: Verify a single claim against literature ────────────────────

  private async _verifyClaim(claim: string): Promise<ClaimVerdict> {
    // Search Consensus for the most relevant paper
    const results = await this.search.searchAcademic(claim, { maxResults: 3 });

    if (results.length === 0) {
      return {
        claimText: claim,
        paperTitle: "",
        paperUrl: "",
        paperAuthors: "",
        paperAbstract: "",
        support: "unaddressed",
        confidence: 0,
      };
    }

    // Pick the top result — Consensus ranks by relevance
    const paper = results[0];
    const support = await this._checkSupport(claim, paper);
    return {
      claimText: claim,
      paperTitle: paper.title,
      paperUrl: paper.url,
      paperAuthors: paper.authors?.join(", ") ?? "",
      paperYear: paper.year,
      paperAbstract: paper.snippet,
      ...support,
    };
  }

  // ─── Step 3: LLM consistency check ───────────────────────────────────────

  private async _checkSupport(
    claim: string,
    paper: SearchResult
  ): Promise<{ support: "supports" | "contradicts" | "unaddressed"; confidence: number }> {
    const system = "You are a scientific fact-checker. Output ONLY a raw JSON object with no prose, no markdown, no explanation.";
    const userPrompt =
      `CLAIM: ${claim}\n\n` +
      `PAPER: ${paper.title}\n` +
      `AUTHORS: ${paper.authors?.join(", ") ?? "Unknown"} (${paper.year ?? "n/d"})\n` +
      `ABSTRACT: ${paper.snippet}\n\n` +
      `Output ONLY this json object and nothing else:\n` +
      `{"support":"supports"|"contradicts"|"unaddressed","confidence":0.0,"reason":"one sentence"}`;

    const response = await this.callLLM(system, userPrompt, { maxTokens: 512, jsonMode: true });

    const parsed = this.extractJSON<{
      support: "supports" | "contradicts" | "unaddressed";
      confidence: number;
    }>(response.content);

    return {
      support: parsed?.support ?? "unaddressed",
      confidence: parsed?.confidence ?? 0,
    };
  }
}
