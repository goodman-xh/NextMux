import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { loadCanvasToolsSource } from './helpers/canvas-tools-source-loader.mjs';

const require = createRequire(import.meta.url);
const appRequire = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const { build } = appRequire('esbuild');
const models = await loadCanvasToolsSource('common/nextmux-canvas-on-device-models.ts');
const onDevice = await loadCanvasToolsSource('node/nextmux-canvas-on-device.ts');
const filename = fileURLToPath(new URL('../src/node/nextmux-canvas-video-depth.ts', import.meta.url));
const compiled = ts.transpileModule(await readFile(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function loadApi(overrides = {}) {
    const api = {};
    new Function('require', 'exports', '__dirname', compiled)(id => id in overrides ? overrides[id] : id === './nextmux-canvas-on-device'
        ? { ...onDevice, downloadCanvasOnDeviceModel: async () => 'unit-test-model' }
        : id === '../common/nextmux-canvas-on-device-models' ? models : require(id), api, dirname(filename));
    return api;
}
const api = loadApi();
const { runCanvasVideoDepth, videoDepthDimensions, videoDepthPtsExpression, videoDepthPackets } = api;
const binaries = [...new Set(['ffmpeg', require('@ffmpeg-installer/ffmpeg').path])].filter(binary => {
    try { execFileSync(binary, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
});
const major = binary => Number(/ffmpeg version (?:n)?(\d+)/.exec(execFileSync(binary, ['-version'], { encoding: 'utf8' }))?.[1]);
const sync = binary => major(binary) >= 5 ? ['-fps_mode', 'passthrough'] : ['-vsync', '0'];
const ffmpeg = (binary, args) => execFileSync(binary, ['-hide_banner', '-v', 'error', '-nostdin', '-n', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
async function fixture(t, delay = 20) {
    const directory = await mkdtemp(join(tmpdir(), 'canvas-video-depth-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const trace = join(directory, 'session.jsonl'), stub = join(directory, 'onnx.cjs'), worker = join(directory, 'worker.cjs');
    await writeFile(stub, `const fs=require('node:fs'); const log=value=>fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify(value)+'\\n');
exports.Tensor=class{constructor(type,data,dims){this.data=data;this.dims=dims}};
exports.InferenceSession={create:async()=>{log('create');return{outputNames:['predicted_depth'],run:async feeds=>{log('run');await new Promise(r=>setTimeout(r,${delay}));return{predicted_depth:{data:new Float32Array([0,1,2,3]),dims:[1,2,2]}}},release:async()=>log('release')}}};`);
    await build({ entryPoints: [fileURLToPath(new URL('../src/node/nextmux-canvas-on-device-worker.ts', import.meta.url))], bundle: true,
        platform: 'node', format: 'cjs', outfile: worker, alias: { 'onnxruntime-node': stub }, logLevel: 'silent' });
    return { directory, worker, trace };
}
function options(f, binary, extra = {}) { return { width: 96, height: 64, modelDirectory: join(f.directory, 'models'), ffmpegPath: binary, workerPath: f.worker, ...extra }; }
async function packetList(binary, path) { return videoDepthPackets(ffmpeg(binary, ['-i', path, '-map', '0:v:0', '-c:v', 'copy', '-f', 'framecrc', '-']).toString()).sort((a,b) => a.ptsUs - b.ptsUs); }

// Injected ONNX only supplies a deterministic plane. Decode, per-frame preprocessing, worker session
// lifecycle, normalization, PNGs, encoding, clock verification and cancellation are production code.
for (const binary of binaries) {
    test(`video depth retains CFR/VFR frames and one model session with FFmpeg ${major(binary)}`, async t => {
        const f = await fixture(t);
        for (const vfr of [false, true]) {
            const source = join(f.directory, `source-${vfr}.mp4`), result = join(f.directory, `result-${vfr}.mp4`);
            ffmpeg(binary, ['-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=25:duration=0.24', '-vf', vfr ? "select='eq(n,0)+eq(n,1)+eq(n,4)'" : 'null',
                '-c:v', 'libx264', '-bf', '0', ...sync(binary), source]);
            const original = await packetList(binary, source), childIds = [], progress = [];
            await writeFile(f.trace, '');
            const output = await runCanvasVideoDepth(source, result, options(f, binary, {
                onProgress: item => progress.push(item.fraction), onChild: (phase, pid) => childIds.push([phase, pid]) }));
            const actual = await packetList(binary, result);
            assert.equal(output.frameCount, original.length);
            for (let index = 0; index < actual.length; index++) {
                assert.ok(Math.abs(actual[index].ptsUs - original[index].ptsUs) <= 1);
                assert.ok(Math.abs(actual[index].durationUs - original[index].durationUs) <= 1);
            }
            if (vfr) assert.deepEqual(actual.map(p => p.ptsUs), [0, 40000, 160000]);
            const trace = (await readFile(f.trace, 'utf8')).trim().split('\n').map(JSON.parse);
            assert.equal(trace.filter(x => x === 'create').length, 1);
            assert.equal(trace.filter(x => x === 'run').length, original.length);
            assert.equal(trace.filter(x => x === 'release').length, 1);
            assert.equal(childIds.filter(([phase]) => phase === 'infer').length, 1);
            assert.ok(progress.every((fraction, index) => index === 0 || fraction >= progress[index - 1]), 'progress never moves backwards');
            assert.ok(!(await readdir(f.directory)).some(name => name.startsWith('.video-depth-')));
        }
    });
    test(`video depth applies real display rotation once and drops the source audio (FFmpeg ${major(binary)})`, async t => {
        const f = await fixture(t), source = join(f.directory, 'landscape.mp4'), rotated = join(f.directory, 'portrait.mp4'), output = join(f.directory, 'portrait-depth.mp4');
        ffmpeg(binary, ['-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=5:duration=0.6', '-f', 'lavfi', '-i', 'sine=duration=0.6',
            '-c:v', 'libx264', '-c:a', 'aac', source]);
        // FFmpeg 9 changed rotation metadata writes; the shipped 4.4 writes an actual MP4 display matrix.
        ffmpeg(require('@ffmpeg-installer/ffmpeg').path, ['-i', source, '-c', 'copy', '-metadata:s:v:0', 'rotate=90', rotated]);
        const { probeCanvasMedia } = await loadCanvasToolsSource();
        const before = await probeCanvasMedia(rotated, { ffmpegPath: binary, ffprobePath: '/missing-ffprobe' });
        assert.deepEqual([before.width, before.height], [64, 96]); assert.equal(before.hasAudio, true);
        await runCanvasVideoDepth(rotated, output, options(f, binary, { width: 64, height: 96 }));
        const after = await probeCanvasMedia(output, { ffmpegPath: binary, ffprobePath: '/missing-ffprobe' });
        assert.deepEqual([after.width, after.height], [64, 96]); assert.equal(after.hasAudio, false);
        assert.equal(after.frameCount, 3); assert.equal(after.durationMs, 600);
    });
    test(`video depth aborts its owned decode/infer/encode processes and removes partial files (FFmpeg ${major(binary)})`, async t => {
        const f = await fixture(t), source = join(f.directory, 'source.mp4');
        ffmpeg(binary, ['-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=25:duration=0.24', '-c:v', 'libx264', source]);
        for (const phase of ['decode', 'infer', 'encode']) {
            const signal = new AbortController(), pids = [], result = join(f.directory, `cancel-${phase}.mp4`);
            await assert.rejects(runCanvasVideoDepth(source, result, options(f, binary, { signal: signal.signal,
                onChild: (stage, pid) => { pids.push(pid); if (stage === phase) signal.abort(); } })), { code: 'CANCELLED' });
            for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
            assert.ok(!(await readdir(f.directory)).some(name => name.startsWith('.video-depth-') || name === `cancel-${phase}.mp4`));
        }
    });
    test(`anamorphic video keeps its display shape with square pixels, including rotation (FFmpeg ${major(binary)})`, async t => {
        const f = await fixture(t), source = join(f.directory, 'anamorphic.mp4'), rotated = join(f.directory, 'anamorphic-rotated.mp4');
        ffmpeg(binary, ['-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=5:duration=0.4', '-vf', 'setsar=2', '-c:v', 'libx264', source]);
        ffmpeg(require('@ffmpeg-installer/ffmpeg').path, ['-i', source, '-c', 'copy', '-metadata:s:v:0', 'rotate=90', rotated]);
        for (const [input, width, height] of [[source, 96, 32], [rotated, 32, 96]]) {
            const result = join(f.directory, `${width}-depth.mp4`);
            const output = await runCanvasVideoDepth(input, result, options(f, binary));
            assert.deepEqual([output.width, output.height], [width, height]);
            // This probes the actual encoded stream, including SAR; no system ffprobe is required.
            const info = spawnSync(binary, ['-hide_banner', '-i', result, '-vf', 'showinfo', '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
            assert.equal(info.status, 0); assert.match(info.stderr, /\bsar:1\/1\s+s:/);
            const { probeCanvasMedia } = await loadCanvasToolsSource();
            const measured = await probeCanvasMedia(result, { ffmpegPath: binary, ffprobePath: '/missing-ffprobe' });
            assert.deepEqual([measured.width, measured.height], [width, height]);
            const png = ffmpeg(binary, ['-i', result, '-frames:v', '1', '-c:v', 'png', '-f', 'image2pipe', '-']);
            assert.ok(png.length > 100); assert.equal(output.frameCount, 2);
        }
    });
    test(`temporary disk budget exhaustion stops decoding and cleans all partial files (FFmpeg ${major(binary)})`, async t => {
        const f = await fixture(t), source = join(f.directory, 'space-source.mp4'), result = join(f.directory, 'space-result.mp4');
        ffmpeg(binary, ['-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=25:duration=0.24', '-c:v', 'libx264', source]);
        const children = [];
        await assert.rejects(runCanvasVideoDepth(source, result, options(f, binary, {
            temporaryBudgetBytes: 2 * (96 * 64 * 8 + 65536), onChild: (phase, pid) => children.push([phase, pid])
        })), { code: 'LOCAL_STORAGE_INSUFFICIENT' });
        assert.ok(children.some(([phase]) => phase === 'decode'));
        assert.ok(!children.some(([phase]) => phase === 'infer'));
        for (const [, pid] of children) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
        assert.ok(!(await readdir(f.directory)).some(name => name.startsWith('.video-depth-') || name === 'space-result.mp4'));
    });
    test(`100,000 irregular timestamps use a file and balanced expression with FFmpeg ${major(binary)}`, async t => {
        const directory = await mkdtemp(join(tmpdir(), 'canvas-depth-timing-limit-')); t.after(() => rm(directory, { recursive: true, force: true }));
        const script = join(directory, 'clock.filter'), expression = videoDepthPtsExpression(Array.from({ length: 100_000 }, (_, n) => n * 33333 + n % 7 * 123));
        assert.ok(expression.length > 262144, 'larger than macOS argument budget');
        await writeFile(script, `settb=1/1000000,setpts='${expression}'`);
        ffmpeg(binary, ['-f', 'lavfi', '-i', 'color=size=16x16:rate=1', '-frames:v', '1', major(binary) >= 9 ? '-/filter:v' : '-filter_script:v', script, '-f', 'null', '-']);
    });
}

test('parallel video jobs reserve one shared volume budget and release it after cleanup', { skip: !binaries.length }, async t => {
    const binary = binaries[0], f = await fixture(t, 150), source = join(f.directory, 'source.mp4');
    ffmpeg(binary, ['-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=5:duration=0.4', '-c:v', 'libx264', source]);
    const budget = 3 * (96 * 64 * 8 + 65536);
    let started; const inInference = new Promise(resolve => { started = resolve; });
    const first = runCanvasVideoDepth(source, join(f.directory, 'first.mp4'), options(f, binary, {
        temporaryBudgetBytes: budget, onChild: phase => { if (phase === 'infer') started(); } }));
    await inInference;
    await assert.rejects(runCanvasVideoDepth(source, join(f.directory, 'second.mp4'), options(f, binary, {
        temporaryBudgetBytes: budget })), { code: 'LOCAL_STORAGE_INSUFFICIENT' });
    await first;
    await runCanvasVideoDepth(source, join(f.directory, 'second.mp4'), options(f, binary, { temporaryBudgetBytes: budget }));
    assert.ok(!(await readdir(f.directory)).some(name => name.startsWith('.video-depth-')));
});

test('falling real free space stops an active inference child and cleans its reservation and files', { skip: !binaries.length }, async t => {
    const binary = binaries[0], f = await fixture(t, 150), source = join(f.directory, 'source.mp4'), children = [];
    ffmpeg(binary, ['-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=5:duration=0.4', '-c:v', 'libx264', source]);
    let full = false;
    const fs = require('node:fs'), guarded = loadApi({ 'node:fs': { ...fs, statfsSync: (...args) => {
        const real = fs.statfsSync(...args); return full ? { ...real, bavail: 0n } : real;
    } } });
    await assert.rejects(guarded.runCanvasVideoDepth(source, join(f.directory, 'full.mp4'), options(f, binary, {
        onChild: (phase, pid) => { children.push(pid); if (phase === 'infer') full = true; }
    })), { code: 'LOCAL_STORAGE_INSUFFICIENT' });
    for (const pid of children) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.ok(!(await readdir(f.directory)).some(name => name.startsWith('.video-depth-') || name === 'full.mp4'));
    full = false;
    await guarded.runCanvasVideoDepth(source, join(f.directory, 'recovered.mp4'), options(f, binary));
});

test('depth dimensions are short-side bounded, even, source-oriented and never enlarged', () => {
    assert.deepEqual(videoDepthDimensions(3840, 2160), { width: 1920, height: 1080 });
    assert.deepEqual(videoDepthDimensions(1080, 1920, '720'), { width: 720, height: 1280 });
    assert.deepEqual(videoDepthDimensions(641, 359, '480'), { width: 640, height: 358 });
    assert.deepEqual(videoDepthDimensions(720, 1280, '480'), { width: 480, height: 852 });
    assert.deepEqual(videoDepthDimensions(96, 64, 'source', 2), { width: 96, height: 32 });
    assert.deepEqual(videoDepthDimensions(64, 96, 'source', .5), { width: 32, height: 96 });
    for (const args of [[1, 2], [2, 1], [0, 100], [100, 100, '1080'], [100, 100, 720]]) assert.throws(() => videoDepthDimensions(...args));
    for (const pts of [[], [1], [0, 0], [0, 2, 1], [0, NaN]]) assert.throws(() => videoDepthPtsExpression(pts));
    assert.equal(videoDepthPtsExpression([0, 40000, 80000]), '0+(N-0)*40000');
});
