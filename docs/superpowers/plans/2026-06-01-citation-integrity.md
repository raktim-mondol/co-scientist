# Citation-Integrity Checker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify every hypothesis citation against Crossref, classify each as verified/unverified/fabricated, persist the results, and apply a soft Glicko-2 penalty proportional to the fabrication rate.

**Architecture:** A new `citationResolver` module (pure, injectable `fetch`) resolves one citation string to an existence verdict via Crossref. A new `CitationIntegrityAgent` orchestrates per-hypothesis verification and persists rows to a new `citation_verifications` table. `ReflectionAgent` runs the agent right after provenance and folds a pure `citationPenalty()` into the existing Glicko-2 seeding step. Results surface in `results --show-feedback` and `export`.

**Tech Stack:** TypeScript, Bun, `bun:test`, Drizzle ORM + raw `bun:sqlite`, Crossref REST API (no auth).

---

## File structure

| File | Responsibility | Create/Modify |
|---|---|---|
| `src/db/schema.ts` | `citationVerifications` Drizzle table | Modify |
| `src/db/migrate.ts` | `CREATE TABLE IF NOT EXISTS` + index | Modify |
| `src/memory/contextStore.ts` | save/get/summary methods + deleteSession cleanup | Modify |
| `src/tools/citationResolver.ts` | resolve one citation → verdict + metadata | Create |
| `src/agents/citationIntegrity.ts` | per-hypothesis orchestration + `citationPenalty()` | Create |
| `src/agents/reflection.ts` | run pass after provenance, fold penalty into seeding | Modify |
| `src/cli/commands/list.ts` | show integrity in `results --show-feedback` | Modify |
| `src/cli/commands/export.ts` | show integrity in markdown + JSON export | Modify |
| `src/tests/citationResolver.test.ts` | resolver unit tests | Create |
| `src/tests/citationIntegrity.test.ts` | penalty + agent tests | Create |

**Shared types (defined in Task 2, reused everywhere):**

```ts
// src/tools/citationResolver.ts
export type CitationStatus = "verified" | "unverified" | "fabricated";

export interface CitationResolution {
  raw: string;
  status: CitationStatus;
  canonicalTitle?: string;
  doi?: string;
  authors?: string;   // comma-joined family names
  year?: number;
  matchScore: number; // 0..1
  source: "crossref" | "none";
}

export type FetchFn = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;
```

---

## Task 1: Schema, migration, and ContextStore persistence

**Files:**
- Modify: `src/db/schema.ts` (append after the `rewardMemory` table, end of file)
- Modify: `src/db/migrate.ts` (add a `CREATE TABLE` block + index alongside the others, before the final `ALTER TABLE` loop)
- Modify: `src/memory/contextStore.ts` (add methods; extend `deleteSession`)
- Test: `src/tests/citationIntegrity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tests/citationIntegrity.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";

const TEST_DIR = join(tmpdir(), `citation-test-${Date.now()}`);
mkdirSync(TEST_DIR, { recursive: true });
process.env.DB_PATH = join(TEST_DIR, "test.db");
process.env.DEEPSEEK_API_KEY = "stub-for-tests";

import { resetDb } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { getContextStore, resetContextStore } from "../memory/contextStore.js";
import { resetConfig } from "../config.js";

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
     VALUES ('${sessionId}','Cite Test','completed','{}','{}',1,1)`
  );
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function addHyp() {
  return store.saveHypothesis({
    sessionId,
    title: "H", summary: "s", content: "c", rationale: "r",
    generationStrategy: "literature_exploration",
    eloRating: 1200, ratingDeviation: 350, volatility: 0.06,
    matchesPlayed: 0, wins: 0, losses: 0, draws: 0,
    status: "active", parentIds: [], generationRound: 1,
    keyAssumptions: [], citations: [],
  });
}

describe("ContextStore citation verifications", () => {
  it("saves and reads back verification rows", () => {
    const h = addHyp();
    store.saveCitationVerifications(h.id, sessionId, [
      { rawCitation: "10.1/x", status: "verified", canonicalTitle: "T", doi: "10.1/x", authors: "Doe", year: 2020, matchScore: 1 },
      { rawCitation: "fake", status: "fabricated", matchScore: 0 },
    ]);
    const rows = store.getCitationVerifications(h.id);
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.status === "verified")?.doi).toBe("10.1/x");
  });

  it("summarizes counts and fabrication rate", () => {
    const h = addHyp();
    store.saveCitationVerifications(h.id, sessionId, [
      { rawCitation: "a", status: "verified", matchScore: 1 },
      { rawCitation: "b", status: "fabricated", matchScore: 0 },
      { rawCitation: "c", status: "unverified", matchScore: 0.2 },
      { rawCitation: "d", status: "fabricated", matchScore: 0 },
    ]);
    const s = store.getCitationIntegrity(h.id);
    expect(s.total).toBe(4);
    expect(s.verified).toBe(1);
    expect(s.unverified).toBe(1);
    expect(s.fabricated).toBe(2);
    expect(s.fabricationRate).toBeCloseTo(0.5, 5);
  });

  it("re-saving replaces prior rows (idempotent)", () => {
    const h = addHyp();
    store.saveCitationVerifications(h.id, sessionId, [{ rawCitation: "a", status: "verified", matchScore: 1 }]);
    store.saveCitationVerifications(h.id, sessionId, [{ rawCitation: "b", status: "fabricated", matchScore: 0 }]);
    const rows = store.getCitationVerifications(h.id);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("fabricated");
  });

  it("empty summary is zeroed with rate 0", () => {
    const h = addHyp();
    const s = store.getCitationIntegrity(h.id);
    expect(s.total).toBe(0);
    expect(s.fabricationRate).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tests/citationIntegrity.test.ts`
Expected: FAIL — `store.saveCitationVerifications is not a function`.

- [ ] **Step 3: Add the Drizzle table to `src/db/schema.ts`**

Append at the end of the file (after the `rewardMemory` table):

```ts
// ─── Citation Verifications (Citation-Integrity) ─────────────────────────────
// Existence check for each free-text entry in hypotheses.citationsJson, resolved
// against Crossref. Distinct from claim_citations (which checks whether claims
// are SUPPORTED) — this checks whether the cited paper EXISTS.
export const citationVerifications = sqliteTable("citation_verifications", {
  id: text("id").primaryKey(),
  hypothesisId: text("hypothesis_id").notNull().references(() => hypotheses.id),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  rawCitation: text("raw_citation").notNull(),
  status: text("status").notNull(), // 'verified' | 'unverified' | 'fabricated'
  canonicalTitle: text("canonical_title"),
  doi: text("doi"),
  authors: text("authors"),
  year: integer("year"),
  matchScore: real("match_score").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
```

- [ ] **Step 4: Add the migration to `src/db/migrate.ts`**

Insert this block immediately after the `reward_memory` index statements (the `idx_reward_memory_*` lines) and before the `// ── Unique index on proximity_edges ──` block:

```ts
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
```

- [ ] **Step 5: Add ContextStore methods**

In `src/memory/contextStore.ts`, add these methods inside the `ContextStore` class (place them after `getClaimCitations` / `hasProvenanceFlag`, in the Provenance section):

```ts
  // ─── Citation Verifications (Citation-Integrity) ──────────────────────────

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
    const now = Date.now();
    this.sqlite.transaction(() => {
      this.sqlite
        .query(`DELETE FROM citation_verifications WHERE hypothesis_id = ?`)
        .run(hypothesisId);
      for (const r of rows) {
        this.sqlite
          .query(
            `INSERT INTO citation_verifications
               (id, hypothesis_id, session_id, raw_citation, status,
                canonical_title, doi, authors, year, match_score, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            uuidv4(), hypothesisId, sessionId, r.rawCitation, r.status,
            r.canonicalTitle ?? null, r.doi ?? null, r.authors ?? null,
            r.year ?? null, r.matchScore, now
          );
      }
    })();
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
    const rows = this.sqlite
      .query(
        `SELECT raw_citation, status, canonical_title, doi, authors, year, match_score
         FROM citation_verifications WHERE hypothesis_id = ? ORDER BY created_at ASC`
      )
      .all(hypothesisId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      rawCitation: r.raw_citation as string,
      status: r.status as "verified" | "unverified" | "fabricated",
      canonicalTitle: (r.canonical_title as string | null) ?? null,
      doi: (r.doi as string | null) ?? null,
      authors: (r.authors as string | null) ?? null,
      year: (r.year as number | null) ?? null,
      matchScore: r.match_score as number,
    }));
  }

  getCitationIntegrity(hypothesisId: string): {
    total: number; verified: number; unverified: number; fabricated: number; fabricationRate: number;
  } {
    const rows = this.sqlite
      .query(
        `SELECT status, count(*) as n FROM citation_verifications
         WHERE hypothesis_id = ? GROUP BY status`
      )
      .all(hypothesisId) as Array<{ status: string; n: number }>;
    const counts = { total: 0, verified: 0, unverified: 0, fabricated: 0 };
    for (const r of rows) {
      const n = Number(r.n);
      counts.total += n;
      if (r.status === "verified") counts.verified = n;
      else if (r.status === "unverified") counts.unverified = n;
      else if (r.status === "fabricated") counts.fabricated = n;
    }
    return {
      ...counts,
      fabricationRate: counts.total > 0 ? counts.fabricated / counts.total : 0,
    };
  }
```

- [ ] **Step 6: Extend `deleteSession` cleanup**

In `src/memory/contextStore.ts`, inside `deleteSession`, find the per-hypothesis loop that deletes `claimCitations` and add a citation_verifications delete next to it:

```ts
      this.db.delete(schema.claimCitations).where(eq(schema.claimCitations.hypothesisId, h.id)).run();
      this.sqlite.query(`DELETE FROM citation_verifications WHERE hypothesis_id = ?`).run(h.id);
```

- [ ] **Step 7: Run test to verify it passes**

Run: `bun test src/tests/citationIntegrity.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts src/db/migrate.ts src/memory/contextStore.ts src/tests/citationIntegrity.test.ts
git commit -m "feat(citation-integrity): add citation_verifications table + store methods"
```

---

## Task 2: Citation resolver (Crossref)

**Files:**
- Create: `src/tools/citationResolver.ts`
- Test: `src/tests/citationResolver.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tests/citationResolver.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import {
  extractDoi,
  titleSimilarity,
  resolveCitation,
  type FetchFn,
} from "../tools/citationResolver.js";

describe("extractDoi", () => {
  it("extracts a DOI from a doi.org URL", () => {
    expect(extractDoi("https://doi.org/10.1038/s41586-024-12345")).toBe("10.1038/s41586-024-12345");
  });
  it("extracts a bare DOI", () => {
    expect(extractDoi("10.1038/nature12373")).toBe("10.1038/nature12373");
  });
  it("returns null when there is no DOI", () => {
    expect(extractDoi("Smith et al. 2024, Nature")).toBeNull();
  });
});

describe("titleSimilarity (token-set Dice)", () => {
  it("is 1 for identical titles ignoring case/punctuation", () => {
    expect(titleSimilarity("Deep Learning, in Pathology!", "deep learning in pathology")).toBeCloseTo(1, 5);
  });
  it("is 0 for fully disjoint titles", () => {
    expect(titleSimilarity("alpha beta", "gamma delta")).toBe(0);
  });
  it("is between 0 and 1 for partial overlap", () => {
    const s = titleSimilarity("deep learning pathology", "deep learning radiology");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});

function crossrefWork(title: string, doi = "10.1/x") {
  return {
    ok: true, status: 200,
    json: async () => ({ message: { title: [title], DOI: doi, author: [{ family: "Doe", given: "J" }], issued: { "date-parts": [[2021]] } } }),
  };
}
function crossrefSearch(titles: string[]) {
  return {
    ok: true, status: 200,
    json: async () => ({ message: { items: titles.map((t, i) => ({ title: [t], DOI: `10.1/${i}`, author: [{ family: "Roe" }], issued: { "date-parts": [[2022]] } })) } }),
  };
}

describe("resolveCitation", () => {
  it("DOI that resolves (200) → verified with metadata", async () => {
    const fetchFn: FetchFn = async () => crossrefWork("Real Paper", "10.1038/abc");
    const r = await resolveCitation("https://doi.org/10.1038/abc", fetchFn);
    expect(r.status).toBe("verified");
    expect(r.doi).toBe("10.1038/abc");
    expect(r.canonicalTitle).toBe("Real Paper");
    expect(r.year).toBe(2021);
    expect(r.source).toBe("crossref");
  });

  it("DOI that 404s → fabricated", async () => {
    const fetchFn: FetchFn = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await resolveCitation("10.9999/does-not-exist", fetchFn);
    expect(r.status).toBe("fabricated");
    expect(r.matchScore).toBe(0);
    expect(r.source).toBe("crossref");
  });

  it("free-text with a close title match → verified", async () => {
    const fetchFn: FetchFn = async () => crossrefSearch(["Deep learning in computational pathology", "Unrelated work"]);
    const r = await resolveCitation("Deep learning in computational pathology", fetchFn);
    expect(r.status).toBe("verified");
    expect(r.matchScore).toBeGreaterThanOrEqual(0.7);
  });

  it("free-text with only weak matches → unverified", async () => {
    const fetchFn: FetchFn = async () => crossrefSearch(["Quantum chromodynamics of gluons"]);
    const r = await resolveCitation("Deep learning in computational pathology", fetchFn);
    expect(r.status).toBe("unverified");
    expect(r.source).toBe("none");
  });

  it("network error → unverified (never throws)", async () => {
    const fetchFn: FetchFn = async () => { throw new Error("network down"); };
    const r = await resolveCitation("10.1/x", fetchFn);
    expect(r.status).toBe("unverified");
  });

  it("coalesces duplicate lookups via cache", async () => {
    let calls = 0;
    // Use a 4-digit-registrant DOI so it takes the DOI (work) path matching crossrefWork's shape.
    const fetchFn: FetchFn = async () => { calls++; return crossrefWork("Cached", "10.5555/cache"); };
    await resolveCitation("10.5555/cache-test-unique", fetchFn);
    await resolveCitation("10.5555/cache-test-unique", fetchFn);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tests/citationResolver.test.ts`
Expected: FAIL — `Cannot find module '../tools/citationResolver.js'`.

- [ ] **Step 3: Write `src/tools/citationResolver.ts`**

```ts
import { logger } from "../config.js";

export type CitationStatus = "verified" | "unverified" | "fabricated";

export interface CitationResolution {
  raw: string;
  status: CitationStatus;
  canonicalTitle?: string;
  doi?: string;
  authors?: string;
  year?: number;
  matchScore: number;
  source: "crossref" | "none";
}

export type FetchFn = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const CROSSREF_BASE = "https://api.crossref.org/works";
const TITLE_MATCH_THRESHOLD = 0.7;
const TIMEOUT_MS = 6000;
const UA = "co-scientist/1.0 (citation-integrity; mailto:noreply@co-scientist.local)";

// In-process cache: coalesce duplicate lookups within a run.
const _cache = new Map<string, Promise<CitationResolution>>();

/** Extract the first DOI from a string (bare or inside a URL). Returns null if none. */
export function extractDoi(s: string): string | null {
  const m = s.match(/10\.\d{4,}\/[^\s"<>]+/);
  if (!m) return null;
  // Trim common trailing punctuation that isn't part of a DOI.
  return m[0].replace(/[.,;)\]]+$/, "");
}

function normalizeTitle(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Token-set Dice coefficient over normalized titles. 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const setA = new Set(normalizeTitle(a));
  const setB = new Set(normalizeTitle(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return (2 * inter) / (setA.size + setB.size);
}

interface CrossrefItem {
  title?: string[];
  DOI?: string;
  author?: Array<{ family?: string; given?: string }>;
  issued?: { "date-parts"?: number[][] };
}

function itemMeta(item: CrossrefItem): Pick<CitationResolution, "canonicalTitle" | "doi" | "authors" | "year"> {
  return {
    canonicalTitle: item.title?.[0],
    doi: item.DOI,
    authors: (item.author ?? []).map((a) => a.family).filter(Boolean).join(", ") || undefined,
    year: item.issued?.["date-parts"]?.[0]?.[0],
  };
}

async function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("crossref timeout")), TIMEOUT_MS)),
  ]);
}

/** Resolve one citation string to an existence verdict via Crossref. Never throws. */
export function resolveCitation(raw: string, fetchFn: FetchFn = globalFetch): Promise<CitationResolution> {
  const key = raw.trim().toLowerCase();
  const cached = _cache.get(key);
  if (cached) return cached;
  const promise = _resolve(raw, fetchFn);
  _cache.set(key, promise);
  return promise;
}

const globalFetch: FetchFn = (url) =>
  fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } }) as unknown as ReturnType<FetchFn>;

async function _resolve(raw: string, fetchFn: FetchFn): Promise<CitationResolution> {
  const doi = extractDoi(raw);
  try {
    if (doi) {
      const res = await withTimeout(fetchFn(`${CROSSREF_BASE}/${encodeURIComponent(doi)}`));
      if (res.status === 404) {
        return { raw, status: "fabricated", matchScore: 0, source: "crossref" };
      }
      if (res.ok) {
        const body = (await res.json()) as { message?: CrossrefItem };
        const meta = itemMeta(body.message ?? {});
        return { raw, status: "verified", matchScore: 1, source: "crossref", ...meta };
      }
      // Other non-OK (rate limit, 5xx) — can't confirm; treat as unverified.
      return { raw, status: "unverified", matchScore: 0, source: "none" };
    }

    // No DOI: bibliographic title search.
    const url = `${CROSSREF_BASE}?query.bibliographic=${encodeURIComponent(raw)}&rows=3`;
    const res = await withTimeout(fetchFn(url));
    if (!res.ok) return { raw, status: "unverified", matchScore: 0, source: "none" };
    const body = (await res.json()) as { message?: { items?: CrossrefItem[] } };
    const items = body.message?.items ?? [];
    let best: CrossrefItem | null = null;
    let bestScore = 0;
    for (const item of items) {
      const score = titleSimilarity(raw, item.title?.[0] ?? "");
      if (score > bestScore) { bestScore = score; best = item; }
    }
    if (best && bestScore >= TITLE_MATCH_THRESHOLD) {
      return { raw, status: "verified", matchScore: bestScore, source: "crossref", ...itemMeta(best) };
    }
    return { raw, status: "unverified", matchScore: bestScore, source: "none" };
  } catch (err) {
    logger.warn(`[CitationResolver] lookup failed for "${raw.slice(0, 60)}": ${(err as Error).message}`);
    return { raw, status: "unverified", matchScore: 0, source: "none" };
  }
}

/** Test/maintenance helper: clear the in-process cache. */
export function _resetCitationCache(): void {
  _cache.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/tests/citationResolver.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/citationResolver.ts src/tests/citationResolver.test.ts
git commit -m "feat(citation-integrity): Crossref-backed citation resolver"
```

---

## Task 3: Pure penalty function

**Files:**
- Create: `src/agents/citationIntegrity.ts` (penalty function only in this task; agent class added in Task 4)
- Test: `src/tests/citationIntegrity.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing test**

Append to `src/tests/citationIntegrity.test.ts` (add the import at the top with the other imports):

```ts
import { citationPenalty } from "../agents/citationIntegrity.js";

describe("citationPenalty", () => {
  it("no citations → no penalty", () => {
    const p = citationPenalty({ total: 0, unverified: 0, fabricated: 0 });
    expect(p.f).toBe(0);
    expect(p.ratingDelta).toBe(0);
    expect(p.rdDelta).toBe(0);
  });

  it("all verified → no penalty", () => {
    const p = citationPenalty({ total: 4, unverified: 0, fabricated: 0 });
    expect(p.ratingDelta).toBe(0);
    expect(p.rdDelta).toBe(0);
  });

  it("all fabricated → full penalty and full RD widening", () => {
    const p = citationPenalty({ total: 3, unverified: 0, fabricated: 3 });
    expect(p.f).toBeCloseTo(1, 5);
    expect(p.ratingDelta).toBe(-150);
    expect(p.rdDelta).toBe(100);
  });

  it("unverified counts half as much as fabricated", () => {
    const p = citationPenalty({ total: 2, unverified: 2, fabricated: 0 });
    expect(p.f).toBeCloseTo(0.5, 5);
    expect(p.ratingDelta).toBe(-75);
    expect(p.rdDelta).toBe(50);
  });

  it("mixed case is proportional", () => {
    const p = citationPenalty({ total: 4, unverified: 1, fabricated: 1 });
    // f = (1 + 0.5*1)/4 = 0.375
    expect(p.f).toBeCloseTo(0.375, 5);
    expect(p.ratingDelta).toBe(Math.round(-0.375 * 150));
    expect(p.rdDelta).toBe(Math.round(0.375 * 100));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tests/citationIntegrity.test.ts`
Expected: FAIL — `Cannot find module '../agents/citationIntegrity.js'`.

- [ ] **Step 3: Create `src/agents/citationIntegrity.ts` with the pure function**

```ts
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
    ratingDelta: -Math.round(f * MAX_PENALTY),
    rdDelta: Math.round(f * MAX_RD_WIDEN),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/tests/citationIntegrity.test.ts`
Expected: PASS (all Task 1 + Task 3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agents/citationIntegrity.ts src/tests/citationIntegrity.test.ts
git commit -m "feat(citation-integrity): pure soft-penalty function"
```

---

## Task 4: CitationIntegrityAgent

**Files:**
- Modify: `src/agents/citationIntegrity.ts` (add the agent class)
- Test: `src/tests/citationIntegrity.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing test**

Append to `src/tests/citationIntegrity.test.ts`:

```ts
import { CitationIntegrityAgent } from "../agents/citationIntegrity.js";
import type { FetchFn } from "../tools/citationResolver.js";

describe("CitationIntegrityAgent.execute", () => {
  it("persists per-citation rows and returns the penalty", async () => {
    const h = store.saveHypothesis({
      sessionId,
      title: "Cited Hyp", summary: "s", content: "c", rationale: "r",
      generationStrategy: "literature_exploration",
      eloRating: 1300, ratingDeviation: 200, volatility: 0.06,
      matchesPlayed: 0, wins: 0, losses: 0, draws: 0,
      status: "reviewing", parentIds: [], generationRound: 1,
      keyAssumptions: [],
      citations: ["10.1038/real", "10.9999/fake"],
    });

    // Stub fetch: the "real" DOI resolves (200), the "fake" DOI 404s.
    // Both have 4-digit registrants so extractDoi takes the DOI path.
    const fetchFn: FetchFn = async (url) =>
      url.includes("real")
        ? { ok: true, status: 200, json: async () => ({ message: { title: ["Real"], DOI: "10.1038/real" } }) }
        : { ok: false, status: 404, json: async () => ({}) };

    const agent = new CitationIntegrityAgent(fetchFn);
    const penalty = await agent.execute(sessionId, h);

    const rows = store.getCitationVerifications(h.id);
    expect(rows.length).toBe(2);
    expect(rows.some((r) => r.status === "verified")).toBe(true);
    expect(rows.some((r) => r.status === "fabricated")).toBe(true);
    // f = (1 + 0)/2 = 0.5 → -75
    expect(penalty.ratingDelta).toBe(-75);
  });

  it("no-ops on a hypothesis with no citations", async () => {
    const h = addHyp();
    const agent = new CitationIntegrityAgent(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const penalty = await agent.execute(sessionId, h);
    expect(penalty.ratingDelta).toBe(0);
    expect(store.getCitationVerifications(h.id).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tests/citationIntegrity.test.ts`
Expected: FAIL — `CitationIntegrityAgent is not a constructor`.

- [ ] **Step 3: Add the agent class to `src/agents/citationIntegrity.ts`**

Append after the `citationPenalty` function:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/tests/citationIntegrity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/citationIntegrity.ts src/tests/citationIntegrity.test.ts
git commit -m "feat(citation-integrity): CitationIntegrityAgent orchestration"
```

---

## Task 5: Wire into ReflectionAgent (fold penalty into Glicko-2 seeding)

**Files:**
- Modify: `src/agents/reflection.ts`

This task changes runtime behaviour inside the LLM review pipeline. There is no isolated unit test for the wiring (it lives between LLM calls); correctness is covered by Task 4's agent test + the full-suite/`tsc` gate. Verify by code review + the gate.

- [ ] **Step 1: Add the import**

At the top of `src/agents/reflection.ts`, with the other imports:

```ts
import { CitationIntegrityAgent } from "./citationIntegrity.js";
```

- [ ] **Step 2: Instantiate the agent as a field**

Next to `private provenance = new ProvenanceAgent();`:

```ts
  private citationIntegrity = new CitationIntegrityAgent();
```

- [ ] **Step 3: Run the pass after provenance and fold the penalty into seeding**

In `_reviewHypothesis`, the current provenance line is:

```ts
    // Provenance: anchor claims to literature before entering tournament
    await this.provenance.execute(sessionId, hyp);
```

Immediately after it, add (note: `citePenalty`, not `citationPenalty` — the latter is the imported pure function and must not be shadowed):

```ts
    // Citation integrity: verify cited papers exist; penalty folded into seeding below.
    const citePenalty = await this.citationIntegrity.execute(sessionId, hyp);
```

Then find the seeding block (currently `reflection.ts:123`):

```ts
    const seededRating = seededGlicko2Rating(bestNovelty, bestCorrectness, bestTestability);
    if (seededRating.rating !== 1200) {
      // Only write back if the seeded value actually differs to avoid a no-op update
      this.memory.updateHypothesisRating(
        hyp.id, seededRating.rating, seededRating.rd, seededRating.volatility, 0, 0, 0
      );
      this.log(
        "info",
        `Seeded Glicko-2 rating for "${hyp.title}": ${seededRating.rating} (RD=${seededRating.rd}) ` +
        `(novelty=${bestNovelty ?? "n/a"}, correctness=${bestCorrectness ?? "n/a"}, testability=${bestTestability ?? "n/a"})`
      );
    }
```

Replace that whole block with:

```ts
    const seededRating = seededGlicko2Rating(bestNovelty, bestCorrectness, bestTestability);
    // Fold the citation-integrity penalty into the seed: lower rating, wider RD.
    const finalRating = Math.max(1000, seededRating.rating + citePenalty.ratingDelta);
    const finalRd = Math.min(350, seededRating.rd + citePenalty.rdDelta);
    if (finalRating !== 1200 || finalRd !== seededRating.rd) {
      // Only write back if the seeded/penalized value actually differs from default.
      this.memory.updateHypothesisRating(
        hyp.id, finalRating, finalRd, seededRating.volatility, 0, 0, 0
      );
      this.log(
        "info",
        `Seeded Glicko-2 rating for "${hyp.title}": ${finalRating} (RD=${finalRd}) ` +
        `(novelty=${bestNovelty ?? "n/a"}, correctness=${bestCorrectness ?? "n/a"}, testability=${bestTestability ?? "n/a"}` +
        (citePenalty.ratingDelta !== 0 ? `, citation penalty=${citePenalty.ratingDelta}` : "") + ")"
      );
    }
```

- [ ] **Step 4: Typecheck + full suite**

Run: `bunx tsc --noEmit`
Expected: exit 0, no errors.

Run: `bun test`
Expected: all pass (previous count + the new citation tests).

- [ ] **Step 5: Commit**

```bash
git add src/agents/reflection.ts
git commit -m "feat(citation-integrity): run verification in reflection, penalize seeding"
```

---

## Task 6: Surface integrity in results + export

**Files:**
- Modify: `src/cli/commands/list.ts` (the `showFeedback` block in `resultsCommand`)
- Modify: `src/cli/commands/export.ts` (markdown citations block + JSON branch)

- [ ] **Step 1: Add a shared formatting helper to `src/agents/citationIntegrity.ts`**

Append this pure helper (so both CLI commands and any future caller share one format):

```ts
/** One-line human summary, e.g. "4 verified · 1 unverified · 2 fabricated". Empty string when no citations. */
export function formatCitationIntegrity(s: {
  total: number; verified: number; unverified: number; fabricated: number;
}): string {
  if (s.total === 0) return "";
  return `${s.verified} verified · ${s.unverified} unverified · ${s.fabricated} fabricated`;
}
```

- [ ] **Step 2: Show in `results` (`src/cli/commands/list.ts`)**

Add the import at the top:

```ts
import { formatCitationIntegrity } from "../../agents/citationIntegrity.js";
```

NOTE: in this file the store is named `memory`, not `store`. The citation block must be placed at the top level of the `hypotheses.forEach((h, i) => { ... })` body (NOT inside the `if (feedbacks.length > 0)` block, or it would be skipped for hypotheses without feedback). Insert it immediately after the provenance-claim-detail block — i.e. right after the closing brace of `if (claims.length > 0) { ... }` (currently `list.ts:143`) and before `// RLEF: feedback summary`:

```ts
    // Citation integrity (existence of cited papers — distinct from provenance claim anchoring)
    const integ = memory.getCitationIntegrity(h.id);
    const integLine = formatCitationIntegrity(integ);
    if (integLine) {
      const color = integ.fabricated > 0 ? chalk.red : integ.unverified > 0 ? chalk.yellow : chalk.green;
      console.log(`   ${color(`📚 Citations: ${integLine}`)}`);
      if (integ.fabricated > 0) {
        memory.getCitationVerifications(h.id)
          .filter((c) => c.status === "fabricated")
          .forEach((c) => console.log(chalk.red(`      ✗ ${c.rawCitation.slice(0, 80)}`)));
      }
    }
```

- [ ] **Step 3: Show in `export` (`src/cli/commands/export.ts`)**

Add the import at the top:

```ts
import { formatCitationIntegrity } from "../../agents/citationIntegrity.js";
```

NOTE: in this file the store is named `memory`, not `store`.

In the markdown branch, replace the existing citations block (currently `export.ts:162-167`):

```ts
      if (h.citations.length > 0) {
        lines.push(`**Citations:**`);
        lines.push("");
        h.citations.forEach((c) => lines.push(`- ${c}`));
        lines.push("");
      }
```

with (preserves the 6-space indent and the blank `lines.push("")` after the heading):

```ts
      if (h.citations.length > 0) {
        const integ = memory.getCitationIntegrity(h.id);
        const integLine = formatCitationIntegrity(integ);
        lines.push(`**Citations:**${integLine ? ` _(${integLine})_` : ""}`);
        lines.push("");
        const statusByRaw = new Map(
          memory.getCitationVerifications(h.id).map((v) => [v.rawCitation.trim(), v.status])
        );
        h.citations.forEach((c) => {
          const st = statusByRaw.get(c.trim());
          const mark = st === "fabricated" ? " ⚠️ fabricated" : st === "unverified" ? " ⚠️ unverified" : "";
          lines.push(`- ${c}${mark}`);
        });
        lines.push("");
      }
```

For the JSON branch: each hypothesis object is built inside `hypotheses.map((h, i) => ({ ... }))` (currently `export.ts:49-79`). Add two fields to that object literal, immediately after the `reviews: memory.getReviews(h.id).map(...)` entry and its trailing comma (i.e. just before the `}))` that closes the map callback):

```ts
          citationIntegrity: memory.getCitationIntegrity(h.id),
          citationVerifications: memory.getCitationVerifications(h.id),
```

- [ ] **Step 4: Typecheck + full suite**

Run: `bunx tsc --noEmit`
Expected: exit 0.

Run: `bun test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/list.ts src/cli/commands/export.ts src/agents/citationIntegrity.ts
git commit -m "feat(citation-integrity): surface verification status in results + export"
```

---

## Task 7: Final verification + PR

- [ ] **Step 1: Full gate**

Run: `bun test`
Expected: all pass, 0 fail.

Run: `bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin feature/cluster2-citation-integrity
gh pr create --base main --head feature/cluster2-citation-integrity \
  --title "feat: citation-integrity checker (Crossref verification + soft penalty)" \
  --body "Implements #6 per docs/superpowers/specs/2026-06-01-citation-integrity-design.md. Verifies each hypothesis citation against Crossref (verified/unverified/fabricated), persists results to citation_verifications, and folds a soft Glicko-2 penalty into reflection seeding. Surfaced in results --show-feedback and export."
```

---

## Notes for the implementer

- **Crossref response shape:** `/works/{doi}` → `{ message: {...item} }`; `/works?query.bibliographic=...` → `{ message: { items: [...] } }`. Year is read from `issued["date-parts"][0][0]`.
- **Never throw from the resolver or agent** — a degraded network must not break the review pipeline. Failures map to `unverified`.
- **Why a separate agent from `ProvenanceAgent`:** provenance checks whether *claims are supported*; this checks whether *cited papers exist*. They write to different tables and must stay independent.
- **The resolver cache is module-global.** Tests that count `fetch` calls must use unique citation strings (the plan's cache test does this).
