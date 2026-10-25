import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { PNG } from 'pngjs';
import { loadCanvasToolsSource } from './helpers/canvas-tools-source-loader.mjs';

const { processCanvasOnDevicePng, downloadCanvasOnDeviceModel } = await loadCanvasToolsSource('node/nextmux-canvas-on-device.ts');
const { CANVAS_ON_DEVICE_MODELS } = await loadCanvasToolsSource('common/nextmux-canvas-on-device-models.ts');
const { runCanvasLocalTool } = await loadCanvasToolsSource();

function sourcePng() {
    const png = new PNG({ width: 3, height: 2 });
    for (let i = 0; i < 6; i++) png.data.set([10 + i, 70 + i, 130 + i, 255], i * 4);
    return PNG.sync.write(png);
}
const mask = { data: new Float32Array([0, .5, 1, 0, .5, 1]), dims: [1, 1, 2, 3] };

test('mocked matting inference produces a real RGBA PNG at source dimensions with background transparency', async () => {
    let calls = 0;
    const bytes = await processCanvasOnDevicePng('image.matting', sourcePng(), { infer: async (model, input, dims) => {
        calls++;
        assert.equal(model.id, CANVAS_ON_DEVICE_MODELS['image.matting'].id);
        assert.equal(input.length, dims.reduce((total, dimension) => total * dimension, 1));
        assert.deepEqual(dims.slice(0, 2), [1, 3]);
        return mask;
    } });
    const decoded = PNG.sync.read(bytes, { checkCRC: true }), original = PNG.sync.read(sourcePng());
    assert.equal(calls, 1);
    assert.equal(bytes[25], 6, 'PNG IHDR color type explicitly contains alpha');
    assert.deepEqual([decoded.width, decoded.height], [3, 2]);
    assert.equal(decoded.data[3], 0);
    assert.equal(decoded.data[11], 255);
    assert.ok(decoded.data[7] > 0 && decoded.data[7] < 255);
    for (let i = 0; i < 6; i++) assert.deepEqual(decoded.data.subarray(i * 4, i * 4 + 3), original.data.subarray(i * 4, i * 4 + 3));
});

test('matting multiplies the inferred mask by existing transparent and partial source alpha', async () => {
    const image = new PNG({ width: 3, height: 2 }), alphas = [0, 32, 64, 128, 192, 255];
    for (let pixel = 0; pixel < alphas.length; pixel++) image.data.set([20 + pixel, 80 + pixel, 140 + pixel, alphas[pixel]], pixel * 4);
    const result = PNG.sync.read(await processCanvasOnDevicePng('image.matting', PNG.sync.write(image), {
        infer: async () => ({ data: new Float32Array(6).fill(.5), dims: [1, 1, 2, 3] })
    }));
    for (let pixel = 0; pixel < alphas.length; pixel++) {
        assert.deepEqual(result.data.subarray(pixel * 4, pixel * 4 + 3), image.data.subarray(pixel * 4, pixel * 4 + 3));
        assert.equal(result.data[pixel * 4 + 3], Math.round(alphas[pixel] * .5));
    }
});

test('matting preserves source PNG gamma and pixels while depth keeps its own grayscale semantics', async () => {
    const image = new PNG({ width: 3, height: 2 });
    image.gamma = 1;
    for (let pixel = 0; pixel < 6; pixel++) image.data.set([32 + pixel, 64 + pixel, 128 + pixel, pixel * 51], pixel * 4);
    const source = PNG.sync.write(image);
    const matting = PNG.sync.read(await processCanvasOnDevicePng('image.matting', source, {
        infer: async () => ({ data: new Float32Array(6).fill(1), dims: [1, 1, 2, 3] })
    }));
    assert.equal(matting.gamma, image.gamma);
    assert.deepEqual(matting.data, image.data, 'source RGB and alpha stay unchanged under an opaque mask');
    const depth = PNG.sync.read(await processCanvasOnDevicePng('image.depth', source, { infer: async () => mask }));
    assert.equal(depth.gamma, 0, 'relative-depth values must not inherit the source display gamma');
    for (let pixel = 0; pixel < 6; pixel++) {
        const offset = pixel * 4;
        assert.equal(depth.data[offset], depth.data[offset + 1]);
        assert.equal(depth.data[offset], depth.data[offset + 2]);
        assert.equal(depth.data[offset + 3], 255);
    }
});

test('U2 inputs normalize by RGB maximum while depth uses 255, and black inputs stay finite', async () => {
    const image = new PNG({ width: 1, height: 1 }); image.data.set([32, 64, 128, 255]);
    const means = [.485, .456, .406], deviations = [.229, .224, .225];
    for (const tool of ['image.matting', 'image.depth']) {
        let calls = 0;
        await processCanvasOnDevicePng(tool, PNG.sync.write(image), { infer: async (_model, input, dims) => {
            calls++;
            const plane = dims[2] * dims[3], divisor = tool === 'image.matting' ? 128 : 255;
            for (const [channel, value] of [32, 64, 128].entries()) {
                assert.ok(Math.abs(input[channel * plane] - (value / divisor - means[channel]) / deviations[channel]) < 1e-5,
                    `${tool} channel ${channel} uses its expected RGB scaling, excluding alpha`);
            }
            return { data: new Float32Array([1]), dims: [1, 1, 1, 1] };
        } });
        assert.equal(calls, 1);
    }
    image.data.set([0, 0, 0, 255]);
    await processCanvasOnDevicePng('image.matting', PNG.sync.write(image), { infer: async (_model, input, dims) => {
        const plane = dims[2] * dims[3];
        assert.ok(input.every(Number.isFinite));
        for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(input[channel * plane] + means[channel] / deviations[channel]) < 1e-5);
        return { data: new Float32Array([1]), dims: [1, 1, 1, 1] };
    } });
});

test('depth inference outputs a grayscale PNG with near bright and an invert option at source aspect', async () => {
    const normal = PNG.sync.read(await processCanvasOnDevicePng('image.depth', sourcePng(), { infer: async () => mask }));
    const inverted = PNG.sync.read(await processCanvasOnDevicePng('image.depth', sourcePng(), { invert: true, infer: async () => mask }));
    assert.deepEqual([normal.width, normal.height], [3, 2]);
    assert.ok(normal.data[0] < normal.data[8], 'larger inverse depth is brighter');
    for (let i = 0; i < 6; i++) {
        const offset = i * 4;
        assert.equal(normal.data[offset], normal.data[offset + 1]);
        assert.equal(normal.data[offset], normal.data[offset + 2]);
        assert.equal(normal.data[offset + 3], 255);
        assert.ok(Math.abs(normal.data[offset] + inverted.data[offset] - 255) <= 1);
    }
});

test('cancellation before and during inference rejects without producing PNG results', async () => {
    const preCancelled = new AbortController(); preCancelled.abort(); let calls = 0;
    await assert.rejects(processCanvasOnDevicePng('image.matting', sourcePng(), {
        signal: preCancelled.signal, infer: async () => { calls++; return mask; }
    }), { code: 'CANCELLED' });
    assert.equal(calls, 0);
    const running = new AbortController();
    await assert.rejects(processCanvasOnDevicePng('image.depth', sourcePng(), {
        signal: running.signal, infer: async (_model, _input, _dims, signal) => {
            assert.equal(signal, running.signal); running.abort(); return mask;
        }
    }), { code: 'CANCELLED' });
});

test('model download rejects a checksum mismatch and leaves no model or temporary file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'canvas-model-checksum-'));
    const bytes = Buffer.from('wrong model');
    try {
        await assert.rejects(downloadCanvasOnDeviceModel({ ...CANVAS_ON_DEVICE_MODELS['image.matting'], id: 'fixture-model',
            byteLength: bytes.length, sha256: '0'.repeat(64) }, {
            modelDirectory: directory, fetchImpl: async () => new Response(bytes, { headers: { 'content-length': String(bytes.length) } })
        }), /checksum|sha.?256/i);
        assert.deepEqual(await readdir(directory), []);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('model download reports real bytes, atomically caches verified weights and reuses them offline', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'canvas-model-cache-'));
    const bytes = Buffer.from('verified model bytes'), progress = [];
    const model = { ...CANVAS_ON_DEVICE_MODELS['image.depth'], id: 'fixture-depth', byteLength: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') };
    try {
        const path = await downloadCanvasOnDeviceModel(model, {
            modelDirectory: directory, onProgress: item => progress.push(item),
            fetchImpl: async () => new Response(bytes, { headers: { 'content-length': String(bytes.length) } })
        });
        assert.deepEqual(await readFile(path), bytes);
        assert.ok(progress.some(item => item.downloadedBytes === bytes.length && item.totalBytes === bytes.length));
        assert.equal((await readdir(directory)).length, 1);
        const cached = await downloadCanvasOnDeviceModel(model, { modelDirectory: directory,
            fetchImpl: async () => { throw new Error('A verified cached model must work offline'); } });
        assert.equal(cached, path);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('user cancellation of a streamed model download removes incomplete files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'canvas-model-cancel-')), controller = new AbortController();
    try {
        await assert.rejects(downloadCanvasOnDeviceModel({ ...CANVAS_ON_DEVICE_MODELS['image.depth'], id: 'fixture-cancel', byteLength: 16 }, {
            modelDirectory: directory, signal: controller.signal,
            onProgress: item => { if (item.downloadedBytes > 0) controller.abort(); },
            fetchImpl: async (_url, options) => {
                assert.equal(options.signal, controller.signal);
                return new Response(new ReadableStream({ start(stream) { stream.enqueue(new Uint8Array([1, 2, 3])); } }),
                    { headers: { 'content-length': '16' } });
            }
        }), { code: 'CANCELLED' });
        assert.deepEqual(await readdir(directory), []);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('local image tools verify the immutable source hash before model lookup or FFmpeg probing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'canvas-on-device-source-'));
    try {
        const path = join(directory, 'source.png'); await writeFile(path, sourcePng());
        const source = { id: 'source-v1', assetId: 'source-asset', kind: 'image', uri: path, createdAt: '2026-10-01T00:00:00.000Z',
            metadata: { sha256: '0'.repeat(64) } };
        await assert.rejects(runCanvasLocalTool({ source, tool: 'image.depth', parameters: { invert: true } }, {
            outputDirectory: join(directory, 'outputs'), modelDirectory: join(directory, 'models'),
            ffmpegPath: join(directory, 'missing-ffmpeg'), ffprobePath: join(directory, 'missing-ffprobe')
        }), { code: 'SOURCE_BYTES_CHANGED' });
        assert.deepEqual(await readdir(directory), ['source.png']);
    } finally { await rm(directory, { recursive: true, force: true }); }
});


test('video range smoothing carries only job-local normalization while single images stay independent', async () => {
    const history = {}, source = sourcePng();
    const frame = async (min, max, depthNormalization) => PNG.sync.read(await processCanvasOnDevicePng('image.depth', source, {
        depthNormalization, infer: async () => ({ data: new Float32Array([min, (min + max) / 2, max, min, (min + max) / 2, max]), dims: [1, 1, 2, 3] })
    }));
    await frame(0, 10, history);
    const smoothed = await frame(5, 15, history), independent = await frame(5, 15);
    assert.deepEqual(history, { min: 1, max: 11 });
    assert.ok(smoothed.data[0] > independent.data[0]); assert.equal(independent.data[0], 0);
    const another = await frame(5, 15, {}); assert.deepEqual(another.data, independent.data);
});
