import assert from "node:assert/strict";
import test from "node:test";
import { AgentRunner, AgentToolRegistry, type AgentToolDescriptor } from "@nextmux/agent-runtime";
import { createOfficialModelClient, createPreferredOfficialModelClient, OfficialModelError } from "../lib/index.js";
import type { OfficialModelClientOptions, OfficialModelEvent } from "../lib/index.js";

const tool: AgentToolDescriptor = {
  name: "workspace.read_file", description: "Read a file", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  requiredPermission: "read_only", source: "builtin",
};
const request = { messages: [{ role: "user" as const, content: "Read README" }], tools: [] };
const done = { model: "qwen3", done: true, done_reason: "stop", prompt_eval_count: 25, eval_count: 8 };
const show = { capabilities: ["completion", "tools", "vision", "thinking"], model_info: { "general.architecture": "qwen3", "qwen3.context_length": 131_072 } };
function ndjson(chunks: unknown[]): Response {
  // Split inside UTF-8 code points and JSON records, as a real network stream may.
  const bytes = new TextEncoder().encode(chunks.map(chunk => JSON.stringify(chunk)).join("\n") + "\n");
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
    controller.close();
  } }), { headers: { "content-type": "application/x-ndjson" } });
}
function fixture(chat: (body: any, signal: AbortSignal | null | undefined) => Response | Promise<Response>, overrides: Partial<OfficialModelClientOptions> = {}, metadata = show) {
  const paths: string[] = [], bodies: any[] = [];
  const options: OfficialModelClientOptions = {
    providerId: "ollama", protocol: "openai_chat_completions", baseUrl: "http://127.0.0.1:11434/v1", apiKey: "", model: "qwen3", allowInsecure: true,
    fetchImpl: async (input, init) => {
      const path = new URL(String(input)).pathname; paths.push(path);
      if (path === "/api/version") return Response.json({ version: "0.18.2" });
      if (path === "/api/tags") return Response.json({ models: [{ name: "qwen3", digest: "sha256:qwen" }] });
      if (path === "/api/show") { assert.equal(JSON.parse(String(init?.body)).model, "qwen3"); return Response.json(metadata); }
      if (path === "/api/chat") { const body = JSON.parse(String(init?.body)); bodies.push(body); return chat(body, init?.signal); }
      throw new Error(`Unexpected route ${path}`);
    }, ...overrides,
  };
  return { client: createPreferredOfficialModelClient(options), options, paths, bodies };
}

test("native Ollama streams UTF-8 text, thinking and tools; replays tool results and images", async () => {
  const events: OfficialModelEvent[] = [], deltas: string[] = [];
  const f = fixture(body => ndjson(body.messages.some((message: any) => message.role === "tool") ? [
    { message: { role: "assistant", content: "完成" }, done: false }, done,
  ] : [
    { message: { role: "assistant", thinking: "Inspect the file." }, done: false },
    { message: { role: "assistant", content: "读取 " }, done: false },
    { message: { role: "assistant", content: "README。", tool_calls: [{ function: { name: body.tools[0].function.name, arguments: { path: "README.md" } } }] }, done: false },
    { ...done, prompt_eval_cached_count: 5 },
  ]));
  const first = await f.client.complete({
    instructions: "Inspect the selected file.",
    messages: [{ role: "user", content: "Read this", attachments: [{ kind: "image", name: "screen.png", mimeType: "image/png", dataBase64: "aGVsbG8=" }] }],
    tools: [tool], reasoningEffort: "high", maxOutputTokens: 2_048,
    onTextDelta: delta => { deltas.push(delta); }, onModelEvent: event => { events.push(event); },
  });
  assert.deepEqual(deltas, ["读取 ", "README。"]);
  assert.equal(first.content, "读取 README。");
  assert.deepEqual(first.usage, { inputTokens: 25, outputTokens: 8, cachedInputTokens: 5, cacheStatus: "hit" });
  assert.equal(first.toolCalls?.[0].name, tool.name);
  assert.deepEqual(first.toolCalls?.[0].arguments, { path: "README.md" });
  assert.deepEqual(f.bodies[0].messages[1].images, ["aGVsbG8="]);
  assert.deepEqual(f.bodies[0].options, { num_ctx: 16_384, num_predict: 2_048 });
  assert.equal(f.bodies[0].stream, true); assert.equal(f.bodies[0].think, true); assert.equal(f.bodies[0].keep_alive, "5m"); assert.equal(f.bodies[0].truncate, false);
  assert.deepEqual(events.map(event => event.type), ["response.started", "reasoning.started", "reasoning.delta", "reasoning.completed", "content.started", "content.delta", "content.delta", "tool_call.started", "tool_call.arguments_delta", "tool_call.completed", "content.completed", "usage", "response.completed"]);
  assert.equal(new Set(events.map(event => event.attemptId)).size, 1);
  const call = first.toolCalls![0];
  const second = await f.client.complete({ messages: [
    request.messages[0], { role: "assistant", content: first.content ?? "", toolCalls: first.toolCalls, providerState: first.providerState },
    { role: "tool", toolCallId: call.id, content: "README contents", attachments: [{ kind: "image", name: "tool.png", mimeType: "image/png", dataBase64: "dG9vbA==" }] },
  ], tools: [tool] });
  assert.equal(second.content, "完成");
  assert.equal(f.bodies[1].messages[1].thinking, "Inspect the file.");
  assert.deepEqual(f.bodies[1].messages[1].tool_calls, [{ function: { name: f.bodies[0].tools[0].function.name, arguments: { path: "README.md" } } }]);
  assert.equal(f.bodies[1].messages[2].tool_name, f.bodies[0].tools[0].function.name);
  assert.deepEqual(f.bodies[1].messages[3].images, ["dG9vbA=="]);
  assert.equal(f.paths.filter(path => path === "/api/show").length, 1);
});

test("Ollama native tool calls execute once through AgentRunner and replay the result", async () => {
  let executions = 0;
  const f = fixture(body => ndjson(body.messages.some((message: any) => message.role === "tool") ? [
    { message: { content: "README says NextMux." }, done: false }, done,
  ] : [{ message: { content: "I will read README.", tool_calls: [{ function: { name: body.tools[0].function.name, arguments: { path: "README.md" } } }] }, done: false }, done]));
  const registry = new AgentToolRegistry();
  registry.register(tool, async args => { executions++; assert.deepEqual(args, { path: "README.md" }); return { modelOutput: "NextMux", summary: { title: "Read README" } }; });
  const result = await new AgentRunner({
    model: { complete: async value => ({ ...await f.client.complete(value), outputParts: undefined }) },
    tools: registry, permissionMode: "read_only", maxTurns: 3,
  }).run({ prompt: "Read README", runId: "run-ollama-native-tools" });
  assert.equal(executions, 1); assert.equal(f.bodies.length, 2);
  assert.equal(result.status, "completed"); assert.deepEqual(result.usage, { inputTokens: 50, outputTokens: 16 });
  assert.ok(f.bodies[1].messages.some((message: any) => message.role === "tool" && message.tool_name && message.content.includes("NextMux")));
});

test("loopback custom connections are detected before the preferred SDK, remote custom servers are not probed", async () => {
  const f = fixture(() => ndjson([{ message: { content: "native" } }, done]), { providerId: "custom_openai" });
  assert.equal((await f.client.complete(request)).content, "native");
  assert.deepEqual(f.paths, ["/api/version", "/api/show", "/api/chat"]);
  const urls: string[] = [];
  const remote = createOfficialModelClient({ protocol: "openai_chat_completions", providerId: "custom_openai", baseUrl: "https://example.test/v1", apiKey: "fixture", model: "qwen3", fetchImpl: async input => {
    urls.push(String(input)); return Response.json({ choices: [{ message: { content: "compatible" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  } });
  await remote.complete(request); assert.deepEqual(urls, ["https://example.test/v1/chat/completions"]);
});

for (const unavailable of [new Response("404 page not found", { status: 404 }), Response.json({ detail: "Not Found" }, { status: 404 }), new Response("", { status: 405 })]) {
  test(`native route ${unavailable.status} falls back once to /v1 with a single lifecycle`, async () => {
    const paths: string[] = [], events: string[] = [];
    const options: OfficialModelClientOptions = {
      providerId: "ollama", protocol: "openai_chat_completions", baseUrl: "http://127.0.0.1:11434", apiKey: "", model: "qwen3", allowInsecure: true,
      fetchImpl: async (input, init) => {
        const path = new URL(String(input)).pathname; paths.push(path);
        if (path === "/api/show") return new Response("Not Found", { status: 404 });
        if (path === "/api/chat") return unavailable;
        assert.equal(path, "/v1/chat/completions");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.stream, true);
        return new Response(`data: ${JSON.stringify({ id: "fallback", choices: [{ index: 0, delta: { content: "fallback" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
      },
    };
    const client = createPreferredOfficialModelClient(options);
    assert.equal((await client.complete({ ...request, onModelEvent: event => { events.push(event.type); } })).content, "fallback");
    assert.equal((await client.complete(request)).content, "fallback");
    assert.deepEqual(paths, ["/api/show", "/api/chat", "/v1/chat/completions", "/v1/chat/completions"]);
    assert.equal(events.filter(type => type === "response.started").length, 1);
    assert.equal(events.filter(type => type === "response.completed").length, 1);
    assert.equal(events.filter(type => type === "response.failed").length, 0);
  });
}

test("a missing model or native generation error never retries using OpenAI", async () => {
  for (const response of [Response.json({ error: "model 'absent' not found" }, { status: 404 }), Response.json({ error: "runner failed" }, { status: 500 }), ndjson([{ error: "runner failed" }])]) {
    const events: string[] = [];
    const f = fixture(() => response);
    await assert.rejects(f.client.complete({ ...request, onModelEvent: event => { events.push(event.type); } }), OfficialModelError);
    assert.deepEqual(f.paths, ["/api/show", "/api/chat"]);
    assert.equal(events.filter(type => type === "response.failed").length, 1);
    assert.equal(events.filter(type => type === "response.completed").length, 0);
  }
});

test("detected Ollama at a custom root falls back to /v1; unrelated local APIs keep their path", async () => {
  for (const detected of [true, false]) {
    const paths: string[] = [];
    const client = createPreferredOfficialModelClient({
      providerId: "custom_openai", protocol: "openai_chat_completions", baseUrl: "http://127.0.0.1:11434", apiKey: "", model: "qwen3", allowInsecure: true,
      fetchImpl: async input => {
        const path = new URL(String(input)).pathname; paths.push(path);
        if (path === "/api/version") return detected ? Response.json({ version: "0.18.0" }) : new Response("Not Found", { status: 404 });
        if (path === "/api/show") return Response.json(show);
        if (path === "/api/chat") return new Response("404 page not found", { status: 404 });
        assert.equal(path, detected ? "/v1/chat/completions" : "/chat/completions");
        return new Response(`data: ${JSON.stringify({ id: "fallback", choices: [{ index: 0, delta: { content: "compatible" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
      }
    });
    assert.equal((await client.complete(request)).content, "compatible");
    assert.equal((await client.complete(request)).content, "compatible");
    assert.deepEqual(paths, detected ? ["/api/version", "/api/show", "/api/chat", "/v1/chat/completions", "/v1/chat/completions"]
      : ["/api/version", "/chat/completions", "/chat/completions"]);
  }
});

test("done_reason length returns partial content and observed usage for continuation", async () => {
  const events: OfficialModelEvent[] = [];
  const f = fixture(() => ndjson([{ message: { content: "partial" } }, { ...done, done_reason: "length" }]));
  const result = await f.client.complete({ ...request, onModelEvent: event => { events.push(event); } });
  assert.equal(result.content, "partial"); assert.equal(result.finishReason, "length");
  assert.deepEqual(result.usage, { inputTokens: 25, outputTokens: 8 });
  assert.equal(events.at(-1)?.type, "response.completed");
  assert.equal(events.filter(event => event.type === "response.failed").length, 0);
});

test("Ollama output truncation omits incomplete tool calls while preserving complete ones", async () => {
  const f = fixture(body => ndjson([{ message: { content: "partial", tool_calls: [
    { function: { name: body.tools[0].function.name, arguments: '{"path":' } },
    { function: { name: body.tools[0].function.name, arguments: { path: "README.md" } } },
  ] } }, { ...done, done_reason: "length" }]));
  const result = await f.client.complete({ ...request, tools: [tool] });
  assert.ok(result.toolCalls);
  assert.equal(result.finishReason, "length"); assert.equal(result.toolCalls.length, 1);
  assert.deepEqual(result.toolCalls[0].arguments, { path: "README.md" });
});

test("truncated or malformed NDJSON fails without accepting partial content", async () => {
  for (const response of [ndjson([{ message: { content: "partial" }, done: false }]), new Response('{"message":')]) {
    const f = fixture(() => response);
    await assert.rejects(f.client.complete(request), (error: unknown) => error instanceof OfficialModelError && error.code === "INVALID_RESPONSE" && error.usageKnown === false);
  }
});

test("user cancellation and timeout interrupt a stalled stream even if the mock ignores fetch signal", async () => {
  for (const cancel of [true, false]) {
    const controller = new AbortController();
    const events: string[] = [];
    let cancelled = false;
    const f = fixture(() => new Response(new ReadableStream({
      start(stream) { stream.enqueue(new TextEncoder().encode('{"message":{"content":"waiting"}}\n')); },
      cancel() { cancelled = true; },
    })), { timeoutMs: cancel ? 0 : 1_000 });
    const pending = f.client.complete({ ...request, signal: controller.signal,
      onTextDelta: () => { if (cancel) controller.abort(); }, onModelEvent: event => { events.push(event.type); } });
    await assert.rejects(pending, (error: unknown) => error instanceof OfficialModelError && error.code === (cancel ? "CANCELLED" : "TIMEOUT"));
    assert.equal(cancelled, true); assert.equal(events.at(-1), "response.failed"); assert.equal(f.bodies.length, 1);
  }
});

test("capability refusal prevents unsupported tool or image requests reaching chat", async () => {
  const f = fixture(() => { throw new Error("must not generate"); }, {}, { ...show, capabilities: ["completion"] });
  await assert.rejects(f.client.complete({ ...request, tools: [tool] }), (error: unknown) => error instanceof OfficialModelError && error.code === "UNSUPPORTED_CAPABILITY");
  assert.deepEqual(f.paths, ["/api/show"]);
});

test("model maximum, connection context ceiling and large-prompt budget affect num_ctx", async () => {
  const f = fixture(() => ndjson([{ message: { content: "okay" } }, done]), { providerSettings: { ollamaContextTokens: 24_000 } });
  await f.client.complete({ messages: [{ role: "user", content: "x".repeat(55_000) }], tools: [], maxOutputTokens: 4_096 });
  assert.equal(f.bodies[0].options.num_ctx, 24_000);
  const small = fixture(() => ndjson([{ message: { content: "okay" } }, done]), {}, { ...show, model_info: { "general.architecture": "qwen3", "qwen3.context_length": 8_192 } });
  await small.client.complete(request); assert.equal(small.bodies[0].options.num_ctx, 8_192);
});

test("declared thinking levels map the effort and reasoning replay stays scoped to its model", async () => {
  const f = fixture(() => ndjson([{ message: { thinking: "private replay", content: "done" } }, done]), {}, { ...show, thinking: { values: ["low", "medium", "high"], default: "medium" } } as typeof show);
  await f.client.complete({ ...request, reasoningEffort: "xhigh" }); assert.equal(f.bodies[0].think, "medium");
  await f.client.complete({ messages: [{ role: "assistant", content: "done", providerState: { kind: "ollama_provider_state", scope: "another-model", thinking: "wrong-model" } }, ...request.messages], tools: [] });
  assert.equal(f.bodies[1].think, "medium"); assert.equal(f.bodies[1].messages[0].thinking, undefined);
});


test("mixed Ollama /show controls preserve explicit off alongside effort", async () => {
  const f = fixture(() => ndjson([{ message: { content: "done" } }, done]), {}, { ...show, thinking: { values: [false, "low", "high"], default: "low" } } as typeof show);
  await f.client.complete({ ...request, reasoningEffort: "high", reasoningEnabled: false });
  assert.equal(f.bodies[0].think, false);
  await f.client.complete({ ...request, reasoningEffort: "high", reasoningEnabled: true });
  assert.equal(f.bodies[1].think, "high");
});
