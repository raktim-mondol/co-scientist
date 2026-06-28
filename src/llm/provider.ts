import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  content: string;
  usage: LLMUsage;
}

export interface ChatParams {
  messages: ChatCompletionMessageParam[];
  maxTokens?: number;
  temperature?: number;
  /** When true, instructs the model to return valid JSON via response_format */
  jsonMode?: boolean;
}

/**
 * Abstraction over an LLM provider (DeepSeek, Claude, OpenAI, etc.).
 * Implementations handle authentication, retries, and token tracking.
 */
export interface LLMProvider {
  chat(params: ChatParams): Promise<LLMResponse>;
  /** Typically routed to a thinking/reasoning-enabled model variant. */
  reason(params: ChatParams): Promise<LLMResponse>;
  /** Generate embeddings for semantic similarity. */
  embed(texts: string[]): Promise<number[][]>;
  getTotalTokensUsed(): number;
  /** Returns tokens used since the last call to this method (resets baseline). */
  getTokensDelta(): number;
}
