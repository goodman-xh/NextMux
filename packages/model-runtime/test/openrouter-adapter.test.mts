import assert from "node:assert/strict";
import test from "node:test";

import type { AgentToolDescriptor } from "@nextmux/agent-runtime";

import {
  createAiSdkModelClient,
  OfficialModelError,
  type OpenRouterResolvedMetadata,
} from "../lib/index.js";

const TEST_KEY = "openrouter-test-key-not-a-real-secret";

const tool: AgentToolDescriptor = {
  name: "workspace.read",
  description: "Read one workspace file",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
    additionalProperties: false,
  },
  requiredPermission: "read_only",
  source: "builtin",
};

function eventStreamResponse(chunks: readonly unknown[], headers: Record<string, string> = {}): Response {
  const body = `${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream", ...headers },
  });
}

function resolvedMetadata(providerState: unknown): OpenRouterResolvedMetadata {
  assert.ok(providerState && typeof providerState === "object");
  const metadata = (providerState as { openRouter?: OpenRouterResolvedMetadata }).openRouter;
  assert.ok(metadata);
  return metadata;
}

test("OpenRouter injects only bounded routing controls without changing messages or tool ids", async () => {
  let capturedBody: any;
  let capturedHeaders = new Headers();
  const mutableModels = ["anthropic/claude-fallback"];
  const mutableOrder = ["Anthropic", "Google"];
  const client = createAiSdkModelClient({
    providerId: "openrouter",
    protocol: "openai_chat_completions",
    baseUrl: "https://openrouter.test/api/v1",
    apiKey: TEST_KEY,
    model: "openai/primary-model",
    openRouterRoutePolicy: {
      models: mutableModels,
      session_id: "conversation-42",
      provider: {
        order: mutableOrder,
        allow_fallbacks: true,
        require_parameters: true,
        data_collection: "deny",
        zdr: true,
        sort: { by: "price", partition: "none" },
        preferred_max_latency: { p50: 1, p90: 3 },
        preferred_min_throughput: 40,
        max_price: { prompt: 1, completion: 2, request: 0.01 },
      },
    },
    fetchImpl: async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body));
      capturedHeaders = new Headers(init?.headers);
      return eventStreamResponse([
        {
          id: "generation-body-1",
          object: "chat.completion.chunk",
          created: 1,
          model: "anthropic/claude-fallback",
          provider: "Anthropic",
          choices: [{ index: 0, delta: { role: "assistant", content: "done" }, finish_reason: null }],
        },
        {
          id: "generation-body-1",
          object: "chat.completion.chunk",
          created: 1,
          model: "anthropic/claude-fallback",
          provider: "Anthropic",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9, cost: 0.000021 },
        },
      ], { "x-generation-id": "generation-header-1" });
    },
  });

  // The client owns a validated copy; later UI mutations cannot alter dispatch.
  mutableModels[0] = "attacker/changed";
  mutableOrder[0] = "Changed";

  const result = await client.complete({
    messages: [
      { role: "user", content: "Read the file" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call-stable-42", name: tool.name, arguments: { path: "README.md" } }],
      },
      { role: "tool", toolCallId: "call-stable-42", content: "original tool output" },
      { role: "user", content: "Summarize it" },
    ],
    tools: [tool],
  });

  assert.deepEqual(capturedBody.models, ["anthropic/claude-fallback"]);
  assert.equal(capturedBody.session_id, "conversation-42");
  assert.deepEqual(capturedBody.provider, {
    order: ["Anthropic", "Google"],
    allow_fallbacks: true,
    require_parameters: true,
    data_collection: "deny",
    zdr: true,
    sort: { by: "price", partition: "none" },
    preferred_max_latency: { p50: 1, p90: 3 },
    preferred_min_throughput: 40,
    max_price: { prompt: 1, completion: 2, request: 0.01 },
  });
  assert.deepEqual(capturedBody.usage, { include: true });
  assert.deepEqual(capturedBody.stream_options, { include_usage: true });
  assert.equal(capturedBody.messages[0].content, "Read the file");
  assert.equal(capturedBody.messages[1].tool_calls[0].id, "call-stable-42");
  assert.equal(capturedBody.messages[2].tool_call_id, "call-stable-42");
  assert.equal(capturedBody.messages[2].content, "original tool output");
  assert.equal(capturedBody.messages[3].content, "Summarize it");
  assert.equal(capturedHeaders.get("http-referer"), "https://nextmux.app");
  assert.equal(capturedHeaders.get("x-openrouter-title"), "NextMux");
  assert.equal(capturedHeaders.get("x-openrouter-metadata"), "enabled");

  assert.equal(result.model, "anthropic/claude-fallback");
  assert.equal(result.usageKnown, undefined);
  const metadata = resolvedMetadata(result.providerState);
  assert.deepEqual(metadata.model, { verified: true, value: "anthropic/claude-fallback" });
  assert.deepEqual(metadata.generationId, { verified: true, value: "generation-header-1" });
  assert.deepEqual(metadata.provider, { verified: true, value: "Anthropic" });
  assert.deepEqual(metadata.cost, { verified: true, value: 0.000021 });
  assert.equal(metadata.usageKnown, true);
  assert.doesNotMatch(JSON.stringify(capturedBody), new RegExp(TEST_KEY));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TEST_KEY));
});

test("OpenRouter marks omitted resolved fields and usage as unverified instead of inventing values", async () => {
  const client = createAiSdkModelClient({
    providerId: "openrouter",
    protocol: "openai_chat_completions",
    baseUrl: "https://openrouter.test/api/v1",
    apiKey: TEST_KEY,
    model: "openai/requested-model",
    fetchImpl: async () => eventStreamResponse([{
      id: "generation-2",
      object: "chat.completion.chunk",
      created: 1,
      model: "openai/requested-model",
      choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }],
    }]),
  });

  const result = await client.complete({ messages: [{ role: "user", content: "hello" }], tools: [] });
  const metadata = resolvedMetadata(result.providerState);
  assert.deepEqual(metadata.model, { verified: true, value: "openai/requested-model" });
  assert.deepEqual(metadata.generationId, { verified: true, value: "generation-2" });
  assert.deepEqual(metadata.provider, { verified: false });
  assert.deepEqual(metadata.cost, { verified: false });
  assert.equal(metadata.usageKnown, false);
  assert.equal(result.usageKnown, false);
});

test("OpenRouter policy bounds fail before dispatch and never reach another compatible provider", async () => {
  let requests = 0;
  const common = {
    protocol: "openai_chat_completions" as const,
    baseUrl: "https://example.test/v1",
    apiKey: TEST_KEY,
    model: "test/model",
    fetchImpl: async () => {
      requests += 1;
      return eventStreamResponse([]);
    },
  };

  const invalidPolicies: unknown[] = [
    { session_id: "x".repeat(257) },
    { models: Array.from({ length: 17 }, (_, index) => `test/model-${index}`) },
    { provider: { order: [] } },
    { provider: { preferred_max_latency: Number.POSITIVE_INFINITY } },
    { provider: { max_price: { prompt: -1 } } },
    { provider: { sort: { by: "random" } } },
    { unsupported: true },
  ];
  for (const openRouterRoutePolicy of invalidPolicies) {
    assert.throws(() => createAiSdkModelClient({
      ...common,
      providerId: "openrouter",
      openRouterRoutePolicy: openRouterRoutePolicy as never,
    }), (error: unknown) => error instanceof OfficialModelError && error.code === "INVALID_REQUEST");
  }
  assert.throws(() => createAiSdkModelClient({
    ...common,
    providerId: "custom_openai",
    openRouterRoutePolicy: { session_id: "must-not-leak" },
  }), (error: unknown) => error instanceof OfficialModelError && error.code === "INVALID_REQUEST");
  assert.throws(() => createAiSdkModelClient({
    ...common,
    providerId: "openrouter",
    protocol: "openai_responses",
    openRouterRoutePolicy: { session_id: "wrong-protocol" },
  }), (error: unknown) => error instanceof OfficialModelError && error.code === "INVALID_REQUEST");
  assert.equal(requests, 0);
});

test("ordinary OpenAI-compatible requests do not receive OpenRouter fields or attribution", async () => {
  let body: any;
  let headers = new Headers();
  const client = createAiSdkModelClient({
    providerId: "custom_openai",
    protocol: "openai_chat_completions",
    baseUrl: "https://relay.test/v1",
    apiKey: "ordinary-compatible-test-key",
    model: "relay-model",
    fetchImpl: async (_input, init) => {
      body = JSON.parse(String(init?.body));
      headers = new Headers(init?.headers);
      return eventStreamResponse([
        { id: "compatible-1", object: "chat.completion.chunk", created: 1, model: "relay-model", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }] },
        { id: "compatible-1", object: "chat.completion.chunk", created: 1, model: "relay-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
      ]);
    },
  });

  await client.complete({ messages: [{ role: "user", content: "hello" }], tools: [] });
  assert.equal(body.models, undefined);
  assert.equal(body.provider, undefined);
  assert.equal(body.session_id, undefined);
  assert.equal(body.usage, undefined);
  assert.equal(headers.get("http-referer"), null);
  assert.equal(headers.get("x-openrouter-title"), null);
  assert.equal(headers.get("x-openrouter-metadata"), null);
});
