import assert from "node:assert/strict";
import test from "node:test";
import { AgentRunner, AgentRunInterruptedError, AgentToolRegistry, type AgentRunEvent } from "../lib/index.js";

test("readable model evidence survives failed attempts and interruptions without enabling retries", async () => {
  const events: AgentRunEvent[] = [];
  let calls = 0;
  const readableError = {
    kind: "provider_quota_exhausted", detail: "Credit balance exhausted.", source: "own_api",
    httpStatus: 429, code: "insufficient_quota", retryAfterSeconds: 12,
    providerReason: "Monthly budget exceeded", arbitraryBody: "must not enter the event",
  };
  await assert.rejects(new AgentRunner({
    tools: new AgentToolRegistry(), permissionMode: "read_only", onEvent: event => { events.push(event); },
    model: { async complete() {
      calls += 1;
      throw Object.assign(new Error("provider failure"), {
        code: "RATE_LIMITED", httpStatus: 429, retrySafe: false, data: { readableError },
      });
    } },
  }).run({ prompt: "test failure", runId: "readable-error-retention" }), error => {
    assert.ok(error instanceof AgentRunInterruptedError);
    assert.equal(error.failure.readableError?.kind, "provider_quota_exhausted");
    assert.equal(error.failure.readableError?.detail, "Credit balance exhausted.");
    assert.equal(error.failure.readableError?.source, "own_api");
    assert.equal(error.failure.readableError?.retryAfterSeconds, 12);
    assert.equal(error.failure.retrySafe, false);
    assert.equal("arbitraryBody" in error.failure.readableError!, false);
    return true;
  });
  assert.equal(calls, 1);
  const failed = events.find(event => event.type === "model_attempt_completed" && event.outcome === "failed");
  assert.ok(failed?.type === "model_attempt_completed");
  assert.equal(failed.failure?.readableError?.code, "insufficient_quota");
  assert.equal(events.some(event => event.type === "model_retry_scheduled"), false);
});

test("a proven local zero-usage context rejection is compacted once; a per-minute token limit is not", async () => {
  const history = Array.from({ length: 24 }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `OLDER_TURN_${index}: ${"background detail ".repeat(200)}`,
  }));
  const events: AgentRunEvent[] = [];
  const sizes: number[] = [];
  const result = await new AgentRunner({
    tools: new AgentToolRegistry(), permissionMode: "read_only", onEvent: event => { events.push(event); },
    model: { async complete(request) {
      sizes.push(JSON.stringify(request.messages).length);
      if (sizes.length === 1) {
        throw Object.assign(new Error("This model's maximum context length is 32768 tokens. However, you requested 40000 tokens. Please reduce the length of the messages."), {
          code: "CONTEXT_WINDOW_EXCEEDED", retrySafe: true, usageKnown: true, usage: { inputTokens: 0, outputTokens: 0 },
          data: { readableError: { kind: "context_too_long", detail: "context_length_exceeded", source: "local_budget" } },
        });
      }
      return { content: "done" };
    } },
  }).run({ prompt: "continue the task", history, runId: "overflow-compaction" });
  assert.equal(result.status, "completed");
  assert.equal(sizes.length, 2);
  assert.ok(sizes[1]! < sizes[0]! * 0.9, `the second request is smaller: ${sizes.join(" → ")}`);
  const failed = events.find(event => event.type === "model_attempt_completed" && event.outcome === "failed");
  assert.equal(failed && "retryScheduled" in failed && failed.retryScheduled, true);
  assert.ok(events.some(event => event.type === "context_compaction_completed"));

  // Only once per model call: a second overflow is reported to the user.
  let calls = 0;
  await assert.rejects(new AgentRunner({
    tools: new AgentToolRegistry(), permissionMode: "read_only",
    model: { async complete() {
      calls += 1;
      throw Object.assign(new Error("prompt is too long: 208000 tokens > 200000 maximum"), { code: "CONTEXT_WINDOW_EXCEEDED", retrySafe: true, usageKnown: true, usage: { inputTokens: 0, outputTokens: 0 } });
    } },
  }).run({ prompt: "continue the task", history, runId: "overflow-once" }), AgentRunInterruptedError);
  assert.equal(calls, 2);

  // "input tokens per minute" is a rate limit: no compaction, the failure is reported as it is.
  calls = 0;
  const limited: AgentRunEvent[] = [];
  await assert.rejects(new AgentRunner({
    tools: new AgentToolRegistry(), permissionMode: "read_only", onEvent: event => { limited.push(event); },
    model: { async complete() {
      calls += 1;
      throw Object.assign(new Error("This request would exceed the rate limit for your organization of 40,000 input tokens per minute."), { httpStatus: 429, retrySafe: false });
    } },
  }).run({ prompt: "continue the task", history, runId: "tpm-not-overflow" }), AgentRunInterruptedError);
  assert.equal(calls, 1);
  assert.equal(limited.some(event => event.type === "context_compaction_started"), false);
});

// HTTP status and provider text do not establish pre-dispatch rejection or zero billing.
test("a provider HTTP 400 context error with unknown usage is never automatically resubmitted", async () => {
  let calls = 0;
  const events: AgentRunEvent[] = [];
  const history = Array.from({ length: 24 }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `OLDER_TURN_${index}: ${"background detail ".repeat(200)}`,
  }));
  await assert.rejects(new AgentRunner({
    tools: new AgentToolRegistry(), permissionMode: "read_only", onEvent: event => { events.push(event); },
    model: { async complete() {
      calls += 1;
      throw Object.assign(new Error("This model's maximum context length is 32768 tokens. However, you requested 40000 tokens."), {
        code: "REQUEST_REJECTED", httpStatus: 400, retrySafe: false,
        data: { readableError: { kind: "context_too_long", detail: "context_length_exceeded", httpStatus: 400 } },
      });
    } },
  }).run({ prompt: "continue the task", history, runId: "provider-context-unknown" }), error => {
    assert.ok(error instanceof AgentRunInterruptedError);
    assert.equal(error.failure.retrySafe, false);
    assert.equal(error.failure.readableError?.kind, "context_too_long");
    assert.equal(error.checkpoint.usageKnown, false);
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(events.some(event => event.type === "context_compaction_started"), false);
  assert.equal(events.some(event => event.type === "model_retry_scheduled"), false);
});

test("fake-1M relay context overflow steps down to 128K (with or without explicit limit number), compacts in-place, and reports detectedContextWindowLimit", async () => {
  const largeHistory = Array.from({ length: 24 }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `TURN_${index}: ${"detailed_context_payload ".repeat(800)}`,
  }));

  for (const errorMessage of [
    "This model's maximum context length is 128000 tokens. However, your messages resulted in 310000 tokens.",
    "invalid_request_error: prompt is too long (context_length_exceeded)",
  ]) {
    let calls = 0;
    const observedMaxOutputs: (number | undefined)[] = [];
    const result = await new AgentRunner({
      tools: new AgentToolRegistry(),
      permissionMode: "read_only",
      contextWindowTokens: 1_000_000,
      modelOutputTokenLimit: 64_000,
      model: {
        async complete(request) {
          calls += 1;
          observedMaxOutputs.push(request.maxOutputTokens);
          if (calls === 1) {
            throw Object.assign(new Error(errorMessage), {
              code: "CONTEXT_WINDOW_EXCEEDED",
              retrySafe: true,
              usageKnown: true,
              usage: { inputTokens: 0, outputTokens: 0 },
              data: { readableError: { kind: "context_too_long", detail: errorMessage, source: "relay" } },
            });
          }
          return { content: "Recovered after stepping down from fake 1M to 128K" };
        },
      },
    }).run({ prompt: "Summarize the architecture", history: largeHistory, runId: `fake-1m-recovery-${calls}` });

    assert.equal(result.status, "completed");
    assert.equal(calls, 2);
    assert.equal(result.detectedContextWindowLimit, 128_000);
    assert.ok((observedMaxOutputs[1] ?? 0) <= 32_000, `retry maxOutputTokens (${observedMaxOutputs[1]}) is clamped for 128K window`);
  }
});

test("oversized 1M-turn task anchor with huge pasted text attachment is bounded on fallback when resumed on a 32K model", async () => {
  let calls = 0;
  const hugeAttachmentText = "pasted_log_line_from_1m_turn ".repeat(3_500);
  const result = await new AgentRunner({
    tools: new AgentToolRegistry(),
    permissionMode: "read_only",
    contextWindowTokens: 32_000,
    modelOutputTokenLimit: 4_096,
    model: {
      async complete(request) {
        calls += 1;
        const totalChars = JSON.stringify(request.messages).length;
        assert.ok(totalChars < 120_000, `anchor message was bounded to fit 32K window (${totalChars} chars)`);
        return { content: "Completed on smaller 32K model" };
      },
    },
  }).run({
    prompt: "Analyze this huge log from the 1M session",
    attachments: [
      { kind: "text", name: "huge-1.log", content: hugeAttachmentText },
      { kind: "text", name: "huge-2.log", content: hugeAttachmentText },
    ],
    runId: "1m-to-32k-anchor-fallback",
  });
  assert.equal(result.status, "completed");
  assert.equal(calls, 1);
});
