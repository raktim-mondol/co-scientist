import {
  sqliteTable,
  text,
  integer,
  real,
  blob,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ─── Sessions ────────────────────────────────────────────────────────────────
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("initializing"),
  researchGoalJson: text("research_goal_json").notNull(),
  planConfigJson: text("plan_config_json"),
  statsJson: text("stats_json").notNull().default("{}"),
  metaReviewCritique: text("meta_review_critique"),
  researchOverview: text("research_overview"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

// ─── Hypotheses ───────────────────────────────────────────────────────────────
export const hypotheses = sqliteTable("hypotheses", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  content: text("content").notNull(),
  rationale: text("rationale").notNull(),
  experimentalPlan: text("experimental_plan"),
  experimentProtocolJson: text("experiment_protocol_json"),
  noveltyAssessment: text("novelty_assessment"),
  keyAssumptionsJson: text("key_assumptions_json").notNull().default("[]"),
  citationsJson: text("citations_json").notNull().default("[]"),
  generationStrategy: text("generation_strategy").notNull(),
  eloRating: real("elo_rating").notNull().default(1200),     // Glicko-2 rating (μ), same scale
  ratingDeviation: real("rating_deviation").notNull().default(350), // Glicko-2 RD (φ)
  volatility: real("volatility").notNull().default(0.06),           // Glicko-2 σ
  matchesPlayed: integer("matches_played").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  status: text("status").notNull().default("pending_review"),
  parentIdsJson: text("parent_ids_json").notNull().default("[]"),
  generationRound: integer("generation_round").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ─── Reviews ──────────────────────────────────────────────────────────────────
export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  hypothesisId: text("hypothesis_id").notNull().references(() => hypotheses.id),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  type: text("type").notNull(),
  verdict: text("verdict").notNull(),
  noveltyScore: real("novelty_score"),
  correctnessScore: real("correctness_score"),
  testabilityScore: real("testability_score"),
  safetyFlag: integer("safety_flag", { mode: "boolean" }).notNull().default(false),
  summary: text("summary").notNull(),
  critique: text("critique").notNull(),
  supportingEvidenceJson: text("supporting_evidence_json").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ─── Tournament Matches ───────────────────────────────────────────────────────
export const tournamentMatches = sqliteTable("tournament_matches", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  hypothesisAId: text("hypothesis_a_id").notNull().references(() => hypotheses.id),
  hypothesisBId: text("hypothesis_b_id").notNull().references(() => hypotheses.id),
  matchType: text("match_type").notNull(),
  result: text("result").notNull(),
  winnerEloAfter: real("winner_elo_after").notNull(),
  loserEloAfter: real("loser_elo_after").notNull(),
  debateTranscript: text("debate_transcript"),
  rationale: text("rationale").notNull(),
  round: integer("round").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ─── Proximity Edges ─────────────────────────────────────────────────────────
export const proximityEdges = sqliteTable("proximity_edges", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  hypothesisAId: text("hypothesis_a_id").notNull().references(() => hypotheses.id),
  hypothesisBId: text("hypothesis_b_id").notNull().references(() => hypotheses.id),
  similarityScore: real("similarity_score").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (t) => ({
  uniquePair: uniqueIndex("proximity_edges_pair_unique").on(t.hypothesisAId, t.hypothesisBId),
}));

// ─── Agent Task Log ───────────────────────────────────────────────────────────
export const agentTasks = sqliteTable("agent_tasks", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  priority: integer("priority").notNull().default(5),
  payloadJson: text("payload_json").notNull().default("{}"),
  resultJson: text("result_json"),
  error: text("error"),
  tokensUsed: integer("tokens_used").notNull().default(0),
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ─── Knowledge Graph ──────────────────────────────────────────────────────────
export const kgNodes = sqliteTable("kg_nodes", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  type: text("type").notNull(), // 'hypothesis' | 'concept' | 'citation'
  label: text("label").notNull(),
  hypothesisId: text("hypothesis_id"), // set when type = 'hypothesis'
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const kgEdges = sqliteTable("kg_edges", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  fromNodeId: text("from_node_id").notNull(),
  toNodeId: text("to_node_id").notNull(),
  relation: text("relation").notNull(), // 'evolved_from' | 'related_to' | 'supports' | 'contradicts'
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ─── Claim Citations (Provenance) ─────────────────────────────────────────────
export const claimCitations = sqliteTable("claim_citations", {
  id: text("id").primaryKey(),
  hypothesisId: text("hypothesis_id").notNull().references(() => hypotheses.id),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  claimText: text("claim_text").notNull(),
  paperTitle: text("paper_title").notNull(),
  paperUrl: text("paper_url").notNull(),
  paperAuthors: text("paper_authors").notNull().default(""),
  paperYear: integer("paper_year"),
  paperAbstract: text("paper_abstract").notNull().default(""),
  support: text("support").notNull(), // 'supports' | 'contradicts' | 'unaddressed'
  confidence: real("confidence").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ─── Embeddings Cache ─────────────────────────────────────────────────────────
// Stores the raw Float32Array blob for fast retrieval without re-running inference.
// A parallel sqlite-vec virtual table `vec_embeddings` (FLOAT[384]) is created in
// migrate.ts for indexed KNN / ANN queries — it is not modelled here because Drizzle
// does not support virtual tables; access it via getSqlite() raw prepared statements.
export const embeddingCache = sqliteTable("embedding_cache", {
  hypothesisId: text("hypothesis_id")
    .primaryKey()
    .references(() => hypotheses.id),
  embeddingBlob: blob("embedding_blob").notNull(), // Float32Array as buffer
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
