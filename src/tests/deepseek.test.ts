import { describe, test, expect, afterEach, beforeEach } from "bun:test";

// Must be set before importing config (loadConfig requires a non-empty key).
process.env.DEEPSEEK_API_KEY = "stub-for-tests";

import { resetConfig, getConfig } from "../config.js";
import { DeepSeekClient, buildRequestBody } from "../llm/deepseek.js";

const messages = [{ role: "user" as const, content: "hi" }];

/** Stub the OpenAI create method to capture request bodies. */
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

describe("buildRequestBody (pure request shaping)", () => {
  test("default → thinking disabled, jsonMode off", () => {
    const body = buildRequestBody("deepseek-v4-pro", { messages, maxTokens: 1000, temperature: 0.5 });
    expect((body.thinking as { type: string }).type).toBe("disabled");
    expect(body.max_tokens).toBe(1000);
    expect(body.temperature).toBe(0.5);
    expect(body.response_format).toBeUndefined();
  });

  test("jsonMode on → json_object set", () => {
    const body = buildRequestBody("deepseek-v4-pro", { messages, maxTokens: 1000, jsonMode: true });
    expect((body.response_format as { type: string }).type).toBe("json_object");
  });

  test("stream is always false", () => {
    const body = buildRequestBody("deepseek-v4-pro", { messages });
    expect(body.stream).toBe(false);
  });

  test("maxTokens defaults to 8192", () => {
    const body = buildRequestBody("deepseek-v4-pro", { messages });
    expect(body.max_tokens).toBe(8192);
  });
});

describe("config env parsing for deepseek", () => {
  afterEach(() => {
    delete process.env.DEEPSEEK_MODEL;
    resetConfig();
  });

  test("defaults: api key from env, default model", () => {
    resetConfig();
    const c = getConfig().deepseek;
    expect(c.apiKey).toBe("stub-for-tests");
    expect(c.model).toBeDefined();
  });

  test("DEEPSEEK_MODEL override", () => {
    process.env.DEEPSEEK_MODEL = "custom-model";
    resetConfig();
    expect(getConfig().deepseek.model).toBe("custom-model");
  });
});

describe("DeepSeekClient call (stubbed network)", () => {
  afterEach(() => {
    resetConfig();
  });

  test("call() disables thinking and respects params", async () => {
    const c = new DeepSeekClient();
    const calls = stubCreate(c);
    await c.call({ messages, maxTokens: 2000, temperature: 0.7, jsonMode: true });
    expect((calls[0].thinking as { type: string }).type).toBe("disabled");
    expect(calls[0].max_tokens).toBe(2000);
    expect(calls[0].temperature).toBe(0.7);
    expect((calls[0].response_format as { type: string }).type).toBe("json_object");
  });

  test("call() returns parsed content and usage", async () => {
    const c = new DeepSeekClient();
    stubCreate(c);
    const response = await c.call({ messages, maxTokens: 1000 });
    expect(response.content).toBe('{"ok":true}');
    expect(response.usage.totalTokens).toBe(2);
  });

  test("call() strips <think> blocks from content", async () => {
    const c = new DeepSeekClient();
    (c as unknown as { client: { chat: { completions: { create: unknown } } } }).client.chat.completions.create =
      async () => ({
        choices: [{ message: { content: "<think>reasoning here</think>actual output" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    const response = await c.call({ messages });
    expect(response.content).toBe("actual output");
  });
});
