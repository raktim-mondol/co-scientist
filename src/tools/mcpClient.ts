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
  /** Set true after an unrecoverable failure — stops all future connect attempts. */
  private permanentlyFailed = false;

  constructor(
    serverName: string,
    url: string,
    headers: Record<string, string> = {}
  ) {
    this.serverName = serverName;
    this.url = url;
    this.headers = { "Content-Type": "application/json", ...headers };
  }

  /** Update the Authorization header (e.g. after a token refresh). */
  setAuthHeader(token: string): void {
    this.headers["Authorization"] = `Bearer ${token}`;
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
    await this.connect();
    try {
      const result = await this.client!.callTool({ name: toolName, arguments: args });
      return result as MCPToolResult;
    } catch (error) {
      logger.error(
        `${this.serverName} tool call failed (${toolName}): ${(error as Error).message}`
      );
      throw error;
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
    return !this.permanentlyFailed;
  }

  /** Reset failed state so a fresh connect attempt can be made (e.g. after token refresh). */
  reset(): void {
    this.permanentlyFailed = false;
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
    this.scite = new MCPServerClient(
      "Scite",
      config.tools.scite.url
    );
  }

  /** Ordered list of provider names to try, from config. */
  private providerPriority(): Array<"consensus" | "scite"> {
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

    // ── Consensus auth ──────────────────────────────────────────────────────
    if (wantConsensus && (!this.consensus.isAvailable() || needConsensusReconnect)) {
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
    if (wantScite && (!this.scite.isAvailable() || needSciteReconnect)) {
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
  async callConsensus(
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
        if (name !== priority[0]) {
          logger.info(`${name}: falling back for academic search ("${toolName}")`);
        }
        return await client.callTool(toolName, args);
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
        try {
          const result = await this.clientFor(name).callTool(toolName, args);
          logger.info(`${name}: returned results for ("${toolName}")`);
          return { name, content: result.content };
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
        if (i > 0) {
          logger.info(`${name}: falling back for academic search ("${toolName}")`);
        }
        const result = await client.callTool(toolName, args);

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
