import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";

const TEST_DIR = join(tmpdir(), `deep-research-test-${Date.now()}`);
mkdirSync(TEST_DIR, { recursive: true });
process.env.DB_PATH = join(TEST_DIR, "test.db");
process.env.DEEPSEEK_API_KEY = "stub-for-tests";
process.env.PARALLEL_AI_API_KEY = ""; // force no-key path

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

import { cosineSimilarity } from "../util/vector.js";

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

import type { EvidenceSource } from "../models/evidence.js";

const mkEv = (url: string, summary = "S"): Omit<EvidenceSource, "id" | "createdAt"> & { embedding?: number[] } => ({
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

describe("ContextStore evidence bank", () => {
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

import { parseExtractResults, getSearchTool, type ExtractedPage } from "../tools/search.js";

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

import {
  LiteratureResearchAgent,
  normalizeUrl,
  formatEvidenceDigest,
  shouldContinue,
  resolveCitationMarkers,
  type PlanDecision,
} from "../agents/literatureResearch.js";

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
