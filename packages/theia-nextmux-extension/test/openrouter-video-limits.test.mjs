import assert from 'node:assert/strict';
import test from 'node:test';

import { fitOpenRouterVideoRequest, parseOpenRouterVideoModels } from '../lib/node/nextmux-openrouter-video-limits.js';

const listing = parseOpenRouterVideoModels({
    data: [
        { id: 'google/veo-3.1-fast', supported_durations: [4, 6, 8], supported_resolutions: ['720p', '1080p', '4K'], supported_aspect_ratios: ['16:9', '9:16'], supported_frame_images: ['first_frame', 'last_frame'], generate_audio: true },
        { id: 'kwaivgi/kling-v3.0-pro', supported_durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], supported_resolutions: ['720p'], supported_aspect_ratios: ['16:9', '9:16', '1:1'], supported_frame_images: ['first_frame', 'last_frame'] },
        { id: 'openai/sora-2-pro', supported_durations: [4, 8, 12, 16, 20], supported_resolutions: ['720p', '1080p'], supported_aspect_ratios: ['16:9', '9:16'], supported_frame_images: null },
        { id: 'broken', supported_durations: 'x' }
    ]
});

test('a shot length the model does not take becomes the shortest allowed clip that covers it', () => {
    const veo = listing.get('google/veo-3.1-fast');
    assert.equal(fitOpenRouterVideoRequest(veo, { durationSeconds: 5, width: 1920, height: 1080, hasPicture: true }).duration, 6);
    assert.equal(fitOpenRouterVideoRequest(veo, { durationSeconds: 7, width: 1920, height: 1080, hasPicture: true }).duration, 8);
    assert.equal(fitOpenRouterVideoRequest(veo, { durationSeconds: 6, width: 1920, height: 1080, hasPicture: true }).duration, 6);
    assert.equal(fitOpenRouterVideoRequest(veo, { durationSeconds: 12, width: 1920, height: 1080, hasPicture: true }).duration, 8);
    assert.equal(fitOpenRouterVideoRequest(veo, { durationSeconds: 4.2, width: 1920, height: 1080, hasPicture: false }).duration, 6);
});

test('resolution and ratio stay within what the model lists', () => {
    const kling = fitOpenRouterVideoRequest(listing.get('kwaivgi/kling-v3.0-pro'), { durationSeconds: 5, width: 1920, height: 1080, hasPicture: true });
    assert.deepEqual(kling, { duration: 5, resolution: '720p', aspectRatio: '16:9', firstFrame: true });
    const veoSquare = fitOpenRouterVideoRequest(listing.get('google/veo-3.1-fast'), { durationSeconds: 4, width: 1080, height: 1080, hasPicture: false });
    assert.equal(veoSquare.resolution, '1080p');
    assert.ok(['16:9', '9:16'].includes(veoSquare.aspectRatio));
    assert.equal(fitOpenRouterVideoRequest(listing.get('google/veo-3.1-fast'), { durationSeconds: 4, width: 1080, height: 1920, hasPicture: false }).aspectRatio, '9:16');
});

test('a picture is a style reference where the model takes no frames, and unknown models keep the old request', () => {
    assert.equal(fitOpenRouterVideoRequest(listing.get('openai/sora-2-pro'), { durationSeconds: 6, width: 1280, height: 720, hasPicture: true }).firstFrame, false);
    assert.deepEqual(fitOpenRouterVideoRequest(undefined, { durationSeconds: 7, width: 1280, height: 720, hasPicture: true }),
        { duration: 7, resolution: '720p', aspectRatio: '16:9', firstFrame: true });
    assert.deepEqual(listing.get('broken')?.durations, []);
});
