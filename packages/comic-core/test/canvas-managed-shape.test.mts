import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canvasVideoOutputDimensions,
  resolveCanvasDerivedAspectRatio,
  validateCanvasGenerationParameters,
  type CanvasCapabilityInput,
  type CanvasModelCapability,
  type CanvasVideoRequestShape,
} from '../lib/canvas-capabilities.js';

const first: CanvasCapabilityInput = { role: 'firstFrame', kind: 'image', versionId: 'first', metadata: { width: 1918, height: 1080 } };
const last: CanvasCapabilityInput = { role: 'lastFrame', kind: 'image', versionId: 'last', metadata: { width: 1080, height: 1920 } };
const reference: CanvasCapabilityInput = { role: 'referenceImage', kind: 'image', versionId: 'reference' };
const shape: CanvasVideoRequestShape = { aspectRatio: '16:9', durationSeconds: 6, firstFrame: true, lastFrame: true,
  referenceImages: 1, requestAudio: false, width: 1280, height: 720 };
const model = (rows: readonly CanvasVideoRequestShape[] = [shape]): CanvasModelCapability => ({
  id: 'synthetic-managed-shape', providerId: 'fixture', providerModelId: 'fixture-video', displayName: 'Synthetic proof',
  version: 'shape-v1', status: 'available', sources: ['synthetic complete-shape proof'], modes: [{
    mode: 'firstLastFrame', firstFrame: true, lastFrame: true, duration: { kind: 'enum', seconds: [6, 8], defaultSeconds: 6 },
    audioGeneration: { mode: 'required', defaultEnabled: true },
    referenceRules: { image: { supported: true, maxCount: 2 } }, combinationConstraints: [{ combination: 'image', maxImages: 2 }],
    outputVariants: [{ id: '720p', resolution: '720p', aspectRatios: ['auto', '16:9'], requestShapes: rows, requestAudioOverride: false,
      derivedAspectRatio: { inputRole: 'firstFrame', aspectRatios: ['16:9'], tolerance: 0.02, allowOmission: false } }]
  }]
});
const parameters = { resolution: '720p', aspectRatio: 'auto', durationSeconds: 6 };

test('complete managed shape proof uses the first-frame role, reference count and actual audio control', () => {
  assert.deepEqual(validateCanvasGenerationParameters(model(), 'firstLastFrame', parameters, [last, reference, first]), []);
  assert.deepEqual(canvasVideoOutputDimensions('720p', '16:9'), { width: 1280, height: 720 });
  assert.deepEqual(canvasVideoOutputDimensions('768p', '9:16'), { width: 768, height: 1366 });
  assert.deepEqual(canvasVideoOutputDimensions('2K', '16:9'), { width: 2560, height: 1440 });
});

test('a public shape cannot grant a different frame count, reference count, duration, audio control or pixel size', () => {
  for (const row of [
    { ...shape, firstFrame: false, lastFrame: false }, { ...shape, lastFrame: false }, { ...shape, referenceImages: 0 },
    { ...shape, durationSeconds: 8 }, { ...shape, requestAudio: true }, { ...shape, width: 1278 }, { ...shape, height: 718 },
  ]) {
    assert.ok(validateCanvasGenerationParameters(model([row]), 'firstLastFrame', parameters, [first, last, reference])
      .some(issue => issue.code === 'VIDEO_REQUEST_SHAPE_UNPROVEN'));
  }
  assert.ok(validateCanvasGenerationParameters(model([]), 'firstLastFrame', parameters, [first, last, reference])
    .some(issue => issue.code === 'VIDEO_REQUEST_SHAPE_UNPROVEN'));
});

test('managed auto rejects an unproven measured aspect before a panel can submit', () => {
  const wide = { ...first, metadata: { width: 2330, height: 1000 } };
  const issues = validateCanvasGenerationParameters(model(), 'firstLastFrame', parameters, [wide, last, reference]);
  assert.ok(issues.some(issue => issue.path === 'aspectRatio'));
  assert.match(issues.map(issue => issue.message).join(' '), /aspect|ratio/iu);
  assert.deepEqual(resolveCanvasDerivedAspectRatio({ inputRole: 'firstFrame', aspectRatios: ['16:9'], tolerance: 0.02, allowOmission: false }, [last, first]).issues, []);
  const derived = resolveCanvasDerivedAspectRatio({ inputRole: 'firstFrame', aspectRatios: ['16:9'], tolerance: 0.02, allowOmission: false }, [last, first]);
  assert.equal(derived.aspectRatio, '16:9');
  assert.equal(derived.input?.versionId, 'first');
});

test('auto metadata and exact output dimensions remain required under a full-shape proof', () => {
  for (const metadata of [undefined, { width: 0, height: 1000 }, { width: 1918.5, height: 1080 }, { width: Infinity, height: 1080 }]) {
    assert.ok(validateCanvasGenerationParameters(model(), 'firstLastFrame', parameters, [{ ...first, metadata }, last, reference])
      .some(issue => issue.path.includes('width') || issue.path.includes('height') || issue.path.endsWith('aspectRatio')));
  }
  assert.ok(validateCanvasGenerationParameters(model(), 'firstLastFrame', { ...parameters, width: 1280, height: 722 }, [first, last, reference])
    .some(issue => issue.code === 'DIMENSIONS_INVALID'));
});

test('malformed proof rows and a missing auto derivation rule report capability issues', () => {
  const malformed = model([{ ...shape, referenceImages: -1 }]);
  assert.ok(validateCanvasGenerationParameters(malformed, 'firstLastFrame', parameters, [first, last, reference])
    .some(issue => issue.code === 'CAPABILITY_INVALID'));
  const missingRule = model();
  const mode = missingRule.modes[0], variant = mode.outputVariants![0];
  const cap = { ...missingRule, modes: [{ ...mode, outputVariants: [{ ...variant, derivedAspectRatio: undefined }] }] };
  assert.ok(validateCanvasGenerationParameters(cap, 'firstLastFrame', parameters, [first, last, reference])
    .some(issue => issue.code === 'CAPABILITY_UNKNOWN' && issue.path === 'aspectRatio'));
});
