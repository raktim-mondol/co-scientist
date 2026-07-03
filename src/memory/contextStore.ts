// ContextStore — facade over the domain stores.
//
// Phase 2 of the clean-architecture refactor split this once-monolithic data
// access layer into focused domain stores (session, hypothesis, review,
// tournament, embedding, knowledge-graph, provenance, evidence, safety,
// activity, feedback). This class is now a thin composite that instantiates
// them and delegates every public method — so the 400+ call sites that use
// `getContextStore().*` keep working unchanged.
//
// All query logic lives in src/memory/stores/*.ts; this file only wires it up.

import { v4 as uuidv4 } from "uuid";
import { registerDbCloseHook, getDb, getSqlite } from "../db/index.js";
import type { Hypothesis } from "../models/hypothesis.js";
import type { HypothesisReview } from "../models/hypothesis.js";
import type { TournamentMatch } from "../models/tournament.js";
import type { CoScientistSession, SessionStats } from "../models/session.js";
import type { ResearchGoal, ResearchPlanConfig } from "../models/researchGoal.js";
import type { AgentTask } from "../models/agentTask.js";
import type { ExperimentalFeedback } from "../models/feedback.js";
import type { EvidenceSource } from "../models/evidence.js";

import { SessionStore } from "./stores/sessionStore.js";
import { HypothesisStore } from "./stores/hypothesisStore.js";
import { ReviewStore } from "./stores/reviewStore.js";
import { TournamentStore } from "./stores/tournamentStore.js";
import { EmbeddingStore } from "./stores/embeddingStore.js";
import { KnowledgeGraphStore } from "./stores/knowledgeGraphStore.js";
import { ProvenanceStore } from "./stores/provenanceStore.js";
import { EvidenceStore } from "./stores/evidenceStore.js";
import { SafetyStore, type SafetyAssessmentRow } from "./stores/safetyStore.js";
import { ActivityStore } from "./stores/activityStore.js";
import { FeedbackStore } from "./stores/feedbackStore.js";
import { ManuscriptStore } from "./stores/manuscriptStore.js";
import type { Manuscript } from "../models/manuscript.js";

export type { SafetyAssessmentRow };

export class ContextStore {
  // Raw handles — retained for backwards compatibility in case any caller
  // reaches for them, though the domain stores own their own handles.
  private db = getDb();
  private sqlite = getSqlite();

  private sessionStore = new SessionStore();
  private hypothesisStore = new HypothesisStore();
  private reviewStore = new ReviewStore();
  private tournamentStore = new TournamentStore();
  private embeddingStore = new EmbeddingStore();
  private knowledgeGraphStore = new KnowledgeGraphStore();
  private provenanceStore = new ProvenanceStore();
  private evidenceStore = new EvidenceStore();
  private safetyStore = new SafetyStore(this.hypothesisStore);
  private activityStore = new ActivityStore();
  private feedbackStore = new FeedbackStore();
  private manuscriptStore = new ManuscriptStore();

  // ─── Sessions ─────────────────────────────────────────────────────────────

  createSession(name: string, goal: ResearchGoal): string {
    return this.sessionStore.createSession(name, goal);
  }
  getSession(id: string): CoScientistSession | null {
    return this.sessionStore.getSession(id);
  }
  resolveSession(identifier: string): CoScientistSession | null {
    return this.sessionStore.resolveSession(identifier);
  }
  cleanupStaleSessions(): number {
    return this.sessionStore.cleanupStaleSessions();
  }
  getResearchGoal(sessionId: string): ResearchGoal | null {
    return this.sessionStore.getResearchGoal(sessionId);
  }
  listSessions(): CoScientistSession[] {
    return this.sessionStore.listSessions();
  }
  countTournamentMatches(sessionId: string): number {
    return this.sessionStore.countTournamentMatches(sessionId);
  }
  deleteSession(id: string): void {
    return this.sessionStore.deleteSession(id);
  }
  updateSessionStatus(id: string, status: string): void {
    return this.sessionStore.updateSessionStatus(id, status);
  }
  updateSessionStats(id: string, stats: SessionStats): void {
    return this.sessionStore.updateSessionStats(id, stats);
  }
  savePlanConfig(sessionId: string, config: ResearchPlanConfig): void {
    return this.sessionStore.savePlanConfig(sessionId, config);
  }
  saveMetaReviewCritique(sessionId: string, critique: string): void {
    return this.sessionStore.saveMetaReviewCritique(sessionId, critique);
  }
  saveResearchOverview(sessionId: string, overview: string): void {
    return this.sessionStore.saveResearchOverview(sessionId, overview);
  }
  getMetaReviewCritique(sessionId: string): string | null {
    return this.sessionStore.getMetaReviewCritique(sessionId);
  }
  getPlanConfig(sessionId: string): ResearchPlanConfig | null {
    return this.sessionStore.getPlanConfig(sessionId);
  }
  saveManuscript(sessionId: string, manuscript: Manuscript): void {
    return this.manuscriptStore.saveManuscript(sessionId, manuscript);
  }
  getManuscript(sessionId: string): Manuscript | null {
    return this.manuscriptStore.getManuscript(sessionId);
  }

  // ─── Hypotheses ───────────────────────────────────────────────────────────

  saveHypothesis(hyp: Omit<Hypothesis, "id" | "createdAt" | "updatedAt">): Hypothesis {
    return this.hypothesisStore.saveHypothesis(hyp);
  }
  updateHypothesisRating(
    id: string, rating: number, rd: number, volatility: number,
    wins: number, losses: number, matchesPlayed: number, draws: number = 0
  ): void {
    return this.hypothesisStore.updateHypothesisRating(id, rating, rd, volatility, wins, losses, matchesPlayed, draws);
  }
  atomicGlicko2Update(
    id: string,
    compute: (current: { rating: number; rd: number; volatility: number; wins: number; losses: number; draws: number; matchesPlayed: number }) => { rating: number; rd: number; volatility: number; wins: number; losses: number; draws: number; matchesPlayed: number }
  ): void {
    return this.hypothesisStore.atomicGlicko2Update(id, compute);
  }
  atomicDualGlicko2Update(
    idA: string, idB: string,
    compute: (
      stateA: { rating: number; rd: number; volatility: number; wins: number; losses: number; draws: number; matchesPlayed: number },
      stateB: { rating: number; rd: number; volatility: number; wins: number; losses: number; draws: number; matchesPlayed: number }
    ) => {
      newA: { rating: number; rd: number; volatility: number; wins: number; losses: number; draws: number; matchesPlayed: number };
      newB: { rating: number; rd: number; volatility: number; wins: number; losses: number; draws: number; matchesPlayed: number };
    }
  ): void {
    return this.hypothesisStore.atomicDualGlicko2Update(idA, idB, compute);
  }
  updateHypothesisStatus(id: string, status: string): void {
    return this.hypothesisStore.updateHypothesisStatus(id, status);
  }
  resetStuckReviewingHypotheses(sessionId: string): void {
    return this.hypothesisStore.resetStuckReviewingHypotheses(sessionId);
  }
  getHypothesis(id: string): Hypothesis | null {
    return this.hypothesisStore.getHypothesis(id);
  }
  getHypothesisStatusAndElo(id: string): { sessionId: string; status: string; eloRating: number } | null {
    return this.hypothesisStore.getHypothesisStatusAndElo(id);
  }
  getTopHypotheses(sessionId: string, n = 10): Hypothesis[] {
    return this.hypothesisStore.getTopHypotheses(sessionId, n);
  }
  getTopEloRatings(sessionId: string, n = 10): number[] {
    return this.hypothesisStore.getTopEloRatings(sessionId, n);
  }
  getAllActiveHypotheses(sessionId: string): Hypothesis[] {
    return this.hypothesisStore.getAllActiveHypotheses(sessionId);
  }
  getPendingReviewHypotheses(sessionId: string, limit = 5): Hypothesis[] {
    return this.hypothesisStore.getPendingReviewHypotheses(sessionId, limit);
  }
  countHypotheses(sessionId: string): { total: number; active: number; pending: number } {
    return this.hypothesisStore.countHypotheses(sessionId);
  }
  saveExperimentProtocol(hypothesisId: string, protocol: Record<string, unknown>): void {
    return this.hypothesisStore.saveExperimentProtocol(hypothesisId, protocol);
  }
  getExperimentProtocol(hypothesisId: string): Record<string, unknown> | null {
    return this.hypothesisStore.getExperimentProtocol(hypothesisId);
  }

  // ─── Reviews ──────────────────────────────────────────────────────────────

  saveReview(review: Omit<HypothesisReview, "id" | "createdAt">): void {
    return this.reviewStore.saveReview(review);
  }
  getAvgScoresForSession(sessionId: string): Record<string, { novelty: number | null; correctness: number | null; testability: number | null }> {
    return this.reviewStore.getAvgScoresForSession(sessionId);
  }
  getReviews(hypothesisId: string): HypothesisReview[] {
    return this.reviewStore.getReviews(hypothesisId);
  }

  // ─── Tournament ───────────────────────────────────────────────────────────

  saveTournamentMatch(match: Omit<TournamentMatch, "id" | "createdAt">): void {
    return this.tournamentStore.saveTournamentMatch(match);
  }
  getRecentMatches(sessionId: string, limit = 50): TournamentMatch[] {
    return this.tournamentStore.getRecentMatches(sessionId, limit);
  }

  // ─── Proximity ────────────────────────────────────────────────────────────

  saveProximityEdge(
    sessionId: string,
    hypAId: string,
    hypBId: string,
    score: number
  ): void {
    return this.tournamentStore.saveProximityEdge(sessionId, hypAId, hypBId, score);
  }
  getSimilarHypotheses(hypothesisId: string, k = 5): string[] {
    return this.tournamentStore.getSimilarHypotheses(hypothesisId, k);
  }

  // ─── Embeddings ────────────────────────────────────────────────────────────

  saveEmbedding(hypothesisId: string, embedding: number[]): void {
    return this.embeddingStore.saveEmbedding(hypothesisId, embedding);
  }
  getEmbedding(hypothesisId: string): number[] | null {
    return this.embeddingStore.getEmbedding(hypothesisId);
  }
  deleteEmbedding(hypothesisId: string): void {
    return this.embeddingStore.deleteEmbedding(hypothesisId);
  }
  findSimilarByVector(
    queryEmbedding: number[],
    limit = 20
  ): Array<{ hypothesisId: string; distance: number }> {
    return this.embeddingStore.findSimilarByVector(queryEmbedding, limit);
  }

  // ─── Knowledge Graph ─────────────────────────────────────────────────────

  upsertKgNode(id: string, sessionId: string, type: string, label: string, hypothesisId?: string): void {
    return this.knowledgeGraphStore.upsertKgNode(id, sessionId, type, label, hypothesisId);
  }
  upsertKgEdge(id: string, sessionId: string, fromNodeId: string, toNodeId: string, relation: string): void {
    return this.knowledgeGraphStore.upsertKgEdge(id, sessionId, fromNodeId, toNodeId, relation);
  }
  getKgNodes(sessionId: string): Array<typeof import("../db/schema.js").kgNodes.$inferSelect> {
    return this.knowledgeGraphStore.getKgNodes(sessionId);
  }
  getKgEdges(sessionId: string): Array<typeof import("../db/schema.js").kgEdges.$inferSelect> {
    return this.knowledgeGraphStore.getKgEdges(sessionId);
  }

  // ─── Provenance ───────────────────────────────────────────────────────────

  saveClaimCitations(
    hypothesisId: string,
    sessionId: string,
    claims: Array<{
      claimText: string;
      paperTitle: string;
      paperUrl: string;
      paperAuthors: string;
      paperYear?: number;
      paperAbstract: string;
      support: "supports" | "contradicts" | "unaddressed";
      confidence: number;
    }>
  ): void {
    return this.provenanceStore.saveClaimCitations(hypothesisId, sessionId, claims);
  }
  getClaimCitations(hypothesisId: string): Array<typeof import("../db/schema.js").claimCitations.$inferSelect> {
    return this.provenanceStore.getClaimCitations(hypothesisId);
  }
  hasProvenanceFlag(hypothesisId: string): boolean {
    return this.provenanceStore.hasProvenanceFlag(hypothesisId);
  }
  saveCitationVerifications(
    hypothesisId: string,
    sessionId: string,
    rows: Array<{
      rawCitation: string;
      status: "verified" | "unverified" | "fabricated";
      canonicalTitle?: string;
      doi?: string;
      authors?: string;
      year?: number;
      matchScore: number;
    }>
  ): void {
    return this.provenanceStore.saveCitationVerifications(hypothesisId, sessionId, rows);
  }
  getCitationVerifications(
    hypothesisId: string
  ): Array<{
    rawCitation: string;
    status: "verified" | "unverified" | "fabricated";
    canonicalTitle: string | null;
    doi: string | null;
    authors: string | null;
    year: number | null;
    matchScore: number;
  }> {
    return this.provenanceStore.getCitationVerifications(hypothesisId);
  }
  getCitationIntegrity(hypothesisId: string): {
    total: number; verified: number; unverified: number; fabricated: number; fabricationRate: number;
  } {
    return this.provenanceStore.getCitationIntegrity(hypothesisId);
  }

  // ─── Evidence Bank (Deep Evidence Pipeline) ──────────────────────────────────

  saveEvidence(
    ev: Omit<EvidenceSource, "id" | "createdAt">,
    embedding?: number[]
  ): EvidenceSource {
    return this.evidenceStore.saveEvidence(ev, embedding);
  }
  getEvidenceBySession(sessionId: string): EvidenceSource[] {
    return this.evidenceStore.getEvidenceBySession(sessionId);
  }
  hasVisitedUrl(sessionId: string, url: string): boolean {
    return this.evidenceStore.hasVisitedUrl(sessionId, url);
  }
  getRelevantEvidence(sessionId: string, embedding: number[], k: number): EvidenceSource[] {
    return this.evidenceStore.getRelevantEvidence(sessionId, embedding, k);
  }

  // ─── Safety Assessments (Safety Gate) ─────────────────────────────────────

  saveSafetyAssessment(
    hypothesisId: string,
    sessionId: string,
    a: { severity: string; category: string; reasoning: string; decision: string; threshold: string }
  ): void {
    return this.safetyStore.saveSafetyAssessment(hypothesisId, sessionId, a);
  }
  getLatestSafetyAssessment(hypothesisId: string): SafetyAssessmentRow | null {
    return this.safetyStore.getLatestSafetyAssessment(hypothesisId);
  }
  getQuarantinedHypotheses(sessionId: string): Hypothesis[] {
    return this.safetyStore.getQuarantinedHypotheses(sessionId);
  }
  releaseQuarantine(hypothesisId: string, overriddenBy: string, reason: string): boolean {
    return this.safetyStore.releaseQuarantine(hypothesisId, overriddenBy, reason);
  }

  // ─── Agent Tasks ─────────────────────────────────────────────────────────

  logTask(task: Omit<AgentTask, "id" | "createdAt">): void {
    return this.activityStore.logTask(task);
  }
  getTokensByAgent(sessionId: string): Record<string, number> {
    return this.activityStore.getTokensByAgent(sessionId);
  }
  countCompletedTasksByType(sessionId: string, type: string): number {
    return this.activityStore.countCompletedTasksByType(sessionId, type);
  }
  countAllCompletedTasksByType(sessionId: string): Record<string, number> {
    return this.activityStore.countAllCompletedTasksByType(sessionId);
  }

  // ─── Experimental Feedback (RLEF) ────────────────────────────────────────

  saveExperimentalFeedback(feedback: ExperimentalFeedback): void {
    return this.feedbackStore.saveExperimentalFeedback(feedback);
  }
  getExperimentalFeedback(hypothesisId: string): ExperimentalFeedback[] {
    return this.feedbackStore.getExperimentalFeedback(hypothesisId);
  }
  getAllFeedbackForSession(sessionId: string): ExperimentalFeedback[] {
    return this.feedbackStore.getAllFeedbackForSession(sessionId);
  }

  // ─── Session Activity Log ─────────────────────────────────────────────────

  logActivity(params: {
    id: string;
    sessionId: string;
    agent: string;
    type: string;
    message: string;
    detailJson?: string;
    tokensIn?: number;
    tokensOut?: number;
  }): void {
    return this.activityStore.logActivity(params);
  }
  getSessionActivity(sessionId: string): Array<{
    id: string;
    agent: string;
    type: string;
    message: string;
    detailJson: string | null;
    tokensIn: number | null;
    tokensOut: number | null;
    createdAt: Date;
  }> {
    return this.activityStore.getSessionActivity(sessionId);
  }
}

// Singleton
let _store: ContextStore | null = null;

export function getContextStore(): ContextStore {
  if (!_store) _store = new ContextStore();
  return _store;
}

export function resetContextStore(): void {
  _store = null;
}

// Register cleanup on DB close — replaces the old deferred import in closeDb().
registerDbCloseHook(resetContextStore);

// Re-export uuidv4 for any legacy callers that imported it from this module.
export { uuidv4 };