import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { deflateSync, gzipSync } from 'node:zlib';
import test from 'node:test';
import ts from 'typescript';
import { createCanvasDocument, createGenerationSnapshot, normalizeScene, normalizeWorld, resolveCanvasInputs, validateCanvasDocument } from '@nextmux/comic-core';
import { ComicCanvasStore } from '../lib/node/nextmux-canvas-store.js';
const require = createRequire(import.meta.url);
async function loadSource(file, dependencies = {}) {
    const source = await readFile(new URL(`../src/node/${file}.ts`, import.meta.url), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {};
    new Function('require', 'exports', output)(name => dependencies[name] || require(name.startsWith('./') ? `../lib/node/${name.slice(2)}.js` : name), exports);
    return exports;
}
const media = await loadSource('nextmux-director-media');
const uploads = await loadSource('nextmux-director-uploads', { './nextmux-director-media': media });
const { ComicDirectorService } = await loadSource('nextmux-director-service', { './nextmux-director-media': media, './nextmux-director-uploads': uploads });
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const execute = promisify(execFile), now = '2026-10-01T12:00:00.000Z';
const scene = normalizeScene({ schemaVersion: 2, objects: [], keys: [], duration: 24, fps: 24 });
const camera = { position: { x: 0, y: 1, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 }, fov: 50 };
function crc(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0); }
    return (value ^ 0xffffffff) >>> 0;
}
function chunk(tag, body) {
    const result = Buffer.alloc(body.length + 12); result.writeUInt32BE(body.length); result.write(tag, 4, 'ascii'); body.copy(result, 8);
    result.writeUInt32BE(crc(result.subarray(4, result.length - 4)), result.length - 4); return result;
}
function png(width = 2, height = 2, validRaster = true) {
    const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
        chunk('IDAT', deflateSync(validRaster ? Buffer.alloc((width * 4 + 1) * height) : Buffer.from([9]))), chunk('IEND', Buffer.alloc(0))]);
}
function glb(value = { asset: { version: '2.0' }, scenes: [{ nodes: [] }], nodes: [] }, bin) {
    const json = Buffer.from(JSON.stringify(value)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded);
    const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
    header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length + (bin ? bin.length + 8 : 0), 8);
    jsonHeader.writeUInt32LE(padded.length); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
    binHeader.writeUInt32LE(bin?.length || 0); binHeader.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([header, jsonHeader, padded, ...(bin ? [binHeader, bin] : [])]);
}
async function fixture(options = {}) {
    const root = await mkdtemp(join(tmpdir(), 'director-service-')), store = new ComicCanvasStore(root);
    const canvas = createCanvasDocument({ id: 'director-canvas', projectId: 'project-director', now });
    const state = await store.save({ ...canvas, nodes: [{ id: 'director', title: 'Director', kind: 'sceneComposer', position: { x: 0, y: 0 }, size: { width: 320, height: 240 }, payload: { scene, versions: [] } }] }, 0, canvas.projectId);
    const service = new ComicDirectorService(root, store, { runtime: async () => ({ ffmpegPath }), ...options });
    const capture = { sourceNodeId: 'director', captureId: 'capture-1', expectedRevision: state.canvas.revision, kind: 'image', mimeType: 'image/png', dataBase64: png().toString('base64'), scene, camera, frame: 0, title: 'Image' };
    return { root, store, service, capture, clean: () => rm(root, { recursive: true, force: true }) };
}

test('screenshot writes a real PNG version and provenance edge, with no FFmpeg dependency', async () => {
    const f = await fixture({ runtime: () => { throw new Error('A screenshot must not resolve FFmpeg'); } });
    try {
        const first = f.service.saveCapture(f.capture), same = f.service.saveCapture(f.capture); assert.equal(first, same);
        const result = await first; assert.equal(result.version.kind, 'image'); assert.equal(result.version.metadata.mimeType, 'image/png');
        assert.deepEqual(await readFile(join(f.root, result.version.uri)), png());
        assert.deepEqual(media.validateDirectorPng(await readFile(join(f.root, result.version.uri))), { width: 2, height: 2 });
        assert.deepEqual(result.version.provenance.directorCapture.scene, scene); assert.equal(result.version.provenance.sourceNodeId, 'director');
        assert.equal(result.state.canvas.nodes.length, 2); assert.equal(result.state.canvas.edges[0].role, 'referenceImage');
        assert.equal(result.state.canvas.edges[0].binding, 'pinnedVersion'); assert.equal(result.state.canvas.edges[0].pinnedVersionId, result.version.id);
        assert.equal(result.state.canvas.nodes[0].payload.currentVersionId, result.version.id);
        assert.equal(result.state.canvas.nodes[0].payload.versions[0].id, result.version.id);
        assert.deepEqual(validateCanvasDocument(result.state.canvas), []);
        await f.store.mutate(current => ({ ...current, title: 'Concurrent change' }));
        const restarted = new ComicDirectorService(f.root, f.store, { runtime: () => { throw new Error('Recovery must not resolve binaries'); } });
        const recovered = await restarted.saveCapture(f.capture);
        assert.equal(recovered.nodeId, result.nodeId); assert.equal(recovered.state.canvas.title, 'Concurrent change'); assert.equal(recovered.state.canvas.nodes.length, 2);
        await assert.rejects(restarted.saveCapture({ ...f.capture, frame: 1 }), error => error.code === 'DIRECTOR_CAPTURE_ID_CONFLICT');
    } finally { await f.clean(); }
});
test('capture rejects stale revisions, invalid cameras and false PNG MIME before writing assets', async () => {
    const f = await fixture();
    try {
        for (const capture of [{ ...f.capture, expectedRevision: 0 }, { ...f.capture, camera: { ...camera, fov: NaN } },
            { ...f.capture, mimeType: 'image/jpeg' }, { ...f.capture, frame: 25 }, { ...f.capture, dataBase64: '!!!!' }]) await assert.rejects(f.service.saveCapture(capture));
        assert.equal((await f.store.read()).canvas.nodes.length, 1);
        await assert.rejects(readdir(join(f.root, 'nextmux.media')));
    } finally { await f.clean(); }
});
test('world screenshots retain the imported world snapshot and historical edges stay pinned after another capture', async () => {
    const f = await fixture();
    try {
        const world = normalizeWorld({ schemaVersion: 1, kind: 'model', format: 'glb', uri: 'nextmux.media/director-models/original.glb' });
        const saved = await f.store.mutate(current => ({ ...current, nodes: [{ ...current.nodes[0], kind: 'world', payload: { world, versions: [] } }] }));
        const first = await f.service.saveCapture({ ...f.capture, expectedRevision: saved.canvas.revision });
        assert.deepEqual(first.version.provenance.directorCapture.world, world);
        const second = await f.service.saveCapture({ ...f.capture, captureId: 'capture-2', expectedRevision: first.state.canvas.revision, frame: 1 });
        assert.equal(second.state.canvas.nodes[0].payload.currentVersionId, second.version.id);
        assert.equal(second.state.canvas.edges[0].pinnedVersionId, first.version.id);
        assert.equal(second.state.canvas.edges[1].pinnedVersionId, second.version.id);
        assert.deepEqual(validateCanvasDocument(second.state.canvas), []);
    } finally { await f.clean(); }
});
test('mixed scene and world captures preserve pinned history while follow-current generation rejects an incompatible current type', async () => {
    for (const sourceKind of ['sceneComposer', 'world']) {
        const f = await fixture();
        try {
            if (sourceKind === 'world') await f.store.mutate(current => ({ ...current, nodes: [{ ...current.nodes[0], kind: 'world', payload: { world: normalizeWorld({ kind: 'empty', scene }), versions: [] } }] }));
            const first = await f.service.saveCapture({ ...f.capture, expectedRevision: (await f.store.read()).canvas.revision });
            const connected = await f.store.mutate(current => ({ ...current,
                nodes: [...current.nodes, { id: 'image-generator', kind: 'imageGen', title: 'Image generator', position: { x: 800, y: 0 }, size: { width: 320, height: 240 },
                    payload: { mode: 'imageToImage', modelId: 'configured-image-model', prompt: 'Render the scene', parameters: {}, versions: [] } }],
                edges: [...current.edges, { id: 'following-image', sourceNodeId: 'director', sourcePort: 'output', targetNodeId: 'image-generator', targetPort: 'referenceImage',
                    role: 'referenceImage', order: 0, binding: 'followCurrent' }] }));
            assert.equal(resolveCanvasInputs(connected.canvas, 'image-generator').inputs[0].versionId, first.version.id);
            const input = join(f.root, 'mixed-fixture.webm');
            await execute(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-f', 'lavfi', '-i', 'color=c=blue:s=64x48:r=24:d=0.25', '-c:v', 'libvpx', '-an', input]);
            const video = await f.service.saveCapture({ ...f.capture, captureId: 'mixed-video', expectedRevision: connected.canvas.revision,
                kind: 'video', mimeType: 'video/webm;codecs=vp8', dataBase64: (await readFile(input)).toString('base64'), endFrame: 6 });
            assert.deepEqual(validateCanvasDocument(video.state.canvas), []);
            assert.equal(video.state.canvas.nodes[0].payload.currentVersionId, video.version.id);
            assert.equal(video.state.canvas.edges.find(edge => edge.id === 'following-image').binding, 'followCurrent');
            assert.equal(resolveCanvasInputs(video.state.canvas, first.nodeId).inputs[0].versionId, first.version.id);
            assert.equal(resolveCanvasInputs(video.state.canvas, video.nodeId).inputs[0].versionId, video.version.id);
            assert.equal(resolveCanvasInputs(video.state.canvas, 'image-generator').missing[0].reason, 'incompatibleType');
            assert.throws(() => createGenerationSnapshot(video.state.canvas, 'image-generator', { capabilityVersion: 'v1' }), error => error.code === 'MISSING_INPUT');
            const image = await f.service.saveCapture({ ...f.capture, captureId: 'mixed-image', expectedRevision: video.state.canvas.revision, frame: 1 });
            assert.deepEqual(validateCanvasDocument(image.state.canvas), []);
            assert.equal(resolveCanvasInputs(image.state.canvas, 'image-generator').inputs[0].versionId, image.version.id);
            assert.equal(resolveCanvasInputs(image.state.canvas, first.nodeId).inputs[0].versionId, first.version.id);
            assert.equal(resolveCanvasInputs(image.state.canvas, video.nodeId).inputs[0].versionId, video.version.id);
            assert.equal(image.state.canvas.nodes[0].payload.versions.length, 3);
        } finally { await f.clean(); }
    }
});
test('capture cleanup removes bytes if source is removed while waiting for the canvas lock', async () => {
    const f = await fixture(), original = f.store.mutate.bind(f.store);
    f.store.mutate = async operation => { await original(current => ({ ...current, nodes: [] })); return original(operation); };
    try {
        await assert.rejects(f.service.saveCapture(f.capture), error => error.code === 'DIRECTOR_SOURCE_REQUIRED');
        assert.deepEqual(await readdir(join(f.root, 'nextmux.media', 'director-captures')), []);
    } finally { await f.clean(); }
});
test('self-contained GLB and glTF imports use hashed project paths and reject remote or missing dependencies', async () => {
    const f = await fixture();
    try {
        const binary = glb({ asset: { version: '2.0' }, buffers: [{ byteLength: 4 }], bufferViews: [{ buffer: 0, byteLength: 4 }], scenes: [] }, Buffer.from([0, 0, 0, 0]));
        const imported = await f.service.importModel({ name: '../user model.glb', mimeType: 'model/gltf-binary', dataBase64: binary.toString('base64') });
        assert.match(imported.uri, /^nextmux\.media\/director-models\/[a-f0-9]{64}\.glb$/); assert.equal(imported.kind, 'model');
        assert.deepEqual(await readFile(join(f.root, imported.uri)), binary);
        assert.deepEqual(await f.service.importModel({ name: 'again.glb', mimeType: '', dataBase64: binary.toString('base64') }), imported);
        const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ byteLength: 4, uri: 'data:application/octet-stream;base64,AAAAAA==' }] }));
        assert.equal((await f.service.importModel({ name: 'embedded.gltf', mimeType: 'application/json', dataBase64: json.toString('base64') })).mimeType, 'model/gltf+json');
        for (const uri of ['https://example.com/texture.png', '../texture.png', 'file:///tmp/texture.png', 'data:text/html;base64,WA==']) {
            await assert.rejects(f.service.importModel({ name: 'unsafe.gltf', mimeType: '', dataBase64: Buffer.from(JSON.stringify({ asset: { version: '2.0' }, images: [{ uri }] })).toString('base64') }), error => error.code === 'DIRECTOR_MEDIA_INVALID');
        }
        await assert.rejects(f.service.importModel({ name: 'bad.glb', mimeType: 'image/png', dataBase64: binary.toString('base64') }));
        await assert.rejects(f.service.importModel({ name: 'bad.glb', mimeType: '', dataBase64: glb({ asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'] }).toString('base64') }));
        await assert.rejects(f.service.importModel({ name: 'optional.glb', mimeType: '', dataBase64: glb({ asset: { version: '2.0' }, extensionsUsed: ['KHR_draco_mesh_compression'] }).toString('base64') }));
    } finally { await f.clean(); }
});
test('project directory and existing hashed-file symlinks are rejected without writing outside the project', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'director-outside-'));
    try {
        for (const part of ['nextmux.media', 'director-models']) {
            const f = await fixture();
            try {
                if (part === 'director-models') await mkdir(join(f.root, 'nextmux.media'));
                await symlink(outside, part === 'nextmux.media' ? join(f.root, part) : join(f.root, 'nextmux.media', part));
                await assert.rejects(f.service.importModel({ name: 'model.glb', mimeType: '', dataBase64: glb().toString('base64') }), error => error.code === 'DIRECTOR_PROJECT_PATH');
                assert.deepEqual(await readdir(outside), []);
            } finally { await f.clean(); }
        }
        const f = await fixture();
        try {
            const bytes = glb(), path = join(f.root, 'nextmux.media', 'director-models', `${media.directorSha256(bytes)}.glb`);
            await mkdir(join(f.root, 'nextmux.media', 'director-models'), { recursive: true });
            await writeFile(join(outside, 'model.glb'), bytes); await symlink(join(outside, 'model.glb'), path);
            await assert.rejects(f.service.importModel({ name: 'model.glb', mimeType: '', dataBase64: bytes.toString('base64') }), error => error.code === 'DIRECTOR_PROJECT_PATH');
        } finally { await f.clean(); }
    } finally { await rm(outside, { recursive: true, force: true }); }
});
test('bounded SPZ and decoder-compatible PLY imports persist and malformed counts/raster/MIME fail', async () => {
    const f = await fixture();
    try {
        const spz = Buffer.alloc(16 + 19); spz.write('NGSP'); spz.writeUInt32LE(2, 4); spz.writeUInt32LE(1, 8); spz[13] = 12;
        assert.equal((await f.service.importModel({ name: 'world.spz', mimeType: 'application/gzip', dataBase64: gzipSync(spz).toString('base64') })).kind, 'splat');
        const plyHeader = Buffer.from('ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n');
        const point = Buffer.alloc(15); point.writeFloatLE(1, 4); point.writeFloatLE(2, 8); point[12] = 255;
        const ply = Buffer.concat([plyHeader, point]);
        assert.equal((await f.service.importModel({ name: 'world.ply', mimeType: 'model/ply', dataBase64: ply.toString('base64') })).kind, 'splat');
        const invalidCount = Buffer.from(spz); invalidCount.writeUInt32LE(2_000_000, 8);
        assert.throws(() => media.validateDirectorSpz(gzipSync(invalidCount)));
        const badPoint = Buffer.from(point); badPoint.writeFloatLE(NaN, 4);
        assert.throws(() => media.validateDirectorPly(Buffer.concat([plyHeader, badPoint])));
        assert.throws(() => media.validateDirectorPly(Buffer.from('ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 1 2\n')));
        assert.throws(() => media.validateDirectorPly(Buffer.concat([Buffer.from(plyHeader.toString().replace(/property uchar (?:red|green|blue)\n/g, '')), point.subarray(0, 12)])));
        assert.throws(() => media.validateDirectorPly(Buffer.concat([Buffer.from(plyHeader.toString().replace('property float x', 'property float32 x')), point])));
        const gaussianNames = ['x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'opacity', 'f_dc_0', 'f_dc_1', 'f_dc_2'];
        const gaussianHeader = Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex 1\n${gaussianNames.map(name => `property float ${name}\n`).join('')}end_header\n`);
        const gaussianData = Buffer.alloc(gaussianNames.length * 4); gaussianData.writeFloatLE(1, gaussianNames.indexOf('rot_0') * 4);
        assert.doesNotThrow(() => media.validateDirectorPly(Buffer.concat([gaussianHeader, gaussianData])));
        assert.throws(() => media.validateDirectorPly(Buffer.concat([Buffer.from(gaussianHeader.toString().replace('end_header\n', 'property float f_rest_0\nend_header\n')), gaussianData, Buffer.alloc(4)])));
        assert.throws(() => media.validateDirectorPng(png(2, 2, false)));
        const invalidCrc = png(); invalidCrc[invalidCrc.length - 1] ^= 1; assert.throws(() => media.validateDirectorPng(invalidCrc));
        assert.throws(() => media.validateDirectorPng(png(8193, 1, false)));
        assert.throws(() => media.decodeDirectorBase64('AA==', 0));
    } finally { await f.clean(); }
});
test('real browser-compatible WebM recording becomes decoded H.264 MP4 with scene/camera/frame provenance', async () => {
    const f = await fixture();
    try {
        const input = join(f.root, 'fixture.webm');
        // The browser records at the display rate (60); the clip must come out at the scene's 24 fps.
        await execute(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-f', 'lavfi', '-i', 'color=c=blue:s=64x48:r=60:d=0.25', '-c:v', 'libvpx', '-an', input]);
        const request = { ...f.capture, captureId: 'recording-1', kind: 'video', mimeType: 'video/webm;codecs=vp8', dataBase64: (await readFile(input)).toString('base64'), frame: 0, endFrame: 6 };
        const result = await f.service.saveCapture(request);
        assert.match(result.version.uri, /\.mp4$/); assert.equal(result.version.metadata.mimeType, 'video/mp4');
        assert.equal(result.version.metadata.width, 64); assert.equal(result.version.metadata.height, 48); assert.ok(result.version.metadata.durationMs > 0);
        assert.equal(result.version.provenance.directorCapture.endFrame, 6); assert.equal(result.state.canvas.edges[0].role, 'referenceVideo');
        assert.equal(result.version.metadata.frameRate, scene.fps);
        assert.deepEqual(validateCanvasDocument(result.state.canvas), []);
        const output = await execute(ffmpegPath, ['-hide_banner', '-i', join(f.root, result.version.uri), '-f', 'null', '-']);
        assert.match(output.stderr, /Video: h264/); assert.match(output.stderr, /yuv420p/);
        assert.equal((await readdir(join(f.root, 'nextmux.media', 'director-captures'))).length, 1);
    } finally { await f.clean(); }
});

test('chunk uploads bind byte offsets and operations, consume atomically, retry final requests and remove payload bytes', async () => {
    const f = await fixture();
    try {
        const bytes = png(), state = await f.service.uploads.begin({ purpose: 'capture', byteLength: bytes.length, mimeType: 'image/png' });
        const half = Math.floor(bytes.length / 2), first = bytes.subarray(0, half).toString('base64');
        await assert.rejects(f.service.uploads.append(state.uploadId, 1, first), error => error.code === 'DIRECTOR_UPLOAD_OFFSET');
        const appended = await f.service.uploads.append(state.uploadId, 0, first); assert.equal(appended.offset, half);
        assert.equal((await f.service.uploads.append(state.uploadId, 0, first)).offset, half);
        await assert.rejects(f.service.uploads.append(state.uploadId, 0, Buffer.alloc(half, 1).toString('base64')), error => error.code === 'DIRECTOR_UPLOAD_CONFLICT');
        const { dataBase64: _body, ...metadata } = f.capture;
        await assert.rejects(f.service.saveCapture({ ...metadata, uploadId: state.uploadId }), error => error.code === 'DIRECTOR_UPLOAD_INCOMPLETE');
        await f.service.uploads.append(state.uploadId, half, bytes.subarray(half).toString('base64'));
        const result = await f.service.saveCapture({ ...metadata, uploadId: state.uploadId });
        assert.equal(result.version.kind, 'image'); assert.equal((await f.service.saveCapture({ ...metadata, uploadId: state.uploadId })).nodeId, result.nodeId);
        assert.equal((await readdir(join(f.root, '.nextmux', 'director-uploads'))).filter(file => file.endsWith('.part')).length, 0);
        await assert.rejects(f.service.saveCapture({ ...metadata, uploadId: state.uploadId, captureId: 'another-capture' }), error => error.code === 'DIRECTOR_UPLOAD_CONFLICT');
        const model = glb(), staged = await f.service.uploads.begin({ purpose: 'model', name: 'file.glb', mimeType: '', byteLength: model.length });
        await f.service.uploads.append(staged.uploadId, 0, model.toString('base64'));
        const imported = await f.service.importModel({ name: 'file.glb', mimeType: '', uploadId: staged.uploadId });
        assert.deepEqual(await f.service.importModel({ name: 'file.glb', mimeType: '', uploadId: staged.uploadId }), imported);
        await assert.rejects(f.service.importModel({ name: 'different.glb', mimeType: '', uploadId: staged.uploadId }), error => error.code === 'DIRECTOR_UPLOAD_CONFLICT');
        await f.service.uploads.discard(staged.uploadId);
        await assert.rejects(f.service.uploads.load(staged.uploadId, 'model', ''), error => error.code === 'DIRECTOR_UPLOAD_MISSING');
    } finally { await f.clean(); }
});
test('chunk staging rejects size budgets, oversized chunks, symlink escapes and ambiguous final bodies', async () => {
    const f = await fixture(), outside = await mkdtemp(join(tmpdir(), 'director-stage-outside-'));
    try {
        await assert.rejects(f.service.uploads.begin({ purpose: 'model', name: 'file.glb', mimeType: '', byteLength: 257 * 1024 * 1024 }));
        const state = await f.service.uploads.begin({ purpose: 'model', mimeType: '', byteLength: 1024 });
        await assert.rejects(f.service.uploads.append(state.uploadId, 0, Buffer.alloc(uploads.DIRECTOR_UPLOAD_CHUNK_BYTES + 1).toString('base64')));
        await assert.rejects(f.service.saveCapture({ ...f.capture, uploadId: state.uploadId }), error => error.code === 'DIRECTOR_UPLOAD_INVALID');
        await f.service.uploads.discard(state.uploadId); await rm(join(f.root, '.nextmux'), { recursive: true });
        await symlink(outside, join(f.root, '.nextmux'));
        await assert.rejects(f.service.uploads.begin({ purpose: 'model', mimeType: '', byteLength: 1 }), error => error.code === 'DIRECTOR_PROJECT_PATH');
        assert.deepEqual(await readdir(outside), []);
    } finally { await f.clean(); await rm(outside, { recursive: true, force: true }); }
});

test('标记修图 stores the marked picture as a new image node with annotation provenance, idempotently', async () => {
    const f = await fixture();
    try {
        const source = { id: 'source-version', assetId: 'asset-source', kind: 'image', uri: 'nextmux.media/source.png', createdAt: now, status: 'ready', metadata: { width: 2, height: 2 } };
        let state = await f.store.read();
        state = await f.store.save({ ...state.canvas, nodes: [...state.canvas.nodes, { id: 'photo', title: 'Photo', kind: 'image', position: { x: 0, y: 400 }, size: { width: 320, height: 240 },
            payload: { versions: [source], currentVersionId: source.id } }] }, state.canvas.revision, state.canvas.projectId);
        const bytes = png(), upload = await f.service.uploads.begin({ purpose: 'capture', byteLength: bytes.length, mimeType: 'image/png' });
        await f.service.uploads.append(upload.uploadId, 0, bytes.toString('base64'));
        const request = { sourceNodeId: 'photo', sourceVersionId: source.id, markId: 'marks-1', expectedRevision: state.canvas.revision, uploadId: upload.uploadId, title: 'Photo · 标注' };
        const first = f.service.saveMarkedImage(request); assert.equal(first, f.service.saveMarkedImage(request));
        const result = await first;
        assert.deepEqual(await readFile(join(f.root, result.version.uri)), bytes);
        assert.match(result.version.uri, /^nextmux\.media\/canvas-marks\//);
        assert.equal(result.version.provenance.operation, 'canvas.annotate'); assert.equal(result.version.provenance.sourceVersionId, source.id);
        assert.equal(result.version.provenance.annotation.markId, 'marks-1');
        const node = result.state.canvas.nodes.find(item => item.id === result.nodeId);
        assert.equal(node.kind, 'image'); assert.equal(node.title, 'Photo · 标注'); assert.equal(node.position.x, 380);
        assert.deepEqual(validateCanvasDocument(result.state.canvas), []);
        // A retry after the upload was consumed recovers the same node instead of adding a second one.
        const retried = await f.service.saveMarkedImage(request);
        assert.equal(retried.nodeId, result.nodeId); assert.equal(retried.state.canvas.nodes.length, result.state.canvas.nodes.length);
        await assert.rejects(f.service.saveMarkedImage({ ...request, uploadId: undefined, dataBase64: png(3, 3).toString('base64'), expectedRevision: retried.state.canvas.revision }),
            error => error.code === 'CANVAS_MARKS_ID_CONFLICT');
        await assert.rejects(f.service.saveMarkedImage({ ...request, markId: 'marks-2', uploadId: undefined, dataBase64: bytes.toString('base64'), sourceVersionId: 'missing', expectedRevision: retried.state.canvas.revision }),
            error => error.code === 'CANVAS_MARKS_SOURCE_REQUIRED');
        await assert.rejects(f.service.saveMarkedImage({ ...request, markId: 'marks-3', uploadId: undefined, dataBase64: bytes.toString('base64'), expectedRevision: 0 }),
            error => error.code === 'CANVAS_REVISION_CONFLICT');
        await assert.rejects(f.service.saveMarkedImage({ ...request, markId: 'marks-4', uploadId: undefined, dataBase64: Buffer.from('not a png').toString('base64'), expectedRevision: retried.state.canvas.revision }),
            error => error.code === 'DIRECTOR_MEDIA_INVALID');
        assert.deepEqual((await readdir(join(f.root, 'nextmux.media', 'canvas-marks'))).length, 1);
    } finally { await f.clean(); }
});
