import { declaredEffort } from "./fixtures/reasoning-declarations.mts";
import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_SDK_PROVIDER_ADAPTER,
  createPreferredOfficialModelClient,
  modelProviderAdaptersFor,
  requiredTransportCapabilitiesForRequest,
} from "../lib/index.js";

function eventStreamResponse(chunks: readonly unknown[]): Response {
  const body = `${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

test("stable selection keeps Cohere on the native streaming V2 adapter", () => {
  const client = createPreferredOfficialModelClient({
    providerId: "cohere",
    protocol: "cohere_chat",
    baseUrl: "https://api.cohere.test/v2",
    apiKey: "secret-cohere",
    model: "command-test",
  });

  assert.equal(client.adapterId, "ai_sdk");
  assert.equal(AI_SDK_PROVIDER_ADAPTER.protocols.includes("cohere_chat"), true);
  assert.equal(modelProviderAdaptersFor("cohere_chat", ["streaming"])[0]?.id, "ai_sdk");
});

test("an explicit Responses protocol is never overridden by an xAI provider id", async () => {
  let capturedUrl = "";
  let userAgent = "";
  const client = createPreferredOfficialModelClient({
    providerId: "xai",
    protocol: "openai_responses",
    reasoningControls: declaredEffort("openai_responses"),
    baseUrl: "https://api.example.test/v1",
    apiKey: "secret-xai",
    model: "grok-test",
    enablePreviewProviderAdapter: true,
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      userAgent = new Headers(init?.headers).get("user-agent") ?? "";
      return eventStreamResponse([
        { type: "response.created", response: { id: "resp_1", created_at: 1, model: "grok-test", service_tier: null } },
        { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_1", phase: "final_answer" } },
        { type: "response.output_text.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: "ok" },
        { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg_1", phase: "final_answer" } },
        { type: "response.completed", response: { usage: { input_tokens: 1, input_tokens_details: null, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 } }, service_tier: "default" } },
      ]);
    },
  });

  const result = await client.complete({ messages: [{ role: "user", content: "hello" }], tools: [] });
  assert.equal(capturedUrl, "https://api.example.test/v1/responses");
  assert.match(userAgent, /ai-sdk\/openai\/4\./);
  assert.equal(result.content, "ok");
});

test("provider-specific compatible transports remain opt-in until conformance passes", async () => {
  let userAgent = "";
  const client = createPreferredOfficialModelClient({
    providerId: "xai",
    protocol: "openai_chat_completions",
    reasoningControls: declaredEffort("openai_chat_completions"),
    baseUrl: "https://api.x.ai/v1",
    apiKey: "secret-xai",
    model: "grok-test",
    fetchImpl: async (_input, init) => {
      userAgent = new Headers(init?.headers).get("user-agent") ?? "";
      return eventStreamResponse([
        { id: "chatcmpl_1", object: "chat.completion.chunk", created: 1, model: "grok-test", choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }] },
        { id: "chatcmpl_1", object: "chat.completion.chunk", created: 1, model: "grok-test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
      ]);
    },
  });

  await client.complete({ messages: [{ role: "user", content: "hello" }], tools: [] });
  assert.match(userAgent, /ai-sdk\/openai-compatible\/3\./);
  assert.doesNotMatch(userAgent, /ai-sdk\/xai\//);
});

test("preview provider transports reject unproved tools before dispatch", async () => {
  let requests = 0;
  const client = createPreferredOfficialModelClient({
    providerId: "xai",
    protocol: "openai_chat_completions",
    reasoningControls: declaredEffort("openai_chat_completions"),
    baseUrl: "https://api.x.ai/v1",
    apiKey: "secret-xai",
    model: "grok-test",
    enablePreviewProviderAdapter: true,
    fetchImpl: async () => {
      requests += 1;
      throw new Error("must not dispatch");
    },
  });

  await assert.rejects(
    client.complete({
      messages: [{ role: "user", content: "use a tool" }],
      tools: [{
        name: "read_file",
        description: "Read a file",
        inputSchema: { type: "object", properties: {} },
        requiredPermission: "read_only",
        source: "builtin",
      }],
    }),
    (error: any) => error?.code === "UNSUPPORTED_CAPABILITY",
  );
  assert.equal(requests, 0);
});

test("adapter capability filtering advertises file parts only for transports that map them", () => {
  assert.equal(modelProviderAdaptersFor("openai_responses", ["files"])[0]?.id, "ai_sdk");
  assert.equal(modelProviderAdaptersFor("openai_chat_completions", ["files"])[0]?.id, "ai_sdk");
  assert.equal(modelProviderAdaptersFor("anthropic_messages", ["files"])[0]?.id, "ai_sdk");
  assert.equal(modelProviderAdaptersFor("gemini_generate_content", ["files"])[0]?.id, "ai_sdk");
  assert.equal(modelProviderAdaptersFor("cohere_chat", ["reasoning"])[0]?.id, "ai_sdk");
  assert.equal(modelProviderAdaptersFor("openai_chat_completions", ["vision"])[0]?.id, "ai_sdk");
  assert.equal(modelProviderAdaptersFor("anthropic_messages", ["vision"])[0]?.id, "ai_sdk");
  assert.equal(modelProviderAdaptersFor("openai_chat_completions", ["tools", "vision", "reasoning"])[0]?.id, "ai_sdk");
  assert.equal(modelProviderAdaptersFor("cohere_chat", ["vision"])[0]?.id, "ai_sdk");
  assert.doesNotThrow(() => createPreferredOfficialModelClient({
    providerId: "custom_openai",
    protocol: "openai_chat_completions",
    reasoningControls: declaredEffort("openai_chat_completions"),
    baseUrl: "https://api.example.test/v1",
    apiKey: "secret",
    model: "model",
    requiredCapabilities: ["files"],
  }));
  assert.doesNotThrow(() => createPreferredOfficialModelClient({
    providerId: "cohere",
    protocol: "cohere_chat",
    baseUrl: "https://api.cohere.test/v2",
    apiKey: "secret",
    model: "model",
    requiredCapabilities: ["files"],
  }));
});

test("request attachments and tools map to the transport capability gate", () => {
  assert.deepEqual(requiredTransportCapabilitiesForRequest({
    messages: [{
      role: "user",
      content: "inspect both attachments",
      attachments: [
        { kind: "image", name: "shot.png", mimeType: "image/png", dataBase64: "aGVsbG8=" },
        { kind: "file", name: "brief.pdf", mimeType: "application/pdf", dataBase64: "aGVsbG8=" },
      ],
    }],
    tools: [{
      name: "read_file",
      description: "Read a file",
      inputSchema: { type: "object", properties: {} },
      requiredPermission: "read_only",
      source: "builtin",
    }],
    reasoningEffort: "high",
  }), ["tools", "vision", "files", "reasoning"]);
});

test("a proven OpenAI-compatible reasoning request dispatches with reasoning_effort", async () => {
  let captured: any;
  const client = createPreferredOfficialModelClient({
    providerId: "custom_openai",
    protocol: "openai_chat_completions",
    reasoningControls: declaredEffort("openai_chat_completions"),
    baseUrl: "https://api.example.test/v1",
    apiKey: "secret",
    model: "reasoning-model",
    fetchImpl: async (_input, init) => {
      captured = JSON.parse(String(init?.body));
      return eventStreamResponse([
        { id: "chatcmpl-reasoning", model: "reasoning-model", choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }] },
        { id: "chatcmpl-reasoning", model: "reasoning-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } },
      ]);
    },
  });

  const result = await client.complete({
    messages: [{ role: "user", content: "reason carefully" }],
    tools: [],
    reasoningEffort: "high",
  });
  assert.equal(client.adapterId, "ai_sdk");
  assert.equal(captured.reasoning_effort, "high");
  assert.equal(result.content, "ok");
});

test("a relay entered as a bare host gets its format's version path; any given path and local servers are kept", async () => {
  const { versionedBaseUrl } = await import("../lib/index.js");
  assert.equal(versionedBaseUrl("https://la-api.example.top", "anthropic_messages", "custom_openai"), "https://la-api.example.top/v1");
  assert.equal(versionedBaseUrl("https://api.example.fan/", "openai_chat_completions", "custom_openai"), "https://api.example.fan/v1");
  assert.equal(versionedBaseUrl("https://api.example.fan", "gemini_generate_content", "custom_openai"), "https://api.example.fan/v1beta");
  assert.equal(versionedBaseUrl("https://api.example.ge/v1", "openai_chat_completions", "custom_openai"), "https://api.example.ge/v1");
  assert.equal(versionedBaseUrl("https://relay.example/api/openai", "openai_chat_completions", "custom_openai"), "https://relay.example/api/openai");
  assert.equal(versionedBaseUrl("http://127.0.0.1:1234", "openai_chat_completions", "custom_openai"), "http://127.0.0.1:1234");
  assert.equal(versionedBaseUrl("http://studio.local:8080", "openai_chat_completions", "custom_openai"), "http://studio.local:8080");
  assert.equal(versionedBaseUrl("https://api.anthropic.com", "anthropic_messages", "anthropic"), "https://api.anthropic.com", "first-party presets keep their URL");
});
