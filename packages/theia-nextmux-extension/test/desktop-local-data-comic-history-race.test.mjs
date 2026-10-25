import assert from 'node:assert/strict';
import { mkdtemp, mkdir, open, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

class ComicHistoryService extends NextMuxPlatformServiceImpl {
  constructor(profile) { super(); this.profile = profile; }
  nextmuxDataRoot() { return this.profile; }
}

class PausedComicHistoryClear extends ComicHistoryService {
  constructor(profile) {
    super(profile);
    this.entered = new Promise(resolve => { this.signalEntered = resolve; });
    this.released = new Promise(resolve => { this.release = resolve; });
  }
  async removeLocalDataTree(target, verifyOwnership) {
    this.signalEntered();
    await this.released;
    return super.removeLocalDataTree(target, verifyOwnership);
  }
}

test('comic history clear and a second service write preserve the serialized new snapshot', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-comic-history-race-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const workspaceRoot = join(sandbox, 'project');
  const profile = join(sandbox, 'profile');
  await mkdir(workspaceRoot);
  const clearing = new PausedComicHistoryClear(profile);
  const writer = new ComicHistoryService(profile);
  const first = await writer.comicProjectStore(workspaceRoot);
  const second = await writer.comicProjectStore(workspaceRoot);
  const initial = await first.initialize({ title: 'Race fixture' });
  const historyRoot = join(profile, 'comic-history', writer.mediaWorkspaceId(workspaceRoot));
  const clear = clearing.clearDesktopLocalData({ workspaceRoot, categories: ['comic_history'] });
  await clearing.entered;
  const write = second.commitPrepared(initial.project.revision, {
    ...initial.project, revision: initial.project.revision + 1,
    updatedAt: new Date().toISOString(),
  });
  // The old implementation lets this write finish while cleanup is paused,
  // then deletes its snapshot. A shared cross-process lock serializes them.
  await Promise.race([write.then(() => undefined), new Promise(resolve => setTimeout(resolve, 250))]);
  clearing.release();
  await Promise.all([clear, write]);
  assert.equal((await readdir(historyRoot)).filter(name => /^revision-.*\.json$/.test(name)).length, 1);
});

test('comic history clear refuses the old in-tree lock without deleting history', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-comic-history-legacy-lock-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const workspaceRoot = join(sandbox, 'project');
  const profile = join(sandbox, 'profile');
  await mkdir(workspaceRoot);
  const service = new ComicHistoryService(profile);
  const store = await service.comicProjectStore(workspaceRoot);
  const initial = await store.initialize({ title: 'Legacy lock fixture' });
  await store.commitPrepared(initial.project.revision, {
    ...initial.project, revision: initial.project.revision + 1,
    updatedAt: new Date().toISOString(),
  });
  const historyRoot = join(profile, 'comic-history', service.mediaWorkspaceId(workspaceRoot));
  const owner = await open(join(historyRoot, 'write.lock'), 'wx', 0o600);
  try {
    await assert.rejects(service.clearDesktopLocalData({ workspaceRoot, categories: ['comic_history'] }),
      { code: 'LOCAL_DATA_BUSY' });
    assert.equal((await readdir(historyRoot)).filter(name => /^revision-.*\.json$/.test(name)).length, 1);
  } finally {
    await owner.close();
  }
});
