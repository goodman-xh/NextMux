import { declaredEffort } from "./fixtures/reasoning-declarations.mts";
import assert from "node:assert/strict";
import test from "node:test";

import type { AgentToolDescriptor } from "@nextmux/agent-runtime";

import { createAiSdkModelClient, OfficialModelError } from "../lib/index.js";
import type { OfficialModelEvent } from "../lib/index.js";

const tool: AgentToolDescriptor = {
  name: "workspace.read_file",
  description: "Read one workspace file",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  requiredPermission: "read_only",
  source: "builtin",
};

function eventStreamResponse(chunks: readonly unknown[]): Response {
  return new Response(
    `${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}

function namedEventStreamResponse(events: readonly { readonly event: string; readonly data: unknown }[]): Response {
  return new Response(
    events.map(item => `event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}

test("the canonical event seam preserves text, incremental tool input, usage, and completion order", async () => {
  const events: OfficialModelEvent[] = [];
  const providerEvents: string[] = [];
  const client = createAiSdkModelClient({
    providerId: "custom_openai",
    protocol: "openai_chat_completions",
    reasoningControls: declaredEffort("openai_chat_completions"),
    baseUrl: "https://compatible.example.test/v1",
    apiKey: "secret-compatible",
    model: "compatible-model",
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const toolName = body.tools[0].function.name;
      return eventStreamResponse([
        { id: "chatcmpl-events", model: "compatible-model", choices: [{ index: 0, delta: { role: "assistant", content: "Checking" }, finish_reason: null }] },
        { id: "chatcmpl-events", model: "compatible-model", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call-events", function: { name: toolName, arguments: '{"path":' } }] }, finish_reason: null }] },
        { id: "chatcmpl-events", model: "compatible-model", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"README.md"}' } }] }, finish_reason: null }] },
        { id: "chatcmpl-events", model: "compatible-model", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 } },
      ]);
    },
  });

  const result = await client.complete({
    messages: [{ role: "user", content: "Read README" }],
    tools: [tool],
    onModelEvent: event => { events.push(event); },
    onProviderEvent: event => { providerEvents.push(event.type); },
  });

  assert.deepEqual(result.toolCalls, [{ id: "call-events", name: tool.name, arguments: { path: "README.md" } }]);
  assert.deepEqual(events.map(event => event.type), [
    "response.started",
    "content.started",
    "content.delta",
    "tool_call.started",
    "tool_call.arguments_delta",
    "tool_call.arguments_delta",
    "content.completed",
    "tool_call.completed",
    "usage",
    "response.completed",
  ]);
  assert.deepEqual(providerEvents, events.map(event => event.type),
    "the provider-neutral callback must receive the same ordered lifecycle stream");
  const deltas = events.filter((event): event is Extract<OfficialModelEvent, { type: "tool_call.arguments_delta" }> =>
    event.type === "tool_call.arguments_delta");
  assert.equal(deltas.map(event => event.delta).join(""), '{"path":"README.md"}');
  const completed = events.find((event): event is Extract<OfficialModelEvent, { type: "tool_call.completed" }> =>
    event.type === "tool_call.completed");
  assert.deepEqual(completed?.toolCall, result.toolCalls[0]);
  const attempts = new Set(events.map(event => event.attemptId));
  assert.equal(attempts.size, 1);
});

test("a failed generation emits one structured failure event and is never retried by the SDK", async () => {
  const events: OfficialModelEvent[] = [];
  let requests = 0;
  const client = createAiSdkModelClient({
    providerId: "openai",
    protocol: "openai_responses",
    reasoningControls: declaredEffort("openai_responses"),
    baseUrl: "https://api.openai.test/v1",
    apiKey: "secret-openai",
    model: "gpt-test",
    fetchImpl: async () => {
      requests += 1;
      return Response.json({ error: { code: "server_overloaded", message: "do not expose this body" } }, {
        status: 503,
        headers: { "x-request-id": "req_protocol_failure" },
      });
    },
  });

  await assert.rejects(client.complete({
    messages: [{ role: "user", content: "hello" }],
    tools: [],
    onModelEvent: event => { events.push(event); },
  }), error => {
    assert.equal(error instanceof OfficialModelError, true);
    const failure = error as OfficialModelError;
    assert.equal(failure.code, "UPSTREAM_UNAVAILABLE");
    assert.equal(failure.httpStatus, 503);
    assert.equal(failure.requestId, "req_protocol_failure");
    assert.equal(failure.retryable, true);
    assert.equal(failure.retrySafe, false);
    assert.doesNotMatch(failure.publicMessage, /do not expose this body/i);
    assert.match(failure.readableError.detail, /do not expose this body/i);
    return true;
  });
  assert.equal(requests, 1);
  assert.deepEqual(events.map(event => event.type), ["response.started", "response.failed"]);
  const failed = events[1] as Extract<OfficialModelEvent, { type: "response.failed" }>;
  assert.equal(failed.error.code, "UPSTREAM_UNAVAILABLE");
  assert.equal(failed.error.requestId, "req_protocol_failure");
  assert.doesNotMatch(failed.error.message, /do not expose this body/i);
  assert.match(failed.error.readableError!.detail, /do not expose this body/i);
});

test("Anthropic reasoning summaries use the same ordered reasoning event contract", async () => {
  const events: OfficialModelEvent[] = [];
  let body: any;
  const client = createAiSdkModelClient({
    providerId: "anthropic",
    protocol: "anthropic_messages",
    reasoningControls: declaredEffort("anthropic_messages"),
    baseUrl: "https://api.anthropic.test/v1",
    apiKey: "secret-anthropic",
    model: "claude-opus-5",
    fetchImpl: async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return namedEventStreamResponse([
        { event: "message_start", data: { type: "message_start", message: { id: "msg-reasoning", type: "message", role: "assistant", content: [], model: "claude-opus-5", stop_reason: null, stop_sequence: null, usage: { input_tokens: 7, output_tokens: 1 } } } },
        { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } } },
        { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Summary step" } } },
        { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "opaque-signature" } } },
        { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
        { event: "content_block_start", data: { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } } },
        { event: "content_block_delta", data: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Answer" } } },
        { event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
        { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } } },
        { event: "message_stop", data: { type: "message_stop" } },
      ]);
    },
  });

  const result = await client.complete({
    messages: [{ role: "user", content: "Think briefly" }],
    tools: [],
    reasoningEffort: "high",
    onModelEvent: event => { events.push(event); },
  });

  assert.equal(body.output_config.effort, "high");
  assert.equal(result.content, "Answer");
  assert.deepEqual(events
    .filter(event => event.type.startsWith("reasoning."))
    .map(event => event.type), ["reasoning.started", "reasoning.delta", "reasoning.completed"]);
  const delta = events.find((event): event is Extract<OfficialModelEvent, { type: "reasoning.delta" }> =>
    event.type === "reasoning.delta");
  assert.equal(delta?.delta, "Summary step");
});

test("Anthropic thinking signatures survive a tool-result round trip", async () => {
  const bodies: any[] = [];
  const client = createAiSdkModelClient({
    providerId: "anthropic",
    protocol: "anthropic_messages",
    reasoningControls: declaredEffort("anthropic_messages"),
    baseUrl: "https://api.anthropic.test/v1",
    apiKey: "secret-anthropic",
    model: "claude-opus-5",
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (bodies.length === 1) {
        const toolName = body.tools[0].name;
        return namedEventStreamResponse([
          { event: "message_start", data: { type: "message_start", message: { id: "msg-tool-reasoning", type: "message", role: "assistant", content: [], model: "claude-opus-5", stop_reason: null, stop_sequence: null, usage: { input_tokens: 9, output_tokens: 1 } } } },
          { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } } },
          { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Need the file" } } },
          { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "anthropic-thinking-signature" } } },
          { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
          { event: "content_block_start", data: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu-reasoning", name: toolName, input: {} } } },
          { event: "content_block_delta", data: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"path":"README.md"}' } } },
          { event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
          { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 8 } } },
          { event: "message_stop", data: { type: "message_stop" } },
        ]);
      }
      return namedEventStreamResponse([
        { event: "message_start", data: { type: "message_start", message: { id: "msg-tool-final", type: "message", role: "assistant", content: [], model: "claude-opus-5", stop_reason: null, stop_sequence: null, usage: { input_tokens: 14, output_tokens: 1 } } } },
        { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
        { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done" } } },
        { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
        { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } } },
        { event: "message_stop", data: { type: "message_stop" } },
      ]);
    },
  });

  const first = await client.complete({
    messages: [{ role: "user", content: "Read README" }],
    tools: [tool],
    reasoningEffort: "high",
  });
  assert.deepEqual(first.toolCalls, [{ id: "toolu-reasoning", name: tool.name, arguments: { path: "README.md" } }]);
  assert.ok(first.providerState);

  const second = await client.complete({
    messages: [
      { role: "user", content: "Read README" },
      { role: "assistant", content: "", toolCalls: first.toolCalls, providerState: first.providerState },
      { role: "tool", toolCallId: "toolu-reasoning", content: "# NextMux" },
    ],
    tools: [tool],
    reasoningEffort: "high",
  });

  const assistant = bodies[1].messages.find((message: any) => message.role === "assistant");
  const thinking = assistant.content.find((part: any) => part.type === "thinking");
  assert.equal(thinking.thinking, "Need the file");
  assert.equal(thinking.signature, "anthropic-thinking-signature");
  assert.equal(second.content, "Done");
});
