import Parallel from "parallel-web";
import type { WebSearchResult as ParallelWebSearchResult } from "parallel-web/resources/top-level.js";
import {
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
  APIConnectionError,
} from "parallel-web";
import { getMCPManager } from "./mcpClient.js";
import { getConfig, logger } from "../config.js";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: "parallel_ai" | "consensus";
  authors?: string[];
  year?: number;
  journal?: string;
  citationCount?: number;
}

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

export type SearchMode = "academic" | "web" | "auto";

// ── In-process dedup cache ───────────────────────────────────────────────────
// Coalesces concurrent identical queries into a single API call and caches
// results for CACHE_TTL_MS to avoid redundant searches across parallel agents.
const CACHE_TTL_MS = 60_000; // 1 minute
interface CacheEntry {
  promise: Promise<SearchResult[]>;
  resolvedAt?: number;
}
const _searchCache = new Map<string, CacheEntry>();

function _cacheKey(type: string, query: string): string {
  return `${type}::${query.trim().toLowerCase()}`;
}

function _cachedSearch(
  key: string,
  fn: () => Promise<SearchResult[]>
): Promise<SearchResult[]> {
  const existing = _searchCache.get(key);
  if (existing) {
    if (!existing.resolvedAt || Date.now() - existing.resolvedAt < CACHE_TTL_MS) {
      logger.debug(`[Search:cache] hit for "${key.split("::")[1]}"`);
      return existing.promise;
    }
    _searchCache.delete(key);
  }
  const promise = fn().then((results) => {
    const entry = _searchCache.get(key);
    if (entry) entry.resolvedAt = Date.now();
    return results;
  });
  _searchCache.set(key, { promise });
  return promise;
}
// ─────────────────────────────────────────────────────────────────────────────

// Lazy singleton for the Parallel client — created on first use so the API key
// can be read from config after env vars have been fully loaded.
let _parallelClient: Parallel | null = null;
function getParallelClient(): Parallel | null {
  const apiKey = getConfig().tools.parallelAi.apiKey;
  if (!apiKey) return null;
  if (!_parallelClient) {
    _parallelClient = new Parallel({ apiKey });
  }
  return _parallelClient;
}

/**
 * Log a Parallel AI error with a specific, actionable message based on error type.
 * Used by searchWeb, multiSearch, and extractPages to give users clear guidance.
 *
 * Returns a human-readable description of fatal errors (auth, credits) so
 * callers can feed them into search-health tracking. Returns null for
 * transient errors (rate-limit, network) or unknown error types.
 */
function _logParallelError(context: string, error: unknown): string | null {
  if (error instanceof AuthenticationError) {
    const msg = "Parallel AI: API key invalid or expired (check PARALLEL_AI_API_KEY)";
    logger.warn(`[Search:${context}] ✗ ${msg}`);
    return msg;
  } else if (error instanceof PermissionDeniedError) {
    const msg = "Parallel AI: API credits may be exhausted (check https://parallel.ai)";
    logger.warn(`[Search:${context}] ✗ ${msg}`);
    return msg;
  } else if (error instanceof RateLimitError) {
    logger.warn(
      `[Search:${context}] ✗ rate limited — ${(error as Error).message}`
    );
    return null; // transient — may recover
  } else if (error instanceof APIConnectionError) {
    logger.warn(
      `[Search:${context}] ✗ network connection failed — ${(error as Error).message}`
    );
    return null; // transient — may recover
  } else {
    logger.warn(
      `[Search:${context}] ✗ failed: ${(error as Error).message}`
    );
    return null;
  }
}

export class SearchTool {
  private mcpManager = getMCPManager();

  // ── Search health tracking ─────────────────────────────────────────────────
  // Tracks consecutive empty results to detect when all search providers are
  // permanently unavailable (rate-limited, credits exhausted, auth expired).
  // The supervisor checks isSearchDead() each iteration and halts the session
  // if no provider can return results.
  private _consecutiveEmptySearches = 0;
  private _fatalErrors: string[] = [];

  /** Call after every top-level search that returns results (or lack thereof). */
  private _recordSearchOutcome(resultCount: number, fatalError?: string): void {
    if (resultCount === 0) {
      this._consecutiveEmptySearches++;
      if (fatalError && !this._fatalErrors.includes(fatalError)) {
        this._fatalErrors.push(fatalError);
      }
    } else {
      this._consecutiveEmptySearches = 0;
      this._fatalErrors = [];
    }
  }

  /**
   * Record a provider-level fatal error for the death-reason message
   * WITHOUT incrementing the empty-search counter. Used when a higher-level
   * search path (e.g. MCP → Parallel AI fallback) will separately track the
   * final outcome so we don't double-count a single logical search attempt.
   */
  private _recordFatalError(msg: string): void {
    if (!this._fatalErrors.includes(msg)) {
      this._fatalErrors.push(msg);
    }
  }

  /** True when every recent search attempt has returned zero results. */
  isSearchDead(): boolean {
    return this._consecutiveEmptySearches >= 5;
  }

  /** Human-readable explanation of why search is considered dead. */
  getSearchDeathReason(): string {
    const count = this._consecutiveEmptySearches;
    if (this._fatalErrors.length > 0) {
      return [
        `All search providers have failed for ${count} consecutive queries.`,
        ...this._fatalErrors.map((e) => `  • ${e}`),
        "Session cannot produce evidence-grounded hypotheses — halting.",
      ].join("\n");
    }
    return `No search results returned for ${count} consecutive queries — search may be unavailable.`;
  }
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Academic search via Consensus MCP — peer-reviewed papers.
   * Best for: novelty verification, deep verification review.
   */
  async searchAcademic(
    query: string,
    options: { maxResults?: number; silent?: boolean } = {}
  ): Promise<SearchResult[]> {
    const maxResults = options.maxResults ?? 10;
    const silent = options.silent ?? false;
    return _cachedSearch(_cacheKey("academic", query), async () => {
      const label = this._academicProviderLabel();
      if (!silent) logger.info(`[Search:${label}]\n  • "${query}"`);
      try {
        const result = await this.mcpManager.callAcademicSearch("search", { query });
        const results = this._parseMCPResults(result.content, "consensus");
        this._recordSearchOutcome(results.length); // success → reset dead counter
        return results;
      } catch (error) {
        logger.warn(`[Search:${label}] ✗ ${(error as Error).message}`);
        logger.warn(`[Search:${label}] ↳ falling back to Parallel AI web search`);
        // Record MCP provider error for the death-reason message. Don't
        // increment the empty-search counter here — searchWeb() (the fallback
        // below) handles that, so a single logical search attempt counts once.
        this._recordFatalError(`${label}: ${(error as Error).message}`);
        return this.searchWeb(`academic research ${query}`, { maxResults, silent, _skipHealthTracking: true });
      }
    });
  }

  /**
   * Broad web search via Parallel AI Search API.
   * Best for: literature exploration, observation review, finding recent findings.
   *
   * Uses the `parallel-web` SDK: POST https://api.parallel.ai/v1/search
   * with an objective (natural language goal) and one or more search_queries.
   */
  async searchWeb(
    query: string,
    options: { maxResults?: number; objective?: string; silent?: boolean; _skipHealthTracking?: boolean } = {}
  ): Promise<SearchResult[]> {
    const maxResults = options.maxResults ?? 10;
    const objective = options.objective ?? query;
    const silent = options.silent ?? false;
    return _cachedSearch(_cacheKey("web", query), async () => {
      if (!silent) logger.info(`[Search:ParallelAI]\n  • "${query}"`);
      const client = getParallelClient();
      if (!client) {
        logger.warn("[Search:ParallelAI] skipped — PARALLEL_AI_API_KEY not set");
        return [];
      }
      let results: SearchResult[] = [];
      let fatalError: string | undefined;
      try {
        const response = await client.search({
          mode: "advanced",
          objective,
          search_queries: [query],
          advanced_settings: { max_results: maxResults },
        });
        results = this._parseParallelResults(response.results ?? []);
      } catch (error) {
        const err = _logParallelError("ParallelAI", error);
        if (err) fatalError = err;
      }
      // Track outcome only when searchWeb is the top-level caller (not an
      // internal fallback from searchAcademic or multiSearch). Internal
      // callers pass _skipHealthTracking: true to avoid double-counting.
      if (!options._skipHealthTracking) {
        this._recordSearchOutcome(results.length, fatalError);
      }
      return results;
    });
  }

  /**
   * Smart routing: academic for verification tasks, web for exploration.
   */
  async search(
    query: string,
    mode: SearchMode = "auto",
    options: { maxResults?: number } = {}
  ): Promise<SearchResult[]> {
    const maxResults = options.maxResults ?? 10;

    if (mode === "academic") {
      return this.searchAcademic(query, { maxResults });
    }

    if (mode === "web") {
      return this.searchWeb(query, { maxResults });
    }

    // Auto: run both in parallel, log a single summary line
    const acLabel = this._academicProviderLabel();
    logger.info(`[Search] Parallel AI + ${acLabel} —\n  • "${query}"`);
    const [academic, web] = await Promise.allSettled([
      this.searchAcademic(query, { maxResults: Math.ceil(maxResults / 2), silent: true }),
      this.searchWeb(query, { maxResults: Math.ceil(maxResults / 2), silent: true }),
    ]);

    const academicResults = academic.status === "fulfilled" ? academic.value : [];
    const webResults = web.status === "fulfilled" ? web.value : [];

    const merged = this._deduplicate([...academicResults, ...webResults]);
    this._recordSearchOutcome(merged.length);
    return merged;
  }

  /**
   * Multi-query search — runs multiple queries and merges results.
   * Used by Generation agent for comprehensive literature exploration.
   * For web/auto: passes all queries in a single Parallel API call
   * (more efficient than N separate calls). Falls back to sequential on error.
   */
  async multiSearch(
    queries: string[],
    mode: SearchMode = "auto"
  ): Promise<SearchResult[]> {
    if (queries.length === 0) return [];

    const queryList = queries.map((q) => `  • "${q}"`).join("\n");

    if (mode === "academic") {
      const results = await Promise.all(
        queries.map((q) => this.searchAcademic(q, { maxResults: 5, silent: true }))
      );
      const merged = this._deduplicate(results.flat());
      const acLabel = this._academicProviderLabel();
      logger.info(`[Search] ${acLabel} —\n${queryList}`);
      this._recordSearchOutcome(merged.length);
      return merged;
    }

    // For web / auto: one Parallel AI call covers all queries together,
    // then each query is also sent to Consensus for peer-reviewed papers.
    const client = getParallelClient();
    const webResults: SearchResult[] = [];
    let webCount = 0;

    if (client) {
      try {
        const response = await client.search({
          mode: "advanced",
          objective: queries[0],
          search_queries: queries,
          advanced_settings: { max_results: Math.min(queries.length * 5, 20) },
        });
        const results = this._parseParallelResults(response.results ?? []);
        webCount = results.length;
        webResults.push(...results);
      } catch (error) {
        const fatalErr = _logParallelError("ParallelAI", error);
        if (fatalErr) this._recordFatalError(fatalErr);
        // If credits are exhausted or auth failed, sequential calls would all fail
        // identically — skip the wasteful fallback and surface the error clearly.
        if (
          error instanceof AuthenticationError ||
          error instanceof PermissionDeniedError
        ) {
          logger.warn(
            "[Search] Parallel AI unavailable — skipping sequential fallback (all calls would fail with same error)"
          );
        } else {
          logger.warn(
            `[Search] Parallel AI multi-search failed — falling back to sequential`
          );
          const fallback = await Promise.all(
            queries.map((q) => this.searchWeb(q, { maxResults: 5, silent: true, _skipHealthTracking: true }))
          );
          webResults.push(...fallback.flat());
          webCount = webResults.length;
        }
      }
    }

    const acLabel = this._academicProviderLabel();

    if (mode === "auto") {
      const academicResults = await Promise.all(
        queries.map((q) => this.searchAcademic(q, { maxResults: 3, silent: true }))
      );
      const merged = this._deduplicate([...webResults, ...academicResults.flat()]);
      const provider = client ? `Parallel AI + ${acLabel}` : acLabel;
      logger.info(`[Search] ${provider} —\n${queryList}`);
      this._recordSearchOutcome(merged.length);
      return merged;
    }

    const merged2 = this._deduplicate(webResults);
    if (!client && webResults.length === 0) {
      logger.warn(`[Search] web search unavailable — no results (set PARALLEL_AI_API_KEY for web search)`);
    } else {
      logger.info(`[Search] ${client ? "Parallel AI" : "Web (no results)"} —\n${queryList}`);
    }
    this._recordSearchOutcome(merged2.length);
    return merged2;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Human-readable label for the active academic search provider(s).
   * Handles all provider modes: single, priority/fallback (primary shown),
   * and parallel (all shown joined with " + ").
   */
  private _academicProviderLabel(): string {
    const priority = this.mcpManager.providerPriority();
    const mode = getConfig().tools.academicSearchMode;
    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

    if (mode === "parallel" && priority.length > 1) {
      return priority.map(capitalize).join(" + ");
    }
    // Priority, fallback, or single provider — show the primary
    return capitalize(priority[0]);
  }

  // ── Parsers ─────────────────────────────────────────────────────────────────

  /**
   * Parse results from the Parallel AI Search API response.
   * Each result has: url, title, publish_date, excerpts (string[]).
   */
  private _parseParallelResults(results: ParallelWebSearchResult[]): SearchResult[] {
    return results.map((r) => ({
      title: r.title ?? "Untitled",
      url: r.url ?? "",
      snippet: (r.excerpts ?? []).join(" ").slice(0, 600),
      source: "parallel_ai" as const,
      year: r.publish_date ? new Date(r.publish_date).getFullYear() : undefined,
    }));
  }

  /**
   * Parse results from MCP tool responses (Consensus).
   * Consensus returns plain markdown text like:
   *   [1] [Title](url) (Authors, Year, N citations, Journal)\n  Abstract...
   */
  private _parseMCPResults(
    content: Array<{ type: string; text?: string }>,
    source: "parallel_ai" | "consensus"
  ): SearchResult[] {
    const results: SearchResult[] = [];

    for (const item of content) {
      if (item.type !== "text" || !item.text) continue;

      // First try JSON (future-proofing / other MCP tools)
      try {
        const parsed = JSON.parse(item.text);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const r of items) {
          results.push({
            title: r.title ?? r.name ?? "Untitled",
            url: r.url ?? r.link ?? r.doi ?? "",
            snippet: r.snippet ?? r.abstract ?? r.description ?? r.summary ?? "",
            source,
            authors: r.authors,
            year: r.year ?? r.publication_year,
            journal: r.journal ?? r.venue ?? r.publication,
            citationCount: r.citation_count ?? r.citations,
          });
        }
        continue;
      } catch {
        // Not JSON — fall through to markdown parser
      }

      // Parse Consensus markdown format:
      //   [N] [Title](url) (Authors et al., YYYY, N citations, Journal)
      //     Abstract text...
      const entryRegex =
        /\[\d+\]\s+\[([^\]]+)\]\(([^)]+)\)\s*\(([^)]*)\)\s*\n?\s*([\s\S]*?)(?=\n\[\d+\]|\n\n---|\n\nFound\s|\n\n\*\*|$)/g;

      let match: RegExpExecArray | null;
      while ((match = entryRegex.exec(item.text)) !== null) {
        const [, title, url, meta, body] = match;
        const snippet = body?.trim().slice(0, 600) ?? "";

        // Parse "(Authors et al., YYYY, N citations, Journal)"
        let year: number | undefined;
        let journal: string | undefined;
        let citationCount: number | undefined;

        const yearMatch = meta.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) year = parseInt(yearMatch[0], 10);

        const citMatch = meta.match(/(\d+)\s+citations?/i);
        if (citMatch) citationCount = parseInt(citMatch[1], 10);

        // Journal is typically the last comma-separated token
        const metaParts = meta.split(",").map((s) => s.trim());
        const lastPart = metaParts[metaParts.length - 1];
        if (lastPart && !/citations?/i.test(lastPart) && !/^\d{4}$/.test(lastPart)) {
          journal = lastPart;
        }

        results.push({ title: title.trim(), url: url.trim(), snippet, source, year, journal, citationCount });
      }

      // Fallback: if regex matched nothing, store raw text as one result
      if (results.length === 0) {
        results.push({ title: "Search Result", url: "", snippet: item.text.slice(0, 500), source });
      }
    }

    return results;
  }

  private _deduplicate(results: SearchResult[]): SearchResult[] {
    const seen = new Set<string>();
    return results.filter((r) => {
      const key = r.url || r.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

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
      _logParallelError("Extract", error);
      return [];
    }
  }

  /** Format search results as readable text for LLM prompts */
  static formatForPrompt(results: SearchResult[]): string {
    if (results.length === 0) {
      return "No search results found.";
    }

    return results
      .map((r, i) => {
        const meta = [
          r.authors?.join(", "),
          r.year ? `(${r.year})` : null,
          r.journal,
          r.citationCount ? `${r.citationCount} citations` : null,
        ]
          .filter(Boolean)
          .join(" ");

        return [
          `[${i + 1}] ${r.title}`,
          meta ? `    ${meta}` : null,
          `    ${r.url}`,
          `    ${r.snippet}`,
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
  }
}

// Singleton
let _searchTool: SearchTool | null = null;
export function getSearchTool(): SearchTool {
  if (!_searchTool) _searchTool = new SearchTool();
  return _searchTool;
}
