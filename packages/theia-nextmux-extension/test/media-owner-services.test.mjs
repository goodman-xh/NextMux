import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const output = { assetId: 'asset-00000001', assetKind: 'video', relativeUri: 'nextmux.media/fixture.mp4', mimeType: 'video/mp4',
    byteLength: 24, sha256: 'a'.repeat(64), provider: 'fixture', model: 'fixture' };
const request = { idempotencyKey: 'service-owner-fixture', kind: 'video', projectId: 'project-00000001', sceneId: 'scene-00000001', shotId: 'shot-00000001',
    input: { connectionId: 'official-00000000-0000-4000-8000-000000000001', model: 'fixture', prompt: 'Fixture', durationSeconds: 5, width: 1280, height: 720 },
    cost: { billing: 'provider_billed', description: 'fixture' } };
async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-service-owners-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    class Service extends NextMuxPlatformServiceImpl {
        nextmuxDataRoot() { return root; }
        async validateMediaJobAgainstProject() {}
        async setMediaShotStatus() {}
        async attachMediaCheckpoint() {}
        async getMediaRuntimeState() { return {}; }
    }
    const a = new Service(), b = new Service();
    const store = await a.mediaJobStore(root);
    const job = await store.enqueue(request);
    await store.confirm(job.id);
    t.after(async () => { await a.disposeConnectionResources(); await b.disposeConnectionResources(); });
    return { root, a, b, store, job };
}

test('A-006 two live services share one queue: B recovery and B close do not reset A; A completes once', async t => {
    const f = await fixture(t), accepted = deferred(), done = deferred();
    let executions = 0;
    f.a.executeMediaJob = async (_root, job) => {
        executions++;
        await f.store.saveRemoteTask(job.id, f.a.mediaWorkerId, { taskId: 'accepted-task', submittedAt: new Date().toISOString() });
        accepted.resolve(); await done.promise; return output;
    };
    const run = f.a.runMediaLane(f.root, f.store);
    try {
        await accepted.promise;
        await f.b.getMediaWorkspaceState(f.root);
        assert.equal((await f.store.get(f.job.id)).workerId, f.a.mediaWorkerId);
        await f.b.disposeConnectionResources();
        assert.equal((await f.store.get(f.job.id)).status, 'running');
        assert.equal(f.a.mediaOwnerHeartbeats.size, 1);
    } finally { done.resolve(); await run; }
    assert.equal((await f.store.get(f.job.id)).status, 'succeeded');
    assert.equal(executions, 1); assert.equal(f.a.mediaOwnerHeartbeats.size, 0);
});

test('A-006 service recovery rechecks a previously live owner after that backend process exits', async t => {
    const f = await fixture(t);
    await f.b.ensureMediaRecovery(f.root, f.store); // B has already opened this workspace
    const serviceModule = fileURLToPath(new URL('../lib/node/nextmux-platform-service.js', import.meta.url));
    await promisify(execFile)(process.execPath, ['-e', `
      const { NextMuxPlatformServiceImpl } = require(process.argv[1]);
      const root = process.argv[2];
      (async () => {
        const a = new NextMuxPlatformServiceImpl(); a.nextmuxDataRoot = () => root;
        const store = await a.mediaJobStore(root);
        const job = await store.claimNext(a.mediaWorkerId, { now: new Date(Date.now() - 60000).toISOString() });
        await store.saveRemoteTask(job.id, a.mediaWorkerId, { taskId: 'accepted-before-crash', submittedAt: new Date().toISOString() });
        process.exit(0);
      })().catch(error => { console.error(error); process.exit(1); });
    `, serviceModule, f.root]);
    await f.b.ensureMediaRecovery(f.root, f.store);
    assert.equal((await f.store.get(f.job.id)).status, 'queued');
    f.b.executeMediaJob = async (_root, job) => { assert.equal(job.remoteTask.taskId, 'accepted-before-crash'); return output; };
    await f.b.runMediaLane(f.root, f.store);
    assert.equal((await f.store.get(f.job.id)).status, 'succeeded');
});

test('A-007 service regenerate creates a separate paid task awaiting confirmation', async t => {
    const f = await fixture(t);
    await f.store.claimNext(f.a.mediaWorkerId);
    await f.store.fail(f.job.id, f.a.mediaWorkerId, { code: 'MEDIA_OUTCOME_UNKNOWN', message: 'Review original request', retryable: false });
    const next = await f.b.regenerateMediaJob(f.root, f.job.id);
    assert.notEqual(next.id, f.job.id); assert.notEqual(next.idempotencyKey, f.job.idempotencyKey);
    assert.equal(next.status, 'awaiting_confirmation');
    assert.equal((await f.store.get(f.job.id)).status, 'failed');
});

test('A-006 a new lane waits for the old owner release before claiming another job', async t => {
    const f = await fixture(t), releasing = deferred(), finishRelease = deferred();
    const release = f.store.releaseWorker.bind(f.store);
    let first = true;
    f.store.releaseWorker = async worker => {
        if (first) { first = false; releasing.resolve(); await finishRelease.promise; }
        return release(worker);
    };
    f.a.executeMediaJob = async () => output;
    const previous = f.a.runMediaLane(f.root, f.store);
    await releasing.promise;
    const next = await f.store.enqueue({ ...request, idempotencyKey: 'next-service-owner-fixture' });
    await f.store.confirm(next.id);
    const lane = f.a.runMediaLane(f.root, f.store);
    try { assert.equal((await f.store.get(next.id)).status, 'queued'); }
    finally { finishRelease.resolve(); await Promise.all([previous, lane]); }
    assert.equal((await f.store.get(next.id)).status, 'succeeded');
});
