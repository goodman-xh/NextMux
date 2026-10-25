import assert from "node:assert/strict";
import test from "node:test";

import {
  applyModelRequestContract,
  buildHealthProbeBody,
  BUSY_RETRY_DELAYS_SECONDS,
  BUSY_RETRY_MAX_ATTEMPTS,
  classifyHealthProbeResponse,
  CONTENT_FILTER_MESSAGES,
  contentFilterMessage,
  createInlineThinkTagSplitter,
  createOfficialModelClient,
  createPreferredOfficialModelClient,
  CREATIVITY_MODE_TEMPERATURES,
  formatModelError,
  inlineThinkTagsFor,
  isReasoningModelWithoutSamplingParameters,
  isHealthyProbePayload,
  normalizePortableHistory,
  OfficialModelError,
  previewResolvedEndpointUrl,
  resolveBusyRetryDelaySeconds,
  resolveCreativityTemperature,
  stripHistoricalReasoningArtifacts,
} from "../lib/index.js";

const SAFETY_FILTER_MESSAGE = "内容触发了平台安全过滤，请调整后重新发送";
const readTool = {
  name: "workspace.read_file",
  description: "Read a file",
  requiredPermission: "read_only" as const,
  source: "builtin" as const,
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
};

// ---------------------------------------------------------------------------
// Item 1: reasoning-aware health probe + actionable error classification
// ---------------------------------------------------------------------------

test("Cherry #1: the health probe budgets 16 tokens and asks for the lowest effort", () => {
  const body = buildHealthProbeBody({ protocol: "openai_chat_completions", model: "deepseek-reasoner", reasoningEffortSupported: true });
  assert.equal(body.max_tokens, 16);
  assert.equal(body.reasoning_effort, "low");
  const official = buildHealthProbeBody({ protocol: "openai_chat_completions", model: "o3-mini", useMaxCompletionTokens: true });
  assert.equal(official.max_completion_tokens, 16);
  assert.equal("max_tokens" in official, false);
  const anthropic = buildHealthProbeBody({ protocol: "anthropic_messages", model: "claude-sonnet-4-5" });
  assert.equal(anthropic.max_tokens, 16);
  const gemini = buildHealthProbeBody({ protocol: "gemini_generate_content", model: "gemini-2.5-pro" });
  assert.equal((gemini.generationConfig as any).maxOutputTokens, 16);
});

test("Cherry #1: a length-truncated or reasoning-only probe answer is healthy", () => {
  assert.equal(isHealthyProbePayload({ choices: [{ finish_reason: "length", message: { role: "assistant", content: "" } }] }), true);
  assert.equal(isHealthyProbePayload({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "", reasoning_content: "thinking..." } }] }), true);
  assert.equal(isHealthyProbePayload({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "OK" } }] }), true);
  assert.equal(isHealthyProbePayload({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "" }] } }] }), true);
  assert.equal(isHealthyProbePayload({ content: [{ type: "text", text: "OK" }], stop_reason: "end_turn" }), true);
  assert.equal(isHealthyProbePayload({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "" } }] }), false);
});

test("Cherry #1: probe failures classify into actionable structured codes", () => {
  for (const [status, code] of [[401, "invalid_api_key"], [403, "invalid_api_key"], [402, "insufficient_balance"],
    [404, "model_not_found"], [429, "rate_limited"], [503, "upstream_busy"]] as const) {
    const outcome = classifyHealthProbeResponse(status, { error: { message: "probe refused" } });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, code);
    assert.equal(outcome.httpStatus, status);
    assert.ok(outcome.error.kind);
  }
  const filtered = classifyHealthProbeResponse(200, { choices: [{ finish_reason: "content_filter", message: { content: "" } }] });
  assert.equal(filtered.ok, false);
  assert.equal(filtered.code, "content_filtered");
  assert.equal(formatModelError(filtered.ok ? undefined : filtered.error, "zh-CN").text, SAFETY_FILTER_MESSAGE);
  for (const blocked of [{ candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [] } }] }, { promptFeedback: { blockReason: "PROHIBITED_CONTENT" } },
    { content: [], stop_reason: "refusal" }]) assert.equal(classifyHealthProbeResponse(200, blocked).ok ? "ok" : (classifyHealthProbeResponse(200, blocked) as any).code, "content_filtered");
  const empty = classifyHealthProbeResponse(200, { choices: [{ finish_reason: "stop", message: { content: "" } }] });
  assert.equal(empty.ok, false);
  assert.equal(empty.ok ? "" : empty.code, "empty_response");
  assert.equal(classifyHealthProbeResponse(200, { choices: [{ finish_reason: "stop", message: { content: "OK" } }] }).ok, true);
  // A normal finish with nothing generated is a relay's blank 200, not a healthy model.
  assert.equal(classifyHealthProbeResponse(200, { candidates: [{ finishReason: "STOP", content: { parts: [] } }], usageMetadata: { candidatesTokenCount: 0 } }).ok, false);
  assert.equal(classifyHealthProbeResponse(200, { content: [], stop_reason: "end_turn", usage: { output_tokens: 0 } }).ok, false);
  assert.equal(classifyHealthProbeResponse(200, { content: [{ type: "thinking", thinking: "…" }], stop_reason: "end_turn" }).ok, true);
  // The provider's words decide before the status: OpenAI's 429 insufficient_quota is an empty balance.
  const quota = classifyHealthProbeResponse(429, { error: { code: "insufficient_quota", type: "insufficient_quota", message: "You exceeded your current quota" } });
  assert.equal(quota.ok ? "" : quota.code, "insufficient_balance");
});

test("Cline #15: the safety-filter wording is the exact approved sentence in every locale entry", () => {
  assert.equal(contentFilterMessage("zh-CN"), SAFETY_FILTER_MESSAGE);
  assert.equal(contentFilterMessage("zh_CN"), SAFETY_FILTER_MESSAGE);
  assert.equal(contentFilterMessage("zh-TW"), "內容觸發了平台安全過濾，請調整後重新傳送");
  assert.equal(contentFilterMessage("en"), "The response was blocked by the platform content safety filter. Adjust it and send again.");
  assert.equal(contentFilterMessage("de-DE"), contentFilterMessage("de"));
});

// ---------------------------------------------------------------------------
// Item 6: stepped busy/rate-limit retry schedule (30 -> 60 -> 60 -> 120)
// ---------------------------------------------------------------------------

test("LobeChat #7: the busy retry schedule is bounded at four attempts", () => {
  assert.deepEqual([...BUSY_RETRY_DELAYS_SECONDS], [30, 60, 60, 120]);
  assert.equal(BUSY_RETRY_MAX_ATTEMPTS, 4);
  assert.equal(resolveBusyRetryDelaySeconds(0), 30);
  assert.equal(resolveBusyRetryDelaySeconds(1), 60);
  assert.equal(resolveBusyRetryDelaySeconds(2), 60);
  assert.equal(resolveBusyRetryDelaySeconds(3), 120);
  assert.equal(resolveBusyRetryDelaySeconds(4), undefined);
  assert.equal(resolveBusyRetryDelaySeconds(99), undefined);
  assert.equal(resolveBusyRetryDelaySeconds(-1), undefined);
  assert.equal(resolveBusyRetryDelaySeconds(1.5), undefined);
});

// ---------------------------------------------------------------------------
// Item 3: creativity mode + reasoning-model parameter guard
// ---------------------------------------------------------------------------

test("Cherry #3: the three-state creativity mode resolves its temperature", () => {
  assert.equal(resolveCreativityTemperature("normal"), undefined);
  assert.equal(resolveCreativityTemperature(undefined), undefined);
  assert.equal(resolveCreativityTemperature("rigorous"), 0.1);
  assert.equal(resolveCreativityTemperature("creative"), 0.85);
  assert.deepEqual({ ...CREATIVITY_MODE_TEMPERATURES }, { rigorous: 0.1, creative: 0.85 });
});

test("Cherry #3: normal sends no temperature, rigorous and creative send theirs", () => {
  const contract = { protocol: "openai_chat_completions", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" };
  const normal = applyModelRequestContract({ messages: [] }, contract, { creativityMode: "normal" });
  assert.equal("temperature" in normal, false);
  const normalDropsInherited = applyModelRequestContract({ temperature: 0.6, messages: [] }, contract, { creativityMode: "normal" });
  assert.equal("temperature" in normalDropsInherited, false);
  const unset = applyModelRequestContract({ temperature: 0.6, messages: [] }, contract, {});
  assert.equal(unset.temperature, 0.6, "an unset mode never rewrites an explicit caller value");
  assert.equal(applyModelRequestContract({ messages: [] }, contract, { creativityMode: "rigorous" }).temperature, 0.1);
  assert.equal(applyModelRequestContract({ messages: [] }, contract, { creativityMode: "creative" }).temperature, 0.85);
});

test("Cherry #3: reasoning models never receive sampling parameters", () => {
  assert.equal(isReasoningModelWithoutSamplingParameters({ model: "o3-mini" }), true);
  assert.equal(isReasoningModelWithoutSamplingParameters({ model: "openai/gpt-5" }), true);
  assert.equal(isReasoningModelWithoutSamplingParameters({ model: "deepseek-reasoner" }), true);
  assert.equal(isReasoningModelWithoutSamplingParameters({ model: "deepseek-r1" }), true);
  assert.equal(isReasoningModelWithoutSamplingParameters({ model: "claude-sonnet-4-5", protocol: "anthropic_messages", reasoningEnabled: true }), true);
  assert.equal(isReasoningModelWithoutSamplingParameters({ model: "claude-sonnet-4-5", protocol: "anthropic_messages" }), false);
  assert.equal(isReasoningModelWithoutSamplingParameters({ model: "deepseek-chat" }), false);

  const official = applyModelRequestContract({
    temperature: 0.85, top_p: 0.9, top_k: 40, presence_penalty: 0.5, frequency_penalty: 0.5, max_tokens: 100, messages: [],
  }, { protocol: "openai_chat_completions", baseUrl: "https://api.openai.com/v1", model: "o3-mini" }, { creativityMode: "creative" });
  for (const key of ["temperature", "top_p", "top_k", "presence_penalty", "frequency_penalty"]) {
    assert.equal(key in official, false, `${key} is stripped for an OpenAI reasoning model`);
  }
  assert.equal(official.max_completion_tokens, 100);
  assert.equal("max_tokens" in official, false);

  const relay = applyModelRequestContract({ temperature: 0.5, max_tokens: 100, messages: [] },
    { protocol: "openai_chat_completions", baseUrl: "https://relay.example.invalid/v1", model: "o3-mini" }, {});
  assert.equal("temperature" in relay, false);
  assert.equal(relay.max_tokens, 100, "a relay keeps max_tokens; only official endpoints require max_completion_tokens");

  const deepseek = applyModelRequestContract({ temperature: 0.5, top_p: 0.9, messages: [] },
    { protocol: "openai_chat_completions", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-reasoner" }, {});
  assert.equal("temperature" in deepseek, false);
  assert.equal("top_p" in deepseek, false);

  const claudeThinking = applyModelRequestContract({ temperature: 0.4, top_k: 40, messages: [] },
    { protocol: "anthropic_messages", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5" }, { reasoningEnabled: true });
  assert.equal("temperature" in claudeThinking, false);
  assert.equal("top_k" in claudeThinking, false);

  const claudePlain = applyModelRequestContract({ temperature: 1.7, messages: [] },
    { protocol: "anthropic_messages", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5" }, {});
  assert.equal(claudePlain.temperature, 1, "Claude temperature is clamped to [0, 1]");
});

test("Cherry #3: the creativity mode reaches the OpenAI-compatible wire body", async () => {
  const bodies: any[] = [];
  const client = createOfficialModelClient({
    providerId: "deepseek", protocol: "openai_chat_completions", baseUrl: "https://api.deepseek.com/v1",
    apiKey: "synthetic-key", model: "deepseek-chat",
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } });
    },
  });
  const request = { tools: [] as const, messages: [{ role: "user" as const, content: "hi" }] };
  await client.complete({ ...request, creativityMode: "rigorous" });
  assert.equal(bodies.at(-1).temperature, 0.1);
  await client.complete({ ...request, creativityMode: "creative" });
  assert.equal(bodies.at(-1).temperature, 0.85);
  await client.complete({ ...request, creativityMode: "normal" });
  assert.equal("temperature" in bodies.at(-1), false);
  await client.complete(request);
  assert.equal("temperature" in bodies.at(-1), false, "an unset mode sends nothing");
});

// ---------------------------------------------------------------------------
// Item 2: cross-provider message history sanitization
// ---------------------------------------------------------------------------

test("Cherry #2: the reasoning an earlier answer opened with is stripped; tags inside the answer are its content", () => {
  assert.equal(stripHistoricalReasoningArtifacts("<think>hidden chain</think>\n\nvisible answer"), "visible answer");
  assert.equal(stripHistoricalReasoningArtifacts("  <THINKING>hidden</thinking>visible"), "visible");
  assert.equal(stripHistoricalReasoningArtifacts("<redacted_reasoning>secret</redacted_reasoning>\n\n\n\nb"), "b");
  assert.equal(stripHistoricalReasoningArtifacts("<think>unclosed interrupted turn"), "");
  assert.equal(stripHistoricalReasoningArtifacts("plain answer"), "plain answer");
  // An answer that quotes or writes the tags keeps them: the next model must see the code it wrote.
  for (const answer of ["visible answer\n\n<think>quoted</think>", "Wrap it as `<think>…</think>`.", "```xml\n<think>example</think>\n```", "<thought>a heading the user asked for</thought> then text"]) {
    assert.equal(stripHistoricalReasoningArtifacts(answer), answer);
  }
});

test("the live splitter holds a tag split across chunks, ends an unclosed block at flush, and leaves later tags alone", () => {
  const split = (chunks: readonly string[], tags?: readonly string[]) => {
    const splitter = createInlineThinkTagSplitter(tags);
    const parts = [...chunks.map(chunk => splitter.push(chunk)), splitter.flush()];
    return { reasoning: parts.map(part => part.reasoning).join(""), content: parts.map(part => part.content).join("") };
  };
  assert.deepEqual(split(["<thi", "nk>plan", "</thi", "nk>\n\nAnswer"]), { reasoning: "plan", content: "Answer" });
  assert.deepEqual(split(["<think>cut off mid-thought"]), { reasoning: "cut off mid-thought", content: "" });
  assert.deepEqual(split(["Here:\n```\n<think>x</think>\n```"]), { reasoning: "", content: "Here:\n```\n<think>x</think>\n```" });
  assert.deepEqual(split(["<thought>summary</thought>Answer"]), { reasoning: "", content: "<thought>summary</thought>Answer" }, "only Gemini uses <thought>");
  assert.deepEqual(split(["<thou", "ght>summary</thought>Answer"], inlineThinkTagsFor("google/gemini-2.5-pro")), { reasoning: "summary", content: "Answer" });
});

test("Cherry #2: normalizePortableHistory strips reasoning and synthesizes interrupted tool results", () => {
  const messages = [
    { role: "user" as const, content: "read a.ts" },
    { role: "assistant" as const, content: "<think>planning...</think>\n\nworking", toolCalls: [{ id: "call_1", name: "workspace.read_file", arguments: { path: "a.ts" } }] },
    { role: "user" as const, content: "continue" },
  ];
  const normalized = normalizePortableHistory(messages);
  const assistant = normalized.find(message => message.role === "assistant")!;
  assert.equal(assistant.content, "working");
  const toolResults = normalized.filter(message => message.role === "tool");
  assert.equal(toolResults.length, 1, "the aborted tool call gets a synthesized result");
  assert.equal(toolResults[0]!.toolCallId, "call_1");
  assert.match(toolResults[0]!.content, /INTERRUPTED/);
});

test("Cherry #2: the OpenAI-compatible wire body never carries reasoning blocks or orphan tool calls", async () => {
  const bodies: any[] = [];
  const client = createOfficialModelClient({
    providerId: "deepseek", protocol: "openai_chat_completions", baseUrl: "https://api.deepseek.com/v1",
    apiKey: "synthetic-key", model: "deepseek-chat",
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } });
    },
  });
  await client.complete({ tools: [readTool], messages: [
    { role: "user", content: "read a.ts" },
    { role: "assistant", content: "<think>hidden plan</think>\n\nvisible", toolCalls: [{ id: "call_1", name: "workspace.read_file", arguments: { path: "a.ts" } }] },
    { role: "user", content: "and b.ts" },
  ] });
  const wire = bodies.at(-1).messages;
  assert.equal(JSON.stringify(wire).includes("hidden plan"), false);
  const assistant = wire.find((message: any) => message.role === "assistant");
  assert.equal(assistant.content, "visible");
  const tool = wire.find((message: any) => message.role === "tool");
  assert.equal(tool.tool_call_id, "call_1");
  assert.match(tool.content, /INTERRUPTED/);
});

// ---------------------------------------------------------------------------
// Item 5: endpoint URL preview helper
// ---------------------------------------------------------------------------

test("Cherry #10: endpoint preview resolves version paths and honours the trailing # pin", () => {
  const bare = previewResolvedEndpointUrl("https://api.example.com");
  assert.equal(bare.baseUrl, "https://api.example.com/v1");
  assert.equal(bare.chatUrl, "https://api.example.com/v1/chat/completions");
  assert.equal(bare.modelsUrl, "https://api.example.com/v1/models");

  const pinned = previewResolvedEndpointUrl("https://relay.example.com#");
  assert.equal(pinned.baseUrl, "https://relay.example.com", "a trailing # forces the exact raw URL");
  assert.equal(pinned.chatUrl, "https://relay.example.com/chat/completions");
  assert.equal(pinned.modelsUrl, "https://relay.example.com/models");

  const versioned = previewResolvedEndpointUrl("https://api.example.com/v1/");
  assert.equal(versioned.baseUrl, "https://api.example.com/v1");

  const pasted = previewResolvedEndpointUrl("https://api.example.com/v1/chat/completions");
  assert.equal(pasted.baseUrl, "https://api.example.com/v1");
  assert.equal(pasted.chatUrl, "https://api.example.com/v1/chat/completions");

  const anthropic = previewResolvedEndpointUrl("https://api.anthropic.com", "anthropic_messages");
  assert.equal(anthropic.baseUrl, "https://api.anthropic.com/v1");
  assert.equal(anthropic.chatUrl, "https://api.anthropic.com/v1/messages");

  const gemini = previewResolvedEndpointUrl("https://generativelanguage.googleapis.com", "gemini_generate_content");
  assert.equal(gemini.baseUrl, "https://generativelanguage.googleapis.com/v1beta");
  assert.equal(gemini.modelsUrl, "https://generativelanguage.googleapis.com/v1beta/models");

  const broken = previewResolvedEndpointUrl("not-a-url");
  assert.equal(broken.baseUrl, "not-a-url");

  // The preview is the transports' own resolution: a local server and a built-in provider keep their paths.
  assert.equal(previewResolvedEndpointUrl("http://192.168.1.20:8000").baseUrl, "http://192.168.1.20:8000");
  assert.equal(previewResolvedEndpointUrl("https://api.deepseek.com", "openai_chat_completions", "deepseek").chatUrl, "https://api.deepseek.com/chat/completions");
  assert.equal(previewResolvedEndpointUrl("https://relay.example.com/v1/chat/completions#").chatUrl, "https://relay.example.com/v1/chat/completions");
  // Settings name formats both ways.
  assert.equal(previewResolvedEndpointUrl("https://api.example.com", "openai").chatUrl, "https://api.example.com/v1/chat/completions");
  assert.equal(previewResolvedEndpointUrl("https://api.example.com", "anthropic").chatUrl, "https://api.example.com/v1/messages");
});

test("Cherry #10: a trailing # really pins the API root the request is sent to", async () => {
  for (const preferred of [false, true]) {
    const urls: string[] = [];
    const options: Parameters<typeof createOfficialModelClient>[0] = { providerId: "custom_openai", protocol: "openai_chat_completions", baseUrl: "https://relay.example.com#",
      apiKey: "synthetic-key", model: "relay-model",
      fetchImpl: async (url, init) => {
        urls.push(String(url instanceof Request ? url.url : url));
        if (JSON.parse(String(init?.body ?? "{}")).stream === true) {
          const frames = [{ id: "x", object: "chat.completion.chunk", created: 1, model: "relay-model", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] },
            { id: "x", object: "chat.completion.chunk", created: 1, model: "relay-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }];
          return new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
        }
        return Response.json({ id: "x", object: "chat.completion", created: 1, model: "relay-model",
          choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      } };
    const client = preferred ? createPreferredOfficialModelClient(options) : createOfficialModelClient(options);
    await client.complete({ tools: [], messages: [{ role: "user", content: "hi" }] });
    assert.equal(urls.at(-1), previewResolvedEndpointUrl("https://relay.example.com#").chatUrl, preferred ? "SDK transport" : "legacy transport");
    assert.equal(urls.at(-1), "https://relay.example.com/chat/completions");
  }
});

// ---------------------------------------------------------------------------
// Item 4: HTTP 200 in-stream error detection
// ---------------------------------------------------------------------------

test("Cherry #4: an HTTP 200 content-filter finish throws the exact safety message", async () => {
  const client = createOfficialModelClient({
    providerId: "deepseek", protocol: "openai_chat_completions", baseUrl: "https://api.deepseek.com/v1",
    apiKey: "synthetic-key", model: "deepseek-chat",
    fetchImpl: async () => Response.json({
      choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "content_filter" }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    }),
  });
  await assert.rejects(client.complete({ tools: [], messages: [{ role: "user", content: "hi" }] }), (error: any) => {
    assert.equal(error instanceof OfficialModelError, true);
    assert.equal(error.code, "CONTENT_FILTER");
    assert.equal(error.readableError.kind, "content_refused");
    assert.equal(formatModelError(error, "zh-CN").text, SAFETY_FILTER_MESSAGE, "what the reader sees is the approved sentence");
    assert.equal(formatModelError(error, "en").text, CONTENT_FILTER_MESSAGES.en);
    assert.equal(error.usage?.inputTokens, 3, "the usage the provider reported is kept");
    assert.equal(error.retryable, false, "a safety block never offers a paid retry");
    return true;
  });
});

test("Cherry #4: an HTTP 200 stream that finishes with zero output is a typed failure", async () => {
  const client = createOfficialModelClient({
    providerId: "deepseek", protocol: "openai_chat_completions", baseUrl: "https://api.deepseek.com/v1",
    apiKey: "synthetic-key", model: "deepseek-chat",
    fetchImpl: async () => Response.json({
      choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    }),
  });
  await assert.rejects(client.complete({ tools: [], messages: [{ role: "user", content: "hi" }] }), (error: any) => {
    assert.equal(error.code, "EMPTY_RESPONSE");
    assert.equal(error.readableError.kind, "invalid_response");
    assert.equal(error.usage?.outputTokens, 1, "observed usage survives the failure");
    return true;
  });
});

test("Cherry #4: a reasoning-only HTTP 200 answer is a success, not an empty response", async () => {
  const client = createOfficialModelClient({
    providerId: "deepseek", protocol: "openai_chat_completions", baseUrl: "https://api.deepseek.com/v1",
    apiKey: "synthetic-key", model: "deepseek-reasoner",
    fetchImpl: async () => Response.json({
      choices: [{ index: 0, message: { role: "assistant", content: "", reasoning_content: "thinking hard" }, finish_reason: "length" }],
      usage: { prompt_tokens: 3, completion_tokens: 16, total_tokens: 19 },
    }),
  });
  const turn = await client.complete({ tools: [], messages: [{ role: "user", content: "hi" }] });
  assert.equal(turn.content, "");
  assert.equal((turn.providerState as any).reasoning_content, "thinking hard");
  assert.equal(turn.finishReason, "length");
});

test("Cherry #4: an in-stream error chunk on HTTP 200 fails the SDK transport", async () => {
  const chunks = [
    { id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: "partial" }, finish_reason: null }] },
    { id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: {}, finish_reason: null }], error: { message: "upstream failed mid-stream", type: "server_error" } },
  ];
  const client = createPreferredOfficialModelClient({
    providerId: "custom_openai", protocol: "openai_chat_completions", baseUrl: "https://relay.example.invalid/v1",
    apiKey: "synthetic-key", model: "relay-model",
    fetchImpl: async () => new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } }),
  });
  await assert.rejects(client.complete({ tools: [], messages: [{ role: "user", content: "hi" }] }), (error: any) => {
    assert.equal(error.code, "REQUEST_REJECTED");
    assert.match(error.readableError.detail, /upstream failed mid-stream/);
    return true;
  });
});

test("Cherry #4: an in-stream content_filter finish fails the SDK transport with the exact message", async () => {
  const chunks = [
    { id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: "partial" }, finish_reason: null }] },
    { id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "content_filter" }] },
  ];
  const client = createPreferredOfficialModelClient({
    providerId: "custom_openai", protocol: "openai_chat_completions", baseUrl: "https://relay.example.invalid/v1",
    apiKey: "synthetic-key", model: "relay-model",
    fetchImpl: async () => new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } }),
  });
  await assert.rejects(client.complete({ tools: [], messages: [{ role: "user", content: "hi" }] }), (error: any) => {
    assert.equal(error.code, "CONTENT_FILTER");
    assert.equal(error.readableError.kind, "content_refused");
    assert.equal(formatModelError(error, "zh-CN").text, SAFETY_FILTER_MESSAGE);
    return true;
  });
});

test("Cherry #1/Claude: a 402 balance refusal is a structured, non-retryable failure", async () => {
  const client = createOfficialModelClient({
    providerId: "deepseek", protocol: "openai_chat_completions", baseUrl: "https://api.deepseek.com/v1",
    apiKey: "synthetic-key", model: "deepseek-chat",
    fetchImpl: async () => Response.json({ error: { code: "insufficient_balance", message: "Insufficient balance" } }, { status: 402 }),
  });
  await assert.rejects(client.complete({ tools: [], messages: [{ role: "user", content: "hi" }] }), (error: any) => {
    assert.equal(error.code, "BALANCE_INSUFFICIENT");
    assert.equal(error.httpStatus, 402);
    assert.equal(error.readableError.kind, "provider_quota_exhausted");
    assert.equal(error.retryable, false);
    return true;
  });
});
