import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverOfficialModels } from '../lib/index.js';

test('own model discovery retains exact-model availability and voices without inventing defaults', async () => {
  const models = await discoverOfficialModels({ protocol: 'openai_chat_completions', baseUrl: 'https://example.test/v1/', apiKey: 'secret',
    fetchImpl: async () => Response.json({ data: [
      { id: 'speech-model', available: false, output_modalities: ['speech'], voices: ['Kore', 'vendor/Voice-1', 'Kore', 'bad voice', '\r\nunsafe'] },
      { id: 'available-speech', available: true, output_modalities: ['speech'], voices: [] },
      { id: 'unknown-speech', available: 'false', output_modalities: ['speech'] },
    ] }) });
  const disabled = models.find(model => model.id === 'speech-model')!;
  assert.equal(disabled.available, false);
  assert.deepEqual(disabled.voices, ['Kore', 'vendor/Voice-1']);
  assert.deepEqual(disabled.outputModalities, ['speech']);
  assert.equal(models.find(model => model.id === 'available-speech')!.available, true);
  assert.deepEqual(models.find(model => model.id === 'available-speech')!.voices, []);
  assert.equal(models.find(model => model.id === 'unknown-speech')!.available, undefined);
  assert.equal(models.find(model => model.id === 'unknown-speech')!.voices, undefined);
});
