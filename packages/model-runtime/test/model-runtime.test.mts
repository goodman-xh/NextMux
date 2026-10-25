import { declaredEffort } from "./fixtures/reasoning-declarations.mts";
import assert from "node:assert/strict";
import test from "node:test";

import type { AgentModelMessage, AgentToolDescriptor } from "@nextmux/agent-runtime";

import {
  createAiSdkModelClient,
  createOfficialModelClient,
  createPreferredOfficialModelClient,
  createToolNameCodec,
  endpointUrl,
  openAICompatibleEndpointUrl,
  OFFICIAL_PROVIDER_PRESETS,
  OfficialModelError
} from "../lib/index.js";

const tool: AgentToolDescriptor = {
  name: "workspace.read_file",
  description: "Read one workspace file",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { path: { type: "string" } },
    required: ["path"]
  },
  requiredPermission: "read_only",
  source: "builtin"
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function eventStreamResponse(chunks: readonly unknown[]): Response {
  return new Response(
    `${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } }
  );
}

function namedEventStreamResponse(events: readonly { readonly event: string; readonly data: unknown }[]): Response {
  return new Response(
    events.map(item => `event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } }
  );
}

test("AI SDK compatible adapter streams text and returns provider tool calls without executing them", async () => {
  let capturedUrl = "";
  let captured: any;
  const deltas: string[] = [];
  const client = createAiSdkModelClient({
    protocol: "openai_chat_completions",
    reasoningControls: declaredEffort("openai_chat_completions"),
    baseUrl: "https://api.example.test/v1",
    apiKey: "secret-openai",
    model: "coding-model",
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      captured = JSON.parse(String(init?.body));
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret-openai");
      const encodedToolName = captured.tools[0].function.name;
      return eventStreamResponse([
        { id: "chatcmpl-1", model: "coding-model-2026", choices: [{ index: 0, delta: { role: "assistant", content: "I will " }, finish_reason: null }] },
        { id: "chatcmpl-1", model: "coding-model-2026", choices: [{ index: 0, delta: { content: "inspect it." }, finish_reason: null }] },
        { id: "chatcmpl-1", model: "coding-model-2026", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call-1", function: { name: encodedToolName, arguments: '{"path":"README.md"}' } }] }, finish_reason: null }] },
        { id: "chatcmpl-1", model: "coding-model-2026", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 17, completion_tokens: 8, total_tokens: 25 } }
      ]);
    }
  });
  const result = await client.complete({
    instructions: "State the immediate action.",
    messages: [{ role: "user", content: "Read README" }],
    tools: [tool],
    reasoningEffort: "high",
    onTextDelta: delta => { deltas.push(delta); }
  });
  assert.equal(capturedUrl, "https://api.example.test/v1/chat/completions");
  assert.equal(captured.stream, true);
  assert.equal(captured.stream_options.include_usage, true);
  assert.equal(captured.reasoning_effort, "high");
  assert.deepEqual(deltas, ["I will ", "inspect it."]);
  assert.equal(result.content, "I will inspect it.");
  assert.deepEqual(result.toolCalls, [{ id: "call-1", name: tool.name, arguments: { path: "README.md" } }]);
  assert.deepEqual(result.usage, { inputTokens: 17, outputTokens: 8 });
});

test("AI SDK compatible adapter preserves images and text after a tool-result turn", async () => {
  let captured: any;
  const client = createAiSdkModelClient({
    protocol: "openai_chat_completions",
    reasoningControls: declaredEffort("openai_chat_completions"),
    baseUrl: "https://api.example.test/v1",
    apiKey: "secret-openai",
    model: "vision-model",
    fetchImpl: async (_input, init) => {
      captured = JSON.parse(String(init?.body));
      return eventStreamResponse([
        { id: "chatcmpl-2", model: "vision-model", choices: [{ index: 0, delta: { role: "assistant", content: "The image is readable after the tool result." }, finish_reason: null }] },
        { id: "chatcmpl-2", model: "vision-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 29, completion_tokens: 7, total_tokens: 36 } }
      ]);
    }
  });
  const result = await client.complete({
    messages: [
      {
        role: "user",
        content: "Inspect this image",
        attachments: [
          { kind: "image", name: "sample.png", mimeType: "image/png", dataBase64: "aGVsbG8=" },
          { kind: "file", name: "brief.pdf", mimeType: "application/pdf", dataBase64: "cGRm" },
        ]
      },
      { role: "assistant", content: "", toolCalls: [{ id: "call-previous", name: tool.name, arguments: { path: "README.md" } }] },
      { role: "tool", toolCallId: "call-previous", content: "README contents" }
    ],
    tools: [tool]
  });
  const imagePart = captured.messages[0].content.find((part: any) => part.type === "image_url");
  assert.equal(imagePart.image_url.url, "data:image/png;base64,aGVsbG8=");
  const filePart = captured.messages[0].content.find((part: any) => part.type === "file");
  assert.equal(filePart.file.filename, "brief.pdf");
  assert.equal(filePart.file.file_data, "data:application/pdf;base64,cGRm");
  assert.equal(captured.messages[1].tool_calls[0].id, "call-previous");
  assert.equal(captured.messages[2].tool_call_id, "call-previous");
  assert.equal(result.content, "The image is readable after the tool result.");
});

test("AI SDK compatible adapter cancels an in-flight stream without retrying", async () => {
  let requests = 0;
  const controller = new AbortController();
  const client = createAiSdkModelClient({
    protocol: "openai_chat_completions",
    reasoningControls: declaredEffort("openai_chat_completions"),
    baseUrl: "https://api.example.test/v1",
    apiKey: "secret-openai",
    model: "coding-model",
    fetchImpl: async (_input, init) => {
      requests += 1;
      return await new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    }
  });
  const pending = client.complete({
    messages: [{ role: "user", content: "wait" }],
    tools: [],
    signal: controller.signal
  });
  controller.abort();
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof OfficialModelError && error.code === "CANCELLED"
  );
  assert.equal(requests, 1);
});

test("AI SDK Anthropic adapter uses the native stream and reports usage", async () => {
  let capturedUrl = "";
  let captured: any;
  const deltas: string[] = [];
  const client = createAiSdkModelClient({
    protocol: "anthropic_messages",
    reasoningControls: declaredEffort("anthropic_messages"),
    baseUrl: "https://api.anthropic.test/v1",
    apiKey: "secret-anthropic",
    model: "claude-test",
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      captured = JSON.parse(String(init?.body));
      assert.equal(new Headers(init?.headers).get("x-api-key"), "secret-anthropic");
      return namedEventStreamResponse([
        { event: "message_start", data: { type: "message_start", message: { id: "msg-1", type: "message", role: "assistant", content: [], model: "claude-test-2026", stop_reason: null, stop_sequence: null, usage: { input_tokens: 23, output_tokens: 1 } } } },
        { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
        { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Native Claude stream" } } },
        { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
        { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 6 } } },
        { event: "message_stop", data: { type: "message_stop" } }
      ]);
    }
  });
  const result = await client.complete({
    instructions: "Be concise.",
    messages: [{
      role: "user",
      content: "hello",
      attachments: [
        { kind: "image", name: "sample.png", mimeType: "image/png", dataBase64: "aGVsbG8=" },
        { kind: "file", name: "brief.pdf", mimeType: "application/pdf", dataBase64: "cGRm" },
      ],
    }],
    tools: [],
    reasoningEffort: "high",
    onTextDelta: delta => { deltas.push(delta); }
  });
  assert.equal(capturedUrl, "https://api.anthropic.test/v1/messages");
  assert.equal(captured.stream, true);
  assert.deepEqual(captured.system, [{ type: "text", text: "Be concise.", cache_control: { type: "ephemeral", ttl: "5m" } }]);
  assert.equal(captured.output_config.effort, "high");
  assert.equal(captured.messages[0].content[1].type, "image");
  assert.equal(captured.messages[0].content[1].source.media_type, "image/png");
  assert.equal(captured.messages[0].content[1].source.data, "aGVsbG8=");
  assert.equal(captured.messages[0].content[2].type, "document");
  assert.equal(captured.messages[0].content[2].source.media_type, "application/pdf");
  assert.equal(captured.messages[0].content[2].source.data, "cGRm");
  assert.deepEqual(deltas, ["Native Claude stream"]);
  assert.equal(result.content, "Native Claude stream");
  assert.deepEqual(result.usage, { inputTokens: 23, outputTokens: 6 });
});

test("AI SDK Google adapter uses streamGenerateContent and preserves image input", async () => {
  let capturedUrl = "";
  let captured: any;
  const client = createAiSdkModelClient({
    protocol: "gemini_generate_content",
    reasoningControls: declaredEffort("gemini_generate_content"),
    baseUrl: "https://generativelanguage.example.test/v1beta",
    apiKey: "secret-google",
    model: "gemini-test",
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      captured = JSON.parse(String(init?.body));
      assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "secret-google");
      return eventStreamResponse([{ candidates: [{ content: { role: "model", parts: [{ text: "Native Gemini stream" }] }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 31, candidatesTokenCount: 5, totalTokenCount: 36 } }]);
    }
  });
  const result = await client.complete({
    messages: [{
      role: "user",
      content: "inspect",
      attachments: [
        { kind: "image", name: "sample.png", mimeType: "image/png", dataBase64: "aGVsbG8=" },
        { kind: "file", name: "brief.pdf", mimeType: "application/pdf", dataBase64: "cGRm" },
      ]
    }],
    tools: [],
    reasoningEffort: "high"
  });
  assert.equal(capturedUrl, "https://generativelanguage.example.test/v1beta/models/gemini-test:streamGenerateContent?alt=sse");
  assert.equal(captured.contents[0].parts[1].inlineData.mimeType, "image/png");
  assert.equal(captured.contents[0].parts[1].inlineData.data, "aGVsbG8=");
  assert.equal(captured.contents[0].parts[2].inlineData.mimeType, "application/pdf");
  assert.equal(captured.contents[0].parts[2].inlineData.data, "cGRm");
  assert.equal(captured.generationConfig.thinkingConfig.thinkingLevel, "high");
  assert.equal(result.content, "Native Gemini stream");
  assert.deepEqual(result.usage, { inputTokens: 31, outputTokens: 5 });
});

test("AI SDK Google adapter preserves thought signatures through a tool round trip", async () => {
  const bodies: any[] = [];
  const client = createAiSdkModelClient({
    protocol: "gemini_generate_content",
    reasoningControls: declaredEffort("gemini_generate_content"),
    baseUrl: "https://generativelanguage.example.test/v1beta",
    apiKey: "secret-google",
    model: "gemini-test",
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (bodies.length === 1) {
        const toolName = body.tools[0].functionDeclarations[0].name;
        return eventStreamResponse([{
          candidates: [{ content: { role: "model", parts: [{ functionCall: { id: "gem-call-ai-sdk", name: toolName, args: { path: "README.md" } }, thoughtSignature: "opaque-ai-sdk-signature" }] }, finishReason: "STOP", index: 0 }],
          usageMetadata: { promptTokenCount: 13, candidatesTokenCount: 2, totalTokenCount: 15 }
        }]);
      }
      return eventStreamResponse([{
        candidates: [{ content: { role: "model", parts: [{ text: "Done" }] }, finishReason: "STOP", index: 0 }],
        usageMetadata: { promptTokenCount: 19, candidatesTokenCount: 1, totalTokenCount: 20 }
      }]);
    }
  });
  const first = await client.complete({
    messages: [{ role: "user", content: "Read README" }],
    tools: [tool]
  });
  assert.equal(first.toolCalls?.[0]?.id, "gem-call-ai-sdk");
  assert.ok(first.providerState);
  const second = await client.complete({
    messages: [
      { role: "user", content: "Read README" },
      { role: "assistant", content: "", toolCalls: first.toolCalls, providerState: first.providerState },
      { role: "tool", toolCallId: "gem-call-ai-sdk", content: "README contents" }
    ],
    tools: [tool]
  });
  assert.equal(bodies[1].contents[1].parts[0].thoughtSignature, "opaque-ai-sdk-signature");
  assert.equal(second.content, "Done");
});

test("provider registry covers major official and compatible protocols", () => {
  assert.deepEqual(
    OFFICIAL_PROVIDER_PRESETS.map(provider => provider.id),
    ["openai", "anthropic", "gemini", "azure_openai", "vertex", "bedrock", "xai", "mistral", "cohere", "openrouter", "deepseek", "qwen", "zhipu", "moonshot", "minimax", "minimax_media", "elevenlabs", "elevenlabs_sound", "doubao", "ernie", "hunyuan", "ollama", "custom_openai", "custom_media"]
  );
  assert.equal(OFFICIAL_PROVIDER_PRESETS.find(provider => provider.id === "qwen")?.baseUrls.length, 2);
  assert.deepEqual(OFFICIAL_PROVIDER_PRESETS.find(provider => provider.id === "zhipu")?.baseUrls.map(option => option.url), [
    "https://open.bigmodel.cn/api/paas/v4", "https://api.z.ai/api/paas/v4",
    "https://open.bigmodel.cn/api/coding/paas/v4", "https://api.z.ai/api/coding/paas/v4",
  ]);
  assert.equal(OFFICIAL_PROVIDER_PRESETS.find(provider => provider.id === "gemini")?.protocol, "gemini_generate_content");
  assert.equal(OFFICIAL_PROVIDER_PRESETS.find(provider => provider.id === "cohere")?.protocol, "cohere_chat");
  assert.equal(OFFICIAL_PROVIDER_PRESETS.find(provider => provider.id === "openrouter")?.defaultModel, "z-ai/glm-5.3-flash");
});

test("preferred transport selection is capability driven and deterministic", () => {
  const compatible = createPreferredOfficialModelClient({
    protocol: "openai_chat_completions",
    reasoningControls: declaredEffort("openai_chat_completions"),
    baseUrl: "https://api.example.test/v1",
    apiKey: "secret-openai",
    model: "coding-model"
  });
  const cohere = createPreferredOfficialModelClient({
    protocol: "cohere_chat",
    baseUrl: "https://api.cohere.test/v2",
    apiKey: "secret-cohere",
    model: "command-test"
  });
  assert.equal(compatible.adapterId, "ai_sdk");
  assert.equal(cohere.adapterId, "ai_sdk");
});

test("Cohere cancellation aborts the provider request without replaying it", async () => {
  let requests = 0;
  const events: string[] = [];
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const controller = new AbortController();
  const client = createPreferredOfficialModelClient({
    providerId: "cohere",
    protocol: "cohere_chat",
    baseUrl: "https://api.cohere.test/v2",
    apiKey: "secret-cohere",
    model: "command-test",
    fetchImpl: async (_input, init) => {
      requests += 1;
      markStarted();
      return await new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    }
  });
  const pending = client.complete({
    messages: [{ role: "user", content: "wait" }],
    tools: [],
    signal: controller.signal,
    onModelEvent: event => { events.push(event.type); },
  });
  await started;
  controller.abort();
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof OfficialModelError && error.code === "CANCELLED",
  );
  assert.equal(requests, 1);
  // The user's own cancellation is not a provider failure: no "failed" phase follows the start.
  assert.deepEqual(events, ["response.started"]);
});

test("Cohere provider failures are classified once and never retried by the transport", async () => {
  let requests = 0;
  const events: string[] = [];
  const client = createPreferredOfficialModelClient({
    providerId: "cohere",
    protocol: "cohere_chat",
    baseUrl: "https://api.cohere.test/v2",
    apiKey: "secret-cohere",
    model: "command-test",
    fetchImpl: async () => {
      requests += 1;
      return jsonResponse({ message: "rate limited" }, 429);
    }
  });
  await assert.rejects(
    client.complete({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      onModelEvent: event => { events.push(event.type); },
    }),
    (error: unknown) => error instanceof OfficialModelError && error.code === "RATE_LIMITED",
  );
  assert.equal(requests, 1);
  assert.deepEqual(events, ["response.started", "response.failed"]);
});

test("official OpenAI uses its maintained provider while compatible routes stay generic", async () => {
  const userAgents: string[] = [];
  const createFetch = () => async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    userAgents.push(new Headers(init?.headers).get("user-agent") ?? "");
    return eventStreamResponse([
      {
        id: "chatcmpl-provider-selection",
        object: "chat.completion.chunk",
        created: 1,
        model: "coding-model",
        choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }]
      },
      {
        id: "chatcmpl-provider-selection",
        object: "chat.completion.chunk",
        created: 1,
        model: "coding-model",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      }
    ]);
  };
  const official = createPreferredOfficialModelClient({
    providerId: "openai",
    protocol: "openai_chat_completions",
    reasoningControls: declaredEffort("openai_chat_completions"),
    baseUrl: "https://api.openai.test/v1",
    apiKey: "secret-openai",
    model: "coding-model",
    fetchImpl: createFetch()
  });
  const compatible = createPreferredOfficialModelClient({
    providerId: "custom_openai",
    protocol: "openai_chat_completions",
    reasoningControls: declaredEffort("openai_chat_completions"),
    baseUrl: "https://compatible.example.test/v1",
    apiKey: "secret-compatible",
    model: "coding-model",
    fetchImpl: createFetch()
  });
  await official.complete({ messages: [{ role: "user", content: "hello" }], tools: [] });
  await compatible.complete({ messages: [{ role: "user", content: "hello" }], tools: [] });
  assert.match(userAgents[0], /ai-sdk\/openai\/4\./);
  assert.match(userAgents[1], /ai-sdk\/openai-compatible\/3\./);
});

test("preview xAI transport uses its maintained provider only after explicit opt-in", async () => {
  let userAgent = "";
  const client = createPreferredOfficialModelClient({
    providerId: "xai",
    protocol: "openai_chat_completions",
    reasoningControls: declaredEffort("openai_chat_completions"),
    baseUrl: "https://api.x.ai/v1",
    apiKey: "secret-xai",
    model: "grok-test",
    enablePreviewProviderAdapter: true,
    fetchImpl: async (_input, init) => {
      userAgent = new Headers(init?.headers).get("user-agent") ?? "";
      return eventStreamResponse([
        { id: "chatcmpl-xai", object: "chat.completion.chunk", created: 1, model: "grok-test", choices: [{ index: 0, delta: { role: "assistant", content: "Grok stream" }, finish_reason: null }] },
        { id: "chatcmpl-xai", object: "chat.completion.chunk", created: 1, model: "grok-test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }
      ]);
    }
  });
  const result = await client.complete({ messages: [{ role: "user", content: "hello" }], tools: [] });
  assert.match(userAgent, /ai-sdk\/xai\/4\./);
  assert.equal(result.content, "Grok stream");
  assert.deepEqual(result.usage, { inputTokens: 4, outputTokens: 2 });
});

test("preview Mistral transport uses its maintained provider only after explicit opt-in", async () => {
  let userAgent = "";
  const client = createPreferredOfficialModelClient({
    providerId: "mistral",
    protocol: "openai_chat_completions",
    reasoningControls: declaredEffort("openai_chat_completions"),
    baseUrl: "https://api.mistral.ai/v1",
    apiKey: "secret-mistral",
    model: "mistral-test",
    enablePreviewProviderAdapter: true,
    fetchImpl: async (_input, init) => {
      userAgent = new Headers(init?.headers).get("user-agent") ?? "";
      return eventStreamResponse([
        { id: "mistral-stream", model: "mistral-test", choices: [{ index: 0, delta: { content: "Mistral stream" }, finish_reason: null }] },
        { id: "mistral-stream", model: "mistral-test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }
      ]);
    }
  });
  const result = await client.complete({ messages: [{ role: "user", content: "hello" }], tools: [] });
  assert.match(userAgent, /ai-sdk\/mistral\/4\./);
  assert.equal(result.content, "Mistral stream");
  assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 3 });
});

test("preview DeepSeek transport uses its maintained provider and preserves streamed reasoning", async () => {
  let userAgent = "";
  const reasoningDeltas: string[] = [];
  const client = createPreferredOfficialModelClient({
    providerId: "deepseek",
    protocol: "openai_chat_completions",
    reasoningControls: declaredEffort("openai_chat_completions"),
    baseUrl: "https://api.deepseek.com",
    apiKey: "secret-deepseek",
    model: "deepseek-reasoner",
    enablePreviewProviderAdapter: true,
    fetchImpl: async (_input, init) => {
      userAgent = new Headers(init?.headers).get("user-agent") ?? "";
      return eventStreamResponse([
        { id: "deepseek-stream", object: "chat.completion.chunk", created: 1, model: "deepseek-reasoner", choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "Check carefully. " }, finish_reason: null }] },
        { id: "deepseek-stream", object: "chat.completion.chunk", created: 1, model: "deepseek-reasoner", choices: [{ index: 0, delta: { content: "DeepSeek stream" }, finish_reason: null }] },
        { id: "deepseek-stream", object: "chat.completion.chunk", created: 1, model: "deepseek-reasoner", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 6, completion_tokens: 4, total_tokens: 10 } }
      ]);
    }
  });
  const result = await client.complete({
    messages: [{ role: "user", content: "hello" }],
    tools: [],
    onModelEvent: event => {
      if (event.type === "reasoning.delta") reasoningDeltas.push(event.delta);
    }
  });
  assert.match(userAgent, /ai-sdk\/deepseek\/3\./);
  assert.equal(result.content, "DeepSeek stream");
  assert.deepEqual(reasoningDeltas, ["Check carefully. "]);
  assert.deepEqual(result.usage, { inputTokens: 6, outputTokens: 4 });
});

test("preview Qwen transport uses the maintained Alibaba provider only after explicit opt-in", async () => {
  let userAgent = "";
  const client = createPreferredOfficialModelClient({
    providerId: "qwen",
    protocol: "openai_chat_completions",
    reasoningControls: declaredEffort("openai_chat_completions"),
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    apiKey: "secret-qwen",
    model: "qwen-test",
    enablePreviewProviderAdapter: true,
    fetchImpl: async (_input, init) => {
      userAgent = new Headers(init?.headers).get("user-agent") ?? "";
      return eventStreamResponse([
        { id: "qwen-stream", object: "chat.completion.chunk", created: 1, model: "qwen-test", choices: [{ index: 0, delta: { role: "assistant", content: "Qwen stream" }, finish_reason: null }] },
        { id: "qwen-stream", object: "chat.completion.chunk", created: 1, model: "qwen-test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } }
      ]);
    }
  });
  const result = await client.complete({ messages: [{ role: "user", content: "hello" }], tools: [] });
  assert.match(userAgent, /ai-sdk\/alibaba\/2\./);
  assert.equal(result.content, "Qwen stream");
  assert.deepEqual(result.usage, { inputTokens: 7, outputTokens: 3 });
});

test("preferred Cohere V2 adapter streams the full tool-result round trip and lifecycle", async () => {
  const capturedUrls: string[] = [];
  const bodies: any[] = [];
  const firstEvents: string[] = [];
  const deltas: string[] = [];
  const client = createPreferredOfficialModelClient({
    providerId: "cohere",
    protocol: "cohere_chat",
    baseUrl: "https://api.cohere.test/v2",
    apiKey: "secret-cohere",
    model: "command-test",
    fetchImpl: async (input, init) => {
      capturedUrls.push(String(input));
      const captured = JSON.parse(String(init?.body));
      bodies.push(captured);
      const encodedToolName = captured.tools?.[0]?.function?.name;
      return namedEventStreamResponse(bodies.length > 1 ? [
        { event: "message-start", data: { type: "message-start", id: "generation-2" } },
        { event: "content-start", data: { type: "content-start", index: 0, delta: { message: { content: { type: "text", text: "" } } } } },
        { event: "content-delta", data: { type: "content-delta", index: 0, delta: { message: { content: { text: "Done" } } } } },
        { event: "content-end", data: { type: "content-end", index: 0 } },
        { event: "message-end", data: { type: "message-end", delta: { finish_reason: "COMPLETE", usage: { tokens: { input_tokens: 34, output_tokens: 2 } } } } },
      ] : [
        { event: "message-start", data: { type: "message-start", id: "generation-1" } },
        { event: "content-start", data: { type: "content-start", index: 0, delta: { message: { content: { type: "text", text: "" } } } } },
        { event: "content-delta", data: { type: "content-delta", index: 0, delta: { message: { content: { text: "Checking" } } } } },
        { event: "content-end", data: { type: "content-end", index: 0 } },
        { event: "tool-call-start", data: {
          type: "tool-call-start",
          delta: { message: { tool_calls: {
            id: "cohere-call-1",
            type: "function",
            function: { name: encodedToolName, arguments: '{"path":"' },
          } } },
        } },
        { event: "tool-call-delta", data: {
          type: "tool-call-delta",
          delta: {
            message: {
              tool_calls: {
                function: { arguments: 'README.md"}' },
              },
            },
          },
        } },
        { event: "tool-call-end", data: { type: "tool-call-end" } },
        { event: "message-end", data: { type: "message-end", delta: { finish_reason: "TOOL_CALL", usage: { tokens: { input_tokens: 21, output_tokens: 8 } } } } },
      ]);
    }
  });
  assert.equal(client.adapterId, "ai_sdk");
  const first = await client.complete({
    instructions: "Report concrete progress before each tool call.",
    messages: [{ role: "user", content: "Read README" }],
    tools: [tool],
    onTextDelta: delta => { deltas.push(delta); },
    onModelEvent: event => { firstEvents.push(event.type); }
  });
  const secondEvents: string[] = [];
  const second = await client.complete({
    messages: [
      { role: "user", content: "Read README" },
      { role: "assistant", content: first.content || "", toolCalls: first.toolCalls },
      { role: "tool", toolCallId: "cohere-call-1", content: "# NextMux" }
    ],
    tools: [tool],
    onTextDelta: delta => { deltas.push(delta); },
    onModelEvent: event => { secondEvents.push(event.type); }
  });
  assert.deepEqual(capturedUrls, ["https://api.cohere.test/v2/chat", "https://api.cohere.test/v2/chat"]);
  assert.deepEqual(bodies[0].messages[0], { role: "system", content: "Report concrete progress before each tool call." });
  assert.match(bodies[0].tools[0].function.name, /^[A-Za-z0-9_-]{1,64}$/);
  assert.notEqual(bodies[0].tools[0].function.name, tool.name);
  assert.equal(first.toolCalls?.[0]?.id, "cohere-call-1");
  assert.equal(first.toolCalls?.[0]?.name, tool.name);
  assert.deepEqual(first.usage, { inputTokens: 21, outputTokens: 8 });
  assert.equal(bodies[1].messages[1].role, "assistant");
  assert.equal(bodies[1].messages[1].tool_calls[0].id, "cohere-call-1");
  assert.equal(bodies[1].messages[2].role, "tool");
  assert.equal(bodies[1].messages[2].tool_call_id, "cohere-call-1");
  assert.equal(bodies[1].messages[2].content, "# NextMux");
  assert.equal(second.content, "Done");
  assert.deepEqual(deltas, ["Checking", "Done"]);
  assert.deepEqual(firstEvents, [
    "response.started",
    "content.started",
    "content.delta",
    "content.completed",
    "tool_call.started",
    "tool_call.arguments_delta",
    "tool_call.arguments_delta",
    "tool_call.completed",
    "usage",
    "response.completed"
  ]);
  assert.deepEqual(secondEvents, [
    "response.started",
    "content.started",
    "content.delta",
    "content.completed",
    "usage",
    "response.completed"
  ]);
});

test("OpenAI-compatible adapter maps tool definitions and structured tool calls", async () => {
  let capturedUrl = "";
  let captured: any;
  const client = createOfficialModelClient({
    protocol: "openai_chat_completions",
    reasoningControls: declaredEffort("openai_chat_completions"),
    baseUrl: "https://api.example.test/v1",
    apiKey: "secret-openai",
    model: "coding-model",
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      captured = JSON.parse(String(init?.body));
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret-openai");
      return jsonResponse({
        model: "coding-model-2026",
        choices: [{ message: {
          content: null,
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: { name: captured.tools[0].function.name, arguments: "{\"path\":\"README.md\"}" }
          }]
        } }],
        usage: { prompt_tokens: 19, completion_tokens: 7 }
      });
    }
  });
  const result = await client.complete({
    instructions: "Explain the next concrete action.",
    messages: [{ role: "user", content: "Read the readme" }],
    tools: [tool],
    reasoningEffort: "xhigh"
  });
  assert.equal(capturedUrl, "https://api.example.test/v1/chat/completions");
  assert.deepEqual(captured.messages[0], { role: "system", content: "Explain the next concrete action." });
  assert.deepEqual(captured.messages[1], { role: "user", content: "Read the readme" });
  assert.match(captured.tools[0].function.name, /^[A-Za-z0-9_-]{1,64}$/);
  assert.notEqual(captured.tools[0].function.name, tool.name);
  assert.equal(captured.reasoning_effort, "xhigh");
  assert.deepEqual(result.toolCalls, [{ id: "call-1", name: tool.name, arguments: { path: "README.md" } }]);
  assert.deepEqual(result.usage, { inputTokens: 19, outputTokens: 7 });
});

test("Anthropic adapter groups tool results and parses native content blocks", async () => {
  let captured: any;
  const messages: AgentModelMessage[] = [
    { role: "user", content: "Read two files" },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "toolu-1", name: tool.name, arguments: { path: "a.txt" } },
        { id: "toolu-2", name: tool.name, arguments: { path: "b.txt" } }
      ]
    },
    { role: "tool", toolCallId: "toolu-1", content: "A" },
    { role: "tool", toolCallId: "toolu-2", content: "B" }
  ];
  const client = createOfficialModelClient({
    protocol: "anthropic_messages",
    reasoningControls: declaredEffort("anthropic_messages"),
    baseUrl: "https://api.anthropic.test/v1",
    apiKey: "secret-anthropic",
    model: "claude-test",
    fetchImpl: async (_input, init) => {
      captured = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-api-key"), "secret-anthropic");
      assert.equal(headers.get("anthropic-version"), "2023-06-01");
      return jsonResponse({
        model: "claude-test",
        content: [
          { type: "text", text: "I will update it." },
          { type: "tool_use", id: "toolu-3", name: captured.tools[0].name, input: { path: "a.txt", content: "AA" } }
        ],
        usage: { input_tokens: 33, output_tokens: 9 }
      });
    }
  });
  const result = await client.complete({
    instructions: "Describe progress in the user's language.",
    messages,
    tools: [tool],
    reasoningEffort: "high"
  });
  assert.equal(captured.system, "Describe progress in the user's language.");
  assert.equal(captured.messages.at(-1).role, "user");
  assert.equal(captured.messages.at(-1).content.length, 2);
  assert.equal(captured.tools[0].input_schema.type, "object");
  assert.match(captured.tools[0].name, /^[A-Za-z0-9_-]{1,64}$/);
  assert.equal(captured.output_config.effort, "high");
  assert.equal(result.content, "I will update it.");
  assert.equal(result.toolCalls?.[0].id, "toolu-3");
});

test("Gemini adapter preserves thought signatures across the tool round trip", async () => {
  const bodies: any[] = [];
  let request = 0;
  const client = createOfficialModelClient({
    protocol: "gemini_generate_content",
    reasoningControls: declaredEffort("gemini_generate_content"),
    baseUrl: "https://generativelanguage.example.test/v1beta",
    apiKey: "secret-gemini",
    model: "gemini-test",
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://generativelanguage.example.test/v1beta/models/gemini-test:generateContent");
      assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "secret-gemini");
      bodies.push(JSON.parse(String(init?.body)));
      request += 1;
      if (request === 1) {
        return jsonResponse({
          candidates: [{ content: { role: "model", parts: [{
            functionCall: { id: "gem-call-1", name: JSON.parse(String(init?.body)).tools[0].functionDeclarations[0].name, args: { path: "README.md" } },
            thoughtSignature: "opaque-signature"
          }] } }],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 }
        });
      }
      return jsonResponse({
        candidates: [{ content: { role: "model", parts: [{ text: "Done" }] } }],
        usageMetadata: { promptTokenCount: 18, candidatesTokenCount: 2 }
      });
    }
  });
  const first = await client.complete({
    instructions: "State what file is being inspected.",
    messages: [{ role: "user", content: "Read README" }],
    tools: [tool],
    reasoningEffort: "medium"
  });
  assert.equal(first.toolCalls?.[0].id, "gem-call-1");
  assert.equal(bodies[0].systemInstruction.parts[0].text, "State what file is being inspected.");
  assert.equal(bodies[0].generationConfig.thinkingConfig.thinkingLevel, "medium");
  const second = await client.complete({
    messages: [
      { role: "user", content: "Read README" },
      {
        role: "assistant",
        content: "",
        toolCalls: first.toolCalls,
        providerState: first.providerState
      },
      { role: "tool", toolCallId: "gem-call-1", content: "{\"ok\":true}" }
    ],
    tools: [tool]
  });
  assert.equal(bodies[1].contents[1].parts[0].thoughtSignature, "opaque-signature");
  assert.equal(bodies[1].contents[2].parts[0].functionResponse.id, "gem-call-1");
  assert.equal(bodies[1].contents[2].parts[0].functionResponse.name, bodies[0].tools[0].functionDeclarations[0].name);
  assert.equal(second.content, "Done");
});

test("tool name aliases are provider-safe, deterministic, unique, and reversible", () => {
  const longTool: AgentToolDescriptor = { ...tool, name: `workspace.${"nested.".repeat(20)}write_file` };
  const alreadySafe: AgentToolDescriptor = { ...tool, name: "safe_tool-1" };
  const first = createToolNameCodec([tool, longTool, alreadySafe]);
  const second = createToolNameCodec([longTool, tool, alreadySafe]);
  const readAlias = first.encode(tool.name);
  const longAlias = first.encode(longTool.name);
  assert.match(readAlias, /^[A-Za-z0-9_-]{1,64}$/);
  assert.match(longAlias, /^[A-Za-z0-9_-]{1,64}$/);
  assert.notEqual(readAlias, longAlias);
  assert.equal(readAlias, second.encode(tool.name));
  assert.equal(first.decode(readAlias), tool.name);
  assert.equal(first.decode(longAlias), longTool.name);
  assert.equal(first.encode(alreadySafe.name), alreadySafe.name);
  assert.equal(first.decode("provider_unknown_tool"), "provider_unknown_tool");
});

test("endpoint policy rejects credentials, insecure URLs, and private hosts", () => {
  assert.throws(
    () => endpointUrl("https://user:pass@example.test/v1", "openai_chat_completions", "model", false),
    (error: unknown) => error instanceof OfficialModelError && error.code === "INVALID_BASE_URL"
  );
  assert.throws(
    () => endpointUrl("http://api.example.test/v1", "openai_chat_completions", "model", false),
    (error: unknown) => error instanceof OfficialModelError && error.code === "INSECURE_BASE_URL"
  );
  assert.throws(
    () => endpointUrl("https://127.0.0.1/v1", "openai_chat_completions", "model", false),
    (error: unknown) => error instanceof OfficialModelError && error.code === "PRIVATE_BASE_URL"
  );
});

test("media endpoints reuse the secure compatible-API base policy", () => {
  assert.equal(
    openAICompatibleEndpointUrl("https://api.example.test/v1", "images/generations", false).toString(),
    "https://api.example.test/v1/images/generations",
  );
  assert.equal(
    openAICompatibleEndpointUrl("https://api.example.test", "audio/speech", false).toString(),
    "https://api.example.test/audio/speech",
  );
  assert.throws(
    () => openAICompatibleEndpointUrl("http://127.0.0.1:4181/v1", "images/generations", false),
    (error: unknown) => error instanceof OfficialModelError && error.code === "INSECURE_BASE_URL",
  );
});

test("upstream authentication errors expose no response body or secret", async () => {
  const client = createOfficialModelClient({
    protocol: "openai_chat_completions",
    reasoningControls: declaredEffort("openai_chat_completions"),
    baseUrl: "https://api.example.test/v1",
    apiKey: "do-not-leak",
    model: "model",
    fetchImpl: async () => jsonResponse({ error: { message: "raw upstream body do-not-leak" } }, 401)
  });
  await assert.rejects(
    client.complete({ messages: [{ role: "user", content: "hello" }], tools: [] }),
    (error: unknown) => error instanceof OfficialModelError
      && error.code === "AUTH_FAILED"
      && !error.message.includes("do-not-leak")
      && !error.message.includes("raw upstream")
  );
});
