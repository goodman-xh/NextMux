import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveCanvasCapability, validateCanvasGenerationParameters } from '@nextmux/comic-core';
import { enqueueRequest } from '@nextmux/media-core';
import { buildManagedCanvasCapability, buildOfficialCanvasCapability } from '../lib/common/nextmux-canvas-capabilities.js';
import { buildManagedCanvasAdapterPolicy, buildOfficialCanvasAdapterPolicy } from '../lib/common/nextmux-canvas-adapter-policy.js';
import { compileCanvasGenerationJob } from '../lib/node/nextmux-canvas-generation.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { videoModelGuide } from '../lib/common/nextmux-video-model-guide.js';
import { managedQuoteId, syntheticManagedVideoProof } from './fixtures/canvas-managed-proof.mjs';

const id = '11111111-1111-4111-8111-111111111111', projectId = 'project-11111111-1111-4111-8111-111111111111';
const connectionId = `managed:fixed:${id}`, cost = { billing: 'platform_billed', description: 'Synthetic managed proof' };
const mediaInput = { firstFrame: true, lastFrame: true, referenceImages: true, maxReferences: 2 };
const offering = ({ model = 'bytedance/seedance-2.0', resolutions = ['720p'], ratios = ['16:9'], durations = [6],
  frameStates = [[false, false], [true, false], [true, true]], counts = [0, 1, 2] } = {}) => ({
  id, registryModelId: '22222222-2222-4222-8222-222222222222', providerName: 'Fixture relay', providerModelCode: model,
  displayName: model, status: 'active', category: 'video', keyPriceQuoteId: managedQuoteId,
  capabilities: ['text_to_video', 'image_to_video', 'reference_to_video', 'native_audio'], mediaInput,
  videoLimits: { resolutions, aspectRatios: ratios, durations, frameImages: ['first_frame', 'last_frame'], shapeQuoteId: managedQuoteId,
    provenShapes: syntheticManagedVideoProof({ resolutions, aspectRatios: ratios, durations, frameStates, referenceCounts: counts }) }
});
const picture = (role, name, order = 0, dimensions = { width: 1918, height: 1080 }) => ({ role, order,
  versionId: `${name}-version`, assetId: `${name}-asset`, kind: 'image', uri: `nextmux.media/${name}.png`,
  metadata: { mimeType: 'image/png', byteLength: 100, ...dimensions } });
const first = picture('firstFrame', 'first'), last = picture('lastFrame', 'last', 1);
const snapshot = (capability, { mode = 'firstLastFrame', inputs = [last, first], resolution = '720p', aspectRatio = 'auto', durationSeconds = 6 } = {}) => ({
  modelId: capability.providerModelId, capabilityVersion: capability.version, mode, prompt: 'Keep the cast in the doorway.',
  inputFingerprint: 'frame-shape-fingerprint', resolvedInputs: inputs, parameters: { resolution, aspectRatio, durationSeconds }
});
const compile = (capability, policy, frozen = snapshot(capability), extra = {}) => enqueueRequest(compileCanvasGenerationJob({
  canvasId: 'shape-canvas', projectId, nodeId: 'shape-node', idempotencyKey: 'same-shape-click', connectionId,
  cost, keyPriceQuoteId: managedQuoteId, capability, adapterPolicy: policy, snapshot: frozen, ...extra
}));

function frozenJobValidation(service, request, frozen, jobId) {
  const record = { nodeId: 'shape-node', idempotencyKey: 'same-shape-click', request, snapshot: frozen, jobId };
  service.canvasStore = () => ({ read: async () => ({ canvas: { id: 'shape-canvas' }, jobs: [{ jobId, idempotencyKey: record.idempotencyKey }] }),
    getRecord: async () => record });
  service.validateCanvasMediaBilling = NextMuxPlatformServiceImpl.prototype.validateCanvasMediaBilling.bind(service);
  return { ...request, id: jobId };
}

test('managed public last-frame proof publishes a registry two-frame mode with explicit frame fields', () => {
  const route = offering(), cap = buildManagedCanvasCapability(route), policy = buildManagedCanvasAdapterPolicy(route);
  const mode = cap.modes.find(value => value.mode === 'firstLastFrame');
  assert.ok(mode);
  assert.equal(mode.firstFrame, true);
  assert.equal(mode.lastFrame, true);
  assert.equal(policy.firstFrameField, 'firstFrameUri');
  const request = compile(cap, policy, snapshot(cap, { aspectRatio: '16:9' }));
  assert.equal(request.input.firstFrameUri, first.uri);
  assert.equal(request.input.lastFrameUri, last.uri);
  assert.equal(request.input.referenceAssetUris, undefined);
  assert.equal(request.input.characterReferenceUris, undefined);
  assert.equal(request.input.aspectRatio, '16:9');
});

test('managed first/last mode requires both public frame flags and a matching resolution proof', () => {
  const route = offering();
  for (const flags of [{ ...mediaInput, lastFrame: false }, { ...mediaInput, firstFrame: false }]) {
    assert.equal(buildManagedCanvasCapability({ ...route, mediaInput: flags }).modes.some(mode => mode.mode === 'firstLastFrame'), false);
  }
  const kling = offering({ model: 'kwaivgi/kling-v3.0-pro', resolutions: ['720p'], counts: [0] });
  assert.equal(buildManagedCanvasCapability(kling).modes.some(mode => mode.mode === 'firstLastFrame'), false);
  assert.ok(buildManagedCanvasCapability(kling).modes.some(mode => mode.mode === 'imageToVideo'));
});

test('managed references require an explicit true flag and a finite public maximum', () => {
  const route = offering({ model: 'fixture-video' });
  for (const patch of [{ referenceImages: false }, { referenceImages: undefined }, { maxReferences: undefined }, { maxReferences: NaN }, { maxReferences: 0 }]) {
    const policy = buildManagedCanvasAdapterPolicy({ ...route, mediaInput: { ...mediaInput, ...patch } });
    assert.equal(policy.maxImageReferences, 0);
    assert.equal(policy.modes.includes('referenceToVideo'), false);
  }
  assert.equal(buildManagedCanvasAdapterPolicy(route).maxImageReferences, 2);
});

test('registry reference mode counts image and character references against the exact proven request', () => {
  const route = offering(), cap = buildManagedCanvasCapability(route), policy = buildManagedCanvasAdapterPolicy(route);
  const inputs = [picture('referenceImage', 'reference', 2), picture('character', 'character', 3)];
  const frozen = snapshot(cap, { mode: 'referenceToVideo', aspectRatio: '16:9', inputs });
  const request = compile(cap, policy, frozen);
  assert.deepEqual(request.input.characterReferenceUris, ['nextmux.media/reference.png', 'nextmux.media/character.png']);
  assert.equal(request.input.firstFrameUri, undefined);
  assert.equal(request.input.lastFrameUri, undefined);
  assert.throws(() => compile(cap, policy, { ...frozen, resolvedInputs: [...inputs, picture('referenceImage', 'extra', 4)] }), { code: 'CANVAS_CAPABILITY_INVALID' });
  assert.throws(() => compile(cap, policy, snapshot(cap, { inputs: [first, last, ...inputs] })), { code: 'CANVAS_CAPABILITY_INVALID' });
});

test('flat managed limits, missing quote binding and malformed shape certificates cannot offer generation', () => {
  const route = offering();
  const cases = [
    { ...route, videoLimits: { ...route.videoLimits, provenShapes: undefined } },
    { ...route, videoLimits: { ...route.videoLimits, provenShapes: [] } },
    { ...route, videoLimits: { ...route.videoLimits, shapeQuoteId: `kq1_${'b'.repeat(64)}` } },
    { ...route, keyPriceQuoteId: undefined },
    { ...route, videoLimits: { ...route.videoLimits, provenShapes: [{ ...route.videoLimits.provenShapes[0], width: 1 }] } },
    { ...route, videoLimits: { ...route.videoLimits, provenShapes: [{ ...route.videoLimits.provenShapes[0], referenceImages: -1 }] } }
  ];
  for (const value of cases) {
    const cap = buildManagedCanvasCapability(value);
    assert.deepEqual(cap.modes, []);
    assert.equal(cap.status, 'unknown');
    assert.ok(cap.sources.some(source => source.includes('videoLimits.provenShapes') || source.includes('shapeQuoteId')));
  }
});

test('managed unproven 21:9 is absent per resolution and auto reports panel issues before billing or submission', async () => {
  const route = offering({ model: 'bytedance/seedance-2.5', resolutions: ['480p', '720p'], ratios: ['16:9', '9:16', '21:9'], counts: [0] });
  // These are explicit synthetic allowed rows; the deliberately rejected aspect has no certificate.
  route.videoLimits.provenShapes = route.videoLimits.provenShapes.filter(row => row.resolution === '480p' && row.aspectRatio === '16:9'
    || row.resolution === '720p' && row.aspectRatio === '9:16');
  const cap = buildManagedCanvasCapability(route), policy = buildManagedCanvasAdapterPolicy(route);
  for (const resolution of ['480p', '720p']) {
    const expected = resolution === '480p' ? '16:9' : '9:16';
    assert.deepEqual(resolveCanvasCapability(cap, { mode: 'textToVideo', resolution }).variant.aspectRatios, [expected]);
    const variant = resolveCanvasCapability(cap, { mode: 'imageToVideo', resolution }).variant;
    assert.deepEqual(variant.aspectRatios, ['auto']);
    assert.deepEqual(variant.derivedAspectRatio.aspectRatios, [expected]);
  }
  const portrait = picture('firstFrame', 'portrait', 0, { width: 768, height: 1376 });
  const validPortrait = snapshot(cap, { mode: 'imageToVideo', inputs: [portrait], resolution: '720p' });
  const portraitRequest = compile(cap, policy, validPortrait);
  assert.equal(portraitRequest.input.aspectRatio, '9:16');
  assert.equal(portraitRequest.input.width, 720);
  assert.equal(portraitRequest.input.height, 1280);
  assert.throws(() => compile(cap, policy, { ...validPortrait, parameters: { ...validPortrait.parameters, resolution: '480p' } }), { code: 'CANVAS_CAPABILITY_INVALID' });
  const wide = picture('firstFrame', 'wide', 0, { width: 2330, height: 1000 });
  const frozen = snapshot(cap, { mode: 'imageToVideo', inputs: [wide], resolution: '480p' });
  const issues = validateCanvasGenerationParameters(cap, frozen.mode, frozen.parameters, frozen.resolvedInputs);
  assert.ok(issues.some(issue => issue.path === 'aspectRatio'));
  assert.match(issues.map(issue => issue.message).join(' '), /aspect|ratio/iu);
  const service = new NextMuxPlatformServiceImpl(), billing = [], posts = [];
  service.validateCanvasMediaBilling = async request => { billing.push(request); };
  service.networkFetch = async (...args) => { posts.push(args); throw new Error('must fail before transport'); };
  await assert.rejects(service.prepareCanvasSnapshot(frozen, { workspaceRoot: '/fixture', connectionId, cost, keyPriceQuoteId: managedQuoteId }, projectId, policy, cap), { code: 'CANVAS_CAPABILITY_INVALID' });
  assert.deepEqual(billing, []);
  assert.deepEqual(posts, []);
});

async function managedTransport(t, route) {
  const root = await mkdtemp(join(tmpdir(), 'canvas-33r-managed-shape-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['first', 'last', 'reference', 'character']) await writeFile(join(root, `${name}.png`), Buffer.from(name));
  const service = new NextMuxPlatformServiceImpl(), calls = [], reads = [], bills = [], capacityUpdates = [];
  service.baseUrl = 'https://platform.fixture.invalid';
  // Keep receipt-only capacity journals and worker metadata inside this transport fixture.
  service.nextmuxDataRoot = () => join(root, 'app-data');
  service.mediaJobStore = async () => ({ setCapacityWaiting: async (jobId, _workerId, waiting, detail) => { capacityUpdates.push({ jobId, waiting, ...detail }); } });
  service.deviceId = async () => 'fixture-device';
  service.getPrivacySettings = async () => ({});
  service.getCatalogOffering = async () => route;
  service.resolveMediaInput = async (_root, uri) => { reads.push(uri); return join(root, uri.slice('nextmux.media/'.length)); };
  service.noteRemoteTask = async (_root, job, remote) => service.acceptedRemoteTasks.set(job.id, remote);
  service.reportVideoMeasurement = async () => {};
  service.fetchVideoOutput = async () => new Response('fixture output');
  service.streamVideoOutput = async () => ({ relativeUri: 'nextmux.media/output.mp4' });
  service.validateCanvasMediaBilling = async request => { bills.push(structuredClone(request)); };
  service.canvasProjectSize = async () => ({ width: 1080, height: 1920 });
  service.networkFetch = async (url, init) => { calls.push({ url: String(url), ...init }); return Response.json({ job: { id, status: 'completed' } }); };
  return { service, root, calls, reads, bills, capacityUpdates };
}

test('compiled managed frames and references match the frozen hold shape and gateway body', async t => {
  // The non-spec fixture isolates transport and full-shape accounting; registry frame modes remain constrained separately.
  const route = offering({ model: 'fixture-video' }), cap = buildManagedCanvasCapability(route), policy = buildManagedCanvasAdapterPolicy(route);
  const reference = picture('referenceImage', 'reference', 2), character = picture('character', 'character', 3);
  const authored = snapshot(cap, { aspectRatio: '16:9', inputs: [last, first, reference, character] });
  const before = structuredClone(authored), f = await managedTransport(t, route);
  const frozen = await f.service.prepareCanvasSnapshot(authored, { workspaceRoot: f.root, connectionId, cost, keyPriceQuoteId: managedQuoteId }, projectId, policy, cap);
  const request = compile(cap, policy, frozen, { canvasSize: { width: 2048, height: 2048 } });
  assert.deepEqual(authored, before);
  assert.equal(request.input.keyPriceQuoteId, managedQuoteId);
  assert.equal(request.input.resolution, '720p');
  assert.equal(request.input.durationSeconds, 6);
  assert.equal(request.input.width, 1280);
  assert.equal(request.input.height, 720);
  assert.equal(request.input.firstFrameUri, first.uri);
  assert.equal(request.input.lastFrameUri, last.uri);
  assert.deepEqual(request.input.characterReferenceUris, [reference.uri, character.uri]);
  assert.equal(request.input.referenceAssetUris, undefined);
  assert.equal(frozen.prompt, authored.prompt, 'prepared snapshot preserves the entire authored shot');
  const preflight = compile(cap, policy, frozen, { canvasSize: { width: 2048, height: 2048 }, includeContinuityDefaults: false });
  assert.deepEqual(f.bills[0].input, preflight.input, 'billing preflight binds the complete frozen shape before continuity defaults');
  assert.equal(request.input.prompt, [
    'Start from the supplied first-frame image. Continue into the requested action without replaying a previous action or holding a still image.',
    'Keep each referenced character distinct, with the same face, hairstyle, body and outfit. Do not swap or merge identities. Use the supplied scene and lighting as the starting state. Follow explicit changes to appearance, scene, action and camera in the shot description.',
    'Reach the supplied last-frame image as the ending state.',
    'Shot description:', frozen.prompt
  ].join('\n'), 'first/last frames and identities add the precise internal instructions exactly once');
  assert.deepEqual({ ...request.input, prompt: frozen.prompt }, preflight.input, 'priced fields and all ordered references are unchanged by continuity');
  assert.deepEqual(f.bills[0].cost, request.cost);
  const job = { ...request, id: 'managed-frame-shape-job' };
  await f.service.requestManagedVideo(f.root, job, request.input, new AbortController().signal);
  assert.deepEqual(f.capacityUpdates, [{ jobId: job.id, waiting: false, capacityReasons: undefined }]);
  const body = JSON.parse(f.calls[0].body);
  assert.equal(body.width, request.input.width);
  assert.equal(body.height, request.input.height);
  assert.equal(body.durationSeconds, request.input.durationSeconds);
  assert.equal(body.width, route.videoLimits.provenShapes.find(row => row.firstFrame && row.lastFrame && row.referenceImages === 2).width);
  assert.equal(body.height, route.videoLimits.provenShapes.find(row => row.firstFrame && row.lastFrame && row.referenceImages === 2).height);
  assert.equal(body.keyPriceQuoteId, request.input.keyPriceQuoteId);
  assert.equal(body.referenceImage.dataBase64, Buffer.from('first').toString('base64'));
  assert.equal(body.lastFrame.dataBase64, Buffer.from('last').toString('base64'));
  assert.equal(body.characterReferences.length, 2);
  assert.throws(() => compile(cap, policy, frozen, { keyPriceQuoteId: `kq1_${'b'.repeat(64)}` }), { code: 'CANVAS_PRICE_QUOTE_CHANGED' });
  const nextQuote = `kq1_${'b'.repeat(64)}`, nextRoute = { ...route, keyPriceQuoteId: nextQuote,
    videoLimits: { ...route.videoLimits, shapeQuoteId: nextQuote } };
  const nextCap = buildManagedCanvasCapability(nextRoute), nextPolicy = buildManagedCanvasAdapterPolicy(nextRoute);
  assert.notEqual(nextCap.version, cap.version);
  assert.throws(() => compile(nextCap, nextPolicy, frozen, { keyPriceQuoteId: nextQuote }), { code: 'CANVAS_CAPABILITY_CHANGED' });
  f.service.getCatalogOffering = async () => { throw new Error('catalog changed after acceptance'); };
  f.service.resolveMediaInput = async () => { throw new Error('image removed after acceptance'); };
  await f.service.requestManagedVideo(f.root, job, request.input, new AbortController().signal);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'GET').length, 1);
  assert.deepEqual(f.reads, ['nextmux.media/first.png', 'nextmux.media/last.png', 'nextmux.media/reference.png', 'nextmux.media/character.png']);
});

test('accepted managed canvas validation preserves the frozen hold without current catalog, quote or frame files', async t => {
  const route = offering(), cap = buildManagedCanvasCapability(route), policy = buildManagedCanvasAdapterPolicy(route);
  const frozen = snapshot(cap, { aspectRatio: '16:9' }), request = compile(cap, policy, frozen), f = await managedTransport(t, route);
  const job = frozenJobValidation(f.service, request, frozen, 'accepted-shape-validation');
  await rm(join(f.root, 'first.png'));
  let catalogs = 0, adapters = 0, uploads = 0;
  f.service.canvasCapability = async () => { catalogs++; throw new Error('catalog unavailable after acceptance'); };
  f.service.canvasAdapterPolicy = async () => { adapters++; throw new Error('quote changed after acceptance'); };
  f.service.resolveMediaInput = async () => { uploads++; throw new Error('first frame removed after acceptance'); };
  const remoteTask = { taskId: id, submittedAt: '2026-09-30T12:00:00.000Z' };
  await f.service.validateCanvasMediaJob(f.root, { ...job, remoteTask });
  f.service.acceptedRemoteTasks.set(job.id, remoteTask);
  await f.service.validateCanvasMediaJob(f.root, job);
  assert.deepEqual([catalogs, adapters, uploads, f.calls.length], [0, 0, 0, 0]);
  await assert.rejects(f.service.validateCanvasMediaJob(f.root, { ...job, cost: { ...job.cost, billing: 'provider_billed' } }), { code: 'COST_CONFIRMATION_REQUIRED' });
  await assert.rejects(f.service.validateCanvasMediaJob(f.root, { ...job, input: { ...job.input, prompt: 'Changed snapshot' } }), { code: 'CANVAS_SNAPSHOT_CHANGED' });
  f.service.acceptedRemoteTasks.clear();
  await assert.rejects(f.service.validateCanvasMediaJob(f.root, job), /catalog unavailable/);
  const nextQuote = `kq1_${'b'.repeat(64)}`;
  f.service.canvasCapability = async () => buildManagedCanvasCapability({ ...route, keyPriceQuoteId: nextQuote,
    videoLimits: { ...route.videoLimits, shapeQuoteId: nextQuote } });
  await assert.rejects(f.service.validateCanvasMediaJob(f.root, job), { code: 'CANVAS_CAPABILITY_CHANGED' });
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
});

const router = { id: 'official-33333333-3333-4333-8333-333333333333', providerId: 'openai', providerName: 'OpenRouter', label: 'Fixture',
  protocol: 'openai_chat_completions', baseUrl: 'https://openrouter.ai/api/v1', updatedAt: '2026-09-30T12:00:00.000Z' };
test('own-key OpenRouter last frames require listing proof and arrive in the provider frame fields', async () => {
  const model = 'kwaivgi/kling-v3.0-pro';
  const videoFacts = { ...videoModelGuide(model), source: 'listing', resolutions: ['720p', '1080p'], aspectRatios: ['16:9'],
    clipSeconds: [6], firstFrame: true, lastFrame: true, frameImages: ['first_frame', 'last_frame'] };
  const cap = buildOfficialCanvasCapability(router, model, {}, { videoFacts }), policy = buildOfficialCanvasAdapterPolicy(router, model, { videoFacts });
  assert.deepEqual(cap.modes.find(mode => mode.mode === 'firstLastFrame').outputVariants.map(variant => variant.resolution.toLowerCase()), ['1080p']);
  for (const facts of [{ ...videoFacts, source: 'guide', frameImages: undefined }, { ...videoFacts, lastFrame: false, frameImages: ['first_frame'] },
    { ...videoFacts, frameImages: ['last_frame'] }]) {
    assert.equal(buildOfficialCanvasCapability(router, model, {}, { videoFacts: facts }).modes.some(mode => mode.mode === 'firstLastFrame'), false);
  }
  const request = compile(cap, policy, snapshot(cap, { resolution: '1080p' }), { connectionId: router.id,
    keyPriceQuoteId: undefined, cost: { billing: 'provider_billed', description: 'Fixture' } });
  assert.equal(request.input.firstFrameUri, first.uri);
  assert.equal(request.input.lastFrameUri, last.uri);
  const service = new NextMuxPlatformServiceImpl(), calls = [], uploads = [];
  service.mediaConnection = async () => ({ connection: router, apiKey: 'fixture-key' });
  service.openRouterVideoLimits = async () => ({ durations: [6], resolutions: ['1080p'], aspectRatios: ['16:9'], frameImages: ['first_frame', 'last_frame'] });
  service.videoReferenceDataUrl = async (_root, uri) => { uploads.push(uri); return `data:image/png;base64,${Buffer.from(uri).toString('base64')}`; };
  service.characterReferenceDataUrls = async () => [];
  service.noteRemoteTask = async () => {};
  service.timedMediaFetch = async (url, init) => { calls.push({ url: String(url), ...init }); return Response.json({ id: 'own-frame-task', status: 'completed', url: 'https://media.openrouter.ai/fixture.mp4' }); };
  service.fetchVideoOutput = async () => new Response('fixture output');
  service.streamVideoOutput = async () => ({ relativeUri: 'nextmux.media/output.mp4' });
  service.waitForMedia = async () => {};
  const job = { ...request, id: 'own-frame-job' };
  await service.requestOfficialVideo('/fixture', job, request.input, new AbortController().signal);
  const body = JSON.parse(calls[0].body);
  assert.deepEqual(body.frame_images.map(frame => frame.frame_type), ['first_frame', 'last_frame']);
  assert.equal(body.resolution, request.input.resolution);
  assert.equal(body.aspect_ratio, '16:9');
  assert.doesNotMatch(calls[0].body, /"auto"/u);
  assert.deepEqual(uploads, ['nextmux.media/first.png', 'nextmux.media/last.png']);
  service.openRouterVideoLimits = async () => { throw new Error('listing changed after acceptance'); };
  service.videoReferenceDataUrl = async () => { throw new Error('no upload after acceptance'); };
  await service.requestOfficialVideo('/fixture', { ...job, remoteTask: { taskId: 'own-frame-task', submittedAt: '2026-09-30T12:00:00.000Z' } }, request.input, new AbortController().signal);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.deepEqual(uploads, ['nextmux.media/first.png', 'nextmux.media/last.png']);
});

test('accepted own-key canvas validation skips listing changes while still checking local connection configuration', async () => {
  const model = 'minimax/hailuo-3-max', videoFacts = { ...videoModelGuide(model), source: 'listing', resolutions: ['480p'],
    aspectRatios: ['16:9'], clipSeconds: [6], firstFrame: true, frameImages: ['first_frame'] };
  const cap = buildOfficialCanvasCapability(router, model, {}, { videoFacts }), policy = buildOfficialCanvasAdapterPolicy(router, model, { videoFacts });
  const frozen = snapshot(cap, { mode: 'imageToVideo', resolution: '480p', inputs: [first] });
  const request = compile(cap, policy, frozen, { connectionId: router.id, keyPriceQuoteId: undefined,
    cost: { billing: 'provider_billed', description: 'Fixture own-key' } });
  const service = new NextMuxPlatformServiceImpl(), job = frozenJobValidation(service, request, frozen, 'accepted-own-validation');
  let listings = 0, reads = 0;
  service.mediaConnection = async () => ({ connection: router, apiKey: 'fixture-key' });
  service.canvasCapability = async () => { listings++; throw new Error('provider listing unavailable'); };
  service.resolveMediaInput = async () => { reads++; throw new Error('first frame removed'); };
  const remoteTask = { taskId: 'accepted-own-task', submittedAt: '2026-09-30T12:00:00.000Z' };
  await service.validateCanvasMediaJob('/fixture', { ...job, remoteTask });
  service.acceptedRemoteTasks.set(job.id, remoteTask);
  await service.validateCanvasMediaJob('/fixture', job);
  assert.deepEqual([listings, reads], [0, 0]);
  service.mediaConnection = async () => ({ connection: { ...router, updatedAt: '2026-09-30T13:00:00.000Z' }, apiKey: 'fixture-key' });
  await assert.rejects(service.validateCanvasMediaJob('/fixture', job), { code: 'CANVAS_CAPABILITY_CHANGED' });
  service.acceptedRemoteTasks.clear();
  await assert.rejects(service.validateCanvasMediaJob('/fixture', job), /provider listing unavailable/);
});
