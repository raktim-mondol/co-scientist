# Design Spec: Publishable Report Generator

**Date:** 2026-07-03
**Status:** Implemented
**Branch:** `feature/publishable-report-generator`

## Problem

When a session ends, the only structured output is `co-scientist export`
(`src/cli/commands/export.ts`): a metadata table + per-hypothesis field dump, with
citations listed per hypothesis (no global bibliography, no inline `[n]` markers) and
only Markdown/JSON formats. It is not something a researcher can take toward a
manuscript. The system is otherwise mature, so the weakest link for a *professional*
tool is its final deliverable.

## Goal

Add `co-scientist report <sessionId>` (+ `/report` TUI command) that produces a
publication-style manuscript: **Abstract → Background → Methods → Results → Discussion →
Limitations → References**, with a global de-duplicated numbered bibliography and inline
`[n]` markers, exportable to Markdown and LaTeX (no new deps) plus DOCX/PDF via pandoc.

This is additive: `export` stays as the raw data dump; `report` is the polished artifact.

## Key principle: honest citations & numbers

Narrative sections (abstract/background/discussion/limitations) are LLM-synthesized in a
single structured call. **Methods, the Results tables, and the References are assembled
deterministically from the DB**, so the model never invents statistics or citations.

## Components

| Concern | Module |
|---|---|
| Orchestration | `src/agents/report.ts` — `ReportAgent.generateManuscript(sessionId, {topN, resolver})` |
| Bibliography | `src/agents/reportBibliography.ts` — dedupe (by DOI, else normalized title) + stable `[n]` numbering via the existing CrossRef resolver (`src/tools/citationResolver.ts`) |
| Rendering | `src/agents/reportRenderers.ts` — `toMarkdown`, `toLatex` (pure), `convertWithPandoc`/`isPandocAvailable` (docx/pdf, graceful when pandoc absent) |
| Model | `src/models/manuscript.ts` — `Manuscript`, `BibEntry`, etc. |
| Persistence | `manuscripts` table (`src/db/schema.ts`, `src/db/migrate.ts`) + `ManuscriptStore` + `ContextStore.{save,get}Manuscript` |
| Narrative prompt | `src/prompts/report/manuscript.yaml` (single JSON call, Zod-validated) |
| CLI | `src/cli/commands/report.ts`, registered in `src/cli/index.ts` |
| TUI | `src/cli/tui/commands/reportCmd.ts`, imported in `App.tsx` |
| Config | `report.{defaultFormat,topN,pandocPath}` in `src/config.ts` (env: `REPORT_DEFAULT_FORMAT`, `REPORT_TOP_N`, `PANDOC_PATH`) |

## Caching

The generated manuscript is stored (one row per session) in `manuscripts`. `report`
reuses it; `report --regenerate` re-runs the LLM and overwrites. This keeps re-exports
(e.g. md then latex) free of extra LLM calls.

## Reuse (no reimplementation)

- CrossRef resolution: `resolveCitation` / `extractDoi` (`src/tools/citationResolver.ts`).
- LLM + prompt loading: `BaseAgent.callLLMForJSON` / `loadPrompt`.
- Session/hypothesis/review/protocol reads: existing `ContextStore` methods (as in `export.ts`).
- Migration + store split conventions: `evidence_sources` / `EvidenceStore` as the template.

## Verification

- Unit tests: `src/tests/report.test.ts` (bibliography dedupe/numbering, marker mapping,
  markdown section order + references + unverified flag, LaTeX escaping + `thebibliography`,
  pandoc-absent error, persistence round-trip + upsert).
- End-to-end: driven against a real completed session (`vlm_method_histopath`, 6 top
  hypotheses, 13 references) — Markdown (33 KB) and LaTeX (29 KB) rendered from the cached
  manuscript with correct inline markers and a single numbered bibliography; PDF without
  pandoc returns an actionable error (no stack trace).
- `bun test`: 324 pass / 0 fail. Type errors unchanged from baseline (29 pre-existing, 0 new).
