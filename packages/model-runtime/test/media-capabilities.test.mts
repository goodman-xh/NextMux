import assert from 'node:assert/strict';
import test from 'node:test';
import { officialMediaCapabilities } from '../lib/index.js';
import { normalizeMediaTemplate } from '../lib/media-api-template.js';

test('media capability mapping is explicit per native protocol and model', () => {
  assert.deepEqual(officialMediaCapabilities('elevenlabs_music', 'music_v2_5'), ['music_generation']);
  assert.deepEqual(officialMediaCapabilities('elevenlabs_sound_effect', 'eleven_text_to_sound_v2'), ['sound_effect_generation']);
  assert.deepEqual(officialMediaCapabilities('minimax_music', 'music-3.0'), ['music_generation']);
  assert.deepEqual(officialMediaCapabilities('minimax_music', 'music-3.0-free'), []);
  assert.deepEqual(officialMediaCapabilities('minimax_music', 'music-cover'), []);
  for (const [protocol, model] of [['elevenlabs_music', 'eleven_text_to_sound_v2'], ['minimax_music', 'M2.7'], ['openai_chat_completions', 'music_v2']]) {
    assert.deepEqual(officialMediaCapabilities(protocol as any, model), []);
  }
});

test('template first/last capability requires image transport and both frame placeholders', () => {
  const capabilities = (images: 'none' | 'data_url', body: string) => officialMediaCapabilities('async_media_template', 'video-model', {
    mediaTemplate: normalizeMediaTemplate({ preset: 'ark', images, submit: { body } }),
  });
  const both = '{"first":"{{first_frame}}","last":"{{last_frame}}"}';
  assert.equal(capabilities('data_url', both).includes('first_last_frame'), true);
  assert.equal(capabilities('none', both).includes('first_last_frame'), false);
  assert.equal(capabilities('data_url', '{"last":"{{last_frame}}"}').includes('first_last_frame'), false);
});
