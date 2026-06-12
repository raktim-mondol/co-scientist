# Deep Evidence Pipeline — Design Spec

**Date:** 2026-06-12
**Branch:** `feature/deep-evidence-pipeline`
**Status:** Approved by maintainer (architecture, DB, prompts/config, error handling/testing all approved 2026-06-12)

## Motivation

Co-scientist's `literature_exploration` generation strategy is grounded in search-result
*snippets*: one `SearchTool.multiSearch` call → formatted snippet blob → one LLM call →
hypothesis. The system never reads actual page/paper content, and gathered literature is
discarded after each generation task.

Tongyi DeepResearch (Alibaba) demonstrates a stronger pattern: an iterative research loop
that *visits* sources with a goal-directed extractor producing `{rationale, evidence,
summary}` per page, accumulating an evidence memory that grounds downstream synthesis
(WebWeaver's cited memory bank; IterResearch's evolving report).

This feature ports the bounded, structured core of that idea:

1. an **iterative search → read → bank research loop** inside generation, and
2. a **persistent, cited evidence bank** per session — the durable asset that
   reflection/provenance and the final research overview can consume in follow-up branches.

## Scope (v1)

- **In:** `LiteratureResearchAgent` + evidence bank, wired into
  `GenerationAgent.literature_exploration` only.
- **Out (follow-up branches):** reflection/provenance reading from the evidence bank;
  WebWeaver-style section-by-section research overview; sqlite-vec virtual table for
  evidence ANN search.
- All code in TypeScript, matching existing codebase conventions.

## Architecture

New agent `src/agents/literatureResearch.ts` — `LiteratureResearchAgent extends BaseAgent`,
invoked inline by `GenerationAgent` (same pattern as `ProvenanceAgent` inside reflection).

### Loop (bounded, fixed shape)

`research(sessionId, goal, initialQueries)` runs up to `config.research.maxRounds` rounds
(default 2). Each round:

1. **Search** — existing `SearchTool.multiSearch(queries, "auto")`. Collect candidate URLs;
   drop URLs already in the session's evidence bank (`hasVisitedUrl`).
2. **Plan** — one LLM call (`research/plan.yaml`, mode `chat`): sees research goal, evidence
   digest so far, open gaps, and candidate URLs (title + snippet). Returns JSON
   `{ sufficient: boolean, gaps: string[], nextQueries: string[], urlsToRead: string[] }`.
   If `sufficient` → stop early.
3. **Read** — `parallel-web` SDK `client.extract()` on up to `config.research.urlsPerRound`
   chosen URLs (batch call, existing `PARALLEL_AI_API_KEY`). For each successfully fetched
   source, one extractor LLM call (`research/extract.yaml`, mode `chat`) with content
   truncated to `config.research.maxContentChars` → JSON
   `{ rationale, evidence, summary }` (DeepResearch `EXTRACTOR_PROMPT` adaptation).
4. **Bank** — persist each source as an `evidence_sources` row with an embedding
   (existing embedding pipeline), deduped by `(sessionId, url)`.

Returns a **numbered evidence digest**: `[E1] title — url (date) — summary + key evidence
excerpt`, plus the structured source list.

### Generation wiring

In `GenerationAgent._literatureExploration`:

- Replace `formatSearchContext(results)` with the evidence digest as `literatureContext`
  when the loop produced ≥1 evidence row.
- Prompt instructs the model to cite `[E#]` markers; cited sources map into the
  hypothesis's `citationsJson` (url, title, doi when present).
- Existing diversity steering (`diversityContext`) and the save-time near-duplicate gate
  are unchanged.

### Cost profile

Per generation task: ≤ maxRounds × (1 plan call + urlsPerRound extractor calls), all
`mode: "chat"`. Defaults: ≤ 2 × (1 + 3) = 8 extra chat calls. `maxRounds = 0` disables the
feature entirely (snippet path, current behavior).

## Database

New table `evidence_sources` (Drizzle definition in `src/db/schema.ts`, idempotent
`CREATE TABLE IF NOT EXISTS` in `src/db/migrate.ts`):

| column        | type    | notes                                  |
| ------------- | ------- | -------------------------------------- |
| id            | text PK | uuid                                   |
| sessionId     | text    | FK sessions.id                         |
| url           | text    | unique with sessionId                  |
| title         | text    |                                        |
| doi           | text?   |                                        |
| publishedDate | text?   |                                        |
| goal          | text    | research goal used during extraction   |
| rationale     | text    | extractor output                       |
| evidence      | text    | extractor output (verbatim excerpts)   |
| summary       | text    | extractor output                       |
| round         | integer | which loop round produced it           |
| embeddingBlob | blob    | Float32Array of summary embedding      |
| createdAt     | integer | timestamp                              |

Unique index on `(session_id, url)`.

New `ContextStore` methods (only layer touching the DB):

- `saveEvidence(row)` — upsert by (sessionId, url)
- `getEvidenceBySession(sessionId)`
- `hasVisitedUrl(sessionId, url)`
- `getRelevantEvidence(sessionId, embedding, k)` — cosine over blobs in TypeScript,
  reusing the pure cosine helper from the diversity work (row counts are small; sqlite-vec
  virtual table deferred to the follow-up that adds more consumers)

## Prompts

New category `src/prompts/research/` (standard YAML: system/user/mode/max_tokens):

- `plan.yaml` — round controller. Inputs: researchGoal, evidenceDigest, gaps,
  candidateUrls. Output JSON: `{sufficient, gaps, nextQueries, urlsToRead}`.
- `extract.yaml` — goal-directed evidence extractor. Inputs: pageContent (truncated),
  goal. Output JSON: `{rationale, evidence, summary}`.

Updated: `src/prompts/generation/literature_exploration.yaml` — consumes the cited digest;
instructs `[E#]` citation usage.

## Config

Zod schema + env mapping in `src/config.ts` (style mirrors `generation.diversityThreshold`):

| key                        | env                        | default |
| -------------------------- | -------------------------- | ------- |
| `research.maxRounds`       | `DEEP_RESEARCH_MAX_ROUNDS` | 2       |
| `research.urlsPerRound`    | `DEEP_RESEARCH_URLS_PER_ROUND` | 3   |
| `research.maxContentChars` | `DEEP_RESEARCH_MAX_CONTENT_CHARS` | 40000 |

`maxRounds: 0` → loop skipped, snippet fallback used.

## Error handling

Strictly additive — no failure mode may break generation:

- `PARALLEL_AI_API_KEY` missing → loop skipped, snippet path (warn once).
- `extract()` failure for a URL → skip that source, log warn, continue.
- Extractor JSON parse failure (after `callLLMForJSON` retries) → skip source.
- Plan JSON parse failure → end loop with evidence gathered so far.
- Zero evidence after the loop → fall back to `formatSearchContext` snippets.
- Hard cap at `maxRounds` regardless of LLM output.

## Testing (bun:test, TDD)

- **Pure helpers** (direct unit tests): evidence digest formatter, URL
  normalization/dedupe, round-control decision (`shouldContinue`).
- **ContextStore**: evidence CRUD + `getRelevantEvidence` ranking against a temp DB,
  following existing test patterns.
- **LiteratureResearchAgent**: loop behavior with mocked search/extract/LLM — early stop
  on `sufficient`, hard cap, per-source failure skipping, fallback on zero evidence.
- No live API calls in tests.
