# Cluster 2 — Citation-Integrity Checker

**Date:** 2026-06-01
**Status:** Awaiting spec review
**Branch:** `feature/cluster2-citation-integrity` (off `main` @ `eef5e65`)
**Scope:** Feature **#6** from the agreed roadmap. Second of the remaining clusters; ships on its own branch + PR.

---

## 1. Context & problem

A hypothesis carries a free-text `citations: string[]` (`src/models/hypothesis.ts:57`). The generation prompt literally asks the LLM for `"citations": ["url1", "url2"]` (`src/prompts/generation/literature_exploration.yaml:39`), and **nothing ever verifies those references exist**. They flow unchecked into the knowledge graph, exports, and diffs. Fabricated references are the classic LLM failure mode and a credibility risk — especially for this project's literature-review domain.

The existing `ProvenanceAgent` is the right structural template but answers a **different** question, so the two are complementary (not redundant):

- **ProvenanceAgent:** "do real papers *support* the hypothesis's claims?" — it searches for relevant papers itself and records support/contradicts/unaddressed.
- **CitationIntegrityAgent (new):** "do the papers the hypothesis *explicitly cited* (`hyp.citations`) actually *exist*?" — it resolves the given references against an authoritative index.

## 2. Goals / non-goals

**Goals**
- Resolve each `citations[]` entry against an authoritative bibliographic index and classify it `verified | unverified | fabricated`.
- Persist per-citation results; surface them in `results`/`export`.
- Apply a *soft* rating penalty proportional to the fabrication rate so honestly-cited hypotheses outrank fabricated ones, while keeping the hypothesis in the tournament.
- No new auth/keys; degrade gracefully when offline.

**Non-goals (explicit scope cuts)**
- Semantic Scholar fallback (Crossref only this cluster — avoids S2's stricter unkeyed rate limits).
- HTTP-fetching arbitrary citation URLs (too brittle/slow).
- A standalone CLI verify command (inline-in-reflection only, per decision).
- Retro-verifying citations from past sessions.
- Changing knowledge-graph citation nodes.

## 3. Architecture & placement

- **`src/agents/citationIntegrity.ts`** — new `CitationIntegrityAgent extends BaseAgent`. Pure orchestration: read `hyp.citations`, call the resolver per entry, persist, compute + apply penalty.
- **`src/tools/citationResolver.ts`** — owns all external lookup, separate from the agent so it is independently unit-testable and the agent holds no HTTP logic.
- **Placement:** invoked from `ReflectionAgent._reviewHypothesis` immediately after `await this.provenance.execute(sessionId, hyp)` (`src/agents/reflection.ts:79`), before the hypothesis is marked `active` and seeded — so the penalty can fold into the same Glicko-2 seeding step.

## 4. Resolver — `citationResolver.ts`

Main export: `resolveCitation(raw: string, fetchFn?): Promise<CitationResolution>`. `fetchFn` is injectable (defaults to global `fetch`) so tests run offline.

```ts
interface CitationResolution {
  raw: string;
  status: "verified" | "unverified" | "fabricated";
  canonicalTitle?: string;
  doi?: string;
  authors?: string;     // comma-joined
  year?: number;
  matchScore: number;   // 0..1
  source: "crossref" | "none";
}
```

Resolution strategy per entry (URL, bare DOI, or free-text):
1. **DOI path:** extract a DOI (`/10\.\d{4,}\/[^\s"]+/`, also from `doi.org/` URLs). Query Crossref `GET https://api.crossref.org/works/{doi}` (no auth).
   - 200 → `verified` (canonical title/authors/year/DOI from response), `matchScore = 1`, `source = "crossref"`.
   - **404 → `fabricated`** (a confidently-wrong identifier is the strongest fabrication signal), `matchScore = 0`, `source = "crossref"`.
2. **Title/bibliographic path** (no DOI in the string): `GET https://api.crossref.org/works?query.bibliographic={raw}&rows=3`. Compute Dice coefficient over normalized title token sets between `raw` and each candidate; take the best.
   - best ≥ `TITLE_MATCH_THRESHOLD` (0.7) → `verified` with that candidate's metadata, `matchScore = best`.
   - else → `unverified` (`matchScore = best`, `source = "none"`).
3. **Non-DOI publisher URLs** (arXiv/PubMed/journal): attempt to extract an identifier and resolve as in (1); if none extractable → `unverified` (we do not fetch arbitrary pages).

Robustness:
- 6s timeout per lookup (`AbortController`). Network/timeout/parse errors → `unverified` + logged warning; **never throw** (a degraded network must not break reflection).
- In-process cache keyed by trimmed-lowercased `raw` (mirrors `SearchTool` dedup cache), coalescing duplicate lookups.
- A polite `User-Agent` header per Crossref etiquette.

## 5. Data model & persistence

New table **`citation_verifications`** — Drizzle table in `src/db/schema.ts` + idempotent `CREATE TABLE IF NOT EXISTS` in `src/db/migrate.ts` (existing pattern).

| column | type | note |
|---|---|---|
| `id` | text PK | uuid |
| `hypothesis_id` | text FK → hypotheses | |
| `session_id` | text FK → sessions | |
| `raw_citation` | text | original string |
| `status` | text | verified / unverified / fabricated |
| `canonical_title` | text nullable | from Crossref |
| `doi` | text nullable | |
| `authors` | text nullable | |
| `year` | int nullable | |
| `match_score` | real | 0..1 |
| `created_at` | int | |

Index: `idx_citation_verifications_hypothesis(hypothesis_id)`.

`ContextStore` additions:
- `saveCitationVerifications(hypId, sessionId, rows[])` — deletes prior rows for the hypothesis first, then inserts (idempotent re-run, like embeddings).
- `getCitationVerifications(hypId)` — raw rows.
- `getCitationIntegrity(hypId)` — summary `{ total, verified, unverified, fabricated, fabricationRate }`.
- `deleteSession` child-cleanup loop gains a `DELETE FROM citation_verifications WHERE hypothesis_id = ?` per hypothesis.

## 6. Soft penalty

Pure, unit-testable function `citationPenalty(summary): { ratingDelta: number; rdDelta: number; f: number }` in `citationIntegrity.ts` (or a small sibling module):

- Fabrication rate `f = (fabricated + 0.5 * unverified) / total`. **`total === 0` ⇒ `f = 0`** (nothing to fabricate ⇒ no penalty).
- `ratingDelta = -round(f * MAX_PENALTY)`, `MAX_PENALTY = 150`.
- `rdDelta = round(f * 100)`.

Applied in `reflection.ts` at the existing seeding step (`reflection.ts:123`):
- `rating = max(1000, seededRating.rating + ratingDelta)` (floor 1000).
- `rd = min(350, seededRating.rd + rdDelta)`.
- Written via the existing `updateHypothesisRating(...)`. If both deltas are 0 and the seed is unchanged, skip the write (avoid no-op), consistent with current behaviour.

Rationale: keeps the hypothesis in the tournament (soft, not reject) while ranking honest hypotheses higher and giving fabricated ones wider RD ⇒ more match scrutiny.

## 7. Surfacing

- `src/cli/commands/list.ts` (`results --show-feedback`): one compact line per hypothesis, e.g.
  `Citations: 4 verified · 1 unverified · 2 fabricated (penalty −43, RD +21)`, with fabricated entries listed by their raw text.
- `src/cli/commands/export.ts`: same summary in the per-hypothesis section (markdown + JSON).
- Knowledge-graph citation nodes unchanged this cluster.

## 8. Components & interfaces summary

| Unit | Purpose | Depends on |
|---|---|---|
| `tools/citationResolver.ts` | Resolve one citation string → existence verdict + metadata | `fetch` (injectable), Crossref |
| `agents/citationIntegrity.ts` | Orchestrate per-hypothesis verification + penalty | resolver, `ContextStore` |
| `citationPenalty()` | Pure rate→(rating/RD delta) mapping | none |
| `citation_verifications` table + store methods | Persist + summarize results | sqlite/Drizzle |
| reflection hook | Run pass, fold penalty into Glicko-2 seed | agent, store |
| results/export surfacing | Show integrity to the user | store summary |

## 9. Testing (TDD — pure logic first)

- `src/tests/citationResolver.test.ts` — DOI extraction (URL / bare / none); Dice title-similarity at/above/below threshold; status mapping (200→verified, 404→fabricated, weak→unverified, error→unverified); cache coalescing. HTTP stubbed via injected `fetchFn`; runs offline.
- `src/tests/citationPenalty.test.ts` — `f=0` (incl. zero-citation) ⇒ no penalty; all-fabricated ⇒ full penalty + 1000 floor; mixed ⇒ proportional; RD widening + 350 cap.
- `src/tests/citationIntegrity.test.ts` — agent against in-memory DB with a **stubbed resolver**, asserting persisted rows + the rating/RD delta applied to the hypothesis (isolation pattern from `rlef.test.ts` / `knowledgeGraph.test.ts`).
- Gate: full suite green + `tsc --noEmit` clean.

## 10. Implementation order (post-approval)
1. Schema + migration + `ContextStore` methods (+ `deleteSession` cleanup).
2. `citationResolver.ts` + tests.
3. `citationPenalty()` + tests.
4. `CitationIntegrityAgent` + tests.
5. Wire into `ReflectionAgent` (penalty into seeding).
6. Surface in `results`/`export`.
7. Full suite + `tsc`; commit; PR.
