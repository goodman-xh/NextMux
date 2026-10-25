import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

// Keep the explicit analysis action under test. The create flow now applies
// drafts immediately when a script is pasted into a new empty project.
async function createForManualAnalysis(service, request) {
  const { scriptText, ...creation } = request;
  const empty = await service.createComicProject(creation);
  assert.equal(empty.project.scenes.length, 0);
  return service.updateComicScript({
    workspaceRoot: request.workspaceRoot,
    scriptText,
    expectedRevision: empty.production.revision,
  });
}

test('comic script analysis materializes idempotent episode storyboard drafts', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-comic-analysis-'));
  const workspace = join(root, 'workspace');
  const stateRoot = join(root, 'state');
  await mkdir(workspace);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  class TestPlatformService extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() {
      return stateRoot;
    }
  }

  const service = new TestPlatformService();
  const initial = await createForManualAnalysis(service, {
    workspaceRoot: workspace,
    title: '两集草稿',
    starter: 'empty',
    scriptText: [
      '第 1 集：相遇',
      '场景 1：车站 | 夜晚',
      '甲：你来了。',
      '乙: 我一直在等。',
      '旁白：远处传来火车声。',
      '地点：旧车站',
      '第 2 集：回声',
      '场景 1：月台 | 白天',
      '乙：我们现在出发，直到天亮。',
    ].join('\n'),
  });
  assert.equal(initial.project.scenes.length, 0);
  assert.equal(initial.production?.scriptAnalysis?.episodes.length, 2);

  const materialized = await service.applyComicAnalysis({
    workspaceRoot: workspace,
    expectedRevision: initial.project.revision,
  });
  assert.deepEqual(materialized.project.characters.map(character => character.name), ['甲', '乙']);
  assert.equal(materialized.project.scenes.length, 2);
  assert.deepEqual(materialized.project.scenes.map(scene => scene.episodeNumber), [1, 2]);
  assert.equal(materialized.project.scenes.every(scene => scene.shots.length === 1), true);
  assert.deepEqual(materialized.production?.episodes.map(episode => episode.sceneIds.length), [1, 1]);
  const characterIds = new Map(materialized.project.characters.map(character => [character.name, character.id]));
  const firstShot = materialized.project.scenes[0].shots[0];
  assert.deepEqual(firstShot.dialogueCues.map(cue => ({ text: cue.text, speakerCharacterId: cue.speakerCharacterId })), [
    { text: '你来了。', speakerCharacterId: characterIds.get('甲') },
    { text: '我一直在等。', speakerCharacterId: characterIds.get('乙') },
    { text: '远处传来火车声。', speakerCharacterId: undefined },
  ]);
  assert.deepEqual(materialized.project.scenes[1].shots[0].dialogueCues.map(cue => cue.text), ['我们现在出发，直到天亮。']);
  assert.ok(firstShot.durationFrames > materialized.project.frameRate * 4, 'draft duration fits all dialogue');
  for (const scene of materialized.project.scenes) {
    for (const shot of scene.shots) {
      let previousEnd = 0;
      for (const cue of shot.dialogueCues) {
        assert.equal(cue.startFrame, previousEnd);
        assert.ok(Number.isSafeInteger(cue.durationFrames) && cue.durationFrames > 0);
        previousEnd = cue.startFrame + cue.durationFrames;
        assert.ok(previousEnd <= shot.durationFrames);
      }
    }
  }

  const repeated = await service.applyComicAnalysis({
    workspaceRoot: workspace,
    expectedRevision: materialized.project.revision,
  });
  assert.equal(repeated.project.revision, materialized.project.revision);
  assert.equal(repeated.project.characters.length, 2);
  assert.equal(repeated.project.scenes.length, 2);
  assert.deepEqual(repeated.project.scenes, materialized.project.scenes, 'repeat analysis preserves shot and dialogue IDs');
});

test('script analysis leaves a matching user-authored scene and its dialogue untouched', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-comic-analysis-existing-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  class TestPlatformService extends NextMuxPlatformServiceImpl { nextmuxDataRoot() { return join(root, 'state'); } }
  const service = new TestPlatformService();
  let state = await createForManualAnalysis(service, { workspaceRoot: workspace, title: '保留编辑', starter: 'empty', scriptText: '第 1 集：相遇\n场景 1：车站\n甲：剧本中的台词。' });
  state = await service.applyComicCommand({ workspaceRoot: workspace, command: { type: 'scene.add', expectedRevision: state.project.revision, scene: { episodeNumber: 1, title: '车站', summary: '用户自己的场景' } } });
  const sceneId = state.project.scenes[0].id;
  state = await service.applyComicCommand({ workspaceRoot: workspace, command: { type: 'shot.add', expectedRevision: state.project.revision, sceneId, shot: { title: '用户镜头', durationFrames: 120 }, cues: [{ text: '用户已改写的台词。', startFrame: 10, durationFrames: 80 }] } });
  const authoredScene = state.project.scenes[0];
  const analyzed = await service.applyComicAnalysis({ workspaceRoot: workspace, expectedRevision: state.project.revision });
  assert.equal(analyzed.project.scenes.length, 1);
  assert.deepEqual(analyzed.project.scenes[0], authoredScene);
  const repeated = await service.applyComicAnalysis({ workspaceRoot: workspace, expectedRevision: analyzed.project.revision });
  assert.equal(repeated.project.revision, analyzed.project.revision);
  assert.deepEqual(repeated.project.scenes[0], authoredScene);
});

test('long scene dialogue is split into valid draft shots without dropping lines', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-comic-analysis-long-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  class TestPlatformService extends NextMuxPlatformServiceImpl { nextmuxDataRoot() { return join(root, 'state'); } }
  const service = new TestPlatformService();
  const dialogue = Array.from({ length: 105 }, (_, index) => `这是第${index + 1}句。`);
  const initial = await createForManualAnalysis(service, { workspaceRoot: workspace, title: '长对白', starter: 'empty', scriptText: ['第 1 集', '场景 1：车站', ...dialogue.map(text => `甲：${text}`)].join('\n') });
  const analyzed = await service.applyComicAnalysis({ workspaceRoot: workspace, expectedRevision: initial.project.revision });
  const shots = analyzed.project.scenes[0].shots;
  assert.equal(shots.length, 2);
  assert.deepEqual(shots.flatMap(shot => shot.dialogueCues.map(cue => cue.text)), dialogue);
  assert.ok(shots.every(shot => shot.dialogueCues.length <= 100 && shot.durationFrames <= analyzed.project.frameRate * 300));
});

test('an empty legacy scene left by interrupted analysis receives its missing shot', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-comic-analysis-interrupted-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  class TestPlatformService extends NextMuxPlatformServiceImpl { nextmuxDataRoot() { return join(root, 'state'); } }
  const service = new TestPlatformService();
  const initial = await createForManualAnalysis(service, { workspaceRoot: workspace, title: '中断后恢复', starter: 'empty',
    scriptText: '第 1 集：相遇\n场景 1：车站\n甲：你好。' });
  const partial = await service.applyComicCommand({ workspaceRoot: workspace,
    command: { type: 'scene.add', expectedRevision: initial.project.revision,
      scene: { episodeNumber: 1, title: '车站', summary: '半成品场景' } } });
  const resumed = await service.applyComicAnalysis({ workspaceRoot: workspace, expectedRevision: partial.project.revision });
  assert.equal(resumed.project.scenes.length, 1);
  assert.equal(resumed.project.scenes[0].shots.length, 1);
  assert.equal(resumed.project.scenes[0].shots[0].dialogueCues[0].text, '你好。');
});

test('failed final commit leaves script analysis entirely unmaterialized for a clean retry', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-comic-analysis-atomic-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  class InterruptedCommitService extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return join(root, 'state'); }
    async comicProjectStore(workspaceRoot) {
      const store = await super.comicProjectStore(workspaceRoot);
      return new Proxy(store, { get: (target, key) => {
        if (key === 'commitPrepared') return async (...args) => {
          if (this.failCommit) {
            this.failCommit = false;
            throw new Error('injected interruption before project commit');
          }
          return target.commitPrepared(...args);
        };
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    }
  }
  const service = new InterruptedCommitService();
  const initial = await createForManualAnalysis(service, { workspaceRoot: workspace, title: '原子分镜', starter: 'empty',
    scriptText: '第 1 集：相遇\n场景 1：车站\n甲：你好。' });
  service.failCommit = true;
  await assert.rejects(service.applyComicAnalysis({ workspaceRoot: workspace, expectedRevision: initial.project.revision }));
  const interrupted = await service.getComicProject(workspace);
  assert.equal(interrupted.project.revision, initial.project.revision);
  assert.equal(interrupted.project.characters.length, 0);
  assert.equal(interrupted.project.scenes.length, 0);
  const resumed = await service.applyComicAnalysis({ workspaceRoot: workspace, expectedRevision: initial.project.revision });
  assert.equal(resumed.project.scenes[0].shots[0].dialogueCues[0].text, '你好。');
});

test('analysis repairs its production sidecar after a transient post-commit failure', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-comic-analysis-sidecar-recovery-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  class InterruptedSidecarService extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return join(root, 'state'); }
    async syncComicProductionDocument(...args) {
      if (this.failNextSync && args[1].scenes.length > 0) {
        this.failNextSync = false;
        throw new Error('injected interruption after project commit');
      }
      return super.syncComicProductionDocument(...args);
    }
  }
  const service = new InterruptedSidecarService();
  const initial = await createForManualAnalysis(service, { workspaceRoot: workspace, title: '跨文件恢复', starter: 'empty',
    scriptText: '第 1 集：相遇\n场景 1：车站\n甲：你好。' });
  service.failNextSync = true;
  const applied = await service.applyComicAnalysis({ workspaceRoot: workspace, expectedRevision: initial.project.revision });
  assert.equal(applied.project.scenes.length, 1);
  assert.equal(applied.production?.storyboardRevision, applied.project.revision);
  const repeated = await service.applyComicAnalysis({ workspaceRoot: workspace, expectedRevision: applied.project.revision });
  assert.equal(repeated.project.revision, applied.project.revision);
  assert.equal(repeated.project.scenes.length, 1);
});

test('a persistent sidecar failure reports the storyboard as committed and reload can reconcile it', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-comic-analysis-sidecar-pending-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  class UnavailableSidecarService extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return join(root, 'state'); }
    async syncComicProductionDocument(...args) {
      if (this.failSync && args[1].scenes.length > 0) throw new Error('injected sidecar unavailable');
      return super.syncComicProductionDocument(...args);
    }
  }
  const service = new UnavailableSidecarService();
  const initial = await createForManualAnalysis(service, { workspaceRoot: workspace, title: '跨文件待修复', starter: 'empty',
    scriptText: '第 1 集：相遇\n场景 1：车站\n甲：你好。' });
  service.failSync = true;
  await assert.rejects(service.applyComicAnalysis({ workspaceRoot: workspace, expectedRevision: initial.project.revision }),
    error => error.code === 'COMIC_PRODUCTION_SYNC_PENDING' && error.message.includes('已保存'));
  const project = await (await service.comicProjectStore(workspace)).read();
  const production = await (await service.comicProductionStore(workspace)).read();
  assert.equal(project.project.scenes.length, 1);
  assert.equal(production.document.storyboardRevision, initial.project.revision);
  service.failSync = false;
  const recovered = await service.getComicProject(workspace);
  assert.equal(recovered.production.storyboardRevision, recovered.project.revision);
  assert.equal(recovered.project.scenes.length, 1);
});
