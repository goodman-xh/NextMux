import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCanvasCapability, validateCanvasGenerationParameters, sameCanvasCapabilityVersion } from '@nextmux/comic-core';
import { buildManagedCanvasCapability, buildOfficialCanvasCapability, validateDesktopCanvasCapabilityDeclaration } from '../lib/common/nextmux-canvas-capabilities.js';
import { buildManagedCanvasAdapterPolicy, buildOfficialCanvasAdapterPolicy, canvasAdapterInputIssues, MEDIA_TEMPLATE_VIDEO_RATIOS, OPENROUTER_VIDEO_DEFAULT_RATIOS } from '../lib/common/nextmux-canvas-adapter-policy.js';
import { videoModelGuide } from '../lib/common/nextmux-video-model-guide.js';
import { fitOpenRouterVideoRequest } from '../lib/node/nextmux-openrouter-video-limits.js';
import { managedQuoteId, syntheticManagedVideoProof } from './fixtures/canvas-managed-proof.mjs';

test('official capability bridge uses configured media templates without persisting private transport fields', () => {
  const connection = {
    id: 'official:fixture', providerId: 'custom', providerName: 'Fixture', label: 'Fixture route', protocol: 'async_media_template', updatedAt: '2026-09-30T12:00:00.000Z',
    providerSettings: { mediaTemplate: { kind: 'video', seconds: [8], maxReferences: 2, images: 'link', submit: { body: '{"prompt":"{{prompt}}","first":"{{first_frame}}","refs":"{{references}}","generate_audio":true}', path: 'https://private-route.invalid' } } }
  };
  const capability = buildOfficialCanvasCapability(connection, 'opaque-model-id');
  assert.equal(capability.providerModelId, 'opaque-model-id');
  assert.deepEqual(capability.modes.map(mode => mode.mode), ['textToVideo', 'imageToVideo', 'referenceToVideo']);
  assert.deepEqual(capability.modes[0].audioGeneration, { mode: 'required', defaultEnabled: true });
  assert.equal(capability.modes[0].outputVariants, undefined);
  assert.doesNotMatch(JSON.stringify(capability), /private-route|\{\{first_frame\}\}/);
});

test('fixed-size image templates declare their exact output combination for the existing adapter', () => {
  const connection = { id: 'official:image-fixture', providerId: 'custom', providerName: 'Fixture', label: 'Fixture route', protocol: 'async_media_template', updatedAt: '2026-09-30T12:00:00.000Z', providerSettings: { mediaTemplate: { kind: 'image', seconds: [], maxReferences: 2, images: 'link', submit: { body: '{"prompt":"{{prompt}}","size":"1024x1024","references":"{{references}}"}' } } } };
  const capability = buildOfficialCanvasCapability(connection, 'opaque-image-id');
  assert.deepEqual(capability.modes.map(mode => mode.mode), ['textToImage', 'imageToImage']);
  assert.deepEqual(capability.modes[0].outputVariants[0].dimensions, { '1:1': { width: 1024, height: 1024 } });
});

test('managed capabilities use the gateway audio form and catalog limits in both text and first-frame modes', () => {
  const offering = { id: 'offering-1', providerName: 'Fixture relay', providerModelCode: 'openai/sora-2', displayName: 'Sora route', status: 'active', keyPriceQuoteId: managedQuoteId,
    capabilities: ['text_to_video', 'native_audio'], mediaInput: { firstFrame: true },
    videoLimits: { resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16'], durations: [4, 8, 12], shapeQuoteId: managedQuoteId,
      // The gateway certifies Sora's audio-on request form; audio follows that proof (canvas-video-audio-registry-control).
      provenShapes: syntheticManagedVideoProof({ resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16'], durations: [4, 8, 12], frameStates: [[false, false], [true, false]], requestAudio: true }) } };
  const capability = buildManagedCanvasCapability(offering);
  assert.deepEqual(capability.modes.map(mode => mode.mode), ['textToVideo', 'imageToVideo']);
  for (const mode of capability.modes) {
    assert.deepEqual(mode.audioGeneration, { mode: 'required', defaultEnabled: true });
    assert.deepEqual(mode.outputVariants[0].aspectRatios, ['16:9', '9:16']);
    assert.deepEqual(mode.duration, { kind: 'enum', seconds: [4, 8, 12], defaultSeconds: 4 });
  }
  assert.ok(capability.sources.includes('desktop/videoModelProfile'));
  const changed = buildManagedCanvasCapability({ ...offering, videoLimits: { ...offering.videoLimits, durations: [8] } });
  assert.notEqual(capability.version, changed.version);
});

test('OpenRouter video auto output narrows text ratios and keeps image-driven auto aspect', () => {
  const model = 'minimax/hailuo-3-max';
  const connection = { id: 'official:openrouter', providerId: 'openai', providerName: 'OpenRouter', label: 'Video',
    protocol: 'openai_chat_completions', baseUrl: 'https://openrouter.ai/api/v1', updatedAt: '2026-09-30T12:00:00.000Z' };
  const videoFacts = { ...videoModelGuide(model), source: 'guide', resolutions: [], aspectRatios: [] };
  const capability = buildOfficialCanvasCapability(connection, model, {}, { videoFacts });
  const policy = buildOfficialCanvasAdapterPolicy(connection, model, { videoFacts });
  assert.deepEqual(policy.videoAutoOutput, { resolution: 'auto', aspectRatios: OPENROUTER_VIDEO_DEFAULT_RATIOS });
  const registryRatios = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
  assert.deepEqual(capability.modes.map(mode => mode.mode), ['textToVideo', 'imageToVideo']);
  for (const mode of capability.modes) {
    const resolved = resolveCanvasCapability(capability, { mode: mode.mode, resolution: 'auto' });
    assert.deepEqual(resolved.issues, []);
    assert.deepEqual(resolved.variant.aspectRatios, mode.mode === 'imageToVideo' ? ['auto'] : registryRatios);
    assert.equal(resolved.variant.dimensions, undefined);
    assert.deepEqual(resolved.duration, { kind: 'enum', seconds: Array.from({ length: 11 }, (_, index) => index + 5), defaultSeconds: 5 });
    assert.deepEqual(resolved.audioGeneration, { mode: 'required', defaultEnabled: true });
    assert.equal(mode.firstFrame, mode.mode === 'imageToVideo');
  }
  for (const aspectRatio of OPENROUTER_VIDEO_DEFAULT_RATIOS) {
    const [width, height] = aspectRatio.split(':').map(value => Number(value) * 128);
    assert.equal(fitOpenRouterVideoRequest(undefined, { durationSeconds: 6, width, height, hasPicture: true }).aspectRatio, aspectRatio);
  }
  assert.ok(validateCanvasGenerationParameters(capability, 'textToVideo', { resolution: 'auto', aspectRatio: '16:9', durationSeconds: 6, generateAudio: false })
    .some(issue => issue.code === 'AUDIO_INVALID'));
  assert.deepEqual(canvasAdapterInputIssues(policy, 'video', { durationSeconds: 6, width: 1920, height: 1080, requestAudio: false }), []);
  assert.ok(canvasAdapterInputIssues(policy, 'video', { durationSeconds: 6, requestAudio: true }).length);
  const declared = buildOfficialCanvasCapability({ ...connection, canvasCapabilities: { providerModelId: model, version: 'sound-facts', modes: [{
    mode: 'textToVideo', duration: { kind: 'fixed', seconds: 6 }, audioGeneration: { mode: 'unsupported', defaultEnabled: false },
    outputVariants: [{ id: 'auto', resolution: 'auto', aspectRatios: ['16:9'], audioGenerationOverride: { mode: 'unsupported', defaultEnabled: false } }] }] } }, model, {}, { videoFacts });
  assert.deepEqual(resolveCanvasCapability(declared, { mode: 'textToVideo', resolution: 'auto' }).audioGeneration, { mode: 'required', defaultEnabled: true });
  const undeclaredOutput = buildOfficialCanvasCapability({ ...connection, canvasCapabilities: { providerModelId: model, version: 'mode-only',
    modes: [{ mode: 'textToVideo' }] } }, model, {}, { videoFacts });
  const declaredAuto = resolveCanvasCapability(undeclaredOutput, { mode: 'textToVideo', resolution: 'auto' });
  assert.deepEqual(declaredAuto.issues, []);
  assert.deepEqual(declaredAuto.variant.aspectRatios, registryRatios);
});

test('OpenRouter auto output uses listed ratios and preserves explicit listing outputs', () => {
  const model = 'minimax/hailuo-3-max', connection = { id: 'official:openrouter', providerId: 'openai', providerName: 'OpenRouter', label: 'Video',
    protocol: 'openai_chat_completions', baseUrl: 'https://openrouter.ai/api/v1', updatedAt: '2026-09-30T12:00:00.000Z' };
  const videoFacts = { ...videoModelGuide(model), source: 'listing', resolutions: [], aspectRatios: ['9:16', '16:9'] };
  const auto = buildOfficialCanvasCapability(connection, model, {}, { videoFacts });
  assert.deepEqual([...auto.modes[0].outputVariants[0].aspectRatios].sort(), [...videoFacts.aspectRatios].sort());
  const listedFacts = { ...videoFacts, resolutions: ['480p', '768p'] };
  const listed = buildOfficialCanvasCapability(connection, model, {}, { videoFacts: listedFacts });
  assert.equal(buildOfficialCanvasAdapterPolicy(connection, model, { videoFacts: listedFacts }).videoAutoOutput, undefined);
  for (const mode of listed.modes) {
    assert.deepEqual(mode.outputVariants.map(variant => variant.resolution.toLowerCase()), listedFacts.resolutions);
    assert.deepEqual([...mode.outputVariants[0].aspectRatios].sort(), mode.mode === 'imageToVideo' ? ['auto'] : [...listedFacts.aspectRatios].sort());
  }
  const withoutRatios = buildOfficialCanvasCapability(connection, model, {}, { videoFacts: { ...listedFacts, aspectRatios: [] } });
  assert.deepEqual(withoutRatios.modes[0].outputVariants.map(variant => variant.resolution.toLowerCase()), listedFacts.resolutions);
  assert.deepEqual(withoutRatios.modes[0].outputVariants[0].aspectRatios, ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']);
  const otherRoute = buildOfficialCanvasCapability({ ...connection, baseUrl: 'https://api.example.invalid/v1' }, model, {}, { videoFacts });
  assert.deepEqual(otherRoute.modes, []);
});

test('managed audio follows the quoted proof, never guide or route sound labels, and keeps the fixed gateway flag', () => {
  // Audio changes the billed shape, so only the current certificate decides it: a sound label with a silent proof
  // stays silent, and an audio-on proof is required audio with the flag fixed on.
  for (const facts of [{ providerModelCode: 'video_minimax_h3', capabilities: ['text_to_video'] },
    { providerModelCode: 'opaque-video', capabilities: ['text_to_video', 'video_native_audio'] },
    { providerModelCode: 'opaque-video', capabilities: ['text_to_video', 'native_audio'] }]) {
    for (const requestAudio of [false, true]) {
      const offering = { id: 'sound-route', providerName: 'Relay', displayName: 'Sound', status: 'active', keyPriceQuoteId: managedQuoteId,
        videoLimits: { resolutions: ['2K'], aspectRatios: ['16:9'], durations: [6], shapeQuoteId: managedQuoteId,
          provenShapes: syntheticManagedVideoProof({ resolutions: ['2K'], aspectRatios: ['16:9'], durations: [6], frameStates: [[false, false]], requestAudio }) }, ...facts };
      const policy = buildManagedCanvasAdapterPolicy(offering);
      assert.equal(policy.audioRequestEnabled, requestAudio);
      assert.deepEqual(buildManagedCanvasCapability(offering).modes[0].audioGeneration,
        requestAudio ? { mode: 'required', defaultEnabled: true } : { mode: 'unsupported', defaultEnabled: false });
      assert.deepEqual(canvasAdapterInputIssues(policy, 'video', { resolution: '2K', aspectRatio: '16:9', durationSeconds: 6,
        width: 2560, height: 1440, requestAudio, keyPriceQuoteId: managedQuoteId }), []);
    }
  }
});

test('configured desk video templates declare their aspect placeholder and adapter-owned resolution', () => {
  const routes = [
    { label: '1212', model: 'video_veo3.1_fast', seconds: [8], maxReferences: 3, requestAudio: false,
      body: '{"prompt":"{{prompt}}","firstFrameUrl":"{{first_frame}}","lastFrameUrl":"{{last_frame}}","urls":"{{references}}","aspectRatio":"{{aspect_ratio}}","size":"{{resolution}}"}' },
    { label: '速创 · MiniMax H3', model: 'video_minimax_h3', seconds: Array.from({ length: 12 }, (_, index) => index + 4), maxReferences: 9, requestAudio: false,
      body: '{"prompt":"{{prompt}}","first_frame":"{{first_frame}}","last_frame":"{{last_frame}}","images":"{{references_csv}}","ratio":"{{aspect_ratio}}","duration":"{{seconds_text}}"}' },
    { label: '速创 · Wan3.0', model: 'video_wan_3.0', seconds: Array.from({ length: 27 }, (_, index) => index + 4), maxReferences: 10, requestAudio: true,
      body: '{"prompt":"{{prompt}}","first_frame":"{{first_frame}}","last_frame":"{{last_frame}}","images":"{{references_csv}}","ratio":"{{aspect_ratio}}","duration":"{{seconds_text}}","generate_audio":"true"}' },
    { label: '速创 · Omni', model: 'video_omni', seconds: [...Array.from({ length: 11 }, (_, index) => index + 3), 15], maxReferences: 4, requestAudio: true,
      body: '{"prompt":"{{prompt}}","aspectRatio":"{{aspect_ratio}}","resolution":"pro","sound":"on","duration":"{{seconds_text}}","image_url":"{{references_csv}}","firstFrameUrl":"{{first_frame}}","lastFrameUrl":"{{last_frame}}","watermark":"0"}' },
  ];
  for (const route of routes) {
    const connection = { id: `official:${route.model}`, providerId: 'custom', providerName: 'Fixture', label: route.label,
      protocol: 'async_media_template', updatedAt: '2026-09-30T12:00:00.000Z', providerSettings: { mediaTemplate: {
        kind: 'video', images: 'link', seconds: route.seconds, maxReferences: route.maxReferences, submit: { body: route.body } } } };
    const policy = buildOfficialCanvasAdapterPolicy(connection, route.model);
    const capability = buildOfficialCanvasCapability(connection, route.model);
    assert.deepEqual(policy.videoAutoOutput, { resolution: 'auto', aspectRatios: MEDIA_TEMPLATE_VIDEO_RATIOS }, route.label);
    assert.equal(policy.audioRequestEnabled, route.requestAudio, route.label);
    if (route.model === 'video_wan_3.0') assert.deepEqual(capability.modes.map(mode => mode.mode), ['imageToVideo', 'firstLastFrame'], route.label);
    for (const mode of capability.modes) {
      const resolved = resolveCanvasCapability(capability, { mode: mode.mode, resolution: 'auto' });
      assert.deepEqual(resolved.issues, [], `${route.label} ${mode.mode}`);
      assert.equal(resolved.variant.dimensions, undefined, route.label);
      // 速创's Omni is Kling 3.0 Omni (Kling v3), whose image-driven modes follow the first frame like H3 and Wan 3.0.
      const frameAuto = ['imageToVideo', 'firstLastFrame'].includes(mode.mode) && ['video_minimax_h3', 'video_wan_3.0', 'video_omni'].includes(route.model);
      assert.deepEqual([...resolved.variant.aspectRatios].sort(), frameAuto ? ['auto'] : [...(route.model === 'video_veo3.1_fast' ? ['16:9', '9:16'] : MEDIA_TEMPLATE_VIDEO_RATIOS)].sort(), route.label);
      assert.deepEqual(resolved.audioGeneration, { mode: 'required', defaultEnabled: true }, route.label);
      assert.ok(mode.parameters.some(parameter => parameter.key === 'width'), route.label);
      assert.ok(mode.parameters.some(parameter => parameter.key === 'height'), route.label);
      assert.equal(resolved.duration.kind === 'fixed' ? resolved.duration.seconds : resolved.duration.seconds[0], route.model === 'video_minimax_h3' ? 5 : route.seconds[0], route.label);
    }
  }
});

test('unknown video output facts and dynamic template audio stay unknown', () => {
  const offering = { id: 'unknown-route', providerName: 'Relay', providerModelCode: 'opaque-video', displayName: 'Unknown', status: 'active', capabilities: ['text_to_video'] };
  const capability = buildManagedCanvasCapability(offering);
  assert.deepEqual(capability.modes, []);
  assert.equal(capability.status, 'unknown');
  assert.ok(capability.sources.some(source => source.includes('videoLimits.provenShapes:missing')));
  const connection = { id: 'official:dynamic', providerId: 'custom', providerName: 'Fixture', label: 'Fixture', protocol: 'async_media_template', updatedAt: '2026-09-30T12:00:00.000Z', providerSettings: { mediaTemplate: { kind: 'video', images: 'none', maxReferences: 0, seconds: [8], submit: { body: '{"prompt":"{{prompt}}","audio":"{{generate_audio}}","resolution":"720p","aspect_ratio":"16:9"}' } } } };
  assert.equal(buildOfficialCanvasCapability(connection, 'opaque-model').modes[0].audioGeneration, undefined);
  const referenceTemplate = { ...connection, providerSettings: { mediaTemplate: { ...connection.providerSettings.mediaTemplate,
    submit: { body: '{"prompt":"{{prompt}}","videos":"{{reference_videos}}","audios":"{{reference_audios}}","resolution":"720p","aspect_ratio":"16:9"}' } } } };
  const referenceMode = buildOfficialCanvasCapability(referenceTemplate, 'opaque-model').modes.find(mode => mode.mode === 'referenceToVideo');
  assert.equal(referenceMode.referenceRules.video, undefined);
  assert.equal(referenceMode.referenceRules.audio, undefined);
});

test('an active managed catalog entry explicitly marked unavailable cannot grant an available canvas model', () => {
  const offering = { id: 'unavailable-route', providerName: 'Fixture', providerModelCode: 'opaque', displayName: 'Fixture', status: 'active', category: 'image', available: false, capabilities: ['image_generation'] };
  assert.notEqual(buildManagedCanvasCapability(offering).status, 'available');
  assert.equal(buildManagedCanvasCapability({ ...offering, available: true }).status, 'available');
  const { available, ...legacy } = offering;
  assert.equal(buildManagedCanvasCapability(legacy).status, 'available');
});

test('verified mode declarations expose exact adapter combinations without enabling another named model', () => {
  const mode = { mode: 'textToVideo', duration: { kind: 'fixed', seconds: 8 }, audioGeneration: { mode: 'unsupported', defaultEnabled: false }, outputVariants: [{ id: 'exact-720', resolution: '720p', aspectRatios: ['16:9'], dimensions: { '16:9': { width: 1280, height: 720 } } }] };
  const connection = { id: 'official:fixture', providerId: 'custom', providerName: 'Fixture', label: 'Fixture', protocol: 'openai_chat_completions', updatedAt: '2026-09-30T12:00:00.000Z', canvasCapabilities: { providerModelId: 'exact-fixture-model', version: 'verified-fixture-v2', modes: [mode] } };
  const capability = buildOfficialCanvasCapability(connection, 'exact-fixture-model');
  assert.equal(sameCanvasCapabilityVersion(capability.version, 'verified-fixture-v2@2026-09-30T12:00:00.000Z:canvas-v1'), true);
  assert.deepEqual(capability.modes, [mode]);
  assert.deepEqual(buildOfficialCanvasCapability(connection, 'veo-3.1-generate-001').modes, []);
  const { canvasCapabilities, ...unconfigured } = connection;
  assert.deepEqual(buildOfficialCanvasCapability(unconfigured, 'veo-3.1-generate-001').modes, []);
  assert.ok(capability.sources.includes('configured-adapter'));
});

test('declaration validation preserves unknown effective fields while rejecting malformed configured facts', () => {
  const declaration = { providerModelId: 'exact-model', version: 'config-v1', modes: [{ mode: 'textToVideo' }] };
  assert.deepEqual(validateDesktopCanvasCapabilityDeclaration(declaration, 'exact-model'), declaration);
  assert.notEqual(validateDesktopCanvasCapabilityDeclaration(declaration, 'exact-model'), declaration);
  assert.throws(() => validateDesktopCanvasCapabilityDeclaration(declaration, 'other-model'), { code: 'CANVAS_CAPABILITY_DECLARATION_INVALID' });
  const invalidModes = [
    { mode: 'universal' },
    { mode: 'textToVideo', apiKey: 'fake-test-marker' },
    { mode: 'textToVideo', duration: { kind: 'enum', seconds: [4, 6, 8], defaultSeconds: 5 } },
    { mode: 'textToVideo', duration: { kind: 'range', min: 2, max: 5, step: 2, defaultSeconds: 3 } },
    { mode: 'textToVideo', audioGeneration: { mode: 'required', defaultEnabled: false } },
    { mode: 'referenceToVideo', referenceRules: { image: { supported: false, maxCount: 3 } } },
    { mode: 'referenceToVideo', referenceRules: { video: { supported: true, maxCount: 1, minDurationSeconds: 5, maxDurationSeconds: 2 } } },
    { mode: 'referenceToVideo', combinationConstraints: [{ combination: 'audio_only' }] },
    { mode: 'textToVideo', outputVariants: [{ id: 'size', resolution: '720p', aspectRatios: ['16:9'], defaultAspectRatio: '9:16' }] },
    { mode: 'textToVideo', parameters: [{ key: 'seed', type: 'number', min: 0, max: 9, step: 2, defaultValue: 3 }] },
    { mode: 'textToVideo', parameters: [{ key: 'generateAudio', type: 'boolean' }] },
    { mode: 'textToVideo', parameters: [{ key: 'apiKey', type: 'string', defaultValue: 'fake-test-marker' }] },
  ];
  for (const invalid of invalidModes) assert.throws(() => validateDesktopCanvasCapabilityDeclaration({ ...declaration, modes: [invalid] }, 'exact-model'), { code: 'CANVAS_CAPABILITY_DECLARATION_INVALID' });
  assert.throws(() => validateDesktopCanvasCapabilityDeclaration({ ...declaration, modes: [declaration.modes[0], declaration.modes[0]] }, 'exact-model'), { code: 'CANVAS_CAPABILITY_DECLARATION_INVALID' });
});

test('configured output variants cannot contradict literal template output dimensions or aspect', () => {
  const connection = { id: 'official:fixed-fixture', providerId: 'custom', providerName: 'Fixture', label: 'Fixed route', protocol: 'async_media_template', updatedAt: '2026-09-30T12:00:00.000Z', providerSettings: { mediaTemplate: { kind: 'image', seconds: [], maxReferences: 0, images: 'none', submit: { body: '{"prompt":"{{prompt}}","size":"1024x1024"}' } } } };
  const declaration = variant => ({ providerModelId: 'exact-image', version: 'v1', modes: [{ mode: 'textToImage', outputVariants: [variant] }] });
  const exact = { id: 'fixed', resolution: '1024x1024', aspectRatios: ['1:1'], dimensions: { '1:1': { width: 1024, height: 1024 } } };
  assert.deepEqual(buildOfficialCanvasCapability({ ...connection, canvasCapabilities: declaration(exact) }, 'exact-image').modes[0].outputVariants, [exact]);
  for (const inconsistent of [
    { ...exact, dimensions: { '1:1': { width: 512, height: 512 } } },
    { ...exact, aspectRatios: ['16:9'], dimensions: undefined },
    { ...exact, resolution: '720p', dimensions: undefined },
    { ...exact, resolution: '1280x720', dimensions: undefined },
  ]) assert.throws(() => buildOfficialCanvasCapability({ ...connection, canvasCapabilities: declaration(inconsistent) }, 'exact-image'), { code: 'CANVAS_CAPABILITY_DECLARATION_INVALID' });
  const dynamic = { ...connection, providerSettings: { mediaTemplate: { ...connection.providerSettings.mediaTemplate, submit: { body: '{"prompt":"{{prompt}}","size":"{{size}}"}' } } } };
  const explicit = { id: 'configured', resolution: '720p', aspectRatios: ['16:9'], dimensions: { '16:9': { width: 1280, height: 720 } } };
  assert.deepEqual(buildOfficialCanvasCapability({ ...dynamic, canvasCapabilities: declaration(explicit) }, 'exact-image').modes[0].outputVariants, [explicit]);
});
