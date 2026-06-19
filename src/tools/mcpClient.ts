import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getConfig, logger } from "../config.js";
import {
  getConsensusAccessToken,
  hasValidConsensusTokens,
} from "./consensusAuth.js";
import {
  getSciteAccessToken,
  hasValidSciteTokens,
} from "./sciteAuth.js";

export interface MCPToolResult {
  content: Array<{
    type: string;
    text?: string;
  }>;
  isError?: boolean;
}

// ─── Generic MCP Server Client ────────────────────────────────────────────────

class MCPServerClient {
  private serverName: string;
  private url: string;
  private headers: Record<string, string>;
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private connected = false;
  /** Set true after an unrecoverable failure — auto-resets after RETRY_TTL_MS. */
  private permanentlyFailed = false;
  /** Timestamp when permanentlyFailed was set. Used for TTL-based auto-reset. */
  private failedAt = 0;
  /** How long to wait before auto-resetting a permanently failed provider (ms). */
  private static readonly RETRY_TTL_MS = 60_000;
  /**
   * Promise for an in-progress auth refresh.  Concurrent callers that hit an
   * auth error await this instead of kicking off their own refresh, so a
   * single token refresh serves all queued callers.  `null` when idle.
   */
  private _authRefreshPromise: Promise<void> | null = null;
  /** Recursion guard — prevents infinite retry loops if refresh itself fails. */
  private _isRetryingAuth = false;
  /**
   * Global per-provider mutex: serializes all outgoing MCP calls so only one
   * is in-flight at a time. This prevents burst rate-limiting when multiple
   * agents call Consensus concurrently — each call waits for the previous one
   * to complete plus a 1-second inter-call delay.
   */
  private _callGate: Promise<void> = Promise.resolve();
  private _releaseGate: (() => void) | null = null;
  /** Inter-call spacing in ms — only enforced between consecutive calls. */
  private static readonly CALL_SPACING_MS = 1000;
  /** Wall-clock time the previous call finished; 0 means none yet. */
  private _lastCallFinishedAt = 0;

  /** Acquire the rate-limiting gate. Returns a release function. */
  private async _acquireCallGate(): Promise<(() => void) | null> {
    if (this._isRetryingAuth) return null;
    await this._callGate;
    // Enforce inter-call spacing only when a previous call finished recently.
    // The first call (and calls after the spacing window has already elapsed)
    // proceed immediately instead of always paying a fixed 1s penalty.
    if (this._lastCallFinishedAt > 0) {
      const elapsed = Date.now() - this._lastCallFinishedAt;
      const wait = MCPServerClient.CALL_SPACING_MS - elapsed;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    return new Promise<() => void>((resolveRelease) => {
      this._callGate = new Promise<void>((resolve) => {
        this._releaseGate = resolve;
      });
      resolveRelease(() => {
        if (this._releaseGate) {
          this._lastCallFinishedAt = Date.now();
          this._releaseGate();
          this._releaseGate = null;
        }
      });
    });
  }
  /**
   * Map a generic search tool name ("search") to the provider-specific tool name.
   * Scite uses "search_literature"; Consensus uses "search".
   */
  searchToolName: string;
  /**
   * Transform args from the generic { query } shape into provider-specific
   * parameter names (Scite uses "term" instead of "query").
   */
  mapSearchArgs: (args: Record<string, unknown>) => Record<string, unknown>;

  constructor(
    serverName: string,
    url: string,
    headers: Record<string, string> = {},
    opts?: { searchToolName?: string; mapSearchArgs?: (args: Record<string, unknown>) => Record<string, unknown> }
  ) {
    this.serverName = serverName;
    this.url = url;
    this.headers = { "Content-Type": "application/json", ...headers };
    this.searchToolName = opts?.searchToolName ?? "search";
    this.mapSearchArgs = opts?.mapSearchArgs ?? ((args) => args);
  }

  /** Update the Authorization header (e.g. after a token refresh). */
  setAuthHeader(token: string): void {
    this.headers["Authorization"] = `Bearer ${token}`;
  }

  /** Check if an error message indicates an auth/token-expiry issue. */
  private _isAuthError(message: string): boolean {
    return /expired|unauthorized|invalid.*token|token.*(?:invalid|expir)/i.test(message);
  }

  private _isRateLimitError(message: string): boolean {
    return /rate.limit|too many requests|rate exceeded/i.test(message);
  }

  /** Refresh the auth token by calling the provider-specific token function. */
  private async _refreshAuth(): Promise<void> {
    if (this.serverName === "Scite") {
      const token = await getSciteAccessToken();
      this.setAuthHeader(token);
    } else if (this.serverName === "Consensus") {
      const token = await getConsensusAccessToken();
      this.setAuthHeader(token);
    } else {
      throw new Error(`No auth refresh provider for ${this.serverName}`);
    }
  }

  /**
   * Refresh the auth token, reset the connection, and retry the call.
   *
   * Uses `_authRefreshPromise` so concurrent callers share a single refresh
   * instead of racing each other.  Uses `_isRetryingAuth` to prevent infinite
   * recursion when the retry itself also fails with an auth error.
   */
  private async _retryAfterAuthRefresh(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<MCPToolResult> {
    this._isRetryingAuth = true;
    try {
      // Start or join a shared refresh
      if (!this._authRefreshPromise) {
        logger.info(`${this.serverName}: auth error detected — refreshing token and retrying...`);
        this._authRefreshPromise = this._refreshAuth()
          .then(() => { this.reset(); })
          .finally(() => { this._authRefreshPromise = null; });
      } else {
        logger.info(`${this.serverName}: auth error detected — waiting for in-progress token refresh...`);
      }

      await this._authRefreshPromise;

      // Retry with the refreshed token (now in this.headers).
      const result = await this.callTool(toolName, args);
      logger.info(`${this.serverName}: token refresh succeeded — call retry successful.`);
      return result;
    } catch (err) {
      logger.error(
        `${this.serverName} tool call failed after token refresh (${toolName}): ${(err as Error).message}`
      );
      throw err;
    } finally {
      this._isRetryingAuth = false;
    }
  }

  /** Always create a fresh Client + Transport — the SDK forbids reusing a started transport. */
  private _createFresh(): void {
    this.transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: { headers: this.headers },
    });
    this.client = new Client(
      { name: "co-scientist", version: "1.0.0" },
      { capabilities: {} }
    );
  }

  async connect(): Promise<void> {
    if (this.permanentlyFailed) {
      throw new Error(`${this.serverName} is unavailable`);
    }
    if (this.connected) return;

    this._createFresh();
    try {
      await this.client!.connect(this.transport!);
      this.connected = true;
      logger.info(`Connected to ${this.serverName} MCP server`);
    } catch (error) {
      this.client = null;
      this.transport = null;
      this.connected = false;
      this.permanentlyFailed = true;
      this.failedAt = Date.now();
      logger.error(`Failed to connect to ${this.serverName}: ${(error as Error).message}`);
      throw error;
    }
  }

  async listTools(): Promise<string[]> {
    await this.connect();
    const result = await this.client!.listTools();
    return result.tools.map((t) => t.name);
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<MCPToolResult> {
    // ── Global per-provider rate limiter ──────────────────────────────────
    // Acquire the gate (no-op for recursive auth-retry calls to avoid deadlock).
    const releaseGate = await this._acquireCallGate();
    try {
      try {
        await this.connect();
        const result = await this.client!.callTool({ name: toolName, arguments: args });
        // Detect application-level errors signaled via isError flag (e.g., Scite monthly limit).
        if (result.isError) {
          const errText =
            (result.content as Array<{ type: string; text?: string }> | undefined)
              ?.filter(
                (c): c is { type: "text"; text: string } =>
                  c.type === "text" && typeof c.text === "string" && c.text.length > 0
              )
              .map((c) => c.text)
              .join("\n") || `${this.serverName} returned an error with no details`;
          // Try auth recovery for application-level auth errors
          if (!this._isRetryingAuth && this._isAuthError(errText)) {
            return await this._retryAfterAuthRefresh(toolName, args);
          }
          throw new Error(errText);
        }
        return result as MCPToolResult;
      } catch (error) {
        const errMsg = (error as Error).message;
        // Try auth recovery for SDK/JRPC-level auth errors (e.g., "User token has expired")
        if (!this._isRetryingAuth && this._isAuthError(errMsg)) {
          return await this._retryAfterAuthRefresh(toolName, args);
        }
        // Rate limit errors: retry with exponential backoff (2s, 4s) before giving up.
        // With the global per-provider mutex above, these should be rare — they only
        // occur when the upstream API is genuinely saturated, not from self-inflicted bursts.
        if (this._isRateLimitError(errMsg)) {
          for (let attempt = 1; attempt <= 2; attempt++) {
            const delay = 2000 * attempt;
            const level = attempt === 1 ? "info" : "warn";
            logger[level](
              `${this.serverName}: rate limited — retrying in ${delay / 1000}s (attempt ${attempt}/2)`
            );
            await new Promise((r) => setTimeout(r, delay));
            try {
              await this.connect(); // re-establish transport if needed
              const retryResult = await this.client!.callTool({ name: toolName, arguments: args });
              logger.info(`${this.serverName}: rate-limit retry succeeded (attempt ${attempt})`);
              return retryResult as MCPToolResult;
            } catch (retryErr) {
              const retryMsg = (retryErr as Error).message;
              if (!this._isRateLimitError(retryMsg)) throw retryErr; // different error — propagate
              if (attempt === 2) {
                logger.error(
                  `${this.serverName}: still rate limited after ${attempt} retries`
                );
              }
            }
          }
        }
        logger.error(
          `${this.serverName} tool call failed (${toolName}): ${errMsg}`
        );
        throw error;
      }
    } finally {
      releaseGate?.(); // release the next waiter (null for auth-retry recursive calls)
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected || !this.transport) return;
    try {
      await this.transport.close();
    } catch {
      // Ignore errors on close
    }
    this.client = null;
    this.transport = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  isAvailable(): boolean {
    if (!this.permanentlyFailed) return true;
    // Auto-reset after TTL — allows retry after transient network errors
    if (Date.now() - this.failedAt > MCPServerClient.RETRY_TTL_MS) {
      this.reset();
      return true;
    }
    return false;
  }

  /** Reset failed state so a fresh connect attempt can be made (e.g. after token refresh). */
  reset(): void {
    this.permanentlyFailed = false;
    this.failedAt = 0;
    this.connected = false;
    this.client = null;
    this.transport = null;
  }
}

// ─── MCP Client Manager (Consensus + Scite fallback) ──────────────────────────
// Parallel AI search is handled via the parallel-web REST SDK in search.ts.

/** Parse the ACADEMIC_SEARCH_PROVIDERS comma-separated list into a deduped,
 *  validated priority array. Unknown entries are dropped with a warning. */
function parseProviderPriority(raw: string): Array<"consensus" | "scite"> {
  const seen = new Set<string>();
  const out: Array<"consensus" | "scite"> = [];
  for (const token of raw.split(",")) {
    const name = token.trim().toLowerCase();
    if (name === "consensus" || name === "scite") {
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    } else if (name.length > 0) {
      logger.warn(`Unknown academic search provider "${token.trim()}" — ignored. Valid: consensus, scite`);
    }
  }
  return out.length > 0 ? out : ["consensus", "scite"]; // never return empty
}

export class MCPClientManager {
  private consensus: MCPServerClient;
  private scite: MCPServerClient;
  private initialized = false;

  constructor() {
    const config = getConfig();
    this.consensus = new MCPServerClient(
      "Consensus",
      config.tools.consensus.url
    );
    // Scite uses "search_literature" as the primary literature search tool
    // and expects "term" instead of "query" for the search parameter.
    this.scite = new MCPServerClient(
      "Scite",
      config.tools.scite.url,
      {},
      {
        searchToolName: "search_literature",
        mapSearchArgs: (args) => {
          const mapped: Record<string, unknown> = { ...args };
          if ("query" in mapped) {
            mapped["term"] = mapped["query"];
            delete mapped["query"];
          }
          return mapped;
        },
      }
    );
  }

  /** Ordered list of provider names to try, from config. */
  providerPriority(): Array<"consensus" | "scite"> {
    return parseProviderPriority(getConfig().tools.academicSearchProviders);
  }

  /** Look up the MCPServerClient for a provider name. */
  private clientFor(name: "consensus" | "scite"): MCPServerClient {
    return name === "consensus" ? this.consensus : this.scite;
  }

  async initialize(): Promise<void> {
    // Re-init individual providers if a previously-failed one now has fresh tokens
    const needConsensusReconnect =
      this.initialized && !this.consensus.isAvailable() && hasValidConsensusTokens();
    const needSciteReconnect =
      this.initialized && !this.scite.isAvailable() && hasValidSciteTokens();

    if (needConsensusReconnect) {
      logger.info("Consensus: fresh token detected — resetting failed connection for retry.");
      this.consensus.reset();
    }
    if (needSciteReconnect) {
      logger.info("Scite: fresh token detected — resetting failed connection for retry.");
      this.scite.reset();
    }

    // Skip if already fully initialized and no provider needs reconnection
    if (this.initialized && !needConsensusReconnect && !needSciteReconnect) return;

    const priority = this.providerPriority();
    const wantConsensus = priority.includes("consensus");
    const wantScite = priority.includes("scite");

    logger.info(`Initializing MCP tool connections (providers: ${priority.join(", ")})...`);

    const config = getConfig();

    const isFirstInit = !this.initialized;

    // ── Consensus auth ──────────────────────────────────────────────────────
    if (wantConsensus && (isFirstInit || !this.consensus.isAvailable() || needConsensusReconnect)) {
      try {
        let consensusToken: string;

        if (config.tools.consensus.apiKey) {
          logger.info("Consensus: using static API key (no OAuth needed).");
          consensusToken = config.tools.consensus.apiKey;
        } else {
          if (hasValidConsensusTokens()) {
            logger.info("Consensus: loading cached OAuth tokens.");
          } else {
            logger.info(
              "Consensus: no cached tokens found — starting OAuth 2.1 PKCE browser flow.\n" +
              "  Tokens will be saved to ~/.co-scientist/consensus-oauth.json for future runs."
            );
          }
          consensusToken = await getConsensusAccessToken();
        }

        this.consensus.setAuthHeader(consensusToken);
      } catch (err) {
        logger.warn(
          `Consensus auth failed: ${(err as Error).message}.`
        );
      }
    }

    // ── Scite auth ──────────────────────────────────────────────────────────
    if (wantScite && (isFirstInit || !this.scite.isAvailable() || needSciteReconnect)) {
      try {
        let sciteToken: string;

        if (config.tools.scite.apiKey) {
          logger.info("Scite: using static API key (no OAuth needed).");
          sciteToken = config.tools.scite.apiKey;
        } else {
          if (hasValidSciteTokens()) {
            logger.info("Scite: loading cached OAuth tokens.");
          } else {
            logger.info(
              "Scite: no cached tokens found — starting OAuth 2.0 PKCE browser flow.\n" +
              "  Tokens will be saved to ~/.co-scientist/scite-oauth.json for future runs."
            );
          }
          sciteToken = await getSciteAccessToken();
        }

        this.scite.setAuthHeader(sciteToken);
      } catch (err) {
        logger.warn(
          `Scite auth failed: ${(err as Error).message}.`
        );
      }
    }

    // Connect whichever need connecting. connect() is a no-op if already connected,
    // but throws if permanently failed. Only attempt on configured providers.
    const connectPromises: Array<Promise<void>> = [];
    for (const name of priority) {
      const client = this.clientFor(name);
      if (client.isAvailable()) {
        connectPromises.push(client.connect().catch((err) => {
          logger.warn(`${name} MCP server unavailable: ${(err as Error).message}.`);
        }));
      }
    }
    if (connectPromises.length > 0) {
      await Promise.all(connectPromises);
    }
    const allConfiguredDead = priority.every((name) => !this.clientFor(name).isConnected());
    if (allConfiguredDead && priority.length > 0) {
      logger.warn(`Academic search unavailable — all configured providers (${priority.join(", ")}) are down.`);
    }

    this.initialized = true;
  }

  /**
   * Call the academic search provider(s) according to the configured mode:
   *
   *   priority — try in order, first success wins (default)
   *   parallel — call all configured providers, merge results
   *   fallback — try first; only use next if first returns zero results or errors
   */
  async callAcademicSearch(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<MCPToolResult> {
    await this.initialize();

    const priority = this.providerPriority();
    const mode = getConfig().tools.academicSearchMode;

    if (mode === "parallel") {
      return this._callParallel(toolName, args, priority);
    }
    if (mode === "fallback") {
      return this._callFallback(toolName, args, priority);
    }
    return this._callPriority(toolName, args, priority);
  }

  /** Priority mode: try each provider in order, return first success. */
  private async _callPriority(
    toolName: string,
    args: Record<string, unknown>,
    priority: Array<"consensus" | "scite">
  ): Promise<MCPToolResult> {
    const errors: string[] = [];

    for (const name of priority) {
      const client = this.clientFor(name);
      if (!client.isAvailable()) {
        errors.push(`${name}: unavailable`);
        continue;
      }
      try {
        const resolvedTool = client.searchToolName || toolName;
        const resolvedArgs = client.mapSearchArgs(args);
        if (name !== priority[0]) {
          logger.info(`${name}: falling back for academic search ("${resolvedTool}")`);
        }
        const result = await client.callTool(resolvedTool, resolvedArgs);
        // Guard: if provider returns empty content, try next provider (defense-in-depth
        // alongside the isError→throw check in callTool()).
        const hasContent = result.content?.some(
          (b) => b.type === "text" && (b.text?.trim() ?? "").length > 0
        );
        if (!hasContent) {
          logger.warn(`${name}: returned empty results, trying next provider.`);
          errors.push(`${name}: empty results`);
          continue;
        }
        return result;
      } catch (err) {
        const msg = `${name}: ${(err as Error).message}`;
        logger.warn(`Academic search call failed — ${msg}`);
        errors.push(msg);
      }
    }

    throw new Error(
      `Academic search unavailable — tried ${priority.join(" → ")}. Errors: ${errors.join("; ")}`
    );
  }

  /** Parallel mode: call all configured providers simultaneously, merge results. */
  private async _callParallel(
    toolName: string,
    args: Record<string, unknown>,
    priority: Array<"consensus" | "scite">
  ): Promise<MCPToolResult> {
    interface ProviderResult {
      name: string;
      content: MCPToolResult["content"];
    }

    const calls = priority
      .filter((name) => this.clientFor(name).isAvailable())
      .map(async (name): Promise<ProviderResult | null> => {
        const client = this.clientFor(name);
        const resolvedTool = client.searchToolName || toolName;
        const resolvedArgs = client.mapSearchArgs(args);
        try {
          const result = await client.callTool(resolvedTool, resolvedArgs);
          const hasContent = result.content?.some(
            (b) => b.type === "text" && (b.text?.trim() ?? "").length > 0
          );
          if (hasContent) {
            logger.info(`${name}: returned results for ("${resolvedTool}")`);
          }
          return { name, content: hasContent ? result.content : [] };
        } catch (err) {
          logger.warn(`${name}: call failed in parallel mode — ${(err as Error).message}`);
          return null;
        }
      });

    if (calls.length === 0) {
      throw new Error("Academic search unavailable — no configured providers are available.");
    }

    const settled = await Promise.all(calls);
    const successes = settled.filter((r): r is ProviderResult => r !== null);

    if (successes.length === 0) {
      throw new Error(
        `Academic search unavailable — all ${priority.join(", ")} calls failed in parallel mode.`
      );
    }

    // Merge: concatenate all content arrays, prefix each provider's text blocks
    const mergedContent: MCPToolResult["content"] = [];
    for (const { name, content } of successes) {
      for (const block of content) {
        if (block.type === "text" && block.text) {
          mergedContent.push({
            type: "text",
            text: `[${name}]\n${block.text}`,
          });
        } else {
          mergedContent.push(block);
        }
      }
    }

    logger.info(
      `Parallel search: ${successes.length}/${priority.length} provider(s) succeeded (${successes.map((s) => s.name).join(", ")})`
    );
    return { content: mergedContent };
  }

  /** Fallback mode: try first; only use next if first returns zero results or errors. */
  private async _callFallback(
    toolName: string,
    args: Record<string, unknown>,
    priority: Array<"consensus" | "scite">
  ): Promise<MCPToolResult> {
    const errors: string[] = [];

    for (let i = 0; i < priority.length; i++) {
      const name = priority[i];
      const client = this.clientFor(name);
      if (!client.isAvailable()) {
        errors.push(`${name}: unavailable`);
        continue;
      }
      try {
        const resolvedTool = client.searchToolName || toolName;
        const resolvedArgs = client.mapSearchArgs(args);
        if (i > 0) {
          logger.info(`${name}: falling back for academic search ("${resolvedTool}")`);
        }
        const result = await client.callTool(resolvedTool, resolvedArgs);

        // Check if the result has any substantive text content
        const hasContent = result.content?.some(
          (b) => b.type === "text" && (b.text?.trim() ?? "").length > 0
        );
        if (hasContent) return result;

        logger.info(`${name}: returned empty results, trying next provider.`);
        errors.push(`${name}: empty results`);
      } catch (err) {
        const msg = `${name}: ${(err as Error).message}`;
        logger.warn(`Academic search call failed — ${msg}`);
        errors.push(msg);
      }
    }

    throw new Error(
      `Academic search unavailable — tried ${priority.join(" → ")}. Errors: ${errors.join("; ")}`
    );
  }

  isConsensusAvailable(): boolean {
    return this.providerPriority().some((name) => this.clientFor(name).isAvailable());
  }

  isSciteAvailable(): boolean {
    return this.scite.isAvailable();
  }

  async listAllTools(): Promise<{ consensus: string[]; scite: string[] }> {
    const [con, sci] = await Promise.allSettled([
      this.consensus.listTools(),
      this.scite.listTools(),
    ]);
    return {
      consensus: con.status === "fulfilled" ? con.value : [],
      scite: sci.status === "fulfilled" ? sci.value : [],
    };
  }

  async cleanup(): Promise<void> {
    await Promise.allSettled([
      this.consensus.disconnect(),
      this.scite.disconnect(),
    ]);
    logger.debug("MCP connections closed");
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _manager: MCPClientManager | null = null;

export function getMCPManager(): MCPClientManager {
  if (!_manager) _manager = new MCPClientManager();
  // If the manager exists but Consensus is failed and we now have a valid
  // token, let initialize() handle the reset on next call.
  return _manager;
}

/** Force-reset the singleton (e.g. after manual token clear + re-auth). */
export function resetMCPManager(): void {
  _manager = null;
}
