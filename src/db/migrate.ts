import { getDb, getSqlite, schema } from "./index.js";
import { sql } from "drizzle-orm";

/**
 * Run inline schema creation (create tables if not exist).
 * We use raw SQL for portability since we're not using Drizzle migrations in CLI mode.
 */
export async function runMigrations() {
  const db = getDb();

  db.run(sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'initializing',
      research_goal_json TEXT NOT NULL,
      plan_config_json TEXT,
      stats_json TEXT NOT NULL DEFAULT '{}',
      meta_review_critique TEXT,
      research_overview TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS hypotheses (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      content TEXT NOT NULL,
      rationale TEXT NOT NULL,
      experimental_plan TEXT,
      novelty_assessment TEXT,
      key_assumptions_json TEXT NOT NULL DEFAULT '[]',
      citations_json TEXT NOT NULL DEFAULT '[]',
      generation_strategy TEXT NOT NULL,
      elo_rating REAL NOT NULL DEFAULT 1200,
      rating_deviation REAL NOT NULL DEFAULT 350,
      volatility REAL NOT NULL DEFAULT 0.06,
      matches_played INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      experiment_protocol_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending_review',
      parent_ids_json TEXT NOT NULL DEFAULT '[]',
      generation_round INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_hypotheses_session ON hypotheses(session_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_hypotheses_elo ON hypotheses(session_id, elo_rating DESC)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_hypotheses_status ON hypotheses(session_id, status)`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      hypothesis_id TEXT NOT NULL REFERENCES hypotheses(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      type TEXT NOT NULL,
      verdict TEXT NOT NULL,
      novelty_score REAL,
      correctness_score REAL,
      testability_score REAL,
      safety_flag INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL,
      critique TEXT NOT NULL,
      supporting_evidence_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_reviews_hypothesis ON reviews(hypothesis_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_reviews_session ON reviews(session_id)`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS tournament_matches (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      hypothesis_a_id TEXT NOT NULL REFERENCES hypotheses(id),
      hypothesis_b_id TEXT NOT NULL REFERENCES hypotheses(id),
      match_type TEXT NOT NULL,
      result TEXT NOT NULL,
      winner_elo_after REAL NOT NULL,
      loser_elo_after REAL NOT NULL,
      debate_transcript TEXT,
      rationale TEXT NOT NULL,
      round INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_matches_session ON tournament_matches(session_id)`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS proximity_edges (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      hypothesis_a_id TEXT NOT NULL REFERENCES hypotheses(id),
      hypothesis_b_id TEXT NOT NULL REFERENCES hypotheses(id),
      similarity_score REAL NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_proximity_a ON proximity_edges(hypothesis_a_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_proximity_b ON proximity_edges(hypothesis_b_id)`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 5,
      payload_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT,
      error TEXT,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL
    )
  `);
  // Composite index for countCompletedTasksByType queries (called every supervisor round)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_agent_tasks_session_type_status ON agent_tasks(session_id, type, status)`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS embedding_cache (
      hypothesis_id TEXT PRIMARY KEY REFERENCES hypotheses(id),
      embedding_blob BLOB NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  // ── sqlite-vec virtual table for ANN (approximate nearest-neighbour) search ──
  // all-MiniLM-L6-v2 produces 384-dimensional float32 vectors.
  // vec_embeddings shadows embedding_cache: the same vectors are stored here for
  // indexed KNN queries and in embedding_cache as a plain blob for raw retrieval.
  // "IF NOT EXISTS" is supported by vec0; safe to call on every startup.
  getSqlite().query(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings
    USING vec0(
      hypothesis_id TEXT PRIMARY KEY,
      embedding     FLOAT[384]
    )
  `).run();

  db.run(sql`
    CREATE TABLE IF NOT EXISTS kg_nodes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      hypothesis_id TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_kg_nodes_session ON kg_nodes(session_id)`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS kg_edges (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_kg_edges_session ON kg_edges(session_id)`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS claim_citations (
      id TEXT PRIMARY KEY,
      hypothesis_id TEXT NOT NULL REFERENCES hypotheses(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      claim_text TEXT NOT NULL,
      paper_title TEXT NOT NULL,
      paper_url TEXT NOT NULL,
      paper_authors TEXT NOT NULL DEFAULT '',
      paper_year INTEGER,
      paper_abstract TEXT NOT NULL DEFAULT '',
      support TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_claim_citations_hypothesis ON claim_citations(hypothesis_id)`);

  // ── Experimental Feedback (RLEF) ─────────────────────────────────────────────
  // Stores wet-lab / user-study / ML-experiment feedback on hypotheses, plus the
  // derived reward signal that is later applied to the hypothesis Elo rating.
  db.run(sql`
    CREATE TABLE IF NOT EXISTS experimental_feedback (
      id TEXT PRIMARY KEY,
      hypothesis_id TEXT NOT NULL REFERENCES hypotheses(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      feedback_text TEXT NOT NULL,
      novelty_score REAL,
      correctness_score REAL,
      testability_score REAL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      computed_reward REAL NOT NULL,
      recorded_by TEXT NOT NULL DEFAULT 'human',
      created_at INTEGER NOT NULL
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_experimental_feedback_hypothesis ON experimental_feedback(hypothesis_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_experimental_feedback_session ON experimental_feedback(session_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_experimental_feedback_reward ON experimental_feedback(session_id, computed_reward DESC)`);

  // ── Reward Memory (Cross-Session Semantic Recall) ────────────────────────────
  // Persistent index of strong-signal feedback. Queried by new sessions via
  // semantic similarity over `vec_embeddings` (embedding_id = hypothesis_id key).
  db.run(sql`
    CREATE TABLE IF NOT EXISTS reward_memory (
      id TEXT PRIMARY KEY,
      hypothesis_id TEXT NOT NULL REFERENCES hypotheses(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      feedback_summary TEXT NOT NULL,
      mechanistic_keywords TEXT NOT NULL DEFAULT '[]',
      computed_reward REAL NOT NULL,
      embedding_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_reward_memory_hypothesis ON reward_memory(hypothesis_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_reward_memory_session ON reward_memory(session_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_reward_memory_embedding ON reward_memory(embedding_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_reward_memory_reward ON reward_memory(computed_reward DESC)`);

  // ── Evidence Bank (Deep Evidence Pipeline) ───────────────────────────────────
  db.run(sql`
    CREATE TABLE IF NOT EXISTS evidence_sources (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      doi TEXT,
      published_date TEXT,
      goal TEXT NOT NULL,
      rationale TEXT NOT NULL,
      evidence TEXT NOT NULL,
      summary TEXT NOT NULL,
      round INTEGER NOT NULL,
      embedding_blob BLOB,
      created_at INTEGER NOT NULL
    )
  `);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_session_url ON evidence_sources(session_id, url)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_evidence_session ON evidence_sources(session_id)`);

  // ── Citation Verifications (Citation-Integrity) ──────────────────────────────
  db.run(sql`
    CREATE TABLE IF NOT EXISTS citation_verifications (
      id TEXT PRIMARY KEY,
      hypothesis_id TEXT NOT NULL REFERENCES hypotheses(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      raw_citation TEXT NOT NULL,
      status TEXT NOT NULL,
      canonical_title TEXT,
      doi TEXT,
      authors TEXT,
      year INTEGER,
      match_score REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_citation_verifications_hypothesis ON citation_verifications(hypothesis_id)`);

  // ── Safety Assessments (Safety Gate) ─────────────────────────────────────────
  db.run(sql`
    CREATE TABLE IF NOT EXISTS safety_assessments (
      id TEXT PRIMARY KEY,
      hypothesis_id TEXT NOT NULL REFERENCES hypotheses(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      severity TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'none',
      reasoning TEXT NOT NULL DEFAULT '',
      decision TEXT NOT NULL,
      threshold TEXT NOT NULL,
      overridden_by TEXT,
      override_reason TEXT,
      overridden_at INTEGER,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_safety_assessments_hypothesis ON safety_assessments(hypothesis_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_safety_assessments_session ON safety_assessments(session_id)`);

  // ── Unique index on proximity_edges(hypothesis_a_id, hypothesis_b_id) ────────
  // Pairs are stored in canonical sorted order so (A,B) == (B,A).
  // The ON CONFLICT DO UPDATE in saveProximityEdge relies on this constraint.
  try {
    getSqlite().query(
      `CREATE UNIQUE INDEX IF NOT EXISTS proximity_edges_pair_unique ON proximity_edges(hypothesis_a_id, hypothesis_b_id)`
    ).run();
  } catch {
    // Index already exists — safe to ignore
  }

  // ── Glicko-2 columns (idempotent — safe to run on existing databases) ────────
  // SQLite does not support "ADD COLUMN IF NOT EXISTS" natively, so we catch
  // the error that fires when the column already exists and ignore it.
  for (const stmt of [
    `ALTER TABLE hypotheses ADD COLUMN rating_deviation REAL NOT NULL DEFAULT 350`,
    `ALTER TABLE hypotheses ADD COLUMN volatility       REAL NOT NULL DEFAULT 0.06`,
    `ALTER TABLE hypotheses ADD COLUMN experiment_protocol_json TEXT`,
    `ALTER TABLE hypotheses ADD COLUMN draws INTEGER NOT NULL DEFAULT 0`,
  ]) {
    try {
      getSqlite().query(stmt).run();
    } catch {
      // Column already exists — safe to ignore
    }
  }
  // ── Legacy cleanup: thinking_traces was removed in commit 20b62a3 ──────────
  // The table persists in older databases and causes FK constraint failures during
  // session deletion. Drop it unconditionally on every startup.
  try {
    getSqlite().query(`DROP TABLE IF EXISTS thinking_traces`).run();
  } catch {
    // Table does not exist or is already dropped — safe to ignore
  }

  // Add session_activity table for session logging
  db.run(sql`
    CREATE TABLE IF NOT EXISTS session_activity (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      agent TEXT NOT NULL DEFAULT 'system',
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      detail_json TEXT,
      tokens_in INTEGER,
      tokens_out INTEGER,
      created_at INTEGER NOT NULL
    )
  `);
  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_session_activity_session
    ON session_activity(session_id)
  `);
  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_session_activity_type
    ON session_activity(session_id, type)
  `);
}

// Run migrations when executed directly: `bun run src/db/migrate.ts`
if (import.meta.main) {
  await runMigrations();
  console.log("Migrations complete.");
  process.exit(0);
}
