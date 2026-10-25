import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const require = createRequire(import.meta.url);
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;

class PausedComicExportService extends NextMuxPlatformServiceImpl {
  constructor(profile) {
    super();
    this.profile = profile;
    this.exportEntered = new Promise(resolve => { this.signalExportEntered = resolve; });
    this.exportReleased = new Promise(resolve => { this.releaseExport = resolve; });
  }
  nextmuxDataRoot() { return this.profile; }
  async getMediaRuntimeState() {
    return { ffmpeg: { available: true, path: ffmpeg, source: 'bundled', message: '' },
      comfyUi: { configured: false, available: false, source: 'missing', message: '' } };
  }
  async executeComicExport(...args) {
    this.signalExportEntered();
    await this.exportReleased;
    return this.runActualComicExport(...args);
  }
  async runActualComicExport(...args) { return super.executeComicExport(...args); }
}

class ShutdownComicExportService extends PausedComicExportService {
  async executeComicExport(running, ...args) {
    this.signalExportEntered();
    const signal = running.controller.signal;
    await new Promise(resolve => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', resolve, { once: true });
    });
    return this.runActualComicExport(running, ...args);
  }
}

class PausedValidationComicExportService extends PausedComicExportService {
  constructor(profile) {
    super(profile);
    this.validationEntered = new Promise(resolve => { this.signalValidationEntered = resolve; });
    this.validationReleased = new Promise(resolve => { this.releaseValidation = resolve; });
  }
  async getMediaRuntimeState() {
    this.signalValidationEntered();
    await this.validationReleased;
    return super.getMediaRuntimeState();
  }
}

class PausedPersistComicExportService extends PausedComicExportService {
  constructor(profile) {
    super(profile);
    this.persistEntered = new Promise(resolve => { this.signalPersistEntered = resolve; });
    this.persistReleased = new Promise(resolve => { this.releasePersist = resolve; });
    this.pausedPersist = false;
  }
  async persistComicExport(running) {
    if (!this.pausedPersist) {
      this.pausedPersist = true;
      this.signalPersistEntered();
      await this.persistReleased;
    }
    return super.persistComicExport(running);
  }
}

class PausedHistoryRecoveryService extends PausedComicExportService {
  constructor(profile) {
    super(profile);
    this.writeEntered = new Promise(resolve => { this.signalWriteEntered = resolve; });
    this.writeReleased = new Promise(resolve => { this.releaseWrite = resolve; });
    this.pauseRecoveryWrite = false;
  }
  async writeComicExportHistory(...args) {
    if (this.pauseRecoveryWrite) {
      this.pauseRecoveryWrite = false;
      this.signalWriteEntered();
      await this.writeReleased;
    }
    return super.writeComicExportHistory(...args);
  }
}

class PausedComicClearService extends PausedComicExportService {
  constructor(profile) {
    super(profile);
    this.clearEntered = new Promise(resolve => { this.signalClearEntered = resolve; });
    this.clearReleased = new Promise(resolve => { this.releaseClear = resolve; });
  }
  async removeLocalDataTree(target) {
    this.signalClearEntered();
    await this.clearReleased;
    return super.removeLocalDataTree(target);
  }
}

async function fixture(t, clearingClass = PausedComicExportService, producerClass = PausedComicExportService) {
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-comic-export-cross-window-'));
  const workspaceRoot = join(sandbox, 'workspace');
  const profile = join(sandbox, 'profile');
  await mkdir(workspaceRoot);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const producer = new producerClass(profile);
  const observer = new clearingClass(profile);
  const created = await producer.createComicProject({ workspaceRoot, title: 'Cross window export', starter: 'storyboard',
    frameRate: 24, canvas: { aspectRatio: '16:9', width: 320, height: 180 } });
  assert.ok(created.project.scenes.some(scene => scene.shots.length));
  const request = { workspaceRoot, quality: 'draft', subtitleMode: 'none', allowPlaceholders: true,
    verifyAssetIntegrity: true };
  return { producer, observer, workspaceRoot, request };
}

async function finish(producer, workspaceRoot, exportId) {
  producer.releaseExport();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const active = (await producer.getComicExportWorkspaceState(workspaceRoot)).active;
    if (!active || active.id !== exportId) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail('paused export did not leave the active state');
}

test('a second backend connection sees an active comic export in the same profile', async t => {
  const { producer, observer, workspaceRoot, request } = await fixture(t);
  const started = await producer.startComicExport(request);
  await producer.exportEntered;
  try {
    assert.equal((await observer.getComicExportWorkspaceState(workspaceRoot)).active?.id, started.id);
    const history = producer.comicExportHistoryPath(producer.mediaWorkspaceId(workspaceRoot));
    assert.equal(JSON.parse(await readFile(history, 'utf8')).exports[0].status, 'validating',
      'another connection must not mark a live export as interrupted');
  } finally {
    await finish(producer, workspaceRoot, started.id);
  }
});

test('a second backend connection cannot clear the first connection\'s active comic export history', async t => {
  const { producer, observer, workspaceRoot, request } = await fixture(t);
  const started = await producer.startComicExport(request);
  await producer.exportEntered;
  const history = producer.comicExportHistoryPath(producer.mediaWorkspaceId(workspaceRoot));
  try {
    await assert.rejects(observer.clearDesktopLocalData({ workspaceRoot, categories: ['comic_exports'] }),
      { code: 'LOCAL_DATA_BUSY' });
    assert.equal(JSON.parse(await readFile(history, 'utf8')).exports[0].id, started.id);
  } finally {
    await finish(producer, workspaceRoot, started.id);
  }
});

test('an independent backend process cannot recover or clear an active comic export', async t => {
  const { producer, workspaceRoot, request } = await fixture(t);
  const started = await producer.startComicExport(request);
  await producer.exportEntered;
  const profile = producer.nextmuxDataRoot();
  const observer = fileURLToPath(new URL('./fixtures/comic-export-clear-observer.mjs', import.meta.url));
  try {
    const child = spawnSync(process.execPath, [observer, profile, workspaceRoot],
      { encoding: 'utf8', timeout: 15_000 });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout.trim());
    assert.equal(result.activeId, started.id);
    assert.equal(result.status, 'validating');
    assert.equal(result.clearErrorCode, 'LOCAL_DATA_BUSY');
    assert.equal(result.persistedId, started.id);
  } finally {
    await finish(producer, workspaceRoot, started.id);
  }
  const finished = spawnSync(process.execPath, [observer, profile, workspaceRoot],
    { encoding: 'utf8', timeout: 15_000 });
  assert.equal(finished.status, 0, finished.stderr);
  const result = JSON.parse(finished.stdout.trim());
  assert.equal(result.activeId, null);
  assert.equal(result.clearReturned, true);
  assert.equal(result.persistedId, null);
});

test('a former exporter cannot resurrect history after its lifecycle lock is lost and cleared', async t => {
  const { producer, workspaceRoot, request } = await fixture(t);
  const started = await producer.startComicExport(request);
  await producer.exportEntered;
  const workspaceId = producer.mediaWorkspaceId(workspaceRoot);
  const observer = fileURLToPath(new URL('./fixtures/comic-export-clear-observer.mjs', import.meta.url));
  try {
    // Force the same stale/replaced-lock boundary as a stopped heartbeat or
    // external lock removal, before the owner receives onCompromised.
    await rm(`${producer.comicExportLifecycleLockPath(workspaceId)}.lock`, { recursive: true, force: true });
    const child = spawnSync(process.execPath, [observer, producer.nextmuxDataRoot(), workspaceRoot],
      { encoding: 'utf8', timeout: 15_000 });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout.trim());
    assert.equal(result.status, 'failed');
    assert.equal(result.clearReturned, true);
    assert.equal(result.persistedId, null);
  } finally {
    await finish(producer, workspaceRoot, started.id);
  }
  const history = await producer.getComicExportWorkspaceState(workspaceRoot);
  assert.equal(history.exports.length, 0, 'lost owner must not report or persist a completed export');
});

test('a second backend connection cannot start a duplicate export for the same workspace', async t => {
  const { producer, observer, workspaceRoot, request } = await fixture(t);
  const started = await producer.startComicExport(request);
  await producer.exportEntered;
  try {
    await assert.rejects(observer.startComicExport(request), { code: 'COMIC_EXPORT_BUSY' });
  } finally {
    await finish(producer, workspaceRoot, started.id);
  }
});

test('a second backend connection can cancel the owning connection\'s export', async t => {
  const { producer, observer, workspaceRoot, request } = await fixture(t);
  const started = await producer.startComicExport(request);
  await producer.exportEntered;
  try {
    const cancelled = await observer.cancelComicExport(workspaceRoot, started.id);
    assert.equal(cancelled.cancelRequested, true);
    assert.equal(producer.comicExports.get(started.id)?.controller.signal.aborted, true);
  } finally {
    await finish(producer, workspaceRoot, started.id);
  }
});

test('clearing comic export history in one connection blocks a new export in another', async t => {
  const { producer, observer, workspaceRoot, request } = await fixture(t, PausedComicClearService);
  const clearing = observer.clearDesktopLocalData({ workspaceRoot, categories: ['comic_exports'] });
  await observer.clearEntered;
  try {
    await assert.rejects(producer.startComicExport(request), { code: 'COMIC_EXPORT_BUSY' });
  } finally {
    observer.releaseClear();
    await clearing;
  }
});

test('a failed export validation releases the shared workspace reservation', async t => {
  const { producer, observer, workspaceRoot, request } = await fixture(t);
  await assert.rejects(producer.startComicExport({ ...request, episodeId: 'missing-episode' }),
    { code: 'COMIC_EPISODE_NOT_FOUND' });
  const started = await observer.startComicExport(request);
  await observer.exportEntered;
  await finish(observer, workspaceRoot, started.id);
});

test('closing the owning connection releases its export after cancellation settles', async t => {
  const { producer, observer, workspaceRoot, request } = await fixture(t,
    PausedComicExportService, ShutdownComicExportService);
  const started = await producer.startComicExport(request);
  await producer.exportEntered;
  await producer.disposeConnectionResources();
  const deadline = Date.now() + 10_000;
  while ((await observer.getComicExportWorkspaceState(workspaceRoot)).active && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal((await observer.getComicExportWorkspaceState(workspaceRoot)).active, undefined);
  const next = await observer.startComicExport(request);
  await observer.exportEntered;
  await finish(observer, workspaceRoot, next.id);
  assert.notEqual(next.id, started.id);
});

test('closing a connection during export validation cannot launch a new export afterward', async t => {
  const { producer, observer, workspaceRoot, request } = await fixture(t,
    PausedComicExportService, PausedValidationComicExportService);
  const starting = producer.startComicExport(request);
  await producer.validationEntered;
  await producer.disposeConnectionResources();
  producer.releaseValidation();
  const outcome = await starting.then(value => value, error => error);
  try {
    assert.equal(outcome.code, 'COMIC_EXPORT_UNAVAILABLE');
    assert.equal(producer.comicExports.size, 0);
    assert.equal((await observer.getComicExportWorkspaceState(workspaceRoot)).active, undefined);
    const next = await observer.startComicExport(request);
    await observer.exportEntered;
    await finish(observer, workspaceRoot, next.id);
  } finally {
    if (outcome.id) await finish(producer, workspaceRoot, outcome.id);
  }
});

test('closing a connection while export history is persisted records cancellation without launching', async t => {
  const { producer, observer, workspaceRoot, request } = await fixture(t,
    PausedComicExportService, PausedPersistComicExportService);
  const starting = producer.startComicExport(request);
  await producer.persistEntered;
  await producer.disposeConnectionResources();
  producer.releasePersist();
  const outcome = await starting.then(value => value, error => error);
  try {
    assert.equal(outcome.code, 'COMIC_EXPORT_UNAVAILABLE');
    assert.equal(producer.comicExports.size, 0);
    const state = await observer.getComicExportWorkspaceState(workspaceRoot);
    assert.equal(state.active, undefined);
    assert.equal(state.exports[0]?.status, 'cancelled');
  } finally {
    if (outcome.id) await finish(producer, workspaceRoot, outcome.id);
  }
});

test('recovering an old export cannot overwrite another connection\'s completed cancellation', async t => {
  const { producer, observer, workspaceRoot, request } = await fixture(t, PausedHistoryRecoveryService);
  const started = await producer.startComicExport(request);
  await producer.exportEntered;
  const workspaceId = producer.mediaWorkspaceId(workspaceRoot);
  const historyPath = producer.comicExportHistoryPath(workspaceId);
  const initial = JSON.parse(await readFile(historyPath, 'utf8'));
  const interrupted = { ...started, id: `comic-export-${randomUUID()}`, status: 'rendering' };
  await writeFile(historyPath, JSON.stringify({ schemaVersion: 1, exports: [...initial.exports, interrupted] }));

  observer.pauseRecoveryWrite = true;
  const recovering = observer.getComicExportWorkspaceState(workspaceRoot);
  await observer.writeEntered;
  let cancellationSettled = false;
  const cancellation = producer.cancelComicExport(workspaceRoot, started.id)
    .finally(() => { cancellationSettled = true; });
  try {
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(cancellationSettled, false, 'owner update must wait for the recovery transaction');
  } finally {
    observer.releaseWrite();
    await recovering;
    await cancellation;
    producer.releaseExport();
  }
  const activity = producer.comicExportWorkspaceActivity();
  const deadline = Date.now() + 10_000;
  while (activity.activeByWorkspace.has(workspaceId) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(activity.activeByWorkspace.has(workspaceId), false);
  const persisted = JSON.parse(await readFile(historyPath, 'utf8'));
  assert.equal(persisted.exports.find(item => item.id === started.id)?.status, 'cancelled');
  assert.equal(persisted.exports.find(item => item.id === interrupted.id)?.status, 'failed');
});
