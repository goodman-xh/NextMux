import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { applyComicCommand, createComicProject } from '@nextmux/comic-core';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const ffmpeg = createRequire(import.meta.url)('@ffmpeg-installer/ffmpeg').path;
const signal = () => new AbortController().signal;
const request = { allowPlaceholders: false, verifyAssetIntegrity: false };
const asset = (id, kind, durationMs) => ({ id, kind, status: 'ready', uri: `${id}.${kind === 'video' ? 'mp4' : 'wav'}`,
  ...(durationMs === undefined ? {} : { durationMs }) });

function fixture(patch = {}, assets = []) {
  const project = createComicProject({ starter: 'storyboard', frameRate: 24, canvas: { aspectRatio: '1:1', width: 64, height: 64 } });
  const shot = { ...project.scenes[0].shots[0], durationFrames: 48, dialogueCues: [],
    transitionIn: 'cut', transitionOut: 'cut', ...patch };
  return { ...project, assets, scenes: [{ ...project.scenes[0], shots: [shot] }] };
}

class CapturedService extends NextMuxPlatformServiceImpl {
  commands = [];
  probes = 0;
  durationMs = 2_000;
  async comicExportAssetPath(_root, asset) { return asset.uri; }
  async mediaFileHasAudio() { return false; }
  async extractEmbeddedSubtitleCues() { return []; }
  async probeComicImport() { this.probes++; return { durationMs: this.durationMs }; }
  async runFfmpeg(_path, args) { this.commands.push(args); }
  async verifyComicExportSegmentFrames() {}
}

test('export selects only bounded sound intervals and honors independent track out-points', async () => {
  const service = new CapturedService();
  const project = fixture({ audioAssetId: 'voice', musicAssetIds: ['music'], effectAssetIds: ['effect'],
    mediaSourceStartFrames: { voice: 24, music: 12, effect: 24 }, mediaDurationFrames: { voice: 12, music: 6 } },
    [asset('voice', 'audio', 2_000), asset('music', 'music', 2_000), asset('effect', 'effect', 1_000), asset('still', 'image')]);
  project.scenes[0].shots[0].visualAssetId = 'still';
  const [source] = (await service.prepareComicExportSources('/fixture', project, request, ffmpeg, signal())).sources;
  assert.equal(source.audioStartSeconds, 1);
  assert.equal(source.audioDurationFrames, 12);
  assert.deepEqual(source.musicPaths, [{ path: 'music.wav', startSeconds: 0.5, durationFrames: 6 }]);
  assert.equal(source.effectPaths, undefined, 'an exhausted effect never asks FFmpeg for an empty stream');
  await service.renderComicExportSegment(ffmpeg, source, project, 'draft', 'output.mp4', signal());
  const command = service.commands[0];
  const graph = command[command.indexOf('-filter_complex') + 1];
  assert.match(graph, /atrim=duration=0\.500000,asetpts=PTS-STARTPTS,apad/);
  assert.match(graph, /atrim=duration=0\.250000,asetpts=PTS-STARTPTS,apad/);
  assert.doesNotMatch(graph, /tpad/);
  assert.deepEqual(command.slice(command.indexOf('voice.wav') - 3, command.indexOf('voice.wav') + 1), ['-ss', '1.000000', '-i', 'voice.wav']);
});

test('export rejects past-source videos including the right half of a split and probes legacy durations once', async () => {
  const service = new CapturedService();
  const known = fixture({ videoAssetId: 'video', mediaSourceStartFrames: { video: 24 } }, [asset('video', 'video', 2_000)]);
  await assert.rejects(service.prepareComicExportSources('/fixture', known, request, ffmpeg, signal()), error => error.code === 'COMIC_EXPORT_SOURCE_RANGE_INVALID');
  assert.equal(service.probes, 0, 'stored durations establish the source bounds without a second inventory');
  const legacy = fixture({ videoAssetId: 'video', durationFrames: 24, mediaSourceStartFrames: { video: 24 } }, [asset('video', 'video')]);
  const shot = legacy.scenes[0].shots[0];
  legacy.scenes[0].shots.push({ ...shot, id: 'other-shot' });
  const prepared = await service.prepareComicExportSources('/fixture', legacy, request, ffmpeg, signal());
  assert.equal(prepared.sources.length, 2);
  assert.equal(service.probes, 1, 'source inventory is cached across split halves');
  assert.equal(prepared.sources[0].videoStartSeconds, 1);
  shot.durationFrames = 25;
  await assert.rejects(service.prepareComicExportSources('/fixture', legacy, request, ffmpeg, signal()), error => error.code === 'COMIC_EXPORT_SOURCE_RANGE_INVALID');
});

test('dissolves preserve a short middle shot and subtitle cues intersect real shot bounds', () => {
  const service = new CapturedService();
  const project = fixture({ durationFrames: 24 });
  const first = project.scenes[0].shots[0];
  const second = { ...first, id: 'middle', durationFrames: 8, transitionIn: 'dissolve', transitionOut: 'dissolve',
    dialogueCues: [{ text: 'middle line', startFrame: 0, durationFrames: 8 }] };
  first.transitionOut = 'dissolve';
  first.dialogueCues = [{ text: 'later first line', startFrame: 22, durationFrames: 2 },
    { text: 'past clip', startFrame: 24, durationFrames: 3 }, { text: 'head intersection', startFrame: -2, durationFrames: 3 }];
  project.scenes[0].shots.push(second, { ...first, id: 'last', dialogueCues: [] });
  const sources = project.scenes[0].shots.map(shot => ({ ...shot, shotId: shot.id }));
  const overlaps = service.comicDissolveOverlaps(sources, 24);
  assert.equal((overlaps.get('middle') || 0) + (overlaps.get('last') || 0), 7, 'at least one middle frame belongs to that clip alone');
  const cues = service.comicExportSubtitleCues(project, undefined, overlaps);
  assert.deepEqual(cues.map(cue => [cue.text, cue.startFrame, cue.durationFrames]), [
    ['head intersection', 0, 1], ['middle line', 17, 8], ['later first line', 22, 2]
  ]);
  assert.doesNotMatch(service.comicExportSubtitle(project, 'srt', undefined, overlaps), /past clip/);
});

function run(args) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
  return result.stdout;
}

function amplitude(bytes, frequency) {
  const count = bytes.length / 4;
  let sine = 0, cosine = 0;
  for (let index = 0; index < count; index++) {
    const phase = 2 * Math.PI * frequency * index / 48_000;
    sine += bytes.readFloatLE(index * 4) * Math.sin(phase);
    cosine += bytes.readFloatLE(index * 4) * Math.cos(phase);
  }
  return 2 * Math.hypot(sine, cosine) / count;
}

test('real export keeps authored cuts and zero fades visible through the first and last frame', { timeout: 60_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-export-explicit-cuts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const video = join(root, 'source.mp4');
  run(['-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=30:d=2', '-f', 'lavfi', '-i',
    'sine=frequency=440:sample_rate=48000:duration=2', '-t', (31 / 30).toFixed(6), '-c:v', 'libx264', '-c:a', 'aac', '-y', video]);
  class SourceService extends NextMuxPlatformServiceImpl {
    async comicExportAssetPath(_root, asset) { return asset.uri; }
  }
  const service = new SourceService();
  for (const transition of ['cut', 'fade']) {
    const project = { ...fixture({ videoAssetId: 'source', durationFrames: 31,
      transition: undefined, transitionIn: transition, transitionOut: transition, transitionOutExplicit: undefined,
      fadeInFrames: 0, fadeOutFrames: 0 }, [{ ...asset('source', 'video', 31 * 1000 / 30), uri: video }]), frameRate: 30 };
    const [source] = (await service.prepareComicExportSources(root, project, request, ffmpeg, signal())).sources;
    const output = join(root, `${transition}.mp4`);
    await service.renderComicExportSegment(ffmpeg, source, project, 'draft', output, signal());
    const pixels = run(['-i', output, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
    assert.equal(pixels.length / 3, 31, `${transition}: exact 30fps frame count survives source conversion`);
    for (const frame of [0, 30]) {
      assert.ok(pixels[frame * 3] > 180 && pixels[frame * 3 + 1] < 40 && pixels[frame * 3 + 2] < 40,
        `${transition}: authored zero fade must not darken boundary frame ${frame}`);
    }
    const sound = run(['-ss', '0.015', '-t', '0.05', '-i', output, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
    const level = amplitude(sound, 440);
    assert.ok(level > 0.08, `${transition}: zero fade keeps native audio audible from the start (${level})`);
  }
});

test('real split and trim preserve native audio and music source intervals without replaying the music tail', { timeout: 60_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-export-split-mix-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const video = join(root, 'source.mp4'), music = join(root, 'music.wav');
  run(['-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=24:d=4',
    '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=2',
    '-filter_complex', '[1:a][2:a]concat=n=2:v=0:a=1[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-c:a', 'aac', '-y', video]);
  run(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=2',
    '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[a]', '-map', '[a]', '-c:a', 'pcm_s16le', '-y', music]);
  let project = fixture({ videoAssetId: 'source', musicAssetIds: ['music'], durationFrames: 96,
    mediaDurationFrames: { music: 72 }, fadeInFrames: 0, fadeOutFrames: 0 },
    [{ ...asset('source', 'video', 4_000), uri: video }, { ...asset('music', 'music', 4_000), uri: music }]);
  const sceneId = project.scenes[0].id, shotId = project.scenes[0].shots[0].id;
  project = applyComicCommand(project, { type: 'shot.trim_start', sceneId, shotId, frames: 12, expectedRevision: project.revision });
  project = applyComicCommand(project, { type: 'shot.split', sceneId, shotId, splitAtFrame: 36, expectedRevision: project.revision });
  class SourceService extends NextMuxPlatformServiceImpl {
    async comicExportAssetPath(_root, asset) { return asset.uri; }
  }
  const service = new SourceService();
  const { sources } = await service.prepareComicExportSources(root, project, request, ffmpeg, signal());
  assert.equal(sources.length, 2);
  for (const [index, source] of sources.entries()) {
    const output = join(root, `${index}.mp4`);
    await service.renderComicExportSegment(ffmpeg, source, project, 'draft', output, signal());
    const sound = start => run(['-ss', String(start), '-t', '0.2', '-i', output, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
    const head = sound(0.2);
    const expected = index === 0 ? [330, 440] : [660, 880];
    const absent = index === 0 ? [660, 880] : [330, 440];
    for (const frequency of expected) assert.ok(amplitude(head, frequency) > 0.08, `part ${index} keeps ${frequency}Hz source audio`);
    for (const frequency of absent) assert.ok(amplitude(head, frequency) < 0.003, `part ${index} must not replay ${frequency}Hz from another source interval`);
    if (index === 1) {
      const tail = sound(1.3);
      assert.ok(amplitude(tail, 660) > 0.08, 'native audio continues through the right clip');
      assert.ok(amplitude(tail, 880) < 0.001, 'authored music out-point remains silent after trimming and splitting');
    }
  }
});

test('real rendering seeks the right split video frames and ends trimmed audio before the shot', { timeout: 60_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-export-timing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const video = join(root, 'source.mp4'), tone = join(root, 'tone.wav'), output = join(root, 'segment.mp4');
  run(['-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=24:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=1',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-y', video]);
  run(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-c:a', 'pcm_s16le', '-y', tone]);
  const project = fixture();
  const service = new NextMuxPlatformServiceImpl();
  class SourceService extends NextMuxPlatformServiceImpl {
    async comicExportAssetPath(_root, asset) { return asset.uri; }
  }
  const staleMetadata = fixture({ videoAssetId: 'source', durationFrames: 72 }, [{ ...asset('source', 'video', 4_000), uri: video }]);
  await assert.rejects(new SourceService().prepareComicExportSources(root, staleMetadata, request, ffmpeg, signal()),
    error => error.code === 'COMIC_EXPORT_SOURCE_RANGE_INVALID', 'actual video bytes take precedence over overstated metadata');
  await service.renderComicExportSegment(ffmpeg, { shotId: 'right', sceneTitle: 'scene', shotTitle: 'right', durationFrames: 24,
    videoPath: video, videoStartSeconds: 1, audioPath: tone, audioStartSeconds: 1, audioDurationFrames: 12,
    fadeInFrames: 0, fadeOutFrames: 0, transitionIn: 'cut', transitionOut: 'cut', volume: 1,
    preserveVideoAudio: false, placeholder: false }, project, 'draft', output, signal());
  const frame = [...run(['-ss', '0.2', '-i', output, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])];
  assert.ok(frame[2] > 150 && frame[0] < 40, `right half starts with blue source frames: ${frame}`);
  const sound = start => run(['-ss', String(start), '-t', '0.2', '-i', output, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
  assert.ok(amplitude(sound(0.2), 440) > 0.035, 'voice plays from its source in-point');
  assert.ok(amplitude(sound(0.7), 440) < 0.001, 'explicit voice out-point leaves silence');
  const frames = run(['-i', output, '-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
  assert.equal(frames.length / (64 * 64 * 3), 24, 'the rendered split half has its exact frame length');
});

test('real chained dissolve render preserves the short middle clip and the shared timeline frame count', { timeout: 60_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-export-short-dissolve-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = fixture();
  const service = new NextMuxPlatformServiceImpl();
  const sources = [], segments = [];
  for (const [index, color] of ['red', 'blue', 'lime'].entries()) {
    const image = join(root, `${color}.png`), output = join(root, `${color}.mp4`);
    run(['-f', 'lavfi', '-i', `color=c=${color}:s=64x64`, '-frames:v', '1', '-y', image]);
    const source = { shotId: `shot-${index}`, sceneTitle: 'scene', shotTitle: color, durationFrames: index === 1 ? 8 : 24,
      imagePath: image, fadeInFrames: 0, fadeOutFrames: 0,
      transitionIn: index > 0 ? 'dissolve' : 'cut', transitionOut: index < 2 ? 'dissolve' : 'cut',
      volume: 1, preserveVideoAudio: false, placeholder: false };
    sources.push(source);
    await service.renderComicExportSegment(ffmpeg, source, project, 'draft', output, signal());
    segments.push(output);
  }
  const overlaps = service.comicDissolveOverlaps(sources, 24);
  const output = join(root, 'dissolve.mp4');
  await service.renderComicDissolveTimeline(ffmpeg, segments, sources, overlaps, project, 'draft', output, signal());
  const bytes = run(['-i', output, '-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
  assert.equal(bytes.length / (64 * 64 * 3), 49, '24 + 8 + 24 minus the shared seven-frame overlap');
  const middle = [...run(['-ss', '0.98', '-i', output, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])];
  assert.ok(middle[2] > 150 && middle[0] < 40 && middle[1] < 40, `one pure blue middle frame survives: ${middle}`);
});
