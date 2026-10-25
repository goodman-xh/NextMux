import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

async function waitForJob(service, workspace, jobId, expectedStatus, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await service.getMediaWorkspaceState(workspace);
    const job = state.jobs.find(candidate => candidate.id === jobId);
    if (job?.status === expectedStatus) return job;
    if (job && ['failed', 'interrupted', 'cancelled'].includes(job.status)) {
      assert.fail(`job ${jobId} ended as ${job.status}: ${job.failure?.message || 'no failure detail'}`);
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
  assert.fail(`job ${jobId} did not reach ${expectedStatus}`);
}

test('local subtitle job persists output and atomically links provenance into the comic project', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-media-runtime-'));
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
    title: '字幕端到端测试',
    frameRate: 24,
    canvas: { aspectRatio: '16:9', width: 1920, height: 1080 },
    starter: 'storyboard',
  });
  const projectId = initial.project.id;
  const sceneId = initial.project.scenes[0].id;
  const shotId = initial.project.scenes[0].shots[0].id;

  const withDialogue = await service.applyComicCommand({
    workspaceRoot: workspace,
    command: {
      type: 'dialogue.replace',
      expectedRevision: 0,
      sceneId,
      shotId,
      cues: [
        { text: '第一句。', startFrame: 0, durationFrames: 24 },
        { text: '第二句。', startFrame: 24, durationFrames: 48 },
      ],
    },
  });
  assert.equal(withDialogue.project.revision, 1);

  const request = {
    idempotencyKey: 'subtitle-e2e-0001',
    kind: 'subtitle',
    projectId,
    sceneId,
    shotId,
    input: {
      frameRate: 24,
      cues: [
        { text: '第一句。', startFrame: 0, durationFrames: 24 },
        { text: '第二句。', startFrame: 24, durationFrames: 48 },
      ],
    },
    cost: { billing: 'free', description: 'local SRT test' },
  };
  const queued = await service.enqueueMediaJob({ workspaceRoot: workspace, job: request });
  assert.equal(queued.status, 'queued');

  const completed = await waitForJob(service, workspace, queued.id, 'succeeded');
  assert.equal(completed.output.assetKind, 'subtitle');
  assert.equal(completed.output.provider, 'NextMux 本地');
  assert.match(completed.output.sha256, /^[a-f0-9]{64}$/);

  const outputPath = join(workspace, ...completed.output.relativeUri.split('/'));
  assert.equal((await stat(outputPath)).size, completed.output.byteLength);
  const srt = await readFile(outputPath, 'utf8');
  assert.equal(srt, [
    '1',
    '00:00:00,000 --> 00:00:01,000',
    '第一句。',
    '',
    '2',
    '00:00:01,000 --> 00:00:03,000',
    '第二句。',
    '',
  ].join('\n'));

  const linked = await service.getComicProject(workspace);
  assert.equal(linked.project.schemaVersion, 2);
  assert.equal(linked.project.revision, 2);
  const linkedShot = linked.project.scenes[0].shots[0];
  const asset = linked.project.assets.find(candidate => candidate.id === linkedShot.subtitleAssetId);
  assert.ok(asset);
  assert.equal(asset.uri, completed.output.relativeUri);
  assert.equal(asset.sha256, completed.output.sha256);
  assert.equal(asset.jobId, queued.id);
  assert.equal(asset.source, 'generated');

  const changed = await service.applyComicCommand({
    workspaceRoot: workspace,
    command: {
      type: 'dialogue.replace',
      expectedRevision: linked.project.revision,
      sceneId,
      shotId,
      cues: [{ text: '对白已经改变。', startFrame: 0, durationFrames: 48 }],
    },
  });
  assert.equal(changed.project.revision, 3);

  await assert.rejects(
    service.enqueueMediaJob({
      workspaceRoot: workspace,
      job: { ...request, idempotencyKey: 'subtitle-e2e-stale-0002' },
    }),
    error => error?.code === 'STALE_MEDIA_REQUEST',
  );
});

test('media pause/resume RPCs persist queued state without claiming work', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-media-pause-rpc-'));
  const workspace = join(root, 'workspace');
  const stateRoot = join(root, 'state');
  await mkdir(workspace);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  class TestPlatformService extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return stateRoot; }
    scheduleMediaWorker() { /* Keep this RPC harness deterministic. */ }
    getMediaRuntimeState() { return Promise.resolve({ comfyUi: { available: true }, ffmpeg: { available: false } }); }
  }
  const service = new TestPlatformService();
  const initial = await service.createComicProject({
    workspaceRoot: workspace,
    title: '媒体暂停测试',
    frameRate: 24,
    canvas: { aspectRatio: '16:9', width: 1920, height: 1080 },
    starter: 'storyboard',
  });
  const sceneId = initial.project.scenes[0].id;
  const shotId = initial.project.scenes[0].shots[0].id;
  const queued = await service.enqueueMediaJob({
    workspaceRoot: workspace,
    job: {
      idempotencyKey: 'pause-rpc-0001',
      kind: 'image',
      projectId: initial.project.id,
      sceneId,
      shotId,
      input: {
        connectionId: 'comfyui:local',
        model: 'local-image',
        prompt: '测试画面',
        width: 1920,
        height: 1080,
      },
      cost: { billing: 'free', description: '本地测试' },
    },
  });
  assert.equal(queued.status, 'queued');
  assert.equal((await service.pauseMediaJob(workspace, queued.id)).status, 'paused');
  assert.equal((await service.getMediaWorkspaceState(workspace)).jobs.find(job => job.id === queued.id)?.status, 'paused');
  assert.equal((await service.resumeMediaJob(workspace, queued.id)).status, 'queued');
  assert.equal((await service.cancelMediaJob(workspace, queued.id)).status, 'cancelled');
});

test('native music BYOK dispatch preserves the selected model and provider evidence', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-native-music-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  let request;
  class TestPlatformService extends NextMuxPlatformServiceImpl {
    constructor() { super(); this.networkFetch = async (input, init) => { request = { url: String(input), init }; return new Response(Buffer.from('ID3native'), { headers: { 'content-type': 'audio/mpeg', 'song-id': 'song-1', 'character-cost': '12' } }); }; }
    mediaConnection() {
      return Promise.resolve({ connection: { id: 'official-native', providerId: 'elevenlabs', providerName: 'ElevenLabs', protocol: 'elevenlabs_music', baseUrl: 'https://api.elevenlabs.io/v1' }, apiKey: 'key' });
    }
  }
  const service = new TestPlatformService();
  const job = { id: 'media-job-11111111-2222-4333-8444-555555555555', idempotencyKey: 'native-music-0001', payloadHash: 'hash', kind: 'music', projectId: 'project', sceneId: 'scene', shotId: 'shot', input: { connectionId: 'official-native', model: 'music_v2_5', prompt: 'cinematic', durationSeconds: 4, format: 'mp3' }, cost: { billing: 'provider_billed', description: 'native' }, status: 'running', attempt: 1, maxAttempts: 3, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), events: [] };
  const output = await service.executeMediaJob(workspace, job, new AbortController().signal);
  assert.equal(new URL(request.url).pathname, '/v1/music');
  assert.equal(new URL(request.url).searchParams.get('output_format'), 'mp3_44100_128');
  assert.deepEqual(JSON.parse(request.init.body), { prompt: 'cinematic', force_instrumental: false, music_length_ms: 4000, model_id: 'music_v2_5' });
  assert.equal(output.assetKind, 'music');
  assert.equal(output.providerEvidence.characterCost, 12);
});

test('paid media confirmation rechecks the current storyboard canvas', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-paid-media-stale-canvas-'));
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  class Service extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return join(root, 'state'); }
    scheduleMediaWorker() {}
    mediaConnection() { return Promise.resolve({ connection: { id: 'official-11111111-2222-4333-8444-555555555555' }, apiKey: 'isolated-test-key' }); }
  }
  const service = new Service();
  const initial = await service.createComicProject({ workspaceRoot: workspace, title: '确认前画布复查',
    starter: 'storyboard', canvas: { aspectRatio: '16:9', width: 1920, height: 1080 } });
  const sceneId = initial.project.scenes[0].id;
  const shotId = initial.project.scenes[0].shots[0].id;
  const queued = await service.enqueueMediaJob({ workspaceRoot: workspace, job: {
    idempotencyKey: 'stale-canvas-paid-image', kind: 'image', projectId: initial.project.id, sceneId, shotId,
    input: { connectionId: 'official-11111111-2222-4333-8444-555555555555', model: 'isolated-image',
      prompt: '自定义画面', width: 1920, height: 1080 },
    cost: { billing: 'provider_billed', description: 'isolated provider' },
  } });
  assert.equal(queued.status, 'awaiting_confirmation');
  await service.applyComicCommand({ workspaceRoot: workspace, command: {
    type: 'project.update', expectedRevision: initial.project.revision,
    patch: { canvas: { aspectRatio: '16:9', width: 1280, height: 720 } },
  } });
  await assert.rejects(service.confirmMediaJob(workspace, queued.id), error => error.code === 'STALE_MEDIA_REQUEST');
  assert.equal((await service.getMediaWorkspaceState(workspace)).jobs.find(job => job.id === queued.id)?.status,
    'awaiting_confirmation');
});

test('paid worker checks the storyboard again before contacting a provider', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-paid-media-worker-source-'));
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let providerCalls = 0;
  class Service extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return join(root, 'state'); }
    scheduleMediaWorker() {}
    mediaConnection() { return Promise.resolve({ connection: { id: 'official-11111111-2222-4333-8444-555555555555',
      protocol: 'elevenlabs_music', baseUrl: 'https://api.elevenlabs.io/v1', providerName: 'ElevenLabs' }, apiKey: 'isolated-key' }); }
    constructor() { super(); this.networkFetch = async () => { providerCalls += 1; return new Response(Buffer.from('ID3audio'),
      { headers: { 'content-type': 'audio/mpeg' } }); }; }
  }
  const service = new Service();
  const initial = await service.createComicProject({ workspaceRoot: workspace, title: '执行前工程复查', starter: 'storyboard' });
  const sceneId = initial.project.scenes[0].id;
  const shotId = initial.project.scenes[0].shots[0].id;
  const queued = await service.enqueueMediaJob({ workspaceRoot: workspace, job: {
    idempotencyKey: 'deleted-shot-paid-music', kind: 'music', projectId: initial.project.id, sceneId, shotId,
    input: { connectionId: 'official-11111111-2222-4333-8444-555555555555', model: 'music_v2_5',
      prompt: 'rain', durationSeconds: 4, format: 'mp3' },
    cost: { billing: 'provider_billed', description: 'isolated provider' },
  } });
  assert.equal((await service.confirmMediaJob(workspace, queued.id)).status, 'queued');
  await service.applyComicCommand({ workspaceRoot: workspace, command: {
    type: 'shot.delete', expectedRevision: initial.project.revision, sceneId, shotId,
  } });
  const store = await service.mediaJobStore(workspace);
  await service.runMediaWorker(workspace, store);
  assert.equal(providerCalls, 0, 'a removed shot must not trigger a paid provider call');
  assert.equal((await store.get(queued.id)).status, 'failed');
});

test('free queued subtitles also check current dialogue before generation', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-free-subtitle-worker-source-'));
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let generationCalls = 0;
  class Service extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return join(root, 'state'); }
    scheduleMediaWorker() {}
    async executeMediaJob(...args) { generationCalls += 1; return super.executeMediaJob(...args); }
  }
  const service = new Service();
  const initial = await service.createComicProject({ workspaceRoot: workspace, title: '免费字幕源复查', starter: 'storyboard' });
  const sceneId = initial.project.scenes[0].id;
  const shotId = initial.project.scenes[0].shots[0].id;
  const withDialogue = await service.applyComicCommand({ workspaceRoot: workspace, command: {
    type: 'dialogue.replace', expectedRevision: initial.project.revision, sceneId, shotId,
    cues: [{ text: '原对白。', startFrame: 0, durationFrames: 24 }],
  } });
  const queued = await service.enqueueMediaJob({ workspaceRoot: workspace, job: {
    idempotencyKey: 'stale-free-subtitle-worker', kind: 'subtitle', projectId: initial.project.id, sceneId, shotId,
    input: { frameRate: 24, cues: [{ text: '原对白。', startFrame: 0, durationFrames: 24 }] },
    cost: { billing: 'free', description: 'isolated local render' },
  } });
  await service.applyComicCommand({ workspaceRoot: workspace, command: {
    type: 'dialogue.replace', expectedRevision: withDialogue.project.revision, sceneId, shotId,
    cues: [{ text: '更新对白。', startFrame: 0, durationFrames: 24 }],
  } });
  const store = await service.mediaJobStore(workspace);
  await service.runMediaWorker(workspace, store);
  assert.equal(generationCalls, 0);
  assert.equal((await store.get(queued.id)).status, 'failed');
});

for (const [kind, protocol, model, field] of [
  ['music', 'elevenlabs_music', 'music_v2_5', 'musicAssetIds'],
  ['sound_effect', 'elevenlabs_sound_effect', 'eleven_text_to_sound_v2', 'effectAssetIds'],
]) test(`${kind} goes through confirmation, execution and the correct shot track only once`, async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-audio-queue-'));
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let calls = 0;
  class Service extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return join(root, 'state'); }
    scheduleMediaWorker() {}
    mediaConnection() { return Promise.resolve({ connection: { id: 'official-11111111-2222-4333-8444-555555555555', protocol, baseUrl: 'https://api.elevenlabs.io/v1', providerName: 'ElevenLabs' }, apiKey: 'test-key' }); }
    constructor() { super(); this.networkFetch = async () => { calls++; return new Response(Buffer.from('ID3audio'), { headers: { 'content-type': 'audio/mpeg' } }); }; }
  }
  const service = new Service();
  const { project } = await service.createComicProject({ workspaceRoot: workspace, title: 'Audio queue', frameRate: 24, canvas: { aspectRatio: '16:9', width: 1920, height: 1080 }, starter: 'storyboard' });
  const sceneId = project.scenes[0].id, shotId = project.scenes[0].shots[0].id;
  const request = { idempotencyKey: `native-${kind}-queue-1`, kind, projectId: project.id, sceneId, shotId,
    input: { connectionId: 'official-11111111-2222-4333-8444-555555555555', model, prompt: 'gentle rain', durationSeconds: 4, format: 'mp3' }, cost: { billing: 'provider_billed', description: 'BYOK test' } };
  const queued = await service.enqueueMediaJob({ workspaceRoot: workspace, job: request });
  assert.equal(queued.status, 'awaiting_confirmation'); assert.equal(calls, 0);
  assert.equal((await service.enqueueMediaJob({ workspaceRoot: workspace, job: request })).id, queued.id);
  assert.equal((await service.confirmMediaJob(workspace, queued.id)).status, 'queued');
  const output = await service.executeMediaJob(workspace, queued, new AbortController().signal);
  await service.attachMediaCheckpoint(workspace, queued, output);
  await service.attachMediaCheckpoint(workspace, queued, output);
  const saved = (await service.getComicProject(workspace)).project;
  assert.deepEqual(saved.scenes[0].shots[0][field], [output.assetId]);
  assert.equal(saved.scenes[0].shots[0].videoAssetId, undefined);
  assert.equal(saved.revision, project.revision + 1); assert.equal(calls, 1);
  await assert.rejects(service.enqueueMediaJob({ workspaceRoot: workspace, job: { ...request, idempotencyKey: `bad-${kind}-free`, cost: { billing: 'free', description: 'bad' } } }), e => e.code === 'COST_CONFIRMATION_REQUIRED');
  await assert.rejects(service.enqueueMediaJob({ workspaceRoot: workspace, job: { ...request, idempotencyKey: `bad-${kind}-model`, input: { ...request.input, model: 'wrong-model' } } }), e => e.code === 'MEDIA_MODEL_UNSUPPORTED');
  assert.equal(calls, 1);
});

test('regenerated video stays pending until approved, and checkpoint replay keeps the current version', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-video-version-'));
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  class Service extends NextMuxPlatformServiceImpl { nextmuxDataRoot() { return join(root, 'state'); } }
  const service = new Service();
  const { project } = await service.createComicProject({ workspaceRoot: workspace, title: 'Version test', frameRate: 24, canvas: { aspectRatio: '16:9', width: 1920, height: 1080 }, starter: 'storyboard' });
  const sceneId = project.scenes[0].id, shotId = project.scenes[0].shots[0].id;
  const job = { id: 'media-job-11111111-2222-4333-8444-555555555555', projectId: project.id, sceneId, shotId, kind: 'video' };
  const original = { assetId: 'asset-original-video', assetKind: 'video', relativeUri: 'nextmux.media/original.mp4', mimeType: 'video/mp4', byteLength: 100, sha256: 'a'.repeat(64), provider: 'test', model: 'video' };
  await service.attachMediaCheckpoint(workspace, job, original);
  const replacement = { ...original, assetId: 'asset-replacement-video', relativeUri: 'nextmux.media/replacement.mp4', sha256: 'b'.repeat(64) };
  await service.attachMediaCheckpoint(workspace, { ...job, id: 'media-job-22222222-2222-4333-8444-555555555555' }, replacement);
  await service.attachMediaCheckpoint(workspace, { ...job, id: 'media-job-22222222-2222-4333-8444-555555555555' }, replacement);
  const current = (await service.getComicProject(workspace)).project;
  assert.equal(current.scenes[0].shots[0].videoAssetId, original.assetId);
  assert.equal(current.scenes[0].shots[0].pendingVideoAssetId, replacement.assetId);
  assert.equal(current.revision, project.revision + 2);
  assert.equal(current.assets.find(asset => asset.id === replacement.assetId).sourceAssetId, original.assetId);
});
