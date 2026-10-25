import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const require = createRequire(import.meta.url);
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function run(args) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
  return result.stdout;
}
async function waitForExport(service, workspace, id) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const state = await service.getComicExportWorkspaceState(workspace);
    const item = state.exports.find(item => item.id === id);
    if (item && ['completed', 'failed', 'cancelled', 'interrupted'].includes(item.status)) {
      assert.equal(item.status, 'completed', item.error || item.message);
      return item;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail('comic export did not complete');
}
async function waitForTerminalExport(service, workspace, id) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const item = (await service.getComicExportWorkspaceState(workspace)).exports.find(item => item.id === id);
    if (item && ['completed', 'failed', 'cancelled', 'interrupted'].includes(item.status)) return item;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail('comic export did not reach a terminal state');
}
function toneAmplitude(bytes, frequency, sampleRate = 48_000) {
  const count = bytes.length / 4;
  let sine = 0, cosine = 0;
  for (let index = 0; index < count; index += 1) {
    const value = bytes.readFloatLE(index * 4);
    const phase = 2 * Math.PI * frequency * index / sampleRate;
    sine += value * Math.sin(phase);
    cosine += value * Math.cos(phase);
  }
  return 2 * Math.hypot(sine, cosine) / count;
}

test('real FFmpeg export selects one episode, mixes music/effects, dissolves shots, and writes three subtitle formats', { timeout: 90_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-comic-export-e2e-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const workspace = join(root, 'workspace');
  await mkdir(join(workspace, 'nextmux.media'), { recursive: true });
  class Service extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return join(root, 'state'); }
    async getMediaRuntimeState() { return { ffmpeg: { available: true, path: ffmpeg, source: 'bundled', message: '' }, comfyUi: { configured: false, available: false, source: 'missing', message: '' } }; }
  }
  const service = new Service();
  let state = await service.createComicProject({ workspaceRoot: workspace, title: 'Export acceptance', starter: 'empty', frameRate: 24,
    canvas: { aspectRatio: '16:9', width: 320, height: 180 }, scriptText: '第 1 集：第一集\n场景 1：花园\nAlice: first episode\n第 2 集：第二集\n场景 1：海边\nBob: excluded episode' });
  state = await service.applyComicAnalysis({ workspaceRoot: workspace, expectedRevision: state.project.revision });
  const command = async command => { state = await service.applyComicCommand({ workspaceRoot: workspace, command: { ...command, expectedRevision: state.project.revision } }); };
  const sceneId = state.project.scenes[0].id;
  const firstShotId = state.project.scenes[0].shots[0].id;
  await command({ type: 'shot.update', sceneId, shotId: firstShotId, patch: { durationFrames: 24, transitionOut: 'dissolve' } });
  await command({ type: 'dialogue.replace', sceneId, shotId: firstShotId, cues: [{ text: 'first subtitle', startFrame: 0, durationFrames: 12 }] });
  await command({ type: 'shot.add', sceneId, shot: { title: 'Second shot', durationFrames: 24, transitionIn: 'dissolve' }, cues: [{ text: 'second subtitle', startFrame: 8, durationFrames: 12 }] });
  const secondShotId = state.project.scenes[0].shots[1].id;
  await command({ type: 'shot.add', sceneId, shot: { title: 'Third shot', durationFrames: 24, transitionIn: 'dissolve' } });
  const thirdShotId = state.project.scenes[0].shots[2].id;
  await command({ type: 'shot.add', sceneId, shot: { title: 'One-frame marker', durationFrames: 1, transitionIn: 'dissolve' } });
  const markerShotId = state.project.scenes[0].shots[3].id;
  const originalHashes = new Map();
  const attach = async (shotId, kind, slot, stem, args) => {
    const extension = kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'wav';
    const uri = `nextmux.media/${stem}.${extension}`;
    const path = join(workspace, uri);
    run([...args, '-y', path]);
    const bytes = await readFile(path);
    originalHashes.set(path, digest(bytes));
    await command({ type: 'media.attach', sceneId, shotId, slot, asset: { id: `asset-${randomUUID()}`, kind, uri,
      mimeType: kind === 'image' ? 'image/png' : 'audio/wav', byteLength: bytes.length, sha256: digest(bytes),
      jobId: `media-job-${randomUUID()}`, provider: 'local acceptance fixture', model: 'synthetic' } });
  };
  await attach(firstShotId, 'image', 'visual', 'red', ['-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=24', '-frames:v', '1']);
  await attach(secondShotId, 'image', 'visual', 'blue', ['-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24', '-frames:v', '1']);
  await attach(firstShotId, 'music', 'music', 'music440', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-c:a', 'pcm_s16le']);
  await attach(firstShotId, 'effect', 'effect', 'effect880', ['-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=1', '-c:a', 'pcm_s16le']);
  await attach(firstShotId, 'audio', 'audio', 'speech660', ['-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=1', '-c:a', 'pcm_s16le']);
  await attach(secondShotId, 'audio', 'audio', 'speech550', ['-f', 'lavfi', '-i', 'sine=frequency=550:sample_rate=48000:duration=1', '-c:a', 'pcm_s16le']);
  await attach(thirdShotId, 'image', 'visual', 'green', ['-f', 'lavfi', '-i', 'color=c=lime:s=320x180:r=24', '-frames:v', '1']);
  await attach(markerShotId, 'image', 'visual', 'marker', ['-f', 'lavfi', '-i', 'color=c=white:s=320x180:r=24', '-frames:v', '1']);
  await command({ type: 'shot.add', sceneId, shot: { title: 'Embedded subtitle shot', durationFrames: 24 } });
  const embeddedShotId = state.project.scenes[0].shots[4].id;
  const embeddedSubtitlePath = join(root, 'embedded.srt');
  await (await import('node:fs/promises')).writeFile(embeddedSubtitlePath, '1\n00:00:00,000 --> 00:00:00,500\nEmbedded source subtitle\n');
  await attach(embeddedShotId, 'video', 'video', 'embedded', ['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=24:d=1', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=1', '-i', embeddedSubtitlePath, '-map', '0:v', '-map', '1:a', '-map', '2:0', '-c:v', 'libx264', '-c:a', 'aac', '-c:s', 'mov_text', '-t', '1']);
  const episodeId = state.production.episodes[0].id;
  const request = { workspaceRoot: workspace, episodeId, fileName: 'acceptance', quality: 'draft', subtitleMode: 'sidecar', allowPlaceholders: false, verifyAssetIntegrity: true };
  await assert.rejects(service.startComicExport({ ...request, episodeId: 'missing-episode' }), error => error.code === 'COMIC_EPISODE_NOT_FOUND');
  const started = await service.startComicExport(request);
  assert.equal(started.totalShots, 5, 'other episode must not be rendered');
  const result = await waitForExport(service, workspace, started.id);
  const outputPath = join(workspace, result.output.relativeUri);
  assert.equal(result.episodeId, episodeId);
  assert.equal(result.output.durationSeconds, 81 / 24, 'Two 8-frame dissolves preserve the one-frame marker');
  assert.ok((await stat(outputPath)).size > 1_000);
  const frame = seconds => [...run(['-ss', String(seconds), '-i', outputPath, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])];
  const first = frame(0.2), mixed = frame(0.8), last = frame(1.15), third = frame(2.05);
  assert.ok(third[1] > 150 && third[0] < 40 && third[2] < 40, `third frame is green: ${third}`);
  assert.ok(first[0] > 150 && first[2] < 40, `first frame is red: ${first}`);
  assert.ok(last[2] > 150 && last[0] < 40, `last frame is blue: ${last}`);
  assert.ok(mixed[0] > 20 && mixed[2] > 20, `dissolve contains both scenes: ${mixed}`);
  const audio = run(['-ss', '0.15', '-t', '0.35', '-i', outputPath, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
  assert.ok(toneAmplitude(audio, 440) > 0.035, 'music track reaches the MP4');
  assert.ok(toneAmplitude(audio, 880) > 0.035, 'effect track reaches the MP4');
  assert.ok(toneAmplitude(audio, 660) > 0.035, 'speech track reaches the MP4');
  const paths = result.output.subtitleRelativeUris;
  assert.ok(paths?.srt && paths?.vtt && paths?.ass);
  for (const [format, relativePath] of Object.entries(paths)) {
    const content = await readFile(join(workspace, relativePath), 'utf8');
    assert.match(content, /first subtitle/);
    assert.match(content, /second subtitle/);
    assert.match(content, /Embedded source subtitle/);
    assert.doesNotMatch(content, /excluded episode/);
    if (format === 'vtt') assert.ok(content.startsWith('WEBVTT'));
    if (format === 'ass') assert.match(content, /\[Events\]/);
  }
  const persisted = new Service();
  const history = await persisted.getComicExportWorkspaceState(workspace);
  assert.equal(history.exports[0].episodeId, episodeId);
  assert.deepEqual(history.exports[0].output.subtitleRelativeUris, paths);
  for (const [path, hash] of originalHashes) assert.equal(digest(await readFile(path)), hash, 'export must preserve source assets');
});

test('dialogue without a real speech or video-audio source cannot pass strict export', { timeout: 90_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-comic-silent-dialogue-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const workspace = join(root, 'workspace');
  await mkdir(join(workspace, 'nextmux.media'), { recursive: true });
  class Service extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return join(root, 'state'); }
    async getMediaRuntimeState() { return { ffmpeg: { available: true, path: ffmpeg, source: 'bundled', message: '' }, comfyUi: { configured: false, available: false, source: 'missing', message: '' } }; }
  }
  const service = new Service();
  let state = await service.createComicProject({ workspaceRoot: workspace, title: 'Silent dialogue acceptance', starter: 'storyboard', frameRate: 24,
    canvas: { aspectRatio: '16:9', width: 320, height: 180 } });
  const sceneId = state.project.scenes[0].id;
  const shotId = state.project.scenes[0].shots[0].id;
  const command = async command => { state = await service.applyComicCommand({ workspaceRoot: workspace, command: { ...command, expectedRevision: state.project.revision } }); };
  await command({ type: 'shot.update', sceneId, shotId, patch: { durationFrames: 24 } });
  await command({ type: 'dialogue.replace', sceneId, shotId, cues: [{ text: 'Should have a voice', startFrame: 0, durationFrames: 24 }] });
  const uri = 'nextmux.media/visual.png';
  run(['-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24', '-frames:v', '1', '-y', join(workspace, uri)]);
  const bytes = await readFile(join(workspace, uri));
  await command({ type: 'media.attach', sceneId, shotId, slot: 'visual', asset: {
    id: `asset-${randomUUID()}`, kind: 'image', uri, mimeType: 'image/png', byteLength: bytes.length,
    sha256: digest(bytes), jobId: `media-job-${randomUUID()}`, provider: 'local acceptance fixture', model: 'synthetic'
  } });
  const request = { workspaceRoot: workspace, fileName: 'silent-dialogue', quality: 'draft',
    subtitleMode: 'sidecar', verifyAssetIntegrity: true, allowPlaceholders: false };
  const strict = await waitForTerminalExport(service, workspace, (await service.startComicExport(request)).id);
  if (strict.status === 'completed') {
    const audio = run(['-i', join(workspace, strict.output.relativeUri), '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
    assert.ok(toneAmplitude(audio, 440) < 0.001, 'current export contains only synthetic silence');
  }
  assert.equal(strict.status, 'failed', 'a dialogue subtitle plus a silent AAC stream is not a voiced work');
  assert.equal(strict.errorInfo.messageKey, 'platform_media.dialogue_audio_missing');

  const placeholder = await waitForTerminalExport(service, workspace, (await service.startComicExport({ ...request, allowPlaceholders: true })).id);
  assert.equal(placeholder.status, 'completed', placeholder.error);
  assert.ok(placeholder.warningInfos.some(warning => warning.messageKey === 'platform_media.silent_dialogue'));

  await command({ type: 'dialogue.replace', sceneId, shotId, cues: [] });
  const intentionalSilence = await waitForTerminalExport(service, workspace, (await service.startComicExport(request)).id);
  assert.equal(intentionalSilence.status, 'completed', intentionalSilence.error);

  await command({ type: 'dialogue.replace', sceneId, shotId, cues: [{ text: 'Native audio can carry dialogue', startFrame: 0, durationFrames: 24 }] });
  const videoUri = 'nextmux.media/voiced-source.mp4';
  run(['-f', 'lavfi', '-i', 'color=c=green:s=320x180:r=24:d=1', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=1',
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-c:a', 'aac', '-t', '1', '-y', join(workspace, videoUri)]);
  const videoBytes = await readFile(join(workspace, videoUri));
  await command({ type: 'media.attach', sceneId, shotId, slot: 'video', asset: {
    id: `asset-${randomUUID()}`, kind: 'video', uri: videoUri, mimeType: 'video/mp4', byteLength: videoBytes.length,
    sha256: digest(videoBytes), jobId: `media-job-${randomUUID()}`, provider: 'local acceptance fixture', model: 'synthetic'
  } });
  const nativeAudio = await waitForTerminalExport(service, workspace, (await service.startComicExport(request)).id);
  assert.equal(nativeAudio.status, 'completed', nativeAudio.error);
  const audio = run(['-i', join(workspace, nativeAudio.output.relativeUri), '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
  assert.ok(toneAmplitude(audio, 330) > 0.02, 'a real video audio source reaches strict output');
});

test('video track evidence comes from actual bytes and distinguishes embedded subtitles', { timeout: 30_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-video-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const subtitle = join(root, 'captions.srt');
  const video = join(root, 'native.mp4');
  await (await import('node:fs/promises')).writeFile(subtitle, '1\n00:00:00,000 --> 00:00:00,500\nEmbedded\n');
  run(['-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=24:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-i', subtitle,
    '-map', '0:v', '-map', '1:a', '-map', '2:0', '-c:v', 'libx264', '-c:a', 'aac', '-c:s', 'mov_text', '-t', '1', '-y', video]);
  class Service extends NextMuxPlatformServiceImpl {}
  const evidence = await new Service().probeMediaTracks(ffmpeg, video, new AbortController().signal);
  assert.equal(evidence.nativeAudio, true);
  assert.equal(evidence.nativeSubtitles, true);
  assert.equal(evidence.subtitleCheck, 'embedded');
  assert.equal(evidence.checker, 'ffmpeg');
});

test('split video exports embedded subtitles from each shot source interval', { timeout: 90_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-comic-split-subtitle-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const workspace = join(root, 'workspace');
  await mkdir(join(workspace, 'nextmux.media'), { recursive: true });
  class Service extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return join(root, 'state'); }
    async getMediaRuntimeState() { return { ffmpeg: { available: true, path: ffmpeg, source: 'bundled', message: '' }, comfyUi: { configured: false, available: false, source: 'missing', message: '' } }; }
  }
  const service = new Service();
  let state = await service.createComicProject({ workspaceRoot: workspace, title: 'Split subtitle acceptance', starter: 'empty', frameRate: 24,
    canvas: { aspectRatio: '16:9', width: 320, height: 180 }, scriptText: '场景 1：测试镜头' });
  state = await service.applyComicAnalysis({ workspaceRoot: workspace, expectedRevision: state.project.revision });
  const command = async command => { state = await service.applyComicCommand({ workspaceRoot: workspace, command: { ...command, expectedRevision: state.project.revision } }); };
  const sceneId = state.project.scenes[0].id;
  const shotId = state.project.scenes[0].shots[0].id;
  await command({ type: 'shot.update', sceneId, shotId, patch: { durationFrames: 48 } });
  await command({ type: 'dialogue.replace', sceneId, shotId, cues: [] });
  const subtitlePath = join(root, 'source.srt');
  await (await import('node:fs/promises')).writeFile(subtitlePath,
    '1\n00:00:00,200 --> 00:00:00,600\nFIRST HALF\n\n2\n00:00:01,200 --> 00:00:01,600\nSECOND HALF\n');
  const uri = 'nextmux.media/split-source.mp4';
  const sourcePath = join(workspace, uri);
  run(['-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=2', '-i', subtitlePath,
    '-map', '0:v', '-map', '1:0', '-c:v', 'libx264', '-c:s', 'mov_text', '-t', '2', '-y', sourcePath]);
  const bytes = await readFile(sourcePath);
  await command({ type: 'media.attach', sceneId, shotId, slot: 'video', asset: {
    id: `asset-${randomUUID()}`, kind: 'video', uri, mimeType: 'video/mp4', byteLength: bytes.length,
    sha256: digest(bytes), jobId: `media-job-${randomUUID()}`, provider: 'local acceptance fixture', model: 'synthetic'
  } });
  await command({ type: 'shot.split', sceneId, shotId, splitAtFrame: 24 });
  assert.equal(state.project.scenes[0].shots[1].mediaSourceStartFrames[state.project.scenes[0].shots[1].videoAssetId], 24);
  const started = await service.startComicExport({ workspaceRoot: workspace, fileName: 'split-subtitles', quality: 'draft',
    subtitleMode: 'sidecar', allowPlaceholders: false, verifyAssetIntegrity: true });
  const result = await waitForExport(service, workspace, started.id);
  assert.equal(result.output.durationSeconds, 2);
  assert.ok((await stat(join(workspace, result.output.relativeUri))).size > 1_000);
  const subtitles = Object.fromEntries(await Promise.all(Object.entries(result.output.subtitleRelativeUris)
    .map(async ([format, uri]) => [format, await readFile(join(workspace, uri), 'utf8')])));
  for (const [format, content] of Object.entries(subtitles)) {
    assert.equal((content.match(/FIRST HALF/g) || []).length, 1, `${format} must include the first cue once:\n${content}`);
    assert.equal((content.match(/SECOND HALF/g) || []).length, 1, `${format} must include the second cue once:\n${content}`);
  }
  const srt = subtitles.srt;
  assert.match(srt, /00:00:00,208 --> 00:00:00,583\nFIRST HALF/);
  assert.match(srt, /00:00:01,208 --> 00:00:01,583\nSECOND HALF/);
  assert.match(subtitles.vtt, /00:00:01\.208 --> 00:00:01\.583\nSECOND HALF/);
  assert.match(subtitles.ass, /0:00:01\.20,0:00:01\.58,Default,,0,0,0,,SECOND HALF/);
});

test('music laid over several shots plays on from its in-point and ends with the file instead of looping', { timeout: 90_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-comic-music-e2e-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  class Service extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return join(root, 'state'); }
    async getMediaRuntimeState() { return { ffmpeg: { available: true, path: ffmpeg, source: 'bundled', message: '' }, comfyUi: { configured: false, available: false, source: 'missing', message: '' } }; }
  }
  const service = new Service();
  let state = await service.createComicProject({ workspaceRoot: workspace, title: 'Music continuity', starter: 'empty', frameRate: 24,
    canvas: { aspectRatio: '16:9', width: 320, height: 180 } });
  const still = join(root, 'still.png'), tone = join(root, 'tone.wav');
  run(['-f', 'lavfi', '-i', 'color=c=red:s=320x180', '-frames:v', '1', '-y', still]);
  run(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1.5', '-c:a', 'pcm_s16le', '-y', tone]);
  const imported = await service.importComicMedia({ workspaceRoot: workspace, paths: [still, tone] });
  const [image, music] = imported.sources;
  assert.ok(image && music, 'both files import');
  assert.equal(imported.state.project.assets.find(asset => asset.id === music).durationMs, 1_500, 'the length is measured on import');
  state = (await service.applyComicEdits({ workspaceRoot: workspace, expectedRevision: imported.state.project.revision,
    edits: [{ type: 'insert_clips', assetIds: [image, image, image], imageSeconds: 1, episodeNumber: 1 }] })).state;
  const scene = state.project.scenes[0];
  state = (await service.applyComicEdits({ workspaceRoot: workspace, expectedRevision: state.project.revision,
    edits: [{ type: 'place_audio', assetId: music, role: 'music', shots: scene.shots.map(shot => ({ sceneId: scene.id, shotId: shot.id })) }] })).state;
  // 1.5 s of music over three 1 s shots: the first shot from 0, the second from 1 s in; the third has none.
  assert.deepEqual(state.project.scenes[0].shots.map(shot => [(shot.musicAssetIds || []).length, shot.mediaSourceStartFrames?.[music] || 0]), [[1, 0], [1, 24], [0, 0]]);
  const started = await service.startComicExport({ workspaceRoot: workspace, episodeId: state.production.episodes[0].id, fileName: 'music',
    quality: 'draft', subtitleMode: 'none', allowPlaceholders: false, verifyAssetIntegrity: true });
  const result = await waitForExport(service, workspace, started.id);
  const outputPath = join(workspace, result.output.relativeUri);
  const tonal = (from, seconds) => toneAmplitude(run(['-ss', String(from), '-t', String(seconds), '-i', outputPath, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']), 440);
  assert.ok(tonal(0.2, 0.3) > 0.035, 'music plays in the first shot');
  assert.ok(tonal(1.1, 0.3) > 0.035, 'and continues into the second');
  assert.ok(tonal(1.62, 0.3) < 0.01, `and stops where the file ends instead of starting over: ${tonal(1.62, 0.3)}`);
  assert.ok(tonal(2.2, 0.5) < 0.01, 'the third shot is silent');
});
