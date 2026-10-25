import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, readdir, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AgentRunJournalStore } from '../lib/node/nextmux-agent-run-journal.js';
import { normalizeAgentDelegationLedger } from '@nextmux/agent-runtime';
const event = () => { const requestId = randomUUID(), quote = 'kq1_' + 'a'.repeat(64); return {
  type: 'model_price_changed', runId: 'price-recovery-run-001', sessionId: randomUUID(), at: new Date().toISOString(),
  pricingUpdate: { id: `${requestId}:${quote}`, requestId, at: Date.now(), effectiveQuoteId: quote, offeringId: randomUUID(),
    model: 'fixture-model', currency: 'USD', usageMultiplierBps: null,
    rates: [{ metric: 'input_tokens', unitSize: 1000000, customerAmountMicros: 100000 }] }
}; };
test('a price receipt survives process recreation under its original run and session without retaining unknown fields', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nmx-price-event-')); t.after(() => rm(root, { recursive: true, force: true }));
  const sample = event(); const store = new AgentRunJournalStore(root);
  await store.appendEvent(sample.runId, { ...sample, privateBody: 'secret', pricingUpdate: { ...sample.pricingUpdate, credential: 'secret' } });
  await store.flushEvents(sample.runId);
  assert.deepEqual(await new AgentRunJournalStore(root).loadEvents(sample.runId), [sample]);
  const file = join(root, (await readdir(root))[0]); assert.equal((await readFile(file, 'utf8')).includes('secret'), false);
  await store.appendEvent(sample.runId, { ...sample, runId: 'foreign-price-run-001' });
  await store.appendEvent(sample.runId, { ...sample, pricingUpdate: { ...sample.pricingUpdate, requestId: randomUUID() } });
  await appendFile(file, JSON.stringify({ ...sample, runId: 'foreign-price-run-001' }) + '\n');
  assert.deepEqual(await new AgentRunJournalStore(root).loadEvents(sample.runId), [sample]);
});
test('delegated activity retains price event type when the diagnostic ledger reloads', () => {
  const at = new Date().toISOString();
  const restored = normalizeAgentDelegationLedger({ schemaVersion: 1, rootRunId: 'root-price-001', createdAt: at, updatedAt: at,
    children: [{ childRunId: 'child-price-001', parentRunId: 'root-price-001', rootRunId: 'root-price-001', depth: 1,
      task: 'fixture', status: 'running', startedAt: at, updatedAt: at, lastEventAt: at, lastEventType: 'model_price_changed', eventCount: 1 }] });
  assert.equal(restored.children[0].lastEventType, 'model_price_changed');
});
