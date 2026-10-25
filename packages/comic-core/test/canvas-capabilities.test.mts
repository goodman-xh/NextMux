import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCanvasModelCapability,
  canvasReferenceCombination,
  isCanvasDurationValid,
  reconcileCanvasGenerationParameters,
  resolveCanvasCapability,
  validateCanvasGenerationParameters,
  type CanvasCapabilityInput,
  type CanvasDurationRule,
  type CanvasModeCapability,
  type CanvasModelCapability,
} from '../lib/canvas-capabilities.js';

const enumDuration: CanvasDurationRule = { kind: 'enum', seconds: [4, 6, 8], defaultSeconds: 6 };
const videoMode: CanvasModeCapability = {
  mode: 'textToVideo', duration: enumDuration,
  audioGeneration: { mode: 'optional', defaultEnabled: false },
  firstFrame: false, lastFrame: false, preserveInputAudio: false,
  outputVariants: [
    { id: '720', resolution: '720p', aspectRatios: ['16:9', '9:16'] },
    { id: '1080', resolution: '1080p', aspectRatios: ['16:9'], durationOverride: { kind: 'fixed', seconds: 8 } },
  ],
  defaultResolution: '720p',
};
function model(mode: CanvasModeCapability = videoMode): CanvasModelCapability {
  return { id: 'adapter-exact-model', providerId: 'fixture', providerModelId: 'upstream', displayName: 'Contract fixture', version: 'fixture-v1', status: 'available', modes: [mode], sources: ['explicit test fixture'] };
}
const parameters = { resolution: '720p', aspectRatio: '16:9', durationSeconds: 6, generateAudio: false };
const imageInput: CanvasCapabilityInput = { role: 'referenceImage', kind: 'image', versionId: 'portrait-v1', metadata: { byteLength: 500, width: 400, height: 400, mimeType: 'image/png' } };

test('discrete, fixed and stepped duration rules reject forbidden values', () => {
  assert.equal(isCanvasDurationValid(enumDuration, 5), false);
  assert.equal(isCanvasDurationValid(enumDuration, 6), true);
  assert.equal(isCanvasDurationValid({ kind: 'fixed', seconds: 10 }, 9), false);
  assert.equal(isCanvasDurationValid({ kind: 'fixed', seconds: 10 }, 10), true);
  const stepped: CanvasDurationRule = { kind: 'range', min: 2, max: 10, step: 0.5, defaultSeconds: 5 };
  assert.equal(isCanvasDurationValid(stepped, 4.5), true);
  assert.equal(isCanvasDurationValid(stepped, 4.25), false);
  assert.equal(isCanvasDurationValid(stepped, Infinity), false);
  assert.equal(isCanvasDurationValid({ ...stepped, step: 0 }, 4), false);
  assert.equal(isCanvasDurationValid({ ...stepped, defaultSeconds: 4.25 }, 4.5), false);
});

test('resolution resolves dependent aspect ratio and duration without a Cartesian product', () => {
  assert.deepEqual(validateCanvasGenerationParameters(model(), 'textToVideo', parameters), []);
  const invalid = validateCanvasGenerationParameters(model(), 'textToVideo', { ...parameters, resolution: '1080p', aspectRatio: '9:16' });
  assert.deepEqual(invalid.map(issue => issue.code), ['ASPECT_RATIO_INVALID', 'DURATION_INVALID']);
  assert.deepEqual(resolveCanvasCapability(model(), { mode: 'textToVideo', resolution: '1080p' }).duration, { kind: 'fixed', seconds: 8 });
});

test('unknown catalog fields and unavailable models block submit rather than guess', () => {
  const unknown = model({ mode: 'textToVideo' });
  assert.deepEqual(validateCanvasGenerationParameters(unknown, 'textToVideo', parameters).map(issue => issue.path), ['resolution', 'durationSeconds', 'generateAudio']);
  assert.ok(validateCanvasGenerationParameters({ ...model(), status: 'maintenance' }, 'textToVideo', parameters).some(issue => issue.code === 'MODEL_UNAVAILABLE'));
  assert.ok(validateCanvasGenerationParameters({ ...model(), version: '' }, 'textToVideo', parameters).some(issue => issue.path === 'capabilityVersion'));
  assert.ok(validateCanvasGenerationParameters(model(), 'videoExtend', parameters).some(issue => issue.code === 'MODE_UNSUPPORTED'));
});

test('generated audio unsupported, optional and required enforce separate values', () => {
  for (const audioMode of ['unsupported', 'optional', 'required'] as const) {
    const fixture = model({ ...videoMode, audioGeneration: { mode: audioMode, defaultEnabled: audioMode === 'required' } });
    for (const enabled of [false, true]) {
      const issues = validateCanvasGenerationParameters(fixture, 'textToVideo', { ...parameters, generateAudio: enabled });
      const invalid = audioMode === 'unsupported' && enabled || audioMode === 'required' && !enabled;
      assert.equal(issues.some(issue => issue.code === 'AUDIO_INVALID'), invalid);
    }
  }
  const required = model({ ...videoMode, audioGeneration: { mode: 'required', defaultEnabled: true } });
  assert.deepEqual(reconcileCanvasGenerationParameters(required, 'textToVideo', parameters).parameters, { ...parameters, generateAudio: true });
});

test('auto remains a single adaptive ratio and does not imply arbitrary aspect choices', () => {
  const fixture = model({ ...videoMode, mode: 'imageToVideo', firstFrame: true, outputVariants: [{ id: 'adaptive', resolution: '720p', aspectRatios: ['auto'] }] });
  const inputs: CanvasCapabilityInput[] = [{ role: 'firstFrame', kind: 'image', versionId: 'frame-v1' }];
  assert.deepEqual(validateCanvasGenerationParameters(fixture, 'imageToVideo', { ...parameters, aspectRatio: 'auto' }, inputs), []);
  assert.ok(validateCanvasGenerationParameters(fixture, 'imageToVideo', parameters, inputs).some(issue => issue.code === 'ASPECT_RATIO_INVALID'));
});

test('model switch retains valid parameters, resets invalid defaults, and never drops inputs', () => {
  const fixture = model({ ...videoMode, audioGeneration: { mode: 'unsupported', defaultEnabled: false } });
  const original = { ...parameters, durationSeconds: 5, generateAudio: true, quality: 'old-model-only' };
  const switched = reconcileCanvasGenerationParameters(fixture, 'textToVideo', original, [imageInput]);
  assert.equal(switched.parameters.resolution, '720p');
  assert.equal(switched.parameters.aspectRatio, '16:9');
  assert.equal(switched.parameters.durationSeconds, 6);
  assert.equal(switched.parameters.generateAudio, false);
  assert.equal(switched.parameters.quality, undefined);
  assert.deepEqual(switched.inputs, [imageInput]);
  assert.ok(switched.notices.some(issue => issue.path === 'durationSeconds'));
  assert.ok(switched.notices.some(issue => issue.inputId === 'portrait-v1'));
  assert.equal(original.durationSeconds, 5);
  assert.equal(original.generateAudio, true);
});

test('resolution switching keeps legal values and falls back within its own variant', () => {
  const switched = reconcileCanvasGenerationParameters(model(), 'textToVideo', { ...parameters, resolution: '1080p', aspectRatio: '9:16' });
  assert.deepEqual(switched.parameters, { ...parameters, resolution: '1080p', aspectRatio: '16:9', durationSeconds: 8 });
  assert.deepEqual(switched.issues, []);
});

test('first and last frame roles are required and checked against declared mode flags', () => {
  const fixture = model({ ...videoMode, mode: 'firstLastFrame', firstFrame: true, lastFrame: false });
  const inputs: CanvasCapabilityInput[] = [{ role: 'firstFrame', kind: 'image', versionId: 'first' }, { role: 'lastFrame', kind: 'image', versionId: 'last' }];
  assert.ok(validateCanvasGenerationParameters(fixture, 'firstLastFrame', parameters, inputs).some(issue => issue.code === 'INPUT_ROLE_UNSUPPORTED' && issue.inputId === 'last'));
  assert.ok(validateCanvasGenerationParameters(model({ ...videoMode, mode: 'firstLastFrame', firstFrame: true, lastFrame: true }), 'firstLastFrame', parameters, inputs.slice(0, 1)).some(issue => issue.code === 'INPUT_REQUIRED' && issue.path === 'inputs.lastFrame'));
  assert.ok(validateCanvasGenerationParameters(model({ ...videoMode, mode: 'imageToVideo', firstFrame: true }), 'imageToVideo', parameters, [{ role: 'firstFrame', kind: 'video' }]).some(issue => issue.code === 'INPUT_KIND_INVALID'));
});

test('audio references are independent of generated audio and original audio preservation', () => {
  const fixture = model({ ...videoMode, mode: 'referenceToVideo', audioGeneration: { mode: 'unsupported', defaultEnabled: false }, referenceRules: { audio: { supported: true, maxCount: 1, formats: ['wav'], maxDurationSeconds: 3 } }, combinationConstraints: [{ combination: 'audio', maxAudios: 1 }] });
  const input: CanvasCapabilityInput = { role: 'referenceAudio', kind: 'audio', metadata: { mimeType: 'audio/wav', durationMs: 2500 } };
  assert.deepEqual(validateCanvasGenerationParameters(fixture, 'referenceToVideo', parameters, [input]), []);
  assert.ok(validateCanvasGenerationParameters(fixture, 'referenceToVideo', { ...parameters, generateAudio: true }, [input]).some(issue => issue.path === 'generateAudio'));
  assert.ok(validateCanvasGenerationParameters(fixture, 'referenceToVideo', { ...parameters, preserveInputAudio: true }, [input]).some(issue => issue.path === 'preserveInputAudio'));
  const edit = model({ ...fixture.modes[0], mode: 'videoEdit', preserveInputAudio: true, referenceRules: { video: { supported: true, maxCount: 1 } }, combinationConstraints: [{ combination: 'video' }] });
  assert.deepEqual(validateCanvasGenerationParameters(edit, 'videoEdit', { ...parameters, preserveInputAudio: true }, [{ role: 'referenceVideo', kind: 'video' }]), []);
});

test('frame video modes accept declared audio references and enforce their exact limits', () => {
  for (const mode of ['imageToVideo', 'firstLastFrame'] as const) {
    const fixture = model({ ...videoMode, mode, firstFrame: true, lastFrame: mode === 'firstLastFrame',
      referenceRules: { audio: { supported: true, maxCount: 1, formats: ['wav'], maxDurationSeconds: 3 } },
      combinationConstraints: [{ combination: 'audio', maxAudios: 1 }] });
    const frames: CanvasCapabilityInput[] = [{ role: 'firstFrame', kind: 'image' },
      ...(mode === 'firstLastFrame' ? [{ role: 'lastFrame', kind: 'image' } as const] : [])];
    const audio: CanvasCapabilityInput = { role: 'referenceAudio', kind: 'audio', metadata: { mimeType: 'audio/wav', durationMs: 2500 } };
    assert.deepEqual(validateCanvasGenerationParameters(fixture, mode, parameters, [...frames, audio]), []);
    assert.ok(validateCanvasGenerationParameters(fixture, mode, parameters, [...frames, audio, audio]).some(issue => issue.code === 'INPUT_COUNT_EXCEEDED'));
    assert.ok(validateCanvasGenerationParameters(fixture, mode, parameters, [...frames, { ...audio, metadata: { ...audio.metadata, durationMs: 3500 } }]).some(issue => issue.code === 'INPUT_LIMIT_EXCEEDED'));
    assert.ok(validateCanvasGenerationParameters(fixture, mode, parameters, [...frames, imageInput]).some(issue => issue.code === 'INPUT_ROLE_UNSUPPORTED'));
  }
});

test('dynamic template audio remains unknown until the adapter declares its behavior', () => {
  const fixture = buildCanvasModelCapability({ id: 'dynamic-audio', providerId: 'fixture', providerModelId: 'opaque', displayName: 'Fixture', version: 'v1', status: 'available',
    template: { kind: 'video', seconds: [6], maxReferences: 0, images: 'none', submit: { body: '{"resolution":"720p","aspect_ratio":"16:9","generate_audio":"{{generate_audio}}"}' } } });
  assert.equal(fixture.modes[0].audioGeneration, undefined);
  assert.ok(validateCanvasGenerationParameters(fixture, 'textToVideo', parameters).some(issue => issue.code === 'CAPABILITY_UNKNOWN' && issue.path === 'generateAudio'));
});

test('reference exact signatures cover only-audio, only-video and every multimodal combination', () => {
  const image = imageInput;
  const video: CanvasCapabilityInput = { role: 'referenceVideo', kind: 'video' };
  const audio: CanvasCapabilityInput = { role: 'referenceAudio', kind: 'audio' };
  assert.equal(canvasReferenceCombination([audio]), 'audio');
  assert.equal(canvasReferenceCombination([video]), 'video');
  assert.equal(canvasReferenceCombination([audio, image, video]), 'image+video+audio');
  assert.equal(canvasReferenceCombination([{ role: 'firstFrame', kind: 'image' }]), 'none');
  const fixture = model({ ...videoMode, mode: 'referenceToVideo', referenceRules: { image: { supported: true, maxCount: 3 }, video: { supported: true, maxCount: 3 }, audio: { supported: true, maxCount: 3 } }, combinationConstraints: [{ combination: 'image+audio', maxImages: 2, maxAudios: 1 }] });
  assert.deepEqual(validateCanvasGenerationParameters(fixture, 'referenceToVideo', parameters, [image, audio]), []);
  assert.ok(validateCanvasGenerationParameters(fixture, 'referenceToVideo', parameters, [audio]).some(issue => issue.code === 'INPUT_COMBINATION_UNSUPPORTED'));
  assert.ok(validateCanvasGenerationParameters(fixture, 'referenceToVideo', parameters, [video]).some(issue => issue.code === 'INPUT_COMBINATION_UNSUPPORTED'));
});

test('reference count, bytes, individual duration, total duration and formats are verified', () => {
  const fixture = model({ ...videoMode, mode: 'referenceToVideo', referenceRules: { video: { supported: true, maxCount: 1, maxBytes: 1000, maxDurationSeconds: 5, maxTotalDurationSeconds: 6, formats: ['mp4'], minFrameRate: 20, maxFrameRate: 60 } }, combinationConstraints: [{ combination: 'video', maxVideos: 1, maxTotalBytes: 1000, maxTotalDurationSeconds: 6 }] });
  const input: CanvasCapabilityInput = { role: 'referenceVideo', kind: 'video', versionId: 'bad-video', metadata: { mimeType: 'video/quicktime', byteLength: 1100, durationMs: 5500, frameRate: 12 } };
  const issues = validateCanvasGenerationParameters(fixture, 'referenceToVideo', parameters, [input, { ...input, versionId: 'bad-video-2' }]);
  assert.ok(issues.some(issue => issue.code === 'INPUT_COUNT_EXCEEDED'));
  assert.ok(issues.some(issue => issue.path.endsWith('.byteLength')));
  assert.ok(issues.some(issue => issue.path.endsWith('.durationSeconds')));
  assert.ok(issues.some(issue => issue.path.endsWith('.frameRate')));
  assert.ok(issues.some(issue => issue.code === 'INPUT_FORMAT_INVALID'));
  assert.ok(issues.some(issue => issue.path === 'inputs.totalDurationSeconds'));
  assert.ok(validateCanvasGenerationParameters(fixture, 'referenceToVideo', parameters, [{ role: 'referenceVideo', kind: 'video' }]).some(issue => issue.code === 'INPUT_METADATA_UNKNOWN'));
});

test('adapter extension parameters enforce enumerations, ranges and explicit defaults', () => {
  const fixture = model({ ...videoMode, parameters: [{ key: 'seed', type: 'number', min: 0, max: 100, step: 1, defaultValue: 4 }, { key: 'format', type: 'string', values: ['mp4', 'mov'], defaultValue: 'mp4' }] });
  assert.ok(validateCanvasGenerationParameters(fixture, 'textToVideo', { ...parameters, seed: 1.5 }).some(issue => issue.code === 'PARAMETER_INVALID'));
  assert.deepEqual(reconcileCanvasGenerationParameters(fixture, 'textToVideo', { ...parameters, seed: 1.5, format: 'webm' }).parameters, { ...parameters, seed: 4, format: 'mp4' });
  assert.ok(validateCanvasGenerationParameters(fixture, 'textToVideo', { ...parameters, unverifiedProviderFlag: true }).some(issue => issue.code === 'PARAMETER_UNSUPPORTED'));
});

test('evidence builder uses media template declarations and retains unknown output facts', () => {
  const fixture = buildCanvasModelCapability({
    id: 'custom-route', providerId: 'custom', providerModelId: 'arbitrary-name', displayName: 'Configured media route', version: 'config-v2', status: 'available',
    template: { kind: 'video', seconds: [8], maxReferences: 3, images: 'link', submit: { body: '{"first":"{{first_frame}}","last":"{{last_frame}}","references":"{{references}}","generate_audio":true}' } },
    videoProfile: { aspectRatios: ['16:9'], durationsSeconds: [4, 6, 8] },
  });
  assert.deepEqual(fixture.modes.map(mode => mode.mode), ['textToVideo', 'imageToVideo', 'firstLastFrame', 'referenceToVideo']);
  assert.deepEqual(fixture.modes[0].duration, { kind: 'fixed', seconds: 8 });
  assert.deepEqual(fixture.modes[0].audioGeneration, { mode: 'required', defaultEnabled: true });
  assert.equal(fixture.modes[0].outputVariants, undefined);
  assert.ok(validateCanvasGenerationParameters(fixture, 'textToVideo', { ...parameters, durationSeconds: 8, generateAudio: true }).some(issue => issue.path === 'resolution'));
  assert.equal(JSON.stringify(fixture).includes('{{first_frame}}'), false);
});

test('literal configured template image dimensions are usable without invented dynamic defaults', () => {
  const evidence = { id: 'fixed-image', providerId: 'custom', providerModelId: 'opaque-image', displayName: 'Fixed image route', version: 'v1', status: 'available' as const, template: { kind: 'image' as const, seconds: [], maxReferences: 2, images: 'link', submit: { body: '{"prompt":"{{prompt}}","references":"{{references}}","size":"1024x1024"}' } } };
  const fixture = buildCanvasModelCapability(evidence);
  assert.deepEqual(fixture.modes.map(mode => mode.mode), ['textToImage', 'imageToImage']);
  assert.deepEqual(fixture.modes[0].outputVariants?.[0].dimensions, { '1:1': { width: 1024, height: 1024 } });
  assert.deepEqual(validateCanvasGenerationParameters(fixture, 'textToImage', { resolution: '1024x1024', aspectRatio: '1:1' }), []);
  assert.deepEqual(validateCanvasGenerationParameters(fixture, 'imageToImage', { resolution: '1024x1024', aspectRatio: '1:1' }, [imageInput]), []);
  const dynamic = buildCanvasModelCapability({ ...evidence, template: { ...evidence.template, submit: { body: '{"size":"{{size}}"}' } } });
  assert.equal(dynamic.modes[0].outputVariants, undefined);
  const inconsistent = buildCanvasModelCapability({ ...evidence, template: { ...evidence.template, submit: { body: '{"size":"1024x1024","aspect_ratio":"16:9"}' } } });
  assert.equal(inconsistent.modes[0].outputVariants, undefined);
  const explicit = model({ mode: 'textToImage', outputVariants: fixture.modes[0].outputVariants, parameters: [{ key: 'width', type: 'number' }, { key: 'height', type: 'number' }] });
  assert.ok(validateCanvasGenerationParameters(explicit, 'textToImage', { resolution: '1024x1024', aspectRatio: '1:1', width: 512, height: 1024 }).some(issue => issue.code === 'DIMENSIONS_INVALID'));
});

test('recognizable model names and profile observations alone never grant capabilities', () => {
  const fixture = buildCanvasModelCapability({ id: 'name-only', providerId: 'relay', providerModelId: 'veo-3.1-generate-001', displayName: 'Veo', version: 'v1', status: 'available', videoProfile: { aspectRatios: ['16:9', '9:16'], durationsSeconds: [4, 6, 8] } });
  assert.deepEqual(fixture.modes, []);
  const coarse = buildCanvasModelCapability({ id: 'coarse', providerId: 'relay', providerModelId: 'upstream', displayName: 'Upstream', version: 'v1', status: 'available', capabilities: ['text_to_video', 'native_audio'], videoLimits: { durations: [4, 6, 8], aspectRatios: ['16:9'], resolutions: ['720p'] } });
  assert.equal(coarse.modes[0].audioGeneration, undefined);
  assert.ok(validateCanvasGenerationParameters(coarse, 'textToVideo', parameters).some(issue => issue.path === 'generateAudio'));
  const flat = buildCanvasModelCapability({ id: 'flat', providerId: 'relay', providerModelId: 'upstream', displayName: 'Upstream', version: 'v1', status: 'available', capabilities: ['text_to_video', 'image_to_video'], videoLimits: { durations: [4, 6, 8], aspectRatios: ['16:9', '9:16'], resolutions: ['720p', '1080p'], frameImages: ['first_frame'] } });
  assert.equal(flat.modes[0].outputVariants?.[0].aspectRatios, undefined);
  assert.equal(flat.modes[1].duration, undefined);
  assert.equal(flat.modes[1].firstFrame, true);
});

test('explicit adapter mode declarations preserve image generation and all eight discriminators', () => {
  const allModes = ['textToImage', 'imageToImage', 'textToVideo', 'imageToVideo', 'firstLastFrame', 'referenceToVideo', 'videoEdit', 'videoExtend'] as const;
  const fixture = buildCanvasModelCapability({ id: 'complete', providerId: 'adapter', providerModelId: 'exact', displayName: 'Exact adapter', version: 'v2', status: 'available', modes: allModes.map(mode => ({ ...videoMode, mode })) });
  assert.deepEqual(fixture.modes.map(mode => mode.mode), allModes);
  assert.deepEqual(validateCanvasGenerationParameters(fixture, 'textToImage', { resolution: '720p', aspectRatio: '16:9' }), []);
  assert.ok(validateCanvasGenerationParameters(fixture, 'textToImage', parameters).some(issue => issue.code === 'PARAMETER_UNSUPPORTED'));
  assert.deepEqual(validateCanvasGenerationParameters(fixture, 'textToImage', { resolution: '720p', aspectRatio: '16:9' }, [{ role: 'character', kind: 'character' }]), []);
});

test('identity image references in text and frame modes require explicit per-mode support and limits', () => {
  for (const mode of ['textToImage', 'textToVideo', 'imageToVideo', 'firstLastFrame'] as const) {
    const frames: CanvasCapabilityInput[] = mode === 'imageToVideo' || mode === 'firstLastFrame'
      ? [{ role: 'firstFrame', kind: 'image' }, ...(mode === 'firstLastFrame' ? [{ role: 'lastFrame', kind: 'image' } as const] : [])] : [];
    const fixture = model({ ...videoMode, mode, firstFrame: frames.length > 0, lastFrame: mode === 'firstLastFrame',
      referenceRules: { image: { supported: true, maxCount: 1 } }, combinationConstraints: [{ combination: 'image', maxImages: 1 }] });
    const selected = mode === 'textToImage' ? { resolution: '720p', aspectRatio: '16:9' } : parameters;
    assert.deepEqual(validateCanvasGenerationParameters(fixture, mode, selected, [...frames, imageInput]), []);
    assert.ok(validateCanvasGenerationParameters(fixture, mode, selected, [...frames, imageInput, imageInput]).some(issue => issue.code === 'INPUT_COUNT_EXCEEDED'));
    const unsupported = model({ ...fixture.modes[0], referenceRules: { image: { supported: false, maxCount: 0 } } });
    assert.ok(validateCanvasGenerationParameters(unsupported, mode, selected, [...frames, imageInput]).some(issue => issue.code === 'INPUT_ROLE_UNSUPPORTED'));
  }
});
