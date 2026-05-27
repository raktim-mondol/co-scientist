/**
 * consensusAuth.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Self-contained OAuth 2.1 PKCE authentication for the Consensus MCP server.
 *
 * Implements the full OAuth flow without relying on the SDK's OAuthClientProvider:
 *   1. Discover OAuth endpoints from /.well-known/oauth-authorization-server
 *   2. Dynamic client registration (POST /oauth/register/)
 *   3. Generate PKCE code_verifier + code_challenge
 *   4. Open browser to authorization URL
 *   5. Start local HTTP callback server to capture the auth code
 *   6. Exchange code for tokens (POST /oauth/token/)
 *   7. Persist tokens + client info to disk
 *   8. Auto-refresh tokens when expired
 *
 * The end result is a simple `getConsensusAccessToken()` function that returns
 * a valid Bearer token for use in the MCP client Authorization header.
 * If tokens are missing or expired, it triggers the browser flow automatically.
 */

import { createHash, randomBytes } from "crypto";
import { createServer } from "http";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { exec } from "child_process";
import { logger, getConfig } from "../config.js";

// ─── Constants ─────────────────────────────────────────────────────────────────

const CONSENSUS_BASE = "https://consensus.app";
// Use config so CONSENSUS_MCP_URL env var override is respected
function getConsensusMcpUrl(): string {
  return getConfig().tools.consensus.url ?? "https://mcp.consensus.app/mcp";
}
const AUTH_ENDPOINT = `${CONSENSUS_BASE}/oauth/authorize/`;
const TOKEN_ENDPOINT = `${CONSENSUS_BASE}/oauth/token/`;
const REGISTER_ENDPOINT = `${CONSENSUS_BASE}/oauth/register/`;

const STORAGE_PATH = join(homedir(), ".co-scientist", "consensus-oauth.json");
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ─── Storage Types ─────────────────────────────────────────────────────────────

interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  /** Unix timestamp (ms) when the access token expires */
  expires_at?: number;
}

interface ClientRegistration {
  client_id: string;
  client_secret?: string;
}

interface StoredState {
  client?: ClientRegistration;
  tokens?: OAuthTokens;
}

// ─── Disk I/O ──────────────────────────────────────────────────────────────────

function loadStorage(): StoredState {
  if (!existsSync(STORAGE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STORAGE_PATH, "utf-8")) as StoredState;
  } catch {
    return {};
  }
}

function saveStorage(state: StoredState): void {
  mkdirSync(dirname(STORAGE_PATH), { recursive: true });
  writeFileSync(STORAGE_PATH, JSON.stringify(state, null, 2), "utf-8");
  logger.debug(`Consensus OAuth state saved → ${STORAGE_PATH}`);
}

// ─── PKCE Helpers ──────────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return randomBytes(48).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function generateState(): string {
  return randomBytes(16).toString("hex");
}

// ─── Find a Free TCP Port ──────────────────────────────────────────────────────

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : null;
      srv.close(() => {
        if (port) resolve(port);
        else reject(new Error("Could not find a free port"));
      });
    });
  });
}

// ─── Dynamic Client Registration ───────────────────────────────────────────────

async function registerClient(redirectUri: string): Promise<ClientRegistration> {
  const body = {
    client_name: "co-scientist",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };

  const res = await fetch(REGISTER_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Client registration failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { client_id: string; client_secret?: string };
  logger.debug(`Consensus: registered OAuth client_id=${data.client_id}`);
  return { client_id: data.client_id, client_secret: data.client_secret };
}

// ─── Token Exchange ─────────────────────────────────────────────────────────────

async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  clientId: string,
  redirectUri: string
): Promise<OAuthTokens> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    client_id: clientId,
    redirect_uri: redirectUri,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as OAuthTokens;
  if (data.expires_in) {
    data.expires_at = Date.now() + data.expires_in * 1000 - 30_000; // 30s buffer
  }
  return data;
}

// ─── Token Refresh ──────────────────────────────────────────────────────────────

async function refreshTokens(
  refreshToken: string,
  clientId: string
): Promise<OAuthTokens> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as OAuthTokens;
  if (data.expires_in) {
    data.expires_at = Date.now() + data.expires_in * 1000 - 30_000;
  }
  // Preserve refresh_token if not returned (some servers don't re-issue it)
  if (!data.refresh_token) {
    data.refresh_token = refreshToken;
  }
  return data;
}

// ─── Local Callback Server ──────────────────────────────────────────────────────

/**
 * Starts a one-shot HTTP server that captures the OAuth callback redirect.
 * Returns a promise resolving to { code, state } when the callback arrives.
 */
function waitForCallback(port: number): Promise<{ code: string; state: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (!req.url) return;

      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state") ?? "";
      const error = url.searchParams.get("error");
      const errorDesc = url.searchParams.get("error_description") ?? "";

      if (error) {
        const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0d0d0d;color:#fff">
          <h2 style="color:#f87171">❌ Authorization failed</h2>
          <p>${error}: ${errorDesc}</p>
          <p>You can close this tab.</p></body></html>`;
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(html);
        server.close();
        reject(new Error(`OAuth error: ${error} — ${errorDesc}`));
        return;
      }

      if (!code) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Waiting for authorization...");
        return;
      }

      const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0d0d0d;color:#fff">
        <h2 style="color:#22c55e">✅ Authorization successful!</h2>
        <p style="color:#9ca3af">You can close this tab and return to the terminal.</p>
        </body></html>`;
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);

      server.close();
      resolve({ code, state });
    });

    server.listen(port, "127.0.0.1", () => {
      logger.debug(`OAuth callback server listening on http://127.0.0.1:${port}/callback`);
    });

    server.on("error", (err) => {
      reject(new Error(`OAuth callback server error: ${err.message}`));
    });

    setTimeout(() => {
      server.close();
      reject(new Error("OAuth authorization timed out after 5 minutes."));
    }, CALLBACK_TIMEOUT_MS);
  });
}

// ─── Open Browser ───────────────────────────────────────────────────────────────

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "win32"  ? `start "" "${url}"`
    : platform === "darwin" ? `open "${url}"`
    : `xdg-open "${url}"`;

  exec(cmd, (err) => {
    if (err) logger.warn("Could not open browser automatically — please open the URL manually.");
  });
}

// ─── Full Browser OAuth Flow ────────────────────────────────────────────────────

/**
 * Runs the full OAuth 2.1 PKCE browser flow:
 *   register client → open browser → capture code → exchange for tokens → save.
 * Returns the new access token string.
 */
async function runBrowserAuthFlow(): Promise<string> {
  logger.info(
    "\n╔════════════════════════════════════════════════════════════╗\n" +
    "║      Consensus MCP — Browser Authorization Required        ║\n" +
    "╚════════════════════════════════════════════════════════════╝"
  );

  // Find a free local port for the callback server
  const port = await getFreePort();
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  // Load or register the OAuth client
  const storage = loadStorage();
  let client = storage.client;

  if (!client) {
    logger.info("Registering co-scientist as an OAuth client with Consensus...");
    client = await registerClient(redirectUri);
    storage.client = client;
    saveStorage(storage);
  }

  // Generate PKCE codes
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  // Build the authorization URL
  const authUrl = new URL(AUTH_ENDPOINT);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", client.client_id);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("scope", "search");
  authUrl.searchParams.set("state", state);

  // Start callback server FIRST (before opening browser)
  const callbackPromise = waitForCallback(port);

  logger.info(`\n→ Opening browser for Consensus login...\n  ${authUrl.toString()}\n`);
  logger.info("  If the browser doesn't open automatically, paste the URL above into your browser.\n");
  openBrowser(authUrl.toString());

  // Wait for the callback
  logger.info("  Waiting for authorization (up to 5 minutes)...");
  const { code, state: returnedState } = await callbackPromise;

  // Validate state to prevent CSRF
  if (returnedState && returnedState !== state) {
    throw new Error("OAuth state mismatch — possible CSRF attack, aborting.");
  }

  logger.info("  ✓ Authorization code received. Exchanging for tokens...");

  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens(code, codeVerifier, client.client_id, redirectUri);

  // Persist tokens
  storage.tokens = tokens;
  saveStorage(storage);

  logger.info("  ✓ Consensus OAuth tokens saved. You won't need to log in again.\n");
  return tokens.access_token;
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns a valid Consensus OAuth access token, handling:
 * - First-time browser auth flow
 * - Automatic token refresh when expired
 * - Persistent token cache in ~/.co-scientist/consensus-oauth.json
 *
 * This is the only function you need to call. Use the returned token as:
 *   Authorization: Bearer <token>
 */
export async function getConsensusAccessToken(): Promise<string> {
  const storage = loadStorage();
  const tokens = storage.tokens;

  // Case 1: No tokens at all — run browser flow
  if (!tokens?.access_token) {
    return runBrowserAuthFlow();
  }

  // Case 2: Token not expired — return as-is
  if (!tokens.expires_at || Date.now() < tokens.expires_at) {
    logger.debug("Consensus: using cached access token");
    return tokens.access_token;
  }

  // Case 3: Token expired — try refresh
  if (tokens.refresh_token && storage.client?.client_id) {
    logger.info("Consensus: access token expired, refreshing...");
    try {
      const refreshed = await refreshTokens(tokens.refresh_token, storage.client.client_id);
      storage.tokens = refreshed;
      saveStorage(storage);
      logger.info("Consensus: token refreshed successfully.");
      return refreshed.access_token;
    } catch (err) {
      logger.warn(`Consensus: token refresh failed (${(err as Error).message}). Re-authenticating...`);
      // Clear stale tokens and re-run browser flow
      storage.tokens = undefined;
      saveStorage(storage);
    }
  }

  // Case 4: Refresh failed or no refresh token — re-run browser flow
  return runBrowserAuthFlow();
}

/**
 * Clears all stored Consensus OAuth tokens and client registration.
 * Use this to force a fresh browser auth flow on next call to getConsensusAccessToken().
 */
export function clearConsensusTokens(): void {
  saveStorage({});
  logger.info(`Consensus OAuth tokens cleared (${STORAGE_PATH}).`);
}

/**
 * Returns true if valid (non-expired) tokens are cached on disk.
 */
export function hasValidConsensusTokens(): boolean {
  const storage = loadStorage();
  if (!storage.tokens?.access_token) return false;
  if (!storage.tokens.expires_at) return true; // no expiry info — assume valid
  return Date.now() < storage.tokens.expires_at;
}

/** Path where tokens are persisted. */
export const CONSENSUS_TOKEN_PATH = STORAGE_PATH;
