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
}

interface DeepSeekChatParams {
  messages: ChatCompletionMessageParam[];
  maxTokens?: number;
  temperature?: number;
  /** When true, instructs the model to return valid JSON via response_format */
  jsonMode?: boolean;
}

/**
 * Build the DeepSeek request body. Pure and exported for testing.
 */
export function buildRequestBody(
  model: string,
  params: DeepSeekChatParams
): Record<string, unknown> {
  const baseMaxTokens = params.maxTokens ?? 8192;
  const body: Record<string, unknown> = {
    model,
    messages: params.messages,
    stream: false,
    thinking: { type: "disabled" },
    max_tokens: baseMaxTokens,
  };

  if (params.temperature !== undefined) body["temperature"] = params.temperature;
  if (params.jsonMode) {
    body["response_format"] = { type: "json_object" };
  }

  return body;
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

  async call(params: DeepSeekChatParams): Promise<LLMResponse> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = Math.pow(2, attempt) * 1000;
          logger.debug(`DeepSeek retry ${attempt}/${maxRetries}, waiting ${delay}ms`);
          await sleep(delay);
        }

        const requestBody = buildRequestBody(this.model, params);

        const completion = await (this.client.chat.completions.create as Function)(
          requestBody
        ) as OpenAI.Chat.ChatCompletion;

        const usage: LLMUsage = {
          promptTokens: completion.usage?.prompt_tokens ?? 0,
          completionTokens: completion.usage?.completion_tokens ?? 0,
          totalTokens: completion.usage?.total_tokens ?? 0,
        };

        this.totalTokensUsed += usage.totalTokens;
        logger.debug(
          `DeepSeek call: ${usage.totalTokens} tokens (total: ${this.totalTokensUsed})`
        );

        const rawContent = completion.choices[0]?.message?.content ?? "";
        // Strip any <think>...</think> blocks (legacy / other models) and trim.
        const content = rawContent.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

        return { content, usage };
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
      const batchSize = dims[0];
      const stride = output.data.length / batchSize;
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
