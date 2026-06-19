import type { ContextStore } from "../memory/contextStore.js";
import type { Hypothesis } from "../models/hypothesis.js";

/** Reject a hypothesis so the supervisor stops scheduling work on it. */
export function killHypothesis(memory: ContextStore, hypothesisId: string): void {
  memory.updateHypothesisStatus(hypothesisId, "rejected");
}

/**
 * Set a hypothesis's Elo to an absolute value using the atomic Glicko-2 path,
 * so a concurrent tournament write cannot clobber it.
 */
export function boostHypothesis(memory: ContextStore, hypothesisId: string, newElo: number): void {
  memory.atomicGlicko2Update(hypothesisId, (c) => ({ ...c, rating: newElo }));
}

export interface InjectInput {
  sessionId: string;
  title: string;
  summary: string;
  content: string;
  generationRound: number;
}

/**
 * Insert a human-authored hypothesis as `pending_review` so it goes through the
 * normal reflection + provenance pipeline before competing.
 */
export function injectHypothesis(memory: ContextStore, input: InjectInput): Hypothesis {
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title || !content) {
    throw new Error("Injected hypothesis requires a non-empty title and content");
  }
  return memory.saveHypothesis({
    sessionId: input.sessionId,
    title,
    summary: input.summary.trim() || title,
    content,
    rationale: "Manually injected by operator during run.",
    keyAssumptions: [],
    citations: [],
    generationStrategy: "manual_injection",
    eloRating: 1200,
    ratingDeviation: 350,
    volatility: 0.06,
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    status: "pending_review",
    parentIds: [],
    generationRound: input.generationRound,
  });
}
