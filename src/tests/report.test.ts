import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";

const TEST_DIR = join(tmpdir(), `report-test-${Date.now()}`);
mkdirSync(TEST_DIR, { recursive: true });
process.env.DB_PATH = join(TEST_DIR, "test.db");
process.env.DEEPSEEK_API_KEY = "stub-for-tests";

import { resetDb } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { getContextStore, resetContextStore } from "../memory/contextStore.js";
import { resetConfig } from "../config.js";
import { buildBibliography, markersFor, type ResolverFn } from "../agents/reportBibliography.js";
import {
  toMarkdown,
  toLatex,
  latexEscape,
  convertWithPandoc,
  isPandocAvailable,
  type PandocRunner,
} from "../agents/reportRenderers.js";
import type { CitationResolution } from "../tools/citationResolver.js";
import type { Manuscript } from "../models/manuscript.js";

// A resolver stub: recognizes a couple of known citations, everything else is unverified.
const stubResolver: ResolverFn = async (raw: string): Promise<CitationResolution> => {
  const r = raw.toLowerCase();
  if (r.includes("smith") || r.includes("10.1000/alpha")) {
    return {
      raw,
      status: "verified",
      canonicalTitle: "Alpha effects in tissue",
      doi: "10.1000/alpha",
      authors: "Smith, J.",
      year: 2021,
      matchScore: 0.95,
      source: "crossref",
    };
  }
  return { raw, status: "unverified", matchScore: 0, source: "none" };
};

describe("buildBibliography", () => {
  it("dedupes citations that share a DOI and numbers them in first-seen order", async () => {
    const { references, markerByRaw } = await buildBibliography(
      [
        ["Smith et al. 2021, doi:10.1000/alpha", "Some other ref"],
        ["10.1000/alpha", "Some other ref"], // same DOI + duplicate raw
      ],
      stubResolver,
    );
    // Two unique references: the alpha DOI (verified) and "Some other ref".
    expect(references.length).toBe(2);
    expect(references[0].n).toBe(1);
    expect(references[1].n).toBe(2);
    // Both spellings of the alpha citation collapse to reference [1].
    expect(markerByRaw.get("Smith et al. 2021, doi:10.1000/alpha")).toBe(1);
    expect(markerByRaw.get("10.1000/alpha")).toBe(1);
    expect(markerByRaw.get("Some other ref")).toBe(2);
  });

  it("carries resolver status so unresolved refs can be flagged", async () => {
    const { references } = await buildBibliography([["Some other ref"]], stubResolver);
    expect(references[0].status).toBe("unverified");
  });

  it("markersFor returns ascending, de-duplicated numbers", async () => {
    const { markerByRaw } = await buildBibliography(
      [["Smith et al. 2021", "Some other ref"]],
      stubResolver,
    );
    const nums = markersFor(["Some other ref", "Smith et al. 2021", "Some other ref"], markerByRaw);
    expect(nums).toEqual([1, 2]);
  });
});

function makeManuscript(): Manuscript {
  return {
    sessionId: "s1",
    sessionName: "Test Session",
    title: "A Study of 50% & More",
    generatedAt: "2026-07-03T00:00:00.000Z",
    researchGoal: "Understand X",
    domain: "Biology",
    abstract: "Abstract text.",
    background: "Background para 1.\n\nBackground para 2.",
    discussion: "Discussion text.",
    limitations: "Limitations text.",
    methods: {
      model: "deepseek-chat",
      seed: 42,
      rounds: 3,
      totalHypotheses: 5,
      totalMatches: 12,
      budgetTokens: 500000,
      agents: ["Generation", "Ranking (Glicko-2)"],
    },
    hypotheses: [
      {
        rank: 1,
        id: "h1",
        title: "Hypothesis One",
        summary: "Summary one.",
        content: "Content with 100% certainty & symbols.",
        rationale: "Because reasons.",
        keyAssumptions: ["a1"],
        eloRating: 1300,
        ratingDeviation: 60,
        wins: 4,
        losses: 1,
        citationMarkers: [1, 2],
        noveltyScore: 8,
        correctnessScore: 7,
        testabilityScore: 9,
        verdict: "accept",
        protocol: null,
      },
    ],
    references: [
      { n: 1, raw: "Smith 2021", canonicalTitle: "Alpha effects", doi: "10.1000/alpha", authors: "Smith, J.", year: 2021, status: "verified" },
      { n: 2, raw: "Some other ref", status: "unverified" },
    ],
  };
}

describe("toMarkdown", () => {
  it("emits sections in canonical order with a References section", () => {
    const md = toMarkdown(makeManuscript());
    const idxAbstract = md.indexOf("## Abstract");
    const idxBackground = md.indexOf("## 1. Background");
    const idxMethods = md.indexOf("## 2. Methods");
    const idxResults = md.indexOf("## 3. Results");
    const idxDiscussion = md.indexOf("## 4. Discussion");
    const idxLimitations = md.indexOf("## 5. Limitations");
    const idxRefs = md.indexOf("## References");
    expect(idxAbstract).toBeGreaterThan(-1);
    expect(idxAbstract).toBeLessThan(idxBackground);
    expect(idxBackground).toBeLessThan(idxMethods);
    expect(idxMethods).toBeLessThan(idxResults);
    expect(idxResults).toBeLessThan(idxDiscussion);
    expect(idxDiscussion).toBeLessThan(idxLimitations);
    expect(idxLimitations).toBeLessThan(idxRefs);
    // Inline markers + numbered reference + unverified flag.
    expect(md).toContain("[1, 2]");
    expect(md).toContain("1. Smith, J. (2021). Alpha effects. https://doi.org/10.1000/alpha");
    expect(md).toContain("⚠️ unverified");
  });
});

describe("toLatex", () => {
  it("escapes special characters and emits a numbered thebibliography", () => {
    const tex = toLatex(makeManuscript());
    expect(latexEscape("50% & more_")).toBe("50\\% \\& more\\_");
    // Title with % and & is escaped in \title{}.
    expect(tex).toContain("\\title{A Study of 50\\% \\& More}");
    expect(tex).toContain("\\begin{thebibliography}{2}");
    expect(tex).toContain("\\bibitem{ref1}");
    expect(tex).toContain("\\bibitem{ref2}");
    // Raw percent should never leak unescaped into the body.
    expect(tex).not.toContain("100% certainty");
  });
});

describe("pandoc rendering", () => {
  const missingRunner: PandocRunner = () => ({ ok: false, code: 127, stderr: "pandoc: not found" });

  it("reports pandoc as unavailable when the binary is missing", () => {
    expect(isPandocAvailable(missingRunner)).toBe(false);
  });

  it("throws an actionable error (not a crash) when pandoc is absent", () => {
    expect(() =>
      convertWithPandoc("# hi", "docx", join(TEST_DIR, "out.docx"), missingRunner),
    ).toThrow(/pandoc/i);
  });
});

describe("manuscript persistence", () => {
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
       VALUES ('${sessionId}','Report Test','completed','{}','{}',1,1)`,
    );
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("saves and reloads a manuscript by session id", () => {
    const m = { ...makeManuscript(), sessionId };
    store.saveManuscript(sessionId, m);
    const loaded = store.getManuscript(sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded!.title).toBe(m.title);
    expect(loaded!.references.length).toBe(2);
    expect(loaded!.hypotheses[0].citationMarkers).toEqual([1, 2]);
  });

  it("upserts on second save (one row per session)", () => {
    store.saveManuscript(sessionId, { ...makeManuscript(), sessionId, title: "Rebuilt" });
    expect(store.getManuscript(sessionId)!.title).toBe("Rebuilt");
    const count = store["sqlite"]
      .query(`SELECT COUNT(*) AS c FROM manuscripts WHERE session_id = ?`)
      .get(sessionId) as { c: number };
    expect(count.c).toBe(1);
  });
});
