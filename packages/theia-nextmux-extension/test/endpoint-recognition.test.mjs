import assert from 'node:assert/strict';
import test from 'node:test';

import { recognizeEndpoint } from '../lib/common/nextmux-endpoint-recognition.js';

test('a pasted 速创 request example becomes a custom generation API in the 速创 format', () => {
    assert.deepEqual(recognizeEndpoint('https://api.wuyinkeji.com/api/async/video_veo3.1_fast?key=abc123'),
        { providerId: 'custom_media', mediaPreset: 'wuyin', baseUrl: 'https://api.wuyinkeji.com/api/async', model: 'video_veo3.1_fast', apiKey: 'abc123' });
    assert.deepEqual(recognizeEndpoint('https://api.wuyinkeji.com/api/async/video_veo3.1_fast?key=你的密钥'),
        { providerId: 'custom_media', mediaPreset: 'wuyin', baseUrl: 'https://api.wuyinkeji.com/api/async', model: 'video_veo3.1_fast' }, 'the docs placeholder is not a key');
    assert.deepEqual(recognizeEndpoint('https://api.wuyinkeji.com/api/async'), { providerId: 'custom_media', mediaPreset: 'wuyin', baseUrl: 'https://api.wuyinkeji.com/api/async' });
});

test('fal.ai and Replicate examples split into address and model the same way', () => {
    assert.deepEqual(recognizeEndpoint('https://queue.fal.run/fal-ai/veo3/fast'), { providerId: 'custom_media', mediaPreset: 'fal', baseUrl: 'https://queue.fal.run', model: 'fal-ai/veo3/fast' });
    assert.deepEqual(recognizeEndpoint('https://api.replicate.com/v1/models/google/veo-3/predictions'),
        { providerId: 'custom_media', mediaPreset: 'replicate', baseUrl: 'https://api.replicate.com/v1', model: 'google/veo-3' });
});

test('a key in any pasted address moves to the key field; plain and chat-capable addresses are left alone', () => {
    assert.deepEqual(recognizeEndpoint('https://relay.example.com/v1?api_key=sk-1&x=1'), { baseUrl: 'https://relay.example.com/v1?x=1', apiKey: 'sk-1' });
    assert.equal(recognizeEndpoint('https://relay.example.com/v1'), undefined);
    assert.equal(recognizeEndpoint('https://dashscope.aliyuncs.com/compatible-mode/v1'), undefined);
    assert.equal(recognizeEndpoint('relay.example.com'), undefined);
});
