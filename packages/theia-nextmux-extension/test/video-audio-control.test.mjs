import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueRequest } from '@nextmux/media-core';
import { validatedBaseUrl } from '@nextmux/model-runtime';
import { buildOfficialCanvasCapability } from '../lib/common/nextmux-canvas-capabilities.js';
import { buildOfficialCanvasAdapterPolicy } from '../lib/common/nextmux-canvas-adapter-policy.js';
import { videoModelGuide } from '../lib/common/nextmux-video-model-guide.js';
import { compileCanvasGenerationJob } from '../lib/node/nextmux-canvas-generation.js';
import { parseOpenRouterVideoModels } from '../lib/node/nextmux-openrouter-video-limits.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const connectionId = 'official-11111111-1111-4111-8111-111111111111';
const model = 'bytedance/seedance-2.5';
const connection = { id: connectionId, providerId: 'openai', providerName: 'Fixture', label: 'Fixture', protocol: 'openai_chat_completions',
  baseUrl: 'https://openrouter.ai/api/v1', updatedAt: '2026-10-08T00:00:00.000Z' };
const facts = supportsGenerateAudio => ({ ...videoModelGuide(model), source: 'listing', resolutions: ['720p'], aspectRatios: ['16:9'],
  clipSeconds: [5], frameImages: ['first_frame'], ...(supportsGenerateAudio === undefined ? {} : { supportsGenerateAudio }) });
const listing = (audio, listedModel = model) => ({ data: [{ id: listedModel, supported_durations: [5], supported_resolutions: ['720p'],
  supported_aspect_ratios: ['16:9'], supported_frame_images: ['first_frame'], ...(audio === undefined ? {} : { generate_audio: audio }) }] });

function compile(requestAudio) {
  const videoFacts = facts(true), policy = buildOfficialCanvasAdapterPolicy(connection, model, { kind: 'video', videoFacts });
  const capability = buildOfficialCanvasCapability(connection, model, {}, { kind: 'video', videoFacts });
  const request = enqueueRequest(compileCanvasGenerationJob({ canvasId: 'audio-fixture', projectId: 'project-11111111-1111-4111-8111-111111111111',
    nodeId: 'node-fixture', idempotencyKey: `audio-${requestAudio}`, connectionId, capability, adapterPolicy: policy,
    cost: { billing: 'provider_billed', description: 'Offline fixture' },
    snapshot: { modelId: model, capabilityVersion: capability.version, mode: 'textToVideo', prompt: 'The character walks through the doorway',
      inputFingerprint: 'fixture', resolvedInputs: [], parameters: { resolution: '720p', aspectRatio: '16:9', durationSeconds: 5, generateAudio: requestAudio } } }));
  return { request, policy, capability };
}

function transport(answer, { cachedAudio = true, cacheAgeMs = 0, requestAudio = false, marked = true, accepted = false, selectedConnection = connection } = {}) {
  const service = new NextMuxPlatformServiceImpl(), calls = [];
  service.mediaConnection = async () => ({ connection: selectedConnection, apiKey: 'fixture-key' });
  service.openRouterVideoLimitCache.set(validatedBaseUrl(connection.baseUrl, false).toString(), {
    at: Date.now() - cacheAgeMs, models: parseOpenRouterVideoModels(listing(cachedAudio))
  });
  service.remoteTaskOf = () => accepted ? { taskId: 'fixture-task' } : undefined;
  service.noteRemoteTask = async () => {};
  service.timedMediaFetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method, ...(init.body ? { body: JSON.parse(init.body) } : {}) });
    if (String(url).endsWith('/videos/models')) return typeof answer === 'function' ? answer() : Response.json(answer.body, { status: answer.status ?? 200 });
    return Response.json({ id: 'fixture-task', url: 'https://media.openrouter.ai/fixture.mp4', status: 'completed' });
  };
  service.fetchVideoOutput = async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'video/mp4' } });
  service.streamVideoOutput = async () => ({ fixture: 'completed' });
  service.waitForMedia = async () => {};
  const input = { connectionId, model, prompt: 'The character walks through the doorway', durationSeconds: 5, width: 1280, height: 720,
    resolution: '720p', aspectRatio: '16:9', requestAudio, ...(marked ? { audioControlVersion: 1 } : {}) };
  const job = { id: 'media-audio-fixture', idempotencyKey: 'audio-fixture', kind: 'video', sceneId: 'scene-canvas-fixture', input };
  return { service, input, calls, run: () => service.requestOfficialVideo('/fixture', job, input, new AbortController().signal) };
}

for (const requestAudio of [false, true]) test(`canvas choice=${requestAudio} stays explicit through compilation and normalization`, () => {
  const { request, policy } = compile(requestAudio);
  assert.equal(policy.audioRequestEnabled, undefined);
  assert.equal(request.input.requestAudio, requestAudio);
  assert.equal(request.input.audioControlVersion, 1);
});

for (const requestAudio of [false, true]) test(`first versioned submission refreshes exact model metadata and sends boolean audio=${requestAudio}`, async () => {
  const f = transport({ body: listing(true) }, { cachedAudio: false, requestAudio });
  await f.run();
  assert.deepEqual(f.calls.map(call => [call.method, call.url]), [
    ['GET', 'https://openrouter.ai/api/v1/videos/models'], ['POST', 'https://openrouter.ai/api/v1/videos']
  ]);
  assert.deepEqual(f.calls[1].body, { model, prompt: f.input.prompt, duration: 5, generate_audio: requestAudio, aspect_ratio: '16:9', resolution: '720p' });
});

for (const [name, answer] of [
  ['false capability', { body: listing(false) }], ['missing capability', { body: listing(undefined) }],
  ['missing selected model', { body: listing(true, 'another/model') }], ['503', { body: { error: 'offline fixture' }, status: 503 }],
  ['invalid JSON', () => new Response('{invalid', { status: 200 })], ['network failure', () => { throw new Error('offline fixture'); }]
]) test(`cached true cannot authorize an explicit audio request after fresh ${name}; no POST`, async () => {
  const f = transport(answer);
  await assert.rejects(f.run(), { code: 'VIDEO_CAPABILITY_UNSUPPORTED' });
  assert.deepEqual(f.calls.map(call => [call.method, call.url]), [['GET', 'https://openrouter.ai/api/v1/videos/models']]);
});

test('unmarked legacy submission retains valid cache without metadata GET or a new audio field', async () => {
  const f = transport({ body: listing(false) }, { marked: false });
  await f.run();
  assert.deepEqual(f.calls.map(call => call.method), ['POST']);
  assert.equal(Object.hasOwn(f.calls[0].body, 'generate_audio'), false);
});

test('unmarked legacy submission retains expired-cache fallback after metadata503 and original body shape', async () => {
  const f = transport({ body: { error: 'offline fixture' }, status: 503 }, { marked: false, cacheAgeMs: 7 * 60 * 60 * 1000 });
  await f.run();
  assert.deepEqual(f.calls.map(call => call.method), ['GET', 'POST']);
  assert.equal(Object.hasOwn(f.calls[1].body, 'generate_audio'), false);
});

test('accepted marked task resumes its original status GET without metadata lookup or duplicate POST', async () => {
  const f = transport({ body: { error: 'must not be requested' }, status: 503 }, { accepted: true, cachedAudio: false, requestAudio: true });
  await f.run();
  assert.deepEqual(f.calls.map(call => [call.method, call.url]), [['GET', 'https://openrouter.ai/api/v1/videos/fixture-task']]);
});

test('only exact listed standard own support grants the versioned control', () => {
  for (const supportsGenerateAudio of [false, undefined]) assert.equal(buildOfficialCanvasAdapterPolicy(connection, model,
    { kind: 'video', videoFacts: facts(supportsGenerateAudio) }).audioControlVersion, undefined);
  for (const patch of [{ protocol: 'gemini_generate_content' }, { baseUrl: 'https://api.openai.com/v1' }]) {
    assert.equal(buildOfficialCanvasAdapterPolicy({ ...connection, ...patch }, model, { kind: 'video', videoFacts: facts(true) }).audioControlVersion, undefined);
  }
});

test('actual model facts preserve the exact own listing flag and never grant managed control', async () => {
  for (const audio of [true, false, undefined]) {
    const f = transport({ body: listing(audio) }, { cachedAudio: audio });
    // Explicitly seed omission; the transport fixture's omitted option defaults to true.
    f.service.openRouterVideoLimitCache.set(validatedBaseUrl(connection.baseUrl, false).toString(), {
      at: Date.now(), models: parseOpenRouterVideoModels(listing(audio))
    });
    const ownFacts = await f.service.getVideoModelFacts(connectionId, model);
    assert.equal(ownFacts.supportsGenerateAudio, audio);
    assert.equal(Object.hasOwn(ownFacts, 'supportsGenerateAudio'), audio !== undefined);
    assert.equal(f.calls.length, 0);
    const policy = buildOfficialCanvasAdapterPolicy(connection, model, { kind: 'video', videoFacts: ownFacts });
    assert.equal(policy.audioControlVersion, audio === true ? 1 : undefined);
  }
  const f = transport({ body: listing(true) });
  f.service.platformVideoListing = async () => parseOpenRouterVideoModels(listing(true));
  const managedFacts = await f.service.getVideoModelFacts('managed:fixed:11111111-1111-4111-8111-111111111111', model);
  assert.equal(managedFacts.nativeAudio, true);
  assert.equal(Object.hasOwn(managedFacts, 'supportsGenerateAudio'), false);
  assert.equal(f.calls.length, 0);
});

test('managed submission refuses the own control marker before device, catalog or HTTP work', async () => {
  for (const requestAudio of [false, true]) {
    const f = transport({ body: listing(true) }, { requestAudio });
    let deviceReads = 0, catalogReads = 0;
    f.service.deviceId = async () => { deviceReads++; throw new Error('must not read device'); };
    f.service.assertManagedVideoImageInputs = async () => { catalogReads++; throw new Error('must not read catalog'); };
    const input = { ...f.input, connectionId: 'managed:fixed:11111111-1111-4111-8111-111111111111' };
    const job = { id: 'media-audio-fixture', idempotencyKey: 'audio-fixture', kind: 'video', sceneId: 'scene-canvas-fixture', input };
    await assert.rejects(f.service.requestManagedVideo('/fixture', job, input, new AbortController().signal), { code: 'VIDEO_CAPABILITY_UNSUPPORTED' });
    assert.equal(deviceReads, 0); assert.equal(catalogReads, 0); assert.equal(f.calls.length, 0);
  }
});

test('invalid marker, missing boolean and another transport are refused before any metadata or POST', async () => {
  for (const patch of [{ audioControlVersion: 2 }, { requestAudio: undefined }, { requestAudio: 'false' }]) {
    const f = transport({ body: listing(true) }); Object.assign(f.input, patch);
    await assert.rejects(f.run(), { code: 'VIDEO_CAPABILITY_UNSUPPORTED' }); assert.equal(f.calls.length, 0);
  }
  for (const patch of [{ protocol: 'gemini_generate_content' }, { protocol: 'async_media_template' }, { baseUrl: 'https://api.openai.com/v1' }]) {
    const f = transport({ body: listing(true) }, { selectedConnection: { ...connection, ...patch } });
    await assert.rejects(f.run(), { code: 'VIDEO_CAPABILITY_UNSUPPORTED' }); assert.equal(f.calls.length, 0);
  }
});
