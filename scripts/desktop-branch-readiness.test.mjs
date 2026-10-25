import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { waitForExactBranchComposerRoute } from './desktop-branch-readiness.mjs';

const route = { connectionId: 'synthetic', routeId: 'official:synthetic', relayKey: 'official:synthetic', modelId: 'custom_openai/qa' };
const ready = { ...route, persistedRouteId: route.routeId, session: { id: 'source', ...route } };
function fixture(snapshots) {
  let time = 0, reads = 0, pauses = 0;
  return { evaluate: async () => snapshots[Math.min(reads++, snapshots.length - 1)], now: () => time,
    pause: async milliseconds => { pauses++; time += milliseconds; }, counts: () => ({ reads, pauses }), timeoutMs: 500 };
}

test('waits past a mounted renderer with no session and a previous active session, then verifies the exact restored source', async () => {
  const f = fixture([{ ...ready, session: undefined }, { ...ready, session: { ...ready.session, id: 'previous' } }, ready]);
  assert.equal(await waitForExactBranchComposerRoute({ ...f, route, sessionId: 'source' }), ready);
  assert.deepEqual(f.counts(), { reads: 3, pauses: 2 });
});

test('exact session readiness never weakens model, relay, persisted route, or session route checks', async () => {
  for (const field of ['modelId', 'routeId', 'persistedRouteId', 'relayKey']) {
    const f = fixture([{ ...ready, [field]: 'wrong' }]);
    await assert.rejects(waitForExactBranchComposerRoute({ ...f, route, sessionId: 'source' }), /not bound to the exact local QA connection/);
    assert.equal(f.counts().reads, 1);
  }
  for (const field of ['modelId', 'routeId', 'relayKey']) {
    const f = fixture([{ ...ready, session: { ...ready.session, [field]: 'wrong' } }]);
    await assert.rejects(waitForExactBranchComposerRoute({ ...f, route, sessionId: 'source' }), /not bound to the exact local QA connection/);
  }
});

test('another session with the correct route cannot satisfy this branch and the wait remains bounded', async () => {
  const f = fixture([ready]);
  await assert.rejects(waitForExactBranchComposerRoute({ ...f, route, sessionId: 'other' }), /Timed out restoring the exact branch conversation/);
  assert.deepEqual(f.counts(), { reads: 5, pauses: 5 });
  await assert.rejects(waitForExactBranchComposerRoute({ ...f, route, sessionId: '' }), /requires an exact session ID/);
});

test('production branch E2E waits for all durable fixtures before checking the source and binds each subsequent route assertion', () => {
  const source = readFileSync(new URL('./desktop-conversation-branch-e2e.mjs', import.meta.url), 'utf8');
  const initial = source.indexOf('await waitForExactBranchComposerRoute({ evaluate, route, sessionId: sourceSessionId })');
  assert.ok(initial > source.indexOf("'100-turn source fixture persisted'"));
  assert.ok(initial > source.indexOf("'projectless fixture persisted'"));
  assert.ok(initial < source.indexOf('const target88 ='));
  assert.match(source, /waitForExactBranchComposerRoute\(\{ evaluate, route, sessionId: branchId \}\)/);
  assert.match(source, /waitForExactBranchComposerRoute\(\{ evaluate, route, sessionId: userBranchId \}\)/);
  assert.match(source, /assertExactAgentRunRpc\(frames, route, \{ marker \}\)/);
});
