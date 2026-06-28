/**
 * sciteAuth.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Self-contained OAuth 2.0 PKCE authentication for the Scite MCP server.
 *
 * Same pattern as consensusAuth.ts but with Scite-specific endpoints:
 *   - Authorize:  https://api.scite.ai/mcp/oauth/authorize
 *   - Token:      https://api.scite.ai/mcp/oauth/token
 *   - Register:   https://api.scite.ai/mcp/oauth/register
 *   - Scope:      mcp
 *
 * The end result is a simple `getSciteAccessToken()` function that returns
 * a valid Bearer token. If tokens are missing or expired, it triggers the
 * browser flow automatically.
 */

import { createHash, randomBytes } from "crypto";
import { createServer } from "http";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { exec } from "child_process";
import { logger } from "../config.js";

// ─── Constants ─────────────────────────────────────────────────────────────────

const SCITE_BASE = "https://api.scite.ai";
const AUTH_ENDPOINT = `${SCITE_BASE}/mcp/oauth/authorize`;
const TOKEN_ENDPOINT = `${SCITE_BASE}/mcp/oauth/token`;
const REGISTER_ENDPOINT = `${SCITE_BASE}/mcp/oauth/register`;
const SCOPE = "mcp";

const STORAGE_PATH = join(homedir(), ".co-scientist", "scite-oauth.json");
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ─── Storage Types ─────────────────────────────────────────────────────────────

interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
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
  logger.debug(`Scite OAuth state saved → ${STORAGE_PATH}`);
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
    throw new Error(`Scite client registration failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { client_id: string; client_secret?: string };
  logger.debug(`Scite: registered OAuth client_id=${data.client_id}`);
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
    throw new Error(`Scite token exchange failed (${res.status}): ${text}`);
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
    throw new Error(`Scite token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as OAuthTokens;
  if (data.expires_in) {
    data.expires_at = Date.now() + data.expires_in * 1000 - 30_000;
  }
  if (!data.refresh_token) {
    data.refresh_token = refreshToken;
  }
  return data;
}

// ─── Local Callback Server ──────────────────────────────────────────────────────

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
      logger.debug(`Scite OAuth callback server listening on http://127.0.0.1:${port}/callback`);
    });

    server.on("error", (err) => {
      reject(new Error(`Scite OAuth callback server error: ${err.message}`));
    });

    setTimeout(() => {
      server.close();
      reject(new Error("Scite OAuth authorization timed out after 5 minutes."));
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

async function runBrowserAuthFlow(): Promise<string> {
  logger.info(
    "\n╔════════════════════════════════════════════════════════════╗\n" +
    "║        Scite MCP — Browser Authorization Required           ║\n" +
    "╚════════════════════════════════════════════════════════════╝"
  );

  const port = await getFreePort();
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  // Always re-register the OAuth client because the redirect_uri changes
  // on every flow (a new random localhost port is picked each time).
  // Reusing a previously registered client_id with a different redirect_uri
  // causes "redirect_uri not registered for this client" from Scite.
  const storage = loadStorage();
  logger.info("Registering co-scientist as an OAuth client with Scite...");
  const client = await registerClient(redirectUri);
  storage.client = client;
  saveStorage(storage);

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  const authUrl = new URL(AUTH_ENDPOINT);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", client.client_id);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("state", state);

  const callbackPromise = waitForCallback(port);

  logger.info(`\n→ Opening browser for Scite login...\n  ${authUrl.toString()}\n`);
  logger.info("  If the browser doesn't open automatically, paste the URL above into your browser.\n");
  openBrowser(authUrl.toString());

  logger.info("  Waiting for authorization (up to 5 minutes)...");
  const { code, state: returnedState } = await callbackPromise;

  if (returnedState && returnedState !== state) {
    throw new Error("Scite OAuth state mismatch — possible CSRF attack, aborting.");
  }

  logger.info("  ✓ Authorization code received. Exchanging for tokens...");

  const tokens = await exchangeCodeForTokens(code, codeVerifier, client.client_id, redirectUri);

  storage.tokens = tokens;
  saveStorage(storage);

  logger.info("  ✓ Scite OAuth tokens saved. You won't need to log in again.\n");
  return tokens.access_token;
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns a valid Scite OAuth access token, handling:
 * - First-time browser auth flow
 * - Automatic token refresh when expired
 * - Persistent token cache in ~/.co-scientist/scite-oauth.json
 */
export async function getSciteAccessToken(
  options: { allowInteractive?: boolean } = {}
): Promise<string> {
  const allowInteractive = options.allowInteractive ?? true;
  const storage = loadStorage();
  const tokens = storage.tokens;

  // Case 1: No tokens at all — run browser flow only if interactive
  if (!tokens?.access_token) {
    if (!allowInteractive) {
      throw new Error("Not signed in to Scite — use `co-scientist login` to authenticate.");
    }
    return runBrowserAuthFlow();
  }

  // Case 2: Token not expired — return as-is
  if (!tokens.expires_at || Date.now() < tokens.expires_at) {
    logger.debug("Scite: using cached access token");
    return tokens.access_token;
  }

  // Case 3: Token expired — try refresh
  if (tokens.refresh_token && storage.client?.client_id) {
    logger.info("Scite: access token expired, refreshing...");
    try {
      const refreshed = await refreshTokens(tokens.refresh_token, storage.client.client_id);
      storage.tokens = refreshed;
      saveStorage(storage);
      logger.info("Scite: token refreshed successfully.");
      return refreshed.access_token;
    } catch (err) {
      logger.warn(`Scite: token refresh failed (${(err as Error).message}).`);
      // Clear stale tokens
      storage.tokens = undefined;
      saveStorage(storage);
      if (!allowInteractive) {
        throw new Error(
          "Scite token refresh failed — use `co-scientist login` to re-authenticate."
        );
      }
      // Interactive: fall through to browser re-auth
    }
  }

  // Case 4: Refresh failed or no refresh token
  if (!allowInteractive) {
    throw new Error("Scite session expired — use `co-scientist login` to re-authenticate.");
  }
  return runBrowserAuthFlow();
}

/**
 * Clears all stored Scite OAuth tokens and client registration.
 */
export function clearSciteTokens(): void {
  saveStorage({});
  logger.info(`Scite OAuth tokens cleared (${STORAGE_PATH}).`);
}

/**
 * Returns true if valid (non-expired) tokens are cached on disk.
 */
export function hasValidSciteTokens(): boolean {
  const storage = loadStorage();
  if (!storage.tokens?.access_token) return false;
  if (!storage.tokens.expires_at) return true;
  return Date.now() < storage.tokens.expires_at;
}

/** Path where tokens are persisted. */
export const SCITE_TOKEN_PATH = STORAGE_PATH;
