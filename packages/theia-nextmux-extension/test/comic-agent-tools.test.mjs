import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AgentToolRegistry } from '@nextmux/agent-runtime';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

async function execute(registry, permissionMode, name, args, id) {
  const result = await registry.execute(
    { id, name, arguments: args },
    permissionMode,
    { runId: 'comic-agent-test-run' },
  );
  if (result.ok) {
    assert.equal(result.summary.kind, name === 'comic.get_project' && args.sceneId ? 'comic.get_scene' : name);
    assert.doesNotMatch(result.summary.title, /\p{Script=Han}/u, 'system activity titles are English; story content remains unchanged');
    assert.equal(result.summary.details?.some(detail => /工程修订|个镜头|约 \d+ 秒/.test(detail)) || false, false);
  } else {
    assert.doesNotMatch(result.error.message, /\p{Script=Han}/u, 'model tool errors use English');
  }
  return result;
}

test('comic Agent tools mutate only through revisioned typed commands', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-comic-agent-'));
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
  const initial = await service.createComicProject({
    workspaceRoot: workspace,
    title: '类型化工具测试',
    frameRate: 24,
    canvas: { aspectRatio: '16:9', width: 1920, height: 1080 },
    starter: 'storyboard',
  });
  const sceneId = initial.project.scenes[0].id;
  const shotId = initial.project.scenes[0].shots[0].id;

  const registry = new AgentToolRegistry();
  await service.registerComicTools(registry, workspace);
  const names = registry.descriptors('workspace_write').map(tool => tool.name);
  assert.deepEqual(names, [
    'comic.add_character',
    'comic.add_scene',
    'comic.add_shot',
    'comic.apply_adaptation',
    'comic.create_project',
    'comic.delete_character',
    'comic.delete_scene',
    'comic.delete_shot',
    'comic.get_project',
    'comic.move_shot',
    'comic.replace_dialogue',
    'comic.update_character',
    'comic.update_project',
    'comic.update_scene',
    'comic.update_shot',
    'comic.write_lyrics',
    'comic.write_scripts'
]);

  const read = await execute(registry, 'read_only', 'comic.get_project', { sceneId }, 'comic-call-0001');
  assert.equal(read.ok, true);
  assert.equal(read.output.revision, 0);

  const character = await execute(registry, 'workspace_write', 'comic.add_character', {
    expectedRevision: 0,
    name: '林澈',
    appearance: '深色雨衣，银色耳钉',
  }, 'comic-call-0002');
  assert.equal(character.ok, true);
  assert.equal(character.output.revision, 1);
  const characterId = character.output.characters[0].id;

  const dialogue = await execute(registry, 'workspace_write', 'comic.replace_dialogue', {
    expectedRevision: 1,
    sceneId,
    shotId,
    cues: [
      { speakerCharacterId: characterId, text: '你听见了吗？' },
      { text: '远处传来汽笛声。' },
    ],
  }, 'comic-call-0003');
  assert.equal(dialogue.ok, true);
  assert.equal(dialogue.output.revision, 2);
  assert.equal(dialogue.output.scene.shots[0].dialogueCues.length, 2);
  assert.deepEqual(
    dialogue.output.scene.shots[0].dialogueCues.map(cue => [cue.startFrame, cue.durationFrames]),
    [[0, 48], [48, 48]],
  );

  const flattenAttempt = await execute(registry, 'workspace_write', 'comic.update_shot', {
    expectedRevision: 2,
    sceneId,
    shotId,
    dialogue: '这会错误地覆盖两段对白',
  }, 'comic-call-0004');
  assert.equal(flattenAttempt.ok, false);
  assert.equal(flattenAttempt.error.code, 'MULTI_CUE_REQUIRES_REPLACE');

  const renamed = await execute(registry, 'workspace_write', 'comic.update_shot', {
    expectedRevision: 2,
    sceneId,
    shotId,
    title: '雨中的来信',
  }, 'comic-call-0005');
  assert.equal(renamed.ok, true);
  assert.equal(renamed.output.revision, 3);
  assert.equal(renamed.output.scene.shots[0].title, '雨中的来信');
  assert.equal(renamed.output.scene.shots[0].dialogueCues.length, 2);

  const stale = await execute(registry, 'workspace_write', 'comic.add_scene', {
    expectedRevision: 2,
    title: '过期修改',
  }, 'comic-call-0006');
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'REVISION_CONFLICT');

  const finalState = await service.getComicProject(workspace);
  assert.equal(finalState.project.revision, 3);
  assert.equal(finalState.project.scenes.length, 1);
  assert.equal(finalState.project.scenes[0].shots[0].dialogueCues.length, 2);

  const adaptation = (directed) => ({
    title: '雨夜', styleBible: 'Cinematic anime, teal and amber',
    characters: [{ name: '林澈', appearance: '会被保留吗' }, { name: '阿晴', appearance: 'short silver hair', costume: 'yellow raincoat', voice: 'bright soprano' }],
    episodes: [{ number: 1, title: '来信', scenes: [{ title: '站台', location: '旧车站', timeOfDay: '夜', shots: [
      { title: '等待', durationSeconds: 6, shotSize: 'wide', cameraMotion: 'push_in', characters: ['阿晴'], action: '阿晴撑伞等待', visualPrompt: 'A girl waits in the rain',
        ...(directed ? { beats: [{ startSeconds: 0, endSeconds: 3, action: '阿晴踮脚望向站台尽头' }, { startSeconds: 3, endSeconds: 6, action: '她垂下眼，轻声自问' }] } : {}),
        dialogue: [{ speaker: '阿晴', text: '他会来吗？', ...(directed ? { tone: '轻声自问，攥紧伞柄' } : {}) }], sound: '雨声' },
      { title: '来人', durationSeconds: 5, characters: ['林澈', '阿晴'], action: '林澈出现', visualPrompt: 'A man appears through the steam',
        ...(directed ? { beats: [{ startSeconds: 0, endSeconds: 2.5, action: '蒸汽中出现人影' }, { startSeconds: 2.5, endSeconds: 5, action: '林澈停步，抬眼看向阿晴' }] } : {}) }
    ] }] }]
  });
  // A plan without beats or directed lines is sent back once with the exact shots to fix (English, positions only).
  const undirected = await execute(registry, 'workspace_write', 'comic.apply_adaptation', adaptation(false), 'comic-call-0007a');
  assert.equal(undirected.ok, false);
  assert.equal(undirected.error.code, 'SHOT_PLAN_INCOMPLETE');
  assert.match(undirected.error.message, /episode 1, scene 1, shot 1: a shot of 5 seconds or more needs at least two timed beats/);
  const adapted = await execute(registry, 'workspace_write', 'comic.apply_adaptation', adaptation(true), 'comic-call-0007');
  assert.equal(adapted.ok, true, JSON.stringify(adapted.error));
  assert.equal(adapted.output.shots, 2);
  const adaptedState = await service.getComicProject(workspace);
  assert.equal(adaptedState.project.revision, adapted.output.revision);
  assert.equal(adaptedState.project.scenes.length, 1, 'replace mode swaps the storyboard in one write');
  assert.equal(adaptedState.project.characters.find(item => item.name === '林澈').appearance, '深色雨衣，银色耳钉', 'existing characters keep their look');
  assert.match(adaptedState.project.scenes[0].shots[0].visualPrompt, /阿晴: short silver hair/);
  const invalid = await execute(registry, 'workspace_write', 'comic.apply_adaptation', { characters: [], episodes: [] }, 'comic-call-0008');
  assert.equal(invalid.ok, false);
});
