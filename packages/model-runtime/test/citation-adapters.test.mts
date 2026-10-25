import assert from "node:assert/strict";
import test from "node:test";
import { createOfficialModelClient, createPreferredOfficialModelClient } from "../lib/index.js";

const source = { url: "https://example.com/source", title: "文档 <script>" };
const unsafe = { url: "javascript:alert(1)", title: "unsafe" };
const fixtures = [
  { protocol: "openai_chat_completions", body: { choices: [{ message: { content: "answer", annotations: [
    { type: "url_citation", url_citation: source }, { type: "url_citation", url_citation: unsafe }, { type: "not_citation", url_citation: source }
  ] } }], usage: { prompt_tokens: 3, completion_tokens: 2 } } },
  { protocol: "anthropic_messages", body: { content: [{ type: "text", text: "answer", citations: [
    { type: "web_search_result_location", ...source, encrypted_index: "PRIVATE", cited_text: "RAW EXCERPT" },
    { type: "web_search_result_location", ...unsafe }, { type: "char_location", url: "https://example.com/not-a-web-citation" }
  ] }], usage: { input_tokens: 3, output_tokens: 2 } } },
  { protocol: "gemini_generate_content", body: { candidates: [{ content: { role: "model", parts: [{ text: "answer" }] }, groundingMetadata: {
    groundingChunks: [{ web: { uri: source.url, title: source.title } }, { web: { uri: unsafe.url } }, { retrievedContext: { uri: "gs://private/bucket" } }]
  } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } } },
  { protocol: "cohere_chat", body: { message: { content: [{ type: "text", text: "answer" }], citations: [{ sources: [
    { type: "document", document: { ...source, snippet: "PRIVATE" } }, { type: "tool", tool_output: unsafe },
    { type: "document", id: "https://example.com/only-id", document: { title: "no url" } }
  ] }] }, usage: { tokens: { input_tokens: 3, output_tokens: 2 } } } },
] as const;

for (const fixture of fixtures) test(`native ${fixture.protocol} extracts only explicit public citations`, async () => {
  const events: any[] = [];
  const client = createOfficialModelClient({ protocol: fixture.protocol, baseUrl: "https://api.example.test/v1", apiKey: "fixture-secret", model: "fixture-model",
    fetchImpl: async () => Response.json(fixture.body) });
  const result = await client.complete({ messages: [{ role: "user", content: "question" }], tools: [], onModelEvent: event => { events.push(event); } });
  assert.deepEqual(result.citations, [source]);
  assert.deepEqual(events.find(event => event.type === "response.completed")?.citations, [source]);
  assert.doesNotMatch(JSON.stringify(result.citations), /PRIVATE|RAW EXCERPT|only-id|javascript/);
});

function responsesStream(annotations: readonly unknown[], fail = false): Response {
  const chunks = [
    { type: "response.created", response: { id: "resp-source", created_at: 1, model: "gpt-source", service_tier: null } },
    { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg-source", phase: "final_answer" } },
    { type: "response.output_text.delta", item_id: "msg-source", output_index: 0, delta: "answer" },
    ...annotations.map(annotation => ({ type: "response.output_text.annotation.added", item_id: "msg-source", output_index: 0, content_index: 0, annotation_index: 0, annotation })),
    ...(fail ? [{ type: "response.failed", sequence_number: 4, response: { error: { code: "server_error", message: "fixture failure" }, usage: null, incomplete_details: null, service_tier: null } }] : [
      { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg-source", phase: "final_answer" } },
      { type: "response.completed", response: { usage: { input_tokens: 3, input_tokens_details: null, output_tokens: 2, output_tokens_details: { reasoning_tokens: 0 } }, service_tier: "default" } },
    ]),
  ];
  return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
}

test("native Responses SDK source events reach final citations without private annotation fields", async () => {
  const events: any[] = [];
  const client = createPreferredOfficialModelClient({ providerId: "openai", protocol: "openai_responses", baseUrl: "https://api.example.test/v1", apiKey: "fixture-secret", model: "gpt-source",
    fetchImpl: async () => responsesStream([{ type: "url_citation", ...source, start_index: 0, end_index: 6 }, { type: "url_citation", ...unsafe, start_index: 0, end_index: 6 }, { type: "file_citation", file_id: "PRIVATE", filename: "private.txt", index: 0 }]) });
  const result = await client.complete({ messages: [{ role: "user", content: "question" }], tools: [], onModelEvent: event => { events.push(event); } });
  assert.deepEqual(result.citations, [source]);
  assert.deepEqual(events.find(event => event.type === "response.completed")?.citations, [source]);
  assert.doesNotMatch(JSON.stringify(result.citations), /PRIVATE|private.txt|javascript|start_index/);
});

test("failed Responses never promotes partial sources into a completed response", async () => {
  const events: any[] = [];
  const client = createPreferredOfficialModelClient({ providerId: "openai", protocol: "openai_responses", baseUrl: "https://api.example.test/v1", apiKey: "fixture-secret", model: "gpt-source",
    fetchImpl: async () => responsesStream([{ type: "url_citation", ...source, start_index: 0, end_index: 6 }], true) });
  await assert.rejects(client.complete({ messages: [{ role: "user", content: "question" }], tools: [], onModelEvent: event => { events.push(event); } }));
  assert.equal(events.some(event => event.type === "response.completed"), false);
});

for (const providerId of [undefined, "openrouter"] as const) test(`streamed ${providerId || "compatible"} citations reuse the SDK metadata seam`, async () => {
  const client = createPreferredOfficialModelClient({ providerId, protocol: "openai_chat_completions", baseUrl: "https://api.example.test/v1", apiKey: "fixture-secret", model: "fixture-model", fetchImpl: async () => new Response([
    { id: "chatcmpl-source", model: "fixture-model", choices: [{ index: 0, delta: { content: "answer", annotations: [{ type: "url_citation", url_citation: { ...source, start_index: 0, end_index: 6 } }] }, finish_reason: null }] },
    { id: "chatcmpl-source", model: "fixture-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
  ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }) });
  const result = await client.complete({ messages: [{ role: "user", content: "question" }], tools: [] });
  assert.deepEqual(result.citations, [source]);
  if (providerId === "openrouter") assert.equal((result.providerState as any)?.openRouter?.model?.value, "fixture-model");
});

function cohereStream(fail = false): Response {
  const chunks = [
    { type: "message-start", id: "cohere-source", delta: { message: { role: "assistant" } } },
    { type: "content-start", index: 0, delta: { message: { content: { type: "text", text: "" } } } },
    { type: "content-delta", index: 0, delta: { message: { content: { text: "answer" } } } },
    { type: "citation-start", index: 0, delta: { message: { citations: { start: 0, end: 6, text: "RAW EXCERPT", sources: [
      { type: "document", id: "private-id", document: { ...source, snippet: "PRIVATE DOCUMENT" } },
      { type: "tool", tool_output: { url: "https://example.com/tool", title: "Tool source", text: "PRIVATE TOOL" } },
      { type: "document", document: unsafe },
      { type: "document", id: "https://example.com/invented", document: { title: "no url" } },
    ] } } }, ignored: "PRIVATE CHUNK" },
    { type: "citation-end", index: 0 },
    ...(fail ? [{ type: "content-delta", index: 0, delta: { message: { content: { text: 42 } } } }] : [
      { type: "content-end", index: 0 },
      { type: "message-end", delta: { finish_reason: "COMPLETE", usage: { tokens: { input_tokens: 3, output_tokens: 2 }, billed_units: { input_tokens: 3, output_tokens: 2 } } } },
    ]),
  ];
  return new Response(chunks.map(chunk => `event: ${chunk.type}\ndata: ${JSON.stringify(chunk)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}

test("preferred Cohere source extraction reuses raw SDK chunks without leaking raw data", async () => {
  const events: any[] = [];
  const client = createPreferredOfficialModelClient({ providerId: "cohere", protocol: "cohere_chat", baseUrl: "https://api.example.test/v2", apiKey: "fixture-secret", model: "command-fixture",
    fetchImpl: async (_url, init) => { assert.equal(JSON.parse(String(init?.body)).stream, true); assert.equal(JSON.parse(String(init?.body)).include, undefined); return cohereStream(); } });
  const result = await client.complete({ messages: [{ role: "user", content: "question" }], tools: [], onModelEvent: event => { events.push(event); } });
  assert.deepEqual(result.citations, [source, { url: "https://example.com/tool", title: "Tool source" }]);
  assert.deepEqual(events.find(event => event.type === "response.completed")?.citations, result.citations);
  assert.doesNotMatch(JSON.stringify({ result, events }), /PRIVATE|RAW EXCERPT|private-id|invented|javascript|citation-start/);
});

test("a failed Cohere stream does not publish previously observed raw citations", async () => {
  const events: any[] = [];
  const client = createPreferredOfficialModelClient({ providerId: "cohere", protocol: "cohere_chat", baseUrl: "https://api.example.test/v2", apiKey: "fixture-secret", model: "command-fixture", fetchImpl: async () => cohereStream(true) });
  await assert.rejects(client.complete({ messages: [{ role: "user", content: "question" }], tools: [], onModelEvent: event => { events.push(event); } }));
  assert.equal(events.some(event => event.type === "response.completed"), false);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE|RAW EXCERPT|example.com/);
});

test("cancelling a Cohere stream keeps raw sources private and does not retry", async () => {
  const controller = new AbortController();
  const events: any[] = [];
  let requests = 0;
  const client = createPreferredOfficialModelClient({ providerId: "cohere", protocol: "cohere_chat", baseUrl: "https://api.example.test/v2", apiKey: "fixture-secret", model: "command-fixture", fetchImpl: async () => { requests++; return cohereStream(); } });
  await assert.rejects(client.complete({ messages: [{ role: "user", content: "question" }], tools: [], signal: controller.signal,
    onTextDelta: () => { controller.abort(); }, onModelEvent: event => { events.push(event); } }));
  assert.equal(requests, 1);
  assert.equal(events.some(event => event.type === "response.completed"), false);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE|RAW EXCERPT|example.com/);
});
