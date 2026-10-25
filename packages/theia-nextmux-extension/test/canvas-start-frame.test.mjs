import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import ts from 'typescript';
import { createCanvasDocument, createGenerationSnapshot, resolveCanvasInputs } from '@nextmux/comic-core';
import { MediaJobStore, enqueueRequest } from '@nextmux/media-core';
import { loadCanvasToolsSource } from './helpers/canvas-tools-source-loader.mjs';

const { ComicCanvasStore } = await loadCanvasToolsSource('node/nextmux-canvas-store.ts');
const { ComicCanvasStartFrameService, canvasStartFrameRecords, canvasStartFrameVideoIntent, canvasStartFramePricesChanged, isCanvasStartFrameMediaJob } = await loadCanvasToolsSource('node/nextmux-canvas-start-frame-service.ts');
const { createCanvasStartFrameDraft } = await loadCanvasToolsSource('common/nextmux-canvas-start-frame.ts');
const { startFrameTargetFingerprint } = await loadCanvasToolsSource('common/nextmux-canvas-start-frame.ts');
const { CanvasServiceError } = await loadCanvasToolsSource('node/nextmux-canvas-store.ts');
const { writeCanvasFrameSourceProof, readCanvasFrameSourceProof } = await loadCanvasToolsSource('node/nextmux-canvas-frame-source.ts');
const { canvasAdapterInputIssues } = await loadCanvasToolsSource('common/nextmux-canvas-adapter-policy.ts');
const { compileCanvasGenerationJob, canvasMediaClickKey } = await loadCanvasToolsSource('node/nextmux-canvas-generation.ts');
const { requireValidKeyPriceQuoteId } = await loadCanvasToolsSource('common/nextmux-price-quote.ts');
const now = '2026-10-09T10:00:00.000Z', projectId = 'project-11111111-1111-4111-8111-111111111111';
const imageConnection = 'official-11111111-1111-4111-8111-111111111111', videoConnection = 'official-22222222-2222-4222-8222-222222222222';
const cost = { billing: 'provider_billed', description: 'Local test fixture; no provider is called' };
const geometry = { position: { x: 20, y: 30 }, size: { width: 320, height: 240 } };
const variant = { id: 'square', resolution: '512x512', aspectRatios: ['1:1'], defaultAspectRatio: '1:1', dimensions: { '1:1': { width: 512, height: 512 } } };
const capability = (kind, max = 4) => ({ id: `${kind}-route`, providerId: 'fixture', providerModelId: `${kind}-model`, displayName: kind, version: 'verified-v1', status: 'available', sources: ['local behavior fixture'],
    modes: kind === 'image' ? [{ mode: 'imageToImage', outputVariants: [variant], defaultResolution: variant.resolution,
        referenceRules: { image: { supported: true, maxCount: max } }, combinationConstraints: [{ combination: 'image', maxImages: max }] }]
        : [{ mode: 'imageToVideo', outputVariants: [variant], firstFrame: true, frameImageRule: { supported: true, maxCount: 1 }, duration: { kind: 'enum', seconds: [6, 8], defaultSeconds: 6 }, audioGeneration: { mode: 'unsupported', defaultEnabled: false } }] });
const policy = kind => ({ adapter: 'official', kind, modes: kind === 'image' ? ['imageToImage'] : ['imageToVideo'], lastFrame: false,
    firstFrameField: 'firstFrameUri', maxImageReferences: kind === 'image' ? 4 : 0, framesWithImageReferences: false,
    referenceVideos: false, referenceAudios: false, sourceVideo: false, preserveOriginalAudio: false, negativePromptInPrompt: false,
    subtitles: 'unsupported', audioRequestEnabled: false });
const digest = value => createHash('sha256').update(value).digest('hex');

async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-start-frame-'));
    await mkdir(join(root, 'nextmux.media'));
    const png = new PNG({ width: 512, height: 512 }); png.data.fill(160); const bytes = PNG.sync.write(png);
    for (const name of ['tail.png', 'portrait.png', 'result.png']) await writeFile(join(root, 'nextmux.media', name), bytes);
    const sourceBytes = Buffer.from('local source-video identity fixture; not a provider video'); await writeFile(join(root, 'nextmux.media/source.mp4'), sourceBytes);
    const version = (id, uri, kind = 'image') => ({ id, assetId: `asset-${id}`, kind, uri: `nextmux.media/${uri}`, createdAt: now, metadata: { width: 512, height: 512, byteLength: kind === 'video' ? sourceBytes.length : bytes.length, sha256: digest(kind === 'video' ? sourceBytes : bytes), mimeType: kind === 'video' ? 'video/mp4' : 'image/png' } });
    const source = version('source-v1', 'source.mp4', 'video'), tail = { ...version('tail-v1', 'tail.png'), provenance: { operation: 'frameExtract', sourceVersionId: 'source-v1', sourceNodeId: 'source', frameSelection: { kind: 'last' }, actualTimeMs: 5960 } };
    const portrait = version('portrait-v1', 'portrait.png');
    const mediaNode = (id, media) => ({ id, title: id, kind: media.kind, ...geometry, payload: { versions: [media], currentVersionId: media.id } });
    let canvas = { ...createCanvasDocument({ id: 'canvas-fixture', projectId, now }), nodes: [mediaNode('source', source), mediaNode('tail', tail), mediaNode('portrait', portrait),
        { id: 'target', title: 'Next video', kind: 'videoGen', ...geometry, payload: { modelId: 'video-model', mode: 'imageToVideo', prompt: 'The character returns to the room.', parameters: { resolution: '512x512', aspectRatio: '1:1', durationSeconds: 6 }, versions: [] } }],
        edges: [{ id: 'tail-link', sourceNodeId: 'tail', sourcePort: 'output', targetNodeId: 'target', targetPort: 'firstFrame', role: 'firstFrame', order: 0, binding: 'pinnedVersion', pinnedVersionId: tail.id }] };
    const store = new ComicCanvasStore(root); await store.save(canvas, 0, projectId);
    const queue = await MediaJobStore.create({ root: join(root, 'queue') });
    let enqueueCalls = 0; const checked = [];
    const ports = {
        capability: async (_connection, _model, kind) => capability(kind), adapter: async (_connection, _model, kind) => policy(kind), size: async () => ({ width: 512, height: 512 }),
        validateFile: async media => { const data = await readFile(join(root, media.uri)); if (digest(data) !== media.metadata?.sha256) { const error = new Error('changed local bytes'); error.code = 'START_FRAME_REFERENCE_CHANGED'; throw error; } },
        validateJob: async request => { checked.push(request.kind); assert.equal(request.cost.billing, request.input.connectionId.startsWith('managed:') ? 'platform_billed' : 'provider_billed'); const issues = canvasAdapterInputIssues(await ports.adapter(request.input.connectionId, request.input.model, request.kind), request.kind, request.input); if (issues.length) { const error = new Error(issues[0].message); error.code = issues[0].code; throw error; } },
        execution: async () => ({}), enqueue: async request => { enqueueCalls++; return queue.enqueue(request); }, getJob: id => queue.get(id), libraryVersions: async ids => ids.map(id => ({ ...portrait, id: `library-version-${id}`, assetId: `library-asset-${id}`, provenance: { operation: 'assetLibrary.import' } })),
        sourceVideo: async (frame, current) => current.nodes.flatMap(n => 'versions' in n.payload ? n.payload.versions : []).find(v => v.kind === 'video' && v.id === frame.provenance?.sourceVersionId) ?? readCanvasFrameSourceProof(root, frame)
    };
    const service = new ComicCanvasStartFrameService(store, ports);
    const request = { workspaceRoot: root, nodeId: 'target', imageRoute: { connectionId: imageConnection, modelId: 'image-model', parameters: { resolution: '512x512', aspectRatio: '1:1' }, cost }, videoConnectionId: videoConnection, videoCost: cost, characterVersionIds: [portrait.id] };
    const runRequest = async (extra = {}) => ({ ...request, idempotencyKey: 'first-two-step-click', planFingerprint: (await service.plan({ ...request, ...extra })).fingerprint, acceptedTwoStepBilling: true, ...extra });
    const finish = async result => {
        await queue.confirm(result.job.id); const running = await queue.claimNext('media-worker-start-frame-test'); assert.equal(running.id, result.job.id);
        const output = { assetId: `asset-${running.id.slice('media-job-'.length)}`, assetKind: 'image', relativeUri: 'nextmux.media/result.png', mimeType: 'image/png', byteLength: bytes.length, sha256: digest(bytes), provider: 'local fixture', model: 'image-model' };
        const generated = { id: `version-${running.id}`, assetId: output.assetId, kind: 'image', uri: output.relativeUri, createdAt: running.startedAt,
            metadata: { width: 512, height: 512, mimeType: output.mimeType, byteLength: output.byteLength, sha256: output.sha256 }, provenance: { jobId: running.id, operation: 'startFrameComposition', sourceVersionId: source.id } };
        await queue.saveCheckpoint(running.id, 'media-worker-start-frame-test', output); await service.attach(running, generated); await queue.complete(running.id, 'media-worker-start-frame-test'); return generated;
    };
    return { root, store, queue, service, ports, request, runRequest, finish, tail, portrait, source, checked, get enqueueCalls() { return enqueueCalls; }, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('plan preflights both selected routes and portrait order without enqueuing or adding canvas nodes', async () => {
    const f = await fixture(); try {
        const before = await f.store.read(), plan = await f.service.plan(f.request);
        assert.match(plan.imagePrompt, /Reference image 1.*last frame/); assert.match(plan.imagePrompt, /Reference image 2.*portrait/);
        assert.deepEqual(plan.characterVersionIds, [f.portrait.id]); assert.deepEqual(f.checked, ['image', 'video']);
        assert.equal(f.enqueueCalls, 0); assert.equal((await f.queue.list()).length, 0); assert.deepEqual(await f.store.read(), before);
    } finally { await f.cleanup(); }
});
test('unsupported video or insufficient real image capability rejects before any paid task', async () => {
    const f = await fixture(); try {
        f.ports.capability = async (_c, _m, kind) => kind === 'video' ? { ...capability(kind), modes: [{ mode: 'textToVideo' }] } : capability(kind);
        await assert.rejects(f.service.plan(f.request), { code: 'START_FRAME_VIDEO_UNSUPPORTED' });
        f.ports.capability = async (_c, _m, kind) => capability(kind, 1);
        await assert.rejects(f.service.plan(f.request), { code: 'START_FRAME_IMAGE_UNSUPPORTED' });
        assert.equal(f.enqueueCalls, 0); assert.equal((await f.queue.list()).length, 0);
    } finally { await f.cleanup(); }
});
test('model reference budget and the existing four-image queue limit are separate authorities', async () => {
    const f = await fixture(); try {
        const canvas = (await f.store.read()).canvas, portraits = Array.from({ length: 4 }, (_, i) => ({ ...f.portrait, id: `person-${i}`, assetId: `person-asset-${i}` }));
        const draft = createCanvasStartFrameDraft({ canvas, nodeId: 'target', imageCapability: capability('image', 8), videoCapability: capability('video'), imageParameters: f.request.imageRoute.parameters,
            characterVersionIds: portraits.map(p => p.id), characterVersions: portraits });
        assert.equal(draft.imageSnapshot.resolvedInputs.length, 5);
        f.ports.capability = async (_c, _m, kind) => capability(kind, 8);
        await assert.rejects(f.service.plan({ ...f.request, characterVersionIds: [], characterLibraryAssetIds: ['a', 'b', 'c', 'd'] }), { code: 'CANVAS_ADAPTER_REFERENCE_LIMIT' });
        assert.equal(f.enqueueCalls, 0);
    } finally { await f.cleanup(); }
});
test('owned library portraits participate without a reference node or wire', async () => {
    const f = await fixture(); try {
        const request = { ...f.request, characterVersionIds: [], characterLibraryAssetIds: ['existing-owned-portrait'] };
        const before = (await f.store.read()).canvas;
        const plan = await f.service.plan(request); assert.deepEqual(plan.characterVersionIds, ['library-version-existing-owned-portrait']);
        assert.deepEqual((await f.store.read()).canvas.nodes, before.nodes); assert.deepEqual((await f.store.read()).canvas.edges, before.edges);
    } finally { await f.cleanup(); }
});
test('same concurrent click reserves one durable image and a stable initial video continuation', async () => {
    const f = await fixture(); try {
        const request = await f.runRequest(); const [a, b] = await Promise.all([f.service.run(request), new ComicCanvasStartFrameService(f.store, f.ports).run(request)]);
        assert.equal(a.job.id, b.job.id); assert.equal(a.preparationId, b.preparationId); assert.equal(a.videoContinuationKey, b.videoContinuationKey);
        assert.equal((await f.queue.list()).length, 1); assert.equal(a.state.canvas.nodes.length, 4); assert.ok(isCanvasStartFrameMediaJob(a.job));
        const record = canvasStartFrameRecords((await new ComicCanvasStore(f.root).read()).canvas)[0];
        assert.equal(record.request.input.characterReferenceUris.length, 2); assert.equal(record.request.input.connectionId, imageConnection);
        assert.equal(record.selection.videoConnectionId, videoConnection);
    } finally { await f.cleanup(); }
});
test('crash after queue persistence but before reply recovers the original frozen key without a second task', async () => {
    const f = await fixture(); try {
        const original = f.ports.enqueue; let fail = true; f.ports.enqueue = async (...args) => { const job = await original(...args); if (fail) { fail = false; throw new Error('simulated lost reply'); } return job; };
        const request = await f.runRequest(); await assert.rejects(f.service.run(request), /lost reply/);
        assert.equal((await f.queue.list()).length, 1);
        const reopened = new ComicCanvasStartFrameService(new ComicCanvasStore(f.root), f.ports), result = await reopened.run(request);
        assert.equal(result.job.id, (await f.queue.list())[0].id); assert.equal((await f.queue.list()).length, 1);
        assert.equal(result.videoContinuationKey, canvasStartFrameRecords(result.state.canvas)[0].videoContinuationKey);
    } finally { await f.cleanup(); }
});
test('missing consent, a changed plan and a reused conflicting click never enqueue', async () => {
    const f = await fixture(); try {
        const request = await f.runRequest(); await assert.rejects(f.service.run({ ...request, acceptedTwoStepBilling: false }), { code: 'COST_CONFIRMATION_REQUIRED' });
        await assert.rejects(f.service.run({ ...request, planFingerprint: 'changed' }), { code: 'START_FRAME_PLAN_CHANGED' }); assert.equal(f.enqueueCalls, 0);
        await f.service.run(request); await assert.rejects(f.service.run({ ...request, planFingerprint: 'different' }), { code: 'REQUEST_ID_CONFLICT' }); assert.equal((await f.queue.list()).length, 1);
    } finally { await f.cleanup(); }
});
test('apply preserves unrelated concurrent changes, existing video versions and canvas geometry', async () => {
    const f = await fixture(); try {
        const submitted = await f.service.run(await f.runRequest()), generated = await f.finish(submitted);
        await f.store.mutate(canvas => ({ ...canvas, title: 'Other node completed meanwhile', nodes: canvas.nodes.map(n => n.id === 'source' ? { ...n, position: { x: 800, y: 70 } } : n) }));
        const before = (await f.store.read()).canvas;
        const applied = await f.service.apply({ workspaceRoot: f.root, nodeId: 'target', preparationId: submitted.preparationId, versionId: generated.id });
        assert.equal(applied.canvas.nodes.length, before.nodes.length); assert.equal(applied.canvas.title, before.title);
        assert.deepEqual(applied.canvas.nodes.find(n => n.id === 'source'), before.nodes.find(n => n.id === 'source'));
        const snapshot = createGenerationSnapshot(applied.canvas, 'target', { capabilityVersion: 'verified-v1' });
        assert.equal(snapshot.resolvedInputs.find(i => i.role === 'firstFrame').versionId, generated.id);
        assert.deepEqual(applied.canvas.nodes.find(n => n.id === 'target').payload.versions, []);
        const again = await f.service.apply({ workspaceRoot: f.root, nodeId: 'target', preparationId: submitted.preparationId, versionId: generated.id });
        assert.equal(again.canvas.nodes.find(n => n.id === 'target').payload.inputs.length, 1);
    } finally { await f.cleanup(); }
});
test('a completed applied local frame is reused on reopen; explicit redo is a distinct paid image task', async () => {
    const f = await fixture(); try {
        const result = await f.service.run(await f.runRequest()), generated = await f.finish(result);
        await f.service.apply({ workspaceRoot: f.root, nodeId: 'target', preparationId: result.preparationId, versionId: generated.id });
        const service = new ComicCanvasStartFrameService(new ComicCanvasStore(f.root), f.ports), plan = await service.plan(f.request);
        assert.equal(plan.readyVersion.id, generated.id); assert.equal(plan.videoContinuationKey, result.videoContinuationKey);
        const reused = await service.run({ ...f.request, idempotencyKey: 'reopened-new-click', acceptedTwoStepBilling: true, planFingerprint: plan.fingerprint });
        assert.equal(reused.job.id, result.job.id); assert.equal((await f.queue.list()).length, 1);
        const redo = { ...f.request, regenerate: true }, redoPlan = await service.plan(redo);
        const next = await service.run({ ...redo, idempotencyKey: 'explicit-new-image-click', acceptedTwoStepBilling: true, planFingerprint: redoPlan.fingerprint });
        assert.notEqual(next.job.id, result.job.id); assert.equal((await f.queue.list()).length, 2);
        assert.notEqual(next.videoContinuationKey, result.videoContinuationKey);
    } finally { await f.cleanup(); }
});
test('a changed target or source blocks automatic application but retains the paid output locally', async () => {
    const f = await fixture(); try {
        const result = await f.service.run(await f.runRequest()), generated = await f.finish(result);
        await f.store.mutate(canvas => ({ ...canvas, nodes: canvas.nodes.map(n => n.id === 'target' ? { ...n, payload: { ...n.payload, prompt: 'A different shot.' } } : n) }));
        await assert.rejects(f.service.apply({ workspaceRoot: f.root, nodeId: 'target', preparationId: result.preparationId, versionId: generated.id }), { code: 'START_FRAME_PLAN_CHANGED' });
        assert.equal((await f.service.get(result.preparationId)).version.id, generated.id); assert.equal((await f.queue.list()).length, 1);
    } finally { await f.cleanup(); }
});
test('hash changes and newly selected source versions are rejected before initial dispatch', async () => {
    const f = await fixture(); try {
        const result = await f.service.run(await f.runRequest()); await writeFile(join(f.root, 'nextmux.media/portrait.png'), 'changed');
        await assert.rejects(f.service.validateJob(result.job, false), { code: 'START_FRAME_REFERENCE_CHANGED' });
        // Already accepted provider tasks retain their original task identity and can be polled without re-uploading changed files.
        await f.service.validateJob(result.job, true);
        assert.equal((await f.queue.list()).length, 1);
    } finally { await f.cleanup(); }
});
test('a changed source current version is detected independently from canvas revision', async () => {
    const f = await fixture(); try {
        const result = await f.service.run(await f.runRequest());
        await f.store.mutate(canvas => ({ ...canvas, nodes: canvas.nodes.map(n => n.id === 'source' ? { ...n, payload: { ...n.payload, versions: [...n.payload.versions, { ...f.source, id: 'source-v2' }], currentVersionId: 'source-v2' } } : n) }));
        await assert.rejects(f.service.validateJob(result.job, false), { code: 'START_FRAME_REFERENCE_CHANGED' });
        assert.equal((await f.queue.list()).length, 1);
    } finally { await f.cleanup(); }
});

test('cancelled preparations do not auto-apply or dispatch videos; explicit image redo waits for active work', async () => {
    const f = await fixture(); try {
        const result = await f.service.run(await f.runRequest());
        const plan = await f.service.plan({ ...f.request, regenerate: true });
        await assert.rejects(f.service.run({ ...f.request, regenerate: true, idempotencyKey: 'redo-while-active', acceptedTwoStepBilling: true, planFingerprint: plan.fingerprint }), { code: 'START_FRAME_BUSY' });
        await f.queue.cancel(result.job.id);
        await assert.rejects(f.service.apply({ workspaceRoot: f.root, nodeId: 'target', preparationId: result.preparationId, versionId: 'never-produced' }), { code: 'START_FRAME_OUTPUT_INVALID' });
        assert.equal((await f.queue.list()).length, 1); assert.equal((await f.store.read()).canvas.nodes.find(n => n.id === 'target').payload.inputs, undefined);
    } finally { await f.cleanup(); }
});
test('the original paid output survives target removal without adding hidden canvas nodes', async () => {
    const f = await fixture(); try {
        const result = await f.service.run(await f.runRequest()), generated = await f.finish(result);
        await f.store.mutate(canvas => ({ ...canvas, nodes: canvas.nodes.filter(n => n.id !== 'target'), edges: [] }));
        const view = await f.service.get(result.preparationId); assert.equal(view.version.id, generated.id); assert.equal(view.applied, false);
        assert.equal(view.state.canvas.nodes.length, 3);
    } finally { await f.cleanup(); }
});
// Run the actual platform RPC entry and the claim/claimed-body helpers it delegates to.
async function compileCanvasRunHarness() {
    const source = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const cls = ast.statements.find(s => ts.isClassDeclaration(s) && s.name?.text === 'NextMuxPlatformServiceImpl');
    const methodNames = new Set(['runComicCanvasNode', 'runComicCanvasNodeClaimed', 'claimCanvasMediaPendingNode', 'releaseCanvasMediaPendingNode', 'canvasMediaPendingNodeKey']);
    const methods = cls.members.filter(m => ts.isMethodDeclaration(m) && methodNames.has(m.name.getText(ast))).map(m => m.getText(ast));
    const helperNames = ['mediaJobActionKey', 'workspaceIdentityPath'], helperVariables = ['MEDIA_JOB_ACTION_CLAIMS', 'MEDIA_CANVAS_PENDING_ACTIONS'], helpers = [];
    (function walk(node) {
        if (ts.isFunctionDeclaration(node) && helperNames.includes(node.name?.getText(ast))) helpers.push(node.getText(ast));
        if (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => helperVariables.includes(item.name.getText(ast)))) helpers.push(node.getText(ast));
        ts.forEachChild(node, walk);
    })(ast);
    const dependencies = { CanvasServiceError, canvasStartFrameRecords, startFrameTargetFingerprint, canvasStartFrameVideoIntent,
        canvasStartFramePricesChanged, requireValidKeyPriceQuoteId, createGenerationSnapshot, enqueueRequest, compileCanvasGenerationJob, canvasMediaClickKey,
        resolveCanvasInputs, resolve, dirname, join, realpathSync };
    const compiled = ts.transpileModule(`const { ${Object.keys(dependencies).join(', ')} } = deps; ${helpers.join('\n')} class Harness { ${methods.join('\n')} }; return Harness;`,
        { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return new Function('deps', compiled)(dependencies);
}

test('actual runCanvas continuation seam refuses post-consent edits before capability lookup or dispatch', async () => {
    const f = await fixture(); try {
        const result = await f.service.run(await f.runRequest()), generated = await f.finish(result);
        await f.service.apply({ workspaceRoot: f.root, nodeId: 'target', preparationId: result.preparationId, versionId: generated.id });
        const Harness = await compileCanvasRunHarness();
        let capabilityLookups = 0;
        const h = Object.assign(new Harness(), { canvasStore: () => f.store, canvasCapability: async () => { capabilityLookups++; throw new Error('normal generation reached'); } });
        const request = { workspaceRoot: f.root, nodeId: 'target', expectedRevision: (await f.store.read()).canvas.revision, connectionId: videoConnection, idempotencyKey: result.videoContinuationKey, cost };
        await assert.rejects(h.runComicCanvasNode({ ...request, connectionId: imageConnection }), { code: 'START_FRAME_PLAN_CHANGED' });
        await f.store.mutate(canvas => ({ ...canvas, nodes: canvas.nodes.map(n => n.id === 'target' ? { ...n, payload: { ...n.payload, prompt: 'Changed after consent.' } } : n) }));
        await assert.rejects(h.runComicCanvasNode({ ...request, expectedRevision: (await f.store.read()).canvas.revision }), { code: 'START_FRAME_PLAN_CHANGED' });
        assert.equal(capabilityLookups, 0); assert.equal((await f.queue.list()).length, 1);
        await assert.rejects(h.runComicCanvasNode({ ...request, idempotencyKey: 'normal-explicit-new-video', expectedRevision: (await f.store.read()).canvas.revision }), /normal generation reached/);
        assert.equal(capabilityLookups, 1);
    } finally { await f.cleanup(); }
});

test('direct extracted tails use owned extraction proof after the original direct video input is replaced', async () => {
    const f = await fixture(); try {
        const tail = { ...f.tail, provenance: { ...f.tail.provenance, sourceNodeId: undefined, sourceAssetId: f.source.assetId, sourceUri: f.source.uri, sourceSha256: f.source.metadata.sha256 } };
        await writeCanvasFrameSourceProof(f.root, tail, f.source);
        await f.store.mutate(canvas => ({ ...canvas, nodes: canvas.nodes.filter(n => !['source', 'tail'].includes(n.id)).map(n => n.id === 'target'
            ? { ...n, payload: { ...n.payload, inputs: [{ id: 'direct-tail', role: 'firstFrame', order: 0, version: tail }] } } : n), edges: [] }));
        const plan = await f.service.plan(f.request); assert.equal(plan.tailFrameVersionId, tail.id);
        const result = await f.service.run(await f.runRequest()); assert.equal(result.state.canvas.nodes.length, 2);
        await f.service.validateJob(result.job, false); assert.equal((await f.queue.list()).length, 1);
    } finally { await f.cleanup(); }
});
test('caller-mutated direct provenance and old direct frames lacking proof do not dispatch', async () => {
    const f = await fixture(); try {
        const tail = { ...f.tail, provenance: { ...f.tail.provenance, sourceNodeId: undefined, sourceAssetId: f.source.assetId, sourceUri: f.source.uri, sourceSha256: f.source.metadata.sha256 } };
        await writeCanvasFrameSourceProof(f.root, tail, f.source);
        await assert.rejects(readCanvasFrameSourceProof(f.root, { ...tail, provenance: { ...tail.provenance, sourceUri: 'nextmux.media/other.mp4' } }), { code: 'START_FRAME_SOURCE_PROOF_INVALID' });
        await assert.rejects(readCanvasFrameSourceProof(f.root, { ...tail, id: 'old-direct-frame-without-proof' }), { code: 'START_FRAME_SOURCE_PROOF_REQUIRED' });
        assert.equal(f.enqueueCalls, 0); assert.equal((await f.queue.list()).length, 0);
    } finally { await f.cleanup(); }
});
test('image request dimensions are checked against the video frame rule before image submission', async () => {
    const f = await fixture(); try {
        await f.store.mutate(canvas => ({ ...canvas, nodes: canvas.nodes.map(n => n.id === 'tail' ? { ...n, payload: { ...n.payload, versions: [{ ...f.tail, metadata: { ...f.tail.metadata, width: 1280, height: 720 } }] } } : n) }));
        f.ports.capability = async (_c, _m, kind) => kind === 'video' ? { ...capability(kind), modes: capability(kind).modes.map(mode => ({ ...mode, frameImageRule: { supported: true, maxCount: 1, aspectRatios: ['16:9'] } })) } : capability(kind);
        // The old tail is 16:9, but the selected image request is square. It must not be accepted as a 16:9 future frame.
        await assert.rejects(f.service.plan(f.request), { code: 'START_FRAME_VIDEO_UNSUPPORTED' });
        assert.equal(f.enqueueCalls, 0);
    } finally { await f.cleanup(); }
});
test('actual generated frame metadata is revalidated before video application', async () => {
    const f = await fixture(); try {
        const result = await f.service.run(await f.runRequest()), generated = await f.finish(result);
        f.ports.capability = async (_c, _m, kind) => kind === 'video' ? { ...capability(kind), modes: capability(kind).modes.map(mode => ({ ...mode, frameImageRule: { supported: true, maxCount: 1, aspectRatios: ['16:9'] } })) } : capability(kind);
        await assert.rejects(f.service.apply({ workspaceRoot: f.root, nodeId: 'target', preparationId: result.preparationId, versionId: generated.id }));
        assert.equal((await f.service.get(result.preparationId)).version.id, generated.id); assert.equal((await f.queue.list()).length, 1);
        assert.equal((await f.store.read()).canvas.nodes.find(n => n.id === 'target').payload.inputs, undefined);
    } finally { await f.cleanup(); }
});

// Run the actual platform RPC method against real local queue/journal stores.
// Only the provider boundary and catalog response are replaced; no API is called.
async function actualCanvasRunHarness(f, offering) {
    const Harness = await compileCanvasRunHarness();
    return Object.assign(new Harness(), {
        canvasStore: () => f.store, canvasStartFrameService: () => f.service,
        canvasCapability: (...args) => f.ports.capability(...args), canvasAdapterPolicy: (...args) => f.ports.adapter(...args),
        canvasInputFiles: async () => new Set(['nextmux.media/result.png', 'nextmux.media/tail.png', 'nextmux.media/portrait.png']),
        prepareCanvasSnapshot: async snapshot => snapshot, getCatalogOffering: async id => { assert.equal(id, offering.id); return offering; },
        validateCanvasMediaBilling: async request => assert.equal(request.cost.billing, request.input.connectionId.startsWith('managed:') ? 'platform_billed' : 'provider_billed'),
        validateCanvasAdapterInput: request => f.ports.validateJob(request), canvasMediaJobExecution: async () => ({}),
        mediaJobStore: async () => f.queue, ensureMediaRecovery: async () => undefined, scheduleMediaWorker: () => undefined
    });
}
const quote = letter => `kq1_${letter.repeat(64)}`;
const price = (multiplierBps = 10000, amountMicros = 60000, unitSize = 1, quoteAt = 1) => ({ status: 'complete', currency: 'USD', quoteAt, multiplierBps,
    dimensions: [{ metric: 'video_second', currency: 'USD', official: { sourceType: 'official_charge_contract', amountMicros: 60000, unitSize: 1 }, user: { amountMicros, unitSize } }] });

test('a quote TTL refresh is not a price change; multiplier and normalized user rate changes are', () => {
    assert.equal(canvasStartFramePricesChanged(price(), price(10000, 120000, 2, 999)), false);
    assert.equal(canvasStartFramePricesChanged(price(), price(11000, 66000)), true);
    assert.equal(canvasStartFramePricesChanged(price(), price(10000, 70000)), true);
    assert.equal(canvasStartFramePricesChanged(price(10000, 0), price(10000, 0, 10)), false);
    assert.equal(canvasStartFramePricesChanged({ ...price(), status: 'incomplete' }, price()), false);
});

test('duration, video API and video quote changes reuse the local image but produce a distinct reviewed video intent', async () => {
    const f = await fixture(); try {
        const submitted = await f.service.run(await f.runRequest()), generated = await f.finish(submitted);
        await f.service.apply({ workspaceRoot: f.root, nodeId: 'target', preparationId: submitted.preparationId, versionId: generated.id });
        const original = await f.service.plan(f.request);
        await f.store.mutate(canvas => ({ ...canvas, nodes: canvas.nodes.map(n => n.id === 'target' ? { ...n, payload: { ...n.payload, parameters: { ...n.payload.parameters, durationSeconds: 8 } } } : n) }));
        const changedRequest = { ...f.request, videoConnectionId: 'official-33333333-3333-4333-8333-333333333333', videoKeyPriceQuoteId: quote('b') };
        const changed = await f.service.plan(changedRequest);
        assert.equal(changed.readyVersion.id, generated.id); assert.equal(changed.reusablePreparationId, submitted.preparationId);
        assert.notEqual(changed.videoIntentFingerprint, original.videoIntentFingerprint); assert.notEqual(changed.videoContinuationKey, original.videoContinuationKey);
        assert.equal((await f.service.plan(changedRequest)).videoContinuationKey, changed.videoContinuationKey);
        const reused = await f.service.run({ ...changedRequest, idempotencyKey: 'new-reviewed-video-click', acceptedTwoStepBilling: true, planFingerprint: changed.fingerprint });
        assert.equal(reused.videoIntentFingerprint, changed.videoIntentFingerprint); assert.equal(reused.videoContinuationKey, changed.videoContinuationKey);
        assert.equal((await f.queue.list()).length, 1);
        const h = await actualCanvasRunHarness(f);
        const request = { workspaceRoot: f.root, nodeId: 'target', connectionId: changedRequest.videoConnectionId, cost, expectedRevision: (await f.store.read()).canvas.revision,
            idempotencyKey: changed.videoContinuationKey, startFrameContinuation: { preparationId: submitted.preparationId, intentFingerprint: changed.videoIntentFingerprint } };
        const video = await h.runComicCanvasNode(request);
        assert.equal(video.job.input.connectionId, changedRequest.videoConnectionId); assert.equal(video.job.input.durationSeconds, 8);
        assert.equal(video.job.input.firstFrameUri, generated.uri); assert.equal((await f.queue.list()).length, 2);
        assert.deepEqual((await new ComicCanvasStore(f.root).getRecord(request.idempotencyKey)).startFrameContinuation, request.startFrameContinuation);
        const recovered = await h.runComicCanvasNode(request); assert.equal(recovered.job.id, video.job.id); assert.equal((await f.queue.list()).length, 2);
        await assert.rejects(h.runComicCanvasNode({ ...request, connectionId: videoConnection }), { code: 'CANVAS_IDEMPOTENCY_CONFLICT' });
    } finally { await f.cleanup(); }
});

test('only the latest matching video intent is returned, and an explicit retry is a distinct actual queue task', async () => {
    const f = await fixture(); try {
        const submitted = await f.service.run(await f.runRequest()), generated = await f.finish(submitted);
        await f.service.apply({ workspaceRoot: f.root, nodeId: 'target', preparationId: submitted.preparationId, versionId: generated.id });
        const plan = await f.service.plan(f.request), h = await actualCanvasRunHarness(f);
        const initial = { workspaceRoot: f.root, nodeId: 'target', connectionId: videoConnection, cost, expectedRevision: (await f.store.read()).canvas.revision,
            idempotencyKey: plan.videoContinuationKey, startFrameContinuation: { preparationId: submitted.preparationId, intentFingerprint: plan.videoIntentFingerprint } };
        const first = await h.runComicCanvasNode(initial); await f.store.recordJob(await f.queue.cancel(first.job.id));
        const retry = await h.runComicCanvasNode({ ...initial, expectedRevision: (await f.store.read()).canvas.revision, idempotencyKey: 'explicit-video-retry' });
        assert.notEqual(retry.job.id, first.job.id); assert.equal((await f.service.get(submitted.preparationId, plan.videoIntentFingerprint)).videoJob.id, retry.job.id);
        const other = await f.service.plan({ ...f.request, videoConnectionId: imageConnection });
        assert.notEqual(other.videoIntentFingerprint, plan.videoIntentFingerprint);
        assert.equal((await f.service.get(submitted.preparationId, other.videoIntentFingerprint)).videoJob, undefined);
        assert.equal((await f.queue.list()).length, 3); // one image and two explicit video attempts
    } finally { await f.cleanup(); }
});

test('managed video dispatch uses its current quote and actual price change while an accepted video keeps its original quote', async () => {
    const f = await fixture(); try {
        const id = '22222222-2222-4222-8222-222222222222', managed = `managed:fixed:${id}`;
        const offering = { id, providerModelCode: 'video-model', status: 'active', available: true, keyPriceQuoteId: quote('a'), pricingDetails: price() };
        f.request.videoConnectionId = managed; f.request.videoCost = { ...cost, billing: 'platform_billed' }; f.request.videoKeyPriceQuoteId = quote('a');
        f.ports.videoPrice = async () => offering.pricingDetails;
        f.ports.adapter = async (_c, _m, kind) => kind === 'video' ? { ...policy(kind), adapter: 'managed', videoShapeQuoteId: offering.keyPriceQuoteId,
            videoShapeProofs: [{ resolution: '512x512', aspectRatio: '1:1', durationSeconds: 6, width: 512, height: 512,
                firstFrame: true, lastFrame: false, referenceImages: 0, requestAudio: false }] } : policy(kind);
        const submitted = await f.service.run(await f.runRequest()), generated = await f.finish(submitted);
        offering.keyPriceQuoteId = quote('b'); offering.pricingDetails = price(11000, 66000, 1, 2);
        const plan = await f.service.plan(f.request);
        await f.service.apply({ workspaceRoot: f.root, nodeId: 'target', preparationId: submitted.preparationId, versionId: generated.id,
            videoConnectionId: managed, videoKeyPriceQuoteId: quote('a'), intentFingerprint: plan.videoIntentFingerprint });
        const h = await actualCanvasRunHarness(f, offering);
        const request = { workspaceRoot: f.root, nodeId: 'target', connectionId: managed, cost: f.request.videoCost,
            keyPriceQuoteId: quote('a'), expectedRevision: (await f.store.read()).canvas.revision, idempotencyKey: plan.videoContinuationKey,
            startFrameContinuation: { preparationId: submitted.preparationId, intentFingerprint: plan.videoIntentFingerprint } };
        const video = await h.runComicCanvasNode(request);
        assert.equal(video.job.input.keyPriceQuoteId, quote('b')); assert.equal(video.startFramePricing.changed, true);
        assert.equal(video.startFramePricing.before.multiplierBps, 10000); assert.equal(video.startFramePricing.effective.multiplierBps, 11000);
        offering.keyPriceQuoteId = quote('c'); offering.pricingDetails = price(12000, 72000, 1, 3);
        const resumed = await h.runComicCanvasNode(request);
        assert.equal(resumed.job.id, video.job.id); assert.equal(resumed.job.input.keyPriceQuoteId, quote('b')); assert.equal(resumed.startFramePricing.changed, undefined);
        assert.equal((await f.queue.list()).length, 2);
    } finally { await f.cleanup(); }
});

test('a reviewed cached video cannot dispatch after its prompt or selected source changes', async () => {
    const f = await fixture(); try {
        const submitted = await f.service.run(await f.runRequest()), generated = await f.finish(submitted);
        await f.service.apply({ workspaceRoot: f.root, nodeId: 'target', preparationId: submitted.preparationId, versionId: generated.id });
        const plan = await f.service.plan(f.request), h = await actualCanvasRunHarness(f);
        const request = { workspaceRoot: f.root, nodeId: 'target', connectionId: videoConnection, cost, expectedRevision: (await f.store.read()).canvas.revision,
            idempotencyKey: plan.videoContinuationKey, startFrameContinuation: { preparationId: submitted.preparationId, intentFingerprint: plan.videoIntentFingerprint } };
        await f.store.mutate(canvas => ({ ...canvas, nodes: canvas.nodes.map(n => n.id === 'target' ? { ...n, payload: { ...n.payload, prompt: 'A newly edited shot.' } } : n) }));
        await assert.rejects(h.runComicCanvasNode({ ...request, expectedRevision: (await f.store.read()).canvas.revision }), { code: 'START_FRAME_PLAN_CHANGED' });
        const changedPlan = await f.service.plan(f.request); assert.equal(changedPlan.readyVersion, undefined); assert.notEqual(changedPlan.fingerprint, plan.fingerprint);
        await f.store.mutate(canvas => ({ ...canvas, nodes: canvas.nodes.map(n => n.id === 'target' ? { ...n, payload: { ...n.payload, prompt: 'The character returns to the room.' } } : n) }));
        await writeFile(join(f.root, 'nextmux.media/source.mp4'), 'new source bytes');
        await assert.rejects(h.runComicCanvasNode({ ...request, expectedRevision: (await f.store.read()).canvas.revision }), { code: 'START_FRAME_REFERENCE_CHANGED' });
        assert.equal((await f.queue.list()).length, 1); assert.equal((await f.service.get(submitted.preparationId)).version.id, generated.id);
    } finally { await f.cleanup(); }
});

test('named portraits are mapped into the image prompt, and changed names cannot silently reuse the old image', async () => {
    const f = await fixture(); try {
        await f.store.mutate(canvas => ({ ...canvas, nodes: canvas.nodes.map(n => n.id === 'portrait' ? { ...n, title: 'Alice', origin: { role: 'portrait' } } : n) }));
        const plan = await f.service.plan(f.request); assert.match(plan.imagePrompt, /Reference image 2.*"Alice"/);
        const submitted = await f.service.run(await f.runRequest()), generated = await f.finish(submitted);
        await f.service.apply({ workspaceRoot: f.root, nodeId: 'target', preparationId: submitted.preparationId, versionId: generated.id });
        await f.store.mutate(canvas => ({ ...canvas, nodes: canvas.nodes.map(n => n.id === 'portrait' ? { ...n, title: 'Bob' } : n) }));
        await assert.rejects(f.service.plan(f.request), { code: 'START_FRAME_REFERENCE_CHANGED' });
        assert.equal((await f.queue.list()).length, 1);
    } finally { await f.cleanup(); }
});
