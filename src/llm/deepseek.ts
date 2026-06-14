import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import chalk from "chalk";
import { homedir } from "os";
import { join } from "path";
import { appendFileSync, mkdirSync } from "fs";
import { getConfig, logger } from "../config.js";

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  content: string;
  usage: LLMUsage;
  reasoning?: string; // Chain-of-thought trace (populated when thinking is enabled)
}

export type ReasoningEffort = "high" | "max";

/** Thinking-mode policy (mirrors config.deepseek.thinking). */
export interface ThinkingConfig {
  enabled: boolean;
  reasoningEffort: ReasoningEffort;
  /** Tokens added on top of a call's max_tokens to give reasoning its own headroom. */
  reasoningBudgetTokens: number;
  /** When true, stream reasoning_content to stderr in real-time (light gray). */
  streamThinking: boolean;
}

interface DeepSeekChatParams {
  messages: ChatCompletionMessageParam[];
  maxTokens?: number;
  temperature?: number;
  /** Effort hint when thinking is enabled; falls back to the configured default. */
  reasoningEffort?: ReasoningEffort;
  /** Whether this call runs in thinking mode (set by chat()/reason()). */
  enableThinking?: boolean;
  /** When true, instructs the model to return valid JSON via response_format */
  jsonMode?: boolean;
}

/**
 * Build the DeepSeek request body. Pure and exported for testing.
 *
 * When thinking is enabled, reasoning_content shares the max_tokens budget with the
 * answer (an empty/truncated answer results if reasoning consumes it all). To prevent
 * that, we add `reasoningBudgetTokens` of headroom on top of the caller's max_tokens
 * (approach A) so the declared budget stays fully available for the actual content.
 */
export function buildRequestBody(
  model: string,
  params: DeepSeekChatParams,
  thinking: ThinkingConfig
): Record<string, unknown> {
  const baseMaxTokens = params.maxTokens ?? 8192;
  const body: Record<string, unknown> = {
    model,
    messages: params.messages,
    stream: false,
  };

  if (params.enableThinking) {
    body["thinking"] = { type: "enabled" };
    body["reasoning_effort"] = params.reasoningEffort ?? thinking.reasoningEffort;
    body["max_tokens"] = baseMaxTokens + thinking.reasoningBudgetTokens;
    // temperature/top_p/presence_penalty/frequency_penalty are silently ignored in
    // thinking mode — omit temperature so we don't imply it has an effect.
  } else {
    body["thinking"] = { type: "disabled" };
    body["max_tokens"] = baseMaxTokens;
    if (params.temperature !== undefined) body["temperature"] = params.temperature;
  }

  if (params.jsonMode) {
    body["response_format"] = { type: "json_object" };
  }

  return body;
}

export class DeepSeekClient {
  private client: OpenAI;
  private model: string;
  private thinking: ThinkingConfig;
  private totalTokensUsed = 0;
  private _deltaBaseline = 0;

  /**
   * When false, _callStreaming will not write reasoning traces to stderr.
   * Set to false by the TUI (src/cli/tui) since raw stderr writes corrupt
   * Ink's ANSI cursor tracking. When stderr is disabled, traces are written
   * to the thinking log file (streamLogPath) instead.
   */
  static stderrEnabled = true;

  /** Base directory for thinking logs. */
  static streamLogDir = join(homedir(), ".co-scientist");

  /** Path to the current session's thinking log file. */
  static streamLogPath = join(DeepSeekClient.streamLogDir, "thinking.log");

  /**
   * Set the thinking log path to a session-specific file.
   * Call once at session start so each session gets its own log.
   */
  static setSessionLogPath(sessionId: string): void {
    try {
      mkdirSync(DeepSeekClient.streamLogDir, { recursive: true });
    } catch {
      // Best-effort.
    }
    DeepSeekClient.streamLogPath = join(
      DeepSeekClient.streamLogDir,
      `thinking-${sessionId}.log`
    );
  }

  constructor() {
    const config = getConfig();
    this.client = new OpenAI({
      baseURL: config.deepseek.baseURL,
      apiKey: config.deepseek.apiKey,
    });
    this.model = config.deepseek.model;
    this.thinking = config.deepseek.thinking;
  }

  /**
   * Standard chat call — always non-thinking (fast, lower cost).
   * Good for: generation, evolution, proximity, and other `mode: chat` prompts.
   */
  async chat(params: DeepSeekChatParams): Promise<LLMResponse> {
    return this._call({
      ...params,
      enableThinking: false,
      reasoningEffort: undefined,
    });
  }

  /**
   * Reasoning call — runs in DeepSeek thinking mode when enabled in config
   * (DEEPSEEK_THINKING, default on). Used by `mode: reason` prompts (ranking,
   * reflection, evolution, meta-review, debates). When thinking is disabled this
   * behaves identically to chat().
   */
  async reason(params: DeepSeekChatParams): Promise<LLMResponse> {
    return this._call({
      ...params,
      enableThinking: this.thinking.enabled,
      reasoningEffort: this.thinking.reasoningEffort,
    });
  }

  private async _call(params: DeepSeekChatParams): Promise<LLMResponse> {
    // When DEEPSEEK_STREAM_THINKING is enabled and thinking is on, stream
    // reasoning_content to stderr in real-time so the user can watch the
    // chain-of-thought unfold.
    if (this.thinking.streamThinking && params.enableThinking) {
      return this._callStreaming(params);
    }
    return this._callNonStreaming(params);
  }

  /** Non-streaming call — current production path. */
  private async _callNonStreaming(params: DeepSeekChatParams): Promise<LLMResponse> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = Math.pow(2, attempt) * 1000;
          logger.debug(`DeepSeek retry ${attempt}/${maxRetries}, waiting ${delay}ms`);
          await sleep(delay);
        }

        const requestBody = buildRequestBody(this.model, params, this.thinking);

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
        const rawContent = message?.content ?? "";
        const content = rawContent.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        const reasoning = message?.reasoning_content || undefined;

        // When thinking is on but streaming is off, write reasoning to the log
        // file so it's still available for inspection without console noise.
        if (reasoning && !this.thinking.streamThinking && params.enableThinking) {
          try {
            appendFileSync(DeepSeekClient.streamLogPath, reasoning + "\n");
          } catch {
            // Best-effort.
          }
        }

        return {
          content,
          usage,
          reasoning,
        };
      } catch (error) {
        lastError = error as Error;
        logger.warn(`DeepSeek API error (attempt ${attempt + 1}): ${lastError.message}`);

        if ((error as { status?: number }).status === 401) {
          throw error;
        }
      }
    }

    throw lastError ?? new Error("DeepSeek API call failed after retries");
  }

  /**
   * Streaming call — used in verbose mode (LOG_LEVEL=debug) with thinking enabled.
   * Streams reasoning_content chunks to stderr in light gray as they arrive so the
   * user can watch the chain-of-thought unfold in real-time.
   */
  private async _callStreaming(params: DeepSeekChatParams): Promise<LLMResponse> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = Math.pow(2, attempt) * 1000;
          logger.debug(`DeepSeek retry ${attempt}/${maxRetries}, waiting ${delay}ms`);
          await sleep(delay);
        }

        const requestBody = buildRequestBody(this.model, params, this.thinking);
        requestBody["stream"] = true;

        const stream = await (this.client.chat.completions.create as Function)(
          requestBody
        ) as AsyncIterable<{
          choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        }>;

        let reasoningContent = "";
        let content = "";
        let usage: LLMUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.reasoning_content) {
            reasoningContent += delta.reasoning_content;
            if (DeepSeekClient.stderrEnabled) {
              // Non-TUI mode — write to stdout so thinking traces share a single
              // stream with all other log output and don't interleave chaotically.
              process.stdout.write(chalk.gray(delta.reasoning_content));
            } else {
              // TUI mode — write to log file to avoid corrupting Ink's ANSI rendering.
              try {
                appendFileSync(DeepSeekClient.streamLogPath, delta.reasoning_content);
              } catch {
                // Best-effort — silently skip if filesystem isn't available.
              }
            }
          }
          if (delta?.content) {
            content += delta.content;
          }
          if (chunk.usage) {
            usage = {
              promptTokens: chunk.usage.prompt_tokens ?? 0,
              completionTokens: chunk.usage.completion_tokens ?? 0,
              totalTokens: chunk.usage.total_tokens ?? 0,
            };
          }
        }

        // Newline to separate the reasoning stream from the next log line
        if (reasoningContent) {
          if (DeepSeekClient.stderrEnabled) {
            process.stdout.write("\n");
          } else {
            try {
              appendFileSync(DeepSeekClient.streamLogPath, "\n");
            } catch {
              // Best-effort.
            }
          }
        }

        this.totalTokensUsed += usage.totalTokens;
        logger.debug(
          `DeepSeek call: ${usage.totalTokens} tokens (total: ${this.totalTokensUsed})`
        );

        const cleanContent = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        return {
          content: cleanContent,
          usage,
          reasoning: reasoningContent || undefined,
        };
      } catch (error) {
        lastError = error as Error;
        logger.warn(`DeepSeek API error (attempt ${attempt + 1}): ${lastError.message}`);

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

// Local embedding fallback using @huggingface/transformers
// Locked to all-MiniLM-L6-v2 which produces exactly 384-dimensional unit vectors.
const EXPECTED_EMBED_DIM = 384;
let _localPipeline: ((texts: string[]) => Promise<number[][]>) | null = null;

async function localEmbed(texts: string[]): Promise<number[][]> {
  if (!_localPipeline) {
    const { pipeline } = await import("@huggingface/transformers");
    // Explicitly pin the revision to prevent the library from silently
    // resolving to a different (larger) model variant.
    const extractor = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
      { revision: "main" }
    );
    _localPipeline = async (inputs: string[]) => {
      const output = await extractor(inputs, {
        pooling: "mean",
        normalize: true,
      }) as { data: Float32Array; dims: number[] };
      const dims = output.dims;
      // dims may be [batchSize, hiddenSize] (2-D, pooled) or
      // [batchSize, seqLen, hiddenSize] (3-D, unpooled) depending on
      // the transformers library version.  Always use the actual data
      // length to derive the per-sample stride so 3-D output is handled
      // correctly: stride = data.length / batchSize.
      const batchSize = dims[0];
      const stride = output.data.length / batchSize; // floats per sample
      if (stride !== EXPECTED_EMBED_DIM) {
        throw new Error(
          `Embedding dimension mismatch: expected ${EXPECTED_EMBED_DIM} but ` +
          `model returned ${stride} values per sample (dims=${JSON.stringify(dims)}). ` +
          `Delete ~/.cache/huggingface and re-run to force a fresh download.`
        );
      }
      const result: number[][] = [];
      for (let i = 0; i < batchSize; i++) {
        result.push(Array.from(output.data.slice(i * stride, (i + 1) * stride)));
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
