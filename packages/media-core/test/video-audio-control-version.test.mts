import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { mediaInput, MediaJobStore, type MediaVideoJobInput } from '../lib/index.js';

const input = {
  connectionId: 'official-00000000-0000-4000-8000-000000000001', model: 'bytedance/seedance-2.5',
  prompt: 'The character walks through the doorway', generationMode: 'textToVideo' as const,
  durationSeconds: 5, resolution: '720p', aspectRatio: '16:9', width: 1280, height: 720,
};

for (const requestAudio of [false, true]) test(`explicit versioned audio=${requestAudio} survives queue storage, restart and duplicate enqueue`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'video-audio-control-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const request = { kind: 'video' as const, idempotencyKey: `versioned-audio-${requestAudio}`,
    projectId: 'project-00000001', sceneId: 'scene-00000001', shotId: 'shot-00000001',
    input: { ...input, requestAudio, audioControlVersion: 1 as const },
    cost: { billing: 'provider_billed' as const, description: 'Offline fixture' } };
  const store = await MediaJobStore.create({ root }), first = await store.enqueue(request);
  const reopened = await MediaJobStore.create({ root }), saved = await reopened.get(first.id);
  const frozen = saved!.input as MediaVideoJobInput;
  assert.equal(frozen.requestAudio, requestAudio);
  assert.equal(frozen.audioControlVersion, 1);
  assert.equal((await reopened.enqueue(request)).id, first.id);
  assert.equal((await reopened.list()).length, 1);
});

test('legacy audio choice or omission does not gain a control version during normalization', () => {
  for (const requestAudio of [undefined, false, true]) {
    const original = { ...input, ...(requestAudio === undefined ? {} : { requestAudio }) };
    const normalized = mediaInput('video', original) as MediaVideoJobInput;
    assert.equal(Object.hasOwn(normalized, 'audioControlVersion'), false);
    assert.equal(Object.hasOwn(normalized, 'requestAudio'), requestAudio !== undefined);
    assert.equal(normalized.requestAudio, requestAudio);
  }
});

test('invalid version or a versioned request without an explicit boolean cannot enter the durable queue', () => {
  for (const patch of [
    { audioControlVersion: 0, requestAudio: false }, { audioControlVersion: 2, requestAudio: true },
    { audioControlVersion: '1', requestAudio: false }, { audioControlVersion: null, requestAudio: false },
    { audioControlVersion: 1 }, { audioControlVersion: 1, requestAudio: 'false' },
  ]) assert.throws(() => mediaInput('video', { ...input, ...patch }), { code: 'INVALID_MEDIA_REQUEST' });
});
