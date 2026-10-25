import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire, Module } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url), ts = require('typescript');
const packageRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const modules = new Map();
function source(name) {
  if (modules.has(name)) return modules.get(name).exports;
  const filename = join(packageRoot, 'lib/node', `${name}.js`), module = new Module(filename);
  module.filename = filename; module.paths = Module._nodeModulePaths(dirname(filename)); modules.set(name, module);
  const compiledRequire = module.require.bind(module);
  module.require = id => id.startsWith('./nextmux-comic-composition-export') || id.startsWith('./nextmux-comic-subtitle-reader') || id.startsWith('./nextmux-comic-media-probe') || id.startsWith('./nextmux-comic-font-metrics')
    ? source(id.slice(2).replace(/\.js$/, '')) : compiledRequire(id);
  module._compile(ts.transpileModule(readFileSync(join(packageRoot, 'src/node', `${name}.ts`), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true }
  }).outputText, filename);
  return module.exports;
}
const { NextMuxPlatformServiceImpl } = source('nextmux-platform-service');
const { comicCompositionPropertyExpression, prepareComicCompositionExport, renderComicCompositionExport } = source('nextmux-comic-composition-export');
const { readComicSubtitleCues } = source('nextmux-comic-subtitle-reader');
const { resolveComicFontMetrics } = source('nextmux-comic-font-metrics');
const { probeComicVideoPackets } = source('nextmux-comic-media-probe');
const { evaluateComicCompositionClip } = require('@nextmux/comic-core/composition');
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;
function run(args) {
  const p = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(p.status, 0, p.stderr?.toString() || p.error?.message); return p.stdout;
}
function amplitude(bytes, frequency) {
  let sin = 0, cos = 0; const count = bytes.length / 4;
  for (let i = 0; i < count; i++) { const a = 2 * Math.PI * frequency * i / 48000; sin += bytes.readFloatLE(i * 4) * Math.sin(a); cos += bytes.readFloatLE(i * 4) * Math.cos(a); }
  return 2 * Math.hypot(sin, cos) / count;
}
test('FFmpeg interpolation matches the shared preview for every easing, cropped key interval and retained fade envelope', () => {
  const properties = ['x', 'y', 'scale', 'rotation', 'opacity', 'volume', 'brightness'];
  for (const easing of ['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold']) for (const legacyFadeToBlack of [false, true]) {
    const clip = { id: 'clip', trackId: 'track', kind: 'image', from: 0, durationFrames: 48, sourceStartFrames: 0,
      legacyFadeToBlack,
      envelope: { durationFrames: 60, offsetFrames: 6, fadeInFrames: 20, fadeOutFrames: 20, audioFadeInFrames: 10, audioFadeOutFrames: 20, dissolveInFrames: 8, dissolveOutFrames: 15,
        fadeInStartFrame: 6, fadeOutEndFrame: 54, audioFadeInStartFrame: 8, audioFadeOutEndFrame: 51 },
      keyframes: properties.filter(property => property !== 'brightness').flatMap(property => [{ property, frame: 5, value: 0.2, easing, easingStart: 0.2, easingEnd: 0.8 }, { property, frame: 40, value: 0.8, easing: 'linear' }]) };
    for (const frame of [0, 4, 5, 5.1, 12, 24, 39.9, 40, 47]) for (const property of properties) {
      for (const range of [undefined, { from: frame, end: frame + 1 }]) {
        const expression = comicCompositionPropertyExpression(clip, property, 'N', range).replaceAll('if(', 'choose(');
        const evaluate = new Function('N', 'min', 'max', 'pow', 'lt', 'lte', 'choose', `return ${expression};`);
        const actual = evaluate(frame, Math.min, Math.max, Math.pow, (a,b)=>a<b, (a,b)=>a<=b, (p,a,b)=>p?a:b);
        assert.ok(Math.abs(actual - evaluateComicCompositionClip(clip, frame)[property]) < 1e-8, `${easing}/${property}/${frame}: ${actual}`);
      }
    }
  }
});

test('real free-track export composites animation, independent sound, subtitles and strict source integrity', { timeout: 120_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-composition-export-'));
  if (process.env.COMIC_EXPORT_KEEP_FIXTURES) console.info(`Composition fixtures: ${root}`);
  else t.after(() => rm(root, { recursive: true, force: true }));
  const workspaceRoot = join(root, 'project'); await mkdir(workspaceRoot);
  const video = join(root, 'base.mp4'), image = join(root, 'overlay.png'), audio = join(root, 'sound.wav'), subtitles = join(root, 'source.srt'), captioned = join(root, 'captioned.mp4');
  run(['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=2', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=2', '-t', '2', '-c:v', 'libx264', '-c:a', 'aac', '-output_ts_offset', '5', '-y', video]);
  run(['-f', 'lavfi', '-i', 'color=c=red:s=64x32', '-frames:v', '1', '-y', image]);
  run(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=1',
    '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[a]', '-map', '[a]', '-c:a', 'pcm_s16le', '-y', audio]);
  await writeFile(subtitles, '1\n00:00:00,000 --> 00:00:00,500\nOMITTED\n\n2\n00:00:00,500 --> 00:00:01,000\nKEPT\n');
  run(['-i', video, '-i', subtitles, '-map', '0:v', '-map', '0:a', '-map', '1:s', '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text', '-output_ts_offset', '5', '-y', captioned]);
  class Service extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return join(root, 'profile'); }
    async getMediaRuntimeState() { return { ffmpeg: { available: true, path: ffmpeg, source: 'bundled' }, comfyUi: { configured: false, available: false, source: 'missing' } }; }
  }
  const service = new Service();
  await service.createComicProject({ workspaceRoot, title: 'Independent tracks', starter: 'empty', frameRate: 24, canvas: { aspectRatio: '1:1', width: 64, height: 64 } });
  const imported = await service.importComicMedia({ workspaceRoot, paths: [video, image, audio, captioned] });
  assert.deepEqual(imported.skipped, []);
  let project = imported.state.project; const [v, i, a, captionedId] = imported.sources;
  const s = 'asset-composition-test-subtitles', subtitleBytes = await readFile(subtitles), subtitleUri = 'nextmux.media/imports/source.srt';
  await writeFile(join(workspaceRoot, subtitleUri), subtitleBytes);
  project = (await service.applyComicEdits({ workspaceRoot, expectedRevision: project.revision, edits: [{ type: 'command', command: { type: 'asset.import', asset: {
    id: s, kind: 'subtitle', uri: subtitleUri, mimeType: 'application/x-subrip', byteLength: subtitleBytes.length,
    sha256: createHash('sha256').update(subtitleBytes).digest('hex'), jobId: 'media-job-11111111-1111-1111-1111-111111111111', provider: 'Local fixture', model: 'SRT', source: 'imported'
  } } }] })).state.project;
  const composition = { schemaVersion: 1, tracks: [
    { id: 'video', title: 'Base', kind: 'video' }, { id: 'overlay', title: 'Overlay', kind: 'video' },
    { id: 'sound', title: 'Sound', kind: 'audio' }, { id: 'text', title: 'Text', kind: 'text' }
  ], clips: [
    { id: 'base', trackId: 'video', kind: 'video', assetId: v, from: 0, durationFrames: 48, sourceStartFrames: 0 },
    { id: 'overlay', trackId: 'overlay', kind: 'image', assetId: i, from: 12, durationFrames: 24, sourceStartFrames: 0, transform: { scale: 0.5 },
      keyframes: [{ property: 'x', frame: 0, value: -16, easing: 'linear' }, { property: 'x', frame: 24, value: 16, easing: 'linear' },
        { property: 'rotation', frame: 0, value: 0, easing: 'linear' }, { property: 'rotation', frame: 24, value: 90, easing: 'linear' },
        { property: 'opacity', frame: 0, value: 0.25, easing: 'linear' }, { property: 'opacity', frame: 24, value: 0.75, easing: 'linear' }] },
    { id: 'sound', trackId: 'sound', kind: 'audio', assetId: a, from: 12, durationFrames: 24, sourceStartFrames: 24,
      keyframes: [{ property: 'volume', frame: 0, value: 0, easing: 'linear' }, { property: 'volume', frame: 24, value: 1, easing: 'linear' }] },
    { id: 'title', trackId: 'text', kind: 'text', purpose: 'title', text: 'TITLE', from: 36, durationFrames: 12, sourceStartFrames: 0,
      transform: { y: 22 }, textStyle: { fontSize: 9, bold: true } },
    { id: 'caption', trackId: 'text', kind: 'text', purpose: 'subtitle', text: 'CAPTION', from: 0, durationFrames: 12, sourceStartFrames: 0,
      transform: { y: -22 }, textStyle: { fontSize: 9 } }
  ] };
  const edit = async operation => { project = (await service.applyComicEdits({ workspaceRoot, expectedRevision: project.revision, edits: [{ type: 'composition', operation }] })).state.project; };
  await edit({ type: 'replace', composition });
  assert.equal(project.scenes.length, 0, 'composition export must work without legacy shots');
  async function exported(mode = 'burned') {
    const started = await service.startComicExport({ workspaceRoot, quality: 'draft', subtitleMode: mode, allowPlaceholders: false, verifyAssetIntegrity: true });
    await service.comicExports.get(started.id).completion;
    return (await service.getComicExportWorkspaceState(workspaceRoot)).exports.find(item => item.id === started.id);
  }
  const item = await exported(); assert.equal(item.status, 'completed', JSON.stringify(item));
  const output = join(workspaceRoot, item.output.relativeUri), decoded = run(['-i', output, '-vsync', '0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
  assert.deepEqual(await probeComicVideoPackets(ffmpeg, output), { frames: 48, durationMs: 2000, streamStartMs: 0 });
  const pixel = (frame, x, y) => [...decoded.subarray((frame * 64 * 64 + y * 64 + x) * 3, (frame * 64 * 64 + y * 64 + x) * 3 + 3)];
  const middle = pixel(24, 32, 32);
  assert.ok(middle[0] > 100 && middle[0] < 155 && middle[2] > 100 && middle[2] < 155, `half-opacity middle animation: ${middle}`);
  assert.ok(pixel(12, 8, 32)[0] > 35, 'moving overlay begins left of center');
  assert.ok(pixel(35, 8, 32)[0] < 20, 'moving/rotating overlay vacates the left-hand pixel');
  const pcm = time => run(['-ss', String(time), '-t', '0.15', '-i', output, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
  for (const time of [0.2, 1, 1.7]) assert.ok(amplitude(pcm(time), 330) > 0.035, 'native video audio survives independently');
  assert.ok(amplitude(pcm(0.2), 880) < 0.005); assert.ok(amplitude(pcm(1.7), 880) < 0.005);
  assert.ok(amplitude(pcm(1), 880) > 0.03 && amplitude(pcm(1), 880) < 0.1, 'independent source offset selects the second tone and applies animated volume');
  assert.ok(amplitude(pcm(1), 440) < 0.005, 'the trimmed-off first tone never leaks into export');
  assert.match(await readFile(join(workspaceRoot, item.output.subtitleRelativeUri), 'utf8'), /CAPTION/);
  assert.doesNotMatch(await readFile(join(workspaceRoot, item.output.subtitleRelativeUri), 'utf8'), /TITLE/);
  await t.test('embedded subtitles remain optional while free text remains in the picture', async () => {
    const result = await exported('embedded'); assert.equal(result.status, 'completed', result.error);
    const path = join(workspaceRoot, result.output.relativeUri);
    assert.equal((await probeComicVideoPackets(ffmpeg, path)).frames, 48);
    assert.match(run(['-i', path, '-map', '0:s:0', '-c:s', 'srt', '-f', 'srt', 'pipe:1']).toString(), /CAPTION/);
  });
  await t.test('Chinese titles render two distinct glyph lines with system font fallback', async () => {
    await edit({ type: 'replace', composition: { schemaVersion: 1, tracks: [{ id: 'cn', kind: 'text', title: 'Chinese title' }], clips: [
      { id: 'cn', trackId: 'cn', kind: 'text', purpose: 'title', text: '中文标题\n真实字幕', from: 0, durationFrames: 12, sourceStartFrames: 0,
        textStyle: { fontSize: 12, color: '#ffffff', bold: true } }
    ] } });
    const result = await exported('none'); assert.equal(result.status, 'completed', JSON.stringify(result));
    const path = join(workspaceRoot, result.output.relativeUri), pixels = run(['-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
    const rows = Array.from({ length: 64 }, (_, y) => Array.from({ length: 64 }, (_, x) => pixels[(y * 64 + x) * 3]).filter(value => value > 80).length);
    assert.ok(rows.slice(15, 31).reduce((a,b)=>a+b,0) > 60, 'first Chinese line contains visible glyph strokes');
    assert.ok(rows.slice(33, 49).reduce((a,b)=>a+b,0) > 60, 'second Chinese line contains visible glyph strokes');
    assert.notDeepEqual(rows.slice(16, 32), rows.slice(32, 48), 'distinct CJK characters must not turn into repeated missing-font boxes');
    run(['-i', path, '-frames:v', '1', '-y', join(root, 'chinese-two-lines.png')]);
    await edit({ type: 'replace', composition });
  });
  await t.test('migrated fade-to-black plus dissolve preserves both RGB fade and opaque letterbox bars', async () => {
    await edit({ type: 'replace', composition: { schemaVersion: 1, tracks: composition.tracks.slice(0, 2), clips: [
      { id: 'out', trackId: 'video', kind: 'video', assetId: v, from: 0, durationFrames: 36, sourceStartFrames: 0, nativeAudio: false,
        legacyFadeToBlack: true, fadeOutFrames: 36 },
      { id: 'in', trackId: 'overlay', kind: 'image', assetId: i, from: 12, durationFrames: 24, sourceStartFrames: 0,
        legacyFadeToBlack: true, envelope: { durationFrames: 24, offsetFrames: 0, fadeInFrames: 12, dissolveInFrames: 12 } }
    ] } });
    const result = await exported('none'); assert.equal(result.status, 'completed', JSON.stringify(result));
    const pixels = run(['-i', join(workspaceRoot, result.output.relativeUri), '-vsync', '0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
    const at = (x,y) => [...pixels.subarray((18 * 64 * 64 + y * 64 + x) * 3, (18 * 64 * 64 + y * 64 + x) * 3 + 3)];
    const center = at(32,32), letterbox = at(32,4);
    assert.ok(center[0] > 50 && center[0] < 78 && center[2] > 50 && center[2] < 78, `two half fades and half dissolve: ${center}`);
    assert.ok(letterbox[0] < 12 && letterbox[2] > 50 && letterbox[2] < 78, `legacy black bars must also dissolve: ${letterbox}`);
    await edit({ type: 'replace', composition });
  });
  await t.test('solo disables other picture and audio tracks without changing the timeline extent', async () => {
    await edit({ type: 'track.update', trackId: 'overlay', patch: { solo: true } });
    const result = await exported('none'); assert.equal(result.status, 'completed', result.error);
    const path = join(workspaceRoot, result.output.relativeUri);
    assert.equal((await probeComicVideoPackets(ffmpeg, path)).frames, 48);
    const silence = run(['-ss', '1', '-t', '0.2', '-i', path, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
    assert.ok(amplitude(silence, 330) < 0.001 && amplitude(silence, 880) < 0.001);
    await edit({ type: 'track.update', trackId: 'overlay', patch: { solo: false } });
  });
  await t.test('external and embedded subtitle sources obey the same source trim without silently disappearing', async () => {
    for (const assetId of [s, captionedId, v]) {
      await edit({ type: 'replace', composition: { schemaVersion: 1, tracks: [{ id: 'sub', kind: 'text', title: 'Subtitles' }], clips: [
        { id: 'sub', trackId: 'sub', kind: 'text', purpose: 'subtitle', assetId, from: 0, durationFrames: 12, sourceStartFrames: 12, textStyle: { fontSize: 9 } }
      ] } });
      const result = await exported('embedded'); assert.equal(result.status, 'completed', JSON.stringify(result));
      if (assetId === v) assert.equal(result.output.subtitleRelativeUri, undefined, 'video without subtitle stream is legitimate');
      else {
        const text = await readFile(join(workspaceRoot, result.output.subtitleRelativeUri), 'utf8');
        assert.match(text, /00:00:00,000 --> 00:00:00,500/); assert.match(text, /KEPT/); assert.doesNotMatch(text, /OMITTED/);
      }
    }
    await edit({ type: 'replace', composition });
  });
  await t.test('replaced independent audio fails integrity checking instead of exporting silent success', async () => {
    const path = join(workspaceRoot, project.assets.find(asset => asset.id === a).uri), original = await readFile(path);
    await writeFile(path, Buffer.concat([original, Buffer.from('changed')]));
    const failed = await exported('none'); assert.equal(failed.status, 'failed'); assert.equal(failed.output, undefined);
    await writeFile(path, original);
  });
  await t.test('detached audio retains the video source clock, including a nonzero origin and encoder preroll', async () => {
    const sounds = [];
    for (const detached of [false, true]) {
      await edit({ type: 'replace', composition: { schemaVersion: 1, tracks: [{ id: 'track', kind: detached ? 'audio' : 'video', title: 'Source' }], clips: [
        { id: 'source', trackId: 'track', kind: detached ? 'audio' : 'video', assetId: v, from: 0, durationFrames: 24, sourceStartFrames: 12 }
      ] } });
      const result = await exported('none'); assert.equal(result.status, 'completed', JSON.stringify(result));
      sounds.push(run(['-i', join(workspaceRoot, result.output.relativeUri), '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']));
    }
    assert.deepEqual(sounds[1], sounds[0], 'detaching the native soundtrack must not move the actual audio samples');
    await edit({ type: 'replace', composition });
  });
  await t.test('missing visible media fails; hiding that track intentionally removes its requirement', async () => {
    const asset = project.assets.find(asset => asset.id === i); await rm(join(workspaceRoot, asset.uri));
    const failed = await exported('none'); assert.equal(failed.status, 'failed'); assert.equal(failed.output, undefined);
    await edit({ type: 'track.update', trackId: 'overlay', patch: { hidden: true } });
    const hidden = await exported('none'); assert.equal(hidden.status, 'completed', hidden.error);
  });
});

test('shared subtitle extraction keeps the beginning of files larger than the old 512KB command tail', { timeout: 30_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-composition-subtitles-')); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'large.srt');
  const stamp = n => `${String(Math.floor(n / 3600)).padStart(2, '0')}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')},000`;
  await writeFile(path, Array.from({ length: 2200 }, (_, i) => `${i + 1}\n${stamp(i)} --> ${stamp(i + 1)}\nCUE-${i}-${'x'.repeat(250)}\n`).join('\n'));
  const cues = await readComicSubtitleCues(ffmpeg, path, 24, new AbortController().signal);
  assert.equal(cues.length, 2200); assert.match(cues[0].text, /^CUE-0-/); assert.match(cues.at(-1).text, /^CUE-2199-/);
  await assert.rejects(readComicSubtitleCues(ffmpeg, path, 24, AbortSignal.abort()), /cancelled/);
});

test('export uses actual font em metrics and matches CSS glyph bounds, baselines and 1.2em multiline spacing', { timeout: 60_000 }, async t => {
  const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
  const puppeteer = (await import(platform.resolve('puppeteer'))).default;
  const { PNG } = require('pngjs');
  const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); await page.setViewport({ width: 640, height: 360, deviceScaleFactor: 1 });
  const root = process.env.COMIC_FONT_PARITY_OUTPUT || await mkdtemp(join(tmpdir(), 'nextmux-font-parity-'));
  if (!process.env.COMIC_FONT_PARITY_OUTPUT) t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(root, { recursive: true });
  const family = process.platform === 'darwin' ? 'PingFang SC' : process.platform === 'win32' ? 'Microsoft YaHei' : 'Noto Sans CJK SC';
  const inkBounds = bytes => {
    const png = PNG.sync.read(bytes); let left=640,right=-1,top=360,bottom=-1;
    for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){const at=(y*png.width+x)*4;if(png.data[at]>80&&png.data[at+1]>80&&png.data[at+2]>80){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
    return {left,right,top,bottom,width:right-left+1,height:bottom-top+1};
  };
  const observations = [];
  for (const [index, sample] of [
    { text:'多轨 · 关键帧验收', size:56, bold:false, align:'center', y:0 },
    { text:'中文标题\n真实字幕', size:56, bold:false, align:'center', y:0 },
    { text:'字幕 A：原声 330Hz，可挂载音乐', size:14.4, bold:false, align:'center', y:156.6 },
    { text:'中文标题\n字幕', size:56, bold:true, align:'right', y:0 }
  ].entries()) {
    const dir = join(root, String(index)); await mkdir(dir, { recursive:true });
    const clip = {id:'text',trackId:'text',kind:'text',purpose:'title',text:sample.text,from:0,durationFrames:2,sourceStartFrames:0,
      textStyle:{fontSize:sample.size,color:'#ffffff',bold:sample.bold,align:sample.align},transform:{y:sample.y}};
    const project = {frameRate:24,canvas:{width:640,height:360},assets:[]}, composition={schemaVersion:1,tracks:[{id:'text',kind:'text',title:'Text'}],clips:[clip]};
    const host = {ffmpeg,temporaryRoot:dir,signal:new AbortController().signal,quality:'high',
      resolveAsset:async()=>{throw Error('unexpected media');},probe:async()=>{throw Error('unexpected probe');},hasAudio:async()=>false,
      run:async args=>{run(args);},verify:async(path,frames)=>assert.equal((await probeComicVideoPackets(ffmpeg,path)).frames,frames),progress:async()=>{},fail:(code,detail)=>{throw Error(`${code}: ${detail}`);}};
    const output=join(dir,'export.mp4'), plan=await prepareComicCompositionExport(project,composition,'none',host);
    await renderComicCompositionExport(project,plan,output,host);
    const png=run(['-i',output,'-frames:v','1','-f','image2pipe','-c:v','png','pipe:1']);await writeFile(join(dir,'export.png'),png);
    await page.setContent('<style>html,body{margin:0;background:#000;}#plane{position:absolute;width:640px;height:360px;display:flex;align-items:center;}#text{max-width:100%;white-space:pre;line-height:1.2;color:white;}</style><div id="plane"><span id="text"></span></div>');
    const wrapped=require('@nextmux/comic-core/composition').comicCompositionTextLines(sample.text,sample.size,640);
    await page.evaluate(({sample,family,wrapped})=>{const p=document.querySelector('#plane'),s=document.querySelector('#text');p.style.justifyContent=sample.align==='left'?'flex-start':sample.align==='right'?'flex-end':'center';p.style.transform=`translateY(${sample.y}px)`;Object.assign(s.style,{fontFamily:`${family}, sans-serif`,fontSize:`${sample.size}px`,fontWeight:sample.bold?'700':'400',textAlign:sample.align});s.textContent=wrapped;},{sample,family,wrapped});
    await page.evaluate(()=>document.fonts.ready);
    const preview=await page.screenshot({type:'png'});await writeFile(join(dir,'preview.png'),preview);
    const expected=inkBounds(preview), actual=inkBounds(png);observations.push({sample,expected,actual});
    for(const edge of ['left','right','top','bottom'])assert.ok(Math.abs(actual[edge]-expected[edge])<=2,`CSS/export ${index} ${edge}: ${JSON.stringify({expected,actual})}`);
  }
  await writeFile(join(root,'bounds.json'),JSON.stringify(observations,null,2));
});

test('unreadable absolute font metrics retain the working renderer sizing with a diagnostic, without swallowing cancellation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-font-fallback-')); t.after(() => rm(root, {recursive:true,force:true}));
  const ffmpegProbe = join(root, 'font-provider');
  await writeFile(ffmpegProbe, '#!/usr/bin/env node\nprocess.stderr.write("fontselect: (Test font, 400, 0) -> /missing-nextmux-font.ttf, 0, TestFont\\n");\n', {mode:0o700});
  const original = console.warn, warnings=[];
  try {
    console.warn = message => warnings.push(message);
    const metrics = await resolveComicFontMetrics(ffmpegProbe,'Test font',false,root,new AbortController().signal);
    assert.equal(metrics.emToAss,1); assert.match(warnings.join('\n'),/retaining legacy ASS sizing/);
    await assert.rejects(resolveComicFontMetrics(ffmpegProbe,'Test font',false,root,AbortSignal.abort()),/cancelled/);
  } finally {console.warn=original;}
});
