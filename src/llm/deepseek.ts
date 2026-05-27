import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { getConfig, logger } from "../config.js";

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  content: string;
  usage: LLMUsage;
  reasoning?: string; // Thinking trace (disabled — kept for interface compatibility)
}

// Thinking is disabled. This type is retained for interface compatibility only.
export type ReasoningEffort = "high" | "max";

// DeepSeek chat parameters (thinking/reasoning fields are intentionally omitted)
interface DeepSeekChatParams {
  messages: ChatCompletionMessageParam[];
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort; // unused — kept for interface compatibility
  enableThinking?: boolean;          // unused — thinking is disabled
  /** When true, instructs the model to return valid JSON via response_format */
  jsonMode?: boolean;
}

export class DeepSeekClient {
  private client: OpenAI;
  private model: string;
  private totalTokensUsed = 0;
  private _deltaBaseline = 0;

  constructor() {
    const config = getConfig();
    this.client = new OpenAI({
      baseURL: config.deepseek.baseURL,
      apiKey: config.deepseek.apiKey,
    });
    this.model = config.deepseek.model;
  }

  /**
   * Standard chat call — fast, lower cost, no thinking.
   * Good for: generation, evolution, proximity tasks.
   */
  async chat(params: DeepSeekChatParams): Promise<LLMResponse> {
    return this._call({
      ...params,
      enableThinking: false,
      reasoningEffort: undefined,
    });
  }

  /**
   * Alias for `chat()`. Thinking is intentionally disabled for cost/latency —
   * both methods call `_call()` identically.
   * To re-enable DeepSeek reasoning, remove `thinking: { type: 'disabled' }` from `_call()`.
   */
  async reason(params: DeepSeekChatParams): Promise<LLMResponse> {
    return this.chat(params);
  }

  private async _call(params: DeepSeekChatParams): Promise<LLMResponse> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = Math.pow(2, attempt) * 1000;
          logger.debug(`DeepSeek retry ${attempt}/${maxRetries}, waiting ${delay}ms`);
          await sleep(delay);
        }

        // Base request body — thinking is EXPLICITLY disabled so reasoning
        // models (e.g. deepseek-v4-pro) don't generate <think> blocks or
        // reasoning_content. Without this, thinking is ON by default and
        // the <think> blocks consume the max_tokens budget, truncating
        // actual JSON output and causing extraction failures.
        const requestBody: Record<string, unknown> = {
          model: this.model,
          messages: params.messages,
          max_tokens: params.maxTokens ?? 8192,
          stream: false,
          thinking: { type: "disabled" },
        };

        // Include temperature for output control.
        if (params.temperature !== undefined) {
          requestBody["temperature"] = params.temperature;
        }

        // JSON output mode — requires the word "json" to appear in the prompt.
        if (params.jsonMode) {
          requestBody["response_format"] = { type: "json_object" };
        }

        // Use the raw API call to pass DeepSeek-specific fields that the typed SDK
        // does not expose (thinking, reasoning_content, etc.).
        const completion = await (this.client.chat.completions.create as Function)(
          requestBody
        ) as OpenAI.Chat.ChatCompletion & {
          choices: Array<{
            message: {
              content: string | null;
              reasoning_content?: string;
            };
          }>;
        };

        const usage: LLMUsage = {
          promptTokens: completion.usage?.prompt_tokens ?? 0,
          completionTokens: completion.usage?.completion_tokens ?? 0,
          totalTokens: completion.usage?.total_tokens ?? 0,
        };

        this.totalTokensUsed += usage.totalTokens;
        logger.debug(
          `DeepSeek call: ${usage.totalTokens} tokens (total: ${this.totalTokensUsed})`
        );

        const message = completion.choices[0]?.message;
        // Safety net: strip any residual <think> blocks if the API ever leaks them
        // despite thinking: disabled.
        const rawContent = message?.content ?? "";
        const content = rawContent.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        return {
          content,
          usage,
          // With thinking explicitly disabled, reasoning_content should always
          // be empty. We still read it as a safety net but don't expect it.
          reasoning: message?.reasoning_content || undefined,
        };
      } catch (error) {
        lastError = error as Error;
        logger.warn(`DeepSeek API error (attempt ${attempt + 1}): ${lastError.message}`);

        // Don't retry on auth errors
        if ((error as { status?: number }).status === 401) {
          throw error;
        }
      }
    }

    throw lastError ?? new Error("DeepSeek API call failed after retries");
  }

  /**
   * Generate embeddings for semantic similarity using the local all-MiniLM-L6-v2 model.
   * DeepSeek does not provide an embedding endpoint — local inference is the only path.
   * Model is downloaded once to ~/.cache/huggingface on first use, then cached.
   */
  async embed(texts: string[]): Promise<number[][]> {
    return localEmbed(texts);
  }

  getTotalTokensUsed(): number {
    return this.totalTokensUsed;
  }

  /** Returns tokens used since the last call to this method (resets the baseline). */
  getTokensDelta(): number {
    const delta = this.totalTokensUsed - this._deltaBaseline;
    this._deltaBaseline = this.totalTokensUsed;
    return delta;
  }
}

// Local embedding fallback using @xenova/transformers
let _localPipeline: ((texts: string[]) => Promise<number[][]>) | null = null;

async function localEmbed(texts: string[]): Promise<number[][]> {
  if (!_localPipeline) {
    const { pipeline } = await import("@huggingface/transformers");
    const extractor = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    );
    _localPipeline = async (inputs: string[]) => {
      const output = await extractor(inputs, {
        pooling: "mean",
        normalize: true,
      }) as { data: Float32Array; dims: number[] };
      // Handle both batched and single output
      const dims = output.dims;
      const batchSize = dims[0];
      const hiddenSize = dims[1];
      const result: number[][] = [];
      for (let i = 0; i < batchSize; i++) {
        result.push(Array.from(output.data.slice(i * hiddenSize, (i + 1) * hiddenSize)));
      }
      return result;
    };
  }
  return _localPipeline(texts);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Singleton
let _client: DeepSeekClient | null = null;

export function getDeepSeekClient(): DeepSeekClient {
  if (!_client) _client = new DeepSeekClient();
  return _client;
}
