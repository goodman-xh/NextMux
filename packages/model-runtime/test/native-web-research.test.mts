import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeNativeWebResearchDeclaration,
  normalizeNativeWebResearchRequest,
  buildNativeWebResearchWire,
  applyNativeWebResearchWire,
  parseNativeWebResearchEvidence,
  type NativeWebResearchProfile,
  type NativeWebResearchWire,
} from "../lib/native-web-research.js";

function declaration(profile: NativeWebResearchProfile, extra = {}) {
  return { version: 1, profile, search: "supported", fetch: "supported", source: "merchant_declaration", ...extra };
}
function wire(profile: NativeWebResearchProfile, request: unknown, extra = {}): NativeWebResearchWire {
  const result = buildNativeWebResearchWire(declaration(profile, extra), request);
  if (!result.ok) throw new Error(result.message);
  assert.equal(result.ok, true);
  return result;
}

test("saved declarations require an explicit whitelisted protocol and support evidence", () => {
  assert.equal(normalizeNativeWebResearchDeclaration({ displayName: "OpenRouter" }), undefined);
  assert.equal(normalizeNativeWebResearchDeclaration(Object.create(declaration("openrouter_server_tools"))), undefined);
  assert.equal(normalizeNativeWebResearchDeclaration(declaration("openrouter_server_tools", { endpoint: "https://relay.example" })), undefined);
  assert.equal(normalizeNativeWebResearchDeclaration(declaration("openrouter_server_tools", { version: 2 })), undefined);
  assert.equal(normalizeNativeWebResearchDeclaration(declaration("openrouter_server_tools", { zhipuSearchEngine: "search_std" })), undefined);
  assert.deepEqual(normalizeNativeWebResearchDeclaration({ ...declaration("openrouter_server_tools"), version: undefined }), undefined);
  const { version: _version, ...legacy } = declaration("openrouter_server_tools");
  assert.equal(normalizeNativeWebResearchDeclaration(legacy)?.version, 1);
  for (const support of ["unknown", "unsupported"]) {
    const result = buildNativeWebResearchWire(declaration("openrouter_server_tools", { search: support }), { search: { maxUses: 1 } });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, `capability_${support}`);
  }
});

test("request normalization rejects widening, prototype-looking extras and invalid controls", () => {
  for (const request of [
    { search: { maxUses: 0 } }, { search: { maxUses: 4 } }, { search: { maxUses: "2" } },
    { search: { maxUses: 1, maxResults: 11 } }, { search: { maxUses: 1, maxCharacters: 20001 } },
    { fetch: { maxUses: 1, maxContentTokens: 16385 } }, { fetch: { maxUses: 1, urls: ["https://a.example", "https://b.example"] } },
    { search: { maxUses: 1, allowedDomains: ["https://example.com"] } },
    { search: { maxUses: 1, unexpected: true } }, { search: { maxUses: 1 }, plugins: [{ id: "web" }] },
  ]) assert.equal(normalizeNativeWebResearchRequest(request), undefined, JSON.stringify(request));
  assert.deepEqual(normalizeNativeWebResearchRequest({ search: { maxUses: 2, allowedDomains: ["EXAMPLE.COM", "example.com"] } }),
    { search: { maxUses: 2, allowedDomains: ["example.com"] } });
});

test("OpenRouter pins multilingual server search and enforces per-tool uses without replacing client tools", () => {
  const native = wire("openrouter_server_tools", {
    search: { maxUses: 2, maxResults: 3, maxCharacters: 1500, allowedDomains: ["example.com"] },
    fetch: { maxUses: 1, maxContentTokens: 10000 },
  });
  assert.deepEqual(native.tools, [
    { type: "openrouter:web_search", parameters: { engine: "parallel", mode: "basic", max_uses: 2, max_results: 3, max_total_results: 6, max_characters: 1500, allowed_domains: ["example.com"] } },
    { type: "openrouter:web_fetch", parameters: { engine: "openrouter", max_uses: 1, max_content_tokens: 10000 } },
  ]);
  assert.equal(native.limits.search?.providerEnforced, true);
  assert.equal(native.limits.fetch?.providerEnforced, true);
  const clientTool = { type: "function", function: { name: "file_read", parameters: {} } };
  const original = { model: "relay-model", messages: [{ role: "user", content: "Research" }], tools: [clientTool], max_tool_calls: 2 };
  const body = applyNativeWebResearchWire(original, native);
  assert.equal(body.model, "relay-model");
  assert.deepEqual(body.tools, [clientTool, ...native.tools]);
  assert.equal(body.max_tool_calls, 2);
  assert.equal(original.tools.length, 1);
  assert.throws(() => applyNativeWebResearchWire({ tools: [native.tools[0]] }, native), /already present/);
});

test("OpenRouter native and auto caps are explicitly unknown and incompatible modes fail closed", () => {
  for (const engine of ["native", "auto"]) {
    const native = wire("openrouter_server_tools", { search: { maxUses: 1, maxCharacters: 1000 }, openRouter: { engine } });
    assert.equal(native.limits.search?.providerEnforced, false);
    assert.ok(native.warnings.length > 0);
    assert.equal((native.tools[0]?.parameters as Record<string, unknown>).max_characters, undefined);
  }
  const bad = buildNativeWebResearchWire(declaration("openrouter_server_tools"), { search: { maxUses: 1 }, openRouter: { engine: "exa", mode: "turbo" } });
  assert.equal(bad.ok, false);
  assert.equal(buildNativeWebResearchWire(declaration("openrouter_server_tools"), { search: { maxUses: 1, allowedDomains: ["a.example"], blockedDomains: ["b.example"] } }).ok, false);
  assert.equal(buildNativeWebResearchWire(declaration("openrouter_server_tools"), { search: { maxUses: 1, allowedDomains: ["a.example"] }, openRouter: { engine: "native" } }).ok, false);
});

test("Responses sends documented source inclusion but no invented cap or fetch descriptor", () => {
  const native = wire("openai_responses", { search: { maxUses: 2, maxResults: 3, allowedDomains: ["example.com"] } });
  assert.deepEqual(native.tools, [{ type: "web_search", filters: { allowed_domains: ["example.com"] } }]);
  assert.equal(native.limits.search?.providerEnforced, false);
  assert.equal(native.bodyFields.max_tool_calls, undefined);
  const body = applyNativeWebResearchWire({ model: "same-selected-model", include: ["reasoning.encrypted_content"] }, native);
  assert.deepEqual(body.include, ["reasoning.encrypted_content", "web_search_call.action.sources"]);
  const fetch = buildNativeWebResearchWire(declaration("openai_responses"), { fetch: { maxUses: 1 } });
  assert.equal(fetch.ok, false);
  if (!fetch.ok) assert.equal(fetch.code, "capability_unsupported");
});

test("Anthropic uses stable documented tool versions, exact uses and mutually exclusive filters", () => {
  const native = wire("anthropic_messages", { search: { maxUses: 2 }, fetch: { maxUses: 1, maxContentTokens: 1000, blockedDomains: ["example.com"] } });
  assert.deepEqual(native.tools, [
    { type: "web_search_20250305", name: "web_search", max_uses: 2 },
    { type: "web_fetch_20250910", name: "web_fetch", max_uses: 1, citations: { enabled: true }, max_content_tokens: 1000, blocked_domains: ["example.com"] },
  ]);
  assert.equal(native.limits.search?.providerEnforced, true);
  assert.equal(native.limits.fetch?.providerEnforced, true);
  assert.equal(buildNativeWebResearchWire(declaration("anthropic_messages"), { search: { maxUses: 1, allowedDomains: ["a.example"], blockedDomains: ["b.example"] } }).ok, false);
});

test("Gemini uses REST tools and never sends undocumented controls", () => {
  const native = wire("gemini_generate_content", { search: { maxUses: 2, maxResults: 3 }, fetch: { maxUses: 1, maxContentTokens: 1000 } });
  assert.deepEqual(native.tools, [{ google_search: {} }, { url_context: {} }]);
  assert.equal(native.limits.search?.providerEnforced, false);
  assert.equal(native.limits.fetch?.providerEnforced, false);
  assert.equal(buildNativeWebResearchWire(declaration("gemini_generate_content"), { search: { maxUses: 1, allowedDomains: ["example.com"] } }).ok, false);
});

test("Zhipu requires explicit engine and handles provider-specific unsupported options", () => {
  assert.equal(buildNativeWebResearchWire(declaration("zhipu_chat"), { search: { maxUses: 1 } }).ok, false);
  const native = wire("zhipu_chat", { search: { maxUses: 2, maxResults: 3, allowedDomains: ["example.com"] } }, { zhipuSearchEngine: "search_pro_jina" });
  assert.deepEqual(native.tools, [{ type: "web_search", web_search: { enable: true, search_engine: "search_pro_jina", search_result: true, count: 3, search_domain_filter: "example.com" } }]);
  assert.equal(native.limits.search?.providerEnforced, false);
  assert.equal(buildNativeWebResearchWire(declaration("zhipu_chat", { zhipuSearchEngine: "search_pro_quark" }), { search: { maxUses: 1, maxResults: 3 } }).ok, false);
  assert.equal((wire("zhipu_chat", { search: { maxUses: 1 } }, { zhipuSearchEngine: "search_pro_sogou" }).tools[0]?.web_search as Record<string, unknown>).count, 10);
});

test("reported zero is distinct from absent or invalid counters and total cost remains telemetry", () => {
  const missing = parseNativeWebResearchEvidence("openrouter_server_tools", { usage: { prompt_tokens: 10 } });
  assert.deepEqual(missing.searchUsage, { status: "missing" });
  assert.equal(missing.searchRequests, undefined);
  const zero = parseNativeWebResearchEvidence("openrouter_server_tools", { usage: { server_tool_use: { web_search_requests: 0, web_fetch_requests: 1 }, cost: "0.00012" } });
  assert.equal(zero.searchRequests, 0);
  assert.equal(zero.fetchRequests, 1);
  assert.equal(zero.searchUsage.status, "reported");
  assert.equal(zero.costUsd, "0.00012");
  for (const value of [-1, "2", null, true, 0.5]) {
    const invalid = parseNativeWebResearchEvidence("openrouter_server_tools", { usage: { server_tool_use: { web_search_requests: value } } });
    assert.equal(invalid.searchUsage.status, "invalid");
    assert.equal(invalid.searchRequests, undefined);
  }
  const conflict = parseNativeWebResearchEvidence("openrouter_server_tools", { usage: { server_tool_use: { web_search_requests: 2 }, serverToolUse: { web_search_requests: 1 } } });
  assert.equal(conflict.searchUsage.status, "invalid");
  assert.equal(conflict.searchRequests, undefined);
});

test("Responses parses paid search actions separately from page actions and citations", () => {
  const result = parseNativeWebResearchEvidence("openai_responses", { status: "completed", output: [
    { type: "web_search_call", status: "completed", action: { type: "search", queries: ["a", "b"], sources: [{ url: "https://example.com", title: "Source" }] } },
    { type: "web_search_call", status: "completed", action: { type: "open_page", url: "https://example.com/page" } },
    { type: "message", content: [{ type: "output_text", text: "Answer", annotations: [{ type: "url_citation", url: "https://example.com", title: "Source", start_index: 0, end_index: 6 }] }] },
  ] });
  assert.equal(result.text, "Answer");
  assert.deepEqual(result.queries, ["a", "b"]);
  assert.equal(result.searchRequests, 1);
  assert.equal(result.searchUsage.status, "observed");
  assert.equal(result.fetchRequests, 1);
  assert.equal(result.citations.length, 2);
  assert.deepEqual(result.observedFetchUrls, ["https://example.com/page"]);
  const partialRelay = parseNativeWebResearchEvidence("openrouter_server_tools", { status: "incomplete", output: [
    { type: "message", content: [{ type: "output_text", text: "Partial source", annotations: [{ type: "url_citation", url: "https://example.com" }] }] }
  ], usage: { server_tool_use: { web_search_requests: 1 } } });
  assert.equal(partialRelay.completed, false);
  assert.equal(partialRelay.searchRequests, 1);
  assert.equal(partialRelay.citations.length, 1);
});

test("Anthropic separates final text, source metadata and failed tool usage", () => {
  const result = parseNativeWebResearchEvidence("anthropic_messages", { stop_reason: "end_turn", usage: { server_tool_use: { web_search_requests: 1 } }, content: [
    { type: "thinking", thinking: "private reasoning" },
    { type: "server_tool_use", name: "web_search", input: { query: "current result" } },
    { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://example.com", title: "Title", encrypted_content: "opaque" }] },
    { type: "text", text: "Answer", citations: [{ type: "web_search_result_location", url: "https://example.com", title: "Title", cited_text: "Evidence" }] },
  ] });
  assert.equal(result.text, "Answer");
  assert.deepEqual(result.queries, ["current result"]);
  assert.equal(result.searchRequests, 1);
  assert.equal(JSON.stringify(result).includes("opaque"), false);
  const failure = parseNativeWebResearchEvidence("anthropic_messages", { stop_reason: "pause_turn", content: [{ type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } }] });
  assert.equal(failure.completed, false);
  assert.deepEqual(failure.toolErrors, ["max_uses_exceeded"]);
});

test("Gemini and Zhipu result/query counts do not invent billable request evidence", () => {
  const google = parseNativeWebResearchEvidence("gemini_generate_content", { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "hidden", thought: true }, { text: "Answer" }] }, groundingMetadata: { webSearchQueries: ["one", "two"], groundingChunks: [{ web: { uri: "https://example.com", title: "Source" } }], searchEntryPoint: { renderedContent: "<div>Search</div>" } }, urlContextMetadata: { urlMetadata: [{ retrievedUrl: "https://example.com/page", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" }] } }] });
  assert.equal(google.text, "Answer");
  assert.equal(google.searchRequests, undefined);
  assert.equal(google.fetchRequests, undefined);
  assert.deepEqual(google.queries, ["one", "two"]);
  assert.deepEqual(google.observedFetchUrls, ["https://example.com/page"]);
  const zhipu = parseNativeWebResearchEvidence("zhipu_chat", { choices: [{ message: { content: "Answer" }, finish_reason: "stop" }], web_search: [{ link: "https://example.com", title: "Source" }, { link: "javascript:bad", title: "Bad" }] });
  assert.equal(zhipu.citations.length, 1);
  assert.equal(zhipu.searchRequests, undefined);
});

test("OpenRouter current SDK wire reports explicit search counts independently of generic tool calls", () => {
  // Official generated ChatUsage / ServerToolUseDetails schema, commit f1097e6.
  const evidence = parseNativeWebResearchEvidence("openrouter_server_tools", {
    choices: [{ finish_reason: "stop", message: { content: "A sourced answer", annotations: [
      { type: "url_citation", url_citation: { url: "https://source.example/one" } },
      { type: "url_citation", url_citation: { url: "https://source.example/two" } },
      { type: "url_citation", url_citation: { url: "https://source.example/three" } },
    ] } }],
    usage: { cost: 0.00951594, server_tool_use_details: { web_search_requests: 1, tool_calls_requested: 17, tool_calls_executed: 11 } },
  });
  assert.deepEqual(evidence.searchUsage, { status: "reported", count: 1, source: "usage.server_tool_use_details.web_search_requests" });
  assert.equal(evidence.citations.length, 3); assert.equal(evidence.fetchUsage.status, "missing");
  const sdk = parseNativeWebResearchEvidence("openrouter_server_tools", { usage: { serverToolUseDetails: { webSearchRequests: 2 } } });
  assert.deepEqual(sdk.searchUsage, { status: "reported", count: 2, source: "usage.serverToolUseDetails.webSearchRequests" });
  const aliases = parseNativeWebResearchEvidence("openrouter_server_tools", { usage: {
    server_tool_use: { web_search_requests: 0 }, server_tool_use_details: { web_search_requests: 0 }, serverToolUseDetails: { webSearchRequests: 0 },
  } });
  assert.equal(aliases.searchUsage.status, "reported"); assert.equal(aliases.searchUsage.count, 0);
});

test("OpenRouter search count aliases cannot hide conflicting or malformed provider evidence", () => {
  for (const usage of [
    { server_tool_use: { web_search_requests: 1 }, server_tool_use_details: { web_search_requests: 2 } },
    { server_tool_use_details: { web_search_requests: 1 }, serverToolUseDetails: { web_search_requests: 1, webSearchRequests: 2 } },
    ...[-1, 1.5, "1", null].map(value => ({ server_tool_use_details: { web_search_requests: value } })),
    { server_tool_use_details: [] }, { server_tool_use_details: "1" },
  ]) {
    const evidence = parseNativeWebResearchEvidence("openrouter_server_tools", { usage });
    assert.equal(evidence.searchUsage.status, "invalid"); assert.equal(evidence.searchRequests, undefined);
    assert.ok(evidence.invalidFields.length > 0);
  }
});

test("missing OpenRouter explicit search count remains unknown despite citations, total fee and generic tool events", () => {
  for (const details of [{}, { tool_calls_requested: 3, tool_calls_executed: 3 }]) {
    const evidence = parseNativeWebResearchEvidence("openrouter_server_tools", {
      choices: [{ message: { content: "I searched", annotations: [{ url_citation: { url: "https://source.example/" } }] } }],
      usage: { cost: 0.005, server_tool_use_details: details },
    });
    assert.equal(evidence.searchUsage.status, "missing"); assert.equal(evidence.searchRequests, undefined); assert.equal(evidence.citations.length, 1);
  }
  assert.equal(parseNativeWebResearchEvidence("anthropic_messages", { usage: { server_tool_use_details: { web_search_requests: 1 } } }).searchUsage.status, "missing");
});
