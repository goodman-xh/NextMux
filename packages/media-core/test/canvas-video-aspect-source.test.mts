import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { mediaInput, MediaJobStore, type MediaVideoJobInput } from '../lib/index.js';

const input = {
  connectionId: 'official-00000000-0000-4000-8000-000000000001', model: 'minimax/hailuo-3-max',
  prompt: 'The character walks through the doorway', generationMode: 'imageToVideo' as const,
  durationSeconds: 6, resolution: '768p', width: 768, height: 1366,
  referenceAssetUris: ['nextmux.media/first.png'], aspectRatioSource: 'firstFrame' as const,
};

test('a frozen input-derived ratio or omission survives queue normalization and restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-video-aspect-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await MediaJobStore.create({ root });
  for (const aspectRatio of ['9:16', undefined]) {
    const request = { kind: 'video' as const, idempotencyKey: `canvas-aspect-${aspectRatio ?? 'omitted'}`,
      projectId: 'project-00000001', sceneId: 'scene-00000001', shotId: 'shot-00000001',
      input: { ...input, ...(aspectRatio ? { aspectRatio } : {}) },
      cost: { billing: 'provider_billed' as const, description: 'Offline fixture' } };
    const first = await store.enqueue(request);
    const reopened = await MediaJobStore.create({ root });
    const saved = await reopened.get(first.id);
    const frozen = saved!.input as MediaVideoJobInput;
    assert.equal(frozen.aspectRatioSource, 'firstFrame');
    assert.equal(frozen.aspectRatio, aspectRatio);
    assert.equal(frozen.resolution, input.resolution);
    assert.deepEqual(frozen.referenceAssetUris, input.referenceAssetUris);
    assert.equal((await reopened.enqueue(request)).id, first.id);
  }
});

test('invalid aspect provenance cannot enter the durable queue', () => {
  assert.throws(() => mediaInput('video', { ...input, aspectRatioSource: 'lastFrame' }), { code: 'INVALID_MEDIA_REQUEST' });
});
