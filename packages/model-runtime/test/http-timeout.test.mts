import assert from "node:assert/strict";
import test from "node:test";
import { timeoutMs } from "../lib/http.js";

test("unbounded model runs opt out of the transport timer", () => {
  assert.equal(timeoutMs(0), 0);
  assert.equal(timeoutMs(Number.POSITIVE_INFINITY), 0);
});

test("invalid or omitted probe timeouts keep the bounded default", () => {
  assert.equal(timeoutMs(undefined), 120_000);
  assert.equal(timeoutMs(Number.NaN), 120_000);
  assert.equal(timeoutMs(999), 120_000);
});

test("valid finite timeout values are preserved without a 72-hour cap", () => {
  assert.equal(timeoutMs(1_000), 1_000);
  assert.equal(timeoutMs(7 * 24 * 60 * 60 * 1_000), 7 * 24 * 60 * 60 * 1_000);
});
