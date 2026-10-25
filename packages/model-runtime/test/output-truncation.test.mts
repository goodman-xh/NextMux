import assert from "node:assert/strict";
import test from "node:test";
import { createAiSdkModelClient, createOfficialModelClient } from "../lib/index.js";
import type { OfficialModelEvent, OfficialProviderProtocol } from "../lib/index.js";
import type { AgentToolDescriptor } from "@nextmux/agent-runtime";

const tool: AgentToolDescriptor = { name: "workspace.read_file", description: "Read", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  requiredPermission: "read_only", source: "builtin" };
const request = { messages: [{ role: "user" as const, content: "hello" }], tools: [tool] };

function sse(chunks: unknown[]): Response {
  return new Response(`${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
}

test("AI SDK returns the provider length verdict and partial text without incomplete tools", async () => {
  for (const content of ["partial answer", ""]) for (const argumentsValue of ['{"path":', '', undefined]) {
    const events: OfficialModelEvent[] = [];
    const client = createAiSdkModelClient({ providerId: "custom_openai", protocol: "openai_chat_completions", baseUrl: "https://relay.test/v1", apiKey: "fixture", model: "chat-model",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        return sse([{ id: "truncated", model: "chat-model", choices: [{ index: 0, delta: { role: "assistant", content,
          tool_calls: [{ index: 0, id: "partial-call", type: "function", function: { name: body.tools[0].function.name, arguments: argumentsValue } }] }, finish_reason: null }] },
          { id: "truncated", model: "chat-model", choices: [{ index: 0, delta: {}, finish_reason: "length" }], usage: { prompt_tokens: 3, completion_tokens: 4 } }]);
      } });
    const result = await client.complete({ ...request, onModelEvent: event => { events.push(event); } });
    assert.equal(result.finishReason, "length"); assert.equal(result.content, content); assert.deepEqual(result.toolCalls, []);
    assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 4 });
    assert.equal(events.some(event => event.type === "tool_call.completed"), false);
    const terminal = events.at(-1);
    assert.equal(terminal?.type, "response.completed");
    assert.equal(terminal?.type === "response.completed" && terminal.finishReason, "length");
  }
});

test("native length verdict permits an empty assistant turn and rejects empty or missing tool arguments", async () => {
  for (const argumentsValue of ["", undefined, null]) {
    const client = createOfficialModelClient({ protocol: "openai_chat_completions", baseUrl: "https://relay.test/v1", apiKey: "fixture", model: "model",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        return Response.json({ choices: [{ message: { role: "assistant", content: null, tool_calls: [
          { type: "function", id: "partial", function: { name: body.tools[0].function.name, arguments: argumentsValue } },
        ] }, finish_reason: "length" }], usage: { prompt_tokens: 3, completion_tokens: 4 } });
      } });
    const result = await client.complete(request);
    assert.equal(result.finishReason, "length"); assert.equal(result.content, ""); assert.deepEqual(result.toolCalls, []);
  }
  const client = createOfficialModelClient({ protocol: "openai_chat_completions", baseUrl: "https://relay.test/v1", apiKey: "fixture", model: "model",
    fetchImpl: async () => Response.json({ choices: [{ message: { role: "assistant", content: null }, finish_reason: "length" }], usage: { prompt_tokens: 3, completion_tokens: 4 } }) });
  assert.equal((await client.complete({ ...request, tools: [] })).finishReason, "length");
});

test("a length verdict still returns a complete SDK tool call for the runner to execute", async () => {
  for (const argumentsValue of ['{"path":"README.md"}', '{}']) {
    const client = createAiSdkModelClient({ protocol: "openai_chat_completions", baseUrl: "https://relay.test/v1", apiKey: "fixture", model: "chat-model",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        return sse([{ id: "truncated", model: "chat-model", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "complete-call", type: "function",
          function: { name: body.tools[0].function.name, arguments: argumentsValue } }] }, finish_reason: "length" }], usage: { prompt_tokens: 3, completion_tokens: 4 } }]);
      } });
    const result = await client.complete(request);
    assert.equal(result.finishReason, "length"); assert.deepEqual(result.toolCalls, [{ id: "complete-call", name: tool.name, arguments: JSON.parse(argumentsValue) }]);
  }
});

test("native own API adapters pass provider output-limit verdicts through result and terminal event", async () => {
  for (const protocol of ["openai_chat_completions", "anthropic_messages", "gemini_generate_content", "cohere_chat"] as OfficialProviderProtocol[]) {
    const events: OfficialModelEvent[] = [];
    const client = createOfficialModelClient({ protocol, baseUrl: "https://provider.test/v1", apiKey: "fixture", model: "model",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        const name = protocol === "anthropic_messages" ? body.tools[0].name : protocol === "gemini_generate_content" ? body.tools[0].functionDeclarations[0].name : body.tools[0].function.name;
        const call = { id: "call", type: "function", function: { name, arguments: '{"path":' } };
        if (protocol === "anthropic_messages") return Response.json({ model: "model", content: [{ type: "text", text: "partial" }, { type: "tool_use", id: "call", name, input: '{"path":' }], stop_reason: "max_tokens", usage: { input_tokens: 3, output_tokens: 4 } });
        if (protocol === "gemini_generate_content") return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: "partial" }, { functionCall: { id: "call", name, args: '{"path":' } }] }, finishReason: "MAX_TOKENS" }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 } });
        if (protocol === "cohere_chat") return Response.json({ model: "model", message: { content: [{ type: "text", text: "partial" }], tool_calls: [call] }, finish_reason: "MAX_TOKENS", usage: { tokens: { input_tokens: 3, output_tokens: 4 } } });
        return Response.json({ model: "model", choices: [{ message: { role: "assistant", content: "partial", tool_calls: [call] }, finish_reason: "length" }], usage: { prompt_tokens: 3, completion_tokens: 4 } });
      } });
    const result = await client.complete({ ...request, onModelEvent: event => { events.push(event); } });
    assert.equal(result.finishReason, "length", protocol); assert.equal(result.content, "partial", protocol); assert.deepEqual(result.toolCalls, [], protocol);
    assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 4 }, protocol);
    const terminal = events.at(-1);
    assert.equal(terminal?.type === "response.completed" && terminal.finishReason, "length", protocol);
    if (protocol === "gemini_generate_content") assert.equal(JSON.stringify(result.providerState).includes("functionCall"), false);
  }
});
