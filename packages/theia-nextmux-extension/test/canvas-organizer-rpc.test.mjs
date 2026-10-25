import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { createComicProject, createCanvasDocument, applyCanvasCommand, createGenerationSnapshot, seedCanvasFromProject, commitCanvasToProject, applyComicCommand } from '@nextmux/comic-core';
import { sourceModule } from './helpers/comic-organizer-source-loader.mjs';
const { ComicCanvasStore, CanvasServiceError } = sourceModule('node/nextmux-canvas-store.ts');
const { ComicCanvasRegistryStore } = sourceModule('node/nextmux-canvas-registry-store.ts');
import { canvasMediaClickKey, canvasMediaSceneId, compileCanvasGenerationJob } from '../lib/node/nextmux-canvas-generation.js';

// Exercise the production RPC methods while replacing paid transports with local data.
const source = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('rpc.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['canvasStoreForMedia', 'attachCanvasMediaCheckpoint', 'recordCanvasMediaJob', 'commitComicCanvasToProject', 'attachCanvasCompositionExport']);
const methods = [];
(function walk(node) { if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast)); ts.forEachChild(node, walk); })(ast);
const compiled = ts.transpileModule(`const { CanvasServiceError, ComicCanvasRegistryStore, canvasMediaClickKey, canvasMediaSceneId, applyComicCommand, applyCanvasCommand, commitCanvasToProject } = deps; class Harness { ${methods.join('\n')} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const Harness = new Function('deps', `${compiled}\nreturn Harness;`)({ CanvasServiceError, ComicCanvasRegistryStore, canvasMediaClickKey, canvasMediaSceneId, applyComicCommand, applyCanvasCommand, commitCanvasToProject });
const now = '2026-10-01T00:00:00.000Z';

test('background canvas completion and queue status use the original journal, even when main is active', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-canvas-owner-rpc-'));
    try {
        let project = createComicProject({ title: 'Owner fixture', starter: 'empty', now });
        const main = new ComicCanvasStore(root);
        const mainDoc = (await main.save(createCanvasDocument({ id: 'canvas-main-fixture', projectId: project.id, now }), 0, project.id)).canvas;
        const registryStore = new ComicCanvasRegistryStore(root);
        await registryStore.read(project.id, mainDoc);
        const unrelated = await registryStore.create(project.id, { title: 'Unrelated', mainCanvas: mainDoc });
        await writeFile(join(root, 'nextmux.canvases', unrelated.canvases.at(-1).id, 'nextmux.canvas.json'), '{broken');
        const registry = await registryStore.create(project.id, { title: 'Background', mainCanvas: mainDoc });
        const freeId = registry.canvases.at(-1).id;
        const free = new ComicCanvasStore(root, freeId);
        const freeBefore = (await free.read()).canvas;
        const canvas = (await free.save(applyCanvasCommand(freeBefore, { type: 'node.add', node: { id: 'node-background', kind: 'videoGen', title: 'Background video',
            position: { x: 0, y: 0 }, size: { width: 320, height: 240 }, payload: { mode: 'textToVideo', modelId: 'fixture-model', prompt: 'A local fixture',
                parameters: { resolution: '720p', aspectRatio: '16:9', durationSeconds: 6 }, versions: [] } } }), freeBefore.revision, project.id)).canvas;
        const snapshot = createGenerationSnapshot(canvas, 'node-background', { capabilityVersion: 'fixture-v1' });
        const capability = { id: 'fixture-route', providerId: 'fixture', providerModelId: 'fixture-model', displayName: 'Fixture', version: 'fixture-v1', status: 'available', sources: ['fixture'],
            modes: [{ mode: 'textToVideo', outputVariants: [{ id: '720', resolution: '720p', aspectRatios: ['16:9'], dimensions: { '16:9': { width: 1280, height: 720 } } }],
                duration: { kind: 'enum', seconds: [6], defaultSeconds: 6 }, audioGeneration: { mode: 'optional', defaultEnabled: false } }] };
        const request = compileCanvasGenerationJob({ canvasId: freeId, projectId: project.id, nodeId: 'node-background', idempotencyKey: canvasMediaClickKey(freeId, 'background-click'), snapshot, capability,
            connectionId: 'official-11111111-1111-4111-8111-111111111111', cost: { billing: 'free', description: 'Local fixture' } });
        await free.reserve({ nodeId: 'node-background', idempotencyKey: 'background-click', snapshot, request, expectedRevision: canvas.revision });
        const output = { assetId: 'asset-background', assetKind: 'video', relativeUri: 'nextmux.media/background.mp4', sha256: 'a'.repeat(64), byteLength: 42, mimeType: 'video/mp4', provider: 'Fixture', model: 'fixture-model' };
        const job = { ...request, id: 'media-job-11111111-1111-4111-8111-111111111111', status: 'succeeded', updatedAt: now, completedAt: now, output };
        const harness = new Harness();
        Object.assign(harness, { canvasStore: (_root, id) => new ComicCanvasStore(root, id),
            comicProjectStore: async () => ({ read: async () => ({ project }), apply: async command => { project = applyComicCommand(project, command); } }),
            probeComicCheckpointMedia: async () => ({ width: 1280, height: 720, durationMs: 6000 }) });
        // A second reservation with no queue ID must not match by undefined === undefined.
        const mainDraft = (await main.save({ ...mainDoc, nodes: canvas.nodes.map(node => ({ ...node, payload: { ...node.payload, jobs: [] } })) }, mainDoc.revision, project.id)).canvas;
        const mainSnapshot = createGenerationSnapshot(mainDraft, 'node-background', { capabilityVersion: 'fixture-v1' });
        const mainRequest = compileCanvasGenerationJob({ canvasId: mainDraft.id, projectId: project.id, nodeId: 'node-background', idempotencyKey: canvasMediaClickKey(mainDraft.id, 'main-click'), snapshot: mainSnapshot, capability,
            connectionId: 'official-11111111-1111-4111-8111-111111111111', cost: { billing: 'free', description: 'Local fixture' } });
        await main.reserve({ nodeId: 'node-background', idempotencyKey: 'main-click', snapshot: mainSnapshot, request: mainRequest, expectedRevision: mainDraft.revision });
        assert.equal((await harness.canvasStoreForMedia(root, request)).canvasId, freeId);
        const originalMain = await readFile(join(root, 'nextmux.canvas.json'), 'utf8');
        await harness.recordCanvasMediaJob(root, job);
        await harness.attachCanvasMediaCheckpoint(root, job, output);
        assert.equal(await readFile(join(root, 'nextmux.canvas.json'), 'utf8'), originalMain);
        assert.equal((await free.read()).canvas.nodes[0].payload.versions[0].assetId, output.assetId);
        assert.equal((await free.read()).jobs[0].jobId, job.id);
        assert.equal((await main.read()).jobs[0].jobId, undefined);
        assert.equal(project.assets[0].id, output.assetId);
        await harness.attachCanvasMediaCheckpoint(root, job, output);
        assert.equal((await free.read()).canvas.nodes[0].payload.versions.length, 1);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('commit RPC always reads the main document for entering editing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-canvas-main-source-rpc-'));
    try {
        let project = createComicProject({ title: 'Main source', now });
        const main = new ComicCanvasStore(root);
        const document = (await main.save(seedCanvasFromProject(project), 0, project.id)).canvas;
        const calls = [];
        const harness = new Harness();
        Object.assign(harness, { canvasStore: (_root, canvasId) => { calls.push(canvasId); return main; },
            comicProjectStore: async () => ({ read: async () => ({ project }), commitPrepared: async (_revision, prepared) => { project = prepared; return { project }; } }),
            syncComicProductionDocument: async () => {}, withComicProduction: async (_root, state) => state });
        const state = await harness.commitComicCanvasToProject({ workspaceRoot: root, expectedCanvasRevision: document.revision, expectedProjectRevision: project.revision, canvasId: 'a-free-canvas' });
        assert.equal(state.project.id, project.id);
        assert.deepEqual(calls, [undefined]);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('background composition export attaches once to its captured free canvas', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-canvas-composition-owner-rpc-'));
    try {
        const project = createComicProject({ title: 'Composition owner', starter: 'empty', now });
        const main = new ComicCanvasStore(root);
        const mainDoc = (await main.save(createCanvasDocument({ id: 'canvas-main-composition', projectId: project.id, now }), 0, project.id)).canvas;
        const registryStore = new ComicCanvasRegistryStore(root);
        const registry = await registryStore.create(project.id, { title: 'Scratch composition', mainCanvas: mainDoc });
        const freeId = registry.canvases.at(-1).id, free = new ComicCanvasStore(root, freeId), draft = (await free.read()).canvas;
        await free.save(applyCanvasCommand(draft, { type: 'node.add', node: { id: 'composition-background', kind: 'composition', title: 'Composition',
            position: { x: 0, y: 0 }, size: { width: 320, height: 240 }, payload: { clips: [], parameters: {}, versions: [] } } }), draft.revision, project.id);
        let imports = 0;
        const harness = new Harness();
        Object.assign(harness, { canvasStore: (_root, id) => new ComicCanvasStore(root, id), resolveMediaInput: async (_root, uri) => join(root, uri),
            importComicMedia: async () => { imports++; return { assetIds: ['asset-composition-result'], state: { project: { assets: [{ id: 'asset-composition-result', kind: 'video', uri: 'nextmux.media/export.mp4' }] } } }; } });
        const running = { workspaceRoot: root, canvasId: freeId, state: { id: 'comic-export-background', status: 'completed', output: { relativeUri: 'nextmux.media/export.mp4' }, finishedAt: now } };
        const originalMain = await readFile(join(root, 'nextmux.canvas.json'), 'utf8');
        await harness.attachCanvasCompositionExport(running, 'composition-background');
        await harness.attachCanvasCompositionExport(running, 'composition-background');
        assert.equal(imports, 1);
        assert.equal((await free.read()).canvas.nodes[0].payload.currentVersionId, 'version-comic-export-background');
        assert.equal(await readFile(join(root, 'nextmux.canvas.json'), 'utf8'), originalMain);
    } finally { await rm(root, { recursive: true, force: true }); }
});
