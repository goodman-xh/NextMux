import { declaredEffort } from "./fixtures/reasoning-declarations.mts";
import assert from "node:assert/strict";
import test from "node:test";

import type { AgentToolDescriptor } from "@nextmux/agent-runtime";

import {
  createPreferredOfficialModelClient,
  endpointUrl,
  OFFICIAL_PROVIDER_PRESETS,
} from "../lib/index.js";

function responsesStream(chunks: readonly unknown[]): Response {
  return new Response(
    `${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}

test("official OpenAI defaults to the Responses API and preserves streamed text and usage", async () => {
  let capturedUrl = "";
  let captured: any;
  const deltas: string[] = [];
  const client = createPreferredOfficialModelClient({
    providerId: "openai",
    protocol: "openai_responses" as any,
    reasoningControls: declaredEffort("openai_responses"),
    baseUrl: "https://api.openai.test/v1",
    apiKey: "secret-openai",
    model: "gpt-5.6-terra",
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      captured = JSON.parse(String(init?.body));
      return responsesStream([
        { type: "response.created", response: { id: "resp-1", created_at: 1, model: "gpt-5.6-terra", service_tier: null } },
        { type: "response.in_progress", response: { id: "resp-1", created_at: 1, model: "gpt-5.6-terra", service_tier: null } },
        { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg-1", phase: "final_answer" } },
        { type: "response.output_text.delta", item_id: "msg-1", output_index: 0, delta: "Responses hello" },
        { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg-1", phase: "final_answer" } },
        { type: "response.completed", response: { usage: { input_tokens: 31, input_tokens_details: null, output_tokens: 5, output_tokens_details: { reasoning_tokens: 1 } }, service_tier: "default" } },
      ]);
    },
  });
  const result = await client.complete({
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
    onTextDelta: delta => { deltas.push(delta); },
  });
  assert.equal(capturedUrl, "https://api.openai.test/v1/responses");
  assert.equal(captured.model, "gpt-5.6-terra");
  assert.equal(captured.stream, true);
  assert.ok(Array.isArray(captured.input));
  assert.equal("messages" in captured, false);
  assert.equal(captured.reasoning.effort, "high");
  const inputImage = captured.input[0].content.find((part: any) => part.type === "input_image");
  assert.equal(inputImage.image_url, "data:image/png;base64,aGVsbG8=");
  const inputFile = captured.input[0].content.find((part: any) => part.type === "input_file");
  assert.equal(inputFile.filename, "brief.pdf");
  assert.equal(inputFile.file_data, "data:application/pdf;base64,cGRm");
  assert.deepEqual(deltas, ["Responses hello"]);
  assert.equal(result.content, "Responses hello");
  assert.deepEqual(result.usage, { inputTokens: 31, outputTokens: 5, reasoningTokens: 1 });
});

test("OpenAI-compatible connections stay on Chat Completions and are not switched to Responses", async () => {
  let capturedUrl = "";
  let captured: any;
  const client = createPreferredOfficialModelClient({
    providerId: "custom_openai",
    protocol: "openai_chat_completions",
    reasoningControls: declaredEffort("openai_chat_completions"),
    baseUrl: "https://compatible.example.test/v1",
    apiKey: "secret-compatible",
    model: "compatible-model",
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      captured = JSON.parse(String(init?.body));
      return responsesStream([
        { id: "chatcmpl-compatible", model: "compatible-model", choices: [{ index: 0, delta: { role: "assistant", content: "Chat hello" }, finish_reason: null }] },
        { id: "chatcmpl-compatible", model: "compatible-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } },
      ]);
    },
  });
  const result = await client.complete({
    messages: [{ role: "user", content: "hello" }],
    tools: [],
  });
  assert.equal(capturedUrl, "https://compatible.example.test/v1/chat/completions");
  assert.equal(captured.stream, true);
  assert.ok(Array.isArray(captured.messages));
  assert.equal(result.content, "Chat hello");
});

test("OpenAI preset and endpoint distinguish Responses from Chat Completions", () => {
  const openai = OFFICIAL_PROVIDER_PRESETS.find(provider => provider.id === "openai");
  assert.equal(openai?.protocol, "openai_responses");
  assert.equal(
    endpointUrl("https://api.openai.test/v1", "openai_responses" as any, "gpt-5.6-terra", false).toString(),
    "https://api.openai.test/v1/responses",
  );
  assert.equal(
    endpointUrl("https://compatible.example.test/v1", "openai_chat_completions", "model", false).toString(),
    "https://compatible.example.test/v1/chat/completions",
  );
});

test("the Responses protocol selects the Responses transport even without a provider id", async () => {
  let capturedUrl = "";
  const client = createPreferredOfficialModelClient({
    protocol: "openai_responses",
    reasoningControls: declaredEffort("openai_responses"),
    baseUrl: "https://api.openai.test/v1",
    apiKey: "secret-openai",
    model: "gpt-5.6-terra",
    fetchImpl: async input => {
      capturedUrl = String(input);
      return responsesStream([
        { type: "response.created", response: { id: "resp-no-provider", created_at: 1, model: "gpt-5.6-terra", service_tier: null } },
        { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg-no-provider", phase: "final_answer" } },
        { type: "response.output_text.delta", item_id: "msg-no-provider", output_index: 0, delta: "ok" },
        { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg-no-provider", phase: "final_answer" } },
        { type: "response.completed", response: { usage: { input_tokens: 1, input_tokens_details: null, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 } }, service_tier: "default" } },
      ]);
    },
  });
  const result = await client.complete({ messages: [{ role: "user", content: "hello" }], tools: [] });
  assert.equal(capturedUrl, "https://api.openai.test/v1/responses");
  assert.equal(result.content, "ok");
});

test("Responses preserves provider state through a tool-result round trip", async () => {
  const bodies: any[] = [];
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
  let request = 0;
  const client = createPreferredOfficialModelClient({
    providerId: "openai",
    protocol: "openai_responses",
    reasoningControls: declaredEffort("openai_responses"),
    baseUrl: "https://api.openai.test/v1",
    apiKey: "secret-openai",
    model: "gpt-5.6-terra",
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      request += 1;
      if (request === 1) {
        const toolName = body.tools[0].name;
        return responsesStream([
          { type: "response.created", response: { id: "resp-tool-1", created_at: 1, model: "gpt-5.6-terra", service_tier: null } },
          { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc-item-1", call_id: "call-1", name: toolName, arguments: "", status: "in_progress" } },
          { type: "response.function_call_arguments.delta", item_id: "fc-item-1", output_index: 0, delta: '{"path":"README.md"}' },
          { type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "fc-item-1", call_id: "call-1", name: toolName, arguments: '{"path":"README.md"}', status: "completed" } },
          { type: "response.completed", response: { usage: { input_tokens: 8, input_tokens_details: null, output_tokens: 3, output_tokens_details: { reasoning_tokens: 0 } }, service_tier: "default" } },
        ]);
      }
      return responsesStream([
        { type: "response.created", response: { id: "resp-tool-2", created_at: 2, model: "gpt-5.6-terra", service_tier: null } },
        { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg-tool-2", phase: "final_answer" } },
        { type: "response.output_text.delta", item_id: "msg-tool-2", output_index: 0, delta: "README inspected" },
        { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg-tool-2", phase: "final_answer" } },
        { type: "response.completed", response: { usage: { input_tokens: 13, input_tokens_details: null, output_tokens: 2, output_tokens_details: { reasoning_tokens: 0 } }, service_tier: "default" } },
      ]);
    },
  });

  const first = await client.complete({
    messages: [{ role: "user", content: "Read README" }],
    tools: [tool],
  });
  assert.deepEqual(first.toolCalls, [{ id: "call-1", name: tool.name, arguments: { path: "README.md" } }]);
  assert.ok(first.providerState);

  const second = await client.complete({
    messages: [
      { role: "user", content: "Read README" },
      { role: "assistant", content: "", toolCalls: first.toolCalls, providerState: first.providerState },
      { role: "tool", toolCallId: "call-1", content: "# NextMux" },
    ],
    tools: [tool],
  });
  const functionCall = bodies[1].input.find((item: any) => item.type === "function_call");
  const functionResult = bodies[1].input.find((item: any) => item.type === "function_call_output");
  assert.equal((first.providerState as any).toolCallProviderOptions["call-1"].openai.itemId, "fc-item-1");
  assert.equal(functionCall.call_id, "call-1");
  assert.equal(functionCall.arguments, '{"path":"README.md"}');
  assert.equal(functionResult.call_id, "call-1");
  assert.equal(functionResult.output, "# NextMux");
  assert.equal(second.content, "README inspected");
});


test("Responses explicitly preserves optional mutually exclusive tool parameters", async () => {
  let captured: any;
  const schema = { type: "object", additionalProperties: false,
    properties: { browserId: { type: "string" }, ref: { type: "string" }, selector: { type: "string" }, text: { type: "string" } },
    required: ["browserId", "text"] };
  const client = createPreferredOfficialModelClient({
    protocol: "openai_responses", baseUrl: "https://compatible.example.test/v1", apiKey: "fixture-key", model: "fixture-model",
    fetchImpl: async (_input, init) => {
      captured = JSON.parse(String(init?.body));
      return responsesStream([
        { type: "response.created", response: { id: "resp-optional", created_at: 1, model: "fixture-model", service_tier: null } },
        { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc-optional", call_id: "call-optional", name: captured.tools[0].name, arguments: "", status: "in_progress" } },
        { type: "response.function_call_arguments.delta", item_id: "fc-optional", output_index: 0, delta: '{"browserId":"owned-page","ref":"fresh-ref","text":"hello"}' },
        { type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "fc-optional", call_id: "call-optional", name: captured.tools[0].name, arguments: '{"browserId":"owned-page","ref":"fresh-ref","text":"hello"}', status: "completed" } },
        { type: "response.completed", response: { usage: { input_tokens: 8, input_tokens_details: null, output_tokens: 3, output_tokens_details: { reasoning_tokens: 0 } }, service_tier: "default" } },
      ]);
    },
  });
  const result = await client.complete({ messages: [{ role: "user", content: "fill" }],
    tools: [{ name: "browser.fill", description: "Use ref or selector, never both", inputSchema: schema, requiredPermission: "full_access", source: "builtin" }] });
  assert.equal(captured.tools[0].strict, false);
  assert.deepEqual(captured.tools[0].parameters, schema);
  assert.ok(result.toolCalls);
  assert.deepEqual(result.toolCalls[0].arguments, { browserId: "owned-page", ref: "fresh-ref", text: "hello" });
  assert.equal(Object.hasOwn(result.toolCalls[0].arguments as object, "selector"), false);
});
