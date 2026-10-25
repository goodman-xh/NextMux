import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

test('creating an empty comic project with a script returns a durable editable storyboard without media jobs', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-comic-create-draft-'));
  const workspaceRoot = join(root, 'workspace');
  await mkdir(workspaceRoot);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  class TestService extends NextMuxPlatformServiceImpl { nextmuxDataRoot() { return join(root, 'state'); } }
  const service = new TestService();

  const created = await service.createComicProject({
    workspaceRoot,
    title: '自动分镜草稿',
    starter: 'empty',
    scriptText: '第 1 集：相遇\n场景 1：车站\n甲：你好。',
  });
  assert.equal(created.production?.scriptAnalysis?.status, 'ready');
  assert.equal(created.project.characters.length, 1);
  assert.equal(created.project.scenes.length, 1);
  assert.equal(created.project.scenes[0].shots.length, 1);
  assert.equal(created.project.scenes[0].shots[0].dialogueCues[0].text, '你好。');
  assert.equal(created.production.storyboardRevision, created.project.revision);
  assert.deepEqual((await (await service.mediaJobStore(workspaceRoot)).list(10)), []);

  const reopened = new TestService();
  const restored = await reopened.getComicProject(workspaceRoot);
  assert.deepEqual(restored.project.scenes, created.project.scenes);
  assert.equal(restored.production.storyboardRevision, restored.project.revision);
});

test('automatic storyboard creation applies only to a nonempty script and the empty starter', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-comic-create-opt-in-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  class TestService extends NextMuxPlatformServiceImpl { nextmuxDataRoot() { return join(root, 'state'); } }
  const service = new TestService();
  const blankRoot = join(root, 'blank');
  const starterRoot = join(root, 'starter');
  await Promise.all([mkdir(blankRoot), mkdir(starterRoot)]);

  const blank = await service.createComicProject({ workspaceRoot: blankRoot, title: '空工程', starter: 'empty' });
  assert.equal(blank.project.scenes.length, 0);
  assert.equal(blank.project.characters.length, 0);
  const seeded = await service.createComicProject({ workspaceRoot: starterRoot, title: '用户所选起始镜头',
    starter: 'storyboard', scriptText: '第 1 集：相遇\n场景 1：车站\n甲：你好。' });
  assert.equal(seeded.project.scenes.length, 1);
  assert.equal(seeded.project.scenes[0].shots.length, 1);
  assert.equal(seeded.project.characters.length, 0);
  assert.equal(seeded.production.scriptAnalysis.status, 'ready');
});

test('an interrupted automatic draft reports the saved partial project and supports manual recovery', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-comic-create-retry-'));
  const workspaceRoot = join(root, 'workspace');
  await mkdir(workspaceRoot);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  class InterruptedService extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return join(root, 'state'); }
    async comicProjectStore(workspace) {
      const store = await super.comicProjectStore(workspace);
      return new Proxy(store, { get: (target, key) => {
        if (key === 'commitPrepared') return async (...args) => {
          if (this.failCommit) {
            this.failCommit = false;
            throw new Error('injected failure before draft commit');
          }
          return target.commitPrepared(...args);
        };
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    }
  }
  const service = new InterruptedService();
  service.failCommit = true;
  await assert.rejects(service.createComicProject({ workspaceRoot, title: '待恢复草稿', starter: 'empty',
    scriptText: '第 1 集：相遇\n场景 1：车站\n甲：你好。' }),
    error => error.code === 'COMIC_CREATE_PARTIAL' && error.partial === true);
  const partial = await service.getComicProject(workspaceRoot);
  assert.equal(partial.project.scenes.length, 0);
  assert.equal(partial.production.scriptAnalysis.status, 'ready');
  const recovered = await service.applyComicAnalysis({ workspaceRoot, expectedRevision: partial.project.revision });
  assert.equal(recovered.project.scenes[0].shots[0].dialogueCues[0].text, '你好。');
});

test('a transient sidecar failure after the storyboard commit returns a reconciled new project', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-comic-create-sidecar-'));
  const workspaceRoot = join(root, 'workspace');
  await mkdir(workspaceRoot);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  class InterruptedService extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return join(root, 'state'); }
    async syncComicProductionDocument(...args) {
      if (this.failNextSync && args[1].scenes.length > 0) {
        this.failNextSync = false;
        throw new Error('injected sidecar interruption');
      }
      return super.syncComicProductionDocument(...args);
    }
  }
  const service = new InterruptedService();
  service.failNextSync = true;
  const created = await service.createComicProject({ workspaceRoot, title: '侧文件恢复', starter: 'empty',
    scriptText: '第 1 集：相遇\n场景 1：车站\n甲：你好。' });
  assert.equal(created.project.scenes.length, 1);
  assert.equal(created.production.storyboardRevision, created.project.revision);
});
