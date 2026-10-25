import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MediaJobStore } from '../lib/index.js';

// Audit 36-11: attaching a saved result must not need a spare generation attempt.
test('a checkpointed final attempt remains claimable after the worker exits', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-audit-checkpoint-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await MediaJobStore.create({ root });
  const at = '2026-09-28T00:00:00.000Z';
  const workerA = 'media-worker-audit-original';
  const workerB = 'media-worker-audit-restarted';
  const job = await store.enqueue({
    idempotencyKey: 'audit-final-attempt-checkpoint',
    kind: 'image',
    projectId: 'project-00000001',
    sceneId: 'scene-00000001',
    shotId: 'shot-00000001',
    input: { connectionId: 'official-00000000-0000-4000-8000-000000000001', model: 'image-model', prompt: 'shoreline', width: 1024, height: 1024 },
    cost: { billing: 'provider_billed', description: 'Provider request' },
    maxAttempts: 1,
  }, { now: at });
  await store.confirm(job.id, { now: at });
  assert.equal((await store.claimNext(workerA, { now: at }))?.attempt, 1);
  const output = {
    assetId: 'asset-00000001', assetKind: 'image' as const, relativeUri: 'nextmux.media/output.png',
    mimeType: 'image/png', byteLength: 128, sha256: 'a'.repeat(64), provider: 'test', model: 'image-model',
  };
  await store.saveCheckpoint(job.id, workerA, output, { now: at });
  await store.releaseWorker(workerA, { now: at });

  const restarted = await MediaJobStore.create({ root });
  const [recovered] = await restarted.recoverInterrupted({ now: at });
  assert.equal(recovered.status, 'queued');
  assert.deepEqual(recovered.checkpoint, output);
  const resumed = await restarted.claimNext(workerB, { now: at });
  assert.equal(resumed?.id, job.id, 'the saved output must be attachable without a new provider request');
});
