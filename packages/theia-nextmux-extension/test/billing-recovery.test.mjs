import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canRecoverBilling, canRecoverGatewayResult, recoverBillingResult, recoverGatewayInitialization } from '../lib/node/nextmux-billing-recovery.js';
import { ManagedGatewaySessionPool } from '../lib/node/nextmux-managed-session.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const id = '00000000-0000-4000-8000-000000000001';
const pending = () => Object.assign(new Error('Billing pending'), {
  code: 'billing_finalization_pending', requestId: id, recoveryMode: 'billing_only', durableEvidence: true, retryAfterMs: 120_000,
});
const result = { call: { id }, response: { model: 'fixture', content: 'once', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, usageKnown: true } }, billing: { chargedMicros: 2, currency: 'USD' } };
const resumable = () => ({ code: 'request_in_progress', requestId: id, recoveryMode: 'resume',
  upstreamResumeSupported: true, resumable: true, retryAfterMs: 15_000 });

test('only an explicit original upstream cursor enters automatic content recovery', () => {
  assert.equal(canRecoverGatewayResult(resumable()), true);
  assert.equal(canRecoverBilling(resumable()), false);
  for (const change of [{ upstreamResumeSupported: false }, { upstreamResumeSupported: undefined },
    { recoveryMode: 'billing_review' }, { resumable: false }, { settled: true }, { requestId: '../other' },
    { code: 'CANCELLED' }, { code: 'response_replay_expired' }]) {
    assert.equal(canRecoverGatewayResult({ ...resumable(), ...change }), false);
  }
});

test('original content recovery survives days of thinking, GET errors and billing finalization without a new call', async () => {
  let polls = 0, time = 0;
  const waits = [];
  const resumed = await recoverBillingResult(resumable(), {
    now: () => time,
    pause: async ms => { waits.push(ms); time += ms; },
    poll: async requestId => {
      assert.equal(requestId, id);
      polls++;
      if (polls === 1) throw { ...resumable(), retryAfterMs: 86400_000 };
      if (polls === 2) throw { code: 'PLATFORM_OFFLINE' };
      if (polls === 3) throw { ...resumable(), code: 'billing_recovery_rate_limited', retryAfterMs: 60_000 };
      if (polls === 4) throw pending();
      return result;
    },
  });
  assert.equal(resumed, result);
  assert.equal(polls, 5);
  assert.ok(time > 86400_000);
  assert.ok(waits.includes(60_000));
});

test('lost cursor, foreign request and cancellation never fall back to a new generation', async () => {
  const original = resumable();
  for (const failure of [{ ...original, upstreamResumeSupported: false },
    { ...original, requestId: '00000000-0000-4000-8000-000000000002' },
    { ...original, recoveryMode: 'billing_review' }]) {
    let polls = 0;
    await assert.rejects(recoverBillingResult(original, {
      pause: async () => {}, poll: async () => { polls++; throw failure; },
    }), value => value === failure);
    assert.equal(polls, 1);
  }
  const controller = new AbortController();
  await assert.rejects(recoverBillingResult(original, {
    signal: controller.signal, pause: async () => controller.abort(),
    poll: async () => assert.fail('cancelled original request must not be polled or resubmitted'),
  }), value => value === original);
});

test('initialization lookup waits for the original receipt, never a new generation', async () => {
  let polls = 0;
  const waits = [];
  const failure = { code: 'BILLING_INITIALIZATION_PENDING', retryAfterMs: 2_000 };
  assert.equal(await recoverGatewayInitialization({
    poll: async () => { if (++polls < 4) throw failure; return result; },
    pause: async ms => { waits.push(ms); },
  }), result);
  assert.equal(polls, 4);
  assert.deepEqual(waits, [2_000, 2_000, 2_000]);
  polls = 0;
  await assert.rejects(recoverGatewayInitialization({
    poll: async () => { polls++; throw failure; }, pause: async () => {},
  }), error => error === failure);
  assert.equal(polls, 4);
});

test('initialization cancellation and authoritative failures stop receipt lookups', async () => {
  for (const code of ['billing_review_required', 'REQUEST_NOT_DISPATCHED', 'PLATFORM_OFFLINE']) {
    let polls = 0;
    const failure = { code };
    await assert.rejects(recoverGatewayInitialization({ poll: async () => { polls++; throw failure; }, pause: async () => assert.fail('must not wait') }), error => error === failure);
    assert.equal(polls, 1);
  }
  const controller = new AbortController();
  const failure = { code: 'BILLING_INITIALIZATION_PENDING' };
  let polls = 0;
  await assert.rejects(recoverGatewayInitialization({
    signal: controller.signal, poll: async () => { polls++; throw failure; }, pause: async () => controller.abort(),
  }), error => error === failure);
  assert.equal(polls, 1);
});

test('only explicit durable billing receipts enter automatic recovery', () => {
  assert.equal(canRecoverBilling(pending()), true);
  for (const change of [{ durableEvidence: false }, { recoveryMode: 'billing_review' }, { code: 'upstream_timeout' }, { requestId: '../other' }, { requestId: '' }]) {
    assert.equal(canRecoverBilling(Object.assign(pending(), change)), false);
  }
});

test('receipt recovery respects retry-after and never changes request identity', async () => {
  let time = 0, calls = 0;
  const waits = [];
  assert.equal(await recoverBillingResult(pending(), {
    now: () => time,
    pause: async ms => { waits.push(ms); time += ms; },
    poll: async requestId => { assert.equal(requestId, id); if (++calls === 1) throw pending(); return result; },
  }), result);
  assert.deepEqual(waits, [0, 120_000]);
  assert.equal(calls, 2);
});

test('default receipt recovery has no hidden lifetime or attempt cap', async () => {
  let time = 0, calls = 0;
  const waits = [];
  const recovered = await recoverBillingResult(pending(), {
    now: () => time,
    pause: async ms => { waits.push(ms); time += ms; },
    poll: async requestId => {
      assert.equal(requestId, id);
      calls += 1;
      if (calls < 8) throw pending();
      return result;
    },
  });
  assert.equal(recovered, result);
  assert.equal(calls, 8);
  assert.equal(waits.length, 8);
  assert.ok(time > 180_000, 'recovery may outlive the old 180-second cap');
});

test('review, mismatched results and exhausted deadline never start another generation', async () => {
  const original = pending();
  let calls = 0;
  await assert.rejects(recoverBillingResult(original, { poll: async () => { calls++; return { call: { id: 'foreign' } }; } }), e => e === original);
  assert.equal(calls, 1);
  const review = Object.assign(pending(), { recoveryMode: 'billing_review' });
  await assert.rejects(recoverBillingResult(review, { poll: async () => assert.fail('review must not poll') }), e => e === review);
  await assert.rejects(recoverBillingResult(original, { maximumWaitMs: 0, poll: async () => assert.fail('expired must not poll') }), e => e === original);
});

test('cancellation during waiting preserves the original accepted-request failure', async () => {
  const controller = new AbortController();
  const original = pending();
  let calls = 0;
  await assert.rejects(recoverBillingResult(original, {
    signal: controller.signal,
    pause: async ms => { if (ms) controller.abort(); },
    poll: async () => { calls++; throw pending(); },
  }), e => e === original);
  assert.equal(calls, 1);
});

test('a receipt arriving concurrently with cancellation is not returned to tool execution', async () => {
  const controller = new AbortController();
  const original = pending();
  await assert.rejects(recoverBillingResult(original, {
    signal: controller.signal,
    poll: async () => { controller.abort(); return result; },
  }), failure => failure === original);
});

const fixtureRoot = mkdtempSync(join(tmpdir(), 'nextmux-billing-recovery-'));
let serviceIndex = 0;
after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

class Service extends NextMuxPlatformServiceImpl {
  // Legacy receipt tests still need the current durable stop/account scope.
  // Keep every request journal isolated from the real user profile and peers.
  root = join(fixtureRoot, `service-${++serviceIndex}`);
  mediaDeliveryAccountId = 'fixture-owner';
  nextmuxDataRoot() { return this.root; }
  async getPrivacySettings() { return {}; }
  async deviceId() { return 'fixture-device-0000001'; }
  stream(callbacks = {}) { return this.completeManagedGatewayWithEvents({ mode: 'fixed', offeringId: 'model' }, { messages: [], tools: [], conversationId: 'fixture', workbench: 'coding' }, 'stable-client-id', undefined, callbacks); }
  classify(error) { return this.stableAgentRunError(error); }
}

test('desktop coding and comic text retain accepted identities and recover only a proven original cursor', async () => {
  for (const workbench of ['coding', 'comic']) for (const acknowledged of [false, true]) {
    class InterruptedService extends Service {
      stream(callbacks) { return this.completeManagedGatewayWithEvents({ mode: 'fixed', offeringId: 'model' }, {
        messages: [], tools: [], conversationId: `fixture-${workbench}`, workbench, acceptOrderedOutput: true,
      }, `stable-${workbench}-id`, undefined, callbacks); }
    }
    const service = new InterruptedService();
    const paths = [], deltas = [];
    service.networkFetch = async (url, init) => {
      const path = new URL(url).pathname;
      paths.push(path);
      if (paths.length === 1) return new Response([
        { type: 'response.started', ...(acknowledged ? { requestId: id } : {}) }, { type: 'content.delta', delta: 'on' },
      ].map(row => JSON.stringify(row)).join('\n'), { headers: { 'content-type': 'application/x-ndjson' } });
      assert.equal(init.body, undefined, 'recovery sends no model prompt or tools');
      if (path === '/api/gateway/recover') {
        assert.equal(init.headers['idempotency-key'], `stable-${workbench}-id`);
        return Response.json({ code: 'request_in_progress', details: { ...resumable(), acceptanceUnknown: true } }, { status: 409 });
      }
      assert.equal(path, `/api/gateway/responses/${id}/recover`);
      return Response.json(result);
    };
    const response = service.stream({ onTextDelta: delta => deltas.push(delta) });
    if (acknowledged) {
      await assert.rejects(response, error => {
        assert.equal(error.code, 'BILLING_TRANSPORT_UNKNOWN');
        assert.equal(error.requestId, id);
        assert.equal(error.recoveryMode, 'billing_review');
        assert.equal(error.retrySafe, false);
        assert.equal(error.resumable, false);
        return true;
      });
      assert.deepEqual(paths, ['/api/gateway/responses'], 'an accepted ID alone does not prove an upstream content cursor');
    } else {
      assert.equal((await response).call.id, id);
      assert.deepEqual(paths, ['/api/gateway/responses', '/api/gateway/recover', `/api/gateway/responses/${id}/recover`]);
    }
    assert.deepEqual(deltas, ['on'], 'the recovered full answer is not appended again as partial deltas');
  }
});

test('desktop consumes an explicit resumable failure directly instead of showing a model error', async () => {
  const service = new Service();
  const paths = [];
  service.networkFetch = async (url, init) => {
    paths.push(new URL(url).pathname);
    if (paths.length === 1) return Response.json({ code: 'upstream_response_pending', details: resumable() }, { status: 503 });
    assert.equal(init.body, undefined);
    return Response.json(result);
  };
  assert.equal((await service.stream()).call.id, id);
  assert.deepEqual(paths, ['/api/gateway/responses', `/api/gateway/responses/${id}/recover`]);
});

test('large managed screenshots reach HTTP exactly once with the original key and no receipt recovery', async () => {
  class ScreenshotService extends Service {
    managedSessionPool() { return this.pool; }
    stream() { return this.completeManagedGatewayWithEvents({ mode: 'fixed', offeringId: 'model' }, {
      messages: [{ role: 'user', content: 'screenshot', attachments: [{ kind: 'image', mimeType: 'image/png', dataBase64: 'A'.repeat(400_000) }] }],
      tools: [], workbench: 'coding',
    }, 'stable-screenshot-key', undefined, {}); }
  }
  const service = new ScreenshotService();
  let sockets = 0;
  service.pool = new ManagedGatewaySessionPool({ baseUrl: 'https://fixture.invalid', deviceId: async () => 'fixture-device-0000001',
    WebSocket: class { constructor() { sockets++; throw new Error('oversized frame must not open a socket'); } } });
  const urls = [];
  service.networkFetch = async (url, init) => {
    urls.push(new URL(url).pathname);
    assert.equal(init.headers['idempotency-key'], 'stable-screenshot-key');
    assert.ok(Buffer.byteLength(init.body) > 256 * 1024);
    return new Response(JSON.stringify({ type: 'completed', result }) + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
  };
  try { assert.equal((await service.stream()).call.id, id); }
  finally { service.pool.close(); }
  assert.deepEqual(urls, ['/api/gateway/responses']);
  assert.equal(sockets, 0);
});

test('actual desktop stream recovers receipt without duplicate text or inference POST', async () => {
  const service = new Service();
  const urls = [], deltas = [], events = [];
  service.networkFetch = async (url, init) => {
    urls.push(new URL(url).pathname);
    if (urls.length === 1) return new Response([
      { type: 'response.started' }, { type: 'content.delta', delta: 'once' },
      { type: 'error', error: { ...pending(), providerAccepted: true, status: 503 } },
    ].map(row => JSON.stringify(row)).join('\n'), { headers: { 'content-type': 'application/x-ndjson' } });
    assert.equal(init.body, undefined, 'no prompts, tools or new model request are posted during recovery');
    assert.equal(init.method, 'POST');
    return Response.json(result);
  };
  assert.deepEqual(await service.stream({ onTextDelta: delta => deltas.push(delta), onProviderEvent: event => events.push(event.type) }), result);
  assert.deepEqual(urls, ['/api/gateway/responses', `/api/gateway/responses/${id}/recover`]);
  assert.deepEqual(deltas, ['once']);
  assert.ok(events.includes('billing.pending') && events.includes('billing.completed'));
});

test('a briefly invisible request is recovered by the same key instead of being sent to billing review', async () => {
  const service = new Service();
  const urls = [], events = [];
  service.networkFetch = async (url, init) => {
    urls.push(new URL(url).pathname);
    if (urls.length === 1) throw new TypeError('synthetic transport interruption');
    assert.equal(init.headers['idempotency-key'], 'stable-client-id');
    assert.equal(init.body, undefined);
    if (urls.length === 2) return Response.json({ code: 'request_initialization_pending', details: {
      acceptanceUnknown: true, recoveryMode: 'billing_review', retryAfter: 0,
    } }, { status: 503 });
    return Response.json(result);
  };
  assert.equal((await service.stream({ onProviderEvent: event => events.push(event.type) })).call.id, id);
  assert.deepEqual(urls, ['/api/gateway/responses', '/api/gateway/recover', '/api/gateway/recover']);
  assert.deepEqual(events, ['billing.pending', 'billing.completed']);
});

test('cancelling an initialization lookup records an independent stop and keeps original unknown-dispatch protection', async () => {
  class CancelService extends Service {
    stream(signal) { return this.completeManagedGatewayWithEvents({ mode: 'fixed', offeringId: 'model' }, {
      messages: [], tools: [], workbench: 'coding',
    }, 'stable-cancelled-key', signal, {}); }
  }
  const service = new CancelService();
  const controller = new AbortController();
  const paths = [];
  service.networkFetch = async (url, init) => {
    const path = new URL(url).pathname;
    paths.push(path);
    if (path === '/api/gateway/responses') throw new TypeError('synthetic transport interruption');
    if (path === '/api/gateway/stop') {
      assert.equal(init.headers['idempotency-key'], 'stable-cancelled-key');
      assert.deepEqual(JSON.parse(init.body), { reason: 'user_stop' });
      assert.equal(init.signal.aborted, false, 'the durable stop outlives the cancelled receipt lookup');
      return Response.json({ ok: true, requestId: id, stopRequested: true, providerStopConfirmed: false });
    }
    assert.equal(path, '/api/gateway/recover');
    assert.equal(init.body, undefined);
    controller.abort('user_stop');
    throw Object.assign(new Error('lookup cancelled'), { name: 'AbortError' });
  };
  await assert.rejects(service.stream(controller.signal), error => {
    assert.equal(error.retrySafe, false);
    assert.equal(error.recoveryMode, 'billing_review');
    assert.equal(service.classify(error).resumable, false);
    return true;
  });
  assert.deepEqual(paths, ['/api/gateway/responses', '/api/gateway/recover', '/api/gateway/stop']);
});

test('buffered desktop calls use the same receipt recovery and review is not resumable', async () => {
  const service = new Service();
  let count = 0;
  service.networkFetch = async () => ++count === 1
    ? Response.json({ code: 'billing_finalization_pending', details: { ...pending(), providerAccepted: true } }, { status: 503 })
    : Response.json(result);
  assert.equal((await service.completeManagedGateway({ mode: 'fixed', offeringId: 'model' }, { messages: [], tools: [], conversationId: 'fixture', workbench: 'coding' }, 'stable-client-id')).call.id, id);
  assert.equal(count, 2);
  service.networkFetch = async () => Response.json({ code: 'billing_review_required', details: { requestId: id, recoveryMode: 'billing_review', providerAccepted: true } }, { status: 409 });
  await assert.rejects(service.stream(), error => {
    assert.equal(error.resumable, false);
    assert.equal(error.retrySafe, false);
    assert.equal(service.classify(error).resumable, false);
    return true;
  });
});

test('receipt lookup errors retain original identity and never offer ordinary model resume', async () => {
  const cases = [
    () => Response.json({ code: 'RATE_LIMITED' }, { status: 429 }),
    () => Response.json({ code: 'EDGE_ERROR' }, { status: 502 }),
    () => new Response('not json', { status: 200 }),
    () => Response.json({ ...result, call: { id: '00000000-0000-4000-8000-000000000002' } }),
    () => Response.json({ code: 'billing_review_required', details: { requestId: 'foreign', recoveryMode: 'billing_review' } }, { status: 409 }),
  ];
  for (const response of cases) {
    const service = new Service();
    let calls = 0;
    service.networkFetch = async () => ++calls === 1
      ? Response.json({ code: 'billing_finalization_pending', details: { ...pending(), providerAccepted: true } }, { status: 503 })
      : response();
    await assert.rejects(service.completeManagedGateway({ mode: 'fixed', offeringId: 'model' }, { messages: [], tools: [], conversationId: 'fixture', workbench: 'coding' }, 'stable-client-id'), error => {
      assert.equal(error.requestId, id);
      assert.equal(error.retrySafe, false);
      assert.equal(error.resumable, false);
      assert.equal(service.classify(error).resumable, false);
      assert.equal(service.classify(error).retryable, false);
      return true;
    });
    assert.equal(calls, 2);
  }
});
