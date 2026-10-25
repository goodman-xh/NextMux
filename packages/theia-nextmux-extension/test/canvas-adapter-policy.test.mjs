import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCanvasCapability, validateCanvasGenerationParameters } from '@nextmux/comic-core';
import { applyCanvasCommand, createCanvasDocument } from '@nextmux/comic-core/canvas';
import { buildManagedCanvasCapability } from '../lib/common/nextmux-canvas-capabilities.js';
import { buildManagedCanvasAdapterPolicy } from '../lib/common/nextmux-canvas-adapter-policy.js';
import { canvasVideoTier } from '../lib/common/nextmux-canvas-media-tiers.js';
import { normalizeOfferingMediaTiers } from '../lib/common/nextmux-media-price-tiers.js';
import { managedCanvasImageEstimate, managedCanvasVideoEstimate } from '../lib/browser/nextmux-comic-canvas-price.js';
import { managedQuoteId, syntheticManagedVideoProof } from './fixtures/canvas-managed-proof.mjs';

// Managed (platform) offerings sold by official media tiers: the canvas offers only what a tier prices and
// what the gateway sends upstream, and the generate button shows the tier the gateway bills.

const gptTiers = {
    version: 1, kind: 'image', unit: 'image', currency: 'USD', basis: 'official_multiplier', multiplierBps: 10_000, defaultTierId: 'medium_1024x1024',
    sourceUrl: 'https://developers.openai.com/api/docs/guides/image-generation', verifiedAt: '2026-10-21',
    tiers: [['low', 6_000, 5_000], ['medium', 53_000, 41_000], ['high', 211_000, 165_000]].flatMap(([quality, square, other]) => [
        { id: `${quality}_1024x1024`, quality, size: '1024x1024', aspectRatio: '1:1', officialMicros: square, customerMicros: square },
        { id: `${quality}_1024x1536`, quality, size: '1024x1536', aspectRatio: '2:3', officialMicros: other, customerMicros: other },
        { id: `${quality}_1536x1024`, quality, size: '1536x1024', aspectRatio: '3:2', officialMicros: other, customerMicros: other }
    ])
};
const gptImage = { id: 'gpt-image-2-offering', merchantId: 'merchant', providerName: 'Relay', providerModelCode: 'gpt-image-2', canonicalModel: 'openai/gpt-image-2',
    displayName: 'GPT Image 2', status: 'active', available: true, category: 'image', capabilities: ['image_generation', 'text_to_image'],
    mediaInput: { referenceImages: false, maxReferences: 0 }, managedTransport: { protocol: 'openai' },
    price: { currency: 'USD', mode: 'reference_multiplier', imageEachMicros: 53_000, mediaTiers: gptTiers } };

const veoTiers = (extra = {}) => ({
    version: 1, kind: 'video', unit: 'second', currency: 'USD', basis: 'official_multiplier', multiplierBps: 10_000, defaultTierId: '1080p',
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', verifiedAt: '2026-10-21',
    tiers: [['720p', 100_000], ['1080p', 120_000], ['4k', 300_000]].map(([resolution, micros]) => ({ id: resolution, resolution, audio: true, officialMicros: micros, customerMicros: micros })),
    ...extra
});
const veo = (mediaTiers, resolutions = ['720p', '1080p', '4k']) => ({
    id: '22222222-2222-4222-8222-222222222222', providerName: 'Relay', providerModelCode: 'veo-3.1-fast', canonicalModel: 'google/veo-3.1-fast', displayName: 'Veo 3.1 Fast',
    status: 'active', available: true, category: 'video', capabilities: ['text_to_video'], keyPriceQuoteId: managedQuoteId,
    mediaInput: { firstFrame: false, referenceImages: false, maxReferences: 0 },
    videoLimits: { durations: [8], resolutions, aspectRatios: ['16:9', '9:16'], shapeQuoteId: managedQuoteId,
        provenShapes: syntheticManagedVideoProof({ resolutions, aspectRatios: ['16:9', '9:16'], durations: [8], frameStates: [[false, false]] }) },
    price: { currency: 'USD', mode: 'reference_multiplier', multiplierBps: 10_000, videoSecondMicros: 120_000, videoInputImageEachMicros: 0, mediaTiers }
});
const offeredResolutions = capability => [...new Set(capability.modes.flatMap(mode => (mode.outputVariants ?? []).map(variant => variant.resolution.toLowerCase())))];

test('GPT Image tiers: the managed policy offers the three priced sizes and the low / medium / high quality the gateway bills', () => {
    const policy = buildManagedCanvasAdapterPolicy(gptImage);
    assert.deepEqual(policy.imageOutputVariants?.map(variant => variant.dimensions), [{ '1:1': { width: 1024, height: 1024 }, '3:2': { width: 1536, height: 1024 }, '2:3': { width: 1024, height: 1536 } }]);
    assert.deepEqual([policy.imageQualities, policy.defaultImageQuality], [['low', 'medium', 'high'], 'medium']);
    const capability = buildManagedCanvasCapability(gptImage);
    const quality = capability.modes.find(mode => mode.mode === 'textToImage').parameters.find(parameter => parameter.key === 'quality');
    assert.deepEqual([quality.values, quality.defaultValue], [['low', 'medium', 'high'], 'medium']);
    assert.deepEqual([...resolveCanvasCapability(capability, { mode: 'textToImage' }).variant.aspectRatios].sort(), ['1:1', '2:3', '3:2']);
    assert.deepEqual(validateCanvasGenerationParameters(capability, 'textToImage', { resolution: '1K', aspectRatio: '2:3', quality: 'low' }, []), []);
    assert.ok(validateCanvasGenerationParameters(capability, 'textToImage', { resolution: '1K', aspectRatio: '16:9' }, []).length > 0, 'an unpriced shape is not offered');
    // The price follows every control: shape, then quality.
    const node = parameters => ({ id: 'n', kind: 'imageGen', title: 'P', position: { x: 0, y: 0 }, size: { width: 280, height: 280 },
        payload: { mode: 'textToImage', prompt: 'p', parameters: { resolution: '1K', ...parameters }, versions: [] } });
    assert.equal(managedCanvasImageEstimate('en', node({ aspectRatio: '1:1' }), gptImage, capability), 'US$0.053');
    assert.equal(managedCanvasImageEstimate('en', node({ aspectRatio: '3:2' }), gptImage, capability), 'US$0.041');
    assert.equal(managedCanvasImageEstimate('en', node({ aspectRatio: '3:2', quality: 'high' }), gptImage, capability), 'US$0.165');
    assert.equal(managedCanvasImageEstimate('en', node({ aspectRatio: '2:3', quality: 'low' }), gptImage, capability), 'US$0.005');
});

test('video tiers: an API that sends the output size offers every billable class; one that sends none offers only the class it renders', () => {
    assert.deepEqual(offeredResolutions(buildManagedCanvasCapability(veo(veoTiers({ requestTier: 'output_size' })))), ['720p', '1080p', '4k']);
    // Gemini-format Veo renders its 720p default whatever is asked, and bills it: only 720p is offered.
    assert.deepEqual(offeredResolutions(buildManagedCanvasCapability(veo(veoTiers({ requestTier: 'fixed', billedTierId: '720p' })))), ['720p']);
    // A table without 4K (Veo 3.1 Lite): the gateway refuses 4K, so the canvas does not offer it.
    const lite = veoTiers({ requestTier: 'output_size', tiers: veoTiers().tiers.filter(tier => tier.id !== '4k') });
    assert.deepEqual(offeredResolutions(buildManagedCanvasCapability(veo(lite))), ['720p', '1080p']);
    // A server that does not say how the tier is picked keeps every proven shape.
    assert.deepEqual(offeredResolutions(buildManagedCanvasCapability(veo(veoTiers()))), ['720p', '1080p', '4k']);
});

test('the generate button prices a video at the tier the gateway bills for the chosen resolution', () => {
    const now = '2026-10-21T00:00:00.000Z';
    const node = resolution => ({ id: 'clip', kind: 'videoGen', title: 'Clip', position: { x: 0, y: 0 }, size: { width: 320, height: 180 },
        payload: { mode: 'textToVideo', modelId: 'veo-3.1-fast', prompt: 'p', parameters: { resolution, aspectRatio: '16:9', durationSeconds: 8 }, versions: [] } });
    const board = applyCanvasCommand(createCanvasDocument({ id: 'tier-video', projectId: 'fixture-project', now }), { type: 'node.add', node: node('720p') }, { now });
    const sized = veo(veoTiers({ requestTier: 'output_size' }));
    assert.equal(managedCanvasVideoEstimate('en', board, node('720p'), sized), '$0.80');
    assert.equal(managedCanvasVideoEstimate('en', board, node('4k'), sized), '$2.40');
    const fixed = veo(veoTiers({ requestTier: 'fixed', billedTierId: '720p' }));
    assert.equal(managedCanvasVideoEstimate('en', board, node('1080p'), fixed), '$0.80', 'a fixed tier is billed whatever the panel says');
    const lite = veo(veoTiers({ requestTier: 'output_size', tiers: veoTiers().tiers.filter(tier => tier.id !== '4k') }));
    assert.equal(managedCanvasVideoEstimate('en', board, node('4k'), lite), 'Price pending', 'no price is promised for a refused class');
    assert.equal(managedCanvasVideoEstimate('en', board, node('720p'), veo(null)), '$0.96', 'a flat offering keeps its per-second price');
});

test('video tier selection mirrors the gateway: exact class, else the next class up; fixed tiers ignore the request', () => {
    const sized = normalizeOfferingMediaTiers(veoTiers({ requestTier: 'output_size' }));
    assert.equal(canvasVideoTier(sized, { resolution: '1080P' }).id, '1080p');
    assert.equal(canvasVideoTier(sized, { resolution: '768p' }).id, '1080p');
    assert.equal(canvasVideoTier(sized, { resolution: '480p' }).id, '720p');
    assert.equal(canvasVideoTier(sized, { resolution: 'auto' }).id, '1080p', 'the API chooses: the table default');
    const fixed = normalizeOfferingMediaTiers(veoTiers({ requestTier: 'fixed', billedTierId: '720p' }));
    assert.equal(canvasVideoTier(fixed, { resolution: '4k' }).id, '720p');
});
