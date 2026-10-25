import assert from 'node:assert/strict';
import test from 'node:test';
import { requestChatAudioMusic, requestElevenLabsMusic } from '../lib/index.js';

const audio = new Uint8Array([0x49, 0x44, 0x33, 1, 2]);
const options = { endpoint: new URL('https://music.fixture.invalid/v1/music'), apiKey: 'synthetic-fixture',
  model: 'music_v1', idempotencyKey: 'music-fixture-request', prompt: 'Warm acoustic folk', format: 'mp3' as const };
const chunk = `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: Buffer.from(audio).toString('base64') } } }] })}\n\n`;

for (const [name, tail, success] of [
  ['early EOF', '', false], ['DONE', 'data: [DONE]\n\n', true],
  ['normal finish', 'data: {"choices":[{"finish_reason":"stop"}]}\n\n', true],
  ['length finish', 'data: {"choices":[{"finish_reason":"length"}]}\n\ndata: [DONE]\n\n', false],
  ['choice error', 'data: {"choices":[{"error":{"code":"upstream_failed"}}]}\n\ndata: [DONE]\n\n', false],
  ['malformed tail', 'data: {truncated\n\ndata: [DONE]\n\n', false],
  ['unterminated finish event', 'data: {"choices":[{"finish_reason":"stop"}]}', false],
  ['unterminated DONE event', 'data: [DONE]', false],
] as const) {
  test(`A-014 music SSE ${name} requires a successful completion before publishing`, async () => {
    let submissions = 0;
    const run = requestChatAudioMusic({ ...options, fetchImpl: async () => {
      submissions++; return new Response(chunk + tail, { headers: { 'content-type': 'text/event-stream' } });
    } });
    if (success) assert.deepEqual((await run).bytes, audio);
    else await assert.rejects(run, (error: any) => error.retryable === false && /AUDIO_RESULT_INCOMPLETE|REQUEST_REJECTED/.test(error.code));
    assert.equal(submissions, 1, 'incomplete paid output is never automatically regenerated');
  });
}

for (const model of ['music_v1', 'music_v2', 'music_v2_5']) {
  test(`A-015 ${model} sends authored lyrics as model-specific composition sections`, async () => {
    let body: any;
    await requestElevenLabsMusic({ ...options, model, lyrics: '[Verse]\nFirst line\nSecond line\n[Chorus]\nSing again', durationSeconds: 30,
      fetchImpl: async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response(audio); } });
    assert.equal(body.prompt, undefined); assert.equal(body.lyrics, undefined);
    assert.equal(body.music_length_ms, undefined); assert.equal(body.force_instrumental, undefined);
    if (model === 'music_v1') {
      assert.deepEqual(body.composition_plan.sections.map((s: any) => [s.section_name, s.lines, s.duration_ms]),
        [['Verse', ['First line', 'Second line'], 15000], ['Chorus', ['Sing again'], 15000]]);
    } else {
      assert.deepEqual(body.composition_plan.chunks.map((s: any) => [s.text, s.duration_ms]),
        [['[Verse]\nFirst line\nSecond line', 15000], ['[Chorus]\nSing again', 15000]]);
    }
  });
}

test('A-015 instrumental prompt mode sends force_instrumental and rejects unsupported combinations before POST', async () => {
  let submissions = 0, body: any;
  const fetchImpl: typeof fetch = async (_url, init) => { submissions++; body = JSON.parse(String(init?.body)); return new Response(audio); };
  await requestElevenLabsMusic({ ...options, instrumental: true, durationSeconds: 30, fetchImpl });
  assert.equal(body.force_instrumental, true); assert.equal(body.music_length_ms, 30000);
  assert.equal(body.composition_plan, undefined);
  for (const patch of [{ lyrics: 'Do not discard me', instrumental: true }, { model: 'unknown-music' },
    { modelId: 'music_v2' as const }, { lyrics: '[A]\nOne\n[B]\nTwo', durationSeconds: 3 }, { lyrics: 'x'.repeat(201) }]) {
    await assert.rejects(requestElevenLabsMusic({ ...options, ...patch, fetchImpl }));
  }
  assert.equal(submissions, 1);
});
