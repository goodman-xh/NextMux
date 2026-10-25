import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { execFile as callbackExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCanvasToolsSource } from './helpers/canvas-tools-source-loader.mjs';

const tools = await loadCanvasToolsSource();
const ui = await loadCanvasToolsSource('common/nextmux-canvas-local-image-tools.ts');
const colour = await loadCanvasToolsSource('node/nextmux-canvas-image-colour.ts');
const { ComicCanvasToolsService } = await loadCanvasToolsSource('node/nextmux-canvas-tools-service.ts');
const execFile = promisify(callbackExecFile), ffmpegPath = process.env.NEXTMUX_TEST_FFMPEG || 'ffmpeg', ffprobePath = process.env.NEXTMUX_TEST_FFPROBE || 'ffprobe';
let directory, source, reference, solid, transparent, six;
const version = (uri, id) => ({ id, assetId: `asset-${id}`, kind: 'image', uri, createdAt: '2026-10-01T00:00:00.000Z', status: 'ready' });
const run = (image, tool, parameters, extra = {}) => tools.runCanvasLocalTool({ source: image, tool, parameters }, { ffmpegPath, ffprobePath, outputDirectory: join(directory, 'outputs'), ...extra });
const pixels = async image => (await execFile(ffmpegPath, ['-v', 'error', '-i', image.uri.startsWith('file:') ? fileURLToPath(image.uri) : image.uri, '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', '-'], { encoding: 'buffer' })).stdout;
async function fixture(name, width, height, pixel) {
    const raw = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(pixel(x, y), (y * width + x) * 4);
    const pam = join(directory, `${name}.pam`), png = join(directory, `${name}.png`);
    await writeFile(pam, Buffer.concat([Buffer.from(`P7\nWIDTH ${width}\nHEIGHT ${height}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`), raw]));
    await execFile(ffmpegPath, ['-v', 'error', '-i', pam, '-frames:v', '1', png]);
    return version(png, name);
}
const sixColors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255], [0, 255, 255, 255], [255, 0, 255, 255]];
before(async () => {
    directory = await mkdtemp(join(tmpdir(), "canvas local image's tools "));
    source = await fixture('source', 32, 16, (x, y) => [40 + x * 3, 50 + y * 5, 80 + x, x < 3 ? 0 : x < 6 ? 100 : 255]);
    reference = await fixture('reference', 32, 16, (x, y) => [80 + x * 3, 35 + y * 4, 35 + x, 255]);
    solid = await fixture('solid', 16, 16, () => [100, 100, 100, 255]);
    transparent = await fixture('transparent', 16, 16, () => [255, 0, 0, 0]);
    six = await fixture('six', 60, 10, x => sixColors[Math.floor(x / 10)]);
});
after(async () => { await rm(directory, { recursive: true, force: true }); });

test('curve compiler validates all four channels and uses the post-channel master RGB curve', () => {
    assert.equal(ui.compileCanvasCurvesFilter({ red: [[0, 0], [.5, .7], [1, 1]], rgb: [[0, .1], [1, 1]] }), "curves=red='0/0 0.5/0.7 1/1':master='0/0.1 1/1'");
    assert.equal(ui.compileCanvasCurvesFilter({}), "curves=master='0/0 1/1'");
    for (const input of [{ rgb: [[0, 0], [0, 1]] }, { blue: [[.1, 0], [1, 1]] }, { green: [[0, 0], [1, NaN]] }, { red: [[0, 0]] }, { unknown: [] }, { rgb: [[0, 0], ['1', 1]] }]) assert.throws(() => ui.compileCanvasCurvesFilter(input), error => error.code === 'INVALID_TOOL_INPUT');
});
test('real RGB/R/G/B curves alter pixels while identity curves and transparency are preserved', async () => {
    const original = await pixels(source);
    const identity = (await run(source, 'color.curves', ui.CANVAS_LOCAL_IMAGE_TOOL_DEFAULTS.curves)).versions[0];
    assert.deepEqual(await pixels(identity), original);
    for (const channel of ['rgb', 'red', 'green', 'blue']) {
        const output = (await run(source, 'color.curves', { [channel]: [[0, 0], [.5, .85], [1, 1]] })).versions[0], actual = await pixels(output);
        assert.notDeepEqual(actual, original, channel);
        for (let i = 3; i < actual.length; i += 4) assert.equal(actual[i], original[i], `${channel} alpha`);
        assert.deepEqual([output.metadata.width, output.metadata.height], [32, 16]);
        assert.equal(output.provenance.tool, 'color.curves');
    }
});
test('Lab colour conversion round-trips sRGB and moments ignore invisible colour', () => {
    for (const rgb of [[0, 0, 0], [1, 1, 1], [.8, .1, .3], [.1, .6, .8]]) {
        const actual = colour.canvasLabToRgb(colour.canvasRgbToLab(rgb));
        actual.forEach((value, i) => assert.ok(Math.abs(value - rgb[i]) < .00001));
    }
    const a = colour.canvasLabStatistics(Uint8Array.from([200, 80, 20, 255]));
    assert.deepEqual(colour.canvasLabStatistics(Uint8Array.from([200, 80, 20, 255, 0, 0, 255, 0])), a);
    assert.deepEqual(a.standardDeviation, [0, 0, 0]);
    assert.throws(() => colour.canvasLabStatistics(Uint8Array.from([200, 80, 20, 0])), /no visible/);
    const output = colour.canvasTransferRgb([.4, .4, .4], a, a); assert.ok(output.every(Number.isFinite));
});
test('transfer parameter validation and a generated cube are pure and deterministic', () => {
    const stats = colour.canvasLabStatistics(Uint8Array.from([200, 80, 20, 255, 40, 120, 180, 255]));
    const a = colour.buildCanvasColorTransferCube(stats, stats, {}, 5);
    assert.equal(a, colour.buildCanvasColorTransferCube(stats, stats, {}, 5)); assert.equal(tools.validateCanvasCube(a), 5);
    assert.deepEqual(colour.canvasTransferRgb([.2, .3, .4], stats, stats, { strength: 0 }), [.2, .3, .4]);
    assert.throws(() => colour.buildCanvasColorTransferCube(stats, stats, { strength: 2 }), /strength/);
    assert.throws(() => colour.buildCanvasColorTransferCube(stats, stats, { preserveLuminance: 'yes' }), /boolean/);
});
test('real colour transfer matches reference moments, preserves alpha, hashes and both source identities', async () => {
    const before = await readFile(source.uri), original = await pixels(source), ref = await pixels(reference);
    const out = (await run(source, 'color.transfer', { reference, strength: 1 })).versions[0], actual = await pixels(out);
    const sourceStats = colour.canvasLabStatistics(original), referenceStats = colour.canvasLabStatistics(ref), outputStats = colour.canvasLabStatistics(actual);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(outputStats.mean[i] - referenceStats.mean[i]) < 2, `Lab mean ${i}: ${outputStats.mean[i]} != ${referenceStats.mean[i]}`);
    for (let i = 3; i < actual.length; i += 4) assert.equal(actual[i], original[i]);
    assert.deepEqual(out.provenance.sourceVersionIds, [source.id, reference.id]); assert.equal(out.metadata.colorTransfer.algorithm, 'lab-moments-d65-v1');
    assert.deepEqual(out.metadata.colorTransfer.source, sourceStats); assert.match(out.metadata.sha256, /^[a-f\d]{64}$/);
    assert.deepEqual(await readFile(source.uri), before); assert.ok(!(await readdir(join(directory, 'outputs'))).some(name => name.endsWith('.cube')));
    const identity = (await run(source, 'color.transfer', { reference, strength: 0 })).versions[0]; assert.deepEqual(await pixels(identity), original);
    const preserved = (await run(source, 'color.transfer', { reference, preserveLuminance: true })).versions[0];
    assert.ok(Math.abs(colour.canvasLabStatistics(await pixels(preserved)).mean[0] - sourceStats.mean[0]) < 1);
});
test('solid images stay finite; invisible references and changed reference bytes fail without partial files', async () => {
    const target = await fixture('solid-target', 16, 16, () => [180, 70, 35, 255]);
    const output = (await run(solid, 'color.transfer', { reference: target })).versions[0], rgb = await pixels(output);
    assert.ok(Math.abs(rgb[0] - 180) <= 2 && Math.abs(rgb[1] - 70) <= 2 && Math.abs(rgb[2] - 35) <= 2);
    const outputDirectory = join(directory, 'invalid-transfer');
    await assert.rejects(run(source, 'color.transfer', { reference: transparent }, { outputDirectory }), /no visible pixels/);
    await assert.rejects(run(source, 'color.transfer', { reference: { ...reference, metadata: { sha256: '0'.repeat(64) } } }, { outputDirectory }), error => error.code === 'SOURCE_BYTES_CHANGED');
    assert.deepEqual(await readdir(outputDirectory), []);
});
test('palette k-means deterministically extracts visible colours with percentages totalling 100', async () => {
    const rgba = await pixels(six), palette = colour.extractCanvasPalette(rgba, 6, 60, 10);
    assert.equal(palette.algorithm, 'lab-kmeans-v1'); assert.deepEqual(palette, colour.extractCanvasPalette(rgba, 6, 60, 10));
    assert.deepEqual(palette.colors.map(color => color.hex).sort(), ['#0000FF', '#00FF00', '#00FFFF', '#FF0000', '#FF00FF', '#FFFF00']);
    assert.ok(Math.abs(palette.colors.reduce((sum, color) => sum + color.percentage, 0) - 100) < .000001);
    assert.deepEqual(colour.extractCanvasPalette(Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 0]), 8).colors, [{ hex: '#FF0000', percentage: 100 }]);
    assert.throws(() => colour.extractCanvasPalette(rgba, 4), /5..8/); assert.throws(() => colour.extractCanvasPalette(rgba, 9), /5..8/);
    assert.throws(() => colour.extractCanvasPalette(rgba, 6, 1, 1), /dimensions/);
});
test('real palette operation creates a swatch PNG with palette metadata and preserves the source', async () => {
    const before = await readFile(six.uri), output = (await run(six, 'image.paletteExtract', { colorCount: 6 })).versions[0];
    assert.deepEqual([output.metadata.width, output.metadata.height, output.metadata.palette.colors.length], [384, 64, 6]);
    assert.deepEqual([output.metadata.palette.sampleWidth, output.metadata.palette.sampleHeight], [60, 10]);
    assert.equal(output.provenance.sourceVersionId, six.id); assert.match(output.metadata.sha256, /^[a-f\d]{64}$/);
    const rgba = await pixels(output);
    output.metadata.palette.colors.forEach((color, index) => assert.equal('#' + [...rgba.subarray(index * 64 * 4, index * 64 * 4 + 3)].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase(), color.hex));
    const monochrome = (await run(solid, 'image.paletteExtract', { colorCount: 8 })).versions[0]; assert.equal(monochrome.metadata.palette.colors.length, 1);
    assert.deepEqual(await readFile(six.uri), before); assert.ok(!(await readdir(join(directory, 'outputs'))).some(name => name.endsWith('.ppm')));
    await assert.rejects(run(transparent, 'image.paletteExtract'), /no visible pixels/);
});
test('grid UI supplies all 15 layouts, version-ID cells, empty spaces and validated dimensions', () => {
    assert.equal(ui.CANVAS_GRID_STITCH_LAYOUTS.length, 15);
    const draft = ui.buildCanvasGridStitchDraft([source, reference], { rows: 2, columns: 2, cellWidth: 16, cellHeight: 16, gap: 3, background: '#abcdef', cells: [reference.id, null, source.id, reference.id] });
    assert.deepEqual([draft.sourceVersionId, draft.width, draft.height], [reference.id, 35, 35]); assert.equal(draft.parameters.background, '#ABCDEF');
    assert.deepEqual(ui.buildCanvasGridStitchDraft([source]).parameters.cells, [source.id, null, null, null]);
    assert.throws(() => ui.buildCanvasGridStitchDraft([source], { cells: ['missing'] }), /selected ready/);
    assert.throws(() => ui.buildCanvasGridStitchDraft([source], { rows: 0 }), /rows/);
    assert.throws(() => ui.buildCanvasGridStitchDraft([source], { rows: 20, columns: 20, cellWidth: 8192, cellHeight: 8192 }), /64 megapixels/);
});
test('grid stitch uses actual assigned cells, repeated images, gaps and empty-cell background', async () => {
    const red = await fixture('red', 8, 8, () => [255, 0, 0, 255]);
    const out = (await run(red, 'image.gridStitch', { rows: 2, columns: 2, cellWidth: 8, cellHeight: 8, gap: 3, background: '#334455', cells: [red, null, null, red] })).versions[0];
    assert.deepEqual([out.metadata.width, out.metadata.height], [19, 19]);
    const rgba = await pixels(out), rgb = (x, y) => [...rgba.subarray((y * 19 + x) * 4, (y * 19 + x) * 4 + 3)];
    assert.ok(rgb(2, 2)[0] > 240); assert.ok(rgb(16, 16)[0] > 240);
    for (const pixel of [rgb(16, 2), rgb(2, 16), rgb(10, 10)]) pixel.forEach((value, i) => assert.ok(Math.abs(value - [51, 68, 85][i]) < 4));
});
test('local image labels and all parameter hints cover 12 locales', () => {
    assert.equal(ui.CANVAS_LOCAL_IMAGE_TOOL_LOCALES.length, 12);
    for (const locale of ui.CANVAS_LOCAL_IMAGE_TOOL_LOCALES) for (const key of ['curves', 'curvesHint', 'transfer', 'transferHint', 'paletteExtract', 'paletteExtractHint', 'gridStitch', 'gridStitchHint', 'rgb', 'red', 'green', 'blue', 'strength', 'referenceImage', 'preserveLuminance', 'colorCount', 'rows', 'columns', 'gap', 'background', 'cellWidth', 'cellHeight', 'cells']) assert.ok(ui.canvasLocalImageToolText(locale, key)?.trim(), `${locale}.${key}`);
    assert.equal(ui.canvasLocalImageToolText('unknown', 'curves'), 'Curves');
});
test('service resolves colour reference IDs from the canvas and rejects replacement during processing', async () => {
    const sourceNode = { id: 'source-node', kind: 'image', title: 'Source', position: { x: 0, y: 0 }, size: { width: 200, height: 200 }, payload: { versions: [source] } };
    const referenceNode = { ...sourceNode, id: 'reference-node', payload: { versions: [reference] } };
    let canvas = { id: 'test', revision: 1, nodes: [sourceNode, referenceNode] }, seen;
    const store = { read: async () => ({ canvas: structuredClone(canvas) }), mutate: async callback => { canvas = await callback(structuredClone(canvas)); } };
    const service = new ComicCanvasToolsService(directory, store, {}, async request => {
        seen = request; canvas.nodes[1].payload.versions[0] = { ...reference, uri: 'replacement.png' };
        return { versions: [{ ...source, id: 'new', metadata: { width: 32, height: 16 } }] };
    });
    const request = { requestId: 'transfer-click', tool: 'color.transfer', nodeId: sourceNode.id, sourceVersionId: source.id, expectedRevision: 1, parameters: { referenceVersionId: reference.id, strength: .5 } };
    const result = await service.run(request);
    assert.equal(seen.parameters.reference.id, reference.id); assert.match(seen.parameters.reference.uri, /^file:/); assert.equal(result.error.code, 'SOURCE_VERSION_CHANGED'); assert.equal(canvas.nodes.length, 2);
    const missing = await service.run({ ...request, requestId: 'missing-ref', parameters: { referenceVersionId: 'missing' } }); assert.equal(missing.error.code, 'SOURCE_VERSION_MISSING');
});

test('the curve editor and preview sample the same natural cubic spline FFmpeg renders', async () => {
    const curves = { rgb: [[0, 0], [0.45, 0.62], [1, 1]], red: [[0, 0.05], [0.3, 0.2], [0.5, 0.4], [0.8, 0.95], [1, 1]] };
    const ramp = Buffer.alloc(256 * 3);
    for (let index = 0; index < 256; index++) ramp.fill(index, index * 3, index * 3 + 3);
    const out = join(directory, 'ramp-curves.raw'), input = join(directory, 'ramp.raw');
    await writeFile(input, ramp);
    await execFile(ffmpegPath, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '256x1', '-i', input, '-vf', ui.compileCanvasCurvesFilter(curves), '-f', 'rawvideo', '-pix_fmt', 'rgb24', out]);
    const rendered = await readFile(out);
    const master = ui.canvasCurveSampler(curves.rgb), red = ui.canvasCurveSampler(curves.red);
    let worst = 0;
    for (let index = 0; index < 256; index++) {
        worst = Math.max(worst, Math.abs(rendered[index * 3] - master(red(index / 255)) * 255), Math.abs(rendered[index * 3 + 1] - master(index / 255) * 255));
    }
    assert.ok(worst <= 2.5, `preview differs from FFmpeg by ${worst.toFixed(2)} levels`);
    // Two points are a straight line; a spline that overshoots is clipped to 0..1 like the filter.
    assert.equal(ui.canvasCurveSampler([[0, 0], [1, 1]])(0.25), 0.25);
    const steep = ui.canvasCurveSampler([[0, 0], [0.2, 1], [1, 1]]), samples = Array.from({ length: 101 }, (_, index) => steep(index / 100));
    assert.equal(Math.max(...samples), 1); assert.ok(Math.min(...samples) >= 0);
});
