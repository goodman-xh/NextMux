import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeOfficialModelError,
  OfficialModelError,
  postJson,
} from "../lib/index.js";

test("HTTP failures retain safe diagnostics without leaking the response body", async () => {
  const fetchImpl: typeof fetch = async () => Response.json({
    error: {
      code: "insufficient_quota",
      message: "Authorization: Bearer secret-token-value",
      request_body: "must-not-surface",
    },
  }, {
    status: 429,
    headers: { "x-request-id": "req_123.safe" },
  });

  await assert.rejects(postJson({
    endpoint: new URL("https://example.invalid/v1/responses"),
    headers: { authorization: "Bearer hidden" },
    body: { prompt: "safe" },
    timeoutMs: 1_000,
    fetchImpl,
  }), error => {
    assert.equal(error instanceof OfficialModelError, true);
    const failure = error as OfficialModelError;
    assert.equal(failure.code, "RATE_LIMITED");
    assert.equal(failure.stage, "response");
    assert.equal(failure.category, "rate_limit");
    assert.equal(failure.httpStatus, 429);
    assert.equal(failure.requestId, "req_123.safe");
    assert.equal(failure.providerCode, "insufficient_quota");
    assert.equal(failure.retryable, true);
    assert.equal(failure.retrySafe, false);
    assert.doesNotMatch(JSON.stringify(failure), /secret-token-value|must-not-surface|Bearer hidden/i);
    return true;
  });
});

test("an explicit zero HTTP timeout leaves the provider stream under caller cancellation", async () => {
  const startedAt = Date.now();
  const response = await postJson({
    endpoint: new URL("https://example.invalid/v1/responses"),
    headers: {},
    body: { prompt: "long-running" },
    timeoutMs: 0,
    fetchImpl: async () => {
      await new Promise(resolve => setTimeout(resolve, 40));
      return Response.json({ ok: true });
    },
  });

  assert.deepEqual(response, { ok: true });
  assert.ok(Date.now() - startedAt >= 30);
});

test("HTTP retry hints are normalized to bounded milliseconds without confusing units", async () => {
  const fetchImpl: typeof fetch = async () => Response.json({
    error: {
      code: "rate_limit",
      retry_after_ms: 1_234,
      retry_after: 99,
    },
  }, {
    status: 429,
    headers: { "retry-after": "7" },
  });

  await assert.rejects(postJson({
    endpoint: new URL("https://example.invalid/v1/responses"),
    headers: { authorization: "Bearer hidden" },
    body: { prompt: "safe" },
    timeoutMs: 1_000,
    fetchImpl,
  }), error => {
    assert.equal(error instanceof OfficialModelError, true);
    assert.equal((error as OfficialModelError).retryAfterMs, 1_234);
    return true;
  });
});

test("HTTP Retry-After seconds are converted to milliseconds and capped", async () => {
  const fetchImpl: typeof fetch = async () => Response.json({ error: { code: "busy" } }, {
    status: 429,
    headers: { "Retry-After": "999999" },
  });

  await assert.rejects(postJson({
    endpoint: new URL("https://example.invalid/v1/responses"),
    headers: {},
    body: { prompt: "safe" },
    timeoutMs: 1_000,
    fetchImpl,
  }), error => {
    assert.equal(error instanceof OfficialModelError, true);
    assert.equal((error as OfficialModelError).retryAfterMs, 300_000);
    return true;
  });
});

test("SDK retry wrappers expose a raw 429 as a resumable rate-limit failure", () => {
  const failure = normalizeOfficialModelError(new Error(
    "exceeded retry limit, last status: 429 Too Many Requests, request id: b59c22f7-2bb6-4e1e-bbed-5efd738cbf20; retry-after: 2 seconds",
  ));

  assert.equal(failure.code, "RATE_LIMITED");
  assert.equal(failure.category, "rate_limit");
  assert.equal(failure.httpStatus, 429);
  assert.equal(failure.retryAfterMs, 2_000);
  assert.equal(failure.requestId, "b59c22f7-2bb6-4e1e-bbed-5efd738cbf20");
  assert.equal(failure.retryable, true);
  assert.equal(failure.retrySafe, false);
  assert.equal(failure.publicMessage, "The model service is rate limited or the account balance is insufficient");
});

test("an unrelated retry limit is not silently classified as provider rate limiting", () => {
  const failure = normalizeOfficialModelError(new Error("exceeded retry limit while parsing a local workflow"));
  assert.equal(failure.code, "MODEL_CALL_FAILED");
  assert.equal(failure.category, "unknown");
  assert.equal(failure.httpStatus, undefined);
});

test("nested network failures keep the transport code and are not mislabeled as generic connection errors", () => {
  const failure = normalizeOfficialModelError(new TypeError("fetch failed", {
    cause: Object.assign(new Error("socket unavailable"), { code: "ECONNREFUSED" }),
  }));
  assert.equal(failure.code, "ECONNREFUSED");
  assert.equal(failure.stage, "connection");
  assert.equal(failure.category, "network");
  assert.equal(failure.networkCode, "ECONNREFUSED");
  assert.equal(failure.retryable, true);
  assert.equal(failure.retrySafe, false);
  assert.equal(failure.publicMessage, "Unable to connect to the model service");
});

test("custom API socket and fetch failures never claim to come from the official provider", () => {
  for (const code of ["UND_ERR_SOCKET", undefined]) {
    const error = new TypeError("fetch failed", code ? { cause: Object.assign(new Error("socket closed"), { code }) } : undefined);
    const failure = normalizeOfficialModelError(error);
    assert.equal(failure.code, code ?? "NETWORK_ERROR");
    assert.equal(failure.publicMessage, "Unable to connect to the model service");
    assert.equal(failure.retryable, true);
    assert.equal(failure.retrySafe, false, "wording must not change whether a request may be replayed");
  }
});

test("provider and decode failures remain distinguishable across adapters", () => {
  const decode = normalizeOfficialModelError(Object.assign(new Error("invalid json"), {
    name: "JSONParseError",
    requestId: "request-abc",
    providerCode: "malformed_stream",
  }));
  assert.equal(decode.code, "INVALID_RESPONSE");
  assert.equal(decode.stage, "decode");
  assert.equal(decode.category, "invalid_response");
  assert.equal(decode.requestId, "request-abc");
  assert.equal(decode.providerCode, "malformed_stream");
});

test("cancellation remains separate from timeout", () => {
  const controller = new AbortController();
  controller.abort();
  const cancelled = normalizeOfficialModelError(new DOMException("aborted", "AbortError"), {
    signal: controller.signal,
  });
  assert.equal(cancelled.code, "CANCELLED");
  assert.equal(cancelled.stage, "cancelled");
  assert.equal(cancelled.category, "cancelled");
  assert.equal(cancelled.retryable, false);
});

test("an internal timeout wins over the AbortError used to stop the transport", () => {
  const timedOut = normalizeOfficialModelError(new DOMException("aborted", "AbortError"), {
    timedOut: true,
  });
  assert.equal(timedOut.code, "TIMEOUT");
  assert.equal(timedOut.stage, "connection");
  assert.equal(timedOut.category, "timeout");
  assert.equal(timedOut.retryable, true);
});

test("a pre-cancelled legacy request never reaches the network", async () => {
  const controller = new AbortController();
  controller.abort();
  let requests = 0;

  await assert.rejects(postJson({
    endpoint: new URL("https://example.invalid/v1/messages"),
    headers: { authorization: "Bearer hidden" },
    body: { prompt: "safe" },
    signal: controller.signal,
    timeoutMs: 1_000,
    fetchImpl: async () => {
      requests += 1;
      return Response.json({});
    },
  }), error => error instanceof OfficialModelError && error.code === "CANCELLED");

  assert.equal(requests, 0);
});
