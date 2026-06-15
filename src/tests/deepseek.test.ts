import { describe, test, expect, afterEach, beforeEach } from "bun:test";

// Must be set before importing config (loadConfig requires a non-empty key).
process.env.DEEPSEEK_API_KEY = "stub-for-tests";

import { resetConfig, getConfig } from "../config.js";
import { DeepSeekClient, buildRequestBody, type ThinkingConfig } from "../llm/deepseek.js";

const baseThinking: ThinkingConfig = {
  enabled: true,
  reasoningEffort: "high",
  reasoningBudgetTokens: 8000,
  streamThinking: false,
};
const messages = [{ role: "user" as const, content: "hi" }];

/** Stub the OpenAI create method to capture request bodies (non-streaming). */
function stubCreate(client: DeepSeekClient): Array<Record<string, unknown>> {
  const calls: Array<Record<string, unknown>> = [];
  (client as unknown as { client: { chat: { completions: { create: unknown } } } }).client.chat.completions.create =
    async (body: Record<string, unknown>) => {
      calls.push(body);
      return {
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
    };
  return calls;
}

/** Stub the OpenAI create method to return a synthetic async iterable (streaming). */
function stubStream(
  client: DeepSeekClient,
  chunks: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const calls: Array<Record<string, unknown>> = [];
  (client as unknown as { client: { chat: { completions: { create: unknown } } } }).client.chat.completions.create =
    async (body: Record<string, unknown>) => {
      calls.push(body);
      return {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        },
      };
    };
  return calls;
}

describe("buildRequestBody (pure request shaping)", () => {
  test("thinking on → enabled, effort set, additive budget, no temperature, NO json_object (incompatible)", () => {
    const body = buildRequestBody(
      "deepseek-v4-pro",
      { messages, maxTokens: 1000, temperature: 0.7, enableThinking: true, jsonMode: true },
      baseThinking
    );
    expect((body.thinking as { type: string }).type).toBe("enabled");
    expect(body.reasoning_effort).toBe("high");
    expect(body.max_tokens).toBe(9000); // 1000 + 8000 headroom
    expect(body.temperature).toBeUndefined(); // ignored in thinking mode → omitted
    expect(body.response_format).toBeUndefined(); // incompatible with thinking → skipped
  });

  test("thinking off → disabled, temperature kept, no budget added", () => {
    const body = buildRequestBody(
      "deepseek-v4-pro",
      { messages, maxTokens: 1000, temperature: 0.5, enableThinking: false },
      baseThinking
    );
    expect((body.thinking as { type: string }).type).toBe("disabled");
    expect(body.max_tokens).toBe(1000);
    expect(body.temperature).toBe(0.5);
    expect(body.response_format).toBeUndefined();
  });

  test("thinking off + jsonMode → json_object set (compatible)", () => {
    const body = buildRequestBody(
      "deepseek-v4-pro",
      { messages, maxTokens: 1000, enableThinking: false, jsonMode: true },
      baseThinking
    );
    expect((body.thinking as { type: string }).type).toBe("disabled");
    expect((body.response_format as { type: string }).type).toBe("json_object");
  });

  test("effort falls back to config default when param omitted", () => {
    const body = buildRequestBody(
      "m",
      { messages, enableThinking: true },
      { ...baseThinking, reasoningEffort: "max" }
    );
    expect(body.reasoning_effort).toBe("max");
  });
});

describe("config env parsing for deepseek.thinking", () => {
  beforeEach(() => {
    delete process.env.DEEPSEEK_THINKING;
    delete process.env.DEEPSEEK_REASONING_EFFORT;
    delete process.env.DEEPSEEK_REASONING_BUDGET_TOKENS;
    delete process.env.DEEPSEEK_STREAM_THINKING;
  });

  afterEach(() => {
    delete process.env.DEEPSEEK_THINKING;
    delete process.env.DEEPSEEK_REASONING_EFFORT;
    delete process.env.DEEPSEEK_REASONING_BUDGET_TOKENS;
    delete process.env.DEEPSEEK_STREAM_THINKING;
    resetConfig();
  });

  test("defaults: enabled, high effort, 8000 budget, stream on", () => {
    resetConfig();
    const t = getConfig().deepseek.thinking;
    expect(t.enabled).toBe(true);
    expect(t.reasoningEffort).toBe("high");
    expect(t.reasoningBudgetTokens).toBe(8000);
    expect(t.streamThinking).toBe(true);
  });

  test("DEEPSEEK_THINKING=false disables", () => {
    process.env.DEEPSEEK_THINKING = "false";
    resetConfig();
    expect(getConfig().deepseek.thinking.enabled).toBe(false);
  });

  test("effort + budget overrides parsed from env", () => {
    process.env.DEEPSEEK_REASONING_EFFORT = "max";
    process.env.DEEPSEEK_REASONING_BUDGET_TOKENS = "12000";
    resetConfig();
    const t = getConfig().deepseek.thinking;
    expect(t.reasoningEffort).toBe("max");
    expect(t.reasoningBudgetTokens).toBe(12000);
  });
});

describe("DeepSeekClient request wiring (stubbed network)", () => {
  afterEach(() => {
    delete process.env.DEEPSEEK_THINKING;
    // Default is now true — non-streaming tests must opt out explicitly.
    process.env.DEEPSEEK_STREAM_THINKING = "false";
    resetConfig();
  });

  test("reason() enables thinking with additive budget and drops temperature", async () => {
    process.env.DEEPSEEK_STREAM_THINKING = "false";
    resetConfig();
    const c = new DeepSeekClient();
    const calls = stubCreate(c);
    await c.reason({ messages, maxTokens: 2000, temperature: 0.7, jsonMode: true });
    expect((calls[0].thinking as { type: string }).type).toBe("enabled");
    expect(calls[0].max_tokens).toBe(2000 + 8000);
    expect(calls[0].temperature).toBeUndefined();
  });

  test("chat() never enables thinking and keeps its budget", async () => {
    process.env.DEEPSEEK_STREAM_THINKING = "false";
    resetConfig();
    const c = new DeepSeekClient();
    const calls = stubCreate(c);
    await c.chat({ messages, maxTokens: 2000, temperature: 0.7 });
    expect((calls[0].thinking as { type: string }).type).toBe("disabled");
    expect(calls[0].max_tokens).toBe(2000);
  });

  test("DEEPSEEK_THINKING=false makes reason() behave like chat()", async () => {
    process.env.DEEPSEEK_THINKING = "false";
    process.env.DEEPSEEK_STREAM_THINKING = "false";
    resetConfig();
    const c = new DeepSeekClient();
    const calls = stubCreate(c);
    await c.reason({ messages, maxTokens: 2000 });
    expect((calls[0].thinking as { type: string }).type).toBe("disabled");
    expect(calls[0].max_tokens).toBe(2000);
  });
});

describe("DeepSeekClient streaming (DEEPSEEK_STREAM_THINKING)", () => {
  afterEach(() => {
    delete process.env.DEEPSEEK_STREAM_THINKING;
    delete process.env.DEEPSEEK_THINKING;
    resetConfig();
  });

  test("stream enabled + thinking on → streaming path (stream: true in request)", async () => {
    process.env.DEEPSEEK_STREAM_THINKING = "true";
    resetConfig();
    const c = new DeepSeekClient();
    const calls = stubStream(c, []);
    await c.reason({ messages, maxTokens: 1000 });
    expect(calls[0].stream).toBe(true);
  });

  test("stream enabled + thinking off (chat) → non-streaming path", async () => {
    process.env.DEEPSEEK_STREAM_THINKING = "true";
    resetConfig();
    const c = new DeepSeekClient();
    // chat() always sets enableThinking: false, so it should NOT stream
    const calls = stubCreate(c);
    await c.chat({ messages, maxTokens: 1000 });
    expect(calls[0].stream).toBe(false);
  });

  test("stream disabled + thinking on → non-streaming path", async () => {
    process.env.DEEPSEEK_STREAM_THINKING = "false";
    resetConfig();
    const c = new DeepSeekClient();
    const calls = stubCreate(c);
    await c.reason({ messages, maxTokens: 1000 });
    expect(calls[0].stream).toBe(false);
  });

  test("stream chunks: reasoning + content accumulated, usage captured", async () => {
    process.env.DEEPSEEK_STREAM_THINKING = "true";
    resetConfig();
    const c = new DeepSeekClient();
    stubStream(c, [
      { choices: [{ delta: { reasoning_content: "Let me think" } }] },
      { choices: [{ delta: { reasoning_content: " about this." } }] },
      { choices: [{ delta: { content: "The answer" } }] },
      { choices: [{ delta: { content: " is 42." } }] },
      { usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } },
    ]);
    const response = await c.reason({ messages, maxTokens: 1000 });
    expect(response.content).toBe("The answer is 42.");
    expect(response.reasoning).toBe("Let me think about this.");
    expect(response.usage.totalTokens).toBe(30);
    expect(response.usage.promptTokens).toBe(10);
  });

  test("stream with jsonMode + thinking → response_format skipped (incompatible)", async () => {
    process.env.DEEPSEEK_STREAM_THINKING = "true";
    resetConfig();
    const c = new DeepSeekClient();
    const calls = stubStream(c, [
      { choices: [{ delta: { content: '{"ok":true}' } }] },
      { usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } },
    ]);
    await c.reason({ messages, maxTokens: 500, jsonMode: true });
    expect(calls[0].response_format).toBeUndefined(); // incompatible with thinking
    expect((calls[0].thinking as { type: string }).type).toBe("enabled");
    expect(calls[0].stream).toBe(true);
  });

  test("stream with empty content but reasoning present → content is empty string", async () => {
    process.env.DEEPSEEK_STREAM_THINKING = "true";
    resetConfig();
    const c = new DeepSeekClient();
    stubStream(c, [
      { choices: [{ delta: { reasoning_content: "Just thinking..." } }] },
      { usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
    ]);
    const response = await c.reason({ messages, maxTokens: 1000 });
    expect(response.content).toBe("");
    expect(response.reasoning).toBe("Just thinking...");
  });
});
