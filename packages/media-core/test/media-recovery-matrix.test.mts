import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test, { type TestContext } from 'node:test';
import { MediaJobStore, MEDIA_QUEUE_FILE, type EnqueueMediaJobRequest, type MediaJobKind, type MediaJobCheckpoint } from '../lib/index.js';

const now = '2026-09-28T00:00:00.000Z';
const later = '2026-09-28T00:05:00.000Z';
const workerA = 'media-worker-recovery-a';
const workerB = 'media-worker-recovery-b';
const connectionId = 'official-00000000-0000-4000-8000-000000000001';
const remoteTask = { taskId: 'original-accepted-task', pollUrl: 'https://media.example.test/poll/original', resultUrl: 'https://media.example.test/result/original', submittedAt: now };
const kinds: MediaJobKind[] = ['image', 'video', 'speech', 'music', 'sound_effect', 'subtitle', 'shot_preview'];

function request(kind: MediaJobKind, billing: 'free' | 'provider_billed' | 'platform_billed' = 'provider_billed'): EnqueueMediaJobRequest {
  const common = { connectionId, model: 'test-model', prompt: 'A calm shoreline' };
  const inputs: Record<MediaJobKind, EnqueueMediaJobRequest['input']> = {
    image: { ...common, width: 1024, height: 1024 },
    video: { ...common, durationSeconds: 5, width: 1024, height: 1024 },
    speech: { connectionId, model: 'test-model', text: 'Hello', voice: 'alloy', format: 'mp3' },
    music: { ...common, durationSeconds: 30, format: 'mp3' },
    sound_effect: { ...common, durationSeconds: 5, format: 'mp3' },
    subtitle: { frameRate: 24, cues: [{ text: 'Hello', startFrame: 0, durationFrames: 24 }] },
    shot_preview: { frameRate: 24, durationFrames: 24, width: 1024, height: 1024, visualAssetUri: 'nextmux.media/source.png' },
  };
  return { kind, idempotencyKey: `recovery-${kind}-${billing}`, projectId: 'project-00000001', sceneId: 'scene-00000001', shotId: 'shot-00000001', input: inputs[kind], cost: { billing, description: 'Test billing' } };
}

function output(): MediaJobCheckpoint {
  return { assetId: 'asset-00000001', assetKind: 'image', relativeUri: 'nextmux.media/output.png', mimeType: 'image/png', byteLength: 128, sha256: 'a'.repeat(64), provider: 'test', model: 'test-model' };
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-media-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: await MediaJobStore.create({ root }) };
}

async function start(store: MediaJobStore, value = request('image')) {
  const job = await store.enqueue(value, { now });
  if (job.status === 'awaiting_confirmation') await store.confirm(job.id, { now });
  assert.equal((await store.claimNext(workerA, { now }))?.id, job.id);
  return job;
}

test('A-006: another queue connection preserves live ownership through polling, heartbeat expiry, and completion', async t => {
  const { root, store: a } = await fixture(t);
  const b = await MediaJobStore.create({ root });
  const job = await start(a);
  await a.saveRemoteTask(job.id, workerA, remoteTask, { now });
  assert.deepEqual(await b.recoverInterrupted({ now }), []);
  assert.equal(await b.releaseWorker(workerB, { now }), 0, 'closing B never releases A');
  assert.equal(await a.heartbeatWorker(workerA, { now: '2026-09-28T00:00:20.000Z' }), 1);
  const lease = (await b.get(job.id)).ownerLease;
  assert.equal(lease?.heartbeatAt, '2026-09-28T00:00:20.000Z');
  assert.equal(lease?.expiresAt, '2026-09-28T00:00:50.000Z');
  assert.deepEqual(await b.recoverInterrupted({ now: later }), [], 'an expired heartbeat cannot kill a still-live owner');
  assert.equal(await b.claimNext(workerB, { now: later }), undefined);
  await a.saveCheckpoint(job.id, workerA, output(), { now: later });
  assert.equal((await a.complete(job.id, workerA, { now: later })).status, 'succeeded');
  assert.equal((await b.get(job.id)).output?.relativeUri, output().relativeUri);
});

test('A-006: an explicitly stopped owner is recovered once and cannot write after release', async t => {
  const { root, store: a } = await fixture(t);
  const b = await MediaJobStore.create({ root });
  const job = await start(a);
  await a.saveRemoteTask(job.id, workerA, remoteTask, { now });
  assert.equal(await a.releaseWorker(workerA, { now }), 1);
  await assert.rejects(a.saveCheckpoint(job.id, workerA, output(), { now }), { code: 'JOB_NOT_OWNED' });
  assert.equal(await a.heartbeatWorker(workerA, { now }), 0, 'heartbeat cannot revive a released owner');
  const results = await Promise.all([a.recoverInterrupted({ now }), b.recoverInterrupted({ now })]);
  assert.equal(results.flat().length, 1);
  const resumed = await b.claimNext(workerB, { now });
  assert.equal(resumed?.id, job.id);
  assert.equal(resumed?.attempt, 1);
  assert.deepEqual(resumed?.remoteTask, remoteTask);
});

test('A-006: an expired lease is reclaimed after the owning backend process really exits', async t => {
  const { root, store } = await fixture(t);
  const queued = await store.enqueue(request('image'), { now });
  await store.confirm(queued.id, { now });
  const library = fileURLToPath(new URL('../lib/index.js', import.meta.url));
  await promisify(execFile)(process.execPath, ['-e', `
    const { MediaJobStore } = require(process.argv[1]);
    (async () => {
      const store = await MediaJobStore.create({ root: process.argv[2] });
      const job = await store.claimNext(process.argv[3], { now: process.argv[4] });
      await store.saveRemoteTask(job.id, process.argv[3], JSON.parse(process.argv[5]), { now: process.argv[4] });
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `, library, root, workerA, now, JSON.stringify(remoteTask)]);
  assert.notEqual((await store.get(queued.id)).ownerLease?.processId, process.pid);
  const recovered = await store.recoverInterrupted({ now: later });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].status, 'queued');
  assert.deepEqual(recovered[0].remoteTask, remoteTask);
});

test('A-006: legacy running jobs without evidence of a dead owner are preserved', async t => {
  const { root, store } = await fixture(t);
  const job = await start(store);
  const pathname = join(root, MEDIA_QUEUE_FILE);
  const state = JSON.parse(await readFile(pathname, 'utf8'));
  delete state.jobs[0].ownerLease;
  await writeFile(pathname, JSON.stringify(state));
  assert.deepEqual(await store.recoverInterrupted({ now: later }), []);
  assert.equal((await store.get(job.id)).workerId, workerA);
});

for (const kind of kinds) {
  for (const billing of ['provider_billed', 'platform_billed'] as const) {
    test(`A-007: ${kind}/${billing} recovery matrix protects unknown outcomes, cancellation, and accepted tasks`, async t => {
      for (const phase of ['unknown', 'cancelled', 'remote', 'checkpoint'] as const) {
        await t.test(phase, async subtest => {
          const { store } = await fixture(subtest);
          const job = await start(store, request(kind, billing));
          if (phase === 'remote') await store.saveRemoteTask(job.id, workerA, remoteTask, { now });
          if (phase === 'checkpoint') await store.saveCheckpoint(job.id, workerA, output(), { now });
          if (phase === 'cancelled') await store.cancel(job.id, { now });
          await store.releaseWorker(workerA, { now });
          const [recovered] = await store.recoverInterrupted({ now });
          if (phase === 'remote' || phase === 'checkpoint') {
            assert.equal(recovered.status, 'queued');
            assert.equal(recovered.failure, undefined);
            const resumed = await store.claimNext(workerB, { now });
            assert.equal(resumed?.id, job.id);
            assert.equal(resumed?.idempotencyKey, job.idempotencyKey);
            if (phase === 'remote') assert.deepEqual(resumed?.remoteTask, remoteTask);
            else assert.deepEqual(resumed?.checkpoint, output());
          } else {
            assert.equal(recovered.status, phase === 'cancelled' ? 'cancelled' : 'interrupted');
            assert.equal(recovered.failure?.code, billing === 'platform_billed' ? 'BILLING_TRANSPORT_UNKNOWN' : 'MEDIA_OUTCOME_UNKNOWN');
            assert.equal(recovered.failure?.retryable, false);
            assert.equal(await store.claimNext(workerB, { now }), undefined);
            await assert.rejects(store.retry(job.id, { now }), { code: 'JOB_NOT_RETRYABLE' });
            const regenerated = await store.regenerate(job.id, { now });
            assert.equal(regenerated.status, 'awaiting_confirmation');
            assert.notEqual(regenerated.id, job.id);
            assert.notEqual(regenerated.idempotencyKey, job.idempotencyKey);
            assert.equal(regenerated.remoteTask, undefined);
            assert.equal(await store.claimNext(workerB, { now }), undefined, 'regenerate cannot bypass a new confirmation');
          }
        });
      }
    });
  }
  test(`A-007: ${kind} polling and download retries retain the accepted task; regenerate needs fresh confirmation`, async t => {
    const { root, store } = await fixture(t);
    const job = await start(store, request(kind));
    await store.saveRemoteTask(job.id, workerA, remoteTask, { now });
    for (const code of ['RATE_LIMITED', 'DOWNLOAD_FAILED']) {
      await store.fail(job.id, workerA, { code, message: 'Temporary network failure', retryable: true }, { now });
      const reopened = await MediaJobStore.create({ root });
      const retried = await reopened.retry(job.id, { now });
      assert.deepEqual(retried.remoteTask, remoteTask);
      assert.equal(retried.idempotencyKey, job.idempotencyKey);
      assert.equal(retried.events.at(-1)?.note, 'resume_remote_task');
      assert.deepEqual((await store.claimNext(workerA, { now }))?.remoteTask, remoteTask);
    }
    await store.fail(job.id, workerA, { code: 'PROVIDER_REJECTED', message: 'Terminal provider failure', retryable: false }, { now });
    await assert.rejects(store.retry(job.id, { now }), { code: 'JOB_NOT_RETRYABLE' });
    const replacement = await store.regenerate(job.id, { now });
    assert.equal(replacement.status, 'awaiting_confirmation');
    assert.equal(replacement.attempt, 0);
    assert.equal(replacement.remoteTask, undefined);
    assert.notEqual(replacement.idempotencyKey, job.idempotencyKey);
    assert.equal(await store.claimNext(workerB, { now }), undefined);
    await store.confirm(replacement.id, { now });
    assert.equal((await store.claimNext(workerB, { now }))?.id, replacement.id);
    assert.deepEqual((await store.get(job.id)).remoteTask, remoteTask, 'original evidence remains reviewable');
  });
}

test('A-007: free interrupted work remains manually retryable and running work cannot be regenerated', async t => {
  const { store } = await fixture(t);
  const job = await start(store, request('music', 'free'));
  await assert.rejects(store.regenerate(job.id, { now }), { code: 'JOB_NOT_REGENERATABLE' });
  await store.releaseWorker(workerA, { now });
  const [recovered] = await store.recoverInterrupted({ now });
  assert.equal(recovered.failure?.code, 'WORKER_INTERRUPTED');
  assert.equal(recovered.failure?.retryable, true);
  assert.equal((await store.retry(job.id, { now })).status, 'queued');
});

test('A-008: managed video interrupted before create response resumes with the same platform idempotency key', async t => {
  const { store } = await fixture(t);
  const value = request('video', 'platform_billed');
  const job = await start(store, { ...value, input: { ...value.input, connectionId: 'managed:auto:00000000-0000-4000-8000-000000000001' } });
  await store.releaseWorker(workerA, { now });
  const [recovered] = await store.recoverInterrupted({ now });
  assert.equal(recovered.status, 'queued');
  assert.equal(recovered.events.at(-1)?.note, 'resume_idempotent_submission');
  const resumed = await store.claimNext(workerB, { now });
  assert.equal(resumed?.attempt, 1);
  assert.equal(resumed?.idempotencyKey, job.idempotencyKey);
  assert.equal(resumed?.remoteTask, undefined);
});
