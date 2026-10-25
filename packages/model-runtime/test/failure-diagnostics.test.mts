import assert from "node:assert/strict";
import test from "node:test";
import { AgentRunner, AgentToolRegistry, inspectModelErrorDiagnostic, normalizeModelErrorDiagnostic, type AgentRunEvent } from "@nextmux/agent-runtime";
import { createPreferredOfficialModelClient, normalizeOfficialModelError, OfficialModelError } from "../lib/index.js";

// Presentation details intentionally retain redacted provider prose. The original
// transport/diagnostic contract remains structural and excludes raw body text.
const transportJson = (value: unknown): string => JSON.stringify(value, (key, value) => key === 'readableError' ? undefined : value);

test("unknown errors retain bounded non-enumerable cause evidence without changing the verdict", () => {
  const cause = Object.assign(new Error("PRIVATE cause body"), { name: "AI_APICallError" });
  const error = new Error("Authorization: Bearer PRIVATE", { cause });
  assert.equal(Object.keys(error).includes("cause"), false);
  const failure = normalizeOfficialModelError(error, { attemptId: "attempt-safe", diagnosticSource: "adapter_exception" });
  assert.equal(failure.code, "MODEL_CALL_FAILED");
  assert.equal(failure.stage, "unknown");
  assert.equal(failure.category, "unknown");
  assert.equal(failure.retryable, false);
  assert.equal(failure.retrySafe, false);
  assert.deepEqual(failure.diagnostic, { kind: "error", source: "adapter_exception", names: ["Error", "AI_APICallError"] });
  assert.doesNotMatch(transportJson(failure), /PRIVATE|Authorization|Bearer/);
  assert.match(failure.readableError.detail, /PRIVATE cause body/);
  assert.doesNotMatch(failure.readableError.detail, /Bearer PRIVATE/);
  assert.deepEqual(normalizeOfficialModelError(failure, { attemptId: "ignored" }).diagnostic, failure.diagnostic);
});

test("diagnostic values are finite enums, including circular causes and primitive thrown values", () => {
  const error = Object.assign(new Error("PRIVATE"), { name: "PRIVATE_NAME", code: "PRIVATE_CODE", type: "PRIVATE_TYPE" });
  Object.defineProperty(error, "cause", { value: error });
  assert.deepEqual(inspectModelErrorDiagnostic(error), { kind: "error", names: ["OtherError"] });
  for (const [value, kind] of [[null, "null"], [undefined, "undefined"], ["PRIVATE", "string"], [42, "number"], [false, "boolean"], [[], "array"], [Symbol("PRIVATE"), "symbol"], [1n, "bigint"]] as const) {
    assert.deepEqual(inspectModelErrorDiagnostic(value), { kind });
  }
  assert.deepEqual(normalizeModelErrorDiagnostic({ kind: "object", source: "PRIVATE", names: ["Error", "PRIVATE"],
    streamCode: "PRIVATE", streamType: "PRIVATE", providerErrorType: "PRIVATE", message: "PRIVATE", responseBody: "PRIVATE" }), { kind: "object", names: ["Error"] });
  assert.equal(normalizeModelErrorDiagnostic({ kind: "PRIVATE" }), undefined);
  assert.deepEqual(inspectModelErrorDiagnostic({ type: 'error', code: 'PRIVATE', message: 'PRIVATE' }), { kind: 'object', streamType: 'error' });
});

for (const message of ["Upstream service temporarily unavailable", "PRIVATE Authorization: Bearer PRIVATE_KEY https://private.invalid/request"]) {
  test(`actual Compatible SDK inner upstream_error keeps a fixed public reason (${message.startsWith('PRIVATE') ? 'secret fixture' : 'observed shape'})`, async () => {
    const events: any[] = [];
    const agentEvents: AgentRunEvent[] = [];
    let calls = 0;
    const client = createPreferredOfficialModelClient({
      providerId: "custom_openai", protocol: "openai_chat_completions", baseUrl: "https://example.invalid/v1", apiKey: "PRIVATE_KEY", model: "fixture-model",
      fetchImpl: async () => {
        calls += 1;
        // The actual private replay returned one HTTP 200 SSE error frame,
        // with no code, choices, content, tool calls, finish marker or [DONE].
        return new Response(`data: ${JSON.stringify({ error: { message, type: "upstream_error" } })}\n\n`, {
          status: 200, headers: { "content-type": "text/event-stream" },
        });
      },
    });
    await assert.rejects(new AgentRunner({
      // The run fails before any output; binary parts are converted to assets by the desktop host, not here.
      model: { complete: async request => ({ ...(await client.complete({ ...request, onModelEvent: event => { events.push(event); } })), outputParts: undefined }) },
      tools: new AgentToolRegistry(), permissionMode: "read_only", onEvent: event => { agentEvents.push(event); },
    }).run({ prompt: "fixture", runId: "run-compatible-upstream-fixture" }), (error: unknown) => {
      // AgentRunner reports its public failure receipt, not the raw provider message.
      assert.ok(error instanceof Error);
      return true;
    });
    const failure = agentEvents.find(event => event.type === "model_attempt_completed" && event.outcome === "failed");
    assert.ok(failure?.type === "model_attempt_completed");
    assert.equal(failure.failure?.code, "MODEL_CALL_FAILED");
    assert.equal(failure.failure?.reason, "The upstream service returned an error; the request did not complete");
    assert.equal(failure.failure?.stage, "unknown"); assert.equal(failure.failure?.category, "unknown");
    assert.equal(failure.failure?.httpStatus, undefined); assert.equal(failure.failure?.providerCode, undefined);
    assert.equal(failure.failure?.retryable, false); assert.equal(failure.failure?.retrySafe, false); assert.equal(failure.retryScheduled, false);
    assert.deepEqual(failure.failure?.diagnostic, { kind: "object", source: "sdk_stream_error", providerErrorType: "upstream_error" });
    assert.deepEqual(events.find(event => event.type === "response.failed")?.error.diagnostic, failure.failure?.diagnostic);
    assert.equal(calls, 1);
    assert.equal(agentEvents.some(event => event.type === "tool_started" || event.type === "model_retry_scheduled" || event.type === "assistant_delta"), false);
    assert.equal(events.some(event => event.type === "response.completed" || event.type.startsWith("tool_call.") || event.type === "content.delta"), false);
    assert.doesNotMatch(transportJson({ events, agentEvents }), /PRIVATE|Authorization|Bearer|private\.invalid|Upstream service temporarily unavailable/);
    assert.doesNotMatch(JSON.stringify({ events, agentEvents }), /PRIVATE_KEY/);
    assert.ok(failure.failure?.readableError?.detail);
  });
}

test("provider type cannot be inferred from free message text or an unknown type", () => {
  for (const value of [
    { message: "Upstream service temporarily unavailable" },
    { type: "PRIVATE_UNKNOWN", message: "Upstream service temporarily unavailable" },
    { type: "upstream_error PRIVATE_KEY", message: "PRIVATE" },
  ]) {
    const failure = normalizeOfficialModelError(value, { diagnosticSource: "sdk_stream_error" });
    assert.equal(failure.code, "MODEL_CALL_FAILED"); assert.equal(failure.category, "unknown");
    assert.equal(failure.publicMessage, "Model request failed"); assert.equal(failure.diagnostic?.providerErrorType, undefined);
    assert.equal(failure.retryable, false); assert.equal(failure.retrySafe, false); assert.equal(failure.httpStatus, undefined);
    assert.doesNotMatch(transportJson(failure), /PRIVATE|Upstream service/);
  }
  const outsideStream = normalizeOfficialModelError({ type: "upstream_error", message: "PRIVATE" }, { diagnosticSource: "adapter_exception" });
  assert.equal(outsideStream.publicMessage, "Model request failed");
  assert.equal(outsideStream.diagnostic?.providerErrorType, "upstream_error");
});

test("inner provider type survives SDK envelopes and non-enumerable causes separately from event type", () => {
  const error = new Error("PRIVATE", { cause: { data: { type: "response.failed", response: { error: { type: "upstream_error", message: "PRIVATE" } } } } });
  assert.deepEqual(inspectModelErrorDiagnostic(error, "sdk_stream_error"), {
    kind: "error", source: "sdk_stream_error", names: ["Error"], streamType: "response.failed", providerErrorType: "upstream_error",
  });
});

test("SDK early typed stream errors keep their existing classification and enum frame evidence", async () => {
  let calls = 0;
  const client = createPreferredOfficialModelClient({
    providerId: "openai", protocol: "openai_responses", baseUrl: "https://example.invalid/v1", apiKey: "PRIVATE_KEY", model: "fixture-model",
    fetchImpl: async () => {
      calls += 1;
      const chunk = { type: "response.failed", sequence_number: 1, response: { error: { code: "server_error", message: "PRIVATE body" }, usage: null, incomplete_details: null, service_tier: null } };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    },
  });
  await assert.rejects(client.complete({ messages: [{ role: "user", content: "fixture" }], tools: [] }), (error: unknown) => {
    assert.ok(error instanceof OfficialModelError);
    // These are the pre-existing SDK/normalizer decisions, not decisions
    // inferred from the new diagnostic fields.
    assert.equal(error.code, "UPSTREAM_UNAVAILABLE");
    assert.equal(error.retryable, true);
    assert.equal(error.retrySafe, false);
    assert.deepEqual(error.diagnostic, { kind: "error", source: "sdk_stream_error", names: ["AI_APICallError"], streamType: "response.failed", streamCode: "server_error" });
    assert.doesNotMatch(transportJson(error), /PRIVATE/);
    return true;
  });
  assert.equal(calls, 1);
});

for (const streamType of ["response.failed", "error"] as const) test(`actual Responses SDK accepted ${streamType} retains only enum evidence and never retries`, async () => {
  const events: any[] = [];
  let calls = 0;
  const client = createPreferredOfficialModelClient({
    providerId: "openai", protocol: "openai_responses", baseUrl: "https://example.invalid/v1", apiKey: "PRIVATE_KEY", model: "fixture-model",
    fetchImpl: async () => {
      calls += 1;
      const chunk = streamType === "response.failed"
        ? { type: streamType, sequence_number: 1, response: { error: { code: "server_error", message: "PRIVATE body" }, usage: null, incomplete_details: null, service_tier: null } }
        : { type: streamType, sequence_number: 1, code: "server_error", message: "PRIVATE body", param: null };
      // The SDK converts early failures to APICallError. Once output-item
      // metadata arrives, later failures retain the structured frame even
      // when no assistant text or tool call has been produced.
      const accepted = { type: "response.in_progress", response: { id: "resp-fixture", created_at: 1, model: "fixture-model" } };
      const firstItem = { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg-fixture" } };
      return new Response([accepted, firstItem, chunk].map(value => `data: ${JSON.stringify(value)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    },
  });
  await assert.rejects(client.complete({ messages: [{ role: "user", content: "fixture" }], tools: [], onModelEvent: event => { events.push(event); } }), (error: unknown) => {
    assert.ok(error instanceof OfficialModelError);
    assert.equal(error.code, "MODEL_CALL_FAILED");
    assert.equal(error.stage, "unknown");
    assert.equal(error.category, "unknown");
    assert.equal(error.retryable, false);
    assert.equal(error.retrySafe, false);
    assert.equal(error.httpStatus, undefined, "a fixture HTTP 200 must not become an invented failure status");
    assert.deepEqual(error.diagnostic, { kind: "object", source: "sdk_stream_error", streamType, streamCode: "server_error" });
    assert.deepEqual(events.find(event => event.type === "response.failed")?.error.diagnostic, error.diagnostic);
    assert.doesNotMatch(transportJson(error.toJSON()), /PRIVATE/);
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(events.some(event => event.type.startsWith("tool_call.") || event.type === "content.delta" || event.type === "response.completed"), false);
  assert.doesNotMatch(transportJson(events), /PRIVATE/);
});

test("agent failure receipt preserves diagnostic enums and correlation without authorizing a retry", async () => {
  const events: AgentRunEvent[] = [];
  let calls = 0;
  const diagnostic = { kind: "object", source: "sdk_stream_error", streamType: "response.failed", streamCode: "server_error" } as const;
  await assert.rejects(new AgentRunner({
    model: { async complete() {
      calls += 1;
      throw new OfficialModelError("MODEL_CALL_FAILED", "Model request failed", { attemptId: "attempt-safe", diagnostic });
    } },
    tools: new AgentToolRegistry(), permissionMode: "read_only", onEvent: event => { events.push(event); },
  }).run({ prompt: "fixture", runId: "run-diagnostic-fixture" }));
  const event = events.find(event => event.type === "model_attempt_completed" && event.outcome === "failed");
  assert.ok(event?.type === "model_attempt_completed");
  assert.deepEqual(event.failure?.diagnostic, diagnostic);
  assert.equal(event.failure?.providerAttemptId, "attempt-safe");
  assert.equal(event.failure?.category, "unknown");
  assert.equal(event.retryScheduled, false);
  assert.equal(calls, 1);
  assert.equal(events.some(event => event.type === "tool_started" || event.type === "model_retry_scheduled"), false);
});
