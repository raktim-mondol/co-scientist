import { BaseAgent } from "./base.js";
import type { EvidenceSource } from "../models/evidence.js";

export interface PlanDecision {
  sufficient: boolean;
  gaps: string[];
  urlsToRead: string[];
  nextQueries: string[];
}

export interface ResearchOutcome {
  digest: string;
  sources: EvidenceSource[];
}

/** Canonical URL form used for evidence dedupe: lowercase host, no hash, no trailing slash. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return url;
  }
}

/** Numbered [E#] digest consumed by the literature_exploration prompt. */
export function formatEvidenceDigest(sources: EvidenceSource[]): string {
  if (sources.length === 0) return "No evidence gathered.";
  return sources
    .map((s, i) => {
      const date = s.publishedDate ? ` (${s.publishedDate})` : "";
      const excerpt = s.evidence.length > 600 ? `${s.evidence.slice(0, 600)}…` : s.evidence;
      return `[E${i + 1}] ${s.title} — ${s.url}${date}\n   Summary: ${s.summary}\n   Key evidence: ${excerpt}`;
    })
    .join("\n\n");
}

/** Round control: hard cap, sufficiency, and candidate availability. */
export function shouldContinue(
  round: number,
  maxRounds: number,
  sufficient: boolean,
  haveCandidates: boolean
): boolean {
  return round <= maxRounds && !sufficient && haveCandidates;
}

/** Map "E1"/"[E1]" citation markers back to source URLs; pass everything else through. */
export function resolveCitationMarkers(citations: string[], sources: EvidenceSource[]): string[] {
  return citations.map((c) => {
    const m = c.trim().match(/^\[?E(\d+)\]?$/i);
    if (!m) return c;
    const idx = parseInt(m[1], 10) - 1;
    return sources[idx]?.url ?? c;
  });
}

/**
 * Bounded DeepResearch-style literature loop: search → plan → read → bank.
 * Invoked inline by GenerationAgent (same pattern as ProvenanceAgent in reflection).
 * Never throws on external failures — returns null so callers fall back to snippets.
 */
export class LiteratureResearchAgent extends BaseAgent {
  get agentName() { return "LiteratureResearch"; }

  async research(
    sessionId: string,
    goal: string,
    initialQueries: string[]
  ): Promise<ResearchOutcome | null> {
    const cfg = this.config.research;
    if (cfg.maxRounds <= 0) return null;

    // Build on evidence banked by earlier generation tasks in this session.
    const collected: EvidenceSource[] = this.memory.getEvidenceBySession(sessionId);
    const newlyCollected: EvidenceSource[] = [];
    let queries = initialQueries.slice(0, 3);
    let gaps: string[] = [];

    for (let round = 1; round <= cfg.maxRounds; round++) {
      if (queries.length === 0) break;

      // 1. Search
      const results = await this.search.multiSearch(queries, "auto");
      const seen = new Set<string>();
      const candidates = results.filter((r) => {
        if (!r.url) return false;
        const norm = normalizeUrl(r.url);
        if (seen.has(norm) || this.memory.hasVisitedUrl(sessionId, norm)) return false;
        seen.add(norm);
        return true;
      });
      if (candidates.length === 0) break;

      // 2. Plan
      const { system, userPrompt, maxTokens } = this.loadPrompt("research", "plan", {
        researchGoal: goal,
        evidenceDigest: formatEvidenceDigest(collected),
        gaps: gaps.join("\n"),
        candidates: candidates
          .map((c) => `- ${c.title} — ${c.url}\n  ${c.snippet.slice(0, 200)}`)
          .join("\n"),
        urlsPerRound: cfg.urlsPerRound,
      });
      const plan = await this.callLLMForJSON<PlanDecision>(system, userPrompt, {
        mode: "chat",
        maxTokens,
      });
      if (!plan) break;
      if (!shouldContinue(round, cfg.maxRounds, plan.sufficient && collected.length > 0, true)) break;

      // 3. Read — only URLs that are real candidates; fall back to top candidates
      const candidateUrls = new Set(candidates.map((c) => normalizeUrl(c.url)));
      let toRead = (plan.urlsToRead ?? [])
        .map(normalizeUrl)
        .filter((u) => candidateUrls.has(u))
        .slice(0, cfg.urlsPerRound);
      if (toRead.length === 0) {
        toRead = candidates.slice(0, cfg.urlsPerRound).map((c) => normalizeUrl(c.url));
      }
      const pages = await this.search.extractPages(toRead, goal, {
        maxCharsPerPage: cfg.maxContentChars,
      });

      // 4. Extract + bank (per-source failures are skipped)
      for (const page of pages) {
        const ext = this.loadPrompt("research", "extract", {
          pageContent: page.content,
          goal,
        });
        const extracted = await this.callLLMForJSON<{
          rationale: string;
          evidence: string;
          summary: string;
        }>(ext.system, ext.userPrompt, { mode: "chat", maxTokens: ext.maxTokens });
        if (!extracted?.summary?.trim()) {
          this.log("warn", `Extraction failed for ${page.url} — skipping source`);
          continue;
        }
        let embedding: number[] | undefined;
        try {
          [embedding] = await this.llm.embed([extracted.summary]);
        } catch {
          embedding = undefined; // evidence is still useful without an embedding
        }
        const saved = this.memory.saveEvidence(
          {
            sessionId,
            url: normalizeUrl(page.url),
            title: page.title,
            doi: undefined,
            publishedDate: page.publishedDate,
            goal,
            rationale: extracted.rationale ?? "",
            evidence: extracted.evidence ?? "",
            summary: extracted.summary,
            round,
          },
          embedding
        );
        collected.push(saved);
        newlyCollected.push(saved);
      }

      gaps = plan.gaps ?? [];
      queries = (plan.nextQueries ?? []).slice(0, 3);
    }

    if (newlyCollected.length === 0 && collected.length === 0) return null;
    this.log(
      "info",
      `Evidence bank: +${newlyCollected.length} new source(s), ${collected.length} total for session`
    );
    return { digest: formatEvidenceDigest(collected), sources: collected };
  }
}
