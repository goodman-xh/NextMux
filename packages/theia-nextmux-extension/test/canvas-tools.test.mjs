import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCanvasToolsSource } from './helpers/canvas-tools-source-loader.mjs';

const { runCanvasLocalTool, probeCanvasMedia, compileCanvasColorFilters, validateCanvasCube } = await loadCanvasToolsSource();
const execFile = promisify(execFileCallback), ffmpegPath = process.env.NEXTMUX_TEST_FFMPEG || 'ffmpeg', ffprobePath = process.env.NEXTMUX_TEST_FFPROBE || 'ffprobe';
let directory, video, image, audio;
const version = (uri, kind) => ({ id: `version-${kind}`, assetId: `asset-${kind}`, uri, kind, createdAt: '2026-09-30T00:00:00.000Z', status: 'ready', metadata: { durationMs: 999999, width: 999, height: 999 } });
const ffmpeg = args => execFile(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args]);
const options = () => ({ ffmpegPath, ffprobePath, outputDirectory: join(directory, 'outputs') });
const run = (source, tool, parameters) => runCanvasLocalTool({ source, tool, parameters }, options());
const close = (actual, expected, tolerance = 150) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} expected ${expected}`);
before(async () => {
    directory = await mkdtemp(join(tmpdir(), "nextmux canvas's tools "));
    const videoPath = join(directory, 'video input.mp4'), imagePath = join(directory, 'image input.png'), audioPath = join(directory, 'audio.wav');
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=4:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', videoPath]);
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=1:duration=1', '-frames:v', '1', imagePath]);
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000:duration=2', '-c:a', 'pcm_s16le', audioPath]);
    video = version(videoPath, 'video'); image = version(imagePath, 'image'); audio = version(audioPath, 'audio');
});
after(async () => { await rm(directory, { recursive: true, force: true }); });

test('real probing overrides stale duration, dimensions, audio and frame count', async () => {
    const probe = await probeCanvasMedia(video.uri, options());
    assert.deepEqual([probe.width, probe.height, probe.frameCount, probe.hasAudio, probe.mediaKind], [96, 64, 8, true, 'video']);
    close(probe.durationMs, 2000);
});
test('without a working ffprobe, FFmpeg alone gives the same probe and the tools still run', async () => {
    const broken = { ...options(), ffprobePath: join(directory, 'missing', 'ffprobe') };
    for (const source of [video, image, audio]) {
        const [expected, actual] = [await probeCanvasMedia(source.uri, options()), await probeCanvasMedia(source.uri, broken)];
        assert.deepEqual([actual.width, actual.height, actual.frameCount, actual.hasAudio, actual.mediaKind, actual.mimeType],
            [expected.width, expected.height, expected.frameCount, expected.hasAudio, expected.mediaKind, expected.mimeType], source.kind);
        if (expected.durationMs) close(actual.durationMs, expected.durationMs, 60);
    }
    const rotated = join(directory, 'rotated.mp4');
    await ffmpeg(['-display_rotation', '90', '-i', video.uri, '-c', 'copy', rotated]);
    const [expected, actual] = [await probeCanvasMedia(rotated, options()), await probeCanvasMedia(rotated, broken)];
    assert.deepEqual([actual.width, actual.height], [expected.width, expected.height]);
    assert.deepEqual([actual.width, actual.height], [64, 96]);
    const trimmed = await runCanvasLocalTool({ source: video, tool: 'video.trim', parameters: { inMs: 500, outMs: 1500 } }, broken);
    assert.deepEqual([trimmed.versions[0].metadata.frameCount, trimmed.versions[0].metadata.hasAudio], [4, true]);
});
test('video trim/split encode the selected ranges, preserving audio and provenance', async () => {
    const progress = [], original = await readFile(video.uri);
    const trimmed = await runCanvasLocalTool({ source: video, tool: 'video.trim', parameters: { inMs: 500, outMs: 1500 } }, { ...options(), onProgress: item => progress.push(item) });
    const output = trimmed.versions[0]; close(output.metadata.durationMs, 1000);
    assert.deepEqual([output.metadata.width, output.metadata.height, output.metadata.frameCount, output.metadata.hasAudio], [96, 64, 4, true]);
    assert.equal(output.provenance.sourceVersionId, video.id); assert.equal(output.provenance.tool, 'video.trim');
    assert.deepEqual(output.provenance.parameters, { inMs: 500, outMs: 1500 }); assert.match(output.metadata.sha256, /^[a-f\d]{64}$/);
    assert.notEqual(output.id, video.id); assert.notEqual(output.assetId, video.assetId); assert.deepEqual(await readFile(video.uri), original);
    assert.ok(progress.some(item => item.stage === 'process' && item.processedMs !== undefined)); assert.equal(progress.at(-1).fraction, 1);
    const split = await run(video, 'video.split', { segments: [{ inMs: 0, outMs: 1000 }, { inMs: 1000, outMs: 2000 }] });
    assert.equal(split.versions.length, 2); for (const item of split.versions) { close(item.metadata.durationMs, 1000); assert.equal(item.metadata.frameCount, 4); assert.equal(item.metadata.hasAudio, true); }
});
test('video aspect/rectangle crop, mirror, compression and reverse produce actual video streams', async () => {
    const square = (await run(video, 'video.crop', { aspectRatio: [1, 1], mirror: true })).versions[0];
    assert.deepEqual([square.metadata.width, square.metadata.height, square.metadata.frameCount, square.metadata.hasAudio], [64, 64, 8, true]);
    const cropped = (await run(video, 'video.crop', { crop: { x: 2, y: 4, width: 48, height: 32 } })).versions[0]; assert.deepEqual([cropped.metadata.width, cropped.metadata.height], [48, 32]);
    const mirrored = (await run(video, 'video.mirror')).versions[0]; assert.equal(mirrored.metadata.frameCount, 8);
    const compressed = (await run(video, 'video.compress', { maxWidth: 48, maxHeight: 48, fps: 2, crf: 28 })).versions[0];
    assert.deepEqual([compressed.metadata.width, compressed.metadata.height, compressed.metadata.frameCount, compressed.metadata.hasAudio], [48, 32, 4, true]);
    const reversed = (await run(video, 'video.reverse')).versions[0]; assert.equal(reversed.metadata.frameCount, 8); assert.equal(reversed.metadata.hasAudio, true); close(reversed.metadata.durationMs, 2000);
    const rawFrame = async (path, frame) => (await execFile(ffmpegPath, ['-v', 'error', '-i', path, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' })).stdout;
    const expected = await rawFrame(video.uri, 7), actual = await rawFrame(fileURLToPath(reversed.uri), 0);
    const error = expected.reduce((sum, byte, i) => sum + Math.abs(byte - actual[i]), 0) / expected.length; assert.ok(error < 12, `reverse first frame error ${error}`);
});
test('video GIF/WebP export produces animated images with real frame tables', async () => {
    for (const format of ['gif', 'webp']) {
        const output = (await run(video, 'video.export', { inMs: 0, outMs: 1000, format, fps: 4, width: 48 })).versions[0];
        assert.equal(output.kind, 'image'); assert.deepEqual([output.metadata.width, output.metadata.height, output.metadata.frameCount, output.metadata.hasAudio], [48, 32, 4, false]); close(output.metadata.durationMs, 1000);
    }
});
test('extract audio, video-only, WAV and audio trim preserve the intended track roles', async () => {
    for (const [tool, params] of [['video.extractAudio', { format: 'mp3' }], ['video.wav', undefined]]) {
        const output = (await run(video, tool, params)).versions[0]; assert.equal(output.kind, 'audio'); assert.equal(output.metadata.hasAudio, true); assert.equal(output.metadata.width, undefined); close(output.metadata.durationMs, 2000, 250);
    }
    const videoOnly = (await run(video, 'video.videoOnly')).versions[0]; assert.equal(videoOnly.metadata.hasAudio, false); assert.equal(videoOnly.metadata.frameCount, 8);
    const audioOnly = version(fileURLToPath(videoOnly.uri), 'video'); await assert.rejects(run(audioOnly, 'video.wav'), /no audio track/);
    const wav = (await run(audio, 'audio.wav')).versions[0]; close(wav.metadata.durationMs, 2000);
    const trim = (await run(audio, 'audio.trim', { inMs: 200, outMs: 900 })).versions[0]; close(trim.metadata.durationMs, 700, 2);
});
test('image crop/mirror/convert/grid split and stitch check actual sizes', async () => {
    const cropped = (await run(image, 'image.crop', { x: 0, y: 0, width: 32, height: 32 })).versions[0]; assert.deepEqual([cropped.metadata.width, cropped.metadata.height, cropped.metadata.frameCount], [32, 32, 1]);
    const mirrored = (await run(image, 'image.mirror')).versions[0]; assert.notDeepEqual(await readFile(fileURLToPath(mirrored.uri)), await readFile(image.uri));
    for (const format of ['png', 'jpeg', 'webp']) { const converted = (await run(image, 'image.convert', { format, quality: 75, maxWidth: 48 })).versions[0]; assert.deepEqual([converted.metadata.width, converted.metadata.height], [48, 32]); }
    const split = (await run(image, 'image.gridSplit', { rows: 2, columns: 3, gap: 2, selectedCells: [0, 4] })).versions;
    assert.deepEqual(split.map(item => [item.metadata.width, item.metadata.height]), [[31, 31], [30, 31]]);
    const stitched = (await run(image, 'image.gridStitch', { rows: 2, columns: 2, cellWidth: 32, cellHeight: 32, gap: 4, background: '#334455', cells: [split[0], null, split[1]] })).versions[0];
    assert.deepEqual([stitched.metadata.width, stitched.metadata.height], [68, 68]);
    assert.deepEqual(stitched.provenance.sourceVersionIds, [image.id, split[0].id, split[1].id]);
});
test('independent manual controls and caller-provided cube visibly change pixels; LUT temp files are removed', async () => {
    const adjustments = { exposure: 20, brightness: 10, contrast: 10, saturation: -20, vibrance: 15, temperature: 10, tint: 10, highlights: 10, shadows: 10, whites: 10, blacks: 10, sharpen: 10, vignette: 10, fade: 10, grain: 10 };
    assert.equal(compileCanvasColorFilters(adjustments).length, 8);
    const adjusted = (await run(image, 'color.adjust', adjustments)).versions[0]; assert.deepEqual([adjusted.metadata.width, adjusted.metadata.height], [96, 64]); assert.notDeepEqual(await readFile(fileURLToPath(adjusted.uri)), await readFile(image.uri));
    const videoAdjusted = (await run(video, 'color.adjust', adjustments)).versions[0]; assert.equal(videoAdjusted.metadata.frameCount, 8); assert.equal(videoAdjusted.metadata.hasAudio, true);
    const rows = []; for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${1 - r} ${1 - g} ${1 - b}`);
    const cube = `TITLE "Fixture inverted RGB"\nLUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n${rows.join('\n')}\n`;
    assert.equal(validateCanvasCube(cube), 2); const cubePath = join(directory, "user's LUT.cube"); await writeFile(cubePath, cube);
    const inverted = (await run(image, 'color.lut', { cubePath, strength: 1, adjustments: { contrast: 10 } })).versions[0]; assert.notDeepEqual(await readFile(fileURLToPath(inverted.uri)), await readFile(image.uri));
    const lutVideo = (await run(video, 'color.lut', { cubePath, strength: .5 })).versions[0]; assert.equal(lutVideo.metadata.hasAudio, true); assert.equal(lutVideo.metadata.frameCount, 8);
    assert.equal((await readdir(options().outputDirectory)).filter(file => file.endsWith('.cube')).length, 0);
    assert.throws(() => validateCanvasCube('LUT_1D_SIZE 2\n0 0 0\n1 1 1'), /3D/); assert.throws(() => validateCanvasCube('LUT_3D_SIZE 2\n0 0 0'), /row count/);
});
test('invalid input, observer errors and cancellation never mutate the source or leave partial files', async () => {
    await assert.rejects(run({ ...video, metadata: { sha256: '0'.repeat(64) } }, 'video.mirror'), error => error.code === 'SOURCE_BYTES_CHANGED');
    await assert.rejects(run(video, 'video.trim', { inMs: 1000, outMs: 3000 }), /probed media duration/);
    await assert.rejects(run(image, 'image.crop', { x: 90, y: 0, width: 32, height: 32 }), /outside/);
    await assert.rejects(run(video, 'video.compress', { fps: 30 }), /only reduce/);
    await assert.rejects(run(image, 'image.gridSplit', { rows: 2, columns: 2, gap: 500 }), /crop/);
    await assert.rejects(run(version(image.uri, 'video'), 'video.mirror'), /real media streams/);
    assert.throws(() => compileCanvasColorFilters({ exposure: 201 }), /exposure/);
    const observer = await runCanvasLocalTool({ source: image, tool: 'image.mirror' }, { ...options(), onProgress: () => { throw new Error('UI unmounted'); } }); assert.equal(observer.versions.length, 1);
    const outputDirectory = join(directory, 'cancelled'), controller = new AbortController();
    await assert.rejects(runCanvasLocalTool({ source: video, tool: 'video.reverse' }, { ...options(), outputDirectory, signal: controller.signal,
        onProgress: item => { if (item.processedMs !== undefined) controller.abort(); } }), error => error.code === 'CANCELLED');
    assert.deepEqual(await readdir(outputDirectory), []);
});

test('cube inputs are bounded before parsing huge text', () => {
    const valid = 'LUT_3D_SIZE 2\n' + '0 0 0\n'.repeat(8);
    assert.throws(() => validateCanvasCube('#' + ' '.repeat(64 * 1024 * 1024) + '\n' + valid), /LUT.*64 MiB/);
});
test('cube files are bounded before reading huge local files', async () => {
    const valid = 'LUT_3D_SIZE 2\n' + '0 0 0\n'.repeat(8);
    const cubePath = join(directory, 'oversized.cube'); await writeFile(cubePath, valid); await truncate(cubePath, 64 * 1024 * 1024 + 1);
    await assert.rejects(run(image, 'color.lut', { cubePath }), /LUT.*64 MiB/);
    assert.equal((await readdir(options().outputDirectory)).filter(file => file.endsWith('.cube')).length, 0);
});
