# Design: Enable DeepSeek Thinking Mode (reason-only, additive budget headroom)

**Date:** 2026-06-14
**Status:** Approved
**Branch:** `feat/deepseek-thinking-mode`

## Context

`co-scientist` runs entirely on DeepSeek (`deepseek-v4-pro`). Thinking mode is
currently **hard-disabled** in `src/llm/deepseek.ts` (`thinking: { type: "disabled" }`),
and `reason()` is a pass-through alias of `chat()`. The fields `enableThinking` and
`reasoningEffort` exist on the params type but are dead.

A prior attempt to use thinking mode "messed up." Live probes against the real API
(via the current `.env` key) identified the actual root cause — which is **not** the
assumed inline-`<think>`-in-content parsing problem:

- The chain-of-thought is returned in a **separate** `message.reasoning_content`
  field. It does **not** leak `<think>` blocks into `message.content`. JSON mode
  (`response_format: { type: "json_object" }`) works correctly with thinking enabled:
  `content` holds clean JSON, reasoning stays isolated in its own field.
- **`max_tokens` caps `reasoning_tokens + content` combined.** A probe at
  `max_tokens=200` with thinking on saw reasoning consume all 200 tokens; `content`
  came back **empty**, `finish_reason: length`, and JSON parsing failed. This is the
  real historical failure mode — reasoning starves the answer budget. Calls with
  tight budgets (ranking debates use `maxTokens: 2000–3000`) are most exposed.
- `reasoning_tokens` are included in `completion_tokens`/`total_tokens`, so the
  existing budget tracker (`totalTokensUsed += usage.totalTokens`) already accounts
  for them — the compute budget simply drains faster.
- `temperature`/`top_p`/`presence_penalty`/`frequency_penalty` are silently ignored
  in thinking mode (no error).

### Probe evidence

| Probe | `max_tokens` | thinking | result |
|-------|-------------|----------|--------|
| plain text | 4096 | on | clean `content`, `reasoning_content` populated, no `<think>` in content |
| JSON mode | 4096 | on | valid JSON in `content`, reasoning isolated |
| tiny budget | 200 | on | `finish_reason: length`, `content` **empty**, JSON parse fails |
| medium budget | 1200 | on | reasoning 487 tok + content 69 tok, valid JSON |
| baseline | 4096 | off | no `reasoning_content` field, faster |

## Goal & Decisions

Re-enable thinking mode safely. Confirmed with user:

- **On by default**, controllable via env (`DEEPSEEK_THINKING`, default `true`).
- **`reason()` only** — leverages the existing `mode: chat` / `mode: reason` split
  already present in every prompt YAML. `chat()` (generation, proximity, simple
  calls) stays fast and non-thinking. **No prompt YAML changes required.**
- **Approach A — additive headroom**: when thinking is on, send
  `max_tokens = promptMaxTokens + reasoningBudgetTokens`, so the prompt's declared
  budget remains fully available for the answer and reasoning gets its own headroom
  on top. Chosen over a multiplier (fuzzier) or detect-and-retry (adds a latency
  round-trip on exactly the hardest calls).

## Behavior matrix

| Call | `DEEPSEEK_THINKING=true` (default) | `DEEPSEEK_THINKING=false` |
|------|-----------------------------------|---------------------------|
| `chat()` (`mode: chat`) | thinking OFF (unchanged) | thinking OFF (unchanged) |
| `reason()` (`mode: reason`) | thinking ON, effort=high, +budget headroom | thinking OFF (today's behavior) |

16 prompts already tagged `mode: reason` automatically gain thinking: ranking
(`debate_match`), reflection (`full_review`, `deep_verification`,
`simulation_review`, `observation_review`), evolution (all 5 strategies),
meta_review (`synthesis`, `research_overview`), generation (`scientific_debate`,
`assumption_chaining`), `experiment_design/protocol`, `supervisor/parse_goal`.

## Design

### Config (`src/config.ts`)

Add a `thinking` block to the `deepseek` Zod object:

```ts
thinking: z.object({
  enabled: z.boolean().default(true),
  reasoningEffort: z.enum(["high", "max"]).default("high"),
  reasoningBudgetTokens: z.number().int().nonnegative().default(8000),
}).default({}),
```

Env mapping in `loadConfig()` mirrors existing patterns (`safety.gateEnabled` for the
default-true boolean, `safety.quarantineThreshold` for the enum,
`compute.budgetTokens` for the int):

```ts
thinking: {
  enabled: process.env.DEEPSEEK_THINKING === "false" ? false : undefined,
  reasoningEffort: (() => {
    const v = process.env.DEEPSEEK_REASONING_EFFORT?.trim().toLowerCase();
    return v === "high" || v === "max" ? v : undefined;
  })(),
  reasoningBudgetTokens: process.env.DEEPSEEK_REASONING_BUDGET_TOKENS
    ? parseInt(process.env.DEEPSEEK_REASONING_BUDGET_TOKENS, 10)
    : undefined,
},
```

`z.object(...).default({})` applies each inner field default when its value is
`undefined`.

### LLM client (`src/llm/deepseek.ts`)

- Store thinking config at construction: `this.thinking = config.thinking`.
- `chat()` — unchanged: forces `enableThinking: false`.
- `reason()` — stop aliasing `chat()`; call `_call()` with
  `enableThinking: this.thinking.enabled` and
  `reasoningEffort: this.thinking.reasoningEffort`.
- Extract a new private `buildRequestBody(params)` from `_call()` so request shaping
  is unit-testable without network:

  ```ts
  const thinkingOn = !!params.enableThinking;
  const base = params.maxTokens ?? 8192;
  // ...
  if (thinkingOn) {
    body.thinking = { type: "enabled" };
    body.reasoning_effort = params.reasoningEffort ?? this.thinking.reasoningEffort;
    body.max_tokens = base + this.thinking.reasoningBudgetTokens;  // approach A
    // temperature intentionally omitted (ignored in thinking mode)
  } else {
    body.thinking = { type: "disabled" };
    body.max_tokens = base;
    if (params.temperature !== undefined) body.temperature = params.temperature;
  }
  if (params.jsonMode) body.response_format = { type: "json_object" };
  ```

- Keep reading `message.reasoning_content` into the `reasoning` field (already
  present) and keep the `<think>` strip safety net on `content`.
- Update the stale comment (currently claims thinking is always disabled).

### BaseAgent (`src/agents/base.ts`)

- Reword the `"Thinking (unexpected)"` debug logs in `callLLM` and `callLLMMultiTurn`
  — thinking is now **expected** on reason calls (e.g. `Thinking trace (N chars)`).
- Keep the empty-content → `reasoning` fallback as a rare last resort. With additive
  headroom it should not fire; for JSON calls the existing `callLLMForJSON` retry
  (chat mode, thinking off) remains the real safety net since reasoning prose won't
  parse as JSON.

### Multi-turn debates (`src/agents/ranking.ts`) — no code change

Client-level additive headroom covers the tight `maxTokens: 2000–3000` budgets. Per
DeepSeek docs, `reasoning_content` does **not** need threading back for non-tool-call
turns, and this codebase uses no native tool calls (MCP search results are stuffed
into prompts), so there is no 400-error risk and no message-threading change.

### Docs

- `.env.example` + `.env`: document the three new vars under the DeepSeek section.
- `CLAUDE.md` (LLM Client section) and `README.md`: note thinking is on for `reason()`
  calls, the additive-budget behavior, and that the compute budget drains faster.

## Components & boundaries

- **Config** owns the policy (enabled / effort / headroom) and env parsing.
- **`DeepSeekClient`** owns request shaping (`buildRequestBody`) and response
  normalization. `chat()`/`reason()` are the stable interface; agents never see the
  thinking machinery.
- **`BaseAgent`** consumes `chat()`/`reason()` and is unaware of thinking internals
  beyond the `reasoning` field it already handles.

## Testing

New `src/tests/deepseek.test.ts` (`bun:test`) asserts `buildRequestBody`:

- reason + thinking enabled → `thinking.type === "enabled"`, `reasoning_effort` set,
  `max_tokens === promptMax + reasoningBudgetTokens`, no `temperature`.
- chat → `thinking.type === "disabled"`, `temperature` present, `max_tokens === promptMax`.
- `DEEPSEEK_THINKING=false` (via `resetConfig()` after setting env) → reason behaves
  like chat (thinking disabled).
- `jsonMode` → `response_format` present in both modes.

Plus: full suite green (`bun test`); live smoke confirming `reason()` JSON parses and
`reasoning_tokens > 0`; toggle-off parity check.

## Out of scope

- Surfacing `finish_reason` for detect-and-retry (approach C) — possible later safety
  net, not needed given additive headroom.
- Native tool-call reasoning_content threading — codebase uses no native tool calls.
