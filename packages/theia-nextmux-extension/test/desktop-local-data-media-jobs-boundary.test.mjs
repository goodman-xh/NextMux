import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MEDIA_QUEUE_FILE } from '@nextmux/media-core';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

class LocalDataService extends NextMuxPlatformServiceImpl {
  constructor(profile) { super(); this.profile = profile; }
  nextmuxDataRoot() { return this.profile; }
}

test('media cleanup sees a pending job older than the first 500 listed jobs', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-media-clear-boundary-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const workspaceRoot = join(sandbox, 'project');
  await mkdir(workspaceRoot);
  const service = new LocalDataService(join(sandbox, 'profile'));
  const store = await service.mediaJobStore(workspaceRoot);
  const pending = await store.enqueue({
    idempotencyKey: 'pending-oldest-501st', kind: 'image',
    projectId: 'project-00000001', sceneId: 'scene-00000001', shotId: 'shot-00000001',
    input: { connectionId: 'official-00000000-0000-4000-8000-000000000001',
      model: 'image-model', prompt: 'test', width: 1024, height: 1024 },
    cost: { billing: 'provider_billed', description: 'test quote; no provider call' },
  }, { now: '2026-01-01T00:00:00.000Z' });
  const completed = { ...pending, status: 'cancelled', createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z' };
  const state = await store.read();
  const jobs = [pending, ...Array.from({ length: 500 }, (_, index) => ({
    ...completed,
    id: `media-job-00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    idempotencyKey: `closed-newer-${index}`,
  }))];
  await writeFile(join(store.root, MEDIA_QUEUE_FILE), JSON.stringify({ ...state, jobs }));
  assert.equal((await store.read()).jobs.length, 501, 'the on-disk queue must be valid');
  assert.equal((await store.list(500)).some(job => job.id === pending.id), false,
    'the UI listing omits the pending job by design');
  const diagnostic = JSON.parse((await service.createDesktopDiagnosticReport(workspaceRoot)).content);
  assert.equal(Object.values(diagnostic.mediaJobs).reduce((total, count) => total + count, 0), 501,
    'diagnostic status totals must cover the whole persisted queue, not a display page');

  await assert.rejects(service.clearDesktopLocalData({ workspaceRoot, categories: ['media_jobs'] }),
    { code: 'LOCAL_DATA_BUSY' });
  const after = await store.read();
  assert.equal(after.jobs.length, 501, 'a refused cleanup must preserve the entire queue');
  assert.equal(after.jobs.find(job => job.id === pending.id)?.status, 'awaiting_confirmation');

  assert.equal((await store.cancel(pending.id)).status, 'cancelled');
  const cleared = await service.clearDesktopLocalData({ workspaceRoot, categories: ['media_jobs'] });
  assert.equal(cleared.entries.find(entry => entry.category === 'media_jobs')?.files, 0,
    'the same 501-record queue can be cleared once every job is terminal');
});
