import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, stat, rm, lstat, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { sourceModule, comicCoreSource as core } from './helpers/comic-organizer-source-loader.mjs';
import { loadCanvasToolsSource } from './helpers/canvas-tools-source-loader.mjs';

const require = createRequire(import.meta.url), execFile = promisify(execFileCallback);
const ffmpegPath = process.env.NEXTMUX_TEST_FFMPEG || require('@ffmpeg-installer/ffmpeg').path;
const { extractCanvasVideoFrame } = await loadCanvasToolsSource('node/nextmux-canvas-frame.ts');
const { writeCanvasFrameSourceProof, readCanvasFrameSourceProof } = await loadCanvasToolsSource('node/nextmux-canvas-frame-source.ts');
const { ComicCanvasStore, CanvasServiceError } = sourceModule('node/nextmux-canvas-store.ts');
const { compileCanvasGenerationJob } = sourceModule('node/nextmux-canvas-generation.ts');
const { convertCanvasVideoInputToFrame, resolveCanvasVideoInput } = sourceModule('browser/nextmux-comic-canvas-video-input.ts');
const serviceSource = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('service.ts', serviceSource, ts.ScriptTarget.Latest, true), methods = [];
(function visit(node) { if (ts.isMethodDeclaration(node) && ['extractComicCanvasInputFrame', 'resolveMediaInput', 'pathInside'].includes(node.name.getText(ast))) methods.push(node.getText(ast)); ts.forEachChild(node, visit); })(ast);
assert.equal(methods.length, 3);
const deps = { CanvasServiceError, PlatformRequestError: CanvasServiceError, extractCanvasVideoFrame, writeCanvasFrameSourceProof, randomUUID, stat, lstat, realpath, resolve, relative, sep, isAbsolute,
    COMIC_MEDIA_DIRECTORY: core.COMIC_MEDIA_DIRECTORY, mediaMessage: key => key };
const compiled = ts.transpileModule(`const {${Object.keys(deps).join(',')}}=deps;class Service{${methods.join('\n')}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const Service = new Function('deps', `${compiled};return Service;`)(deps);
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const now = '2026-10-04T00:00:00Z';
const capability = { id: 'local-test', providerId: 'local', providerModelId: 'model', displayName: 'Fixture', version: '1', status: 'available', sources: [], modes: [
    { mode: 'imageToVideo', firstFrame: true, frameImageRule: { supported: true, maxCount: 1, formats: ['png'], maxBytes: 100000 },
        outputVariants: [{ id: '720', resolution: '720p', aspectRatios: ['16:9'] }], duration: { kind: 'fixed', seconds: 5 }, audioGeneration: { mode: 'unsupported', defaultEnabled: false } }
] };

async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'nextmux-direct-reference-frame-')), workspaceRoot = join(directory, 'project');
    await mkdir(workspaceRoot);
    const projectStore = await core.ComicProjectStore.create({ workspaceRoot, historyRoot: join(directory, 'history') });
    const project = (await projectStore.initialize({ now, starter: 'empty' })).project;
    await mkdir(join(workspaceRoot, core.COMIC_MEDIA_DIRECTORY));
    const sourceUri = `${core.COMIC_MEDIA_DIRECTORY}/source.mp4`, sourcePath = join(workspaceRoot, sourceUri);
    await execFile(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=2:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sourcePath]);
    const video = { id: 'video-v1', assetId: 'source-asset', kind: 'video', uri: sourceUri, createdAt: now,
        metadata: { mimeType: 'video/mp4', width: 64, height: 48, durationMs: 1000, byteLength: (await stat(sourcePath)).size, sha256: await hash(sourcePath) } };
    const target = { id: 'target', kind: 'videoGen', title: 'Video', position: { x: 0, y: 0 }, size: { width: 360, height: 260 },
        payload: { mode: 'referenceToVideo', modelId: 'model', prompt: 'A local fixture', parameters: {}, versions: [], inputs: [{ id: 'direct', role: 'referenceVideo', order: 0, version: video }] } };
    const store = new ComicCanvasStore(workspaceRoot);
    const canvas = (await store.save({ ...core.createCanvasDocument({ id: 'canvas', projectId: project.id, now }), nodes: [target] }, 0, project.id)).canvas;
    let outputCalls = 0;
    const service = Object.assign(new Service(), { canvasStore: () => store, comicProjectStore: async () => projectStore,
        sha256File: hash,
        getMediaRuntimeState: async () => ({ ffmpeg: { available: true, path: ffmpegPath } }), retryOnComicRevision: operation => operation(),
        mediaOutputPath: async (_root, jobId, extension) => { outputCalls++; const relativeUri = `nextmux.media/${jobId}.${extension}`;
            await mkdir(join(workspaceRoot, 'nextmux.media'), { recursive: true }); return { relativeUri, absolutePath: join(workspaceRoot, relativeUri) }; }
    });
    const request = { workspaceRoot, canvasId: canvas.id, expectedRevision: canvas.revision, nodeId: target.id, inputId: 'direct', versionId: video.id, assetId: video.assetId, selection: { kind: 'last' } };
    return { directory, workspaceRoot, projectStore, project, sourcePath, canvas, store, service, request, outputCalls: () => outputCalls };
}

test('actual direct-reference RPC extracts and registers a real last frame without touching the canvas; reopen and compile retain the fixed input', async () => {
    const f = await fixture();
    try {
        const before = await readFile(join(f.workspaceRoot, 'nextmux.canvas.json'));
        const version = await f.service.extractComicCanvasInputFrame(f.request);
        assert.deepEqual(await readFile(join(f.workspaceRoot, 'nextmux.canvas.json')), before);
        assert.deepEqual((await f.store.read()).jobs, []);
        assert.deepEqual([version.metadata.width, version.metadata.height, version.provenance.actualTimeMs], [64, 48, 500]);
        assert.equal(version.provenance.sourceNodeId, undefined);
        const png = await readFile(join(f.workspaceRoot, version.uri)); assert.equal(png.subarray(1, 4).toString(), 'PNG');
        assert.equal(version.metadata.sha256, await hash(join(f.workspaceRoot, version.uri)));
        assert.deepEqual(await readCanvasFrameSourceProof(f.workspaceRoot, version), f.canvas.nodes[0].payload.inputs[0].version);
        assert.equal((await f.projectStore.read()).project.assets.find(asset => asset.id === version.assetId).uri, version.uri);
        const converted = convertCanvasVideoInputToFrame(f.canvas, { targetNodeId: 'target', input: resolveCanvasVideoInput(f.canvas, 'target').input,
            frameVersion: version, capability, edgeId: 'fixed-first', now });
        assert.equal(converted.ok, true, JSON.stringify(converted));
        assert.equal(converted.canvas.nodes.length, 1); assert.equal(converted.canvas.edges.length, 0);
        await f.store.save(converted.canvas, f.canvas.revision, f.project.id);
        const reopened = (await new ComicCanvasStore(f.workspaceRoot).read()).canvas;
        assert.deepEqual(reopened.nodes[0].payload.inputs[0].version, version);
        const snapshot = core.createGenerationSnapshot(reopened, 'target', { capabilityVersion: capability.version });
        const job = compileCanvasGenerationJob({ canvasId: reopened.id, projectId: f.project.id, nodeId: 'target', idempotencyKey: 'local-test-only',
            snapshot, capability, connectionId: 'official-11111111-1111-4111-8111-111111111111', cost: { billing: 'free', description: 'No submission' } });
        assert.equal(job.input.firstFrameUri, version.uri); assert.equal(job.input.referenceVideoUris, undefined); assert.equal(job.input.sourceVideoUri, undefined);
        assert.equal(snapshot.resolvedInputs[0].versionId, version.id);
        reopened.nodes[0].payload.inputs = []; assert.equal(snapshot.resolvedInputs[0].uri, version.uri);
        assert.equal(f.outputCalls(), 1);
    } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('direct-reference RPC rejects stale revision, wrong input identity, busy target, changed file and changed project before output creation', async () => {
    const f = await fixture();
    try {
        for (const patch of [{ expectedRevision: 0 }, { inputId: 'other' }, { versionId: 'other' }, { assetId: 'other' }, { nodeId: 'other' }]) {
            await assert.rejects(f.service.extractComicCanvasInputFrame({ ...f.request, ...patch }), error => error instanceof CanvasServiceError);
        }
        const read = f.store.read.bind(f.store);
        f.store.read = async () => { const value = await read(); return { ...value, jobs: [{ nodeId: 'target', status: 'running' }] }; };
        await assert.rejects(f.service.extractComicCanvasInputFrame(f.request), { code: 'CANVAS_NODE_BUSY' }); f.store.read = read;
        const sourceBytes = await readFile(f.sourcePath); await writeFile(f.sourcePath, Buffer.concat([sourceBytes, Buffer.from('changed')]));
        await assert.rejects(f.service.extractComicCanvasInputFrame(f.request), { code: 'CANVAS_INPUT_CHANGED' }); await writeFile(f.sourcePath, sourceBytes);
        f.service.comicProjectStore = async () => ({ read: async () => ({ project: { id: 'other' } }) });
        await assert.rejects(f.service.extractComicCanvasInputFrame(f.request), { code: 'CANVAS_PROJECT_CHANGED' });
        assert.equal(f.outputCalls(), 0); assert.equal((await f.projectStore.read()).project.assets.length, 0);
        assert.deepEqual((await f.store.read()).canvas, f.canvas);
    } finally { await rm(f.directory, { recursive: true, force: true }); }
});
