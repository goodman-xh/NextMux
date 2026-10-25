import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { enqueueRequest, MediaJobStore, planMediaExecution, type EnqueueMediaJobRequest, type MediaProviderAdapter } from '../lib/index.js';

const voice = { assetUri: 'nextmux.media/voice.wav', durationSeconds: 15, consent: true };
const request = (patch = {}): EnqueueMediaJobRequest => ({
  idempotencyKey: 'music-reference-0001', kind: 'music', projectId: 'project-00000001', sceneId: 'scene-00000001', shotId: 'shot-00000001',
  input: { connectionId: 'official-00000000-0000-4000-8000-000000000001', model: 'user-template', prompt: 'A gentle song', durationSeconds: 30,
    format: 'mp3', mode: 'generate', vocalReference: voice, ...patch },
  cost: { billing: 'provider_billed', description: 'Mock provider' }
});

test('voice reference persists explicit consent and requires a 15 second WAV/MP3 asset', () => {
  assert.deepEqual(enqueueRequest(request()).input, request().input);
  for (const [patch, code] of [
    [{ ...voice, consent: false }, 'VOICE_CONSENT_REQUIRED'],
    [{ ...voice, consent: undefined }, 'VOICE_CONSENT_REQUIRED'],
    [{ ...voice, durationSeconds: 14.99 }, 'MUSIC_REFERENCE_TOO_SHORT'],
    [{ ...voice, durationSeconds: NaN }, 'INVALID_MEDIA_REQUEST'],
    [{ ...voice, assetUri: 'nextmux.media/voice.ogg' }, 'INVALID_MUSIC_REFERENCE'],
    [{ ...voice, assetUri: '../voice.wav' }, 'INVALID_MEDIA_PATH']
  ] as const) assert.throws(() => enqueueRequest(request({ vocalReference: patch })), error => (error as any).code === code);
  assert.throws(() => enqueueRequest(request({ instrumental: true })), error => (error as any).code === 'INVALID_MUSIC_MODE');
});

test('cover has a distinct reference-song request and refuses mismatched modes', () => {
  const input = { vocalReference: undefined, mode: 'cover', referenceSong: { assetUri: 'nextmux.media/song.mp3', durationSeconds: 180 } };
  const { vocalReference: _unused, ...expected } = request(input).input as any;
  assert.deepEqual(enqueueRequest(request(input)).input, expected);
  for (const patch of [{ mode: 'cover' }, { ...input, vocalReference: voice }, { ...input, mode: 'generate' }, { ...input, instrumental: true }]) {
    assert.throws(() => enqueueRequest(request(patch)), error => (error as any).code === 'INVALID_MUSIC_MODE');
  }
});

test('unknown voice/cover capabilities block and never fall back to ordinary generation', () => {
  const adapter = (capability?: 'cover' | 'vocal_reference', status = 'supported'): MediaProviderAdapter => ({ id: 'mock', profile: {
    providerId: 'mock', modelId: 'user-template', protocol: 'template', updatedAt: new Date().toISOString(), capabilities: [
      { capability: 'music_generation', status: 'supported', source: 'merchant_declaration' },
      ...(capability ? [{ capability, status, source: 'provider_metadata' }] : []) as any
    ] }
  });
  assert.equal(planMediaExecution(request(), [adapter()]).status, 'blocked');
  assert.equal(planMediaExecution(request(), [adapter('vocal_reference', 'unknown')]).status, 'blocked');
  assert.equal(planMediaExecution(request(), [adapter('vocal_reference')]).status, 'direct');
  const cover = request({ vocalReference: undefined, mode: 'cover', referenceSong: { assetUri: 'nextmux.media/song.mp3', durationSeconds: 90 } });
  assert.equal(planMediaExecution(cover, [adapter('vocal_reference')]).status, 'blocked');
  assert.equal(planMediaExecution(cover, [adapter('cover')]).status, 'direct');
});

test('provider upload IDs survive store reload and retries and can be replaced after expiry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'music-reference-store-'));
  try {
    let store = await MediaJobStore.create({ root });
    const queued = await store.enqueue(request()); await store.confirm(queued.id);
    const job = await store.claimNext('media-worker-00000001'); assert.ok(job);
    const scope = 'a'.repeat(64);
    await store.saveReferenceUpload(job.id, 'media-worker-00000001', { scope, id: 'voice-123', expiresAt: Date.now() + 100000 });
    await store.fail(job.id, 'media-worker-00000001', { code: 'RATE_LIMITED', message: 'retry mock', retryable: true });
    store = await MediaJobStore.create({ root });
    const retried = await store.retry(job.id);
    assert.equal(retried.referenceUploads?.[0].id, 'voice-123');
    assert.deepEqual(retried.input, queued.input);
    await store.claimNext('media-worker-00000001');
    const updated = await store.saveReferenceUpload(job.id, 'media-worker-00000001', { scope, id: 'voice-replacement', expiresAt: Date.now() + 200000 });
    assert.equal(updated.referenceUploads?.length, 1);
    assert.equal((await (await MediaJobStore.create({ root })).get(job.id)).referenceUploads?.[0].id, 'voice-replacement');
  } finally { await rm(root, { recursive: true, force: true }); }
});
