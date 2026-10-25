import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANVAS_IMAGE_TOOL_TRANSPORT_SUPPORT, canvasImageToolMissingOutput,
  canvasImageToolOutputDimensions, resolveCanvasImageToolRoute,
} from '../lib/canvas-image-tool-routes.js';
import type { CanvasCapabilityInput, CanvasModelCapability, CanvasModeCapability, CanvasOutputVariant } from '../lib/canvas-capabilities.js';

const source: CanvasCapabilityInput = { id: 'source', versionId: 'version-source', role: 'referenceImage', kind: 'image', metadata: { width: 512, height: 512, mimeType: 'image/png' } };
const square = (pixels: number): CanvasOutputVariant => ({ id: `output:${pixels}`, resolution: `${pixels}x${pixels}`, aspectRatios: ['1:1'], defaultAspectRatio: '1:1', dimensions: { '1:1': { width: pixels, height: pixels } } });
const mode: CanvasModeCapability = { mode: 'imageToImage', outputVariants: [square(512), square(1024), square(2048)], defaultResolution: '512x512', referenceRules: { image: { supported: true, maxCount: 4 } }, combinationConstraints: [{ combination: 'image', maxImages: 4 }] };
const capability: CanvasModelCapability = { id: 'image-route', providerId: 'generic', providerModelId: 'openai/gpt-image-2', displayName: 'GPT Image 2', version: 'test:v1', status: 'available', sources: ['fixture'], modes: [mode] };
const plan = (override: Partial<Parameters<typeof resolveCanvasImageToolRoute>[0]> = {}) => resolveCanvasImageToolRoute({ capability, inputs: [source], ...override });

test('ordinary image route fills only declared defaults and freezes a detached result', () => {
  const parameters = {};
  const result = plan({ parameters });
  assert.ok(result.available);
  assert.equal(result.mode, 'imageToImage');
  assert.deepEqual(result.parametersPatch, { resolution: '512x512', aspectRatio: '1:1' });
  assert.deepEqual(result.dimensions, { width: 512, height: 512 });
  assert.ok(Object.isFrozen(result.parametersPatch));
  assert.notEqual(result.variant, mode.outputVariants![0]);
  assert.deepEqual(parameters, {});
  assert.equal(Object.isFrozen(mode.outputVariants![0]), false);
});

test('highest resolution chooses the largest executable pixel area preserving source aspect', () => {
  const result = plan({ highestResolution: true, preserveSourceAspect: true, requireEnlargement: true });
  assert.ok(result.available);
  assert.deepEqual(result.parametersPatch, { resolution: '2048x2048', aspectRatio: '1:1' });
  assert.deepEqual(result.dimensions, { width: 2048, height: 2048 });
  const unsorted = { ...capability, modes: [{ ...mode, outputVariants: [square(2048), square(512), square(1024)] }] };
  const selected = plan({ capability: unsorted, highestResolution: true, preserveSourceAspect: true });
  assert.ok(selected.available);
  assert.equal(selected.parametersPatch.resolution, '2048x2048');
});

test('highest intent supersedes valid inherited fitter dimensions while ordinary edits keep strict dimensions', () => {
  const inherited = { resolution: '1024x1024', aspectRatio: '1:1', width: 1024, height: 1024 };
  const result = plan({ parameters: inherited, highestResolution: true, preserveSourceAspect: true, requireEnlargement: true });
  assert.ok(result.available);
  assert.deepEqual(result.parametersPatch, { resolution: '2048x2048', aspectRatio: '1:1' });
  assert.deepEqual(result.dimensions, { width: 2048, height: 2048 });
  assert.deepEqual(inherited, { resolution: '1024x1024', aspectRatio: '1:1', width: 1024, height: 1024 });
  const parameters = (['width', 'height'] as const).map(key => ({ key, type: 'number' as const, min: 64, max: 4096, step: 1, required: true, defaultValue: 1024 }));
  const dimensionalCapability = { ...capability, modes: [{ ...mode, parameters }] };
  const required = plan({ capability: dimensionalCapability, parameters: inherited, highestResolution: true });
  assert.ok(required.available);
  assert.deepEqual(required.parametersPatch, { resolution: '2048x2048', aspectRatio: '1:1', width: 2048, height: 2048 });
  const ordinary = plan({ capability: dimensionalCapability, parameters: { ...inherited, resolution: '2048x2048' } });
  assert.equal(ordinary.available, false);
  if (!ordinary.available) assert.ok(ordinary.issues.some(issue => issue.code === 'DIMENSIONS_INVALID'));
  for (const width of ['1024', -1, 8192, NaN]) assert.equal(plan({ parameters: { ...inherited, width }, highestResolution: true }).available, false);
});

test('highest output rejects oversize, unknown, automatic and ambiguous K labels', () => {
  const auto = { id: 'auto', resolution: 'auto', aspectRatios: ['1:1'], defaultAspectRatio: '1:1' };
  const mixed = { ...capability, modes: [{ ...mode, outputVariants: [square(8192), auto, { ...auto, resolution: '4K' }, square(2048)] }] };
  const result = plan({ capability: mixed, highestResolution: true });
  assert.ok(result.available);
  assert.equal(result.parametersPatch.resolution, '2048x2048');
  for (const variant of [auto, { ...auto, dimensions: { '1:1': { width: 2048, height: 2048 } } }, { ...auto, resolution: '4K' }, { ...auto, resolution: 'provider-size' }]) {
    const failed = plan({ capability: { ...capability, modes: [{ ...mode, outputVariants: [variant], defaultResolution: variant.resolution }] }, highestResolution: true });
    assert.equal(failed.available, false);
    if (!failed.available) assert.deepEqual(failed.missingCapabilities, ['known highest-resolution output dimensions']);
  }
});

test('provider-owned auto remains usable for ordinary edits without promising returned pixels', () => {
  const automatic = { ...capability, modes: [{ ...mode, outputVariants: [{ id: 'automatic', resolution: 'auto', aspectRatios: ['1:1', '16:9'], defaultAspectRatio: '1:1' }], defaultResolution: 'auto' }] };
  const result = plan({ capability: automatic });
  assert.ok(result.available);
  assert.deepEqual(result.parametersPatch, { resolution: 'auto', aspectRatio: '1:1' });
  assert.equal(result.dimensions, undefined);
});

test('highest selection requires enlargement only when the caller asks for upscale', () => {
  const largeSource = { ...source, metadata: { width: 2048, height: 2048 } };
  assert.ok(plan({ inputs: [largeSource], highestResolution: true, preserveSourceAspect: true }).available);
  const sameSize = plan({ inputs: [largeSource], highestResolution: true, preserveSourceAspect: true, requireEnlargement: true });
  assert.equal(sameSize.available, false);
  const missing = plan({ inputs: [{ ...source, metadata: undefined }], highestResolution: true, preserveSourceAspect: true });
  assert.equal(missing.available, false);
  if (!missing.available) assert.deepEqual(missing.missingCapabilities, ['measured source image dimensions']);
});

test('portrait source rejects a larger landscape and selects its largest exact portrait variant', () => {
  const variants: CanvasOutputVariant[] = [
    { id: 'landscape', resolution: 'landscape', aspectRatios: ['16:9'], dimensions: { '16:9': { width: 4096, height: 2304 } } },
    { id: 'portrait', resolution: 'portrait', aspectRatios: ['9:16'], dimensions: { '9:16': { width: 1152, height: 2048 } } },
  ];
  const result = plan({ capability: { ...capability, modes: [{ ...mode, outputVariants: variants }] }, inputs: [{ ...source, metadata: { width: 288, height: 512 } }], highestResolution: true, preserveSourceAspect: true, requireEnlargement: true });
  assert.ok(result.available);
  assert.deepEqual(result.parametersPatch, { resolution: 'portrait', aspectRatio: '9:16' });
  assert.equal(plan({ capability: { ...capability, modes: [{ ...mode, outputVariants: variants }] }, parameters: { aspectRatio: '16:9' }, inputs: [{ ...source, metadata: { width: 288, height: 512 } }], highestResolution: true, preserveSourceAspect: true }).available, false);
});

test('explicit pixels, exact K dimensions and even short-side output dimensions follow queue limits', () => {
  assert.deepEqual(canvasImageToolOutputDimensions(square(1024), '1:1'), { width: 1024, height: 1024 });
  const variant = { id: 'short', resolution: '1080p', aspectRatios: ['16:9'] };
  assert.deepEqual(canvasImageToolOutputDimensions(variant, '16:9'), { width: 1920, height: 1080 });
  assert.equal(canvasImageToolOutputDimensions({ ...variant, resolution: '4K' }, '16:9'), undefined);
  assert.deepEqual(canvasImageToolOutputDimensions({ ...variant, resolution: '4K', dimensions: { '16:9': { width: 3840, height: 2160 } } }, '16:9'), { width: 3840, height: 2160 });
  assert.equal(canvasImageToolOutputDimensions({ ...variant, resolution: '2160p' }, '4:1'), undefined);
});

test('effective image capability is required independently of model identity', () => {
  assert.equal(plan({ capability: { ...capability, status: 'unknown' } }).available, false);
  assert.equal(plan({ capability: { ...capability, providerModelId: 'unregistered-model' } }).available, true);
  assert.equal(plan({ capability: { ...capability, modes: [] } }).available, false);
  for (const override of [{ referenceRules: undefined }, { combinationConstraints: undefined }, { outputVariants: undefined }]) {
    assert.equal(plan({ capability: { ...capability, modes: [{ ...mode, ...override }] } }).available, false);
  }
});

test('invalid explicit parameters and unsupported references retain validator evidence', () => {
  for (const parameters of [{ resolution: 'nonsense' }, { aspectRatio: '9:16' }, { durationSeconds: 8 }]) {
    const result = plan({ parameters });
    assert.equal(result.available, false);
    if (!result.available) assert.ok(result.issues.length > 0);
  }
  const mask = plan({ inputs: [source, { ...source, id: 'mask', role: 'mask' }] });
  assert.equal(mask.available, false);
  if (!mask.available) assert.ok(mask.issues.some(issue => issue.code === 'INPUT_ROLE_UNSUPPORTED'));
  const missingSource = plan({ inputs: [] });
  assert.equal(missingSource.available, false);
  if (!missingSource.available) assert.ok(missingSource.issues.some(issue => issue.code === 'INPUT_REQUIRED'));
});

test('catalog parameters cannot invent generic transport and queue reference limits stay enforced', () => {
  const extended = { ...mode, parameters: [{ key: 'background', type: 'string' as const, values: ['transparent'], defaultValue: 'transparent' }] };
  const background = plan({ capability: { ...capability, modes: [extended] } });
  assert.equal(background.available, false);
  if (!background.available) assert.deepEqual(background.missingCapabilities, ['parameter transport: background']);
  const permissive = { ...mode, referenceRules: { image: { supported: true, maxCount: 8 } }, combinationConstraints: [{ combination: 'image' as const, maxImages: 8 }] };
  const excessive = plan({ capability: { ...capability, modes: [permissive] }, inputs: Array.from({ length: 5 }, (_, index) => ({ ...source, id: `ref:${index}` })) });
  assert.equal(excessive.available, false);
  if (!excessive.available) assert.deepEqual(excessive.missingCapabilities, ['image reference count within media queue limit of four']);
});

test('mask, alpha, true depth and layer output availability never comes from a model name', () => {
  assert.deepEqual(CANVAS_IMAGE_TOOL_TRANSPORT_SUPPORT, { referenceImage: true, maskInput: false, transparentBackground: false, alphaOutput: false, trueDepthOutput: false, layerOutputs: false });
  for (const output of ['alpha', 'depthMap', 'layers'] as const) {
    assert.ok(canvasImageToolMissingOutput(output).length > 0);
    assert.ok(Object.isFrozen(canvasImageToolMissingOutput(output)));
  }
});
