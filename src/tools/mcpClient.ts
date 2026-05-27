import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getConfig, logger } from "../config.js";
import {
  getConsensusAccessToken,
  hasValidConsensusTokens,
} from "./consensusAuth.js";

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

// ─── MCP Client Manager (Consensus only) ─────────────────────────────────────
// Parallel AI search is handled via the parallel-web REST SDK in search.ts.

export class MCPClientManager {
  private consensus: MCPServerClient;
  private initialized = false;

  constructor() {
    const config = getConfig();
    this.consensus = new MCPServerClient(
      "Consensus",
      config.tools.consensus.url
    );
  }

  async initialize(): Promise<void> {
    // If already initialized but Consensus is in a failed state and we now
    // have a valid token, reset so we can reconnect with the fresh token.
    if (this.initialized && !this.consensus.isAvailable() && hasValidConsensusTokens()) {
      logger.info("Consensus: fresh token detected — resetting failed connection for retry.");
      this.consensus.reset();
      this.initialized = false;
    }

    if (this.initialized) return;

    logger.info("Initializing MCP tool connections...");

    // ── Consensus auth ──────────────────────────────────────────────────────
    const config = getConfig();

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
        `Consensus auth failed: ${(err as Error).message}. Academic search will be unavailable.`
      );
    }

    const result = await Promise.allSettled([this.consensus.connect()]);
    if (result[0].status === "rejected") {
      logger.warn(`Consensus MCP server unavailable: ${result[0].reason}. Academic search will be degraded.`);
    }

    this.initialized = true;
  }

  async callConsensus(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<MCPToolResult> {
    // Ensure initialized (and re-initialize if a fresh token is now available)
    await this.initialize();
    if (!this.consensus.isAvailable()) {
      throw new Error(
        "Consensus unavailable — connection failed or auth was not completed. Check logs for details."
      );
    }
    return this.consensus.callTool(toolName, args);
  }

  isConsensusAvailable(): boolean {
    return this.consensus.isAvailable();
  }

  async listAllTools(): Promise<{ consensus: string[] }> {
    const [con] = await Promise.allSettled([this.consensus.listTools()]);
    return {
      consensus: con.status === "fulfilled" ? con.value : [],
    };
  }

  async cleanup(): Promise<void> {
    await this.consensus.disconnect();
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
