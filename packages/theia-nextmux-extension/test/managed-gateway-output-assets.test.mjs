import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { readAgentOutputAsset } from '../lib/node/nextmux-agent-output-assets.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const requestId = '11111111-2222-4333-8444-555555555555';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const sha256 = createHash('sha256').update(png).digest('hex');

function gatewayResult(overrides = {}) {
  return {
    call: { id: requestId, offeringId: 'offering', providerName: 'Provider', modelFamily: 'Gemini', createdAt: new Date().toISOString(), automaticRouting: false, failoverCount: 0 },
    response: {
      content: 'BeforeAfter', model: 'gemini-test', toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1, usageKnown: true },
      outputParts: [
        { type: 'text', text: 'Before' },
        { type: 'image', asset: { sha256, mimeType: 'image/png', sizeBytes: png.length } },
        { type: 'text', text: 'After' },
      ],
      outputAssets: [{ partIndex: 1, sha256, mimeType: 'image/png', sizeBytes: png.length,
        downloadPath: `/api/gateway/responses/${requestId}/output/1`, expiresAt: Date.now() + 60_000 }],
      ...overrides,
    },
    billing: { kind: 'platform', currency: 'USD', chargedMicros: 1 }, developmentOnly: false,
  };
}

class ProbePlatformService extends NextMuxPlatformServiceImpl {
  constructor(root, fetchImpl) {
    super();
    this.root = root;
    this.networkFetch = fetchImpl;
  }
  nextmuxDataRoot() { return this.root; }
  deviceId() { return Promise.resolve('desktop-test'); }
  persist(result, ownerId, signal) { return this.persistManagedGatewayOutputParts(result, ownerId, signal); }
}

function assetResponse(bytes = png, headers = {}) {
  return new Response(bytes, { headers: {
    'content-type': 'image/png', 'content-length': String(bytes.length),
    'x-nextmux-call-id': requestId, 'x-nextmux-part-index': '1', 'x-nextmux-sha256': sha256,
    ...headers,
  } });
}

test('managed ordered media is authenticated, verified and persisted behind local owner references', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'nextmux-managed-output-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const requests = [];
  const service = new ProbePlatformService(root, async (url, init) => {
    requests.push({ url: String(url), init });
    return assetResponse();
  });
  const parts = await service.persist(gatewayResult(), 'conversation-a');
  assert.deepEqual(parts.map(part => part.type), ['text', 'image', 'text']);
  assert.equal(JSON.stringify(parts).includes(png.toString('base64')), false);
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).pathname, `/api/gateway/responses/${requestId}/output/1`);
  assert.equal(requests[0].init.headers['x-nextmux-device-id'], 'desktop-test');
  assert.equal(requests[0].init.redirect, 'error');
  const image = parts[1];
  const loaded = await readAgentOutputAsset(root, 'conversation-a', image.asset);
  assert.equal(loaded.dataBase64, png.toString('base64'));
  await assert.rejects(readAgentOutputAsset(root, 'conversation-b', image.asset));
});

test('managed output rejects arbitrary download paths, text disagreement and tampered bytes before exposing references', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'nextmux-managed-output-invalid-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  let fetches = 0;
  const service = new ProbePlatformService(root, async () => { fetches += 1; return assetResponse(Buffer.concat([png.subarray(0, -1), Buffer.of(0)])); });
  await assert.rejects(service.persist(gatewayResult({ content: 'different' }), 'conversation-a'), /TEXT_MISMATCH/);
  await assert.rejects(service.persist(gatewayResult({ outputAssets: [{ ...gatewayResult().response.outputAssets[0], downloadPath: 'https:\/\/attacker.invalid\/asset' }] }), 'conversation-a'), /ASSETS_INVALID/);
  assert.equal(fetches, 0);
  await assert.rejects(service.persist(gatewayResult(), 'conversation-a'), /DOWNLOAD_INVALID/);
  assert.equal(fetches, 1);
});

test('managed request capability flag and streamed completion preserve ordered descriptors without inline bytes', async () => {
  const service = new ProbePlatformService('/unused', async () => { throw new Error('unexpected'); });
  service.getPrivacySettings = async () => ({ requireZeroDataRetention: false, denyDataCollection: false });
  const body = service.managedGatewayBody(
    { mode: 'fixed', offeringId: '11111111-2222-4333-8444-555555555556' },
    { messages: [{ role: 'user', content: 'hello' }], tools: [], workbench: 'general', conversationId: 'conversation-a', acceptOrderedOutput: true },
    await service.getPrivacySettings(),
  );
  assert.equal(body.acceptOrderedOutput, true);
  const result = gatewayResult();
  const streamed = await service.consumeManagedGatewayStream(new Response(`${JSON.stringify({ type: 'completed', result })}\n`, {
    headers: { 'content-type': 'application/x-ndjson' },
  }), {});
  assert.deepEqual(streamed.response.outputParts, result.response.outputParts);
  assert.deepEqual(streamed.response.outputAssets, result.response.outputAssets);
  assert.equal(JSON.stringify(streamed).includes(png.toString('base64')), false);
});
