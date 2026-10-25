import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCanvasCommand, createCanvasDocument } from '@nextmux/comic-core/canvas';
import { buildManagedCanvasCapability } from '../lib/common/nextmux-canvas-capabilities.js';
import { canvasImageEstimateParameters, canvasVideoEstimateParameters } from '../lib/common/nextmux-canvas-estimate-parameters.js';
import { estimateManagedVideoCostMicros } from '../lib/common/nextmux-media-cost-estimator.js';
import { managedCanvasImageEstimateMicros, managedCanvasVideoEstimateMicros } from '../lib/browser/nextmux-comic-canvas-price.js';
import { managedQuoteId, syntheticManagedVideoProof } from './fixtures/canvas-managed-proof.mjs';

// The canvas badge and the platform service's pre-flight reservation price a node on the same parameters, its model's
// defaults filled in; the service used to assume 5 seconds and no size.
const now = '2026-10-01T00:00:00.000Z';
const veo = {
    id: '22222222-2222-4222-8222-222222222222', providerName: 'Relay', providerModelCode: 'veo-3.1-fast', canonicalModel: 'google/veo-3.1-fast', displayName: 'Veo 3.1 Fast',
    status: 'active', available: true, category: 'video', capabilities: ['text_to_video'], keyPriceQuoteId: managedQuoteId,
    mediaInput: { firstFrame: false, referenceImages: false, maxReferences: 0 },
    videoLimits: { durations: [8], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16'], shapeQuoteId: managedQuoteId,
        provenShapes: syntheticManagedVideoProof({ resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16'], durations: [8], frameStates: [[false, false]] }) },
    price: { currency: 'USD', mode: 'reference_multiplier', multiplierBps: 10_000, videoSecondMicros: 120_000, videoInputImageEachMicros: 0 }
};
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

function board(node) {
    const document = applyCanvasCommand(createCanvasDocument({ id: 'estimate', projectId: 'fixture-project', now }), { type: 'node.add', node }, { now });
    return { document, node: document.nodes[0] };
}
const videoNode = parameters => board({ id: 'video', kind: 'videoGen', title: 'Clip', position: { x: 0, y: 0 }, size: { width: 320, height: 240 },
    payload: { mode: 'textToVideo', modelId: 'veo-3.1-fast', prompt: 'A lighthouse at dusk.', versions: [], parameters, inputs: [] } });

test('a video without explicit seconds is priced at its model\'s default, as on the canvas', () => {
    const capability = buildManagedCanvasCapability(veo);
    const { document, node } = videoNode({});
    const parameters = canvasVideoEstimateParameters(node, capability);
    assert.equal(parameters.seconds, 8);
    const reserved = estimateManagedVideoCostMicros(veo, { durationSeconds: parameters.seconds, resolution: parameters.resolution,
        width: parameters.width, height: parameters.height, inputImageCount: 0 });
    assert.equal(reserved, managedCanvasVideoEstimateMicros(document, node, veo, capability));
    assert.equal(reserved, 960_000);
    // The old fixed 5-second guess set aside less than the click costs.
    assert.ok(estimateManagedVideoCostMicros(veo, { durationSeconds: 5, inputImageCount: 0 }) < reserved);
    assert.equal(canvasVideoEstimateParameters(videoNode({ durationSeconds: 8, resolution: '720p' }).node, capability).resolution, '720p');
    assert.deepEqual(canvasVideoEstimateParameters(videoNode({ durationSeconds: 6 }).node).seconds, 6);
});

test('a picture without explicit size or quality takes its model\'s default variant', () => {
    const capability = buildManagedCanvasCapability(gptImage);
    const { document, node } = board({ id: 'image', kind: 'imageGen', title: 'Still', position: { x: 0, y: 0 }, size: { width: 320, height: 240 },
        payload: { mode: 'textToImage', modelId: 'gpt-image-2', prompt: 'A lighthouse at dusk.', versions: [], parameters: {}, inputs: [] } });
    // The square medium picture the gateway bills by default (its tier table's default tier).
    assert.deepEqual(canvasImageEstimateParameters(node, capability), { width: 1024, height: 1024, quality: 'medium' });
    assert.equal(managedCanvasImageEstimateMicros(node, gptImage, capability, document), 53_000);
    // Without the model's capability nothing is guessed: the estimator's own defaults apply on both sides.
    assert.deepEqual(canvasImageEstimateParameters(node), {});
    assert.deepEqual(canvasImageEstimateParameters(videoNode({}).node, capability), {});
});
