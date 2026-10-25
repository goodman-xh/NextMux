import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative } from 'node:path';
import { Module, createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Exercise current service source without emitting the shared extension while other work is in progress.
const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const ts = require('typescript');
const filename = join(packageRoot, 'lib/node/nextmux-platform-service.js');
const source = await readFile(join(packageRoot, 'src/node/nextmux-platform-service.ts'), 'utf8');
const options = ts.convertCompilerOptionsFromJson(JSON.parse(await readFile(join(packageRoot, 'tsconfig.json'), 'utf8')).compilerOptions, packageRoot).options;
function loadCurrentModule(moduleFilename, text) {
  const loaded = new Module(moduleFilename);
  loaded.filename = moduleFilename;
  loaded.paths = Module._nodeModulePaths(dirname(moduleFilename));
  const compiledRequire = loaded.require.bind(loaded);
  loaded.require = specifier => {
    if (specifier.startsWith('.')) {
      const compiledPath = resolve(dirname(moduleFilename), specifier.replace(/\.js$/, '') + '.js');
      const sourcePath = join(packageRoot, 'src', relative(join(packageRoot, 'lib'), compiledPath)).replace(/\.js$/, '.ts');
      // New sibling helpers may not be emitted yet; compile those in memory too.
      if ((!existsSync(compiledPath) || /^\.\/nextmux-comic-(?:composition-export|subtitle-reader|media-probe|font-metrics)$/.test(specifier)) && existsSync(sourcePath)) return loadCurrentModule(compiledPath, readFileSync(sourcePath, 'utf8')).exports;
    }
    return compiledRequire(specifier);
  };
  loaded._compile(ts.transpileModule(text, { fileName: moduleFilename.replace('/lib/', '/src/').replace(/\.js$/, '.ts'), compilerOptions: options }).outputText, moduleFilename);
  return loaded;
}
const loaded = loadCurrentModule(filename, source);
const { NextMuxPlatformServiceImpl } = loaded.exports;
const { createCanvasDocument, applyCanvasCommand } = require('@nextmux/comic-core');
const { probeComicVideoPackets } = require('../lib/node/nextmux-comic-media-probe.js');
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function run(args) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
  return result.stdout;
}
function amplitude(bytes, frequency) {
  let sine = 0, cosine = 0;
  const count = bytes.length / 4;
  for (let index = 0; index < count; index++) {
    const phase = 2 * Math.PI * frequency * index / 48_000;
    sine += bytes.readFloatLE(index * 4) * Math.sin(phase);
    cosine += bytes.readFloatLE(index * 4) * Math.cos(phase);
  }
  return 2 * Math.hypot(sine, cosine) / count;
}

test('full video/video/still exports retain the exact timeline origin and frame boundaries in every subtitle mode', { timeout: 120_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-export-concat-clock-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const workspaceRoot = join(root, 'workspace');
  await mkdir(workspaceRoot);
  class Service extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return join(root, 'profile'); }
    async getMediaRuntimeState() { return { ffmpeg: { available: true, path: ffmpeg, source: 'bundled', message: '' },
      comfyUi: { configured: false, available: false, source: 'missing', message: '' } }; }
  }
  const service = new Service(), files = [];
  for (const color of ['red', 'blue']) {
    const path = join(root, `${color}.mp4`);
    run(['-f', 'lavfi', '-i', `color=c=${color}:s=160x90:r=24:d=4`, '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=4',
      '-map', '0:v', '-map', '1:a', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      ...(color === 'blue' ? ['-output_ts_offset', '5'] : []), '-y', path]);
    files.push(path);
  }
  const still = join(root, 'still.png'), music = join(root, 'music.wav');
  run(['-f', 'lavfi', '-i', 'color=c=lime:s=160x90', '-frames:v', '1', '-y', still]);
  run(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', '-c:a', 'pcm_s16le', '-y', music]);
  await service.createComicProject({ workspaceRoot, title: 'Exact concat clock', starter: 'empty', frameRate: 24,
    canvas: { aspectRatio: '16:9', width: 160, height: 90 } });
  const imported = await service.importComicMedia({ workspaceRoot, paths: [...files, still, music] });
  const project = imported.state.project;
  const [first, second, image, sound] = imported.sources.map(id => project.assets.find(asset => asset.id === id));
  assert.equal(first.streamStartMs ?? 0, 0);
  assert.equal(second.streamStartMs, 5_000, 'a nonzero source origin is normalized before the export timeline is assembled');
  const nodes = [first, second].map((asset, index) => {
    const version = { id: `video-v${index}`, assetId: asset.id, kind: 'video', uri: asset.uri, createdAt: asset.createdAt, status: 'ready',
      metadata: { width: asset.width, height: asset.height, durationMs: asset.durationMs, byteLength: asset.byteLength, sha256: asset.sha256 } };
    return { id: `node-${index}`, kind: 'video', title: `Video ${index}`, position: { x: index * 400, y: 0 }, size: { width: 320, height: 180 },
      payload: { versions: [version], currentVersionId: version.id } };
  });
  const canvas = applyCanvasCommand({ ...createCanvasDocument({ id: 'canvas-exact-concat-clock', projectId: project.id }), nodes },
    { type: 'sequence.connect', link: { id: 'sequence-clock', sourceNodeId: 'node-0', targetNodeId: 'node-1' } });
  const saved = await service.saveComicCanvas({ workspaceRoot, canvas, expectedRevision: 0 });
  let timeline = await service.createComicCanvasTimeline({ workspaceRoot, canvasId: canvas.id, expectedCanvasRevision: saved.canvas.revision, requestId: 'exact-concat-clock-0001' });
  const sceneId = timeline.project.scenes[0].id;
  const shots = timeline.project.scenes[0].shots.map(shot => ({ sceneId, shotId: shot.id }));
  timeline = (await service.applyComicCanvasTimelineEdits({ workspaceRoot, timelineId: timeline.id, expectedRevision: timeline.revision, edits: [
    { type: 'insert_clips', assetIds: [image.id], imageSeconds: 2 }, { type: 'place_audio', assetId: sound.id, role: 'music', shots },
    ...shots.map((shot, index) => ({ type: 'command', command: { type: 'dialogue.replace', ...shot, cues: [{ text: `Subtitle ${index}`, startFrame: 12, durationFrames: 72 }] } })),
  ] })).timeline;
  for (const subtitleMode of ['none', 'embedded', 'burned']) await t.test(subtitleMode, async () => {
    const started = await service.startComicExport({ workspaceRoot, timelineId: timeline.id, expectedTimelineRevision: timeline.revision,
      canvasId: canvas.id, fileName: subtitleMode, quality: 'draft', subtitleMode, allowPlaceholders: false, verifyAssetIntegrity: true });
    await service.comicExports.get(started.id).completion;
    const item = (await service.getComicExportWorkspaceState(workspaceRoot)).exports.find(item => item.id === started.id);
    assert.equal(item.status, 'completed', item.error);
    const output = join(workspaceRoot, item.output.relativeUri);
    const timing = await probeComicVideoPackets(ffmpeg, output);
    assert.deepEqual(timing, { durationMs: 10_000, frames: 240, streamStartMs: 0 }, 'AAC preroll must not shift video or add a frame during subtitle encoding');
    const pixels = run(['-i', output, '-vf', 'scale=1:1', '-vsync', '0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
    assert.equal(pixels.length, 240 * 3);
    for (const [frame, component] of [[0, 0], [95, 0], [96, 2], [191, 2], [192, 1], [239, 1]]) {
      assert.ok(pixels[frame * 3 + component] > 170, `frame ${frame} retains its authored red/blue/green boundary`);
    }
    for (const time of [0.05, 3.7, 4.05, 7.7, 9]) {
      const pcm = run(['-ss', String(time), '-t', '0.2', '-i', output, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
      for (const frequency of [330, 440]) assert.ok(time < 8 ? amplitude(pcm, frequency) > 0.035 : amplitude(pcm, frequency) < 0.001,
        `${frequency}Hz audio at ${time}s matches the timeline`);
    }
  });
});

test('real canvas timeline exports reject lost audio, preserve intended sound and compare the selected timeline revision', { timeout: 120_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-export-audio-integrity-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const workspaceRoot = join(root, 'workspace');
  await mkdir(workspaceRoot);
  class Service extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return join(root, 'profile'); }
    async getMediaRuntimeState() { return { ffmpeg: { available: true, path: ffmpeg, source: 'bundled', message: '' },
      comfyUi: { configured: false, available: false, source: 'missing', message: '' } }; }
    async renderComicExportSegment(...args) {
      await super.renderComicExportSegment(...args);
      const afterSegment = this.afterSegment;
      this.afterSegment = undefined;
      await afterSegment?.();
    }
  }
  const service = new Service();
  const videoPath = join(root, 'video.mp4');
  run(['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=2', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=2',
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '2', '-y', videoPath]);
  const tonePaths = [440, 660, 880].map(frequency => {
    const path = join(root, `tone-${frequency}.wav`);
    run(['-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000:duration=2`, '-c:a', 'pcm_s16le', '-y', path]);
    return path;
  });
  const originalHashes = await Promise.all([videoPath, ...tonePaths].map(async path => [path, digest(await readFile(path))]));
  await service.createComicProject({ workspaceRoot, title: 'Isolated audio integrity', starter: 'empty', frameRate: 24,
    canvas: { aspectRatio: '16:9', width: 320, height: 180 } });
  const imported = await service.importComicMedia({ workspaceRoot, paths: [videoPath, ...tonePaths] });
  const project = imported.state.project;
  const [video, music, voice, effect] = imported.sources.map(id => project.assets.find(asset => asset.id === id));
  const version = { id: 'video-v1', assetId: video.id, kind: 'video', uri: video.uri, createdAt: video.createdAt, status: 'ready',
    metadata: { width: video.width, height: video.height, durationMs: video.durationMs, byteLength: video.byteLength, sha256: video.sha256 } };
  const canvas = { ...createCanvasDocument({ id: 'canvas-audio-integrity', projectId: project.id }), nodes: [
    { id: 'video-node', kind: 'video', title: 'Source clip', position: { x: 0, y: 0 }, size: { width: 320, height: 180 }, payload: { versions: [version], currentVersionId: version.id } },
  ] };
  const saved = await service.saveComicCanvas({ workspaceRoot, canvas, expectedRevision: 0 });
  let timeline = await service.createComicCanvasTimeline({ workspaceRoot, canvasId: canvas.id, expectedCanvasRevision: saved.canvas.revision, requestId: 'audio-integrity-0001' });
  const sceneId = timeline.project.scenes[0].id, shotId = timeline.project.scenes[0].shots[0].id;
  const references = [{ sceneId, shotId }];
  const edit = async edits => {
    timeline = (await service.applyComicCanvasTimelineEdits({ workspaceRoot, timelineId: timeline.id, expectedRevision: timeline.revision, edits })).timeline;
  };
  const command = command => edit([{ type: 'command', command: { sceneId, shotId, ...command } }]);
  const results = [];
  async function exported(label, patch = {}) {
    const started = await service.startComicExport({ workspaceRoot, timelineId: timeline.id, expectedTimelineRevision: timeline.revision,
      canvasId: canvas.id, fileName: label, quality: 'draft', subtitleMode: 'none', allowPlaceholders: false, verifyAssetIntegrity: true, ...patch });
    const completion = service.comicExports.get(started.id)?.completion;
    assert.ok(completion, 'the actual background export completion is tracked');
    await completion;
    const item = (await service.getComicExportWorkspaceState(workspaceRoot)).exports.find(item => item.id === started.id);
    assert.ok(item);
    results.push({ label, status: item.status, warnings: item.warningInfos, error: item.error });
    if (item.status !== 'completed') {
      assert.equal(item.output, undefined, 'a failed export must not advertise a partial output');
      const files = await readdir(join(workspaceRoot, 'nextmux.media/exports'));
      assert.ok(files.every(file => !file.includes(started.id) && !file.includes(started.id.slice(-8))), 'failed MP4 and temporary files are cleaned');
    }
    return item;
  }
  function audio(item) {
    const path = join(workspaceRoot, item.output.relativeUri);
    run(['-i', path, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
    const raw = run(['-i', path, '-map', '0:v:0', '-vf', 'scale=1:1', '-vsync', '0', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
    assert.equal(raw.length / 3, 48, 'the complete output retains 48 video frames');
    assert.deepEqual([item.output.width, item.output.height, item.output.frameRate, item.output.durationSeconds], [320, 180, 24, 2]);
    return run(['-ss', '0.25', '-t', '1', '-i', path, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
  }
  const noRevisionWarning = item => assert.ok(!(item.warningInfos || []).some(w => w.code === 'MEDIA_REVISION_WARNING'), JSON.stringify(item.warningInfos));

  await edit([{ type: 'place_audio', assetId: music.id, role: 'music', shots: references }]);
  await t.test('normal native soundtrack and arranged music survive a full final MP4', async () => {
    assert.notEqual(project.revision, timeline.revision, 'main project and independent edit revisions intentionally differ');
    assert.deepEqual(await new Service().getComicCanvasTimeline(workspaceRoot, timeline.id), timeline);
    const item = await exported('native-and-music');
    assert.equal(item.status, 'completed', item.error);
    noRevisionWarning(item);
    const pcm = audio(item);
    assert.ok(amplitude(pcm, 330) > 0.035);
    assert.ok(amplitude(pcm, 440) > 0.035);
    t.diagnostic(`normal native330=${amplitude(pcm, 330)} music440=${amplitude(pcm, 440)}`);
  });

  await edit([{ type: 'place_audio', assetId: voice.id, role: 'audio', shots: references },
    { type: 'place_audio', assetId: effect.id, role: 'effect', shots: references }]);
  await t.test('voice replaces native sound while music and effects remain in the final mix', async () => {
    const item = await exported('voice-music-effect');
    assert.equal(item.status, 'completed', item.error);
    const pcm = audio(item);
    for (const frequency of [440, 660, 880]) assert.ok(amplitude(pcm, frequency) > 0.035, `missing ${frequency}Hz`);
    assert.ok(amplitude(pcm, 330) < 0.005, 'the voice track preserves the existing replacement contract');
  });

  for (const [kind, importedAsset] of [['music', music], ['audio', voice], ['effect', effect]]) {
    const path = join(workspaceRoot, importedAsset.uri), bytes = await readFile(path);
    for (const condition of ['missing', 'changed']) {
      await t.test(`strict ${condition} ${kind} fails instead of completing or falling back to native sound`, async () => {
        try {
          if (condition === 'missing') await rm(path);
          else run(['-f', 'lavfi', '-i', 'sine=frequency=990:sample_rate=48000:duration=2', '-c:a', 'pcm_s16le', '-y', path]);
          const item = await exported(`${condition}-${kind}`);
          assert.equal(item.status, 'failed', JSON.stringify(item));
          assert.equal(item.errorInfo.code, condition === 'changed' ? 'COMIC_EXPORT_ASSET_CHANGED' : `COMIC_EXPORT_${kind.toUpperCase()}_UNAVAILABLE`);
          if (condition === 'changed') assert.equal(item.errorInfo.messageKey, 'platform_media.asset_changed');
        } finally { await writeFile(path, bytes); }
      });
    }
  }

  await t.test('explicit permissive export retains its warning behavior', async () => {
    const path = join(workspaceRoot, music.uri), bytes = await readFile(path);
    try {
      await rm(path);
      const item = await exported('permissive', { allowPlaceholders: true });
      assert.equal(item.status, 'completed', item.error);
      assert.ok(item.warningInfos.some(w => w.code === 'MEDIA_MUSIC_UNAVAILABLE'));
      const pcm = audio(item);
      assert.ok(amplitude(pcm, 440) < 0.005);
      for (const frequency of [660, 880]) assert.ok(amplitude(pcm, frequency) > 0.035);
    } finally { await writeFile(path, bytes); }
  });

  await t.test('volume zero intentionally exports silence despite unavailable arranged audio and dialogue', async () => {
    await command({ type: 'shot.update', patch: { volume: 0 } });
    await command({ type: 'dialogue.replace', cues: [{ text: 'Intentionally muted', startFrame: 0, durationFrames: 24 }] });
    const tracks = await Promise.all([music, voice, effect].map(async asset => [join(workspaceRoot, asset.uri), await readFile(join(workspaceRoot, asset.uri))]));
    try {
      for (const [path] of tracks) await rm(path);
      const item = await exported('intentional-mute');
      assert.equal(item.status, 'completed', item.error);
      const pcm = audio(item);
      for (const frequency of [330, 440, 660, 880]) assert.ok(amplitude(pcm, frequency) < 0.001);
    } finally { for (const [path, bytes] of tracks) await writeFile(path, bytes); }
  });

  await t.test('removed tracks are not required and native audio remains the fallback', async () => {
    await command({ type: 'shot.update', patch: { volume: 1 } });
    for (const slot of ['audio', 'music', 'effect']) await command({ type: 'media.detach', slot });
    const path = join(workspaceRoot, music.uri), bytes = await readFile(path);
    try {
      await rm(path);
      const item = await exported('removed-tracks');
      assert.equal(item.status, 'completed', item.error);
      noRevisionWarning(item);
      const pcm = audio(item);
      assert.ok(amplitude(pcm, 330) > 0.035);
      for (const frequency of [440, 660, 880]) assert.ok(amplitude(pcm, frequency) < 0.005);
    } finally { await writeFile(path, bytes); }
  });

  await t.test('main-project-only changes during a timeline export do not create revision warnings', async () => {
    const before = (await (await service.comicProjectStore(workspaceRoot)).read()).project;
    const timelineRevision = timeline.revision;
    service.afterSegment = async () => {
      const changed = await service.applyComicCommand({ workspaceRoot, command: { type: 'project.update', expectedRevision: before.revision, patch: { title: 'Main project changed during export' } } });
      assert.equal(changed.project.revision, before.revision + 1);
    };
    const item = await exported('main-project-changed');
    assert.equal(item.status, 'completed', item.error);
    noRevisionWarning(item);
    assert.equal((await service.getComicCanvasTimeline(workspaceRoot, timeline.id)).revision, timelineRevision);
  });
  await t.test('a real edit to the selected timeline during rendering still creates its revision warning', async () => {
    const frozenRevision = timeline.revision;
    service.afterSegment = () => command({ type: 'shot.update', patch: { title: 'Changed during rendering' } });
    const item = await exported('timeline-changed');
    assert.equal(item.status, 'completed', item.error);
    const warning = item.warningInfos.find(w => w.code === 'MEDIA_REVISION_WARNING');
    assert.ok(warning, JSON.stringify(item.warningInfos));
    assert.deepEqual(warning.params, { current: frozenRevision + 1, exported: frozenRevision });
  });
  assert.deepEqual(await new Service().getComicCanvasTimeline(workspaceRoot, timeline.id), timeline);
  for (const [path, hash] of originalHashes) assert.equal(digest(await readFile(path)), hash, 'original fixture inputs stay unchanged');
  t.diagnostic(JSON.stringify({ ffmpeg, serviceSourceSha256: digest(source), results }));
});
