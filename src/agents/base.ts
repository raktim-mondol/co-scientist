import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import Handlebars from "handlebars";
import { parse as parseYaml } from "yaml";
import { jsonrepair } from "jsonrepair";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { getDeepSeekClient, type LLMResponse } from "../llm/deepseek.js";
import { getSearchTool, type SearchResult } from "../tools/search.js";
import { getContextStore } from "../memory/contextStore.js";
import { getConfig, logger } from "../config.js";
import type { AppConfig } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface PromptTemplate {
  system: string;
  user: string;
  mode?: "chat" | "reason";   // kept for backward compat with existing YAMLs; ignored at runtime
  max_tokens?: number;
}

export interface AgentResult {
  success: boolean;
  tokensUsed: number;
  data?: Record<string, unknown>;
  error?: string;
}

export abstract class BaseAgent {
  protected llm = getDeepSeekClient();
  protected search = getSearchTool();
  protected memory = getContextStore();
  protected config: AppConfig = getConfig();
  protected promptsDir = join(__dirname, "..", "prompts");

  abstract get agentName(): string;

  /** Set by SupervisorAgent before dispatching — used for DB logging. */
  static currentSessionId: string | null = null;

  /**
   * Load and compile a Handlebars YAML prompt template.
   */
  protected loadPrompt(
    category: string,
    name: string,
    vars: Record<string, unknown> = {}
  ): { system: string; userPrompt: string; maxTokens: number } {
    const filePath = join(this.promptsDir, category, `${name}.yaml`);
    try {
      const raw = readFileSync(filePath, "utf-8");
      const template = parseYaml(raw) as PromptTemplate;

      const compileSystem = Handlebars.compile(template.system);
      const compileUser = Handlebars.compile(template.user);

      return {
        system: compileSystem(vars),
        userPrompt: compileUser(vars),
        maxTokens: template.max_tokens ?? 8192,
      };
    } catch (err) {
      logger.error(`Failed to load prompt ${category}/${name}: ${(err as Error).message}`);
      // Return a minimal fallback — must mention "json" so DeepSeek accepts json_object response_format
      return {
        system: "You are a scientific research assistant. Respond with valid json only.",
        userPrompt: `Respond with valid json.\n\n${JSON.stringify(vars)}`,
        maxTokens: 4096,
      };
    }
  }

  /**
   * Call LLM with a prompt (chat mode — faster, lower cost).
   */
  protected async callLLM(
    system: string,
    userPrompt: string,
    options: {
      maxTokens?: number;
      temperature?: number;
      /** Set true when the response must be valid JSON (enables json_object mode) */
      jsonMode?: boolean;
    } = {}
  ): Promise<LLMResponse> {
    const { maxTokens = 8192, temperature = 0.7, jsonMode = false } = options;

    const messages = [
      { role: "system" as const, content: system },
      { role: "user" as const, content: userPrompt },
    ];

    const response = await this.llm.call({ messages, maxTokens, temperature, jsonMode });

    // Log LLM call to session activity
    const sid = BaseAgent.currentSessionId;
    if (sid) {
      try {
        this.memory.logActivity({
          id: uuidv4(),
          sessionId: sid,
          agent: this.agentName,
          type: "llm_call",
          message: `call: ${userPrompt.slice(0, 120)}${userPrompt.length > 120 ? "…" : ""}`,
          detailJson: JSON.stringify({
            system: system,
            userPrompt: userPrompt,
            response: response.content,
            jsonMode,
          }),
          tokensIn: response.usage.promptTokens,
          tokensOut: response.usage.completionTokens,
        });
      } catch {
        // Best-effort.
      }
    }

    return response;
  }

  /**
   * Call LLM in a multi-turn conversation (for scientific debates).
   */
  protected async callLLMMultiTurn(
    system: string,
    turns: Array<{ role: "user" | "assistant"; content: string }>,
    options: { maxTokens?: number; jsonMode?: boolean } = {}
  ): Promise<LLMResponse> {
    const { maxTokens = 8192, jsonMode = false } = options;
    const messages = [
      { role: "system" as const, content: system },
      ...turns,
    ];

    const response = await this.llm.call({ messages, maxTokens, jsonMode });

    // Log multi-turn LLM call
    const sid = BaseAgent.currentSessionId;
    if (sid) {
      try {
        const lastUserTurn = turns.filter((t) => t.role === "user").pop();
        this.memory.logActivity({
          id: uuidv4(),
          sessionId: sid,
          agent: this.agentName,
          type: "llm_call",
          message: `multi-turn: ${(lastUserTurn?.content ?? "").slice(0, 120)}`,
          detailJson: JSON.stringify({
            system: system.slice(0, 2000),
            turns: turns.length,
            response: response.content,
            jsonMode,
          }),
          tokensIn: response.usage.promptTokens,
          tokensOut: response.usage.completionTokens,
        });
      } catch { /* best-effort */ }
    }

    return response;
  }

  /**
   * Call LLM and extract JSON, with automatic retry if the first response
   * cannot be parsed. On retry, sends the raw response back and asks the model
   * to output only the JSON object with no surrounding text.
   */
  protected async callLLMForJSON<T>(
    system: string,
    userPrompt: string,
    options: {
      maxTokens?: number;
      temperature?: number;
      /** Optional Zod schema for validation. When provided, only objects that
       *  pass schema.safeParse() are returned — failures continue to next strategy. */
      schema?: z.ZodType<T>;
    } = {}
  ): Promise<T | null> {
    const response = await this.callLLM(system, userPrompt, {
      ...options,
      jsonMode: true,
    });

    const result = this.extractJSON<T>(response.content, options.schema);
    if (result !== null) return result;

    // ── Retry 1: ask the model to reformat the bad response as clean JSON ────
    logger.warn(
      `[${this.agentName}] JSON parse failed (${response.content.length} chars) — retrying`
    );
    const retrySystem = "You are a JSON formatter. Output only valid JSON with no markdown, no commentary, and no code fences.";
    const retryPrompt = `The following text should be a JSON object but could not be parsed. Extract and output ONLY the JSON object:\n\n${response.content.slice(0, 4000)}`;
    const retryResponse = await this.callLLM(retrySystem, retryPrompt, {
      maxTokens: options.maxTokens ?? 8192,
      jsonMode: true,
    });

    let retryResult = this.extractJSON<T>(retryResponse.content, options.schema);
    if (retryResult !== null) {
      logger.info(`[${this.agentName}] JSON recovered on retry`);
      return retryResult;
    }

    // ── Retry 2: regenerate from semantic content instead of mechanically extracting ──
    logger.warn(
      `[${this.agentName}] Retry also failed (${retryResponse.content.length} chars) — ` +
      `content: ${retryResponse.content.slice(0, 400)}`
    );
    logger.warn(
      `[${this.agentName}] Attempting second-chance retry: regenerating JSON from semantic content`
    );
    const retry2System = "You are a JSON generator. Given a piece of scientific text, output a JSON review object with these fields: verdict (one of: pass, fail, uncertain), noveltyScore (0-10 or null), correctnessScore (0-10 or null), testabilityScore (0-10 or null), safetyFlag (boolean), summary (string), critique (string), supportingEvidence (array of strings). Output ONLY valid JSON, no markdown, no commentary.";
    const retry2Prompt = `Extract the key assessment from this text and output it as a clean JSON review object:\n\n${response.content.slice(0, 4000)}`;
    const retry2Response = await this.callLLM(retry2System, retry2Prompt, {
      maxTokens: options.maxTokens ?? 8192,
      jsonMode: true,
    });

    retryResult = this.extractJSON<T>(retry2Response.content, options.schema);
    if (retryResult === null) {
      logger.error(
        `[${this.agentName}] JSON extraction failed after all retries — returning null. ` +
        `Last content: ${retry2Response.content.slice(0, 400)}`
      );
    }
    return retryResult;
  }

  /**
   * Extract JSON from LLM response (handles markdown code blocks, trailing text,
   * and common LLM formatting artifacts).
   *
   * When an optional Zod `schema` is provided, each successfully-parsed object
   * is validated against it.  If validation fails, the extractor continues to
   * the next strategy instead of returning an object with missing/invalid fields
   * — so callers that use a `?? fallback` get the fallback, not a partial object.
   */
  protected extractJSON<T>(text: string, schema?: z.ZodType<T>): T | null {
    if (!text || !text.trim()) return null;

    // Pre-process: strip <think>...</think> reasoning blocks that some models
    // (e.g. DeepSeek, QwQ) prepend to their output before the JSON.
    const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    if (stripped && stripped !== text) {
      const fromStripped = this.extractJSON<T>(stripped, schema);
      if (fromStripped !== null) return fromStripped;
    }

    // Local helper: parse JSON and optionally validate against schema.
    // Returns null on parse failure or schema validation failure.
    const _parse = (raw: string): T | null => {
      try {
        const parsed = JSON.parse(raw) as T;
        if (!schema) return parsed;
        const result = schema.safeParse(parsed);
        if (result.success) return result.data as T;
        // Schema validation failed — log at WARN so the reason is visible
        // even without LOG_LEVEL=debug (e.g. `null` where a number was
        // expected, missing required field, wrong enum value, etc.).
        logger.warn(
          `[${this.agentName}] JSON parsed but schema rejected: ` +
          result.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message} (received ${JSON.stringify(i.code)})`).join("; ")
        );
        return null;
      } catch {
        return null;
      }
    };

    // Strategy 1: direct parse
    { const r = _parse(text); if (r !== null) return r; }

    // Strategy 2: extract from ```json ... ``` or ``` ... ``` code blocks
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      const inner = codeBlockMatch[1].trim();
      { const r = _parse(inner); if (r !== null) return r; }
      { const r = _parse(jsonrepair(inner)); if (r !== null) return r; }
    }

    // Strategy 3: scan for the first balanced {...} or [...] respecting strings
    const span = this._findFirstBalancedJson(text);
    if (span) {
      { const r = _parse(span); if (r !== null) return r; }
      { const r = _parse(jsonrepair(span)); if (r !== null) return r; }
    }

    // Strategy 4: jsonrepair on the whole text (final fallback)
    try {
      { const r = _parse(jsonrepair(text)); if (r !== null) return r; }
    } catch {
      // jsonrepair threw on irreparable text — nothing left to try
    }

    logger.warn(`[${this.agentName}] Could not extract JSON from response (${text.length} chars) — retrying with fallback prompt may help`);
    logger.debug(`[${this.agentName}] Raw response (first 800):\n${text.slice(0, 800)}`);
    return null;
  }

  /**
   * Scan text for the first balanced JSON object or array, respecting string
   * boundaries and escapes so that braces inside string values don't trip the
   * depth counter.
   */
  private _findFirstBalancedJson(text: string): string | null {
    const firstObj = text.indexOf("{");
    const firstArr = text.indexOf("[");
    let start = -1;
    let openCh = "{", closeCh = "}";
    if (firstObj === -1 && firstArr === -1) return null;
    if (firstObj === -1) { start = firstArr; openCh = "["; closeCh = "]"; }
    else if (firstArr === -1) { start = firstObj; }
    else if (firstObj < firstArr) { start = firstObj; }
    else { start = firstArr; openCh = "["; closeCh = "]"; }

    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (escape) { escape = false; continue; }
      if (c === "\\") { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === openCh) depth++;
      else if (c === closeCh) {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    // Unclosed — return what we have so jsonrepair can attempt to close it
    return text.slice(start);
  }

  /**
   * Format search results as context for LLM.
   */
  protected formatSearchContext(results: SearchResult[]): string {
    if (results.length === 0) return "No relevant literature found.";
    return results
      .slice(0, 8) // Limit to 8 results to stay within context
      .map((r, i) => {
        const meta = [
          r.authors?.slice(0, 3).join(", "),
          r.year ? `(${r.year})` : null,
          r.journal,
        ].filter(Boolean).join(" ");
        return `[${i + 1}] ${r.title}\n   ${meta}\n   ${r.snippet}`;
      })
      .join("\n\n");
  }

  protected log(level: "debug" | "info" | "warn" | "error", msg: string): void {
    logger[level](`[${this.agentName}] ${msg}`);
  }
}
