import test from 'node:test';
import assert from 'node:assert/strict';
import { readVoiceIntentDecision, isComicVoiceIntent, COMIC_VOICE_INTENTS } from '../lib/common/nextmux-voice-intent.js';

test('reads a choice decision from any Decisions API envelope', () => {
    const decision = { type: 'choice', choice: 'rewind_small', probabilities: { rewind_small: 0.9, none: 0.1 }, confidence: 0.84 };
    assert.deepEqual(readVoiceIntentDecision(decision), { intent: 'rewind_small', confidence: 0.84 });
    assert.deepEqual(readVoiceIntentDecision({ decisions: { intent: decision } }), { intent: 'rewind_small', confidence: 0.84 });
    assert.deepEqual(readVoiceIntentDecision({ results: [{ intent: { type: 'choice', choice: 'next_shot', probabilities: { next_shot: 0.7 } } }] }), { intent: 'next_shot', confidence: 0.7 });
});

test('rejects unknown intents and malformed payloads', () => {
    assert.equal(readVoiceIntentDecision({ type: 'choice', choice: 'delete_everything', confidence: 1 }), undefined);
    assert.equal(readVoiceIntentDecision('nope'), undefined);
    assert.equal(readVoiceIntentDecision(null), undefined);
    assert.equal(isComicVoiceIntent('none'), true);
    assert.ok(Object.keys(COMIC_VOICE_INTENTS).includes('visual_edit'));
});
