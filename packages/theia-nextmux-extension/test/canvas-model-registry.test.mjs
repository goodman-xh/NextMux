import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasRegistryFamily, listCanvasRegistryModels, resolveCanvasCapability, validateCanvasGenerationParameters } from '@nextmux/comic-core';
import { buildManagedCanvasCapability, buildOfficialCanvasCapability } from '../lib/common/nextmux-canvas-capabilities.js';
import { buildOfficialCanvasAdapterPolicy, canvasAdapterInputIssues } from '../lib/common/nextmux-canvas-adapter-policy.js';
import { videoModelGuide } from '../lib/common/nextmux-video-model-guide.js';
import { managedQuoteId, syntheticManagedVideoProof } from './fixtures/canvas-managed-proof.mjs';

const router = { id: 'official:registry-fixture', providerId: 'openai', providerName: 'OpenRouter', label: 'Registry fixture',
  protocol: 'openai_chat_completions', baseUrl: 'https://openrouter.ai/api/v1', updatedAt: '2026-09-30T12:00:00.000Z' };
const hailuo = 'minimax/hailuo-3-max';
const facts = (model, overrides = {}) => ({ ...videoModelGuide(model), source: 'listing', resolutions: [], aspectRatios: [], ...overrides });
const sorted = values => [...values].sort();
const durations = rule => rule.kind === 'fixed' ? [rule.seconds] : rule.kind === 'enum' ? rule.seconds
  : Array.from({ length: Math.floor((rule.max - rule.min) / rule.step) + 1 }, (_, index) => rule.min + index * rule.step);

test('Hailuo Max listing gaps keep proven adapter auto and a first-frame-driven aspect option', () => {
  const videoFacts = facts(hailuo, { source: 'guide' });
  const cap = buildOfficialCanvasCapability(router, hailuo, {}, { videoFacts });
  assert.deepEqual(cap.modes.map(mode => mode.mode), ['textToVideo', 'imageToVideo']);
  assert.deepEqual(cap.modes.find(mode => mode.mode === 'imageToVideo').outputVariants[0].aspectRatios, ['auto']);
  const resolved = resolveCanvasCapability(cap, { mode: 'textToVideo', resolution: 'auto' });
  assert.deepEqual(resolved.issues, []);
  assert.deepEqual(sorted(resolved.variant.aspectRatios), sorted(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']));
  assert.equal(resolved.variant.dimensions, undefined);
  assert.deepEqual(durations(resolved.duration), Array.from({ length: 11 }, (_, index) => index + 5));
  assert.deepEqual(resolved.audioGeneration, { mode: 'required', defaultEnabled: true });
  assert.ok(cap.sources.some(source => source.startsWith('canvas-model-registry:')));
  assert.ok(cap.sources.includes('canvas-registry/audio-control-vs-native-output'));
  assert.ok(cap.sources.some(source => source.startsWith('canvas-registry/intersection:')));
  assert.ok(validateCanvasGenerationParameters(cap, 'textToVideo', { resolution: 'auto', aspectRatio: '3:2', durationSeconds: 6 })
    .some(issue => issue.code === 'ASPECT_RATIO_INVALID'));
  // The registry's supportAudio=0 omits the request flag; it does not promise silent native output.
  const policy = buildOfficialCanvasAdapterPolicy(router, hailuo, { videoFacts });
  assert.deepEqual(canvasAdapterInputIssues(policy, 'video', { durationSeconds: 6, requestAudio: false }), []);
  assert.ok(canvasAdapterInputIssues(policy, 'video', { durationSeconds: 6, requestAudio: true }).length);
});

test('a contradictory Hailuo resolution listing cannot regain options from registry defaults', () => {
  const cap = buildOfficialCanvasCapability(router, hailuo, {}, { videoFacts: facts(hailuo, {
    resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16'], clipSeconds: [6, 10]
  }) });
  assert.deepEqual(cap.modes, []);
  assert.notEqual(cap.status, 'available');
});

test('a Hailuo listing narrows registry resolution, ratio, duration and frame options independently', () => {
  const cap = buildOfficialCanvasCapability(router, hailuo, {}, { videoFacts: facts(hailuo, {
    resolutions: ['480p', '1080p'], aspectRatios: ['9:16', '3:2'], clipSeconds: [4, 6, 10, 20]
  }) });
  assert.deepEqual(cap.modes.map(mode => mode.mode), ['textToVideo', 'imageToVideo']);
  const mode = cap.modes[0];
  assert.deepEqual(mode.outputVariants.map(variant => variant.resolution.toLowerCase()), ['480p']);
  assert.deepEqual(mode.outputVariants[0].aspectRatios, ['9:16']);
  assert.deepEqual(durations(resolveCanvasCapability(cap, { mode: 'textToVideo', resolution: mode.outputVariants[0].resolution }).duration), [6, 10]);
  assert.equal(mode.lastFrame, false);
});

test('an owner template intersects its integer durations and three derived ratios with H3', () => {
  const connection = { ...router, protocol: 'async_media_template', providerSettings: { mediaTemplate: { kind: 'video', images: 'link',
    seconds: Array.from({ length: 12 }, (_, index) => index + 4), maxReferences: 9,
    submit: { body: '{"prompt":"{{prompt}}","first_frame":"{{first_frame}}","last_frame":"{{last_frame}}","images":"{{references_csv}}","ratio":"{{aspect_ratio}}","duration":"{{seconds_text}}"}' } } } };
  const cap = buildOfficialCanvasCapability(connection, 'video_minimax_h3');
  assert.deepEqual(cap.modes.map(mode => mode.mode), ['textToVideo', 'imageToVideo', 'firstLastFrame', 'referenceToVideo']);
  for (const mode of cap.modes) {
    const resolved = resolveCanvasCapability(cap, { mode: mode.mode, resolution: 'auto' });
    assert.deepEqual(resolved.issues, []);
    assert.deepEqual(sorted(resolved.variant.aspectRatios), ['imageToVideo', 'firstLastFrame'].includes(mode.mode) ? ['auto'] : sorted(['16:9', '9:16', '1:1']));
    assert.deepEqual(durations(resolved.duration), Array.from({ length: 11 }, (_, index) => index + 5));
    assert.equal(mode.lastFrame, mode.mode === 'firstLastFrame');
    assert.equal(mode.referenceRules.video.supported, false);
    assert.equal(mode.referenceRules.audio.supported, false);
    assert.ok((mode.referenceRules.image?.maxCount ?? 0) <= 4);
  }
});

test('managed Veo enables its first frame only when the route explicitly transmits it', () => {
  const offering = { id: 'managed:registry-fixture', providerName: 'Fixture relay', providerModelCode: 'google/veo-3.1', displayName: 'Veo 3.1',
    status: 'active', category: 'video', keyPriceQuoteId: managedQuoteId, capabilities: ['text_to_video', 'image_to_video', 'native_audio'],
    mediaInput: { firstFrame: false, referenceImages: false, maxReferences: 0 },
    videoLimits: { resolutions: ['720p', '2K'], aspectRatios: ['16:9', '1:1'], durations: [4, 5, 8, 12], shapeQuoteId: managedQuoteId,
      provenShapes: syntheticManagedVideoProof({ resolutions: ['720p', '2K'], aspectRatios: ['16:9', '1:1'], durations: [4, 5, 8, 12], frameStates: [[false, false], [true, false]] }) } };
  const disabled = buildManagedCanvasCapability(offering);
  assert.deepEqual(disabled.modes.map(mode => mode.mode), ['textToVideo']);
  const enabled = buildManagedCanvasCapability({ ...offering, mediaInput: { ...offering.mediaInput, firstFrame: true } });
  assert.deepEqual(enabled.modes.map(mode => mode.mode), ['textToVideo', 'imageToVideo']);
  for (const mode of enabled.modes) {
    assert.deepEqual(mode.outputVariants.map(variant => variant.resolution), ['720p']);
    assert.deepEqual(mode.outputVariants[0].aspectRatios, ['16:9']);
    assert.deepEqual(durations(resolveCanvasCapability(enabled, { mode: mode.mode, resolution: '720p' }).duration), [4, 8]);
    assert.equal(mode.firstFrame, mode.mode === 'imageToVideo');
    assert.equal(mode.lastFrame, false);
    assert.equal(mode.referenceRules.video.supported, false);
    assert.equal(mode.referenceRules.audio.supported, false);
    assert.deepEqual(mode.combinationConstraints, []);
  }
});

test('a non-spec route has no registry family or fixed-list model entry', () => {
  assert.equal(canvasRegistryFamily('minimax/hailuo-3')?.id, 'minimax-h3');
  for (const model of ['black-forest-labs/flux-3-video', 'openai/sora-2-pro', 'runway/gen-4.5', 'unknown-family']) {
    assert.equal(canvasRegistryFamily(model), undefined);
  }
  assert.equal(listCanvasRegistryModels('video').some(family => /(?:flux|sora-2-pro|runway)/iu.test(family.id)), false);
});

test('configured Gemini ratios cannot exceed the three aspects written by its transport', () => {
  const model = 'gemini-3.1-flash-image';
  const connection = { ...router, protocol: 'gemini_generate_content', baseUrl: 'https://generativelanguage.googleapis.com',
    canvasCapabilities: { providerModelId: model, version: 'registry-ratio-fixture', modes: [{ mode: 'textToImage',
      outputVariants: [{ id: 'auto', resolution: 'auto', aspectRatios: ['4:3', '9:16'] }] }] } };
  const cap = buildOfficialCanvasCapability(connection, model);
  assert.deepEqual(cap.modes.map(mode => mode.mode), ['textToImage']);
  assert.deepEqual(cap.modes[0].outputVariants[0].aspectRatios, ['9:16']);
  const rejected = buildOfficialCanvasCapability({ ...connection, canvasCapabilities: { ...connection.canvasCapabilities, modes: [{
    mode: 'textToImage', outputVariants: [{ id: 'auto', resolution: 'auto', aspectRatios: ['4:3'] }]
  }] } }, model);
  assert.deepEqual(rejected.modes, []);
});

test('configured Veo high-resolution duration choices still obey the eight-second transport restriction', () => {
  const model = 'google/veo-3.1';
  const connection = seconds => ({ ...router, canvasCapabilities: { providerModelId: model, version: 'registry-highres-fixture',
    modes: [{ mode: 'textToVideo', duration: { kind: 'enum', seconds, defaultSeconds: seconds[0] },
      audioGeneration: { mode: 'required', defaultEnabled: true },
      outputVariants: [{ id: '1080p', resolution: '1080p', aspectRatios: ['16:9'] }] }] } });
  const videoFacts = facts(model, { resolutions: ['1080p'], aspectRatios: ['16:9'], clipSeconds: [4, 6, 8] });
  const unavailable = buildOfficialCanvasCapability(connection([4, 6]), model, {}, { videoFacts });
  assert.deepEqual(unavailable.modes, []);
  const available = buildOfficialCanvasCapability(connection([4, 6, 8]), model, {}, { videoFacts });
  assert.deepEqual(available.modes.map(mode => mode.mode), ['textToVideo']);
  assert.deepEqual(durations(resolveCanvasCapability(available, { mode: 'textToVideo', resolution: '1080p' }).duration), [8]);
});

test('a valid declaration may provide known duration and audio entirely on its output variant', () => {
  const model = 'google/veo-3.1';
  const connection = { ...router, canvasCapabilities: { providerModelId: model, version: 'registry-variant-only-fixture', modes: [{
    mode: 'textToVideo', outputVariants: [{ id: '1080p', resolution: '1080p', aspectRatios: ['16:9'],
      durationOverride: { kind: 'fixed', seconds: 8 }, audioGenerationOverride: { mode: 'required', defaultEnabled: true } }]
  }] } };
  const cap = buildOfficialCanvasCapability(connection, model, {}, { videoFacts: facts(model, {
    resolutions: ['1080p'], aspectRatios: ['16:9'], clipSeconds: [4, 6, 8]
  }) });
  assert.deepEqual(cap.modes.map(mode => mode.mode), ['textToVideo']);
  const resolved = resolveCanvasCapability(cap, { mode: 'textToVideo', resolution: '1080p' });
  assert.deepEqual(resolved.issues, []);
  assert.deepEqual(resolved.duration, { kind: 'fixed', seconds: 8 });
  assert.deepEqual(resolved.audioGeneration, { mode: 'required', defaultEnabled: true });
});
