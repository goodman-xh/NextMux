import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { loadCanvasToolsSource } from './helpers/canvas-tools-source-loader.mjs';

const { extractCanvasVideoFrame } = await loadCanvasToolsSource('node/nextmux-canvas-frame.ts');

const execFile = promisify(execFileCallback);
const require = createRequire(import.meta.url);
const ffmpegPath = process.env.NEXTMUX_TEST_FFMPEG || require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = process.env.NEXTMUX_TEST_FFPROBE;
const help = await execFile(ffmpegPath, ['-hide_banner', '-h', 'full'], { maxBuffer: 4 * 1024 * 1024 });
const modernSync = /^\s*-fps_mode(?:\s|\[)/m.test(`${help.stdout}\n${help.stderr}`);
const passthrough = modernSync ? ['-fps_mode', 'passthrough'] : ['-vsync', '0'];
const vfr = modernSync ? ['-fps_mode', 'vfr'] : ['-vsync', '2'];

test('canvas frame extraction uses decoded timestamps at 2fps, including a nonzero media origin', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nextmux-canvas-frames-'));
    try {
        const sourcePath = join(directory, 'source with spaces.mkv');
        await execFile(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=2:duration=2',
            '-vf', 'setpts=PTS+3/TB', '-c:v', 'ffv1', ...passthrough, sourcePath]);
        const base = { ffmpegPath, ffprobePath, sourcePath };
        const first = await extractCanvasVideoFrame({ ...base, outputPath: join(directory, 'first.png'), selection: { kind: 'first' } });
        const last = await extractCanvasVideoFrame({ ...base, outputPath: join(directory, 'last.png'), selection: { kind: 'last' } });
        const current = await extractCanvasVideoFrame({ ...base, outputPath: join(directory, 'current.png'), selection: { kind: 'time', timeMs: 1_100 } });
        assert.deepEqual([first.actualTimeMs, last.actualTimeMs, current.actualTimeMs], [0, 1_500, 1_000]);
        assert.deepEqual([first.sourceTimestampMs, last.sourceTimestampMs], [3_000, 4_500]);
        assert.deepEqual([last.sourceFrameIndex, last.width, last.height], [3, 64, 48]);
        assert.match(last.timeBase, /^\d+\/\d+$/);
        assert.notDeepEqual(await readFile(join(directory, 'first.png')), await readFile(join(directory, 'last.png')));
        await assert.rejects(extractCanvasVideoFrame({ ...base, outputPath: join(directory, 'invalid.png'), selection: { kind: 'time', timeMs: 2_000 } }), /last decoded frame/);
        await assert.rejects(extractCanvasVideoFrame({ ...base, outputPath: join(directory, 'last.png'), selection: { kind: 'last' } }), /already exists|Exiting/);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('canvas frame extraction selects VFR presentation frames rather than a fixed frame duration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nextmux-canvas-vfr-'));
    try {
        const sourcePath = join(directory, 'vfr.mkv');
        await execFile(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=32x32:rate=10:duration=1',
            '-vf', "select='eq(n,0)+eq(n,1)+eq(n,4)+eq(n,9)'", '-c:v', 'ffv1', ...vfr, sourcePath]);
        const last = await extractCanvasVideoFrame({ ffmpegPath, ffprobePath, sourcePath, outputPath: join(directory, 'last.png'), selection: { kind: 'last' } });
        const point = await extractCanvasVideoFrame({ ffmpegPath, ffprobePath, sourcePath, outputPath: join(directory, 'point.png'), selection: { kind: 'time', timeMs: 500 } });
        assert.equal(last.actualTimeMs, 900);
        assert.equal(last.sourceFrameIndex, 3);
        assert.equal(point.actualTimeMs, 400);
        assert.equal(point.sourceFrameIndex, 2);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('canvas frame extraction treats relative leading-dash and quoted filenames as file paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nextmux-canvas-dash-')), cwd = process.cwd();
    try {
        const sourcePath = join(directory, "-source's video.mkv");
        await execFile(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=32x32:rate=1:duration=1', '-c:v', 'ffv1', sourcePath]);
        process.chdir(directory);
        const frame = await extractCanvasVideoFrame({ ffmpegPath, ffprobePath, sourcePath: "-source's video.mkv", outputPath: "-output's frame.png", selection: { kind: 'first' } });
        assert.deepEqual([frame.width, frame.height, frame.sourceFrameIndex], [32, 32, 0]);
        assert.ok((await readFile(join(directory, "-output's frame.png"))).length > 24);
    } finally { process.chdir(cwd); await rm(directory, { recursive: true, force: true }); }
});

test('canvas frame extraction never overwrites an existing image even with the image2 update muxer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nextmux-canvas-existing-'));
    try {
        const sourcePath = join(directory, 'source.mkv'), outputPath = join(directory, 'first.png');
        await execFile(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=2:duration=2', '-c:v', 'ffv1', sourcePath]);
        await extractCanvasVideoFrame({ ffmpegPath, ffprobePath, sourcePath, outputPath, selection: { kind: 'first' } });
        const original = await readFile(outputPath);
        await assert.rejects(extractCanvasVideoFrame({ ffmpegPath, ffprobePath, sourcePath, outputPath, selection: { kind: 'last' } }), /already exists|Exiting/);
        assert.deepEqual(await readFile(outputPath), original);
        const { readdir } = await import('node:fs/promises'); assert.deepEqual((await readdir(directory)).sort(), ['first.png', 'source.mkv']);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('showinfo fallback preserves exact VFR PTS at a large nonzero stream origin', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nextmux-canvas-fallback-'));
    try {
        const sourcePath=join(directory,'vfr.mkv'), wrapped=join(directory,'ffmpeg');
        await symlink(ffmpegPath,wrapped);
        await execFile(ffmpegPath,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=64x48:rate=10:duration=1',
            '-vf',"select='eq(n,0)+eq(n,1)+eq(n,4)+eq(n,9)',setpts=PTS+12345/TB",'-c:v','ffv1',...passthrough,sourcePath]);
        const selections=[{kind:'first'},{kind:'last'},{kind:'time',timeMs:500}];
        const normal=[];
        for (const [index,selection] of selections.entries()) normal.push(await extractCanvasVideoFrame({ffmpegPath,ffprobePath,sourcePath,outputPath:join(directory,`normal-${index}.png`),selection}));
        // No adjacent or PATH ffprobe: a separate process exercises the real packaged fallback
        // without changing the test runner's environment or mocking decoded frame metadata.
        const script=`import {loadCanvasToolsSource} from ${JSON.stringify(new URL('./helpers/canvas-tools-source-loader.mjs',import.meta.url).href)};
const {extractCanvasVideoFrame}=await loadCanvasToolsSource('node/nextmux-canvas-frame.ts');
const base=JSON.parse(process.argv[1]);const results=[];
for(const [index,selection] of base.selections.entries()) results.push(await extractCanvasVideoFrame({ffmpegPath:base.ffmpegPath,sourcePath:base.sourcePath,outputPath:base.directory+'/fallback-'+index+'.png',selection}));
console.log(JSON.stringify(results));`;
        const output=await execFile(process.execPath,['--input-type=module','-e',script,JSON.stringify({ffmpegPath:wrapped,sourcePath,directory,selections})],{env:{...process.env,PATH:directory}});
        const fallback=JSON.parse(output.stdout);
        assert.deepEqual(fallback,normal);
        assert.deepEqual(fallback.map(frame=>[frame.sourceFrameIndex,frame.actualTimeMs,frame.sourceTimestampMs]),[[0,0,12345000],[3,900,12345900],[2,400,12345400]]);
        for(const index of [0,1,2]) assert.deepEqual(await readFile(join(directory,`fallback-${index}.png`)),await readFile(join(directory,`normal-${index}.png`)));
    } finally { await rm(directory,{recursive:true,force:true}); }
});

test('B-frame reordering and a fractional frame clock keep the real last presentation frame', async () => {
    const directory=await mkdtemp(join(tmpdir(),'nextmux-canvas-bframes-'));
    try {
        const sourcePath=join(directory,'bframes.mp4');
        await execFile(ffmpegPath,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=96x64:rate=30000/1001:duration=0.4',
            '-vf','setpts=PTS+5/TB','-c:v','libx264','-bf','2',...passthrough,sourcePath]);
        const first=await extractCanvasVideoFrame({ffmpegPath,ffprobePath,sourcePath,outputPath:join(directory,'first.png'),selection:{kind:'first'}});
        const last=await extractCanvasVideoFrame({ffmpegPath,ffprobePath,sourcePath,outputPath:join(directory,'last.png'),selection:{kind:'last'}});
        const point=await extractCanvasVideoFrame({ffmpegPath,ffprobePath,sourcePath,outputPath:join(directory,'point.png'),selection:{kind:'time',timeMs:110}});
        assert.equal(last.sourceFrameIndex,11,'decoder drains reordered final frames');
        assert.ok(Math.abs(last.actualTimeMs-11*1001/30)<0.000001);
        assert.equal(point.sourceFrameIndex,3);
        assert.ok(Math.abs(point.actualTimeMs-100.1)<0.000001);
        assert.ok(first.sourceTimestampMs>4000,'source origin remains absolute while requested time is relative');
        assert.ok(Math.abs(last.sourceTimestampMs-first.sourceTimestampMs-last.actualTimeMs)<0.000001);
        assert.notDeepEqual(await readFile(join(directory,'first.png')),await readFile(join(directory,'last.png')));
    } finally { await rm(directory,{recursive:true,force:true}); }
});
