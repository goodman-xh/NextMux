import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { filterPersonalApiUsage, usageEvidenceLabel } from '../lib/browser/nextmux-model-usage-panel.js';
import { modelUsageText } from '../lib/browser/nextmux-model-usage-locale.js';

const row = overrides => ({ merchantId: 'merchant', providerName: 'Relay', currency: 'USD', requestCount: 3,
  completedCount: 2, failedCount: 1, otherCount: 0, chargedMicros: 1, inputTokens: 1, cachedInputTokens: 0,
  cacheWriteTokens: 0, outputTokens: 1, failoverCount: 0, averageDurationMs: 100, durationSampleCount: 2,
  modelMatchedCount: 2, modelMismatchedCount: 0, modelUnreportedCount: 1, modelEvidence: 'insufficient',
  firstAt: 1, latestAt: 2, ...overrides });

test('model usage identity wording never upgrades provider self-report to independent verification', () => {
  assert.equal(usageEvidenceLabel(row({ modelEvidence: 'self_reported_consistent', modelUnreportedCount: 0 })).label, '上游自报一致');
  assert.equal(usageEvidenceLabel(row({ modelEvidence: 'self_reported_conflict', modelMismatchedCount: 1 })).label, '上游自报不一致');
  assert.equal(usageEvidenceLabel(row({})).label, '模型身份证据不足');
});

test('model usage panel exposes bounded filters and never renders infrastructure identifiers', () => {
  const source = readFileSync(new URL('../src/browser/nextmux-model-usage-panel.tsx', import.meta.url), 'utf8');
  assert.match(source, /modelUsageText\(locale, 'range7'\)/);
  assert.match(source, /modelUsageText\(locale, 'range366'\)/);
  assert.match(source, /<UsageAnalytics /, 'the relay tab renders the shared usage analytics');
  assert.doesNotMatch(source, /[\p{Script=Han}]/u, 'localized UI copy must not be embedded in the component');
  assert.equal(modelUsageText('en', 'range7'), 'Last 7 days');
  assert.equal(modelUsageText('zh-CN', 'range366'), '最近 366 天');
  assert.doesNotMatch(source, /credentialId|endpointId|baseUrl|apiKey/);
});

test('usage source, empty, evidence and metric copy resolves in every desktop locale', () => {
  const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
  const keys = ['sourceTabs', 'managed', 'personal', 'managedLoginTitle', 'managedBody', 'personalBody',
    'noPersonal', 'loadingUsage', 'noUsage', 'noMatch', 'requests', 'successRate', 'tokens', 'averageDuration',
    'failovers', 'modelEvidence', 'evidenceConflict', 'evidenceConsistent', 'evidenceInsufficient', 'rangeSummary'];
  for (const locale of locales) for (const key of keys) assert.ok(modelUsageText(locale, key).trim(), `${locale}:${key}`);
  for (const key of keys) assert.doesNotMatch(modelUsageText('en', key), /[\p{Script=Han}]/u, `en:${key}`);
});

test('usage records separate charged relay calls from local personal API history', () => {
  const source = readFileSync(new URL('../src/browser/nextmux-model-usage-panel.tsx', import.meta.url), 'utf8');
  assert.match(source, /useState<'managed' \| 'personal'>\('managed'\)/);
  assert.match(source, /role='tablist'/);
  assert.match(source, /id='nmx-usage-panel-managed'/);
  assert.match(source, /id='nmx-usage-panel-personal'/);
  assert.match(source, /visiblePersonalUsage\.map/);
  assert.match(source, /modelUsageText\(locale, record\.local \? 'localFree' : 'directBilling'\)/,
    'local models remain free while personal provider calls retain direct billing');
});

test('usage shares the persistent model-center search rather than replacing it with another input', () => {
  const source = readFileSync(new URL('../src/browser/nextmux-model-usage-panel.tsx', import.meta.url), 'utf8');
  assert.match(source, /readonly searchQuery\?: string/);
  assert.match(source, /searchQuery=\{searchQuery\}/, 'the shared search filters the relay analytics');
  assert.match(readFileSync(new URL('../src/browser/nextmux-usage-analytics.tsx', import.meta.url), 'utf8'), /searchQuery\.trim\(\)\.toLocaleLowerCase\(\)/);
  assert.doesNotMatch(source, /nmx-model-usage-search|setQuery|<input/);
  const records = [
    { id: 'a', routeLabel: 'OpenAI / GPT', conversationTitle: 'Invoice review', startedAt: 1, status: 'complete' },
    { id: 'b', routeLabel: 'Claude', conversationTitle: 'Read diagram', startedAt: 2, status: 'complete' }
  ];
  assert.equal(filterPersonalApiUsage(records, '  '), records);
  assert.deepEqual(filterPersonalApiUsage(records, '  GPT ').map(record => record.id), ['a']);
  assert.deepEqual(filterPersonalApiUsage(records, 'DIAGRAM').map(record => record.id), ['b']);
  assert.deepEqual(filterPersonalApiUsage(records, 'missing'), []);
});

test('billing usage summary uses the same exact server totals as the usage page, with cache and latency signals', () => {
  const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
  assert.match(source, /<UsageAnalytics variant='summary' service=\{this\.platformService\}[^>]*rangeDays=\{30\} revision=\{this\.accountOverview\.refreshedAt\}/);
  assert.doesNotMatch(source, /BillingUsageSummary|summarizeBillingUsage/);
  const analytics = readFileSync(new URL('../src/browser/nextmux-usage-analytics.tsx', import.meta.url), 'utf8');
  assert.match(analytics, /getMerchantUsageOverview/); assert.match(analytics, /getUsageHistory/);
  assert.match(analytics, /cacheHitRate/); assert.match(analytics, /avgLatency/); assert.match(analytics, /usagePercentile\(/);
  assert.doesNotMatch(analytics, /[\p{Script=Han}]/u, 'localized UI copy lives in the locale module');
});
