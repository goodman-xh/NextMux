import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boundedRetryAfterMs,
  boundedRetryAfterSecondsMs,
  responseRetryAfterMs,
  retryAfterHeaderMs,
} from '../lib/node/nextmux-platform-service.js';

test('retry-after JSON fields keep milliseconds and seconds unambiguous', () => {
  assert.equal(boundedRetryAfterMs(2_500), 2_500);
  assert.equal(boundedRetryAfterMs('2500'), 2_500);
  assert.equal(boundedRetryAfterMs(500_001), 300_000);
  assert.equal(boundedRetryAfterSecondsMs(7), 7_000);
  assert.equal(boundedRetryAfterSecondsMs('0.5'), 500);
});

test('HTTP Retry-After accepts delta-seconds and HTTP dates', () => {
  const now = Date.parse('Wed, 02 Sep 2026 00:00:00 GMT');
  assert.equal(retryAfterHeaderMs('7', now), 7_000);
  assert.equal(retryAfterHeaderMs(new Date(now + 120_000).toUTCString(), now), 120_000);
  assert.equal(retryAfterHeaderMs('not-a-retry-after', now), undefined);
});

test('response retry metadata prefers explicit milliseconds, then JSON seconds, then header', () => {
  const now = Date.parse('Wed, 02 Sep 2026 00:00:00 GMT');
  const response = new Response('', { status: 429, headers: { 'retry-after': '9' } });

  assert.equal(responseRetryAfterMs(response, { error: { retryAfterMs: 2_500, retryAfter: 7 } }, now), 2_500);
  assert.equal(responseRetryAfterMs(response, { error: { retryAfter: 7 } }, now), 7_000);
  assert.equal(responseRetryAfterMs(response, {}, now), 9_000);
});
