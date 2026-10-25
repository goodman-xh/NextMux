import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveModelModalities, merchantModelCategory, merchantOutputCategories } from '../lib/merchant-modalities.js';

test('empty or malformed discovery falls back while a nonempty provider declaration is authoritative', () => {
    for (const value of [undefined, null, '[]', [], '[null, 1, " "]', '{invalid']) {
        assert.deepEqual(effectiveModelModalities(value, '["text", "image"]'), ['text', 'image']);
    }
    assert.deepEqual(effectiveModelModalities('["speech"]', '["text"]'), ['speech']);
    assert.deepEqual(effectiveModelModalities(['music', 'music'], ['text']), ['music']);
});

test('merchant audio output labels share normalization and never confuse audio input with output', () => {
    assert.deepEqual(merchantOutputCategories(['speech', 'music', 'audio', 'sound_effect', 'video', 'text', 'embeddings']), ['audio', 'video', 'text']);
    assert.deepEqual(merchantOutputCategories([]), []);
});

test('merchant browse categories use known model kind without changing its output declaration', () => {
    for (const id of ['openai/gpt-5.5', 'openai/gpt-5.5-pro']) {
        const model = { id, kind: 'llm', output: ['text', 'image'] };
        assert.equal(merchantModelCategory(model), 'language');
        assert.deepEqual(model.output, ['text', 'image']);
    }
    assert.equal(merchantModelCategory({ kind: 'image', output: ['text', 'image'] }), 'image');
    assert.equal(merchantModelCategory({ kind: 'video', output: ['image'] }), 'video');
    for (const kind of ['audio', 'speech', 'music', 'sound_effect', 'transcription']) {
        assert.equal(merchantModelCategory({ kind, output: ['text'] }), 'audio');
    }
    for (const kind of ['embedding', 'rerank', 'moderation', 'decision', 'other', 'future_kind']) {
        assert.equal(merchantModelCategory({ kind, output: ['text', 'image'] }), 'others');
    }
});

test('merchant catalogs without kind keep the existing output priority', () => {
    assert.equal(merchantModelCategory({ output: ['text', 'image', 'audio', 'video'] }), 'video');
    assert.equal(merchantModelCategory({ output: ['text', 'image', 'music'] }), 'audio');
    assert.equal(merchantModelCategory({ output: ['text', 'image'] }), 'image');
    assert.equal(merchantModelCategory({ output: ['text'] }), 'language');
    assert.equal(merchantModelCategory({ kind: '', output: ['text'] }), 'language');
    assert.equal(merchantModelCategory({ output: ['embeddings'] }), 'others');
    assert.equal(merchantModelCategory({}), 'others');
});
