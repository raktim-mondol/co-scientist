# Deep Evidence Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ground co-scientist's `literature_exploration` generation in actual page/paper content via a bounded DeepResearch-style loop (search → plan → read → bank) with a persistent, cited evidence bank.

**Architecture:** New `LiteratureResearchAgent` (extends `BaseAgent`, invoked inline by `GenerationAgent` like `ProvenanceAgent` is by reflection) runs ≤ `research.maxRounds` rounds: search via existing `SearchTool`, one plan LLM call deciding sufficiency/URLs/queries, page reading via the `parallel-web` SDK `client.extract()`, one goal-directed extractor LLM call per source → `{rationale, evidence, summary}` persisted to a new `evidence_sources` table with embeddings. Generation consumes a numbered `[E#]` evidence digest instead of search snippets; every failure path falls back to current snippet behavior.

**Tech Stack:** TypeScript, Bun (`bun:test`), Drizzle ORM + raw SQL migrations, Handlebars YAML prompts, `parallel-web` SDK (already installed), local MiniLM embeddings via existing `llm.embed()`.

**Spec:** `docs/superpowers/specs/2026-06-12-deep-evidence-pipeline-design.md` (approved, committed `5ccb701` on `feature/deep-evidence-pipeline`, branched off main).

**Context:** Today `_literatureExploration` (src/agents/generation.ts:130-229) does one `multiSearch` → snippet blob (`formatSearchContext`, base.ts:270) → one LLM call. It never reads sources, and literature is discarded per task. The evidence bank is the durable asset later branches will wire into reflection and the research overview. Note: the unmerged `feature/diversity-aware-generation` branch also touches `_literatureExploration` and `literature_exploration.yaml`; changes here are kept minimal/localized to ease that future merge.

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `docs/superpowers/plans/2026-06-12-deep-evidence-pipeline.md` | Create | This plan (committed at execution start) |
| `src/config.ts` | Modify | `research` config section + env mapping |
| `src/util/vector.ts` | Create | Pure `cosineSimilarity` (lifted from proximity.ts) |
| `src/agents/proximity.ts` | Modify | Import cosine from util instead of local copy |
| `src/models/evidence.ts` | Create | `EvidenceSource` Zod schema + type |
| `src/db/schema.ts` | Modify | `evidenceSources` table |
| `src/db/migrate.ts` | Modify | `CREATE TABLE IF NOT EXISTS evidence_sources` + indexes |
| `src/memory/contextStore.ts` | Modify | `saveEvidence` / `getEvidenceBySession` / `hasVisitedUrl` / `getRelevantEvidence` |
| `src/tools/search.ts` | Modify | `ExtractedPage`, `parseExtractResults` (pure), `SearchTool.extractPages` |
| `src/prompts/research/plan.yaml` | Create | Round-controller prompt |
| `src/prompts/research/extract.yaml` | Create | Goal-directed evidence extractor prompt |
| `src/prompts/generation/literature_exploration.yaml` | Modify | Consume `[E#]` digest, cite source URLs |
| `src/agents/literatureResearch.ts` | Create | Loop agent + pure helpers (`normalizeUrl`, `formatEvidenceDigest`, `shouldContinue`, `resolveCitationMarkers`) |
| `src/agents/generation.ts` | Modify | Wire researcher into `_literatureExploration`, snippet fallback |
| `src/tests/deepResearch.test.ts` | Create | All tests for this feature |
| `README.md` | Modify | Document the feature (follow style of commit `ac0e36d`) |

---

### Task 0: Commit the plan document

- [ ] **Step 1: Confirm branch and copy plan**

```bash
cd /mnt/c/Users/rakti/Downloads/co-scientist
git checkout feature/deep-evidence-pipeline
mkdir -p docs/superpowers/plans
cp /home/raktim/.claude/plans/all-good-write-the-transient-melody.md docs/superpowers/plans/2026-06-12-deep-evidence-pipeline.md
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-06-12-deep-evidence-pipeline.md
git commit -m "docs: implementation plan for deep evidence pipeline

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1: Config — `research` section

**Files:**
- Modify: `src/config.ts` (ConfigSchema ~line 40, raw env mapping ~line 90)
- Test: `src/tests/deepResearch.test.ts` (new file)

- [ ] **Step 1: Write the failing tests**

Create `src/tests/deepResearch.test.ts` with the shared test scaffold (mirrors `src/tests/citationIntegrity.test.ts:1-38`) plus config tests:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";

const TEST_DIR = join(tmpdir(), `deep-research-test-${Date.now()}`);
mkdirSync(TEST_DIR, { recursive: true });
process.env.DB_PATH = join(TEST_DIR, "test.db");
process.env.DEEPSEEK_API_KEY = "stub-for-tests";
process.env.PARALLEL_AI_API_KEY = ""; // force no-key path: dotenv won't override pre-set vars

import { resetDb } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { getContextStore, resetContextStore } from "../memory/contextStore.js";
import { resetConfig, getConfig } from "../config.js";

let store: ReturnType<typeof getContextStore>;
let sessionId: string;

beforeAll(async () => {
  resetConfig();
  resetDb();
  resetContextStore();
  store = getContextStore();
  await runMigrations();
  sessionId = uuidv4();
  store["sqlite"].run(
    `INSERT INTO sessions (id,name,status,research_goal_json,stats_json,created_at,updated_at)
     VALUES ('${sessionId}','Evidence Test','running','{}','{}',1,1)`
  );
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("research config", () => {
  it("has sane defaults", () => {
    const cfg = getConfig();
    expect(cfg.research.maxRounds).toBe(2);
    expect(cfg.research.urlsPerRound).toBe(3);
    expect(cfg.research.maxContentChars).toBe(40_000);
  });

  it("honors env overrides", () => {
    process.env.DEEP_RESEARCH_MAX_ROUNDS = "0";
    process.env.DEEP_RESEARCH_URLS_PER_ROUND = "5";
    process.env.DEEP_RESEARCH_MAX_CONTENT_CHARS = "10000";
    resetConfig();
    const cfg = getConfig();
    expect(cfg.research.maxRounds).toBe(0);
    expect(cfg.research.urlsPerRound).toBe(5);
    expect(cfg.research.maxContentChars).toBe(10000);
    delete process.env.DEEP_RESEARCH_MAX_ROUNDS;
    delete process.env.DEEP_RESEARCH_URLS_PER_ROUND;
    delete process.env.DEEP_RESEARCH_MAX_CONTENT_CHARS;
    resetConfig();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tests/deepResearch.test.ts`
Expected: FAIL — `cfg.research` is undefined (property does not exist on AppConfig).

- [ ] **Step 3: Implement config**

In `src/config.ts`, inside `ConfigSchema` after the `compute` object (before `// Reproducibility`):

```typescript
  // Deep evidence pipeline (DeepResearch-style literature loop)
  research: z.object({
    maxRounds: z.number().int().min(0).default(2),        // 0 disables the loop
    urlsPerRound: z.number().int().positive().default(3),
    maxContentChars: z.number().int().positive().default(40_000),
  }),
```

In the `raw` object, after `compute: { ... },`:

```typescript
  research: {
    maxRounds: process.env.DEEP_RESEARCH_MAX_ROUNDS
      ? parseInt(process.env.DEEP_RESEARCH_MAX_ROUNDS, 10)
      : undefined,
    urlsPerRound: process.env.DEEP_RESEARCH_URLS_PER_ROUND
      ? parseInt(process.env.DEEP_RESEARCH_URLS_PER_ROUND, 10)
      : undefined,
    maxContentChars: process.env.DEEP_RESEARCH_MAX_CONTENT_CHARS
      ? parseInt(process.env.DEEP_RESEARCH_MAX_CONTENT_CHARS, 10)
      : undefined,
  },
```

(Zod strips `undefined` to defaults — same pattern as `compute`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/tests/deepResearch.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/tests/deepResearch.test.ts
git commit -m "feat(research): config.research (env DEEP_RESEARCH_*) for deep evidence pipeline

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `src/util/vector.ts` — shared cosine helper

**Files:**
- Create: `src/util/vector.ts`
- Modify: `src/agents/proximity.ts:10-20` (delete local `cosineSimilarity`, import instead)
- Test: `src/tests/deepResearch.test.ts`

- [ ] **Step 1: Write the failing test** (append to `deepResearch.test.ts`)

```typescript
import { cosineSimilarity } from "../util/vector.js";

describe("cosineSimilarity (util)", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });
  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it("returns 0 for mismatched or empty vectors", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tests/deepResearch.test.ts`
Expected: FAIL — Cannot find module `../util/vector.js`.

- [ ] **Step 3: Create `src/util/vector.ts`** (function body moved verbatim from `proximity.ts:10-20`)

```typescript
/** Pure cosine similarity between two equal-length vectors. Returns 0 on mismatch. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
```

In `src/agents/proximity.ts`: delete the local `cosineSimilarity` function (lines 10-20) and add to imports:

```typescript
import { cosineSimilarity } from "../util/vector.js";
```

- [ ] **Step 4: Run full test suite (proximity is covered by existing tests)**

Run: `bun test`
Expected: PASS, including all pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/util/vector.ts src/agents/proximity.ts src/tests/deepResearch.test.ts
git commit -m "refactor: lift cosineSimilarity into src/util/vector for reuse

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Evidence model, schema, migration, ContextStore methods

**Files:**
- Create: `src/models/evidence.ts`
- Modify: `src/db/schema.ts` (append table), `src/db/migrate.ts` (append DDL), `src/memory/contextStore.ts` (4 methods)
- Test: `src/tests/deepResearch.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `deepResearch.test.ts`)

```typescript
describe("ContextStore evidence bank", () => {
  const mkEv = (url: string, summary = "S") => ({
    sessionId,
    url,
    title: "T",
    doi: undefined as string | undefined,
    publishedDate: "2024-01-01",
    goal: "G",
    rationale: "R",
    evidence: "E",
    summary,
    round: 1,
  });

  it("saves and reads back evidence rows", () => {
    const saved = store.saveEvidence(mkEv("https://a.example/p1"));
    expect(saved.id).toBeTruthy();
    const rows = store.getEvidenceBySession(sessionId);
    expect(rows.some((r) => r.url === "https://a.example/p1")).toBe(true);
  });

  it("upserts on (sessionId, url) — no duplicates", () => {
    store.saveEvidence(mkEv("https://a.example/dup", "first"));
    store.saveEvidence(mkEv("https://a.example/dup", "second"));
    const rows = store.getEvidenceBySession(sessionId).filter((r) => r.url === "https://a.example/dup");
    expect(rows.length).toBe(1);
    expect(rows[0].summary).toBe("second");
  });

  it("hasVisitedUrl reflects saved rows", () => {
    store.saveEvidence(mkEv("https://a.example/visited"));
    expect(store.hasVisitedUrl(sessionId, "https://a.example/visited")).toBe(true);
    expect(store.hasVisitedUrl(sessionId, "https://a.example/never")).toBe(false);
  });

  it("getRelevantEvidence ranks by cosine over stored embeddings", () => {
    store.saveEvidence(mkEv("https://a.example/near"), [1, 0, 0]);
    store.saveEvidence(mkEv("https://a.example/far"), [0, 1, 0]);
    const top = store.getRelevantEvidence(sessionId, [0.9, 0.1, 0], 1);
    expect(top.length).toBe(1);
    expect(top[0].url).toBe("https://a.example/near");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tests/deepResearch.test.ts`
Expected: FAIL — `store.saveEvidence is not a function`.

- [ ] **Step 3: Create `src/models/evidence.ts`** (Zod style mirrors `src/models/hypothesis.ts`)

```typescript
import { z } from "zod";

export const EvidenceSourceSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  url: z.string(),
  title: z.string(),
  doi: z.string().optional(),
  publishedDate: z.string().optional(),
  goal: z.string(),
  rationale: z.string(),
  evidence: z.string(),
  summary: z.string(),
  round: z.number().int(),
  createdAt: z.date(),
});

export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;
```

- [ ] **Step 4: Append table to `src/db/schema.ts`** (`uniqueIndex` is already imported there)

```typescript
// Evidence bank: goal-directed extractions from visited sources (deep evidence pipeline)
export const evidenceSources = sqliteTable("evidence_sources", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  url: text("url").notNull(),
  title: text("title").notNull(),
  doi: text("doi"),
  publishedDate: text("published_date"),
  goal: text("goal").notNull(),
  rationale: text("rationale").notNull(),
  evidence: text("evidence").notNull(),
  summary: text("summary").notNull(),
  round: integer("round").notNull(),
  embeddingBlob: blob("embedding_blob"), // Float32Array of summary embedding (nullable)
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (t) => [uniqueIndex("idx_evidence_session_url").on(t.sessionId, t.url)]);
```

(If existing tables use the object-return form `(t) => ({ ... })` for indexes, match that form instead — check neighbors in the file.)

- [ ] **Step 5: Append DDL to `src/db/migrate.ts`** (next to the `citation_verifications` block, same `db.run(sql\`...\`)` pattern from migrate.ts:237-253)

```typescript
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
```

- [ ] **Step 6: Add ContextStore methods** (in `src/memory/contextStore.ts`, near the other save/get groups; `uuidv4`, `eq`, `and`, `desc`, `schema` already imported — verify `and` is imported from drizzle-orm, add if missing)

```typescript
import type { EvidenceSource } from "../models/evidence.js";
import { cosineSimilarity } from "../util/vector.js";
```

```typescript
// ─── Evidence bank (deep evidence pipeline) ────────────────────────────────

/** Upsert by (sessionId, url). Optionally stores the summary embedding. */
saveEvidence(
  ev: Omit<EvidenceSource, "id" | "createdAt">,
  embedding?: number[]
): EvidenceSource {
  const id = uuidv4();
  const now = new Date();
  const embeddingBlob = embedding
    ? Buffer.from(new Float32Array(embedding).buffer)
    : null;

  this.db.insert(schema.evidenceSources).values({
    id,
    sessionId: ev.sessionId,
    url: ev.url,
    title: ev.title,
    doi: ev.doi ?? null,
    publishedDate: ev.publishedDate ?? null,
    goal: ev.goal,
    rationale: ev.rationale,
    evidence: ev.evidence,
    summary: ev.summary,
    round: ev.round,
    embeddingBlob,
    createdAt: now,
  }).onConflictDoUpdate({
    target: [schema.evidenceSources.sessionId, schema.evidenceSources.url],
    set: {
      title: ev.title,
      doi: ev.doi ?? null,
      publishedDate: ev.publishedDate ?? null,
      goal: ev.goal,
      rationale: ev.rationale,
      evidence: ev.evidence,
      summary: ev.summary,
      round: ev.round,
      embeddingBlob,
      createdAt: now,
    },
  }).run();

  // Re-read so upserts return the surviving row's id
  const row = this.db.select().from(schema.evidenceSources)
    .where(and(
      eq(schema.evidenceSources.sessionId, ev.sessionId),
      eq(schema.evidenceSources.url, ev.url),
    )).get()!;
  return this._rowToEvidence(row);
}

getEvidenceBySession(sessionId: string): EvidenceSource[] {
  const rows = this.db.select().from(schema.evidenceSources)
    .where(eq(schema.evidenceSources.sessionId, sessionId))
    .orderBy(desc(schema.evidenceSources.createdAt))
    .all();
  return rows.map((r) => this._rowToEvidence(r));
}

hasVisitedUrl(sessionId: string, url: string): boolean {
  const row = this.db.select({ id: schema.evidenceSources.id })
    .from(schema.evidenceSources)
    .where(and(
      eq(schema.evidenceSources.sessionId, sessionId),
      eq(schema.evidenceSources.url, url),
    )).get();
  return !!row;
}

/** Top-k evidence rows by cosine similarity of stored embeddings (TS-side; row counts are small). */
getRelevantEvidence(sessionId: string, embedding: number[], k: number): EvidenceSource[] {
  const rows = this.db.select().from(schema.evidenceSources)
    .where(eq(schema.evidenceSources.sessionId, sessionId))
    .all();
  return rows
    .filter((r) => r.embeddingBlob != null)
    .map((r) => {
      const buf = r.embeddingBlob as Buffer;
      const vec = Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
      return { row: r, score: cosineSimilarity(embedding, vec) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ row }) => this._rowToEvidence(row));
}

private _rowToEvidence(r: typeof schema.evidenceSources.$inferSelect): EvidenceSource {
  return {
    id: r.id,
    sessionId: r.sessionId,
    url: r.url,
    title: r.title,
    doi: r.doi ?? undefined,
    publishedDate: r.publishedDate ?? undefined,
    goal: r.goal,
    rationale: r.rationale,
    evidence: r.evidence,
    summary: r.summary,
    round: r.round,
    createdAt: r.createdAt,
  };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test src/tests/deepResearch.test.ts`
Expected: PASS (all evidence-bank tests). Float32 rounding note: the relevance test uses clearly separated vectors so float32 precision cannot flip the ranking.

- [ ] **Step 8: Run full suite, then commit**

Run: `bun test`
Expected: PASS.

```bash
git add src/models/evidence.ts src/db/schema.ts src/db/migrate.ts src/memory/contextStore.ts src/tests/deepResearch.test.ts
git commit -m "feat(research): evidence_sources table + ContextStore evidence bank methods

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `SearchTool.extractPages` (parallel-web extract)

**Files:**
- Modify: `src/tools/search.ts`
- Test: `src/tests/deepResearch.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `deepResearch.test.ts`)

```typescript
import { parseExtractResults, getSearchTool } from "../tools/search.js";

describe("parseExtractResults", () => {
  it("maps results, prefers full_content, truncates to maxChars", () => {
    const pages = parseExtractResults(
      [
        { url: "https://x.example/a", title: "A", publish_date: "2024-05-01", excerpts: ["e1", "e2"], full_content: "F".repeat(50) },
        { url: "https://x.example/b", title: null, publish_date: null, excerpts: ["only excerpt"], full_content: null },
      ],
      20
    );
    expect(pages.length).toBe(2);
    expect(pages[0].content).toBe("F".repeat(20));
    expect(pages[0].publishedDate).toBe("2024-05-01");
    expect(pages[1].title).toBe("https://x.example/b"); // falls back to url
    expect(pages[1].content).toBe("only excerpt");
  });

  it("drops results with no content", () => {
    const pages = parseExtractResults(
      [{ url: "https://x.example/empty", title: "E", publish_date: null, excerpts: [], full_content: null }],
      100
    );
    expect(pages.length).toBe(0);
  });
});

describe("SearchTool.extractPages", () => {
  it("returns [] gracefully when PARALLEL_AI_API_KEY is not set", async () => {
    const tool = getSearchTool();
    const pages = await tool.extractPages(["https://x.example/a"], "goal");
    expect(pages).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tests/deepResearch.test.ts`
Expected: FAIL — `parseExtractResults` not exported.

- [ ] **Step 3: Implement in `src/tools/search.ts`**

Add near `SearchResult`:

```typescript
export interface ExtractedPage {
  url: string;
  title: string;
  publishedDate?: string;
  content: string;
}

/** Pure mapper from parallel-web ExtractResult-shaped rows to ExtractedPage. */
export function parseExtractResults(
  results: Array<{
    url: string;
    title?: string | null;
    publish_date?: string | null;
    excerpts?: string[] | null;
    full_content?: string | null;
  }>,
  maxCharsPerPage: number
): ExtractedPage[] {
  const pages: ExtractedPage[] = [];
  for (const r of results) {
    const content = (r.full_content?.trim() || (r.excerpts ?? []).join("\n\n").trim());
    if (!content) continue;
    pages.push({
      url: r.url,
      title: r.title?.trim() || r.url,
      publishedDate: r.publish_date ?? undefined,
      content: content.slice(0, maxCharsPerPage),
    });
  }
  return pages;
}
```

Add method to `SearchTool` class (uses module-local `getParallelClient()` like `searchWeb` at search.ts:100-128):

```typescript
/**
 * Fetch and clean page contents via Parallel AI /v1/extract.
 * Used by LiteratureResearchAgent to read sources (deep evidence pipeline).
 * Returns [] (never throws) when the key is missing or the call fails.
 */
async extractPages(
  urls: string[],
  objective: string,
  options: { maxCharsPerPage?: number } = {}
): Promise<ExtractedPage[]> {
  if (urls.length === 0) return [];
  const maxCharsPerPage = options.maxCharsPerPage ?? 40_000;
  const client = getParallelClient();
  if (!client) {
    logger.warn("[Search:Extract] skipped — PARALLEL_AI_API_KEY not set");
    return [];
  }
  try {
    logger.info(`[Search:Extract] reading ${urls.length} page(s)`);
    const response = await client.extract({ urls, objective });
    for (const err of response.errors ?? []) {
      logger.warn(`[Search:Extract] ✗ ${JSON.stringify(err).slice(0, 200)}`);
    }
    return parseExtractResults(response.results ?? [], maxCharsPerPage);
  } catch (error) {
    logger.warn(`[Search:Extract] ✗ failed: ${(error as Error).message}`);
    return [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/tests/deepResearch.test.ts`
Expected: PASS. (The no-key test passes because the test env doesn't set `PARALLEL_AI_API_KEY`; if CI ever sets it, guard the test by clearing `getConfig().tools.parallelAi.apiKey` via env + `resetConfig()` in the test.)

- [ ] **Step 5: Commit**

```bash
git add src/tools/search.ts src/tests/deepResearch.test.ts
git commit -m "feat(research): SearchTool.extractPages via parallel-web /v1/extract

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Prompts

**Files:**
- Create: `src/prompts/research/plan.yaml`, `src/prompts/research/extract.yaml`
- Modify: `src/prompts/generation/literature_exploration.yaml`
- Test: `src/tests/deepResearch.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```typescript
import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import { join as pathJoin } from "path";

describe("research prompts", () => {
  const promptsDir = pathJoin(import.meta.dir, "..", "prompts");
  for (const name of ["plan", "extract"]) {
    it(`research/${name}.yaml is well-formed`, () => {
      const raw = readFileSync(pathJoin(promptsDir, "research", `${name}.yaml`), "utf-8");
      const tpl = parseYaml(raw) as { system: string; user: string; mode: string; max_tokens: number };
      expect(tpl.system?.length).toBeGreaterThan(0);
      expect(tpl.user?.length).toBeGreaterThan(0);
      expect(tpl.mode).toBe("chat");
      expect(tpl.max_tokens).toBeGreaterThan(0);
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tests/deepResearch.test.ts`
Expected: FAIL — ENOENT on `research/plan.yaml`.

- [ ] **Step 3: Create `src/prompts/research/plan.yaml`**

```yaml
mode: chat
max_tokens: 1200
system: |
  You are a research planning assistant inside an automated scientific discovery system.
  You decide whether enough literature evidence has been gathered to ground a novel hypothesis,
  and if not, which unread sources to read next and which new searches to run.
  You always respond with valid JSON only.

user: |
  RESEARCH GOAL: {{researchGoal}}

  EVIDENCE GATHERED SO FAR:
  {{evidenceDigest}}

  {{#if gaps}}
  OPEN GAPS FROM PREVIOUS ROUND:
  {{gaps}}
  {{/if}}

  CANDIDATE SOURCES (unread search results):
  {{candidates}}

  Decide the next research step:
  1. If the gathered evidence is already sufficient to ground a novel, testable hypothesis,
     set "sufficient": true and leave the other arrays empty.
  2. Otherwise select up to {{urlsPerRound}} candidate URLs most likely to fill the gaps
     (copy URLs exactly as given), and propose up to 3 NEW search queries that differ
     from anything already searched.

  Respond with ONLY a JSON object:
  {
    "sufficient": false,
    "gaps": ["unanswered question 1", "unanswered question 2"],
    "urlsToRead": ["exact-candidate-url-1", "exact-candidate-url-2"],
    "nextQueries": ["new query 1", "new query 2"]
  }
```

- [ ] **Step 4: Create `src/prompts/research/extract.yaml`** (adapted from DeepResearch's EXTRACTOR_PROMPT)

```yaml
mode: chat
max_tokens: 2500
system: |
  You extract goal-relevant evidence from source documents for an automated scientific
  research system. You never invent content that is not in the source.
  You always respond with valid JSON only.

user: |
  SOURCE CONTENT:
  {{pageContent}}

  RESEARCH GOAL:
  {{goal}}

  Task guidelines:
  1. rationale: locate the specific sections/data in the source directly related to the goal.
  2. evidence: extract the most relevant information — keep the original wording as far as
     possible, never omit key quantitative results; multiple paragraphs are allowed.
  3. summary: organize the findings into one concise paragraph with logical flow, and judge
     the contribution of this source to the goal.

  Respond with ONLY a JSON object:
  {
    "rationale": "...",
    "evidence": "...",
    "summary": "..."
  }
```

- [ ] **Step 5: Update `src/prompts/generation/literature_exploration.yaml`**

In the `user:` template, replace the line

```
  RELEVANT LITERATURE:
  {{literatureContext}}
```

with

```
  RELEVANT LITERATURE (each item is labeled, e.g. [1] or [E1], with its source URL):
  {{literatureContext}}
```

and replace the citations line in the JSON contract

```
    "citations": ["url1", "url2"]
```

with

```
    "citations": ["url of each literature item you actually relied on (copy the URL shown next to its label)"]
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/tests/deepResearch.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/prompts/research/ src/prompts/generation/literature_exploration.yaml src/tests/deepResearch.test.ts
git commit -m "feat(research): plan + extract prompts; literature_exploration cites source URLs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `LiteratureResearchAgent`

**Files:**
- Create: `src/agents/literatureResearch.ts`
- Test: `src/tests/deepResearch.test.ts`

- [ ] **Step 1: Write failing tests for the pure helpers** (append)

```typescript
import {
  LiteratureResearchAgent,
  normalizeUrl,
  formatEvidenceDigest,
  shouldContinue,
  resolveCitationMarkers,
  type PlanDecision,
} from "../agents/literatureResearch.js";
import type { EvidenceSource } from "../models/evidence.js";

const mkSource = (over: Partial<EvidenceSource> = {}): EvidenceSource => ({
  id: uuidv4(),
  sessionId,
  url: "https://x.example/a",
  title: "Title A",
  doi: undefined,
  publishedDate: "2024-01-01",
  goal: "G",
  rationale: "R",
  evidence: "Key evidence text",
  summary: "Summary text",
  round: 1,
  createdAt: new Date(),
  ...over,
});

describe("literatureResearch pure helpers", () => {
  it("normalizeUrl lowercases host, strips hash and trailing slash", () => {
    expect(normalizeUrl("HTTPS://EXAMPLE.com/Path/#frag")).toBe("https://example.com/Path");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
    expect(normalizeUrl("not a url")).toBe("not a url"); // passthrough on parse failure
  });

  it("formatEvidenceDigest numbers sources as [E#] with url and summary", () => {
    const digest = formatEvidenceDigest([
      mkSource({ title: "First", url: "https://x.example/1" }),
      mkSource({ title: "Second", url: "https://x.example/2" }),
    ]);
    expect(digest).toContain("[E1] First — https://x.example/1");
    expect(digest).toContain("[E2] Second — https://x.example/2");
    expect(digest).toContain("Summary text");
  });

  it("shouldContinue enforces hard cap and sufficiency", () => {
    expect(shouldContinue(1, 2, false, true)).toBe(true);
    expect(shouldContinue(3, 2, false, true)).toBe(false);  // past cap
    expect(shouldContinue(2, 2, true, true)).toBe(false);   // sufficient
    expect(shouldContinue(1, 2, false, false)).toBe(false); // no candidates
  });

  it("resolveCitationMarkers maps E# markers to urls, passes urls through", () => {
    const sources = [mkSource({ url: "https://x.example/1" }), mkSource({ url: "https://x.example/2" })];
    expect(resolveCitationMarkers(["[E1]", "E2", "https://other.example"], sources))
      .toEqual(["https://x.example/1", "https://x.example/2", "https://other.example"]);
  });
});
```

- [ ] **Step 2: Write failing tests for the loop** (append; stubs override the protected `callLLMForJSON` via subclass, and replace `search` on the instance)

```typescript
function stubAgent(plans: PlanDecision[], searchResults: Array<{ url: string; title: string; snippet: string }>) {
  class Stub extends LiteratureResearchAgent {
    public extractCalls = 0;
    protected override async callLLMForJSON<T>(_system: string, userPrompt: string): Promise<T | null> {
      if (userPrompt.includes("Decide the next research step")) {
        return (plans.shift() ?? null) as T;
      }
      this.extractCalls++;
      return { rationale: "r", evidence: "e", summary: `summary ${this.extractCalls}` } as T;
    }
  }
  const agent = new Stub();
  (agent as unknown as { search: unknown }).search = {
    multiSearch: async () => searchResults.map((r) => ({ ...r, source: "parallel_ai" })),
    extractPages: async (urls: string[]) =>
      urls.map((u) => ({ url: u, title: `Page ${u}`, content: "page content" })),
  };
  (agent as unknown as { llm: unknown }).llm = {
    embed: async (texts: string[]) => texts.map(() => [1, 0, 0]),
  };
  return agent;
}

describe("LiteratureResearchAgent loop", () => {
  it("returns null when maxRounds is 0", async () => {
    process.env.DEEP_RESEARCH_MAX_ROUNDS = "0";
    resetConfig();
    const agent = stubAgent([], []);
    expect(await agent.research(sessionId, "goal", ["q"])).toBeNull();
    delete process.env.DEEP_RESEARCH_MAX_ROUNDS;
    resetConfig();
  });

  it("banks evidence and stops early when plan says sufficient", async () => {
    const sid = uuidv4();
    store["sqlite"].run(
      `INSERT INTO sessions (id,name,status,research_goal_json,stats_json,created_at,updated_at)
       VALUES ('${sid}','Loop1','running','{}','{}',1,1)`
    );
    const agent = stubAgent(
      [
        { sufficient: false, gaps: ["g"], urlsToRead: ["https://x.example/r1"], nextQueries: ["q2"] },
        { sufficient: true, gaps: [], urlsToRead: [], nextQueries: [] },
      ],
      [{ url: "https://x.example/r1", title: "R1", snippet: "s" }, { url: "https://x.example/r2", title: "R2", snippet: "s" }]
    );
    const out = await agent.research(sid, "goal", ["q1"]);
    expect(out).not.toBeNull();
    expect(out!.sources.length).toBe(1);
    expect(out!.digest).toContain("[E1]");
    expect(store.getEvidenceBySession(sid).length).toBe(1);
  });

  it("hard-stops at maxRounds even when plans keep asking for more", async () => {
    const sid = uuidv4();
    store["sqlite"].run(
      `INSERT INTO sessions (id,name,status,research_goal_json,stats_json,created_at,updated_at)
       VALUES ('${sid}','Loop2','running','{}','{}',1,1)`
    );
    let n = 0;
    const endless = () => ({ sufficient: false, gaps: [], urlsToRead: [`https://x.example/p${++n}`], nextQueries: [`q${n}`] });
    const agent = stubAgent(
      [endless(), endless(), endless(), endless()],
      Array.from({ length: 10 }, (_, i) => ({ url: `https://x.example/p${i + 1}`, title: `P${i + 1}`, snippet: "s" }))
    );
    const out = await agent.research(sid, "goal", ["q1"]);
    expect(out).not.toBeNull();
    // default maxRounds = 2 → at most 2 read rounds happened
    expect(store.getEvidenceBySession(sid).length).toBeLessThanOrEqual(2 * getConfig().research.urlsPerRound);
  });

  it("returns null when no evidence could be extracted", async () => {
    const sid = uuidv4();
    store["sqlite"].run(
      `INSERT INTO sessions (id,name,status,research_goal_json,stats_json,created_at,updated_at)
       VALUES ('${sid}','Loop3','running','{}','{}',1,1)`
    );
    const agent = stubAgent(
      [{ sufficient: false, gaps: [], urlsToRead: ["https://x.example/r1"], nextQueries: [] }],
      [{ url: "https://x.example/r1", title: "R1", snippet: "s" }]
    );
    (agent as unknown as { search: { extractPages: () => Promise<unknown[]> } }).search.extractPages =
      async () => []; // every fetch fails
    expect(await agent.research(sid, "goal", ["q1"])).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test src/tests/deepResearch.test.ts`
Expected: FAIL — Cannot find module `../agents/literatureResearch.js`.

- [ ] **Step 4: Create `src/agents/literatureResearch.ts`**

```typescript
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/tests/deepResearch.test.ts`
Expected: PASS. Note: the "returns null when no evidence could be extracted" test relies on the loop returning null when both `newlyCollected` and pre-existing `collected` are empty — that test uses a fresh session id so the bank is empty.

- [ ] **Step 6: Run full suite, then commit**

Run: `bun test`
Expected: PASS.

```bash
git add src/agents/literatureResearch.ts src/tests/deepResearch.test.ts
git commit -m "feat(research): LiteratureResearchAgent — bounded search→plan→read→bank loop

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Wire into GenerationAgent

**Files:**
- Modify: `src/agents/generation.ts` (`_literatureExploration`, lines ~130-229 on this branch)
- Test: covered by full suite + typecheck (LLM-dependent path); `resolveCitationMarkers` already unit-tested

- [ ] **Step 1: Add researcher instance**

In `GenerationAgent` class members (next to `private kg = new KnowledgeGraphAgent();`):

```typescript
import { LiteratureResearchAgent, resolveCitationMarkers } from "./literatureResearch.js";
```

```typescript
private researcher = new LiteratureResearchAgent();
```

- [ ] **Step 2: Replace the search/context section of `_literatureExploration`**

Replace (current lines ~242-244):

```typescript
// Step 2: Search and generate hypothesis
const results = await this.search.multiSearch(queries, "auto");
const context = this.formatSearchContext(results);
```

with:

```typescript
// Step 2: Deep evidence loop (DeepResearch-style). Any failure → snippet fallback.
let context: string;
let researched: Awaited<ReturnType<LiteratureResearchAgent["research"]>> = null;
try {
  researched = await this.researcher.research(sessionId, planConfig.parsedTitle, queries);
} catch (err) {
  this.log("warn", `Deep research failed — falling back to snippets: ${(err as Error).message}`);
}
if (researched) {
  context = researched.digest;
} else {
  const results = await this.search.multiSearch(queries, "auto");
  context = this.formatSearchContext(results);
}
```

(`multiSearch` results are cached by `_cachedSearch`, so the fallback search after a partially-failed loop is cheap.)

- [ ] **Step 3: Resolve `[E#]` citation markers on the returned hypothesis**

Replace the tail of `_literatureExploration`:

```typescript
return this.callLLMForJSON<ParsedHypothesis>(system, userPrompt, {
  mode: "chat",
  maxTokens: 6000,
});
```

with:

```typescript
const hypothesis = await this.callLLMForJSON<ParsedHypothesis>(system, userPrompt, {
  mode: "chat",
  maxTokens: 6000,
});
if (hypothesis && researched) {
  hypothesis.citations = resolveCitationMarkers(hypothesis.citations ?? [], researched.sources);
}
return hypothesis;
```

- [ ] **Step 4: Typecheck and run full suite**

Run: `bunx tsc --noEmit && bun test`
Expected: clean typecheck, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/generation.ts
git commit -m "feat(research): ground literature_exploration in the evidence bank with snippet fallback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Documentation

**Files:**
- Modify: `README.md` (follow the style of commit `ac0e36d` — feature section + architecture diagram if README has a mermaid block listing agents)
- Modify: `CLAUDE.md` agents list (untracked file — edit but do not commit)

- [ ] **Step 1: Update README**

Add a "Deep evidence pipeline" entry to the features/architecture sections: bounded search→plan→read→bank loop, `evidence_sources` bank, `[E#]`-cited generation, `DEEP_RESEARCH_MAX_ROUNDS` / `DEEP_RESEARCH_URLS_PER_ROUND` / `DEEP_RESEARCH_MAX_CONTENT_CHARS` env vars, snippet fallback. If the README mermaid diagram lists agents, add `LiteratureResearchAgent` between GenerationAgent and SearchTool.

- [ ] **Step 2: Update CLAUDE.md agents list (no commit — file is untracked)**

Add under Agents: `- **LiteratureResearchAgent** — bounded deep-research loop (search → plan → read → bank); builds the per-session evidence bank that grounds literature_exploration`.

- [ ] **Step 3: Commit README only**

```bash
git add README.md
git commit -m "docs: document deep evidence pipeline in README

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Verification

1. **Unit/integration:** `bun test` — full suite green (new `deepResearch.test.ts` ≈ 18 tests + all pre-existing).
2. **Types:** `bunx tsc --noEmit` — clean.
3. **Migration idempotency:** `bun run src/db/migrate.ts` twice against a scratch `DB_PATH` — no errors.
4. **Live smoke (manual, requires `DEEPSEEK_API_KEY` + `PARALLEL_AI_API_KEY`):**
   ```bash
   DEEP_RESEARCH_MAX_ROUNDS=1 bun run src/cli/index.ts run --goal "test goal" ...
   ```
   Expect log lines `[LiteratureResearch] Evidence bank: +N new source(s)` and `[Search:Extract] reading N page(s)`; inspect `evidence_sources` rows via `sqlite3 ~/.co-scientist/co-scientist.db 'SELECT url,title,round FROM evidence_sources'`. Also verify graceful fallback by running once with `PARALLEL_AI_API_KEY` unset (expect `[Search:Extract] skipped` + snippet generation still works).

## Out of scope (follow-up branches per spec)

- Reflection/provenance reading from the evidence bank
- WebWeaver-style section-by-section research overview
- sqlite-vec virtual table for evidence ANN search
- Merge coordination with `feature/diversity-aware-generation` (both touch `_literatureExploration` + `literature_exploration.yaml`; conflicts are small and mechanical)
