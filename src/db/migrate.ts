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
      matches_played INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
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
  ]) {
    try {
      getSqlite().query(stmt).run();
    } catch {
      // Column already exists — safe to ignore
    }
  }
}
