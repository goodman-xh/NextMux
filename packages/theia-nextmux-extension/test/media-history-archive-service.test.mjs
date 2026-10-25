import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

class Fixture extends NextMuxPlatformServiceImpl {
    constructor(root) { super(); this.root = root; }
    nextmuxDataRoot() { return this.root; }
}

const image = key => ({
    idempotencyKey: key, kind: 'image',
    projectId: 'project-00000001', sceneId: 'scene-00000001', shotId: 'shot-00000001',
    input: { connectionId: 'official-00000000-0000-4000-8000-000000000001',
        model: 'offline-image', prompt: 'offline service archive', width: 1024, height: 1024 },
    cost: { billing: 'provider_billed', description: 'fixture; no provider call' }
});

test('service archive binds terminal media history to its workspace without activating paid work', async t => {
    const base = await mkdtemp(join(tmpdir(), 'nextmux-media-history-service-'));
    t.after(() => rm(base, { recursive: true, force: true }));
    const workspace = join(base, 'workspace');
    const otherWorkspace = join(base, 'other-workspace');
    const backups = join(base, 'backups');
    await Promise.all([mkdir(workspace), mkdir(otherWorkspace), mkdir(backups)]);
    const source = new Fixture(join(base, 'source-profile'));
    const sourceStore = await source.mediaJobStore(workspace);
    const cancelled = await sourceStore.enqueue(image('service-history-cancelled'));
    await sourceStore.cancel(cancelled.id);
    const failed = await sourceStore.enqueue(image('service-history-failed'));
    await sourceStore.confirm(failed.id);
    assert.equal((await sourceStore.claimNext('media-worker-service01')).id, failed.id);
    await sourceStore.fail(failed.id, 'media-worker-service01',
        { code: 'TEMPORARY', message: 'offline failure', retryable: true });
    const succeeded = await sourceStore.enqueue(image('service-history-succeeded'));
    await sourceStore.confirm(succeeded.id);
    assert.equal((await sourceStore.claimNext('media-worker-service01')).id, succeeded.id);
    await sourceStore.saveCheckpoint(succeeded.id, 'media-worker-service01', {
        assetId: 'asset-00000001', assetKind: 'image', relativeUri: 'nextmux.media/offline.png',
        mimeType: 'image/png', byteLength: 1, sha256: 'b'.repeat(64), provider: 'offline', model: 'offline-image'
    });
    await sourceStore.complete(succeeded.id, 'media-worker-service01');
    const sourceIds = [cancelled.id, failed.id, succeeded.id];

    const exported = await source.exportMediaJobHistoryArchive(workspace, pathToFileURL(backups).href);
    assert.equal(exported.jobs, 3);
    assert.match(exported.fileUri, /\.nmxmedia$/);
    const archive = JSON.parse(await readFile(new URL(exported.fileUri), 'utf8'));
    assert.equal(archive.manifest.assetsIncluded, false);
    for (const key of [cancelled.idempotencyKey, failed.idempotencyKey, succeeded.idempotencyKey]) {
        assert.equal(JSON.stringify(archive).includes(key), false);
    }

    const target = new Fixture(join(base, 'target-profile'));
    await assert.rejects(target.importMediaJobHistoryArchive(otherWorkspace, exported.fileUri),
        error => error.code === 'MEDIA_HISTORY_WORKSPACE_MISMATCH');
    const targetStore = await target.mediaJobStore(workspace);
    const pending = await targetStore.enqueue(image('service-existing-pending'));
    await assert.rejects(target.importMediaJobHistoryArchive(workspace, exported.fileUri),
        error => error.code === 'MEDIA_HISTORY_NOT_EMPTY');
    assert.equal((await targetStore.get(pending.id)).status, 'awaiting_confirmation');
    await targetStore.cancel(pending.id);
    await target.clearDesktopLocalData({ workspaceRoot: workspace, categories: ['media_jobs'] });

    const imported = await target.importMediaJobHistoryArchive(workspace, exported.fileUri);
    assert.equal(imported.jobs, 3);
    const restored = await (await target.mediaJobStore(workspace)).get(cancelled.id);
    assert.equal(restored.restoredHistoryOnly, true);
    assert.notEqual(restored.idempotencyKey, cancelled.idempotencyKey);
    assert.match(restored.archivedIdempotencyDigest, /^[a-f0-9]{64}$/);
    assert.equal(await (await target.mediaJobStore(workspace)).claimNext('media-worker-00000001'), undefined);
    for (const id of sourceIds) {
        await assert.rejects(target.retryMediaJob(workspace, id),
            error => error.code === 'JOB_HISTORY_ONLY');
        await assert.rejects(target.regenerateMediaJob(workspace, id),
            error => error.code === 'JOB_HISTORY_ONLY');
    }
    const reopened = new Fixture(join(base, 'target-profile'));
    for (const id of sourceIds) {
        assert.equal((await (await reopened.mediaJobStore(workspace)).get(id)).restoredHistoryOnly, true);
        await assert.rejects(reopened.retryMediaJob(workspace, id),
            error => error.code === 'JOB_HISTORY_ONLY');
        await assert.rejects(reopened.regenerateMediaJob(workspace, id),
            error => error.code === 'JOB_HISTORY_ONLY');
    }
});
