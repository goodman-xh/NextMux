import assert from "node:assert/strict";
import test from "node:test";
import { createAiSdkModelClient } from "../lib/index.js";
import type { AgentToolDescriptor } from "@nextmux/agent-runtime";
import type { OfficialModelUsage } from "../lib/index.js";

const cacheControl = { type: "ephemeral", ttl: "5m" };
const tools: AgentToolDescriptor[] = ["workspace.read_file", "workspace.list_files"].map(name => ({
  name, description: name, inputSchema: { type: "object", properties: {} }, requiredPermission: "read_only", source: "builtin",
}));

function anthropicResponse(): Response {
  const events = [
    { type: "message_start", message: { id: "cached", type: "message", role: "assistant", content: [], model: "claude-sonnet-5", stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 12, cache_read_input_tokens: 24 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } },
    { type: "message_stop" },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}

test("Anthropic SDK caches the stable tool/system prefix and last two messages with five-minute breakpoints", async () => {
  const bodies: any[] = [];
  const client = createAiSdkModelClient({ providerId: "anthropic", protocol: "anthropic_messages", baseUrl: "https://api.anthropic.test/v1", apiKey: "fixture", model: "claude-sonnet-5",
    fetchImpl: async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return anthropicResponse(); } });
  const messages = [{ role: "user" as const, content: "old question" }, { role: "assistant" as const, content: "old answer" },
    { role: "user" as const, content: "prior question" }, { role: "assistant" as const, content: "recent answer" }, { role: "user" as const, content: "latest question" }];
  const result = await client.complete({ instructions: "Stable instructions", messages, tools });
  await client.complete({ instructions: "Stable instructions", messages: [...messages.slice(0, -1), { role: "user", content: "new question" }], tools });
  assert.deepEqual(bodies[0].system, [{ type: "text", text: "Stable instructions", cache_control: cacheControl }]);
  assert.equal(bodies[0].tools[0].cache_control, undefined);
  assert.deepEqual(bodies[0].tools[1].cache_control, cacheControl);
  assert.deepEqual(bodies[0].tools, bodies[1].tools, "tool order and definitions stay stable across turns");
  assert.deepEqual(bodies[0].messages.slice(0, -2).flatMap((message: any) => message.content).map((part: any) => part.cache_control), [undefined, undefined, undefined]);
  assert.deepEqual(bodies[0].messages.slice(-2).map((message: any) => message.content.at(-1).cache_control), [cacheControl, cacheControl]);
  assert.equal((result.usage as OfficialModelUsage).cacheWriteTokens, 12);
  assert.equal((result.usage as OfficialModelUsage).cachedInputTokens, 24);
});

test("Anthropic SDK breakpoints cover tool-result messages after native message grouping", async () => {
  let body: any;
  const client = createAiSdkModelClient({ providerId: "anthropic", protocol: "anthropic_messages", baseUrl: "https://api.anthropic.test/v1", apiKey: "fixture", model: "claude-sonnet-5",
    fetchImpl: async (_url, init) => { body = JSON.parse(String(init?.body)); return anthropicResponse(); } });
  await client.complete({ messages: [{ role: "user", content: "read" }, { role: "assistant", content: "checking", toolCalls: [{ id: "call", name: tools[0].name, arguments: {} }] },
    { role: "tool", content: "file content", toolCallId: "call" }], tools });
  assert.deepEqual(body.messages.at(-1).content.at(-1).cache_control, cacheControl);
  assert.equal(body.messages.at(-1).content.at(-1).type, "tool_result");
  assert.deepEqual(body.messages.at(-2).content.at(-1).cache_control, cacheControl);
});

test("other SDK protocols keep their prompt unchanged without Anthropic cache controls", async () => {
  let body: any;
  const client = createAiSdkModelClient({ providerId: "custom_openai", protocol: "openai_chat_completions", baseUrl: "https://relay.test/v1", apiKey: "fixture", model: "chat-model",
    fetchImpl: async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response('data: {"id":"chat","model":"chat-model","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }); } });
  await client.complete({ instructions: "Stable instructions", messages: [{ role: "user", content: "hello" }], tools });
  assert.equal(JSON.stringify(body).includes("cache_control"), false);
  assert.equal(JSON.stringify(body).includes("cacheControl"), false);
  assert.equal(body.messages[0].content, "Stable instructions");
});
