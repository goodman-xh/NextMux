import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

class BarrierExportService extends NextMuxPlatformServiceImpl {
  constructor(profile) {
    super();
    this.profile = profile;
    this.runs = [];
    this.leaseAttempts = 0;
    this.releaseEntered = deferred();
    this.releaseAllowed = deferred();
  }
  nextmuxDataRoot() { return this.profile; }
  mediaWorkspaceId(root) {
    const id = super.mediaWorkspaceId(root);
    this.workspaceReached?.resolve();
    return id;
  }
  async getMediaRuntimeState() {
    return { ffmpeg: { available: true, path: '/fixture/ffmpeg', source: 'bundled', message: '' },
      comfyUi: { configured: false, available: false, source: 'missing', message: '' } };
  }
  async acquireComicExportLifecycleLock(...args) {
    this.leaseAttempts += 1;
    const lease = await super.acquireComicExportLifecycleLock(...args);
    return { assertOwned: lease.assertOwned, release: async () => {
      this.releaseEntered.resolve();
      await this.releaseAllowed.promise;
      await lease.release();
    } };
  }
  async executeComicExport(running) {
    const run = { running, terminalAllowed: deferred(), terminalPublished: deferred(), cleanupAllowed: deferred() };
    this.runs.push(run);
    await run.terminalAllowed.promise;
    await this.updateComicExport(running, { status: 'failed', message: 'Fixture export failed',
      finishedAt: new Date().toISOString(), cancellable: false });
    run.terminalPublished.resolve();
    // Model the real export's file cleanup without invoking FFmpeg or relying on timing.
    await run.cleanupAllowed.promise;
    this.comicExports.delete(running.state.id);
    if (this.activeComicExportByWorkspace.get(running.workspaceId) === running.state.id) {
      this.activeComicExportByWorkspace.delete(running.workspaceId);
    }
  }
  releaseAll() {
    this.releaseAllowed.resolve();
    for (const run of this.runs) {
      run.terminalAllowed.resolve();
      run.cleanupAllowed.resolve();
    }
  }
}

async function fixture(t, connections = 2) {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-export-completion-'));
  const workspaceRoot = join(root, 'workspace');
  await mkdir(workspaceRoot);
  const services = Array.from({ length: connections }, () => new BarrierExportService(join(root, 'profile')));
  t.after(async () => {
    for (const service of services) service.releaseAll();
    await Promise.allSettled(services.flatMap(service => service.runs.map(run => run.running.completion)));
    await rm(root, { recursive: true, force: true });
  });
  await services[0].createComicProject({ workspaceRoot, title: 'Completion barrier', starter: 'storyboard',
    frameRate: 24, canvas: { aspectRatio: '16:9', width: 320, height: 180 } });
  return { services, workspaceRoot, request: { workspaceRoot, quality: 'draft', subtitleMode: 'none',
    allowPlaceholders: true, verifyAssetIntegrity: true } };
}

async function publishTerminal(service) {
  const run = service.runs[0];
  run.terminalAllowed.resolve();
  await run.terminalPublished.promise;
  return run;
}

async function beginObservedStart(service, request) {
  service.workspaceReached = deferred();
  let settled = false;
  const outcome = service.startComicExport(request).then(
    value => { settled = true; return { value }; },
    error => { settled = true; return { error }; },
  );
  await service.workspaceReached.promise;
  await nextTurn();
  return { outcome, isSettled: () => settled };
}

test('a visible terminal result waits for both cleanup and lifecycle release before starting its successor', async t => {
  const { services: [producer, observer], workspaceRoot, request } = await fixture(t);
  const first = await producer.startComicExport(request);
  const run = await publishTerminal(producer);
  const visible = await observer.getComicExportWorkspaceState(workspaceRoot);
  assert.equal(visible.exports.find(item => item.id === first.id)?.status, 'failed');

  const starting = await beginObservedStart(observer, request);
  assert.equal(starting.isSettled(), false);
  assert.equal(observer.leaseAttempts, 0, 'successor must not attempt the still-owned filesystem lock');
  assert.equal(producer.comicExportWorkspaceActivity().activeByWorkspace.get(run.running.workspaceId)?.running.state.id, first.id,
    'the finishing export must retain its shared reservation');

  run.cleanupAllowed.resolve();
  await producer.releaseEntered.promise;
  await nextTurn();
  assert.equal(starting.isSettled(), false, 'cleanup alone does not mean the lifecycle lease was released');
  assert.equal(observer.leaseAttempts, 0);

  producer.releaseAllowed.resolve();
  const { value: second, error } = await starting.outcome;
  assert.equal(error, undefined);
  assert.notEqual(second.id, first.id);
  assert.equal(observer.leaseAttempts, 1);
  assert.equal((await observer.getComicExportWorkspaceState(workspaceRoot)).active?.id, second.id);
});

test('an active nonterminal export still rejects duplicate starts immediately', async t => {
  const { services: [producer, observer], request } = await fixture(t);
  const first = await producer.startComicExport(request);
  assert.equal(first.status, 'validating');
  await assert.rejects(observer.startComicExport(request), { code: 'COMIC_EXPORT_BUSY' });
  assert.equal(observer.leaseAttempts, 0);
});

test('simultaneous successors recheck reservations after the previous export releases its lease', async t => {
  const { services: [producer, left, right], request } = await fixture(t, 3);
  await producer.startComicExport(request);
  const run = await publishTerminal(producer);
  const attempts = await Promise.all([beginObservedStart(left, request), beginObservedStart(right, request)]);
  assert.ok(attempts.every(attempt => !attempt.isSettled()));
  run.cleanupAllowed.resolve();
  await producer.releaseEntered.promise;
  producer.releaseAllowed.resolve();
  const results = await Promise.all(attempts.map(attempt => attempt.outcome));
  assert.equal(results.filter(result => result.value).length, 1);
  assert.equal(results.filter(result => result.error?.code === 'COMIC_EXPORT_BUSY').length, 1);
  assert.equal(left.leaseAttempts + right.leaseAttempts, 1, 'only the winning reservation may request the filesystem lock');
});
