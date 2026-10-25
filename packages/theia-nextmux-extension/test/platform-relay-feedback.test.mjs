import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const protocolSource = readFileSync(fileURLToPath(new URL('../src/common/nextmux-platform-protocol.ts', import.meta.url)), 'utf8');
const serviceSource = readFileSync(fileURLToPath(new URL('../src/node/nextmux-platform-service.ts', import.meta.url)), 'utf8');

function legacyOffering(overrides = {}) {
  return {
    id: 'offering-1', providerName: 'Same display name', endpointName: 'Primary',
    modelFamily: 'gpt-test', displayName: 'GPT Test', providerModelCode: 'gpt-test',
    category: 'coding', registryModelId: 'registry-1', canonicalModel: 'openai/gpt-test',
    sourceType: 'verified_relay', status: 'active', region: 'global', capabilities: [],
    input: ['text'], output: ['text'], workbenches: ['coding'],
    price: {
      currency: 'USD', mode: 'direct', multiplierBps: 10000,
      inputPerMillionMicros: 1, outputPerMillionMicros: 2,
      cachedInputPerMillionMicros: null, imageEachMicros: null,
      videoSecondMicros: null, audioPerMillionCharactersMicros: null,
    },
    routeScore: 90, multiplierBps: 10000,
    fidelity: { index: 90, confidence: 'high', sampleCount: 10 },
    agentReadiness: { index: 90, level: 'ready' },
    network: { availability: 0.99, p95LatencyMs: 500, state: 'healthy' },
    privacy: { zeroDataRetention: false, dataCollection: true },
    ...overrides,
  };
}

class TestPlatformService extends NextMuxPlatformServiceImpl {
  constructor(handler) {
    super();
    this.baseUrl = 'https://platform.example.test';
    this.networkFetch = handler;
  }

  async deviceId() {
    return 'desktop-device-test';
  }
}

test('old catalogs are normalized without inventing merchant identity from display names', async () => {
  const service = new TestPlatformService(async () => new Response(JSON.stringify({
    offerings: [legacyOffering()], measuredAt: '2026-09-01T00:00:00.000Z',
  }), { status: 200, headers: { 'content-type': 'application/json' } }));

  const catalog = await service.getCatalog();
  assert.equal(catalog.online, true);
  assert.deepEqual({
    merchantId: catalog.offerings[0].merchantId,
    recommendedRank: catalog.offerings[0].recommendedRank,
    recommended: catalog.offerings[0].recommended,
    merchantTrustScore: catalog.offerings[0].merchantTrustScore,
    likes: catalog.offerings[0].likes,
    dislikes: catalog.offerings[0].dislikes,
  }, {
    merchantId: '', recommendedRank: 0, recommended: false,
    merchantTrustScore: 0, likes: 0, dislikes: 0,
  });
  assert.notEqual(catalog.offerings[0].merchantId, catalog.offerings[0].providerName);
});

test('desktop relay feedback uses the managed request path and authenticated device request wrapper', async () => {
  const calls = [];
  const service = new TestPlatformService(async (input, init) => {
    calls.push({ input: String(input), init });
    return new Response(JSON.stringify({
      ok: true,
      idempotent: init?.method === 'POST',
      feedback: {
        requestId: 'request-1', merchantId: 'merchant-1',
        vote: init?.method === 'POST' ? 'up' : null,
        likes: '7', dislikes: '2', createdAt: null, updatedAt: '1800000000000',
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  const current = await service.getRelayFeedback('request-1');
  const submitted = await service.submitRelayFeedback('request-1', 'up');

  assert.equal(calls[0].input, 'https://platform.example.test/api/relay-feedback/request-1');
  assert.equal(calls[0].init.headers['x-nextmux-device-id'], 'desktop-device-test');
  assert.equal(calls[1].input, calls[0].input);
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[1].init.body), { vote: 'up' });
  assert.deepEqual(current, {
    requestId: 'request-1', merchantId: 'merchant-1', vote: null,
    likes: 7, dislikes: 2, createdAt: null, updatedAt: 1800000000000,
  });
  assert.equal(submitted.feedback.vote, 'up');
  assert.equal(submitted.idempotent, true);
});

test('desktop submits one atomic feedback batch without conversation content', async () => {
  const calls = [];
  const service = new TestPlatformService(async (input, init) => {
    calls.push({ input: String(input), init });
    return new Response(JSON.stringify({
      ok: true,
      idempotent: false,
      feedback: {
        groupId: 'feedback-group-1', requestIds: ['request-1', 'request-2'], vote: 'down',
        createdAt: 10, updatedAt: 20,
        targets: [{
          merchantId: 'merchant-1', providerName: 'Relay One', endpointId: 'endpoint-1', endpointName: 'Primary',
          modelId: 'model-1', modelName: 'Model One', canonicalModel: 'vendor/model-one', vote: 'down', likes: '4', dislikes: '2',
          requestCount: '2', attemptCount: '3',
        }],
        aggregates: {
          requestCount: '2', attemptCount: '3', targetCount: '1', merchantCount: '1',
          merchants: [{ merchantId: 'merchant-1', providerName: 'Relay One', likes: '4', dislikes: '2' }],
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  const submitted = await service.submitRelayFeedbackBatch(['request-1', 'request-2', 'request-1'], 'down');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, 'https://platform.example.test/api/relay-feedback/batch');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['x-nextmux-device-id'], 'desktop-device-test');
  assert.deepEqual(JSON.parse(calls[0].init.body), { requestIds: ['request-1', 'request-2'], vote: 'down' });
  assert.equal(calls[0].init.body.includes('conversation'), false);
  assert.equal(calls[0].init.body.includes('prompt'), false);
  assert.equal(submitted.feedback.vote, 'down');
  assert.equal(submitted.feedback.targets[0].likes, 4);
  assert.equal(submitted.feedback.targets[0].attemptCount, 3);
  assert.equal(submitted.feedback.aggregates.requestCount, 2);
  assert.equal(submitted.feedback.aggregates.attemptCount, 3);
});

test('desktop reads a feedback batch with repeated query parameters', async () => {
  let requested = '';
  const service = new TestPlatformService(async input => {
    requested = String(input);
    return new Response(JSON.stringify({
      feedback: {
        groupId: null, requestIds: ['request-1', 'request-2'], vote: null,
        createdAt: null, updatedAt: null, targets: [],
        aggregates: { requestCount: 2, attemptCount: 0, targetCount: 0, merchantCount: 0, merchants: [] },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  const feedback = await service.getRelayFeedbackBatch(['request-1', 'request-2']);
  assert.equal(requested, 'https://platform.example.test/api/relay-feedback/batch?requestId=request-1&requestId=request-2');
  assert.deepEqual(feedback.requestIds, ['request-1', 'request-2']);
});

test('desktop rejects malformed batch lineage returned by the platform', async () => {
  for (const requestIds of [[], ['request-1', 'request-1'], ['unsafe request']]) {
    const service = new TestPlatformService(async () => new Response(JSON.stringify({
      feedback: {
        groupId: null, requestIds, vote: null, createdAt: null, updatedAt: null, targets: [],
        aggregates: { requestCount: requestIds.length, attemptCount: 0, targetCount: 0, merchantCount: 0, merchants: [] },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await assert.rejects(service.getRelayFeedbackBatch(['request-1']), /评分|反馈|invalid/i);
  }
});

test('desktop rejects an unsafe legacy request id returned by the platform', async () => {
  const service = new TestPlatformService(async () => new Response(JSON.stringify({
    feedback: {
      requestId: 'unsafe request', merchantId: 'merchant-1', vote: null,
      likes: 0, dislikes: 0, createdAt: null, updatedAt: null,
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } }));

  await assert.rejects(service.getRelayFeedback('request-1'), /评分|反馈|invalid/i);
});

test('relay feedback rejects invalid request IDs and votes before network access', async () => {
  let calls = 0;
  const service = new TestPlatformService(async () => {
    calls += 1;
    return new Response('{}');
  });
  await assert.rejects(service.getRelayFeedback(''), /反馈|request/i);
  await assert.rejects(service.getRelayFeedback('unsafe request'), /反馈|request/i);
  await assert.rejects(service.submitRelayFeedback('request-1', 'sideways'), /反馈|vote/i);
  await assert.rejects(service.submitRelayFeedbackBatch([], 'up'), /反馈|request/i);
  await assert.rejects(service.submitRelayFeedbackBatch(['request-1', 'side ways'], 'up'), /反馈|request/i);
  await assert.rejects(service.submitRelayFeedbackBatch(['request-1'], 'sideways'), /反馈|vote/i);
  assert.equal(calls, 0);
});

test('completed managed runs expose the exact platform request id, while direct routes cannot invent one', () => {
  assert.match(protocolSource, /readonly requestId\?: string;/);
  assert.match(protocolSource, /readonly requestIds\?: readonly string\[\];/);
  assert.match(serviceSource, /const managedRequestIds: string\[\] = \[\];/);
  assert.match(serviceSource, /managedRequestIds\.push\(gateway\.call\.id\)/);
  assert.match(serviceSource, /requestId: lastGateway\.call\.id/);
  assert.match(serviceSource, /requestIds: managedRequestIds/);
  const directStart = serviceSource.indexOf("kind: 'official_connection' as const");
  const directRoute = serviceSource.slice(directStart, serviceSource.indexOf('};', directStart));
  // A direct route invents no ID of its own. It passes on only the managed calls its council specialists really made
  // (web research and the main managed loop run on managed routes alone), so its thumbs can rate those merchants.
  const passOn = /\.\.\.\(managedRequestIds\.length \? \{ requestId: managedRequestIds\.at\(-1\), requestIds: managedRequestIds \} : \{\}\),/;
  assert.match(directRoute, passOn);
  assert.doesNotMatch(directRoute.replace(passOn, ''), /requestId/);
});
