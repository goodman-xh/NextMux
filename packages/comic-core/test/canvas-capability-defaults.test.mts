import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCanvasCapability, validateCanvasGenerationParameters } from '../lib/canvas-capabilities.js';
import type { CanvasModelCapability } from '../lib/canvas-capabilities.js';

const model = (variants: readonly string[], defaultResolution?: string): CanvasModelCapability => ({
  id: 'm', providerId: 'p', providerModelId: 'm', displayName: 'M', version: 'v1', status: 'available', sources: [],
  modes: [{ mode: 'textToImage', ...(defaultResolution ? { defaultResolution } : {}),
    outputVariants: variants.map(resolution => ({ id: resolution, resolution, aspectRatios: ['1:1', '9:16'] })) }],
});

test('an unset resolution uses the only output the mode has', () => {
  const resolved = resolveCanvasCapability(model(['auto']), { mode: 'textToImage' });
  assert.equal(resolved.variant?.resolution, 'auto');
  assert.deepEqual(validateCanvasGenerationParameters(model(['auto']), 'textToImage', { aspectRatio: '1:1' }), []);
});

test('an unset resolution uses the declared default, and several undeclared choices still need a pick', () => {
  assert.equal(resolveCanvasCapability(model(['1K', '2K'], '2K'), { mode: 'textToImage' }).variant?.resolution, '2K');
  const open = resolveCanvasCapability(model(['1K', '2K']), { mode: 'textToImage' });
  assert.equal(open.variant, undefined);
  assert.ok(open.issues.some(issue => issue.code === 'RESOLUTION_INVALID'));
  assert.ok(resolveCanvasCapability(model(['1K', '2K'], '2K'), { mode: 'textToImage', resolution: '4K' }).issues.some(issue => issue.code === 'RESOLUTION_INVALID'));
});
