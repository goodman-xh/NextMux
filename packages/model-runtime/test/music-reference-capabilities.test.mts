import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverOfficialModels, modelSupportsMusicReference, officialMediaCapabilities, parseModelContract } from '../lib/index.js';
import { normalizeMediaTemplate } from '../lib/media-api-template.js';

test('music reference discovery keeps provider declarations and never guesses from model names', async () => {
  const models = await discoverOfficialModels({ protocol: 'openai_chat_completions', baseUrl: 'https://music.example.test/v1', apiKey: 'fixture',
    fetchImpl: async () => Response.json({ data: [
      { id: 'minimax/music-cover-name-only', output_modalities: ['audio'] },
      { id: 'future/song', output_modalities: ['audio'], supported_features: ['cover'], capabilities: { vocal_reference: false } },
      { id: 'future/advanced', output_modalities: ['music'], capabilities: ['vocal_reference'], input_modalities: ['audio'] },
    ] }) });
  const named = models.find(model => model.id.includes('name-only'))!;
  assert.equal(modelSupportsMusicReference(named, 'cover'), false);
  assert.equal(named.capabilities, undefined);
  const cover = models.find(model => model.id === 'future/song')!;
  assert.deepEqual(cover.capabilities, ['cover']);
  assert.equal(cover.capabilityDeclarations?.cover.source, 'provider_metadata');
  assert.equal(cover.capabilityDeclarations?.cover.scope, 'route');
  assert.equal(modelSupportsMusicReference(cover, 'cover'), true);
  assert.equal(modelSupportsMusicReference(cover, 'vocal_reference'), false);
  assert.deepEqual(models.find(model => model.id === 'future/advanced')?.capabilities, ['vocal_reference']);
});

test('music capability gates reject heuristic, transport, unknown and explicitly denied declarations', () => {
  for (const source of ['provider_metadata', 'merchant_declaration'] as const) {
    const contract = parseModelContract({ capabilities: ['vocal_reference', 'cover'] }, { protocol: '', scope: 'route', source });
    assert.equal(modelSupportsMusicReference(contract, 'vocal_reference'), true);
    assert.equal(modelSupportsMusicReference(contract, 'cover'), true);
    assert.equal(modelSupportsMusicReference({ ...contract, modelCapabilityDeclarations: { cover: { support: 'unsupported', scope: 'model', source } } }, 'cover'), false);
    assert.equal(modelSupportsMusicReference({ ...contract, routeCapabilityDeclarations: { cover: { support: 'unknown', scope: 'route', source } } }, 'cover'), false);
  }
  for (const options of [{ scope: 'transport', source: 'provider_metadata' }, { scope: 'model', source: 'model_heuristic' }] as const) {
    assert.equal(modelSupportsMusicReference(parseModelContract({ capabilities: ['cover'] }, { protocol: '', ...options }), 'cover'), false);
  }
  assert.equal(modelSupportsMusicReference(parseModelContract({ input_modalities: ['audio'] }, { protocol: '', scope: 'route' }), 'vocal_reference'), false);
  assert.equal(modelSupportsMusicReference(parseModelContract({ supported_features: ['cover'], capabilities: { cover: false } }, { protocol: '', scope: 'route' }), 'cover'), false);
});

test('generic music template requires explicit delivery configuration and a consumed reference placeholder', () => {
  const template = normalizeMediaTemplate({ kind: 'music', submit: { body: '{"vocal_id":"{{vocal_reference}}","audio":"{{reference_song}}"}' },
    vocalReference: { mode: 'base64' }, referenceSong: { mode: 'url' } });
  assert.deepEqual(officialMediaCapabilities('async_media_template', 'new-model', { mediaTemplate: template }), ['music_generation', 'vocal_reference', 'cover']);
  assert.deepEqual(officialMediaCapabilities('async_media_template', 'new-model', { mediaTemplate: { ...template, vocalReference: undefined } }), ['music_generation', 'cover']);
  assert.deepEqual(officialMediaCapabilities('async_media_template', 'new-model', { mediaTemplate: { ...template, submit: { ...template.submit, body: '{}' } } }), ['music_generation']);
  assert.deepEqual(officialMediaCapabilities('minimax_music', 'music-cover'), []);
});
