import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCanvasToolsSource } from './helpers/canvas-tools-source-loader.mjs';

const { ComicCanvasToolsService } = await loadCanvasToolsSource('node/nextmux-canvas-tools-service.ts');
const { prepareCanvasModelToolRequest, CANVAS_MODEL_TOOL_OPERATIONS } = await loadCanvasToolsSource('common/nextmux-canvas-tool-contracts.ts');
const now = '2026-09-30T00:00:00.000Z';
async function fixture(runner) {
    const root = await mkdtemp(join(tmpdir(), 'canvas-tools-service-')); await writeFile(join(root, 'source.png'), 'fixture');
    const source = { id: 'source-v1', assetId: 'source-asset', kind: 'image', uri: 'source.png', createdAt: now };
    const node = { id: 'source', title: '人物', kind: 'image', position: { x: 0, y: 0 }, size: { width: 320, height: 240 }, payload: { versions: [source], currentVersionId: source.id } };
    let canvas = { schemaVersion: 1, id: 'canvas', projectId: 'project', title: 'Canvas', viewport: { x: 0, y: 0, zoom: 1 }, settings: {}, nodes: [node], edges: [], groups: [], revision: 1, createdAt: now, updatedAt: now };
    const store = { read: async () => ({ exists: true, fileName: 'nextmux.canvas.json', canvas: structuredClone(canvas), jobs: [] }),
        mutate: async operation => { const next = await operation(structuredClone(canvas)); canvas = { ...next, revision: canvas.revision + 1 }; return store.read(); } };
    const service = new ComicCanvasToolsService(root, store, {}, runner);
    const request = { requestId: 'click-1', nodeId: node.id, sourceVersionId: source.id, expectedRevision: 1, tool: 'image.mirror' };
    const result = { versions: [{ ...source, id: 'new-v1', assetId: 'new-asset', uri: 'result.png', provenance: { sourceVersionId: source.id, tool: 'image.mirror', parameters: {}, sourceVersionIds: [source.id] }, metadata: { width: 32, height: 32 } }] };
    return { root, store, service, request, result, setCanvas: next => { canvas = next; } };
}
test('facade deduplicates one click, freezes input and attaches new nodes while preserving concurrent edits', async () => {
    let calls = 0, release, input, options; const gate = new Promise(resolve => { release = resolve; });
    const f = await fixture(async (request, value) => { calls++; input = request; options = value; await gate; return f.result; });
    try {
        const first = f.service.run(f.request), again = f.service.run(f.request); assert.equal(first, again);
        f.request.tool = 'image.crop'; await assert.rejects(f.service.run(f.request), error => error.code === 'REQUEST_ID_CONFLICT');
        await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
        // Wait for the actual source path resolution rather than assuming disk reads complete in one tick.
        while (!options) await new Promise(resolve => setImmediate(resolve));
        options.onProgress({ stage: 'process', completedOutputs: 0, totalOutputs: 1, fraction: .5 });
        assert.equal(f.service.getJob('click-1').progress.fraction, .5); assert.equal(input.tool, 'image.mirror'); assert.match(input.source.uri, /^file:/);
        const { canvas } = await f.store.read(); f.setCanvas({ ...canvas, title: 'Changed during processing', revision: 2 }); release();
        const finished = await first; assert.equal(finished.status, 'succeeded'); assert.equal(calls, 1); assert.equal(finished.nodeIds.length, 1);
        const final = (await f.store.read()).canvas; assert.equal(final.title, 'Changed during processing'); assert.equal(final.nodes.length, 2); assert.equal(final.nodes[0].payload.currentVersionId, 'source-v1'); assert.equal(final.nodes[1].payload.currentVersionId, 'new-v1');
        const view = f.service.getJob('click-1'); view.result.versions[0].id = 'mutated'; assert.equal(f.service.getJob('click-1').result.versions[0].id, 'new-v1');
    } finally { release(); await rm(f.root, { recursive: true, force: true }); }
});
test('facade cancellation works before processing begins and stale revisions never invoke runner', async () => {
    let calls = 0;
    const f = await fixture(async (_, options) => { calls++; if (options.signal.aborted) throw new Error('cancelled'); return f.result; });
    try {
        const failed = await f.service.run({ ...f.request, requestId: 'stale', expectedRevision: 0 }); assert.equal(failed.status, 'failed'); assert.equal(failed.error.code, 'CANVAS_REVISION_CONFLICT'); assert.equal(calls, 0);
        const pending = f.service.run(f.request); f.service.cancel('click-1'); assert.equal((await pending).status, 'cancelled'); assert.equal((await f.store.read()).canvas.nodes.length, 1);
    } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('facade retains successful media result when source is removed before attachment', async () => {
    const f = await fixture(async () => { const { canvas } = await f.store.read(); f.setCanvas({ ...canvas, nodes: [], revision: 2 }); return f.result; });
    try {
        const finished = await f.service.run(f.request); assert.equal(finished.status, 'failed'); assert.equal(finished.error.code, 'SOURCE_VERSION_MISSING'); assert.equal(finished.result.versions[0].id, 'new-v1'); assert.equal((await f.store.read()).canvas.nodes.length, 0);
    } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('cancellation while waiting for the save lock does not attach outputs', async () => {
    let release, entered; const lock = new Promise(resolve => { release = resolve; }); const waitForLock = new Promise(resolve => { entered = resolve; });
    const f = await fixture(async () => f.result), mutate = f.store.mutate;
    f.store.mutate = async operation => { entered(); await lock; return mutate(operation); };
    try {
        const pending = f.service.run(f.request); await waitForLock; f.service.cancel(f.request.requestId); release();
        const result = await pending; assert.equal(result.status, 'cancelled'); assert.equal((await f.store.read()).canvas.nodes.length, 1); assert.equal(result.result.versions.length, 1);
    } finally { release(); await rm(f.root, { recursive: true, force: true }); }
});
test('same-ID source replacement during processing is rejected rather than misattributed', async () => {
    const f = await fixture(async () => { const { canvas } = await f.store.read(); const node = canvas.nodes[0]; f.setCanvas({ ...canvas, revision: 2, nodes: [{ ...node, payload: { ...node.payload, versions: [{ ...node.payload.versions[0], uri: 'replaced.png' }] } }] }); return f.result; });
    try { const result = await f.service.run(f.request); assert.equal(result.status, 'failed'); assert.equal(result.error.code, 'SOURCE_VERSION_CHANGED'); assert.equal((await f.store.read()).canvas.nodes.length, 1); }
    finally { await rm(f.root, { recursive: true, force: true }); }
});
test('model contracts require a capability-selected route and stable recovery key, without submission', () => {
    assert.equal(CANVAS_MODEL_TOOL_OPERATIONS.length, 13);
    const request = { idempotencyKey: 'generate-click', canvasId: 'canvas', nodeId: 'node', operation: 'image.upscale', source: { id: 'v1', assetId: 'a1', kind: 'image', uri: 'source.png', createdAt: now }, parameters: { scale: 2 }, route: { connectionId: 'connection', modelId: 'model', capabilityVersion: 'v1', verifiedOperations: ['image.upscale'] } };
    const frozen = prepareCanvasModelToolRequest(request); request.parameters.scale = 4; assert.equal(frozen.parameters.scale, 2); assert.ok(Object.isFrozen(frozen.source));
    assert.throws(() => prepareCanvasModelToolRequest({ ...request, route: { ...request.route, verifiedOperations: [] } }), /verified model/);
    assert.throws(() => prepareCanvasModelToolRequest({ ...request, source: { ...request.source, kind: 'audio' } }), /matching the tool/);
    assert.throws(() => prepareCanvasModelToolRequest({ ...request, references: [{ role: 'audio', version: request.source }] }), /explicit roles/);
});

test('facade rejects output directories that escape the project through either symlink component', async () => {
    for (const component of ['nextmux.media', 'canvas-tools']) {
        let calls = 0;
        const f = await fixture(async () => { calls++; return f.result; });
        const outside = await mkdtemp(join(tmpdir(), 'canvas-tools-outside-'));
        try {
            if (component === 'canvas-tools') await mkdir(join(f.root, 'nextmux.media'));
            await symlink(outside, component === 'nextmux.media' ? join(f.root, component) : join(f.root, 'nextmux.media', component));
            const result = await f.service.run(f.request);
            assert.equal(result.status, 'failed'); assert.equal(result.error.code, 'PROJECT_ASSET_REQUIRED'); assert.equal(calls, 0);
            assert.deepEqual(await readdir(outside), []);
        } finally { await rm(f.root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
    }
});
test('facade rejects LUT traversal and symlink escapes before invoking the local runner', async () => {
    let calls = 0;
    const f = await fixture(async () => { calls++; return f.result; });
    const outside = await mkdtemp(join(tmpdir(), 'canvas-lut-outside-')); const cube = join(outside, 'outside.cube'); await writeFile(cube, 'fixture');
    try {
        await symlink(cube, join(f.root, 'linked.cube'));
        for (const [index, cubePath] of [cube, '../' + outside.split('/').at(-1) + '/outside.cube', 'linked.cube'].entries()) {
            const result = await f.service.run({ ...f.request, requestId: `lut-${index}`, tool: 'color.lut', parameters: { cubePath } });
            assert.equal(result.status, 'failed'); assert.equal(result.error.code, 'PROJECT_ASSET_REQUIRED');
        }
        assert.equal(calls, 0);
    } finally { await rm(f.root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
test('facade resolves project-relative LUT paths and canonical output directories for the runner', async () => {
    let input, options;
    const f = await fixture(async (request, value) => { input = request; options = value; return f.result; });
    try {
        const cubePath = join(f.root, "-user's LUT.cube"); await writeFile(cubePath, 'fixture');
        const result = await f.service.run({ ...f.request, tool: 'color.lut', parameters: { cubePath: "-user's LUT.cube" } });
        assert.equal(result.status, 'succeeded'); assert.equal(input.parameters.cubePath, await realpath(cubePath));
        assert.equal(options.outputDirectory, await realpath(join(f.root, 'nextmux.media', 'canvas-tools')));
    } finally { await rm(f.root, { recursive: true, force: true }); }
});
