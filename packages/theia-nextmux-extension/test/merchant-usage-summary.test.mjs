import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeMerchantUsage, usageModelReport } from '../lib/browser/nextmux-merchant-usage.js';

const record = (fields = {}) => ({ id: crypto.randomUUID(), merchantId: 'merchant-a', providerName: 'Atlas', currency: 'USD',
  workbench: 'coding', canonicalModel: 'provider/model', routeMode: 'fixed', status: 'completed', chargedMicros: 10,
  inputTokens: 2, cachedInputTokens: 3, cacheWriteTokens: 4, outputTokens: 5, pricingMode: 'reference_multiplier',
  referenceModel: 'provider/model', upstreamModel: 'provider/model', reportedModel: 'provider/model', meteringSource: 'provider_reported',
  settlementMultiplierBps: 10000, platformFeeBps: 200, retailMultiplierBps: 10000, metrics: [], failoverCount: 0,
  durationMs: 1000, startedAt: 1, completedAt: 2, inputIncludesCached: false, ...fields });

test('groups usage by stable merchant and currency without merging duplicate display names', () => {
  const rows = summarizeMerchantUsage([record(), record({ merchantId: 'merchant-b', chargedMicros: 20 }), record({ chargedMicros: 30, durationMs: 3000, failoverCount: 1 })]);
  assert.equal(rows.length, 2);
  const atlas = rows.find(row => row.merchantId === 'merchant-a');
  assert.deepEqual({ requests: atlas.requestCount, complete: atlas.completedCount, charge: atlas.chargedMicros, tokens: atlas.tokenCount,
    duration: atlas.averageDurationMs, switches: atlas.failoverCount }, { requests: 2, complete: 2, charge: 40, tokens: 28, duration: 2000, switches: 1 });
});

test('labels provider model names only as self-reported evidence, including missing and mismatched values', () => {
  assert.equal(usageModelReport(record()), 'matched');
  assert.equal(usageModelReport(record({ reportedModel: '' })), 'unreported');
  assert.equal(usageModelReport(record({ reportedModel: 'other/model' })), 'mismatched');
  assert.deepEqual(summarizeMerchantUsage([record(), record({ reportedModel: '' }), record({ reportedModel: 'other/model' })])[0].modelReports,
    { matched: 1, mismatched: 1, unreported: 1 });
});

test('legacy records remain visible and invalid numeric data cannot create negative totals', () => {
  const [row] = summarizeMerchantUsage([record({ merchantId: '', providerName: '', chargedMicros: -1, inputTokens: Number.NaN,
    durationMs: 0, completedAt: null, startedAt: null, status: 'failed' })]);
  assert.equal(row.providerName, '平台线路'); assert.equal(row.chargedMicros, 0); assert.equal(row.tokenCount, 12);
  assert.equal(row.averageDurationMs, null); assert.equal(row.completedCount, 0); assert.equal(row.latestAt, null);
});

test('does not double-count cache dimensions and hides mixed accounting totals', () => {
  const included = summarizeMerchantUsage([record({ inputTokens: 10, cachedInputTokens: 3, cacheWriteTokens: 2, outputTokens: 4, inputIncludesCached: true })])[0];
  assert.equal(included.tokenCount, 14);
  assert.equal(included.inputIncludesCached, true);
  const unknown = summarizeMerchantUsage([record({ inputIncludesCached: undefined })])[0];
  assert.equal(unknown.tokenCount, null);
  assert.equal('inputIncludesCached' in unknown, false);
  const mixed = summarizeMerchantUsage([record({ inputIncludesCached: true }), record({ inputIncludesCached: false })])[0];
  assert.equal(mixed.tokenCount, 21);
  assert.equal('inputIncludesCached' in mixed, false);
});
