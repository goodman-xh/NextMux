import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueRequest } from '@nextmux/media-core';
import { resolveCanvasCapability, validateCanvasGenerationParameters } from '@nextmux/comic-core';
import { buildManagedCanvasCapability, buildOfficialCanvasCapability } from '../lib/common/nextmux-canvas-capabilities.js';
import { buildManagedCanvasAdapterPolicy, buildOfficialCanvasAdapterPolicy, canvasAdapterInputIssues } from '../lib/common/nextmux-canvas-adapter-policy.js';
import { videoModelGuide } from '../lib/common/nextmux-video-model-guide.js';
import { compileCanvasGenerationJob } from '../lib/node/nextmux-canvas-generation.js';
import { managedQuoteId, syntheticManagedVideoProof } from './fixtures/canvas-managed-proof.mjs';

const connectionId = 'official-11111111-1111-4111-8111-111111111111';
const connection = (extra = {}) => ({ id: connectionId, providerId: 'openai', providerName: 'Fixture', label: 'Fixture', protocol: 'openai_chat_completions',
  baseUrl: 'https://openrouter.ai/api/v1', updatedAt: '2026-09-30T12:00:00.000Z', ...extra });
const offering = (extra = {}) => ({ id: '11111111-1111-4111-8111-111111111111', providerName: 'Fixture relay', providerModelCode: 'bytedance/seedance-2.0', displayName: 'Seedance 2.0', status: 'active', capabilities: ['text_to_video', 'image_to_video'],
  keyPriceQuoteId: managedQuoteId, mediaInput: { firstFrame: true, referenceImages: false, maxReferences: 0 },
  videoLimits: { durations: [6, 10], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16'], shapeQuoteId: managedQuoteId,
    provenShapes: syntheticManagedVideoProof({ resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16'], durations: [6, 10], frameStates: [[false, false], [true, false]] }) }, ...extra });
const reference = (role, index = 1) => ({ role, order: index, versionId: `version-${index}`, assetId: `asset-${index}`, kind: 'image', uri: `nextmux.media/picture-${index}.png`,
  metadata: { mimeType: 'image/png', byteLength: 100, width: 1024, height: 1024 } });
const snapshot = (capability, mode, resolvedInputs = [], parameters = {}) => ({ modelId: capability.providerModelId, capabilityVersion: capability.version, mode,
  prompt: 'Frozen scene with the cast in the doorway', inputFingerprint: 'fixture-fingerprint', resolvedInputs,
  parameters: { resolution: '720p', aspectRatio: '16:9', ...(mode.includes('Image') ? {} : { durationSeconds: 6 }), ...parameters } });
const compile = (capability, policy, mode, refs = [], parameters = {}, extra = {}) => enqueueRequest(compileCanvasGenerationJob({
  canvasId: 'canvas-fixture', projectId: 'project-11111111-1111-4111-8111-111111111111', nodeId: 'node-fixture', idempotencyKey: 'fixture-click',
  connectionId, cost: { billing: 'provider_billed', description: 'Fixture' }, snapshot: snapshot(capability, mode, refs, parameters), capability, adapterPolicy: policy, ...extra }));

test('managed video sends its first frame through the explicit field and preserves the proven shape', () => {
  const route = offering(), cap = buildManagedCanvasCapability(route), policy = buildManagedCanvasAdapterPolicy(route);
  const frame = reference('firstFrame');
  const request = compile(cap, policy, 'imageToVideo', [frame], {}, { connectionId: `managed:fixed:${route.id}`, keyPriceQuoteId: managedQuoteId });
  assert.equal(request.input.referenceAssetUris, undefined);
  assert.equal(request.input.firstFrameUri, frame.uri);
  assert.equal(request.input.requestAudio, false);
  assert.equal(request.input.requestSubtitles, false);
  assert.equal(request.input.durationSeconds, 6);
  assert.deepEqual(canvasAdapterInputIssues(policy, 'video', request.input), []);
});

test('OpenRouter Hailuo narrows live listing facts and retains the measured auto-frame mode', () => {
  const model = 'minimax/hailuo-3-max', route = connection();
  const videoFacts = { ...videoModelGuide(model), source: 'listing', resolutions: ['480p', '768p'], aspectRatios: ['16:9', '9:16'], clipSeconds: [5, 6, 10, 15] };
  const cap = buildOfficialCanvasCapability(route, model, {}, { videoFacts });
  const policy = buildOfficialCanvasAdapterPolicy(route, model, { videoFacts });
  assert.deepEqual(cap.modes.map(mode => mode.mode), ['textToVideo', 'imageToVideo']);
  const resolution = cap.modes[0].outputVariants[0].resolution;
  assert.equal(resolveCanvasCapability(cap, { mode: 'textToVideo', resolution }).issues.length, 0);
  const frame = reference('firstFrame');
  const request = compile(cap, policy, 'textToVideo', [], { resolution });
  assert.equal(request.input.referenceAssetUris, undefined);
  assert.equal(request.input.firstFrameUri, undefined);
  assert.equal(request.input.requestAudio, false);
  const frameRequest = compile(cap, policy, 'imageToVideo', [{ ...frame, metadata: { ...frame.metadata, width: 1920, height: 1080 } }], { resolution, aspectRatio: 'auto' });
  assert.equal(frameRequest.input.referenceAssetUris, undefined);
  assert.equal(frameRequest.input.firstFrameUri, frame.uri);
  assert.equal(frameRequest.input.aspectRatio, '16:9');
  assert.notEqual(cap.version, buildOfficialCanvasCapability(route, model, {}, { videoFacts: { ...videoFacts, clipSeconds: [6] } }).version);
});

test('template video transmits dedicated first/last frame and every allowed identity reference', () => {
  const route = connection({ protocol: 'async_media_template', providerSettings: { mediaTemplate: { kind: 'video', images: 'link', maxReferences: 2, seconds: [6],
    submit: { body: '{"prompt":"{{prompt}}","first":"{{first_frame}}","last":"{{last_frame}}","references":"{{references}}","resolution":"720p","aspect_ratio":"16:9"}' } } } });
  const cap = buildOfficialCanvasCapability(route, 'opaque-video'), policy = buildOfficialCanvasAdapterPolicy(route, 'opaque-video');
  const first = reference('firstFrame'), last = reference('lastFrame', 2), portrait = reference('referenceImage', 3);
  const request = compile(cap, policy, 'firstLastFrame', [first, last, portrait]);
  assert.equal(request.input.firstFrameUri, first.uri);
  assert.equal(request.input.lastFrameUri, last.uri);
  assert.deepEqual(request.input.characterReferenceUris, [portrait.uri]);
  assert.equal(request.input.referenceAssetUris, undefined);
});

for (const [name, route, model] of [
  ['OpenRouter Flux', connection(), 'black-forest-labs/flux.2-pro'],
  ['Gemini', connection({ protocol: 'gemini_generate_content', baseUrl: 'https://generativelanguage.googleapis.com' }), 'gemini-3.1-flash-image'],
]) test(`${name} image routes declare their provider-default output and retain ordered references`, () => {
  const cap = buildOfficialCanvasCapability(route, model), policy = buildOfficialCanvasAdapterPolicy(route, model);
  assert.deepEqual(cap.modes.map(mode => mode.mode), ['textToImage', 'imageToImage']);
  const refs = [reference('referenceImage', 3), reference('referenceImage', 1)];
  const request = compile(cap, policy, 'imageToImage', refs, { resolution: 'auto', aspectRatio: '9:16', width: 720, height: 1280 });
  assert.deepEqual(request.input.characterReferenceUris, refs.map(ref => ref.uri));
  assert.equal(request.input.width, 720);
  assert.equal(request.input.height, 1280);
  assert.equal(cap.modes[0].outputVariants[0].dimensions, undefined);
  assert.throws(() => compile(cap, policy, 'imageToImage', refs, { resolution: 'auto', aspectRatio: '9:16', width: 1280, height: 720 }), { code: 'CANVAS_DIMENSIONS_INVALID' });
});

test('managed image references use characterReferenceUris and obey the exact catalog limit', () => {
  const route = offering({ category: 'image', providerModelCode: 'google/gemini-3.1-flash-image', capabilities: ['image_generation'], videoLimits: undefined,
    managedTransport: { protocol: 'gemini' }, mediaInput: { referenceImages: true, maxReferences: 2 } });
  const cap = buildManagedCanvasCapability(route), policy = buildManagedCanvasAdapterPolicy(route);
  assert.deepEqual(cap.modes.map(mode => mode.mode), ['textToImage', 'imageToImage']);
  const refs = [reference('referenceImage', 1), reference('referenceImage', 2)];
  const request = compile(cap, policy, 'imageToImage', refs, { resolution: 'auto', aspectRatio: '9:16', width: 720, height: 1280 });
  assert.deepEqual(request.input.characterReferenceUris, refs.map(ref => ref.uri));
  assert.throws(() => compile(cap, policy, 'imageToImage', [...refs, reference('referenceImage', 3)], { resolution: 'auto', width: 1280, height: 720 }), { code: 'CANVAS_CAPABILITY_INVALID' });
});

test('unsupported inputs fail before enqueue rather than being dropped by a transport', () => {
  const route = offering(), cap = buildManagedCanvasCapability(route), policy = buildManagedCanvasAdapterPolicy(route), frame = reference('firstFrame');
  assert.throws(() => compile(cap, policy, 'imageToVideo', []));
  assert.equal(compile(cap, policy, 'imageToVideo', [frame], { generateAudio: false }, { keyPriceQuoteId: managedQuoteId, connectionId: `managed:fixed:${route.id}` }).input.requestAudio, false);
  assert.throws(() => compile(cap, policy, 'imageToVideo', [frame], { generateAudio: true }), { code: 'CANVAS_CAPABILITY_INVALID' });
  assert.throws(() => compile(cap, policy, 'imageToVideo', [frame, reference('referenceImage', 2)]), { code: 'CANVAS_CAPABILITY_INVALID' });
  assert.deepEqual(canvasAdapterInputIssues(policy, 'video', { connectionId, model: cap.providerModelId, prompt: 'Scene', width: 1280, height: 720,
    resolution: '720p', aspectRatio: '16:9', durationSeconds: 6, firstFrameUri: frame.uri, requestAudio: false, keyPriceQuoteId: managedQuoteId }), []);
  const imageRoute = connection({ baseUrl: 'https://api.openai.com/v1' });
  assert.equal(buildOfficialCanvasAdapterPolicy(imageRoute, 'gpt-image-1').maxImageReferences, 4);
  assert.deepEqual(buildOfficialCanvasCapability(imageRoute, 'gpt-image-1').modes.map(mode => mode.mode), ['textToImage', 'imageToImage']);
});

test('single reference placeholders and shared image-array slots cannot promise extra identity slots with a frame', () => {
  const make = body => connection({ protocol: 'async_media_template', providerSettings: { mediaTemplate: { kind: 'video', images: 'link', maxReferences: 4, seconds: [6], submit: { body } } } });
  const singular = make('{"prompt":"{{prompt}}","ref":"{{reference}}"}');
  assert.equal(buildOfficialCanvasAdapterPolicy(singular, 'opaque').maxImageReferences, 1);
  const shared = make('{"prompt":"{{prompt}}","images":"{{images}}","resolution":"720p","aspect_ratio":"16:9"}');
  const policy = buildOfficialCanvasAdapterPolicy(shared, 'opaque');
  assert.equal(policy.framesWithImageReferences, false);
  const cap = buildOfficialCanvasCapability(shared, 'opaque');
  assert.ok(validateCanvasGenerationParameters(cap, 'imageToVideo', { resolution: '720p', aspectRatio: '16:9', durationSeconds: 6 }, [reference('firstFrame'), reference('referenceImage', 2)]).length);
});

test('configured mode declarations cannot advertise video/audio input the selected adapter cannot transmit', () => {
  const model = 'google/veo-3.1', declared = { mode: 'referenceToVideo', referenceRules: { image: { supported: true, maxCount: 3 }, video: { supported: true, maxCount: 2 }, audio: { supported: true, maxCount: 1 } },
    preserveInputAudio: true, audioDrivenVideo: true, combinationConstraints: [{ combination: 'image' }, { combination: 'image+video+audio' }] };
  const route = connection({ canvasCapabilities: { providerModelId: model, version: 'declared-v1', modes: [declared] } });
  const cap = buildOfficialCanvasCapability(route, model);
  assert.deepEqual(cap.modes[0].referenceRules.video, { supported: false, maxCount: 0 });
  assert.deepEqual(cap.modes[0].referenceRules.audio, { supported: false, maxCount: 0 });
  assert.equal(cap.modes[0].preserveInputAudio, false);
  assert.deepEqual(cap.modes[0].combinationConstraints, [{ combination: 'image', maxImages: 3, maxVideos: 0, maxAudios: 0 }]);
});

test('a missing template cannot advertise generation modes or pass the enqueue guard', () => {
  const route = connection({ protocol: 'async_media_template' });
  const policy = buildOfficialCanvasAdapterPolicy(route, 'opaque-video', { kind: 'video' });
  assert.deepEqual(policy.modes, []);
  assert.deepEqual(buildOfficialCanvasCapability(route, 'opaque-video', {}, { kind: 'video' }).modes, []);
  assert.equal(canvasAdapterInputIssues(policy, 'video', { connectionId, model: 'opaque-video', prompt: 'Scene', durationSeconds: 6, width: 1280, height: 720 })[0].code, 'CANVAS_ADAPTER_UNKNOWN');
  assert.deepEqual(buildOfficialCanvasAdapterPolicy(connection({ protocol: 'ollama_chat' }), 'opaque-video', { kind: 'video' }).modes, []);
});

test('Veo keeps its eight-second reference mode distinct and guards older text-mode requests before enqueue', () => {
  const model = 'google/veo-3.1', route = connection();
  const videoFacts = { ...videoModelGuide(model), source: 'listing', resolutions: ['720p'], aspectRatios: ['16:9', '9:16'], clipSeconds: [4, 6, 8] };
  const cap = buildOfficialCanvasCapability(route, model, {}, { videoFacts });
  const policy = buildOfficialCanvasAdapterPolicy(route, model, { videoFacts });
  const refs = [reference('referenceImage', 1), reference('referenceImage', 2)];
  assert.deepEqual(policy.durationsWithImageReferences, [8]);
  assert.throws(() => compile(cap, policy, 'textToVideo', refs, { durationSeconds: 4 }), { code: 'CANVAS_CAPABILITY_INVALID' });
  const referenceMode = cap.modes.find(mode => mode.mode === 'referenceToVideo');
  const oldCap = { ...cap, modes: cap.modes.map(mode => mode.mode === 'textToVideo' ? { ...mode,
    referenceRules: referenceMode.referenceRules, combinationConstraints: referenceMode.combinationConstraints } : mode) };
  assert.throws(() => compile(oldCap, policy, 'textToVideo', refs, { durationSeconds: 4 }), { code: 'CANVAS_DURATION_UNSUPPORTED' });
  const valid = compile(oldCap, policy, 'textToVideo', refs, { durationSeconds: 8 });
  assert.deepEqual(valid.input.characterReferenceUris, refs.map(ref => ref.uri));
  assert.equal(valid.input.durationSeconds, 8);
  assert.equal(compile(cap, policy, 'textToVideo', [], { durationSeconds: 4 }).input.durationSeconds, 4);
  assert.deepEqual(referenceMode.duration, { kind: 'fixed', seconds: 8 });
  assert.deepEqual(compile(cap, policy, 'referenceToVideo', refs, { durationSeconds: 8 }).input.characterReferenceUris, refs.map(ref => ref.uri));
});

test('a template without a prompt placeholder cannot advertise generation or silently lose authored text', () => {
  const route = connection({ protocol: 'async_media_template', providerSettings: { mediaTemplate: { kind: 'video', images: 'link', maxReferences: 1, seconds: [6],
    submit: { body: '{"first":"{{first_frame}}","resolution":"720p","aspect_ratio":"16:9"}' } } } });
  const policy = buildOfficialCanvasAdapterPolicy(route, 'opaque-video');
  assert.deepEqual(policy.modes, []);
  assert.deepEqual(buildOfficialCanvasCapability(route, 'opaque-video').modes, []);
  const issues = canvasAdapterInputIssues(policy, 'video', { connectionId, model: 'opaque-video', prompt: 'Authored text that must reach the provider', durationSeconds: 6, width: 1280, height: 720 });
  assert.equal(issues[0].code, 'CANVAS_ADAPTER_UNSUPPORTED');
  assert.match(issues[0].message, /prompt placeholder/);
});

test('configured native image auto modes accept frozen dimensions without granting unknown template dimensions', () => {
  const declared = { mode: 'imageToImage', outputVariants: [{ id: 'default', resolution: 'auto', aspectRatios: ['9:16'] }],
    referenceRules: { image: { supported: true, maxCount: 2 } }, combinationConstraints: [{ combination: 'image' }] };
  const model = 'gemini-3.1-flash-image';
  const route = connection({ protocol: 'gemini_generate_content', baseUrl: 'https://generativelanguage.googleapis.com',
    canvasCapabilities: { providerModelId: model, version: 'configured-auto-v1', modes: [declared] } });
  const cap = buildOfficialCanvasCapability(route, model), policy = buildOfficialCanvasAdapterPolicy(route, model);
  assert.deepEqual(cap.modes[0].parameters, [
    { key: 'width', type: 'number', min: 64, max: 4096, step: 1 },
    { key: 'height', type: 'number', min: 64, max: 4096, step: 1 }]);
  const refs = [reference('referenceImage', 1)];
  const request = compile(cap, policy, 'imageToImage', refs, { resolution: 'auto', aspectRatio: '9:16', width: 720, height: 1280 });
  assert.equal(request.input.width, 720);
  assert.equal(request.input.height, 1280);
  assert.deepEqual(request.input.characterReferenceUris, refs.map(ref => ref.uri));
  assert.throws(() => compile(cap, policy, 'imageToImage', refs, { resolution: 'auto', aspectRatio: '9:16', width: 720.5, height: 1280 }), { code: 'CANVAS_CAPABILITY_INVALID' });
  const templateRoute = connection({ protocol: 'async_media_template', canvasCapabilities: route.canvasCapabilities,
    providerSettings: { mediaTemplate: { kind: 'image', images: 'link', maxReferences: 2, seconds: [],
      submit: { body: '{"prompt":"{{prompt}}","size":"{{size}}","references":"{{references}}"}' } } } });
  assert.deepEqual(buildOfficialCanvasCapability(templateRoute, model).modes, []);
});

for (const baseUrl of ['https://api.openai.com/v1', 'https://api.gpt.ge/v1', 'https://relay.example.test/prefix/v1']) {
  test(`native GPT Image capability and compiler preserve four ordered portrait inputs at ${baseUrl}`, () => {
    const route = connection({ baseUrl, providerSettings: { mediaApiStyle: 'openai' } });
    for (const model of ['gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5', 'gpt-image-2', 'gpt-image-2-2026-04-21',
      'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare-2026-09-08', 'gpt-image-2.5-sunburst-2026-09-08', 'chatgpt-image-latest']) {
      const cap = buildOfficialCanvasCapability(route, model), policy = buildOfficialCanvasAdapterPolicy(route, model);
      assert.deepEqual(cap.modes.map(mode => mode.mode), ['textToImage', 'imageToImage']);
      assert.equal(policy.maxImageReferences, 4);
      const refs = [reference('referenceImage', 3), reference('referenceImage', 1), reference('referenceImage', 4), reference('referenceImage', 2)];
      const request = compile(cap, policy, 'imageToImage', refs, { resolution: '1K', aspectRatio: '3:2' });
      assert.deepEqual(request.input.characterReferenceUris, refs.map(ref => ref.uri));
      assert.equal(request.input.width, 1536);
      assert.equal(request.input.height, 1024);
      assert.throws(() => compile(cap, policy, 'imageToImage', [...refs, reference('referenceImage', 5)], { resolution: '1K', aspectRatio: '3:2' }));
    }
  });
}

test('native image policy never grants GPT editing to unknown models, aliases or unrelated providers', () => {
  const route = connection({ baseUrl: 'https://api.gpt.ge/v1', providerSettings: { mediaApiStyle: 'openai' } });
  for (const model of ['dall-e-3', 'flux.2-pro', 'gemini-3.1-flash-image', 'gpt-image-2-official', 'gpt-image-future', 'openai/gpt-image-2']) {
    const policy = buildOfficialCanvasAdapterPolicy(route, model, { kind: 'image' });
    assert.equal(policy.maxImageReferences, 0);
    assert.equal(policy.modes.includes('imageToImage'), false);
  }
});
