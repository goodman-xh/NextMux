import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCanvasGenerationParameters, resolveCanvasCapability } from '@nextmux/comic-core';
import { canvasImageResolutionClass, canvasImageTier, canvasImageTierPolicy, offeringMediaTiers } from '../lib/common/nextmux-canvas-media-tiers.js';
import { buildManagedCanvasCapability } from '../lib/common/nextmux-canvas-capabilities.js';
import { managedCanvasImageEstimate } from '../lib/browser/nextmux-comic-canvas-price.js';

const gptTiers = {
  version: 1, kind: 'image', unit: 'image', currency: 'USD', basis: 'official_multiplier', multiplierBps: 10_000, defaultTierId: 'medium_1024x1024',
  sourceUrl: 'https://developers.openai.com/api/docs/guides/image-generation', verifiedAt: '2026-10-21',
  tiers: [['low', 11_000, 16_000], ['medium', 42_000, 63_000], ['high', 167_000, 250_000]].flatMap(([quality, square, other]) => [
    { id: `${quality}_1024x1024`, quality, size: '1024x1024', aspectRatio: '1:1', officialMicros: square, customerMicros: square },
    { id: `${quality}_1024x1536`, quality, size: '1024x1536', aspectRatio: '2:3', officialMicros: other, customerMicros: other },
    { id: `${quality}_1536x1024`, quality, size: '1536x1024', aspectRatio: '3:2', officialMicros: other, customerMicros: other },
  ]),
};
const geminiTiers = {
  version: 1, kind: 'image', unit: 'image', currency: 'USD', basis: 'official_multiplier', multiplierBps: 10_000, defaultTierId: '1k',
  sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', verifiedAt: '2026-10-21',
  tiers: [['0.5K', 45_000], ['1K', 67_000], ['2K', 101_000], ['4K', 151_000]].map(([resolution, micros]) => ({ id: resolution.toLowerCase(), resolution, officialMicros: micros, customerMicros: micros })),
};

test('GPT Image tiers offer exactly the three priced sizes and the low / medium / high quality choice', () => {
  const policy = canvasImageTierPolicy(gptTiers, ['1:1', '16:9', '9:16', '3:2', '2:3']);
  assert.deepEqual(policy.imageOutputVariants[0].dimensions, { '1:1': { width: 1024, height: 1024 }, '3:2': { width: 1536, height: 1024 }, '2:3': { width: 1024, height: 1536 } });
  assert.deepEqual([policy.imageQualities, policy.defaultImageQuality], [['low', 'medium', 'high'], 'medium']);
  // The tier picked here is the one the gateway bills (media-benchmark-tiers.js selectImageTier).
  assert.equal(canvasImageTier(gptTiers, { width: 1536, height: 1024, quality: 'high' }).id, 'high_1536x1024');
  assert.equal(canvasImageTier(gptTiers, { width: 1024, height: 1024 }).id, 'medium_1024x1024');
  assert.equal(canvasImageTier(gptTiers, { width: 1344, height: 768, quality: 'auto' }).id, 'medium_1536x1024');
});

test('output-class tiers offer 1K / 2K / 4K within the 4096-pixel request limit; 0.5K is never offered', () => {
  const policy = canvasImageTierPolicy(geminiTiers, ['1:1', '16:9', '9:16']);
  assert.deepEqual(policy.imageOutputVariants.map(variant => variant.resolution), ['1K', '2K', '4K']);
  const fourK = policy.imageOutputVariants.find(variant => variant.resolution === '4K').dimensions;
  assert.ok(Object.values(fourK).every(size => size.width <= 4096 && size.height <= 4096));
  for (const variant of policy.imageOutputVariants) for (const size of Object.values(variant.dimensions))
    assert.equal(canvasImageTier(geminiTiers, { ...size, resolution: variant.resolution }).resolution, variant.resolution, `${variant.resolution} ${size.width}x${size.height}`);
  assert.equal(canvasImageResolutionClass('2k'), '2K');
  assert.equal(canvasImageResolutionClass('auto'), undefined);
  assert.equal(canvasImageTierPolicy({ ...geminiTiers, kind: 'video' }, ['1:1']), undefined);
  assert.equal(offeringMediaTiers({ price: { mediaTiers: gptTiers } }).defaultTierId, 'medium_1024x1024');
});

test('a managed tier offering exposes the quality parameter and the generate button shows the billed tier', () => {
  const offering = { id: 'offering', merchantId: 'merchant', providerName: 'Relay', providerModelCode: 'gpt-image-1', canonicalModel: 'openai/gpt-image-1',
    displayName: 'GPT Image 1', status: 'active', available: true, category: 'image', capabilities: ['image_generation', 'text_to_image'],
    mediaInput: { referenceImages: false, maxReferences: 0 }, managedTransport: { protocol: 'openai' },
    price: { currency: 'USD', mode: 'reference_multiplier', imageEachMicros: 42_000, mediaTiers: gptTiers } };
  const capability = buildManagedCanvasCapability(offering);
  const mode = capability.modes.find(item => item.mode === 'textToImage');
  const quality = mode.parameters.find(parameter => parameter.key === 'quality');
  assert.deepEqual([quality.values, quality.defaultValue], [['low', 'medium', 'high'], 'medium']);
  assert.deepEqual(resolveCanvasCapability(capability, { mode: 'textToImage' }).variant.aspectRatios, ['1:1', '3:2', '2:3']);
  assert.deepEqual(validateCanvasGenerationParameters(capability, 'textToImage', { resolution: '1K', aspectRatio: '3:2', quality: 'high' }, []), []);
  assert.ok(validateCanvasGenerationParameters(capability, 'textToImage', { resolution: '1K', aspectRatio: '3:2', quality: 'ultra' }, []).length > 0);
  const node = { id: 'n', kind: 'imageGen', title: 'P', position: { x: 0, y: 0 }, size: { width: 280, height: 280 },
    payload: { mode: 'textToImage', prompt: 'p', parameters: { resolution: '1K', aspectRatio: '3:2', quality: 'high' }, versions: [] } };
  assert.equal(managedCanvasImageEstimate('en', node, offering, capability), 'US$0.25');
  assert.equal(managedCanvasImageEstimate('en', { ...node, payload: { ...node.payload, parameters: { resolution: '1K', aspectRatio: '1:1' } } }, offering, capability), 'US$0.042');
});
