import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createElevenLabsAdapter,
  createMiniMaxAdapter,
} from '../lib/providers.js';

const endpoint = new URL('https://api.synthetic.invalid/v1/music');

test('ElevenLabs music adapter uses documented endpoint, auth, duration and evidence', async () => {
  let request: Request | undefined;
  const adapter = createElevenLabsAdapter({
    providerId: 'elevenlabs', modelId: 'music_v1', endpoint, apiKey: 'secret',
    fetchImpl: async (input, init) => {
      request = new Request(input, init);
      return new Response(new Uint8Array([0x49, 0x44, 0x33, 1, 2]), {
        headers: { 'content-type': 'audio/mpeg', 'character-cost': '42', 'request-id': 'req-1' },
      });
    },
  });
  const output = await adapter.createMusic!({
    endpoint, apiKey: 'secret', model: 'music_v1', idempotencyKey: 'music-1234',
    prompt: 'cinematic strings', lyrics: '[Verse]\nA quiet night', durationSeconds: 30, format: 'mp3',
  });
  assert.equal(new URL(request!.url).pathname, '/v1/music');
  assert.equal(new URL(request!.url).searchParams.get('output_format'), 'mp3_44100_128');
  assert.equal(request!.headers.get('xi-api-key'), 'secret');
  assert.equal(request!.headers.get('authorization'), null);
  assert.deepEqual(await request!.json(), { model_id: 'music_v1', composition_plan: {
    positive_global_styles: ['cinematic strings'], negative_global_styles: [], sections: [
      { section_name: 'Verse', positive_local_styles: [], negative_local_styles: [], duration_ms: 30000, lines: ['A quiet night'] },
    ],
  } });
  assert.equal(output.extension, 'mp3');
  assert.deepEqual(output.providerEvidence, { providerRequestId: 'req-1', characterCost: 42 });
});

test('ElevenLabs sound effects send text to the sound-generation API and reject invalid duration', async () => {
  let body: any;
  const adapter = createElevenLabsAdapter({
    providerId: 'elevenlabs', modelId: 'eleven_text_to_sound_v2', endpoint: new URL('https://api.synthetic.invalid/v1/sound-generation'), apiKey: 'secret',
    fetchImpl: async (input, init) => { body = { url: String(input), json: JSON.parse(String(init?.body)) }; return new Response(new Uint8Array([0x49, 0x44, 0x33])); },
  });
  const output = await adapter.createSoundEffect!({
    endpoint: new URL('https://api.synthetic.invalid/v1/sound-generation'), apiKey: 'secret', model: 'eleven_text_to_sound_v2', idempotencyKey: 'sfx-1234',
    text: 'door slam', durationSeconds: 2, format: 'mp3',
  });
  assert.equal(new URL(body.url).pathname, '/v1/sound-generation');
  assert.equal(new URL(body.url).searchParams.get('output_format'), 'mp3_44100_128');
  assert.deepEqual(body.json, { text: 'door slam', duration_seconds: 2, model_id: 'eleven_text_to_sound_v2' });
  assert.equal(output.mimeType, 'audio/mpeg');
  await assert.rejects(() => adapter.createSoundEffect!({
    endpoint: new URL('https://api.synthetic.invalid/v1/sound-generation'), apiKey: 'secret', model: 'eleven_text_to_sound_v2', idempotencyKey: 'sfx-12345',
    text: 'too long', durationSeconds: 31, format: 'mp3',
  }), { code: 'INVALID_MEDIA_REQUEST' });
  await assert.rejects(() => adapter.createSoundEffect!({
    endpoint: new URL('https://api.synthetic.invalid/v1/sound-generation'), apiKey: 'secret', model: 'eleven_text_to_sound_v2', idempotencyKey: 'sfx-wav',
    text: 'door slam', durationSeconds: 2, format: 'wav',
  }), { code: 'INVALID_MEDIA_REQUEST' });
});

test('MiniMax adapter uses documented music_generation JSON and preserves returned duration and trace evidence', async () => {
  let body: any;
  const adapter = createMiniMaxAdapter({
    providerId: 'minimax', modelId: 'music-3.0', endpoint: new URL('https://api.synthetic.invalid/v1/music_generation'), apiKey: 'secret',
    fetchImpl: async (_input, init) => { body = JSON.parse(String(init?.body)); return Response.json({ data: { audio: '494433616263' }, trace_id: 'trace-9', extra_info: { music_duration: 25364 }, base_resp: { status_code: 0 } }); },
  });
  const output = await adapter.createMusic!({
    endpoint: new URL('https://api.synthetic.invalid/v1/music_generation'), apiKey: 'secret', model: 'music-3.0', idempotencyKey: 'mx-1234', prompt: 'ambient', lyrics: '[Verse]\nWind', instrumental: false,
  });
  assert.deepEqual(body, { model: 'music-3.0', prompt: 'ambient', lyrics: '[Verse]\nWind', is_instrumental: false, output_format: 'hex', audio_setting: { format: 'mp3' } });
  assert.equal(output.extension, 'mp3');
  assert.deepEqual(output.providerEvidence, { providerRequestId: 'trace-9', durationMs: 25364 });
});

test('official adapters preserve retry-after and cancellation without exposing provider response bodies', async () => {
  const rateLimited = createElevenLabsAdapter({
    providerId: 'elevenlabs', modelId: 'music_v1', endpoint, apiKey: 'secret',
    fetchImpl: async () => new Response('private provider details', { status: 429, headers: { 'retry-after': '2' } }),
  });
  await assert.rejects(() => rateLimited.createMusic!({ endpoint, apiKey: 'secret', model: 'music_v1', idempotencyKey: 'rate-1234', prompt: 'ambient', format: 'mp3' }), error => {
    assert.ok(error && typeof error === 'object');
    const detail = error as { code?: unknown; retryAfterMs?: unknown; message?: unknown };
    assert.equal(detail.code, 'RATE_LIMITED'); assert.equal(detail.retryAfterMs, 2_000);
    assert.equal(typeof detail.message, 'string'); assert.doesNotMatch(detail.message as string, /private/); return true;
  });
  const controller = new AbortController();
  const cancelled = createMiniMaxAdapter({
    providerId: 'minimax', modelId: 'music-3.0', endpoint: new URL('https://api.synthetic.invalid/v1/music_generation'), apiKey: 'secret',
    fetchImpl: async (_input, init) => await new Promise((_resolve, reject) => {
      if (init?.signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  });
  controller.abort();
  // Abort is caller-owned and is passed via the options object in a real
  // worker; this assertion uses the same runtime function contract directly.
  await assert.rejects(() => cancelled.createMusic!({ endpoint: new URL('https://api.synthetic.invalid/v1/music_generation'), apiKey: 'secret', model: 'music-3.0', idempotencyKey: 'cancel-12345', prompt: 'ambient', signal: controller.signal }), { code: 'CANCELLED' });
});
