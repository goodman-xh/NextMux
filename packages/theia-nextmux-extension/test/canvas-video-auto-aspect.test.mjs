import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveCanvasCapability, validateCanvasGenerationParameters } from '@nextmux/comic-core';
import { enqueueRequest } from '@nextmux/media-core';
import { normalizeMediaTemplate } from '@nextmux/model-runtime/media-template';
import { buildManagedCanvasCapability, buildOfficialCanvasCapability } from '../lib/common/nextmux-canvas-capabilities.js';
import { buildManagedCanvasAdapterPolicy, buildOfficialCanvasAdapterPolicy } from '../lib/common/nextmux-canvas-adapter-policy.js';
import { ComicPromptTranslationCache } from '../lib/common/nextmux-comic-prompts.js';
import { videoModelGuide } from '../lib/common/nextmux-video-model-guide.js';
import { compileCanvasGenerationJob } from '../lib/node/nextmux-canvas-generation.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { managedQuoteId, syntheticManagedVideoProof } from './fixtures/canvas-managed-proof.mjs';

const connectionId = 'official-11111111-1111-4111-8111-111111111111';
const projectId = 'project-11111111-1111-4111-8111-111111111111';
const router = { id: connectionId, providerId: 'openai', providerName: 'Fixture', label: 'Fixture', protocol: 'openai_chat_completions',
  baseUrl: 'https://openrouter.ai/api/v1', updatedAt: '2026-09-30T12:00:00.000Z' };
const models = [
  { model: 'minimax/hailuo-3-max', resolution: '480p' },
  { model: 'kwaivgi/kling-v3.0-pro', resolution: '1080p' },
  { model: 'bytedance/seedance-2.5', resolution: '480p' },
  { model: 'alibaba/wan-3.0', resolution: '720p' }
];
const facts = (config, firstFrame = true, ratios = ['16:9', '9:16', '1:1']) => ({ ...videoModelGuide(config.model), source: 'listing',
  resolutions: [config.resolution], aspectRatios: ratios, clipSeconds: [6], firstFrame });
const frame = (overrides = {}) => ({ role: 'firstFrame', order: 1, versionId: 'first-version', assetId: 'first-asset', kind: 'image',
  uri: 'nextmux.media/first.png', metadata: { mimeType: 'image/png', byteLength: 100, width: 1918, height: 1080 }, ...overrides });
const snapshot = (capability, parameters = {}, inputs = [frame()]) => ({ modelId: capability.providerModelId, capabilityVersion: capability.version,
  mode: 'imageToVideo', prompt: 'The character walks through the doorway.', inputFingerprint: 'first-frame-fingerprint', resolvedInputs: inputs,
  parameters: { resolution: capability.modes.find(mode => mode.mode === 'imageToVideo')?.outputVariants[0].resolution, aspectRatio: 'auto', durationSeconds: 6, ...parameters } });
const compile = (capability, policy, frozen = snapshot(capability), extra = {}) => enqueueRequest(compileCanvasGenerationJob({
  canvasId: 'aspect-canvas', projectId, nodeId: 'aspect-node', idempotencyKey: 'aspect-click', connectionId,
  snapshot: frozen, capability, adapterPolicy: policy, cost: { billing: 'provider_billed', description: 'Fixture' }, ...extra }));
const template = (firstFrame = true, aspect = true) => normalizeMediaTemplate({ preset: 'wuyin', kind: 'video', images: 'link',
  seconds: [6], maxReferences: 0, submit: { method: 'POST', path: '{base}/{model}', body: JSON.stringify({ prompt: '{{prompt}}',
    ...(firstFrame ? { first: '{{first_frame}}', last: '{{last_frame}}' } : {}), ...(aspect ? { aspect: '{{aspect_ratio}}' } : {}),
    resolution: '{{resolution}}', seconds: '{{seconds_text}}' }) }, poll: { method: 'GET', path: '{base}/detail?id={id}' } });

for (const config of models) test(`${config.model} has an auto aspect only when its route can carry the first frame`, () => {
  const videoFacts = facts(config), official = buildOfficialCanvasCapability(router, config.model, {}, { videoFacts });
  const noFrame = buildOfficialCanvasCapability(router, config.model, {}, { videoFacts: facts(config, false) });
  const offering = { id: '11111111-1111-4111-8111-111111111111', providerName: 'Relay', providerModelCode: config.model, displayName: config.model,
    status: 'active', category: 'video', keyPriceQuoteId: managedQuoteId, capabilities: ['text_to_video', 'image_to_video', 'native_audio'],
    mediaInput: { firstFrame: true, referenceImages: false, maxReferences: 0 },
    videoLimits: { durations: [6], resolutions: [config.resolution], aspectRatios: ['16:9', '9:16', '1:1'], frameImages: ['first_frame'], shapeQuoteId: managedQuoteId,
      provenShapes: syntheticManagedVideoProof({ resolutions: [config.resolution], aspectRatios: ['16:9', '9:16', '1:1'], durations: [6], frameStates: [[false, false], [true, false]] }) } };
  const managed = buildManagedCanvasCapability(offering);
  const managedNoFrame = buildManagedCanvasCapability({ ...offering, mediaInput: { ...offering.mediaInput, firstFrame: false } });
  const templateRoute = { ...router, protocol: 'async_media_template', providerSettings: { mediaTemplate: template() } };
  const templated = buildOfficialCanvasCapability(templateRoute, config.model, {}, { videoFacts });
  const templateNoFrame = buildOfficialCanvasCapability({ ...templateRoute, providerSettings: { mediaTemplate: template(false) } }, config.model, {}, { videoFacts });
  for (const capability of [official, managed, templated]) {
    const mode = capability.modes.find(candidate => candidate.mode === 'imageToVideo');
    assert.ok(mode, capability.id);
    assert.equal(mode.firstFrame, true);
    assert.deepEqual(mode.outputVariants.map(variant => variant.resolution.toLowerCase()), [config.resolution.toLowerCase()]);
    assert.ok(mode.outputVariants[0].aspectRatios.includes('auto'));
    assert.deepEqual(resolveCanvasCapability(capability, { mode: 'imageToVideo', resolution: mode.outputVariants[0].resolution }).issues, []);
  }
  for (const capability of [noFrame, managedNoFrame, templateNoFrame]) assert.equal(capability.modes.some(mode => mode.mode === 'imageToVideo'), false);
  assert.equal(official.modes.some(mode => mode.mode === 'firstLastFrame'), false);
});

test('Kling two-frame generation keeps the spec 1080p exception when a template carries both frames', () => {
  const config = { model: 'kwaivgi/kling-v3.0-pro', resolution: '1080p' };
  const connection = { ...router, protocol: 'async_media_template', providerSettings: { mediaTemplate: template() } };
  const videoFacts = { ...facts(config), resolutions: ['720p', '1080p'] };
  const cap = buildOfficialCanvasCapability(connection, config.model, {}, { videoFacts });
  const mode = cap.modes.find(candidate => candidate.mode === 'firstLastFrame');
  assert.ok(mode);
  assert.deepEqual(mode.outputVariants.map(variant => variant.resolution.toLowerCase()), ['1080p']);
  assert.deepEqual(mode.outputVariants[0].aspectRatios, ['auto']);
});

test('auto is accepted only in modes whose capability explicitly lists it', () => {
  const config = models[0], cap = buildOfficialCanvasCapability(router, config.model, {}, { videoFacts: facts(config) });
  const resolution = cap.modes.find(mode => mode.mode === 'imageToVideo').outputVariants[0].resolution;
  assert.deepEqual(validateCanvasGenerationParameters(cap, 'imageToVideo', { resolution, aspectRatio: 'auto', durationSeconds: 6 }, [frame()]), []);
  assert.ok(validateCanvasGenerationParameters(cap, 'textToVideo', { resolution, aspectRatio: 'auto', durationSeconds: 6 })
    .some(issue => issue.code === 'ASPECT_RATIO_INVALID'));
});

test('Veo Fast reference-mode auto follows the first ordered image reference', () => {
  const config = { model: 'video_veo3.1_fast', resolution: '720p' };
  const routeTemplate = normalizeMediaTemplate({ ...template(), seconds: [8], maxReferences: 3,
    submit: { ...template().submit, body: '{"prompt":"{{prompt}}","refs":"{{references}}","aspect":"{{aspect_ratio}}","resolution":"{{resolution}}"}' } });
  const connection = { ...router, protocol: 'async_media_template', providerSettings: { mediaTemplate: routeTemplate } };
  const videoFacts = { ...facts(config), clipSeconds: [8] };
  const cap = buildOfficialCanvasCapability(connection, config.model, {}, { videoFacts }), policy = buildOfficialCanvasAdapterPolicy(connection, config.model, { videoFacts });
  const mode = cap.modes.find(candidate => candidate.mode === 'referenceToVideo');
  assert.ok(mode.outputVariants[0].aspectRatios.includes('auto'));
  const first = frame({ role: 'referenceImage', order: 0 }), second = frame({ role: 'referenceImage', order: 1, versionId: 'second-version', assetId: 'second-asset', uri: 'nextmux.media/second.png',
    metadata: { ...frame().metadata, width: 1080, height: 1920 } });
  const frozen = { ...snapshot(cap, { resolution: mode.outputVariants[0].resolution, durationSeconds: 8 }, [first, second]), mode: 'referenceToVideo' };
  const request = compile(cap, policy, frozen);
  assert.equal(request.input.aspectRatio, '16:9');
  assert.equal(request.input.aspectRatioSource, 'referenceImage');
  assert.deepEqual(request.input.characterReferenceUris, [first.uri, second.uri]);
  assert.equal(request.input.referenceAssetUris, undefined);
});

test('auto follows the first-frame role, rounds to a nearby listed aspect, and preserves the frozen request', () => {
  const config = models[0], videoFacts = facts(config), cap = buildOfficialCanvasCapability(router, config.model, {}, { videoFacts });
  const policy = buildOfficialCanvasAdapterPolicy(router, config.model, { videoFacts });
  const first = frame(), last = frame({ role: 'lastFrame', order: 0, versionId: 'last-version', assetId: 'last-asset', uri: 'nextmux.media/last.png', metadata: { ...frame().metadata, width: 1080, height: 1920 } });
  const frozen = { ...snapshot(cap, {}, [first]), resolvedInputs: [first] }, before = structuredClone(frozen);
  const request = compile(cap, policy, frozen, { canvasSize: { width: 1080, height: 1920 } });
  assert.equal(request.input.aspectRatio, '16:9');
  assert.equal(request.input.resolution.toLowerCase(), '480p');
  assert.equal(request.input.referenceAssetUris, undefined);
  assert.equal(request.input.firstFrameUri, first.uri);
  assert.ok(Math.abs(request.input.width / request.input.height - 16 / 9) < 0.01);
  assert.deepEqual(frozen, before);
  // A last frame sorted before the first one must never supply the auto aspect.
  const templateRoute = { ...router, protocol: 'async_media_template', providerSettings: { mediaTemplate: template() } };
  const both = buildOfficialCanvasCapability(templateRoute, config.model, {}, { videoFacts });
  const bothPolicy = buildOfficialCanvasAdapterPolicy(templateRoute, config.model, { videoFacts });
  const twoFrames = { ...snapshot(both, {}, [last, first]), mode: 'firstLastFrame' };
  assert.equal(compile(both, bothPolicy, twoFrames).input.aspectRatio, '16:9');
});

test('auto requires measured first-frame dimensions before a request can be queued', () => {
  const config = models[1], videoFacts = facts(config), cap = buildOfficialCanvasCapability(router, config.model, {}, { videoFacts });
  const policy = buildOfficialCanvasAdapterPolicy(router, config.model, { videoFacts });
  assert.throws(() => compile(cap, policy, snapshot(cap, {}, [frame({ metadata: { mimeType: 'image/png', byteLength: 100 } })])), { code: 'CANVAS_CAPABILITY_INVALID' });
  assert.throws(() => compile(cap, policy, snapshot(cap, {}, [frame({ metadata: { ...frame().metadata, width: 0 } })])));
});

test('managed auto uses a measured ratio but refuses omission before enqueue', () => {
  const config = models[0], offering = { id: '11111111-1111-4111-8111-111111111111', providerName: 'Relay', providerModelCode: config.model,
    displayName: 'H3 Max', status: 'active', category: 'video', keyPriceQuoteId: managedQuoteId, capabilities: ['text_to_video', 'image_to_video', 'native_audio'],
    mediaInput: { firstFrame: true, referenceImages: false, maxReferences: 0 },
    videoLimits: { durations: [6], resolutions: ['480p'], aspectRatios: ['16:9'], frameImages: ['first_frame'], shapeQuoteId: managedQuoteId,
      provenShapes: syntheticManagedVideoProof({ resolutions: ['480p'], aspectRatios: ['16:9'], durations: [6], frameStates: [[false, false], [true, false]] }) } };
  const videoFacts = facts(config, true, ['16:9']);
  const cap = buildManagedCanvasCapability(offering, {}, { videoFacts }), policy = buildManagedCanvasAdapterPolicy(offering, { videoFacts });
  const request = compile(cap, policy, snapshot(cap), { connectionId: `managed:fixed:${offering.id}`, keyPriceQuoteId: managedQuoteId,
    cost: { billing: 'platform_billed', description: 'Fixture managed' } });
  assert.equal(request.input.aspectRatio, '16:9');
  assert.equal(request.input.aspectRatioSource, 'firstFrame');
  assert.equal(request.input.resolution.toLowerCase(), '480p');
  assert.equal(request.input.referenceAssetUris, undefined);
  assert.equal(request.input.firstFrameUri, frame().uri);
  const square = frame({ metadata: { ...frame().metadata, width: 1024, height: 1024 } });
  assert.throws(() => compile(cap, policy, snapshot(cap, {}, [square]), { connectionId: `managed:fixed:${offering.id}`,
    cost: { billing: 'platform_billed', description: 'Fixture managed' }, keyPriceQuoteId: managedQuoteId }), { code: 'CANVAS_CAPABILITY_INVALID' });
  const noRatio = buildManagedCanvasCapability({ ...offering, videoLimits: { ...offering.videoLimits, aspectRatios: ['auto'] } }, {},
    { videoFacts: facts(config, true, ['auto']) });
  assert.equal(noRatio.modes.some(mode => mode.mode === 'imageToVideo'), false);
  assert.ok(noRatio.sources.some(source => source.includes('auto-no-measured-ratio-or-omission')));
});

test('auto freezes the frame-shaped dimensions while retaining the authored option and billing inputs', async () => {
  const config = models[0], videoFacts = { ...facts(config), resolutions: [] };
  const cap = buildOfficialCanvasCapability(router, config.model, {}, { videoFacts }), policy = buildOfficialCanvasAdapterPolicy(router, config.model, { videoFacts });
  const authored = snapshot(cap, { resolution: 'auto' }), { service } = routerTransport();
  const bills = [];
  service.canvasProjectSize = async () => ({ width: 1080, height: 1920 });
  service.validateCanvasMediaBilling = async request => { bills.push(structuredClone(request)); };
  const frozen = await service.prepareCanvasSnapshot(authored, { workspaceRoot: '/fixture', connectionId,
    cost: { billing: 'provider_billed', description: 'Fixture' } }, projectId, policy, cap);
  assert.equal(frozen.parameters.aspectRatio, 'auto');
  const request = compile(cap, policy, frozen, { canvasSize: { width: 2048, height: 2048 } });
  assert.equal(request.input.aspectRatio, '16:9');
  assert.equal(request.input.width, frozen.parameters.width);
  assert.equal(request.input.height, frozen.parameters.height);
  assert.equal(request.input.keyPriceQuoteId, undefined);
  assert.equal(request.input.durationSeconds, 6);
  assert.equal(request.input.requestAudio, false);
  assert.equal(request.cost.billing, 'provider_billed');
  assert.equal(bills.length, 1);
  assert.equal(bills[0].input.keyPriceQuoteId, request.input.keyPriceQuoteId);
  assert.equal(bills[0].input.resolution, request.input.resolution);
  assert.equal(bills[0].input.durationSeconds, request.input.durationSeconds);
  assert.equal(bills[0].input.requestAudio, request.input.requestAudio);
});

test('managed aspect resolution preserves the price authorization, duration, resolution and audio inputs', async () => {
  const config = models[0], offering = { id: '11111111-1111-4111-8111-111111111111', providerName: 'Relay', providerModelCode: config.model,
    displayName: 'H3 Max', status: 'active', category: 'video', keyPriceQuoteId: managedQuoteId, capabilities: ['text_to_video', 'image_to_video', 'native_audio'],
    mediaInput: { firstFrame: true, referenceImages: false, maxReferences: 0 },
    videoLimits: { durations: [6], resolutions: ['480p'], aspectRatios: ['16:9'], frameImages: ['first_frame'], shapeQuoteId: managedQuoteId,
      provenShapes: syntheticManagedVideoProof({ resolutions: ['480p'], aspectRatios: ['16:9'], durations: [6], frameStates: [[false, false], [true, false]] }) } };
  const videoFacts = facts(config, true, ['16:9']), cap = buildManagedCanvasCapability(offering, {}, { videoFacts });
  const policy = buildManagedCanvasAdapterPolicy(offering, { videoFacts }), { service } = routerTransport();
  const bills = [], quoteId = `kq1_${'a'.repeat(64)}`, managedConnection = `managed:fixed:${offering.id}`;
  const cost = { billing: 'platform_billed', description: 'Fixture managed' };
  service.validateCanvasMediaBilling = async request => { bills.push(structuredClone(request)); };
  const frozen = await service.prepareCanvasSnapshot(snapshot(cap), { workspaceRoot: '/fixture', connectionId: managedConnection,
    cost, keyPriceQuoteId: quoteId }, projectId, policy, cap);
  const request = compile(cap, policy, frozen, { connectionId: managedConnection, cost, keyPriceQuoteId: quoteId });
  assert.equal(frozen.parameters.aspectRatio, 'auto');
  assert.equal(request.input.aspectRatio, '16:9');
  assert.equal(request.input.keyPriceQuoteId, quoteId);
  assert.equal(request.input.resolution.toLowerCase(), '480p');
  assert.equal(request.input.durationSeconds, 6);
  assert.equal(request.input.requestAudio, false);
  assert.equal(request.cost.billing, cost.billing);
  assert.equal(request.cost.description, cost.description);
  assert.equal(bills.length, 1);
  assert.equal(frozen.prompt, snapshot(cap).prompt, 'prepared snapshot retains the complete authored shot');
  const preflight = compile(cap, policy, frozen, { connectionId: managedConnection, keyPriceQuoteId: quoteId, cost, includeContinuityDefaults: false });
  assert.deepEqual(bills[0].input, preflight.input, 'billing preflight uses authored text and the same complete output shape');
  assert.equal(request.input.prompt, [
    'Start from the supplied first-frame image. Continue into the requested action without replaying a previous action or holding a still image.',
    'Keep each referenced character distinct, with the same face, hairstyle, body and outfit. Do not swap or merge identities. Use the supplied scene and lighting as the starting state. Follow explicit changes to appearance, scene, action and camera in the shot description.',
    'Shot description:', frozen.prompt
  ].join('\n'), 'queued first-frame video adds continuity once without changing the shot');
  assert.deepEqual({ ...request.input, prompt: frozen.prompt }, preflight.input, 'continuity only changes the transmitted prompt; priced generation fields remain exact');
  assert.deepEqual(bills[0].cost, request.cost);
});

function routerTransport(listed) {
  const service = new NextMuxPlatformServiceImpl(), calls = [], uploads = [];
  service.mediaConnection = async () => ({ connection: router, apiKey: 'fixture-key' });
  service.openRouterVideoLimits = async () => listed;
  service.videoReferenceDataUrl = async (_root, uri) => { uploads.push(uri); return 'data:image/png;base64,ZmFrZQ=='; };
  service.characterReferenceDataUrls = async () => [];
  service.noteRemoteTask = async () => {};
  service.timedMediaFetch = async (url, init) => {
    calls.push({ url: String(url), ...init });
    return Response.json({ id: 'fixture-provider-task', url: 'https://media.openrouter.ai/fixture.mp4', status: 'completed' });
  };
  service.fetchVideoOutput = async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'video/mp4' } });
  service.streamVideoOutput = async () => ({ fixture: 'completed' });
  service.waitForMedia = async () => {};
  service.comicCanvasPromptTranslations = new ComicPromptTranslationCache();
  service.validateCanvasMediaBilling = async () => {};
  return { service, calls, uploads };
}

test('OpenRouter bodies receive a measured ratio and never the literal auto option', async () => {
  const config = models[0], videoFacts = facts(config), cap = buildOfficialCanvasCapability(router, config.model, {}, { videoFacts });
  const policy = buildOfficialCanvasAdapterPolicy(router, config.model, { videoFacts });
  const request = compile(cap, policy);
  const { service, calls } = routerTransport({ durations: [6], resolutions: ['480p'], aspectRatios: ['16:9', '9:16', '1:1'], frameImages: ['first_frame'] });
  await service.requestOfficialVideo('/fixture', { ...request, id: 'aspect-job' }, request.input, new AbortController().signal);
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].body);
  assert.equal(body.aspect_ratio, '16:9');
  assert.equal(body.resolution.toLowerCase(), '480p');
  assert.equal(body.frame_images[0].frame_type, 'first_frame');
  assert.doesNotMatch(calls[0].body, /"auto"/u);
});

for (const fixture of [
  { model: 'minimax/hailuo-3-max', resolution: '480p', resolutions: ['480p', '768p'], width: 1918, height: 1080, aspect: '16:9' },
  { model: 'minimax/hailuo-3-max', resolution: '768p', resolutions: ['480p', '768p'], width: 768, height: 1376, aspect: '9:16' },
  { model: 'minimax/hailuo-3', resolution: '2K', resolutions: ['768p', '2K'], width: 768, height: 1376, aspect: '9:16' }
]) test(`${fixture.model} auto keeps its exact selected ${fixture.resolution} in the provider body`, async () => {
  const config = { model: fixture.model, resolution: fixture.resolution }, videoFacts = { ...facts(config), resolutions: fixture.resolutions };
  const cap = buildOfficialCanvasCapability(router, config.model, {}, { videoFacts });
  if (fixture.model === 'minimax/hailuo-3') assert.deepEqual(cap.modes.find(mode => mode.mode === 'imageToVideo').outputVariants.map(variant => variant.resolution.toLowerCase()), ['2k']);
  const first = frame({ metadata: { ...frame().metadata, width: fixture.width, height: fixture.height } });
  const request = compile(cap, buildOfficialCanvasAdapterPolicy(router, config.model, { videoFacts }), snapshot(cap, { resolution: fixture.resolution }, [first]));
  assert.equal(request.input.resolution, fixture.resolution);
  assert.equal(request.input.aspectRatio, fixture.aspect);
  const { service, calls } = routerTransport({ durations: [6], resolutions: fixture.resolutions, aspectRatios: ['16:9', '9:16', '1:1'], frameImages: ['first_frame'] });
  await service.requestOfficialVideo('/fixture', { ...request, id: `aspect-${fixture.resolution}-job` }, request.input, new AbortController().signal);
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].body);
  assert.equal(body.resolution, request.input.resolution);
  assert.equal(body.aspect_ratio, fixture.aspect);
});

test('OpenRouter auto omits the ratio when no listed ratio closely matches the measured frame', async () => {
  const config = models[0], videoFacts = facts(config, true, ['16:9']), cap = buildOfficialCanvasCapability(router, config.model, {}, { videoFacts });
  const policy = buildOfficialCanvasAdapterPolicy(router, config.model, { videoFacts });
  const square = frame({ metadata: { ...frame().metadata, width: 1024, height: 1024 } });
  const request = compile(cap, policy, snapshot(cap, {}, [square]));
  assert.equal(request.input.aspectRatio, undefined);
  assert.equal(request.input.aspectRatioSource, 'firstFrame');
  const { service, calls } = routerTransport({ durations: [6], resolutions: ['480p'], aspectRatios: ['16:9'], frameImages: ['first_frame'] });
  await service.requestOfficialVideo('/fixture', { ...request, id: 'aspect-job' }, request.input, new AbortController().signal);
  const body = JSON.parse(calls[0].body);
  assert.equal(Object.hasOwn(body, 'aspect_ratio'), false);
  assert.equal(body.frame_images[0].frame_type, 'first_frame');
  assert.doesNotMatch(calls[0].body, /"auto"/u);
});

test('an accepted auto first-frame task resumes with no provider POST or image upload', async () => {
  const config = models[0], videoFacts = facts(config), cap = buildOfficialCanvasCapability(router, config.model, {}, { videoFacts });
  const request = compile(cap, buildOfficialCanvasAdapterPolicy(router, config.model, { videoFacts }));
  const { service, calls, uploads } = routerTransport({ durations: [10], resolutions: ['768p'], aspectRatios: ['9:16'], frameImages: [] });
  service.timedMediaFetch = async (url, init) => { calls.push({ url: String(url), ...init });
    return Response.json({ id: 'fixture-provider-task', url: 'https://media.openrouter.ai/fixture.mp4', status: 'completed' }); };
  const job = { ...request, id: 'aspect-job', remoteTask: { taskId: 'fixture-provider-task', submittedAt: '2026-09-30T12:00:00.000Z' } };
  await service.requestOfficialVideo('/fixture', job, request.input, new AbortController().signal);
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
  assert.deepEqual(uploads, []);
});

async function templateTransport(t, config, routeTemplate, videoFacts, inputFrame = frame()) {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-33q-auto-aspect-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const picture = join(directory, 'first.png');
  await writeFile(picture, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOyEAAAAASUVORK5CYII=', 'base64'));
  const connection = { ...router, protocol: 'async_media_template', baseUrl: 'https://api.fixture.invalid', providerSettings: { mediaTemplate: routeTemplate } };
  const cap = buildOfficialCanvasCapability(connection, config.model, {}, { videoFacts }), policy = buildOfficialCanvasAdapterPolicy(connection, config.model, { videoFacts });
  const request = compile(cap, policy, snapshot(cap, {}, [inputFrame]));
  const { service, calls } = routerTransport();
  service.mediaConnection = async () => ({ connection, apiKey: 'fixture-key' });
  service.resolveMediaInput = async () => picture;
  service.referenceDropUrl = async () => 'https://assets.fixture.invalid/first.png';
  service.timedMediaFetch = async (url, init) => {
    calls.push({ url: String(url), ...init });
    return Response.json(init.method === 'POST' ? { data: { id: 'fixture-provider-task' } }
      : { data: { status: '2', result: 'https://media.fixture.invalid/clip.mp4' } });
  };
  await service.requestOfficialVideo('/fixture', { ...request, id: 'aspect-template-job' }, request.input, new AbortController().signal);
  const posts = calls.filter(call => call.method === 'POST');
  assert.equal(posts.length, 1);
  assert.doesNotMatch(posts[0].body, /"auto"/u);
  return { request, body: JSON.parse(posts[0].body) };
}

test('a complete template aspect field receives the measured nearest ratio', async t => {
  const config = models[0], { request, body } = await templateTransport(t, config, template(), facts(config));
  assert.equal(request.input.aspectRatio, '16:9');
  assert.equal(body.aspect, '16:9');
  assert.equal(body.first, 'https://assets.fixture.invalid/first.png');
});

test('a complete template aspect field is omitted when no listed ratio is close', async t => {
  const config = models[0], square = frame({ metadata: { ...frame().metadata, width: 1024, height: 1024 } });
  const { request, body } = await templateTransport(t, config, template(), facts(config, true, ['16:9']), square);
  assert.equal(request.input.aspectRatio, undefined);
  assert.equal(Object.hasOwn(body, 'aspect'), false);
  assert.equal(body.first, 'https://assets.fixture.invalid/first.png');
});

test('a template with no aspect placeholder needs only its first-frame field', async t => {
  const config = models[0], { body } = await templateTransport(t, config, template(true, false), facts(config));
  assert.equal(Object.hasOwn(body, 'aspect'), false);
  assert.equal(body.first, 'https://assets.fixture.invalid/first.png');
});

test('an embedded aspect placeholder cannot silently erase an unmatched measured ratio', () => {
  const config = models[0], videoFacts = facts(config, true, ['16:9']);
  const embedded = normalizeMediaTemplate({ ...template(), submit: { ...template().submit,
    body: '{"prompt":"{{prompt}} aspect={{aspect_ratio}}","first":"{{first_frame}}","resolution":"{{resolution}}"}' } });
  const connection = { ...router, protocol: 'async_media_template', providerSettings: { mediaTemplate: embedded } };
  const cap = buildOfficialCanvasCapability(connection, config.model, {}, { videoFacts }), policy = buildOfficialCanvasAdapterPolicy(connection, config.model, { videoFacts });
  const square = frame({ metadata: { ...frame().metadata, width: 1024, height: 1024 } });
  assert.throws(() => compile(cap, policy, snapshot(cap, {}, [square])), { code: 'CANVAS_CAPABILITY_INVALID' });
});
