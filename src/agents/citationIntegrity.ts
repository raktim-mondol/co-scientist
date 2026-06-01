import { BaseAgent } from "./base.js";
import type { Hypothesis } from "../models/hypothesis.js";
import { resolveCitation, type FetchFn } from "../tools/citationResolver.js";

/** Maximum rating points subtracted at a 100% (weighted) fabrication rate. */
export const MAX_PENALTY = 150;
/** Maximum RD points added at a 100% (weighted) fabrication rate. */
export const MAX_RD_WIDEN = 100;

/**
 * Pure soft-penalty mapping from citation-integrity counts to a Glicko-2 delta.
 *
 * Weighted fabrication rate f = (fabricated + 0.5 * unverified) / total.
 * `total === 0` ⇒ f = 0 (nothing to fabricate ⇒ no penalty).
 */
export function citationPenalty(counts: {
  total: number;
  unverified: number;
  fabricated: number;
}): { f: number; ratingDelta: number; rdDelta: number } {
  if (counts.total <= 0) return { f: 0, ratingDelta: 0, rdDelta: 0 };
  const f = (counts.fabricated + 0.5 * counts.unverified) / counts.total;
  return {
    f,
    ratingDelta: f > 0 ? -Math.round(f * MAX_PENALTY) : 0,
    rdDelta: Math.round(f * MAX_RD_WIDEN),
  };
}

export class CitationIntegrityAgent extends BaseAgent {
  get agentName() { return "CitationIntegrity"; }

  /** Optional injected fetch — defaults to the resolver's global fetch. */
  private fetchFn?: FetchFn;
  constructor(fetchFn?: FetchFn) {
    super();
    this.fetchFn = fetchFn;
  }

  /**
   * Verify every citation on `hyp`, persist the verdicts, and return the
   * Glicko-2 penalty the caller should fold into the hypothesis rating.
   * Never throws — citation integrity must not block the review pipeline.
   */
  async execute(
    sessionId: string,
    hyp: Hypothesis
  ): Promise<{ f: number; ratingDelta: number; rdDelta: number }> {
    const citations = (hyp.citations ?? []).map((c) => c.trim()).filter(Boolean);
    if (citations.length === 0) return { f: 0, ratingDelta: 0, rdDelta: 0 };

    const resolutions = await Promise.all(
      citations.map((c) => resolveCitation(c, this.fetchFn))
    );

    this.memory.saveCitationVerifications(
      hyp.id,
      sessionId,
      resolutions.map((r) => ({
        rawCitation: r.raw,
        status: r.status,
        canonicalTitle: r.canonicalTitle,
        doi: r.doi,
        authors: r.authors,
        year: r.year,
        matchScore: r.matchScore,
      }))
    );

    const counts = {
      total: resolutions.length,
      unverified: resolutions.filter((r) => r.status === "unverified").length,
      fabricated: resolutions.filter((r) => r.status === "fabricated").length,
    };
    const penalty = citationPenalty(counts);

    const verified = resolutions.length - counts.unverified - counts.fabricated;
    this.log(
      counts.fabricated > 0 ? "warn" : "info",
      `Citations for "${hyp.title}": ${verified} verified, ${counts.unverified} unverified, ` +
      `${counts.fabricated} fabricated (penalty ${penalty.ratingDelta}, RD +${penalty.rdDelta})`
    );
    return penalty;
  }
}
