import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import Handlebars from "handlebars";
import { parse as parseYaml } from "yaml";
import { jsonrepair } from "jsonrepair";
import { v4 as uuidv4 } from "uuid";
import { getDeepSeekClient, type LLMResponse } from "../llm/deepseek.js";
import { getSearchTool, type SearchResult } from "../tools/search.js";
import { getContextStore } from "../memory/contextStore.js";
import { getConfig, logger } from "../config.js";
import type { AppConfig } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface PromptTemplate {
  system: string;
  user: string;
  mode: "chat" | "reason";
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
  ): { system: string; userPrompt: string; mode: "chat" | "reason"; maxTokens: number } {
    const filePath = join(this.promptsDir, category, `${name}.yaml`);
    try {
      const raw = readFileSync(filePath, "utf-8");
      const template = parseYaml(raw) as PromptTemplate;

      const compileSystem = Handlebars.compile(template.system);
      const compileUser = Handlebars.compile(template.user);

      return {
        system: compileSystem(vars),
        userPrompt: compileUser(vars),
        mode: template.mode ?? "chat",
        maxTokens: template.max_tokens ?? 8192,
      };
    } catch (err) {
      logger.error(`Failed to load prompt ${category}/${name}: ${(err as Error).message}`);
      // Return a minimal fallback — must mention "json" so DeepSeek accepts json_object response_format
      return {
        system: "You are a scientific research assistant. Respond with valid json only.",
        userPrompt: `Respond with valid json.\n\n${JSON.stringify(vars)}`,
        mode: "chat",
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
      mode?: "chat" | "reason";
      maxTokens?: number;
      temperature?: number;
      /** Set true when the response must be valid JSON (enables json_object mode for chat calls) */
      jsonMode?: boolean;
    } = {}
  ): Promise<LLMResponse> {
    const { mode = "chat", maxTokens = 8192, temperature = 0.7, jsonMode = false } = options;

    const messages = [
      { role: "system" as const, content: system },
      { role: "user" as const, content: userPrompt },
    ];

    let response: LLMResponse;
    if (mode === "reason") {
      response = await this.llm.reason({ messages, maxTokens, temperature, jsonMode });
    } else {
      response = await this.llm.chat({ messages, maxTokens, temperature, jsonMode });
    }

    // DeepSeek thinking mode can return empty content when the model exhausts its
    // token budget inside <think> blocks. Fall back to reasoning_content in that case.
    if (!response.content?.trim() && response.reasoning?.trim()) {
      logger.debug(`[${this.agentName}] Empty content, falling back to reasoning field`);
      response = { ...response, content: response.reasoning };
    }

    if (response.reasoning?.trim()) {
      const snippet = response.reasoning.trim().slice(0, 300).replace(/\n+/g, " ");
      logger.debug(`[${this.agentName}] Thinking trace (${response.reasoning.length} chars): ${snippet}${response.reasoning.length > 300 ? "…" : ""}`);

      // Persist thinking trace to DB
      const sid = BaseAgent.currentSessionId;
      if (sid) {
        try {
          this.memory.saveThinkingTrace({
            id: uuidv4(),
            sessionId: sid,
            agent: this.agentName,
            reasoning: response.reasoning.trim(),
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
            totalTokens: response.usage.totalTokens,
          });
        } catch {
          // Best-effort — don't let DB errors break the agent.
        }
      }
    }

    // Log LLM call to session activity
    const sid = BaseAgent.currentSessionId;
    if (sid) {
      try {
        this.memory.logActivity({
          id: uuidv4(),
          sessionId: sid,
          agent: this.agentName,
          type: "llm_call",
          message: `${mode} call: ${userPrompt.slice(0, 120)}${userPrompt.length > 120 ? "…" : ""}`,
          detailJson: JSON.stringify({
            system: system.slice(0, 500),
            userPrompt: userPrompt.slice(0, 500),
            response: response.content.slice(0, 500),
            reasoningLen: response.reasoning?.length ?? 0,
            mode,
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
    options: { mode?: "chat" | "reason"; maxTokens?: number; jsonMode?: boolean } = {}
  ): Promise<LLMResponse> {
    const { mode = "reason", maxTokens = 8192, jsonMode = false } = options;
    const messages = [
      { role: "system" as const, content: system },
      ...turns,
    ];

    let response: LLMResponse;
    if (mode === "reason") {
      response = await this.llm.reason({ messages, maxTokens, jsonMode });
    } else {
      response = await this.llm.chat({ messages, maxTokens, jsonMode });
    }

    // Same empty-content fallback
    if (!response.content?.trim() && response.reasoning?.trim()) {
      logger.debug(`[${this.agentName}] Empty content (multi-turn), falling back to reasoning field`);
      response = { ...response, content: response.reasoning };
    }

    if (response.reasoning?.trim()) {
      const snippet = response.reasoning.trim().slice(0, 300).replace(/\n+/g, " ");
      logger.debug(`[${this.agentName}] Thinking trace (${response.reasoning.length} chars): ${snippet}${response.reasoning.length > 300 ? "…" : ""}`);

      const sid = BaseAgent.currentSessionId;
      if (sid) {
        try {
          this.memory.saveThinkingTrace({
            id: uuidv4(),
            sessionId: sid,
            agent: this.agentName,
            reasoning: response.reasoning.trim(),
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
            totalTokens: response.usage.totalTokens,
          });
        } catch { /* best-effort */ }
      }
    }

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
          message: `multi-turn ${mode}: ${(lastUserTurn?.content ?? "").slice(0, 120)}`,
          detailJson: JSON.stringify({
            system: system.slice(0, 500),
            turns: turns.length,
            response: response.content.slice(0, 500),
            reasoningLen: response.reasoning?.length ?? 0,
            mode,
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
      mode?: "chat" | "reason";
      maxTokens?: number;
      temperature?: number;
    } = {}
  ): Promise<T | null> {
    const response = await this.callLLM(system, userPrompt, {
      ...options,
      jsonMode: true,
    });

    const result = this.extractJSON<T>(response.content);
    if (result !== null) return result;

    // Retry: ask the model to output only the JSON, feeding back the bad response
    logger.warn(`[${this.agentName}] JSON extraction failed — retrying with explicit JSON prompt`);
    const retrySystem = "You are a JSON formatter. Output only valid JSON with no markdown, no commentary, and no code fences.";
    const retryPrompt = `The following text should be a JSON object but could not be parsed. Extract and output ONLY the JSON object:\n\n${response.content.slice(0, 4000)}`;
    const retryResponse = await this.callLLM(retrySystem, retryPrompt, {
      mode: "chat",
      maxTokens: options.maxTokens ?? 8192,
      jsonMode: true,
    });

    return this.extractJSON<T>(retryResponse.content);
  }

  /**
   * Extract JSON from LLM response (handles markdown code blocks, trailing text,
   * and common LLM formatting artifacts).
   */
  protected extractJSON<T>(text: string): T | null {
    if (!text || !text.trim()) return null;

    // Pre-process: strip <think>...</think> reasoning blocks that some models
    // (e.g. DeepSeek, QwQ) prepend to their output before the JSON.
    const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    if (stripped && stripped !== text) {
      // Recurse on the cleaned text first; avoids the expensive strategies below
      const fromStripped = this.extractJSON<T>(stripped);
      if (fromStripped !== null) return fromStripped;
    }

    // Strategy 1: direct parse
    try {
      return JSON.parse(text) as T;
    } catch { /* continue */ }

    // Strategy 2: extract from ```json ... ``` or ``` ... ``` code blocks
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      const inner = codeBlockMatch[1].trim();
      try { return JSON.parse(inner) as T; } catch { /* continue */ }
      try { return JSON.parse(jsonrepair(inner)) as T; } catch { /* continue */ }
    }

    // Strategy 3: scan for the first balanced {...} or [...] respecting strings
    const span = this._findFirstBalancedJson(text);
    if (span) {
      try { return JSON.parse(span) as T; } catch { /* continue */ }
      try { return JSON.parse(jsonrepair(span)) as T; } catch { /* continue */ }
    }

    // Strategy 4: jsonrepair on the whole text (final fallback — handles many LLM artifacts)
    try {
      const repaired = jsonrepair(text);
      return JSON.parse(repaired) as T;
    } catch { /* continue */ }

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
