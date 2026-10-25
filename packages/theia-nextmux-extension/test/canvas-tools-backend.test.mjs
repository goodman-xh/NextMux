import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createCanvasDocument, applyCanvasCommand, parseCanvasDocument, serializeCanvasDocument } from '@nextmux/comic-core';
import { relativeMediaUri } from '@nextmux/media-core';

// Compile the independent backend facade and its actual source dependencies without
// rebuilding files currently owned by the parallel canvas review.
const require = createRequire(import.meta.url), sourceModules = new Map();
function sourceModule(relativeFile) {
    const filename = fileURLToPath(new URL(`../src/${relativeFile}`, import.meta.url));
    if (sourceModules.has(filename)) return sourceModules.get(filename).exports;
    const module = { exports: {} }; sourceModules.set(filename, module);
    const source = require('node:fs').readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const dependency = id => id.startsWith('.') ? sourceModule(join(dirname(relativeFile), `${id}.ts`)) : require(id);
    new Function('require', 'module', 'exports', compiled)(dependency, module, module.exports);
    return module.exports;
}
const { ComicCanvasStore } = sourceModule('node/nextmux-canvas-store.ts');
const { PersistentComicCanvasToolsService, CANVAS_TOOLS_JOURNAL_FILE } = sourceModule('node/nextmux-canvas-tools-backend.ts');
const now = '2026-09-30T00:00:00.000Z';

async function fixture(runner, options = {}) {
    const root = await mkdtemp(join(tmpdir(), 'canvas-tools-backend-'));
    await writeFile(join(root, 'source.png'), 'fixture');
    const source = { id: 'source-v1', assetId: 'source-asset', kind: 'image', uri: 'source.png', createdAt: now };
    const node = { id: 'source', title: '人物', kind: 'image', position: { x: 0, y: 0 }, size: { width: 320, height: 240 }, payload: { versions: [source], currentVersionId: source.id } };
    const canvas = applyCanvasCommand(createCanvasDocument({ id: 'canvas', projectId: 'project', now }), { type: 'node.add', node });
    const store = new ComicCanvasStore(root), state = await store.save(canvas, 0, 'project');
    const result = { versions: [{ ...source, id: 'new-v1', assetId: 'new-asset', uri: 'result.png',
        provenance: { sourceVersionId: source.id, tool: 'image.mirror', parameters: {}, sourceVersionIds: [source.id] }, metadata: { width: 32, height: 32 } }] };
    const service = new PersistentComicCanvasToolsService(root, store, options, runner || (async () => result));
    const request = { requestId: 'click-1', nodeId: node.id, sourceVersionId: source.id, expectedRevision: state.canvas.revision, tool: 'image.mirror' };
    return { root, store, service, request, result, cleanup: () => rm(root, { recursive: true, force: true }) };
}

function gate() {
    let release; const promise = new Promise(resolve => { release = resolve; });
    return { promise, release };
}

test('on-device download byte progress, localized label, placement and provenance survive the durable journal', async () => {
    const started = gate(), finish = gate(); let runtime, pending;
    const f = await fixture(async (request, options) => {
        runtime = options;
        options.onProgress({ stage: 'download', completedOutputs: 0, totalOutputs: 1, fraction: .4, downloadedBytes: 4, totalBytes: 10 });
        started.release(); await finish.promise;
        return { versions: f.result.versions.map(version => ({ ...version, metadata: { width: 64, height: 32, mimeType: 'image/png', sha256: 'a'.repeat(64) },
            provenance: { sourceVersionId: 'source-v1', operation: request.tool, tool: request.tool,
                parameters: { invert: true, modelId: 'pinned-depth', modelSha256: 'b'.repeat(64), runtime: 'onnxruntime-node' }, sourceVersionIds: ['source-v1'] } })) };
    }, { modelDirectory: '/application/data/canvas-models' });
    try {
        const state = await f.store.mutate(canvas => ({ ...canvas, nodes: [...canvas.nodes,
            { ...canvas.nodes[0], id: 'blocking-card', position: { x: 380, y: 0 } }] }));
        const request = { ...f.request, expectedRevision: state.canvas.revision, tool: 'image.depth', parameters: { invert: true }, label: '端侧深度图' };
        pending = f.service.run(request); await started.promise;
        const progress = await f.service.getJob(request.requestId);
        assert.equal(progress.job.stage, 'download'); assert.equal(progress.job.percent, 40);
        assert.equal(progress.job.progress.downloadedBytes, 4); assert.equal(progress.job.progress.totalBytes, 10);
        assert.equal(runtime.modelDirectory, '/application/data/canvas-models');
        // Progress writes are queued independently so inference never waits on the journal's disk I/O.
        await f.service.active.get(request.requestId).writes;
        const records = JSON.parse(await readFile(join(f.root, CANVAS_TOOLS_JOURNAL_FILE), 'utf8'));
        assert.equal(records[0].job.stage, 'download'); assert.equal(records[0].job.progress.totalBytes, 10);
        finish.release(); const complete = await pending;
        assert.equal(complete.job.status, 'succeeded'); assert.equal(complete.job.percent, 100);
        const outputNode = complete.state.canvas.nodes[2];
        assert.equal(outputNode.title, '人物 · 端侧深度图');
        assert.ok(outputNode.position.y >= 280, 'the output is placed beneath the existing blocking card');
        assert.equal(outputNode.payload.versions[0].provenance.parameters.modelId, 'pinned-depth');
        const restored = await new PersistentComicCanvasToolsService(f.root, f.store, {}).getJob(request.requestId);
        assert.deepEqual(restored.job.result.versions[0].provenance, complete.job.result.versions[0].provenance);
        assert.deepEqual(restored.job.nodeIds, complete.job.nodeIds);
    } finally { finish.release(); await pending?.catch(() => undefined); await f.cleanup(); }
});

test('backend restart recovers a downloading on-device job as interrupted without redownloading', async () => {
    const f = await fixture();
    try {
        const request = { ...f.request, tool: 'image.matting' };
        await writeFile(join(f.root, CANVAS_TOOLS_JOURNAL_FILE), JSON.stringify([{ request, fingerprint: JSON.stringify(request),
            job: { requestId: request.requestId, status: 'running', stage: 'download', percent: 12,
                progress: { stage: 'download', completedOutputs: 0, totalOutputs: 1, downloadedBytes: 12, totalBytes: 100 } } }]));
        const restored = await new PersistentComicCanvasToolsService(f.root, f.store,
            () => { throw new Error('Interrupted download must not resolve runtime or use the network'); }).getJob(request.requestId);
        assert.equal(restored.job.status, 'interrupted'); assert.equal(restored.job.stage, 'download');
        assert.equal(restored.job.percent, 12); assert.equal(restored.job.progress.downloadedBytes, 12);
    } finally { await f.cleanup(); }
});

test('one click exposes stage and percent, survives window reuse and returns the output canvas', async () => {
    const started = gate(), finish = gate(); let calls = 0, runOptions;
    const f = await fixture(async (_, options) => { calls++; runOptions = options; started.release(); await finish.promise; return f.result; });
    try {
        const running = f.service.run(f.request);
        assert.equal(f.service.run({ ...f.request }), running);
        await started.promise;
        runOptions.onProgress({ stage: 'process', completedOutputs: 0, totalOutputs: 1, fraction: .45 });
        const progress = await f.service.getJob(f.request.requestId);
        assert.equal(progress.job.status, 'running'); assert.equal(progress.job.stage, 'process'); assert.equal(progress.job.percent, 45);
        progress.job.percent = 1; assert.equal((await f.service.getJob(f.request.requestId)).job.percent, 45);
        assert.equal(progress.state.canvas.revision, 1);
        // A normal edit while processing remains present when the result is attached.
        await f.store.mutate(canvas => ({ ...canvas, title: 'Edited while running' }));
        finish.release(); const output = await running;
        assert.equal(output.job.status, 'succeeded'); assert.equal(output.job.stage, 'complete'); assert.equal(output.job.percent, 100);
        assert.equal(calls, 1); assert.equal(output.state.canvas.title, 'Edited while running'); assert.equal(output.state.canvas.revision, 3);
        assert.equal(output.state.canvas.nodes.length, 2); assert.equal(output.state.canvas.nodes[0].payload.currentVersionId, 'source-v1');
        assert.equal(output.state.canvas.nodes[1].payload.currentVersionId, 'new-v1'); assert.equal(output.job.nodeIds[0], output.state.canvas.nodes[1].id);
        const journal = JSON.parse(await readFile(join(f.root, CANVAS_TOOLS_JOURNAL_FILE), 'utf8'));
        assert.equal(journal[0].job.status, 'succeeded'); assert.equal(journal[0].job.percent, 100);
        const restarted = new PersistentComicCanvasToolsService(f.root, f.store, () => { throw new Error('No binaries needed for recovery'); }, async () => { calls++; return f.result; });
        const replaying = restarted.run({ ...f.request });
        assert.equal((await restarted.cancel(f.request.requestId)).job.status, 'succeeded');
        const replay = await replaying;
        assert.equal(replay.job.status, 'succeeded'); assert.equal(calls, 1); assert.equal(replay.state.canvas.nodes.length, 2);
        assert.deepEqual((await readdir(f.root)).filter(name => name.endsWith('.tmp') || name.endsWith('.lock')), []);
    } finally { finish.release(); await f.cleanup(); }
});

test('a restarted backend reports a durable running job as interrupted and never resubmits it', async () => {
    const f = await fixture(); let calls = 0, optionsCalls = 0;
    try {
        const record = { request: f.request, fingerprint: JSON.stringify(f.request),
            job: { requestId: f.request.requestId, status: 'running', stage: 'verify', percent: 72, result: f.result } };
        await writeFile(join(f.root, CANVAS_TOOLS_JOURNAL_FILE), JSON.stringify([record]));
        const restarted = new PersistentComicCanvasToolsService(f.root, f.store, async () => { optionsCalls++; throw new Error('FFmpeg missing'); }, async () => { calls++; return f.result; });
        const restored = await restarted.getJob(f.request.requestId);
        assert.equal(restored.job.status, 'interrupted'); assert.equal(restored.job.stage, 'verify'); assert.equal(restored.job.percent, 72);
        assert.equal(restored.job.error.code, 'LOCAL_TOOL_INTERRUPTED'); assert.equal(restored.job.result.versions[0].id, 'new-v1');
        assert.equal((await restarted.run(f.request)).job.status, 'interrupted');
        assert.equal((await restarted.cancel(f.request.requestId)).job.status, 'interrupted');
        assert.equal(optionsCalls, 0); assert.equal(calls, 0); assert.equal((await f.store.read()).canvas.nodes.length, 1);
        assert.equal(JSON.parse(await readFile(join(f.root, CANVAS_TOOLS_JOURNAL_FILE), 'utf8'))[0].job.status, 'interrupted');
        await assert.rejects(restarted.run({ ...f.request, tool: 'image.crop' }), { code: 'REQUEST_ID_CONFLICT' });
        assert.equal((await restarted.getJob(f.request.requestId)).job.status, 'interrupted');
        const conflictFirst = new PersistentComicCanvasToolsService(f.root, f.store, {});
        await assert.rejects(conflictFirst.run({ ...f.request, tool: 'image.crop' }), { code: 'REQUEST_ID_CONFLICT' });
        assert.equal((await conflictFirst.getJob(f.request.requestId)).job.status, 'interrupted');
    } finally { await f.cleanup(); }
});

test('journal recovery and cancellation lookup remain available when the canvas file is absent', async () => {
    const f = await fixture();
    try {
        await writeFile(join(f.root, CANVAS_TOOLS_JOURNAL_FILE), JSON.stringify([{ request: f.request, fingerprint: JSON.stringify(f.request),
            job: { requestId: f.request.requestId, status: 'running', stage: 'process', percent: 30 } }]));
        await rm(join(f.root, 'nextmux.canvas.json'));
        const service = new PersistentComicCanvasToolsService(f.root, f.store, async () => { throw new Error('No FFmpeg'); });
        const result = await service.getJob(f.request.requestId);
        assert.equal(result.job.status, 'interrupted'); assert.equal(result.state.exists, false);
        assert.equal((await service.cancel('not-found')).job, undefined);
        assert.equal((await service.cancel(f.request.requestId)).job.status, 'interrupted');
    } finally { await f.cleanup(); }
});

test('cancellation during processing prevents output attachment and persists after backend restart', async () => {
    const started = gate(), finish = gate(); let runOptions;
    const f = await fixture(async (_, options) => { runOptions = options; started.release(); await finish.promise; return f.result; });
    try {
        const pending = f.service.run(f.request); await started.promise;
        const cancelled = await f.service.cancel(f.request.requestId);
        assert.equal(runOptions.signal.aborted, true); assert.equal(cancelled.job.status, 'cancelled'); assert.equal(cancelled.state.canvas.nodes.length, 1);
        finish.release(); const complete = await pending;
        assert.equal(complete.job.status, 'cancelled'); assert.equal(complete.job.result.versions[0].id, 'new-v1');
        assert.equal(complete.state.canvas.nodes.length, 1); assert.equal(complete.state.canvas.revision, 1);
        const restarted = new PersistentComicCanvasToolsService(f.root, f.store, {});
        assert.equal((await restarted.getJob(f.request.requestId)).job.status, 'cancelled');
    } finally { finish.release(); await f.cleanup(); }
});

test('cancellation before binary resolution finishes never invokes the local runner', async () => {
    const resolving = gate(), resolved = gate(); let calls = 0;
    const f = await fixture(async () => { calls++; return f.result; }, async () => { resolving.release(); await resolved.promise; return {}; });
    try {
        const pending = f.service.run(f.request); await resolving.promise;
        assert.equal((await f.service.cancel(f.request.requestId)).job.status, 'cancelled');
        resolved.release(); assert.equal((await pending).job.status, 'cancelled'); assert.equal(calls, 0);
        assert.equal((await f.store.read()).canvas.nodes.length, 1);
    } finally { resolved.release(); await f.cleanup(); }
});

test('parallel local requests keep their progress and results isolated', async () => {
    const bothStarted = gate(), finish = gate(); const runners = new Map();
    const f = await fixture(async (request, options) => {
        const quality = request.parameters.quality; runners.set(quality, options);
        if (runners.size === 2) bothStarted.release();
        await finish.promise;
        return { versions: f.result.versions.map(version => ({ ...version, id: `result-${quality}`, assetId: `asset-${quality}` })) };
    });
    try {
        const first = f.service.run({ ...f.request, requestId: 'first', tool: 'image.convert', parameters: { format: 'png', quality: 50 } });
        const second = f.service.run({ ...f.request, requestId: 'second', tool: 'image.convert', parameters: { format: 'png', quality: 90 } });
        await bothStarted.promise;
        runners.get(50).onProgress({ stage: 'process', completedOutputs: 0, totalOutputs: 1, fraction: .2 });
        runners.get(90).onProgress({ stage: 'verify', completedOutputs: 0, totalOutputs: 1, fraction: .8 });
        assert.equal((await f.service.getJob('first')).job.percent, 20);
        assert.equal((await f.service.getJob('second')).job.percent, 80);
        finish.release(); const results = await Promise.all([first, second]);
        assert.equal(results[0].job.result.versions[0].id, 'result-50'); assert.equal(results[1].job.result.versions[0].id, 'result-90');
        assert.equal((await f.store.read()).canvas.nodes.length, 3);
    } finally { finish.release(); await f.cleanup(); }
});

test('stale revisions never invoke the runner and source-version changes retain original protection', async () => {
    let calls = 0;
    const f = await fixture(async () => { calls++; return f.result; });
    try {
        const failed = await f.service.run({ ...f.request, requestId: 'stale', expectedRevision: 0 });
        assert.equal(failed.job.status, 'failed'); assert.equal(failed.job.error.code, 'CANVAS_REVISION_CONFLICT'); assert.equal(calls, 0);
        assert.equal(failed.state.canvas.revision, 1);
        const service = new PersistentComicCanvasToolsService(f.root, f.store, {}, async () => {
            calls++; await f.store.mutate(canvas => ({ ...canvas, nodes: canvas.nodes.map(node => ({ ...node,
                payload: { ...node.payload, versions: node.payload.versions.map(version => ({ ...version, uri: 'changed.png' })) } })) }));
            return f.result;
        });
        const changed = await service.run(f.request);
        assert.equal(changed.job.status, 'failed'); assert.equal(changed.job.error.code, 'SOURCE_VERSION_CHANGED'); assert.equal(calls, 1);
        assert.equal(changed.job.result.versions[0].id, 'new-v1'); assert.equal(changed.state.canvas.nodes.length, 1);
    } finally { await f.cleanup(); }
});

test('journal updates use the canvas store lock and do not change the canvas revision', async () => {
    const entered = gate(), release = gate(), runnerStarted = gate();
    const f = await fixture(async () => { runnerStarted.release(); return f.result; });
    try {
        const locked = f.store.mutate(async canvas => { entered.release(); await release.promise; return canvas; });
        await entered.promise;
        const pending = f.service.run(f.request);
        // Any journal write while mutate owns the canvas lock would violate the shared lock.
        await assert.rejects(readFile(join(f.root, CANVAS_TOOLS_JOURNAL_FILE)), { code: 'ENOENT' });
        release.release(); await locked; await runnerStarted.promise;
        const result = await pending; assert.equal(result.job.status, 'succeeded'); assert.equal(result.state.canvas.revision, 2);
    } finally { release.release(); await f.cleanup(); }
});

test('new file URI outputs become managed queue inputs while source history stays unchanged', async () => {
    const f = await fixture(async () => f.output);
    try {
        const directory = join(f.root, 'nextmux.media', 'canvas-tools'); await mkdir(directory, { recursive: true });
        const path = join(directory, 'result with space.png'); await writeFile(path, 'result');
        f.output = { versions: f.result.versions.map(version => ({ ...version, uri: pathToFileURL(path).href })) };
        const result = await f.service.run(f.request), version = result.state.canvas.nodes[1].payload.versions[0];
        assert.equal(version.uri, 'nextmux.media/canvas-tools/result with space.png');
        assert.equal(relativeMediaUri(version.uri, 'model reference'), version.uri);
        assert.equal(version.id, f.output.versions[0].id); assert.deepEqual(version.provenance, f.output.versions[0].provenance);
        assert.equal(result.state.canvas.nodes[0].payload.versions[0].uri, 'source.png');
        assert.equal(result.job.result.versions[0].uri, version.uri);
        const journal = JSON.parse(await readFile(join(f.root, CANVAS_TOOLS_JOURNAL_FILE), 'utf8'));
        assert.equal(journal[0].job.result.versions[0].uri, version.uri);
        const restored = await new PersistentComicCanvasToolsService(f.root, f.store, {}).getJob(f.request.requestId);
        assert.equal(relativeMediaUri(restored.job.result.versions[0].uri, 'restored reference'), version.uri);
    } finally { await f.cleanup(); }
});

test('a returned file URI cannot escape through a symlink or bypass the managed media directory', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'canvas-tools-result-outside-'));
    const f = await fixture(async () => f.output);
    try {
        await mkdir(join(f.root, 'nextmux.media', 'canvas-tools'), { recursive: true });
        const externalPath = join(outside, 'outside.png'); await writeFile(externalPath, 'outside');
        const symlinkPath = join(f.root, 'nextmux.media', 'canvas-tools', 'escape.png'); await symlink(externalPath, symlinkPath);
        f.output = { versions: f.result.versions.map(version => ({ ...version, uri: pathToFileURL(symlinkPath).href })) };
        const escaped = await f.service.run(f.request);
        assert.equal(escaped.job.status, 'failed'); assert.equal(escaped.job.error.code, 'PROJECT_ASSET_REQUIRED'); assert.equal(escaped.state.canvas.nodes.length, 1);
        const unmanagedPath = join(f.root, 'result.png'); await writeFile(unmanagedPath, 'result');
        f.output = { versions: f.result.versions.map(version => ({ ...version, uri: pathToFileURL(unmanagedPath).href })) };
        const unmanaged = await f.service.run({ ...f.request, requestId: 'unmanaged' });
        assert.equal(unmanaged.job.status, 'failed'); assert.equal(unmanaged.job.error.code, 'INVALID_MEDIA_PATH'); assert.equal(unmanaged.state.canvas.nodes.length, 1);
    } finally { await f.cleanup(); await rm(outside, { recursive: true, force: true }); }
});

test('palette and Lab-transfer metadata survive canvas import, backend restart and immutable version protection', async () => {
    const palette = { algorithm: 'lab-kmeans-v1', requestedColorCount: 6, sampleWidth: 128, sampleHeight: 64,
        colors: [{ hex: '#FF0000', percentage: 60 }, { hex: '#0000FF', percentage: 40 }] };
    const statistics = { mean: [50, 20, -10], standardDeviation: [10, 5, 4], weight: 1024 };
    const colorTransfer = { algorithm: 'lab-moments-d65-v1', source: statistics, reference: { ...statistics, mean: [60, 10, 5] }, lutSize: 33 };
    for (const [tool, metadata] of [['image.paletteExtract', { palette }], ['color.transfer', { colorTransfer }]]) {
        const f = await fixture(async () => f.output);
        try {
            if (tool === 'color.transfer') {
                await writeFile(join(f.root, 'reference.png'), 'reference');
                const referenceVersion = { id: 'reference-v1', assetId: 'reference-asset', kind: 'image', uri: 'reference.png', createdAt: now };
                const state = await f.store.mutate(canvas => ({ ...canvas, nodes: [...canvas.nodes, { id: 'reference', kind: 'image', title: 'Reference',
                    position: { x: 400, y: 0 }, size: { width: 32, height: 32 }, payload: { versions: [referenceVersion], currentVersionId: referenceVersion.id } }] }));
                f.request.expectedRevision = state.canvas.revision;
            }
            const directory = join(f.root, 'nextmux.media', 'canvas-tools'); await mkdir(directory, { recursive: true });
            const path = join(directory, 'result.png'); await writeFile(path, 'result');
            f.output = { versions: f.result.versions.map(version => ({ ...version, uri: pathToFileURL(path).href,
                metadata: { ...version.metadata, ...metadata }, provenance: { ...version.provenance, operation: tool, tool,
                    parameters: tool === 'image.paletteExtract' ? { colorCount: 6 } : { referenceVersionId: 'reference-v1', strength: .5 },
                    sourceVersionIds: tool === 'image.paletteExtract' ? ['source-v1'] : ['source-v1', 'reference-v1'] } })) };
            const result = await f.service.run({ ...f.request, tool, parameters: tool === 'color.transfer' ? { referenceVersionId: 'reference-v1', strength: .5 } : { colorCount: 6 } });
            assert.equal(result.job.status, 'succeeded');
            const outputIndex = tool === 'color.transfer' ? 2 : 1;
            const output = result.state.canvas.nodes[outputIndex].payload.versions[0];
            assert.deepEqual(output.metadata, f.output.versions[0].metadata); assert.deepEqual(output.provenance, f.output.versions[0].provenance);
            const imported = parseCanvasDocument(serializeCanvasDocument(result.state.canvas));
            assert.deepEqual(imported.nodes[outputIndex].payload.versions[0], output);
            const saved = JSON.parse(await readFile(join(f.root, 'nextmux.canvas.json'), 'utf8'));
            assert.deepEqual(saved.nodes[outputIndex].payload.versions[0].metadata, output.metadata);
            const restart = new PersistentComicCanvasToolsService(f.root, new ComicCanvasStore(f.root), {});
            const recovered = await restart.getJob(f.request.requestId);
            assert.deepEqual(recovered.job.result.versions[0].metadata, output.metadata);
            assert.deepEqual(recovered.job.result.versions[0].provenance, output.provenance);
            assert.deepEqual(recovered.state.canvas.nodes[outputIndex].payload.versions[0].metadata, output.metadata);
            const changed = structuredClone(imported); changed.nodes[outputIndex].payload.versions[0].metadata = { ...output.metadata, [tool === 'image.paletteExtract' ? 'palette' : 'colorTransfer']: {} };
            await assert.rejects(f.store.save(changed, result.state.canvas.revision, 'project'), error => error.code === 'CANVAS_VERSION_IMMUTABLE');
        } finally { await f.cleanup(); }
    }
});
