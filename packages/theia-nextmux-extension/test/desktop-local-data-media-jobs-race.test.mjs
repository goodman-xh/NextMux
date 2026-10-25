import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

class MediaService extends NextMuxPlatformServiceImpl {
  constructor(profile) { super(); this.profile = profile; }
  nextmuxDataRoot() { return this.profile; }
  scheduleMediaWorker() { /* A paid, unconfirmed request must make no provider call. */ }
}

class PausedMediaClearService extends MediaService {
  constructor(profile) {
    super(profile);
    this.clearEntered = new Promise(resolve => { this.signalClearEntered = resolve; });
    this.clearReleased = new Promise(resolve => { this.releaseClear = resolve; });
  }
  async removeLocalDataTree(target) {
    this.signalClearEntered(target);
    await this.clearReleased;
    return super.removeLocalDataTree(target);
  }
}

class PausedMediaRootsService extends MediaService {
  constructor(profile) {
    super(profile);
    this.rootsEntered = new Promise(resolve => { this.signalRootsEntered = resolve; });
    this.rootsReleased = new Promise(resolve => { this.releaseRoots = resolve; });
  }
  async desktopLocalDataRoots(workspaceRoot) {
    const roots = await super.desktopLocalDataRoots(workspaceRoot);
    this.signalRootsEntered();
    await this.rootsReleased;
    return roots;
  }
}

test('selective media cleanup refuses a prior-version queue lock', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-media-clear-legacy-lock-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const workspaceRoot = join(sandbox, 'workspace');
  await mkdir(workspaceRoot);
  const service = new MediaService(join(sandbox, 'profile'));
  const store = await service.mediaJobStore(workspaceRoot);
  await mkdir(join(store.root, 'media-jobs.lock'));
  await assert.rejects(service.clearDesktopLocalData({ workspaceRoot, categories: ['media_jobs'] }),
    { code: 'LOCAL_DATA_BUSY' });
});

test('a second backend connection cannot lose a paid job enqueued after media clear checks the queue', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-media-clear-race-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const workspaceRoot = join(sandbox, 'workspace');
  const profile = join(sandbox, 'profile');
  await mkdir(workspaceRoot);
  const clearing = new PausedMediaClearService(profile);
  const producer = new MediaService(profile);
  const { project } = await producer.createComicProject({ workspaceRoot, title: 'Queue clear race',
    starter: 'storyboard', frameRate: 24,
    canvas: { aspectRatio: '16:9', width: 1920, height: 1080 } });
  const scene = project.scenes[0];
  const shot = scene.shots[0];
  const request = idempotencyKey => ({ workspaceRoot, job: {
    idempotencyKey, kind: 'image', projectId: project.id, sceneId: scene.id, shotId: shot.id,
    input: { connectionId: 'managed:fixed:00000000-0000-4000-8000-000000000002',
      model: 'race-fixture', prompt: 'offline paid-authorization fixture', width: 1920, height: 1080 },
    cost: { billing: 'platform_billed', description: 'offline test, never confirmed' },
  } });

  const oldJob = await producer.enqueueMediaJob(request('clear-race-terminal-old'));
  assert.equal(oldJob.status, 'awaiting_confirmation');
  assert.equal((await producer.cancelMediaJob(workspaceRoot, oldJob.id)).status, 'cancelled');

  const clear = clearing.clearDesktopLocalData({ workspaceRoot, categories: ['media_jobs'] });
  await clearing.clearEntered; // The entire queue was checked and deemed safe; deletion is paused.
  const enqueue = producer.enqueueMediaJob(request('clear-race-new-pending'));
  let acceptedBeforeDelete;
  let timeout;
  try {
    // A correct shared lock may hold the new enqueue until clearing ends. The
    // timeout makes both serial orders testable without deadlocking that fix.
    acceptedBeforeDelete = await Promise.race([
      enqueue.then(() => true),
      new Promise(resolve => { timeout = setTimeout(() => resolve(false), 2_000); }),
    ]);
  } finally {
    clearTimeout(timeout);
    clearing.releaseClear();
  }

  const [newJob, outcome] = await Promise.all([
    enqueue,
    clear.then(() => 'cleared', error => error.code),
  ]);
  assert.equal(newJob.status, 'awaiting_confirmation');
  const surviving = (await (await producer.mediaJobStore(workspaceRoot)).read()).jobs
    .some(job => job.id === newJob.id);
  assert.equal(surviving, true,
    `media clear ${outcome} after another connection accepted a new unconfirmed job${acceptedBeforeDelete ? ' before deletion' : ' after deletion'}, losing that job`);
  if (acceptedBeforeDelete) {
    assert.equal(outcome, 'LOCAL_DATA_BUSY', 'clear must refuse if another connection committed the new job first');
  }

  // Exercise the other serial order: the new job commits after the early
  // preflight but before clearing acquires the queue lock for its final check.
  assert.equal((await producer.cancelMediaJob(workspaceRoot, newJob.id)).status, 'cancelled');
  const lateClearer = new PausedMediaRootsService(profile);
  const lateClear = lateClearer.clearDesktopLocalData({ workspaceRoot, categories: ['media_jobs'] });
  await lateClearer.rootsEntered;
  let ahead;
  try {
    ahead = await producer.enqueueMediaJob(request('clear-race-before-final-check'));
    assert.equal(ahead.status, 'awaiting_confirmation');
  } finally {
    lateClearer.releaseRoots();
  }
  await assert.rejects(lateClear, { code: 'LOCAL_DATA_BUSY' });
  assert.equal((await (await producer.mediaJobStore(workspaceRoot)).get(ahead.id)).id, ahead.id,
    'a committed pending job must make the clear fail and remain durable');
});
