import assert from 'node:assert/strict';
import test from 'node:test';
import { ownModelKind, ownModelCategories } from '../lib/browser/nextmux-own-model-kind.js';

test('own API purpose keeps reranking, decisions and moderation distinct without changing IDs', () => {
    for (const [id, output, expected] of [
        ['cohere/rerank-4-fast', ['rerank'], 'rerank'],
        ['~typesafe/jev-latest', ['decisions'], 'decision'],
        ['togethercomputer/tev1-4b-experimental', ['decisions'], 'decision'],
        ['meta-llama/llama-guard-4-12b', ['text'], 'moderation'],
        ['fal-ai/trellis-2', ['3d'], '3d'],
        ['openai/gpt-image-1', ['text'], 'image'],
        ['openai/tts-1', ['text'], 'speech']
    ]) {
        const model = { id, outputModalities: output };
        assert.equal(ownModelKind(model), expected);
        assert.deepEqual(ownModelCategories(model), [expected]);
        assert.equal(model.id, id);
        assert.deepEqual(model.outputModalities, output);
    }
});

test('own API dual output remains discoverable in both groups; input vision and provider names do not create tasks', () => {
    assert.deepEqual(ownModelCategories({ id: 'openrouter/auto', outputModalities: ['text', 'image'] }), ['llm', 'image']);
    assert.deepEqual(ownModelCategories({ id: 'openai/gpt-5.5', inputModalities: ['image'], outputModalities: ['text', 'image'] }, { kind: 'llm', output: ['text', 'image'] }), ['llm', 'image']);
    assert.deepEqual(ownModelCategories({ id: 'vendor/chat', inputModalities: ['image'], outputModalities: ['text'] }), ['llm']);
    assert.equal(ownModelKind({ id: 'amazon/nova-3' }), 'llm');
    assert.equal(ownModelKind({ id: 'deepgram/nova-3' }), 'transcription');
    assert.equal(ownModelKind({ id: 'deepgram/nova-3', outputModalities: ['text'] }), 'transcription');
    assert.equal(ownModelKind({ id: 'runway/gen4_image' }), 'image');
    assert.equal(ownModelKind({ id: 'deepgram/flux-tts' }), 'speech');
    assert.equal(ownModelKind({ id: 'deepgram/flux-tts', outputModalities: ['text'] }), 'speech');
    assert.equal(ownModelKind({ id: '302ai/gemini-3-pro-image-preview', outputModalities: ['text'] }), 'image');
    assert.deepEqual(ownModelCategories({ id: 'tencent/hunyuan3d-2.5', outputModalities: ['text'] }), ['3d', 'llm']);
    assert.deepEqual(ownModelCategories({ id: 'fal-ai/trellis-2', outputModalities: ['3d'] }), ['3d']);
});

test('own-model names follow the runtime taxonomy for Alibaba Wan and ElevenLabs ids', async () => {
    const { ownModelKind } = await import('../lib/browser/nextmux-own-model-kind.js');
    const kind = id => ownModelKind({ id });
    assert.equal(kind('wan2.1-t2v-turbo'), 'video');
    assert.equal(kind('wan2.2-i2v-plus'), 'video');
    assert.equal(kind('wanx2.1-kf2v-plus'), 'video');
    assert.equal(kind('wan2.2-s2v'), 'video');
    assert.equal(kind('wanx2.1-t2i-turbo'), 'image');
    assert.equal(kind('wan2.2-t2i-flash'), 'image');
    assert.equal(kind('wanx2.1-imageedit'), 'image', 'image editing is a picture model');
    assert.equal(kind('eleven_multilingual_v2'), 'speech');
    assert.equal(kind('elevenlabs/eleven_turbo_v2_5'), 'speech');
    assert.equal(kind('eleven_text_to_sound_v2'), 'sound_effect', 'sound effects are matched before the eleven_ voice rule');
    assert.equal(kind('stable-audio-sfx'), 'sound_effect');
    assert.equal(kind('tts-1-hd'), 'speech');
    assert.equal(kind('gpt-4o'), 'llm');
});
