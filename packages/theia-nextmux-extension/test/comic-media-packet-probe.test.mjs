import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createComicProject, getComicAssetDurationFrames } from '@nextmux/comic-core';
import { ComicMediaPacketTiming, probeComicMediaPackets, probeComicVideoPackets } from '../lib/node/nextmux-comic-media-probe.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const ffmpeg = createRequire(import.meta.url)('@ffmpeg-installer/ffmpeg').path;

test('whole-film packet scans accept a caller budget while default probes and cancellation retain their behavior', async () => {
  const require = createRequire(import.meta.url), ts = require('typescript');
  const filename = new URL('../src/node/nextmux-comic-media-probe.ts', import.meta.url);
  const code = ts.transpileModule(await readFile(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const delays = [], children = [];
  const spawn = () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.killed = false;
    child.kill = () => { child.killed = true; };
    children.push(child); return child;
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', code)(
    id => id === 'node:child_process' ? { spawn } : require(id), module, module.exports,
    (_callback, milliseconds) => { delays.push(milliseconds); return delays.length; }, () => {});
  const finish = () => {
    const child = children.at(-1);
    child.stdout.emit('data', '#tb 0: 1/24\n0, 0, 0, 1, 1, 0x0\n');
    child.emit('close', 0);
  };
  const longer = module.exports.probeComicVideoPackets('ffmpeg', '/fixture/film.mp4', undefined, 120_000);
  assert.equal(delays.at(-1), 120_000); finish();
  assert.equal((await longer).frames, 1);
  const regular = module.exports.probeComicVideoPackets('ffmpeg', '/fixture/clip.mp4');
  assert.equal(delays.at(-1), 15_000); finish();
  assert.equal((await regular).frames, 1);
  const controller = new AbortController();
  const cancelled = module.exports.probeComicVideoPackets('ffmpeg', '/fixture/film.mp4', controller.signal, 120_000);
  controller.abort();
  assert.equal(await cancelled, undefined);
  assert.equal(children.at(-1).killed, true, 'larger validation budgets remain immediately cancellable');
});

test('packet timing uses presentation timestamps, ignores DTS order, and normalizes a positive start', () => {
  const timing = new ComicMediaPacketTiming();
  timing.append('#tb 0: 1/1000\n0, 4800, 5000, 40, 1, 0x0\n0, 4840, 5080, 40, 1, 0x0\n');
  timing.append('0, 4880, 5040, 40, 1, 0x0\n');
  assert.deepEqual(timing.result(), { durationMs: 120, frames: 3, streamStartMs: 5000 });
});

test('packet timing handles chunk boundaries, zero terminal durations, preroll, and missing streams', () => {
  const timing = new ComicMediaPacketTiming();
  timing.append('#tb 0: 1/1');
  timing.append('000\n0, -40, -40, 40, 1, 0x0\n0, 0, 0, 40, 1, 0x0\n0, 40, 40, 0, 1, 0x0');
  assert.deepEqual(timing.result(), { durationMs: 80, frames: 3, streamStartMs: 0 });
  const noDurations = new ComicMediaPacketTiming();
  noDurations.append('#tb 0: 1/1000\n0, 0, 0, 0, 1, 0x0\n0, 40, 40, 0, 1, 0x0\n');
  assert.deepEqual(noDurations.result(), { durationMs: 80, frames: 2, streamStartMs: 0 });
  const missing = new ComicMediaPacketTiming();
  missing.append('#tb 0: 1/1000\n');
  assert.equal(missing.result(), undefined);
  const indeterminate = new ComicMediaPacketTiming();
  indeterminate.append('#tb 0: 1/1000\n0, 0, 0, 0, 1, 0x0\n');
  assert.equal(indeterminate.result(), undefined, 'a missing terminal interval cannot certify a source length');
  const fractional = new ComicMediaPacketTiming();
  fractional.append('#tb 0: 1/30\n0, 0, 0, 1, 1, 0x0\n0, 1, 1, 1, 1, 0x0\n0, 2, 2, 1, 1, 0x0\n0, 3, 3, 1, 1, 0x0\n');
  assert.equal(getComicAssetDurationFrames({ kind: 'video', durationMs: fractional.result().durationMs }, 30), 4, 'millisecond serialization keeps every complete 30 fps frame');
});

function makeMedia(args) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { timeout: 15_000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
}

test('actual stream probes distinguish short picture/audio intervals from longer containers and cancel safely', { timeout: 60_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-packet-probe-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const video = join(root, 'short-video.mp4'), audio = join(root, 'short-audio.m4a'), bad = join(root, 'bad.mp4');
  makeMedia(['-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=24:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-c:a', 'aac', '-y', video]);
  makeMedia(['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-c:a', 'aac', '-f', 'mp4', '-y', audio]);
  const service = new NextMuxPlatformServiceImpl();
  const picture = await service.probeComicImport(ffmpeg, video, 'video');
  assert.equal(picture.durationMs, 1000, 'video duration does not inherit two seconds of audio');
  assert.equal((await service.probeComicImport(ffmpeg, audio, 'music')).durationMs, 1000, 'audio duration does not inherit two seconds of video');
  assert.deepEqual([picture.width, picture.height], [64, 64]);
  await writeFile(bad, 'not a video');
  assert.equal(await probeComicVideoPackets(ffmpeg, bad), undefined);
  assert.equal(await probeComicMediaPackets(ffmpeg, video, 'audio', AbortSignal.abort()), undefined);
  const cancellation = new AbortController();
  const pending = probeComicVideoPackets(ffmpeg, video, cancellation.signal);
  cancellation.abort();
  assert.equal(await pending, undefined);
  await assert.rejects(service.verifyComicExportSegmentFrames(ffmpeg, video, 48, new AbortController().signal),
    error => error.code === 'COMIC_EXPORT_SEGMENT_FAILED', 'a container with forty-eight audio frames cannot certify twenty-four video frames as forty-eight');
  await assert.rejects(service.verifyComicExportSegmentFrames(ffmpeg, bad, 24, new AbortController().signal), error => error.code === 'COMIC_EXPORT_SEGMENT_FAILED');
});

test('generated storyboard checkpoints store actual source metadata, bound split trims, and replay without probing again', { timeout: 60_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-checkpoint-timing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspaceRoot = join(root, 'workspace');
  await mkdir(join(workspaceRoot, 'nextmux.media'), { recursive: true });
  class Service extends NextMuxPlatformServiceImpl {
    measurements = 0;
    nextmuxDataRoot() { return join(root, 'profile'); }
    async getMediaRuntimeState() { return { ffmpeg: { available: true, path: ffmpeg, source: 'bundled', message: '' } }; }
    async probeComicCheckpointMedia(...args) { this.measurements++; return super.probeComicCheckpointMedia(...args); }
  }
  const service = new Service();
  const { project } = await service.createComicProject({ workspaceRoot, title: 'Checkpoint timing', starter: 'storyboard', frameRate: 24,
    canvas: { aspectRatio: '1:1', width: 64, height: 64 } });
  const sceneId = project.scenes[0].id, shotId = project.scenes[0].shots[0].id;
  const relativeUri = 'nextmux.media/generated.mp4';
  makeMedia(['-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=24:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-c:a', 'aac', '-y', join(workspaceRoot, relativeUri)]);
  const bytes = await readFile(join(workspaceRoot, relativeUri));
  const job = { id: 'media-job-11111111-2222-4333-8444-555555555555', projectId: project.id, sceneId, shotId, kind: 'video', input: { durationSeconds: 8 } };
  const output = { assetId: 'asset-generated-video', assetKind: 'video', relativeUri, mimeType: 'video/mp4', byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), provider: 'test', model: 'synthetic' };
  await service.attachMediaCheckpoint(workspaceRoot, job, output);
  await service.attachMediaCheckpoint(workspaceRoot, job, output);
  let state = await service.getComicProject(workspaceRoot);
  assert.equal(service.measurements, 1, 'a replay uses the existing asset without another probe');
  const asset = state.project.assets.find(asset => asset.id === output.assetId);
  assert.deepEqual([asset.durationMs, asset.width, asset.height], [1000, 64, 64]);
  assert.equal(state.project.scenes[0].shots[0].durationFrames, 24, 'the real one-second video bounds the shot regardless of requested provider duration');
  state = await service.applyComicCommand({ workspaceRoot, command: { type: 'shot.split', expectedRevision: state.project.revision, sceneId, shotId, splitAtFrame: 12 } });
  const right = state.project.scenes[0].shots[1];
  assert.equal(right.mediaSourceStartFrames[asset.id], 12);
  await assert.rejects(service.applyComicCommand({ workspaceRoot, command: { type: 'shot.update', expectedRevision: state.project.revision,
    sceneId, shotId: right.id, patch: { durationFrames: 13 } } }));
  assert.deepEqual(await service.probeComicCheckpointMedia(workspaceRoot, { ...output, relativeUri: 'nextmux.media/missing.mp4' }), {}, 'unreadable old checkpoint fixtures keep the existing metadata fallback');
});

test('four complete 30 fps frames survive duration metadata and rendering with positive source timestamps', { timeout: 60_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-fractional-frame-probe-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, 'offset.mp4'), output = join(root, 'rendered.mp4');
  makeMedia(['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=30', '-frames:v', '4', '-c:v', 'libx264', '-output_ts_offset', '5', '-y', input]);
  const service = new NextMuxPlatformServiceImpl();
  const measured = await service.probeComicImport(ffmpeg, input, 'video');
  assert.equal(measured.durationMs, 134);
  assert.equal(measured.streamStartMs, 5000);
  assert.equal(getComicAssetDurationFrames({ kind: 'video', ...measured }, 30), 4);
  await service.renderComicExportSegment(ffmpeg, { shotId: 'offset', sceneTitle: 'scene', shotTitle: 'offset', durationFrames: 4,
    videoPath: input, videoStartSeconds: measured.streamStartMs / 1000, fadeInFrames: 0, fadeOutFrames: 0, transitionIn: 'cut', transitionOut: 'cut',
    volume: 1, preserveVideoAudio: false, placeholder: false },
  { frameRate: 30, canvas: { width: 64, height: 64 } }, 'draft', output, new AbortController().signal);
  assert.equal((await probeComicVideoPackets(ffmpeg, output)).frames, 4);
  const delayed = join(root, 'delayed.mp4'), delayedOutput = join(root, 'delayed-rendered.mp4');
  makeMedia(['-itsoffset', '0.5', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=24:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-vsync', '0', '-c:v', 'libx264', '-c:a', 'aac', '-y', delayed]);
  const delayedMeasured = await service.probeComicImport(ffmpeg, delayed, 'video');
  assert.equal(delayedMeasured.durationMs, 1000);
  assert.equal(delayedMeasured.streamStartMs, 500);
  await service.renderComicExportSegment(ffmpeg, { shotId: 'delayed', sceneTitle: 'scene', shotTitle: 'delayed', durationFrames: 24,
    videoPath: delayed, videoStartSeconds: delayedMeasured.streamStartMs / 1000, fadeInFrames: 0, fadeOutFrames: 0, transitionIn: 'cut', transitionOut: 'cut',
    volume: 1, preserveVideoAudio: false, placeholder: false },
  { frameRate: 24, canvas: { width: 64, height: 64 } }, 'draft', delayedOutput, new AbortController().signal);
  assert.equal((await probeComicVideoPackets(ffmpeg, delayedOutput)).frames, 24, 'normalize picture timestamps before trimming a delayed stream');
});

function renderProject(assets, patch) {
  const project = createComicProject({ starter: 'storyboard', frameRate: 24, canvas: { aspectRatio: '1:1', width: 64, height: 64 } });
  project.assets = assets;
  project.scenes[0].shots[0] = { ...project.scenes[0].shots[0], dialogueCues: [], transition: 'cut', transitionOutExplicit: true, ...patch };
  return project;
}

class SourceService extends NextMuxPlatformServiceImpl {
  async comicExportAssetPath(_root, asset) { return asset.uri; }
}

function decodedFrame(path) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', '0.05', '-i', path,
    '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
  assert.equal(result.status, 0, result.stderr.toString());
  return [...result.stdout];
}

test('absolute stream origins keep nonzero video in-points, split tail frames, and embedded subtitles aligned', { timeout: 60_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-absolute-video-seek-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const base = join(root, 'base.mp4'), subtitles = join(root, 'captions.srt');
  await writeFile(subtitles, '1\n00:00:00,200 --> 00:00:00,600\nFIRST\n\n2\n00:00:01,200 --> 00:00:01,600\nSECOND\n');
  makeMedia(['-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=24:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=1', '-i', subtitles,
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:s:0', '-c:v', 'libx264', '-c:s', 'mov_text', '-y', base]);
  const positive = join(root, 'positive.mp4'), delayed = join(root, 'delayed.mp4'), fractional = join(root, 'fractional.mp4');
  makeMedia(['-i', base, '-map', '0:v', '-map', '0:s', '-c', 'copy', '-output_ts_offset', '5', '-y', positive]);
  makeMedia(['-itsoffset', '0.5', '-i', base, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-map', '0:v', '-map', '0:s', '-map', '1:a', '-c:v', 'copy', '-c:s', 'copy', '-c:a', 'aac', '-y', delayed]);
  makeMedia(['-itsoffset', '0.166666667', '-i', base, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-y', fractional]);
  const service = new SourceService();
  for (const [name, input, expectedOrigin] of [['positive', positive, 5000], ['delayed', delayed, 500], ['fractional', fractional, 166]]) {
    const measured = await service.probeComicImport(ffmpeg, input, 'video');
    assert.equal(measured.streamStartMs, expectedOrigin);
    for (const [start, frames] of [[24, 24], [36, 12]]) {
      const project = renderProject([{ id: 'video', kind: 'video', status: 'ready', uri: input, durationMs: 2000, streamStartMs: 9999 }],
        { videoAssetId: 'video', durationFrames: frames, mediaSourceStartFrames: { video: start } });
      const prepared = await service.prepareComicExportSources(root, project, { allowPlaceholders: false, verifyAssetIntegrity: false }, ffmpeg, new AbortController().signal);
      const source = prepared.sources[0], output = join(root, `${name}-${start}.mp4`);
      assert.equal(source.videoStartSeconds, expectedOrigin / 1000 + start / 24, 'actual source origin overrides stale project metadata');
      await service.renderComicExportSegment(ffmpeg, source, project, 'draft', output, new AbortController().signal);
      const frame = decodedFrame(output);
      assert.ok(frame[2] > 150 && frame[0] < 40, `${name} source in-point ${start} starts in the blue half: ${frame}`);
      assert.equal((await probeComicVideoPackets(ffmpeg, output)).frames, frames, `${name} tail keeps every requested frame`);
      if (name !== 'fractional') {
        assert.ok(source.embeddedSubtitleCues.some(cue => cue.text === 'SECOND'));
        assert.ok(source.embeddedSubtitleCues.every(cue => cue.text !== 'FIRST'));
      }
    }
  }
});

function amplitude(bytes, frequency) {
  let sine = 0, cosine = 0;
  const count = bytes.length / 4;
  for (let index = 0; index < count; index++) {
    const phase = 2 * Math.PI * frequency * index / 48000;
    sine += bytes.readFloatLE(index * 4) * Math.sin(phase);
    cosine += bytes.readFloatLE(index * 4) * Math.cos(phase);
  }
  return 2 * Math.hypot(sine, cosine) / count;
}

test('delayed selected audio origins align voice, music, effect and their source out-points', { timeout: 60_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-absolute-audio-seek-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tone = join(root, 'tones.wav'), delayed = join(root, 'delayed.mov'), output = join(root, 'audio-segment.mp4');
  makeMedia(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=1',
    '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[a]', '-map', '[a]', '-c:a', 'pcm_s16le', '-y', tone]);
  makeMedia(['-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=24:d=3', '-itsoffset', '0.5', '-i', tone,
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-c:a', 'pcm_s16le', '-y', delayed]);
  const service = new SourceService();
  const measured = await service.probeComicImport(ffmpeg, delayed, 'music');
  assert.deepEqual([measured.durationMs, measured.streamStartMs], [2000, 500]);
  const project = renderProject(['audio', 'music', 'effect'].map(kind => ({ id: kind, kind, status: 'ready', uri: delayed, durationMs: 2000, streamStartMs: 9999 })),
    { durationFrames: 24, audioAssetId: 'audio', musicAssetIds: ['music'], effectAssetIds: ['effect'], mediaSourceStartFrames: { audio: 24, music: 24, effect: 24 } });
  const [source] = (await service.prepareComicExportSources(root, project, { allowPlaceholders: true, verifyAssetIntegrity: false }, ffmpeg, new AbortController().signal)).sources;
  assert.equal(source.audioStartSeconds, 1.5);
  assert.equal(source.musicPaths[0].startSeconds, 1.5);
  assert.equal(source.effectPaths[0].startSeconds, 1.5);
  await service.renderComicExportSegment(ffmpeg, source, project, 'draft', output, new AbortController().signal);
  const decoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', '0.1', '-t', '0.2', '-i', output, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
  assert.equal(decoded.status, 0, decoded.stderr.toString());
  assert.ok(amplitude(decoded.stdout, 880) > 0.08, 'all three tracks seek to the second tone');
  assert.ok(amplitude(decoded.stdout, 440) < 0.005, 'the preceding tone cannot leak in through the container delay');
});

test('native video sound preserves a later soundtrack start and its bounded tail', { timeout: 60_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-native-audio-delay-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, 'source.mov');
  makeMedia(['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=2', '-itsoffset', '0.5', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-c:a', 'pcm_s16le', '-y', input]);
  const service = new SourceService();
  const tone = (output, at) => {
    const decoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(at), '-t', '0.2', '-i', output,
      '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
    assert.equal(decoded.status, 0, decoded.stderr.toString());
    return amplitude(decoded.stdout, 440);
  };
  for (const [start, frames, delay] of [[0, 48, 0.5], [24, 24, 0]]) {
    const project = renderProject([{ id: 'video', kind: 'video', status: 'ready', uri: input, durationMs: 2000 }],
      { videoAssetId: 'video', durationFrames: frames, mediaSourceStartFrames: { video: start } });
    const [source] = (await service.prepareComicExportSources(root, project, { allowPlaceholders: false, verifyAssetIntegrity: false }, ffmpeg, new AbortController().signal)).sources;
    assert.equal(source.nativeAudioDelaySeconds ?? 0, delay);
    const output = join(root, `output-${start}.mp4`);
    await service.renderComicExportSegment(ffmpeg, source, project, 'draft', output, new AbortController().signal);
    if (delay) assert.ok(tone(output, 0.1) < 0.005, 'native sound keeps its original leading silence');
    assert.ok(tone(output, delay ? 0.6 : 0.1) > 0.08, 'native sound keeps its picture-relative position');
    assert.ok(tone(output, delay ? 1.6 : 0.6) < 0.005, 'native source ends before its padded picture tail');
  }
});
