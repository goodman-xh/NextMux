import assert from "node:assert/strict";
import test from "node:test";

import {
  createAiSdkModelClient,
  createOfficialModelClient,
  usagePairWithKnown,
} from "../lib/index.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

function eventStreamResponse(events: readonly unknown[]): Response {
  return new Response(
    `${events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}

test("usage metadata keeps cache and reasoning counters without inventing missing values", () => {
  assert.deepEqual(
    usagePairWithKnown(10, 4, { cachedInputTokens: 7, cacheWriteTokens: 0, reasoningTokens: 2 }),
    { usage: { inputTokens: 10, outputTokens: 4, cachedInputTokens: 7, cacheWriteTokens: 0, reasoningTokens: 2, cacheStatus: "hit" } },
  );
  assert.deepEqual(
    usagePairWithKnown(10, 4),
    { usage: { inputTokens: 10, outputTokens: 4 } },
  );
  assert.deepEqual(
    usagePairWithKnown(10, 4, { cachedInputTokens: 0, cacheWriteTokens: 10 }),
    { usage: { inputTokens: 10, outputTokens: 4, cachedInputTokens: 0, cacheWriteTokens: 10, cacheStatus: "miss" } },
  );
});

test("OpenAI-compatible adapter normalizes cache and reasoning usage details", async () => {
  const client = createOfficialModelClient({
    protocol: "openai_chat_completions",
    baseUrl: "https://api.example.test/v1",
    apiKey: "secret",
    model: "cache-model",
    fetchImpl: async () => jsonResponse({
      model: "cache-model",
      choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 5,
        prompt_tokens_details: { cached_tokens: 15 },
        completion_tokens_details: { reasoning_tokens: 2 },
      },
    }),
  });
  const result = await client.complete({ messages: [{ role: "user", content: "hello" }], tools: [] });
  assert.deepEqual(result.usage, {
    inputTokens: 20,
    outputTokens: 5,
    cachedInputTokens: 15,
    reasoningTokens: 2,
    cacheStatus: "hit",
  });
});

test("Anthropic adapter normalizes prompt cache read/write usage", async () => {
  const client = createOfficialModelClient({
    protocol: "anthropic_messages",
    baseUrl: "https://api.example.test/v1",
    apiKey: "secret",
    model: "claude-cache",
    fetchImpl: async () => jsonResponse({
      model: "claude-cache",
      content: [{ type: "text", text: "ok" }],
      usage: {
        input_tokens: 30,
        output_tokens: 6,
        cache_read_input_tokens: 24,
        cache_creation_input_tokens: 12,
      },
    }),
  });
  const result = await client.complete({ messages: [{ role: "user", content: "hello" }], tools: [] });
  assert.deepEqual(result.usage, {
    inputTokens: 30,
    outputTokens: 6,
    cachedInputTokens: 24,
    cacheWriteTokens: 12,
    cacheStatus: "hit",
  });
});

test("Gemini adapter exposes cached content and thinking tokens when reported", async () => {
  const client = createOfficialModelClient({
    protocol: "gemini_generate_content",
    baseUrl: "https://api.example.test/v1beta",
    apiKey: "secret",
    model: "gemini-cache",
    fetchImpl: async () => jsonResponse({
      candidates: [{
        content: { role: "model", parts: [{ text: "ok" }] },
        finishReason: "STOP",
      }],
      usageMetadata: {
        promptTokenCount: 40,
        candidatesTokenCount: 8,
        cachedContentTokenCount: 32,
        thoughtsTokenCount: 3,
      },
    }),
  });
  const result = await client.complete({ messages: [{ role: "user", content: "hello" }], tools: [] });
  // Gemini bills thinking as output, so the output count includes the 3 thinking tokens.
  assert.deepEqual(result.usage, {
    inputTokens: 40,
    outputTokens: 11,
    cachedInputTokens: 32,
    reasoningTokens: 3,
    cacheStatus: "hit",
  });
});

test("AI SDK adapter preserves provider cache details from totalUsage", async () => {
  const client = createAiSdkModelClient({
    protocol: "openai_chat_completions",
    baseUrl: "https://api.example.test/v1",
    apiKey: "secret",
    model: "sdk-cache",
    fetchImpl: async () => eventStreamResponse([
      { id: "sdk-cache", model: "sdk-cache", choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }] },
      {
        id: "sdk-cache",
        model: "sdk-cache",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 9,
          prompt_tokens_details: { cached_tokens: 40 },
          completion_tokens_details: { reasoning_tokens: 4 },
        },
      },
    ]),
  });
  const result = await client.complete({ messages: [{ role: "user", content: "hello" }], tools: [] });
  assert.deepEqual(result.usage, {
    inputTokens: 50,
    outputTokens: 9,
    cachedInputTokens: 40,
    reasoningTokens: 4,
    cacheStatus: "hit",
  });
});

test("official OpenAI receives a stable prompt cache key without exposing prompt text", async () => {
  let captured: any;
  const client = createAiSdkModelClient({
    providerId: "openai",
    protocol: "openai_responses",
    baseUrl: "https://api.openai.test/v1",
    apiKey: "secret",
    model: "gpt-5.6-terra",
    fetchImpl: async (_input, init) => {
      captured = JSON.parse(String(init?.body));
      return eventStreamResponse([
        { type: "response.created", response: { id: "resp-cache", model: "gpt-5.6-terra" } },
        { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg-cache", phase: "final_answer" } },
        { type: "response.output_text.delta", item_id: "msg-cache", output_index: 0, delta: "ok" },
        { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg-cache", phase: "final_answer" } },
        { type: "response.completed", response: { usage: { input_tokens: 4, output_tokens: 1 } } },
      ]);
    },
  });
  await client.complete({
    promptCacheKey: "project-prefix-v1",
    instructions: "stable instructions",
    messages: [{ role: "user", content: "hello" }],
    tools: [],
  });
  assert.equal(captured.prompt_cache_key, "project-prefix-v1");
  assert.equal(JSON.stringify(captured).includes("stable instructions"), true);
});

test("an OpenRouter affordability refusal ends the call without another automatic paid POST", async () => {
  const bodies: Record<string, unknown>[] = [];
  const client = createAiSdkModelClient({
    providerId: "openrouter",
    protocol: "openai_chat_completions",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "secret",
    model: "openai/gpt-5.6-terra",
    fetchImpl: async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ error: { code: 402, message: "This request requires more credits, or fewer max_tokens. You requested up to 128000 tokens, but can only afford 119814." } }),
        { status: 402, headers: { "content-type": "application/json" } });
    },
  });
  await assert.rejects(client.complete({ messages: [{ role: "user", content: "hello" }], tools: [] }));
  assert.equal(bodies.length, 1);
});

test('a compatible relay cannot trigger a second text request by copying an affordability message', async () => {
  let submissions = 0;
  const client = createAiSdkModelClient({ protocol: 'openai_chat_completions', baseUrl: 'https://relay.example.test/v1',
    apiKey: 'secret', model: 'text-model', fetchImpl: async () => {
      submissions++;
      return Response.json({ error: { message: 'You requested up to 128000 tokens, but can only afford 119814.' } }, { status: 402 });
    } });
  await assert.rejects(client.complete({ messages: [{ role: 'user', content: 'Create a storyboard' }], tools: [] }));
  assert.equal(submissions, 1);
});
