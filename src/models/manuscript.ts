// Manuscript — the structured, publication-style artifact produced by ReportAgent
// from a completed session. Narrative sections (abstract/background/discussion/
// limitations) are LLM-synthesized; methods, results, and references are assembled
// deterministically from the DB so citations and numbers stay honest.

export type CitationStatus = "verified" | "unverified" | "fabricated";

/** One numbered entry in the global, de-duplicated bibliography. */
export interface BibEntry {
  n: number; // reference number, rendered inline as [n]
  raw: string; // original raw citation (first-seen form)
  canonicalTitle?: string;
  doi?: string;
  authors?: string;
  year?: number;
  status: CitationStatus;
}

export interface ManuscriptProtocol {
  overview: string;
  steps: { step: number; action: string; details: string }[];
  timelineWeeks: number | string;
  costTier: string;
}

export interface ManuscriptHypothesis {
  rank: number;
  id: string;
  title: string;
  summary: string;
  content: string;
  rationale: string;
  keyAssumptions: string[];
  eloRating: number;
  ratingDeviation: number;
  wins: number;
  losses: number;
  /** [n] reference numbers cited by this hypothesis, ascending. */
  citationMarkers: number[];
  noveltyScore?: number | null;
  correctnessScore?: number | null;
  testabilityScore?: number | null;
  verdict?: string | null;
  protocol?: ManuscriptProtocol | null;
}

export interface ManuscriptMethods {
  model: string;
  seed: number | null;
  rounds: number;
  totalHypotheses: number;
  totalMatches: number;
  budgetTokens: number;
  agents: string[];
}

export interface Manuscript {
  sessionId: string;
  sessionName: string;
  title: string;
  generatedAt: string; // ISO timestamp
  researchGoal: string;
  domain?: string;
  // LLM-synthesized narrative
  abstract: string;
  background: string;
  discussion: string;
  limitations: string;
  // deterministic
  methods: ManuscriptMethods;
  hypotheses: ManuscriptHypothesis[];
  references: BibEntry[];
}
