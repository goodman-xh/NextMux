import assert from "node:assert/strict";
import test from "node:test";
import { createAiSdkModelClient, type OfficialModelClientOptions } from "../lib/index.js";
import { createOpenRouterMetadataExtractor } from "../lib/openrouter.js";

const tool = { name: "workspace.read", description: "Read", inputSchema: { type: "object", properties: {} },
  requiredPermission: "read_only", source: "builtin" } as const;
const details = [
  { type: "reasoning.text", text: "Check files.", signature: "signed-test", id: "text-1", index: 0, format: "anthropic-claude-v1" },
  { type: "reasoning.encrypted", data: "opaque-test", id: "encrypted-1", index: 0, format: "anthropic-claude-v1" },
  { type: "reasoning.summary", summary: "Keep findings.", id: "summary-1", index: 0, format: "openai-responses-v1" },
];
const sse = (chunks: unknown[]) => new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
  { headers: { "content-type": "text/event-stream" } });

for (const change of ["same", "upstream", "slash", "model", "endpoint", "provider", "unscoped", "resolved-model"] as const) {
  test(`OpenRouter reasoning protocol roundtrip: ${change}`, async () => {
    const bodies: any[] = [], events: any[] = [];
    const actualModel = change === "resolved-model" ? "anthropic/actual-fallback" : "anthropic/test-model";
    const options: OfficialModelClientOptions = {
      providerId: "openrouter", protocol: "openai_chat_completions", model: "anthropic/test-model",
      apiKey: "synthetic", baseUrl: "https://openrouter.test/api/v1", openRouterRoutePolicy: { provider: { order: ["First"] } },
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)); bodies.push(body);
        const chunk = (delta: unknown, finish_reason: string | null = null) => ({ id: "generation-test", model: actualModel,
          choices: [{ index: 0, delta, finish_reason }], usage: { prompt_tokens: 9, completion_tokens: 2 } });
        if (bodies.length > 1) return sse([chunk({ content: "Done" }, "stop")]);
        return sse([
          chunk({ reasoning_details: [{ ...details[0], text: "Check ", signature: null }] }),
          chunk({ reasoning_details: [{ ...details[0], text: "files.", signature: null }] }),
          chunk({ reasoning_details: [{ ...details[0], text: "" }] }),
          chunk({ reasoning_details: [details[1], { ...details[2], summary: "Keep " }] }),
          chunk({ reasoning_details: [{ ...details[2], summary: "findings." }] }),
          chunk({ content: "Visible finding", tool_calls: [0, 1].map(index => ({ index, id: `call-${index}`, type: "function",
            function: { name: body.tools[0].function.name, arguments: "{}" } })) }, "tool_calls"),
        ]);
      },
    };
    const first = await createAiSdkModelClient(options).complete({ messages: [{ role: "user", content: "Inspect" }], tools: [tool],
      onModelEvent: event => { events.push(event); } });
    const state = structuredClone(first.providerState) as any;
    assert.deepEqual(state.openRouterReasoningDetails, details);
    assert.equal(events.filter(event => event.type === "reasoning.delta").map(event => event.delta).join(""), "Check files.Keep findings.");
    assert.doesNotMatch(JSON.stringify(events), /signed-test|opaque-test/, "opaque metadata must not be a UI event");
    if (change === "unscoped") delete state.providerScope;
    const messages = [{ role: "user", content: "Inspect" }, { role: "assistant", content: first.content || "", toolCalls: first.toolCalls, providerState: state },
      ...[0, 1].map(index => ({ role: "tool" as const, toolCallId: `call-${index}`, content: `Evidence ${index}` }))] as const;
    const original = JSON.stringify(messages);
    await createAiSdkModelClient({ ...options,
      ...(change === "upstream" ? { openRouterRoutePolicy: { provider: { order: ["Second"] } } } : {}),
      ...(change === "slash" ? { baseUrl: options.baseUrl + "/" } : {}),
      ...(change === "model" ? { model: "openai/second-model" } : {}),
      ...(change === "endpoint" ? { baseUrl: "https://another.test/api/v1" } : {}),
      ...(change === "provider" ? { providerId: "custom_openai", openRouterRoutePolicy: undefined } as const : {}),
    }).complete({ messages, tools: [tool] });
    const assistant = bodies[1].messages.find((message: any) => message.role === "assistant");
    if (["same", "upstream", "slash"].includes(change)) {
      assert.deepEqual(assistant.reasoning_details, details, "preserve block order and signatures once per assistant, not per parallel tool");
      assert.equal(assistant.content, "Visible finding");
      assert.equal(assistant.reasoning_content, undefined, "structured reasoning must not also be emitted as unsigned thinking");
    } else {
      assert.equal(assistant.reasoning_details, undefined);
      assert.equal(assistant.reasoning_content, undefined);
      assert.match(assistant.content, /Check files\./); assert.match(assistant.content, /Keep findings\./);
      assert.doesNotMatch(JSON.stringify(bodies[1]), /signed-test|opaque-test/);
    }
    assert.deepEqual(assistant.tool_calls.map((call: any) => call.id), ["call-0", "call-1"]);
    assert.deepEqual(bodies[1].messages.filter((message: any) => message.role === "tool").map((message: any) => message.tool_call_id), ["call-0", "call-1"]);
    assert.equal(JSON.stringify(messages), original);
  });
}

for (const kind of ["empty", "plain"] as const) test(`OpenRouter ${kind} reasoning is preserved without inventing structured details`, async () => {
  const bodies: any[] = [];
  const options: OfficialModelClientOptions = { providerId: "openrouter", protocol: "openai_chat_completions", model: "test/model",
    apiKey: "synthetic", baseUrl: "https://openrouter.test/api/v1", fetchImpl: async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return sse([{ id: "test", model: "test/model", choices: [{ index: 0,
        delta: { content: "Answer", ...(kind === "empty" ? { reasoning_details: [] } : { reasoning: "Plain reasoning" }) }, finish_reason: "stop" }] }]);
    } };
  const client = createAiSdkModelClient(options), first = await client.complete({ messages: [{ role: "user", content: "Hi" }], tools: [] });
  await client.complete({ messages: [{ role: "assistant", content: first.content || "", providerState: first.providerState }, { role: "user", content: "Continue" }], tools: [] });
  assert.deepEqual(bodies[1].messages[0].reasoning_details, kind === "empty" ? [] : undefined);
  assert.equal(bodies[1].messages[0].reasoning_content, kind === "plain" ? "Plain reasoning" : undefined);
});

for (const format of ["anthropic-claude-v1", "google-gemini-v1"] as const) {
  test(`OpenRouter ${format} unsigned reasoning.text is removed on the second BYOK turn`, async () => {
    const bodies: any[] = [];
    const original = { type: "reasoning.text", text: "Private thought", signature: null, id: "thought-1", index: 0, format };
    const client = createAiSdkModelClient({ providerId: "openrouter", protocol: "openai_chat_completions", model: "test/model",
      apiKey: "synthetic", baseUrl: "https://openrouter.test/api/v1", fetchImpl: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return sse([{ id: "test", model: "test/model", choices: [{ index: 0,
          delta: { content: "Visible", ...(bodies.length === 1 ? { reasoning_details: [original] } : {}) }, finish_reason: "stop" }] }]);
      } });
    const first = await client.complete({ messages: [{ role: "user", content: "Inspect" }], tools: [] });
    assert.deepEqual((first.providerState as any)?.openRouterReasoningDetails, [original], "keep authentic response data locally");
    await client.complete({ messages: [{ role: "assistant", content: first.content || "", providerState: first.providerState },
      { role: "user", content: "Continue" }], tools: [] });
    const assistant = bodies[1].messages.find((message: any) => message.role === "assistant");
    assert.deepEqual(assistant.reasoning_details, [], "preserve the empty array after filtering unsigned private text");
    assert.equal(assistant.reasoning_content, undefined);
    assert.equal(assistant.content, "Visible");
  });
}

test("OpenRouter complete nonstream blocks retain their boundaries; streaming signatures after content are retained", async () => {
  const separate = [details[0], { ...details[0], id: "text-2", text: "Another thought.", signature: "second-signature" }];
  const extractor = createOpenRouterMetadataExtractor();
  const metadata = await extractor.extractMetadata({ parsedBody: { choices: [{ message: { reasoning_details: separate } }] } as any });
  assert.deepEqual(metadata?.openrouter?.reasoning_details, separate);
  const stream = extractor.createStreamExtractor();
  stream.processChunk({ choices: [{ delta: { reasoning_details: [{ ...details[0], signature: null }] } }] });
  stream.processChunk({ choices: [{ delta: { content: "Answer" } }] });
  stream.processChunk({ choices: [{ delta: { reasoning_details: [{ ...details[0], text: "" }] } }] });
  stream.processChunk({ choices: [{ delta: { reasoning_details: [separate[1]] } }] });
  assert.deepEqual(stream.buildMetadata()?.openrouter?.reasoning_details, separate);
});

test("OpenRouter malformed and oversized details fail before a successful completion can lose private state", async () => {
  for (const reasoning_details of [[{ type: "reasoning.encrypted", data: "x".repeat(513 * 1024) }], [{ type: "unrecognized.private", data: "secret" }]]) {
    const events: any[] = [];
    const client = createAiSdkModelClient({ providerId: "openrouter", protocol: "openai_chat_completions", model: "test/model",
      apiKey: "synthetic", baseUrl: "https://openrouter.test/api/v1", fetchImpl: async () => sse([{ id: "test", model: "test/model",
        choices: [{ index: 0, delta: { content: "Answer", reasoning_details }, finish_reason: "stop" }] }]) });
    await assert.rejects(client.complete({ messages: [{ role: "user", content: "Hi" }], tools: [], onModelEvent: event => { events.push(event); } }),
      (error: any) => error.code === "INVALID_RESPONSE");
    assert.equal(events.some(event => event.type === "response.completed"), false);
    assert.doesNotMatch(JSON.stringify(events), /secret|xxx/);
  }
});
