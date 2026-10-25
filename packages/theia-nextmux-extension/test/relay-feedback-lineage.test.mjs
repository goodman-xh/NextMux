import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canRateRelayReply,
  normalizeRelayFeedbackRequestIds,
  RELAY_FEEDBACK_MAX_REQUEST_IDS,
} from '../lib/common/nextmux-relay-feedback.js';

test('relay feedback lineage merges legacy and current IDs in stable first-use order', () => {
  assert.deepEqual(normalizeRelayFeedbackRequestIds(
    ['request-1', 'request-2', 'request-1'],
    'request-3',
    ['request-2', 'request-4'],
  ), ['request-1', 'request-2', 'request-3', 'request-4']);
});

test('relay feedback lineage rejects unsafe IDs and stays within the reply turn limit', () => {
  const candidates = Array.from({ length: RELAY_FEEDBACK_MAX_REQUEST_IDS + 2 }, (_, index) => `request-${index}`);
  const normalized = normalizeRelayFeedbackRequestIds(
    candidates,
    'contains whitespace',
    '../path',
    `request-${'x'.repeat(128)}`,
    'line\nbreak',
  );

  assert.equal(normalized.length, RELAY_FEEDBACK_MAX_REQUEST_IDS);
  assert.equal(normalized[0], 'request-0');
  assert.equal(normalized.at(-1), `request-${RELAY_FEEDBACK_MAX_REQUEST_IDS - 1}`);
  assert.equal(normalized.some(id => /[\s/]/.test(id)), false);
});

test('settled managed replies (complete, paused, cancelled, error) can contribute merchant ratings', () => {
  for (const stage of ['complete', 'paused', 'cancelled', 'error']) {
    assert.equal(canRateRelayReply(stage, ['request-1', 'request-2']), true, stage);
  }
  for (const stage of ['idle', 'running']) {
    assert.equal(canRateRelayReply(stage, ['request-1']), false, stage);
  }
  assert.equal(canRateRelayReply('complete', []), false);
  assert.equal(canRateRelayReply('complete', ['unsafe request']), false);
});

test('a council reply whose chair is an own API still carries its managed specialists\' requests for rating', async () => {
  const { readFileSync } = await import('node:fs');
  const service = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
  const official = service.slice(service.indexOf("kind: 'official_connection' as const,\n            routeId: `official:"));
  assert.ok(official.length > 0);
  assert.match(official.slice(0, 400), /\.\.\.\(managedRequestIds\.length \? \{ requestId: managedRequestIds\.at\(-1\), requestIds: managedRequestIds \} : \{\}\)/);
  // A specialist's gateway call is recorded into that lineage.
  assert.match(service, /desktop-council-\$\{randomUUID\(\)\}[\s\S]{0,2000}managedRequestIds\.push\(gateway\.call\.id\)/);
});
