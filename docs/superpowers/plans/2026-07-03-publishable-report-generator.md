# Implementation Plan: Publishable Report Generator

**Spec:** `docs/superpowers/specs/2026-07-03-publishable-report-generator-design.md`
**Branch:** `feature/publishable-report-generator`
**Status:** Complete (all tasks done; `bun test` green)

TDD order — each step written test-first where the logic is pure.

1. **Model** — `src/models/manuscript.ts` (`Manuscript`, `BibEntry`, `ManuscriptHypothesis`,
   `ManuscriptMethods`, `ManuscriptProtocol`).
2. **Bibliography** — `src/agents/reportBibliography.ts` (`buildBibliography`, `markersFor`),
   resolver injectable for offline tests. Dedupe by DOI, else normalized title; first-seen
   numbering.
3. **Renderers** — `src/agents/reportRenderers.ts` (`toMarkdown`, `toLatex`, `latexEscape`,
   `isPandocAvailable`, `convertWithPandoc` with injectable `PandocRunner`).
4. **Persistence** — `manuscripts` table in `src/db/schema.ts` + idempotent
   `CREATE TABLE IF NOT EXISTS` in `src/db/migrate.ts`; `src/memory/stores/manuscriptStore.ts`;
   `ContextStore.{save,get}Manuscript`.
5. **Prompt** — `src/prompts/report/manuscript.yaml` (single JSON call → abstract/background/
   discussion/limitations).
6. **Agent** — `src/agents/report.ts` (`ReportAgent.generateManuscript`): gather data →
   bibliography → deterministic per-hypothesis records → LLM narrative (Zod-validated, with a
   non-LLM fallback) → assemble + persist.
7. **Config** — `report.{defaultFormat,topN,pandocPath}` in `src/config.ts`.
8. **CLI** — `src/cli/commands/report.ts` (cached-manuscript reuse, `--regenerate`, `--top`,
   `--format md|latex|docx|pdf`, `--output`), registered in `src/cli/index.ts`.
9. **TUI** — `src/cli/tui/commands/reportCmd.ts`, imported in `src/cli/tui/App.tsx`.
10. **Tests** — `src/tests/report.test.ts` (9 tests).
11. **Docs** — this plan, the spec, `docs/ROADMAP.md`, root `CLAUDE.md`.

## Verify

- `bun test` → 324 pass / 0 fail; `bun run typecheck` → 29 pre-existing errors, 0 new.
- `co-scientist report <sessionId> -f md|latex` renders from cache; `-f pdf` without pandoc
  gives an actionable error.
