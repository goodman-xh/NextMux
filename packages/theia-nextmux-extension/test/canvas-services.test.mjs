import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { createCanvasDocument, applyCanvasCommand, createGenerationSnapshot, resolveCanvasInputs, sameCanvasCapabilityVersion } from '@nextmux/comic-core';
import { MediaJobStore, enqueueRequest } from '@nextmux/media-core';
import { officialMediaCapabilities } from '@nextmux/model-runtime';
import { startFrameTargetFingerprint } from '../lib/common/nextmux-canvas-start-frame.js';
import { requireValidKeyPriceQuoteId } from '../lib/common/nextmux-price-quote.js';
import { canvasStartFramePricesChanged, canvasStartFrameVideoIntent } from '../lib/node/nextmux-canvas-start-frame-service.js';
import { buildManagedCanvasAdapterPolicy, buildOfficialCanvasAdapterPolicy, canvasAdapterInputIssues } from '../lib/common/nextmux-canvas-adapter-policy.js';
import { prepareCanvasVideoPrompt } from '../lib/common/nextmux-canvas-prompts.js';
import { ComicPromptTranslationCache } from '../lib/common/nextmux-comic-prompts.js';
import { ComicCanvasStore, CanvasServiceError } from '../lib/node/nextmux-canvas-store.js';
import { canvasStartFrameRecords } from '../lib/node/nextmux-canvas-start-frame-service.js';
import { canvasMediaClickKey, canvasMediaSceneId, compileCanvasGenerationJob } from '../lib/node/nextmux-canvas-generation.js';

const projectId = 'project-11111111-1111-4111-8111-111111111111';
const connectionId = 'official-11111111-1111-4111-8111-111111111111';
const now = '2026-10-01T00:00:00.000Z';
const cost = { billing: 'provider_billed', description: 'Fixture provider billing' };
const variants = [{ id: '720', resolution: '720p', aspectRatios: ['16:9', '9:16'], dimensions: { '16:9': { width: 1280, height: 720 }, '9:16': { width: 720, height: 1280 } } }];
const mode = (name, extra = {}) => ({ mode: name, outputVariants: variants, firstFrame: false, lastFrame: false,
    duration: { kind: 'enum', seconds: [4, 6, 8], defaultSeconds: 6 }, audioGeneration: { mode: 'optional', defaultEnabled: false }, ...extra });
const capability = (...modes) => ({ id: 'fixture-route', providerId: 'fixture', providerModelId: 'model-fixture', displayName: 'Fixture',
    version: 'verified-v1', status: 'available', modes, sources: ['test adapter declaration'] });
const input = (role, kind = 'image', index = 0) => ({ role, order: index, versionId: `v-${index}`, assetId: `a-${index}`, kind,
    uri: `nextmux.media/ref-${index}.${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'wav'}` });
const snapshot = (name, inputs = [], parameters = {}) => ({ modelId: 'model-fixture', capabilityVersion: 'verified-v1', mode: name,
    prompt: 'Original frozen prompt', resolvedInputs: inputs, parameters: { resolution: '720p', aspectRatio: '16:9', durationSeconds: 6, ...parameters }, inputFingerprint: 'fingerprint' });
const compile = (snap, cap) => compileCanvasGenerationJob({ canvasId: 'canvas-fixture', projectId, nodeId: 'node-fixture', idempotencyKey: 'fixture-click',
    snapshot: snap, capability: cap, connectionId, cost });

test('snapshot mapping preserves exact first/last frames, audio choice and output variant', () => {
    const first = input('firstFrame', 'image', 1), last = input('lastFrame', 'image', 2);
    const request = enqueueRequest(compile(snapshot('firstLastFrame', [first, last], { generateAudio: true, aspectRatio: '9:16' }),
        capability(mode('firstLastFrame', { firstFrame: true, lastFrame: true }))));
    assert.equal(request.input.firstFrameUri, first.uri);
    assert.equal(request.input.lastFrameUri, last.uri);
    assert.equal(request.input.width, 720);
    assert.equal(request.input.height, 1280);
    assert.equal(request.input.aspectRatio, '9:16');
    assert.equal(request.input.resolution, '720p');
    assert.equal(request.input.requestAudio, true);
    assert.equal(request.input.durationSeconds, 6);
    assert.match(request.sceneId, /^scene-canvas-[a-f0-9]{32}$/);
    assert.match(request.shotId, /^shot-canvas-[a-f0-9]{32}$/);
});

test('reference video/audio stay separate from identity images and original audio', () => {
    const references = [input('referenceImage', 'image', 1), input('referenceVideo', 'video', 2), input('referenceAudio', 'audio', 3)];
    const rules = { image: { supported: true, maxCount: 4 }, video: { supported: true, maxCount: 2 }, audio: { supported: true, maxCount: 1 } };
    const cap = capability(mode('referenceToVideo', { referenceRules: rules, combinationConstraints: [{ combination: 'image+video+audio' }] }),
        mode('videoEdit', { referenceRules: rules, preserveInputAudio: true, combinationConstraints: [{ combination: 'video+audio' }] }));
    const request = enqueueRequest(compile(snapshot('referenceToVideo', references), cap));
    assert.deepEqual(request.input.characterReferenceUris, [references[0].uri]);
    assert.deepEqual(request.input.referenceVideoUris, [references[1].uri]);
    assert.deepEqual(request.input.referenceAudioUris, [references[2].uri]);
    assert.equal(request.input.requestAudio, false);
    const edit = enqueueRequest(compile(snapshot('videoEdit', references.slice(1), { preserveInputAudio: true }), cap));
    assert.equal(edit.input.sourceVideoUri, references[1].uri);
    assert.equal(edit.input.preserveOriginalAudio, true);
    assert.deepEqual(edit.input.referenceAudioUris, [references[2].uri]);
});

test('image-to-image mapping attaches every ordered image on this request', () => {
    const cap = capability({ mode: 'imageToImage', outputVariants: variants, referenceRules: { image: { supported: true, maxCount: 4 } }, combinationConstraints: [{ combination: 'image' }] });
    const snap = snapshot('imageToImage', [input('referenceImage', 'image', 3), input('referenceImage', 'image', 1)]);
    delete snap.parameters.durationSeconds;
    const request = enqueueRequest(compile(snap, cap));
    assert.equal(request.kind, 'image');
    assert.deepEqual(request.input.characterReferenceUris, ['nextmux.media/ref-3.png', 'nextmux.media/ref-1.png']);
});

test('invalid duration, resolution, model version, unsupported and unmapped parameters block compilation', () => {
    const cap = capability(mode('textToVideo'));
    for (const params of [{ durationSeconds: 5 }, { resolution: '1080p' }, { aspectRatio: '4:3' }]) {
        assert.throws(() => compile(snapshot('textToVideo', [], params), cap), { code: 'CANVAS_CAPABILITY_INVALID' });
    }
    assert.throws(() => compile({ ...snapshot('textToVideo'), capabilityVersion: 'old-version' }, cap), { code: 'CANVAS_CAPABILITY_CHANGED' });
    assert.throws(() => compile(snapshot('textToVideo', [], { seed: 1 }), cap), { code: 'CANVAS_CAPABILITY_INVALID' });
    const extension = capability(mode('textToVideo', { parameters: [{ key: 'seed', type: 'number' }] }));
    assert.throws(() => compile(snapshot('textToVideo', [], { seed: 1 }), extension), { code: 'CANVAS_PARAMETER_UNMAPPED' });
});

function canvasFixture() {
    const canvas = createCanvasDocument({ id: 'canvas-fixture', projectId, now });
    return applyCanvasCommand(canvas, { type: 'node.add', node: { id: 'node-fixture', kind: 'videoGen', title: 'Video', position: { x: 10, y: 20 }, size: { width: 320, height: 240 },
        payload: { mode: 'textToVideo', modelId: 'model-fixture', prompt: 'Original frozen prompt', parameters: { resolution: '720p', aspectRatio: '16:9', durationSeconds: 6 }, versions: [] } } });
}

test('atomic load/save persists geometry and rejects concurrent stale revisions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-canvas-store-'));
    try {
        const store = new ComicCanvasStore(root);
        assert.equal((await store.read()).exists, false);
        const saved = await store.save(canvasFixture(), 0, projectId);
        assert.equal(saved.canvas.revision, 1);
        const changed = { ...saved.canvas, viewport: { x: -50, y: 30, zoom: 1.5 } };
        const writes = await Promise.allSettled([store.save(changed, 1, projectId), new ComicCanvasStore(root).save(changed, 1, projectId)]);
        assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
        assert.equal(writes.find(result => result.status === 'rejected').reason.code, 'CANVAS_REVISION_CONFLICT');
        assert.deepEqual((await new ComicCanvasStore(root).read()).canvas.viewport, changed.viewport);
        assert.deepEqual((await readdir(root)).filter(name => name.endsWith('.tmp') || name.endsWith('.lock')), []);
        assert.equal(JSON.parse(await readFile(join(root, 'nextmux.canvas.json'), 'utf8')).revision, 2);
        await assert.rejects(store.save({ ...changed, settings: { apiKey: 'forbidden' } }, 2, projectId), { code: 'CANVAS_INVALID' });
        await assert.rejects(store.save({ ...changed, settings: { preview: 'blob:temporary' } }, 2, projectId), { code: 'CANVAS_INVALID' });
    } finally { await rm(root, { recursive: true, force: true }); }
});

// Execute the actual RPC implementation with real canvas + media stores and free, local adapter fixtures.
const serviceSource = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('service.ts', serviceSource, ts.ScriptTarget.Latest, true);
const names = new Set(['runComicCanvasNode', 'runComicCanvasNodeClaimed', 'claimCanvasMediaPendingNode', 'releaseCanvasMediaPendingNode', 'canvasMediaPendingNodeKey',
    'canvasInputFiles', 'prepareCanvasSnapshot', 'attachCanvasMediaCheckpoint', 'validateCanvasMediaBilling', 'validateCanvasMediaJob', 'validateCanvasAdapterInput', 'getComicCanvas',
    'recoverComicCanvasJobs', 'remoteTaskOf', 'canvasStoreForMedia', 'canvasMediaJobExecution']);
const helperFunctions = ['isOpenRouterBaseUrl', 'isOpenRouterMediaConnection', 'mediaJobActionKey', 'workspaceIdentityPath'];
const helperVariables = ['MEDIA_JOB_ACTION_CLAIMS', 'MEDIA_CANVAS_PENDING_ACTIONS'];
const methods = [], helpers = [];
(function walk(node) {
    if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast));
    if (ts.isFunctionDeclaration(node) && helperFunctions.includes(node.name?.getText(ast))) helpers.push(node.getText(ast));
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => helperVariables.includes(item.name.getText(ast)))) helpers.push(node.getText(ast));
    ts.forEachChild(node, walk);
})(ast);
const deps = { CanvasServiceError, createGenerationSnapshot, compileCanvasGenerationJob, canvasMediaClickKey, canvasMediaSceneId, enqueueRequest, officialMediaCapabilities,
    canvasAdapterInputIssues, prepareCanvasVideoPrompt, canvasStartFrameRecords, sameCanvasCapabilityVersion, resolveCanvasInputs, startFrameTargetFingerprint,
    canvasStartFrameVideoIntent, canvasStartFramePricesChanged, requireValidKeyPriceQuoteId, resolve, dirname, join, realpathSync };
const depNames = Object.keys(deps).join(', ');
const compiled = ts.transpileModule(`const { ${depNames} } = deps; ${helpers.join('\n')} class Harness { acceptedRemoteTasks = new Map(); ${methods.join('\n')} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const Harness = new Function('deps', `${compiled}\nreturn Harness;`)(deps);
// This local RPC fixture has no configured provider connections; exercise the actual execution-policy method with an empty index.
Harness.prototype.readOfficialConnectionIndex = async () => [];
Harness.prototype.canvasAdapterPolicy = async () => buildOfficialCanvasAdapterPolicy({ protocol: 'openai_chat_completions' }, 'model-fixture', { kind: 'video' });

test('concurrent same-click RPCs create one durable queue task; a changed prompt recovers its original snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-canvas-generate-'));
    try {
        const store = new ComicCanvasStore(root), queue = await MediaJobStore.create({ root: join(root, 'queue') });
        const initial = await store.save(canvasFixture(), 0, projectId);
        const harness = new Harness();
        Object.assign(harness, { canvasStore: () => store, mediaJobStore: async () => queue, ensureMediaRecovery: async () => {}, scheduleMediaWorker() {},
            canvasCapability: async () => capability(mode('textToVideo')), canvasInputFiles: async () => new Set(), validateCanvasAdapterInput: async () => {} });
        const request = { workspaceRoot: root, expectedRevision: initial.canvas.revision, nodeId: 'node-fixture', idempotencyKey: 'generate-click-one', connectionId, cost };
        const results = await Promise.all([harness.runComicCanvasNode(request), harness.runComicCanvasNode(request)]);
        assert.equal(results[0].job.id, results[1].job.id);
        assert.equal((await queue.list()).length, 1);
        const current = (await store.read()).canvas;
        await store.save(applyCanvasCommand(current, { type: 'node.setParameters', nodeId: 'node-fixture', parameters: current.nodes[0].payload.parameters, prompt: 'Edited later prompt' }), current.revision, projectId);
        const replay = await harness.runComicCanvasNode({ ...request, connectionId: 'a-different-route' });
        assert.equal(replay.job.id, results[0].job.id);
        assert.equal(replay.job.input.prompt, 'Original frozen prompt');
        assert.equal(replay.state.canvas.nodes[0].payload.prompt, 'Edited later prompt');
        assert.equal(replay.state.jobs.length, 1);
        const latest = replay.state.canvas;
        await assert.rejects(harness.runComicCanvasNode({ ...request, idempotencyKey: 'another-click', expectedRevision: latest.revision }), { code: 'CANVAS_NODE_BUSY' });
        const originalRecord = await new ComicCanvasStore(root).getRecord(request.idempotencyKey);
        assert.equal(originalRecord.snapshot.prompt, 'Original frozen prompt');
        assert.equal(originalRecord.jobId, replay.job.id);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('a full queue fails its reservation, preserves the click failure on reopen and permits a new click', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-canvas-full-queue-'));
    try {
        const store = new ComicCanvasStore(root), queue = await MediaJobStore.create({ root: join(root, 'queue') });
        const initial = await store.save(canvasFixture(), 0, projectId);
        const harness = new Harness();
        let full = true, enqueues = 0;
        Object.assign(harness, { canvasStore: () => store, mediaJobStore: async () => ({
            get: id => queue.get(id),
            async enqueue(request) {
                enqueues++;
                if (full) throw Object.assign(new Error('Media queue is full'), { code: 'MEDIA_QUEUE_FULL' });
                return queue.enqueue(request);
            }
        }), ensureMediaRecovery: async () => {}, scheduleMediaWorker() {},
            canvasCapability: async () => capability(mode('textToVideo')), canvasInputFiles: async () => new Set(), validateCanvasAdapterInput: async () => {} });
        const request = { workspaceRoot: root, expectedRevision: initial.canvas.revision, nodeId: 'node-fixture', idempotencyKey: 'full-queue-click', connectionId, cost };
        const failures = await Promise.allSettled([harness.runComicCanvasNode(request), harness.runComicCanvasNode(request)]);
        assert.equal(failures.every(result => result.status === 'rejected' && result.reason.code === 'MEDIA_QUEUE_FULL'), true);
        const failed = await new ComicCanvasStore(root).read();
        assert.equal(failed.jobs[0].status, 'failed');
        assert.equal(failed.jobs[0].error.code, 'MEDIA_QUEUE_FULL');
        assert.equal(failed.canvas.nodes[0].payload.jobs[0].status, 'failed');
        assert.equal(enqueues, 1, 'same-click concurrent failure must not enqueue twice');
        full = false;
        await assert.rejects(harness.runComicCanvasNode(request), { code: 'MEDIA_QUEUE_FULL' });
        assert.equal((await harness.getComicCanvas(root)).jobs[0].status, 'failed');
        assert.equal(enqueues, 1, 'replay and recovery must preserve the failed click');
        const fresh = await harness.runComicCanvasNode({ ...request, idempotencyKey: 'new-queue-click', expectedRevision: failed.canvas.revision });
        assert.equal(fresh.job.status, 'awaiting_confirmation');
        assert.equal((await queue.list()).length, 1);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('an uncertain enqueue reply keeps the reservation and recovers the original queue ID', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-canvas-uncertain-enqueue-'));
    try {
        const store = new ComicCanvasStore(root), queue = await MediaJobStore.create({ root: join(root, 'queue') });
        const initial = await store.save(canvasFixture(), 0, projectId);
        const harness = new Harness();
        let lostReply = true;
        Object.assign(harness, { canvasStore: () => store, mediaJobStore: async () => ({
            get: id => queue.get(id),
            async enqueue(request) {
                const job = await queue.enqueue(request);
                if (lostReply) { lostReply = false; throw Object.assign(new Error('Lost enqueue reply'), { code: 'EIO' }); }
                return job;
            }
        }), ensureMediaRecovery: async () => {}, scheduleMediaWorker() {},
            canvasCapability: async () => capability(mode('textToVideo')), canvasInputFiles: async () => new Set(), validateCanvasAdapterInput: async () => {} });
        const request = { workspaceRoot: root, expectedRevision: initial.canvas.revision, nodeId: 'node-fixture', idempotencyKey: 'uncertain-queue-click', connectionId, cost };
        await assert.rejects(harness.runComicCanvasNode(request), { code: 'EIO' });
        assert.equal((await store.read()).jobs[0].status, 'reserved');
        const acceptedId = (await queue.list())[0].id;
        assert.equal((await harness.getComicCanvas(root)).jobs[0].jobId, acceptedId);
        assert.equal((await harness.runComicCanvasNode(request)).job.id, acceptedId);
        assert.equal((await queue.list()).length, 1);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('a result version is appended once and retains frozen parameters; real failure detail survives restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-canvas-result-'));
    try {
        const store = new ComicCanvasStore(root), canvas = (await store.save(canvasFixture(), 0, projectId)).canvas;
        const snap = createGenerationSnapshot(canvas, 'node-fixture', { capabilityVersion: 'verified-v1' });
        const request = enqueueRequest(compile(snap, capability(mode('textToVideo'))));
        await store.reserve({ nodeId: 'node-fixture', idempotencyKey: 'fixture-click', snapshot: snap, request, expectedRevision: canvas.revision });
        const job = { id: 'media-job-11111111-1111-4111-8111-111111111111', idempotencyKey: request.idempotencyKey, status: 'succeeded', updatedAt: now };
        const version = { id: `version-${job.id}`, assetId: 'asset-result', kind: 'video', uri: 'nextmux.media/result.mp4', createdAt: now, snapshot: snap };
        await store.recordJob(job, version);
        await store.recordJob(job, version);
        assert.equal((await store.read()).canvas.nodes[0].payload.versions.length, 1);
        await store.recordJob({ ...job, status: 'failed', failure: { code: 'PROVIDER_ACTUAL_ERROR', message: 'The upstream task rejected a frame reference.' } });
        const restored = await new ComicCanvasStore(root).read();
        assert.equal(restored.jobs[0].error.message, 'The upstream task rejected a frame reference.');
        assert.equal(restored.canvas.nodes[0].payload.versions[0].snapshot.parameters.durationSeconds, 6);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('latest-revision saves cannot mutate immutable results or forge the journal task state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-canvas-history-'));
    try {
        const store = new ComicCanvasStore(root), canvas = (await store.save(canvasFixture(), 0, projectId)).canvas;
        const snap = createGenerationSnapshot(canvas, 'node-fixture', { capabilityVersion: 'verified-v1' });
        const request = enqueueRequest(compile(snap, capability(mode('textToVideo'))));
        await store.reserve({ nodeId: 'node-fixture', idempotencyKey: 'fixture-click', snapshot: snap, request, expectedRevision: canvas.revision });
        const job = { id: 'media-job-11111111-1111-4111-8111-111111111111', idempotencyKey: request.idempotencyKey, status: 'succeeded', updatedAt: now };
        const version = { id: `version-${job.id}`, assetId: 'asset-result', kind: 'video', uri: 'nextmux.media/result.mp4', createdAt: now, snapshot: snap };
        const current = (await store.recordJob(job, version)).canvas;
        for (const change of [{ uri: 'nextmux.media/substitute.mp4' }, { snapshot: { ...snap, prompt: 'Rewritten history' } }, { metadata: { durationMs: 99000 } }]) {
            const edited = structuredClone(current);
            Object.assign(edited.nodes[0].payload.versions[0], change);
            await assert.rejects(store.save(edited, current.revision, projectId), { code: 'CANVAS_VERSION_IMMUTABLE' });
        }
        const forged = structuredClone(current);
        forged.nodes[0].payload.jobs = [];
        const saved = await store.save(forged, current.revision, projectId);
        assert.equal(saved.canvas.nodes[0].payload.jobs[0].status, 'succeeded');
        assert.equal(saved.canvas.nodes[0].payload.jobs[0].snapshot.prompt, snap.prompt);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('delayed queued events cannot overwrite terminal task state; their missing result still attaches once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-canvas-status-'));
    try {
        const store = new ComicCanvasStore(root), canvas = (await store.save(canvasFixture(), 0, projectId)).canvas;
        const snap = createGenerationSnapshot(canvas, 'node-fixture', { capabilityVersion: 'verified-v1' });
        const request = enqueueRequest(compile(snap, capability(mode('textToVideo'))));
        await store.reserve({ nodeId: 'node-fixture', idempotencyKey: 'fixture-click', snapshot: snap, request, expectedRevision: canvas.revision });
        const job = { id: 'media-job-11111111-1111-4111-8111-111111111111', idempotencyKey: request.idempotencyKey, status: 'succeeded', updatedAt: '2026-10-01T12:00:00.000Z' };
        await store.recordJob(job);
        const version = { id: `version-${job.id}`, assetId: 'asset-result', kind: 'video', uri: 'nextmux.media/result.mp4', createdAt: now, snapshot: snap };
        await store.recordJob({ ...job, status: 'queued', updatedAt: '2026-10-01T11:00:00.000Z' }, version);
        await store.recordJob({ ...job, status: 'queued' }, version);
        const restored = await store.read();
        assert.equal(restored.jobs[0].status, 'succeeded');
        assert.equal(restored.canvas.nodes[0].payload.jobs[0].status, 'succeeded');
        assert.equal(restored.canvas.nodes[0].payload.versions.length, 1);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('open recovers a pre-enqueue reservation and accepted task ID; changed adapter cannot start a new paid request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-canvas-recovery-'));
    try {
        const store = new ComicCanvasStore(root), queue = await MediaJobStore.create({ root: join(root, 'queue') });
        const canvas = (await store.save(canvasFixture(), 0, projectId)).canvas;
        const snap = createGenerationSnapshot(canvas, 'node-fixture', { capabilityVersion: 'verified-v1' });
        const request = enqueueRequest(compile(snap, capability(mode('textToVideo'))));
        await store.reserve({ nodeId: 'node-fixture', idempotencyKey: 'fixture-click', snapshot: snap, request, expectedRevision: canvas.revision });
        const harness = new Harness();
        let currentCapability = capability(mode('textToVideo')), fileReads = 0;
        Object.assign(harness, { canvasStore: () => new ComicCanvasStore(root), mediaJobStore: async () => queue,
            ensureMediaRecovery: async () => {}, scheduleMediaWorker() {}, canvasCapability: async () => currentCapability,
            resolveMediaInput() { fileReads++; throw new Error('Accepted tasks must not reload inputs'); } });
        const recovered = await harness.getComicCanvas(root);
        assert.equal(recovered.jobs[0].status, 'awaiting_confirmation');
        assert.equal((await queue.list()).length, 1);
        const queued = (await queue.list())[0];
        await queue.confirm(queued.id);
        const workerId = 'media-worker-canvas-test';
        await queue.claimNext(workerId);
        const accepted = await queue.saveRemoteTask(queued.id, workerId, { taskId: 'upstream-task-original', submittedAt: new Date().toISOString() });
        await store.recordJob(accepted);
        const reopened = await harness.getComicCanvas(root);
        assert.equal(reopened.jobs[0].jobId, accepted.id);
        assert.equal((await queue.get(accepted.id)).remoteTask.taskId, 'upstream-task-original');
        assert.equal((await queue.list()).length, 1);
        currentCapability = { ...currentCapability, version: 'changed-sync-route' };
        await assert.rejects(harness.validateCanvasMediaJob(root, accepted), { code: 'CANVAS_CAPABILITY_CHANGED' });
        currentCapability = capability(mode('textToVideo'));
        await harness.validateCanvasMediaJob(root, accepted);
        assert.equal(fileReads, 0);
        assert.equal((await queue.get(accepted.id)).remoteTask.taskId, 'upstream-task-original');
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('adapter duration and frame declarations are checked before a canvas task can be queued', async () => {
    const harness = new Harness();
    const connection = { protocol: 'async_media_template', providerSettings: { mediaTemplate: { kind: 'video', seconds: [5, 10], images: 'none', maxReferences: 0,
        submit: { body: '{"prompt":"{{prompt}}","duration":"{{seconds}}"}' } } } };
    harness.canvasAdapterPolicy = async () => buildOfficialCanvasAdapterPolicy(connection, 'model-fixture', { kind: 'video' });
    const request = compile(snapshot('textToVideo'), capability(mode('textToVideo')));
    await assert.rejects(harness.validateCanvasAdapterInput(request), { code: 'CANVAS_DURATION_UNSUPPORTED' });
    request.input = { ...request.input, durationSeconds: 5, firstFrameUri: 'nextmux.media/frame.png' };
    await assert.rejects(harness.validateCanvasAdapterInput(request), { code: 'CANVAS_ADAPTER_UNSUPPORTED' });
});

test('invalid snapshots never reach the durable reservation journal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-canvas-invalid-snapshot-'));
    try {
        const store = new ComicCanvasStore(root), canvas = (await store.save(canvasFixture(), 0, projectId)).canvas;
        const snap = createGenerationSnapshot(canvas, 'node-fixture', { capabilityVersion: 'verified-v1' });
        const request = enqueueRequest(compile(snap, capability(mode('textToVideo'))));
        await assert.rejects(store.reserve({ nodeId: 'node-fixture', idempotencyKey: 'fixture-click', snapshot: { ...snap, parameters: { ...snap.parameters, apiKey: 'must-not-persist' } }, request, expectedRevision: canvas.revision }), { code: 'CANVAS_INVALID' });
        assert.equal((await store.read()).jobs.length, 0);
        assert.equal((await readdir(root)).includes('nextmux.canvas.jobs.json'), false);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('corrupt canvas journals are rejected without changing their contents or losing the lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-canvas-corrupt-journal-'));
    try {
        const store = new ComicCanvasStore(root), canvas = (await store.save(canvasFixture(), 0, projectId)).canvas;
        const snap = createGenerationSnapshot(canvas, 'node-fixture', { capabilityVersion: 'verified-v1' });
        const request = enqueueRequest(compile(snap, capability(mode('textToVideo'))));
        await store.reserve({ nodeId: 'node-fixture', idempotencyKey: 'fixture-click', snapshot: snap, request, expectedRevision: canvas.revision });
        const journal = join(root, 'nextmux.canvas.jobs.json');
        const original = await readFile(journal, 'utf8'), [record] = JSON.parse(original);
        const corruptions = [
            [{ ...record, status: 'runnning' }],
            [record, record],
            [{ ...record, request: {} }],
            [{ ...record, snapshot: {} }],
            [{ ...record, updatedAt: 'not-a-date' }],
            [{ ...record, snapshot: { ...snap, parameters: { apiKey: 'must-not-load' } } }],
            [{ ...record, request: { ...record.request, apiKey: 'must-not-load' } }]
        ];
        for (const corrupted of corruptions) {
            const bytes = JSON.stringify(corrupted);
            await writeFile(journal, bytes);
            await assert.rejects(store.read(), { code: 'CANVAS_JOBS_INVALID' });
            await assert.rejects(store.save(canvas, 2, projectId), { code: 'CANVAS_JOBS_INVALID' });
            assert.equal(await readFile(journal, 'utf8'), bytes);
            assert.equal((await readdir(root)).some(name => name.endsWith('.lock')), false);
        }
        await writeFile(journal, original);
        const current = (await store.read()).canvas;
        assert.equal((await store.save(current, current.revision, projectId)).canvas.revision, current.revision + 1);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('corrupt canvas documents are never replaced by an empty save and release their write lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-canvas-corrupt-document-'));
    try {
        const store = new ComicCanvasStore(root), canvas = (await store.save(canvasFixture(), 0, projectId)).canvas;
        const document = join(root, 'nextmux.canvas.json'), original = await readFile(document, 'utf8');
        for (const bytes of ['{broken-json', JSON.stringify({ ...canvas, schemaVersion: 100 }), JSON.stringify({ ...canvas, nodes: 'broken' })]) {
            await writeFile(document, bytes);
            await assert.rejects(store.read());
            await assert.rejects(store.save(canvas, canvas.revision, projectId));
            assert.equal(await readFile(document, 'utf8'), bytes);
            assert.equal((await readdir(root)).some(name => name.endsWith('.lock')), false);
        }
        await writeFile(document, original);
        assert.equal((await store.save(canvas, canvas.revision, projectId)).canvas.revision, canvas.revision + 1);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('finished results recover after reopening once; subsequent polls perform no probe or write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-canvas-probe-once-'));
    try {
        const store = new ComicCanvasStore(root), canvas = (await store.save(canvasFixture(), 0, projectId)).canvas;
        const snap = createGenerationSnapshot(canvas, 'node-fixture', { capabilityVersion: 'verified-v1' });
        const request = enqueueRequest(compile(snap, capability(mode('textToVideo'))));
        await store.reserve({ nodeId: 'node-fixture', idempotencyKey: 'fixture-click', snapshot: snap, request, expectedRevision: canvas.revision });
        const output = { assetId: 'asset-result', assetKind: 'video', relativeUri: 'nextmux.media/result.mp4', sha256: 'a'.repeat(64), byteLength: 42,
            mimeType: 'video/mp4', provider: 'Fixture', model: 'model-fixture', prompt: snap.prompt };
        const job = { id: 'media-job-11111111-1111-4111-8111-111111111111', idempotencyKey: request.idempotencyKey,
            projectId, status: 'succeeded', updatedAt: now, completedAt: now, output };
        await store.recordJob(job); // Provider finished while the app was closed; no canvas result yet.
        let probes = 0, imports = 0, queueReads = 0, project = { id: projectId, revision: 1, assets: [] };
        const harness = new Harness();
        Object.assign(harness, { canvasStore: () => store, mediaJobStore: async () => ({ get: async () => { queueReads++; return job; }, enqueue: () => { throw new Error('No second submit'); } }),
            ensureMediaRecovery: async () => {}, scheduleMediaWorker() {}, retryOnComicRevision: operation => operation(),
            attachMediaCheckpoint: (...args) => harness.attachCanvasMediaCheckpoint(...args),
            comicProjectStore: async () => ({ read: async () => ({ project }), apply: async command => { imports++; project = { ...project, revision: project.revision + 1, assets: [...project.assets, command.asset] }; } }),
            probeComicCheckpointMedia: async () => { probes++; return { width: 1280, height: 720, durationMs: 6000 }; } });
        const recovered = await harness.getComicCanvas(root);
        assert.equal(recovered.canvas.nodes[0].payload.versions.length, 1);
        assert.equal(probes, 1); assert.equal(imports, 1); assert.equal(queueReads, 1);
        const document = await readFile(join(root, 'nextmux.canvas.json'), 'utf8'), journal = await readFile(join(root, 'nextmux.canvas.jobs.json'), 'utf8');
        let writes = 0;
        const recordJob = store.recordJob.bind(store);
        store.recordJob = (...args) => { writes++; return recordJob(...args); };
        for (let poll = 0; poll < 3; poll++) await harness.getComicCanvas(root);
        // Even a delayed duplicate worker checkpoint exits before reading/probing the project.
        await harness.attachCanvasMediaCheckpoint(root, job, output);
        assert.equal(probes, 1); assert.equal(imports, 1); assert.equal(queueReads, 1); assert.equal(writes, 0);
        assert.equal(await readFile(join(root, 'nextmux.canvas.json'), 'utf8'), document);
        assert.equal(await readFile(join(root, 'nextmux.canvas.jobs.json'), 'utf8'), journal);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('unsupported first frame plus character references is refused before reservation or enqueue', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-canvas-prepayment-'));
    try {
        const store = new ComicCanvasStore(root), fixture = canvasFixture();
        const media = (id, uri) => ({ id, assetId: id, kind: 'image', uri, createdAt: now });
        const canvas = { ...fixture, nodes: [{ ...fixture.nodes[0], payload: { ...fixture.nodes[0].payload, mode: 'imageToVideo', inputs: [
            { id: 'first-input', role: 'firstFrame', order: 0, version: media('first', 'nextmux.media/first.png') },
            { id: 'identity-input', role: 'referenceImage', order: 1, version: media('identity', 'nextmux.media/identity.png') }] } }] };
        const state = await store.save(canvas, 0, projectId), harness = new Harness();
        Object.assign(harness, { canvasStore: () => store, canvasInputFiles: async () => new Set(['nextmux.media/first.png', 'nextmux.media/identity.png']),
            canvasCapability: async () => capability(mode('imageToVideo', { firstFrame: true, referenceRules: { image: { supported: true, maxCount: 4 } }, combinationConstraints: [{ combination: 'image' }] })),
            mediaJobStore: () => { throw new Error('Refused input must never enqueue'); } });
        await assert.rejects(harness.runComicCanvasNode({ workspaceRoot: root, expectedRevision: state.canvas.revision, nodeId: 'node-fixture', idempotencyKey: 'bad-combination', connectionId, cost }),
            { code: 'CANVAS_ADAPTER_UNSUPPORTED' });
        assert.equal((await store.read()).jobs.length, 0);
        assert.equal((await readdir(root)).includes('nextmux.canvas.jobs.json'), false);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('English preparation freezes the exact sent prompt once and recovery retains it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-canvas-prompt-'));
    try {
        const store = new ComicCanvasStore(root), queue = await MediaJobStore.create({ root: join(root, 'queue') });
        const fixture = canvasFixture(), modelId = 'google/veo-3.1';
        const canvas = { ...fixture, nodes: [{ ...fixture.nodes[0], payload: { ...fixture.nodes[0].payload, modelId, prompt: '她走到窗边。' } }] };
        const state = await store.save(canvas, 0, projectId), harness = new Harness();
        let translations = 0;
        const route = { kind: 'official_connection', connectionId: 'text-fixture', model: 'text-model' };
        Object.assign(harness, { canvasStore: () => store, mediaJobStore: async () => queue, ensureMediaRecovery: async () => {}, scheduleMediaWorker() {},
            canvasCapability: async () => ({ ...capability(mode('textToVideo')), providerModelId: modelId }), canvasInputFiles: async () => new Set(),
            canvasAdapterPolicy: async () => buildOfficialCanvasAdapterPolicy({ protocol: 'openai_chat_completions', baseUrl: 'https://openrouter.ai/api/v1' }, modelId, { kind: 'video' }),
            comicCanvasPromptTranslations: new ComicPromptTranslationCache(),
            planComicText: async request => { translations++; assert.deepEqual(request.route, route); return JSON.stringify({ prompt: 'She walks to the window.', negative: '' }); } });
        const request = { workspaceRoot: root, expectedRevision: state.canvas.revision, nodeId: 'node-fixture', idempotencyKey: 'translated-click', connectionId, promptTranslationRoute: route, cost };
        const [first, duplicate] = await Promise.all([harness.runComicCanvasNode(request), harness.runComicCanvasNode(request)]);
        assert.equal(first.job.id, duplicate.job.id); assert.equal(translations, 1);
        const record = await store.getRecord(request.idempotencyKey);
        assert.equal(record.snapshot.prompt, 'She walks to the window.'); assert.equal(record.request.input.prompt, record.snapshot.prompt);
        assert.equal(record.snapshot.inputFingerprint, createGenerationSnapshot(canvas, 'node-fixture', { capabilityVersion: 'verified-v1' }).inputFingerprint);
        harness.planComicText = () => { throw new Error('Recovery cannot translate or pay again'); };
        const replay = await harness.runComicCanvasNode({ ...request, promptTranslationRoute: undefined, connectionId: 'different-route' });
        assert.equal(replay.job.id, first.job.id); assert.equal(replay.job.input.prompt, record.snapshot.prompt); assert.equal((await queue.list()).length, 1);
    } finally { await rm(root, { recursive: true, force: true }); }
});

for (const embedsNegative of [false, true]) test(`queue-normalized prompt and ${embedsNegative ? 'embedded' : 'separate'} negative text match the durable snapshot and replay`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-canvas-normalized-prompt-'));
    try {
        const store = new ComicCanvasStore(root), queue = await MediaJobStore.create({ root: join(root, 'queue') });
        const fixture = canvasFixture(), modelId = 'google/veo-3.1';
        const canvas = { ...fixture, nodes: [{ ...fixture.nodes[0], payload: { ...fixture.nodes[0].payload, modelId,
            prompt: ' \n  She walks to the window. \n ', parameters: { ...fixture.nodes[0].payload.parameters, negativePrompt: '  watermark, captions \n  ' } } }] };
        const state = await store.save(canvas, 0, projectId), harness = new Harness();
        let queueEnqueues = 0, translations = 0;
        Object.assign(harness, { canvasStore: () => store, mediaJobStore: async () => ({
            get: id => queue.get(id), enqueue: value => { queueEnqueues++; return queue.enqueue(value); } }),
            ensureMediaRecovery: async () => {}, scheduleMediaWorker() {}, canvasInputFiles: async () => new Set(),
            canvasCapability: async () => ({ ...capability(mode('textToVideo', { parameters: [{ key: 'negativePrompt', type: 'string' }] })), providerModelId: modelId }),
            canvasAdapterPolicy: async () => buildOfficialCanvasAdapterPolicy({ protocol: 'openai_chat_completions',
                ...(embedsNegative ? { baseUrl: 'https://openrouter.ai/api/v1' } : {}) }, modelId, { kind: 'video' }),
            comicCanvasPromptTranslations: new ComicPromptTranslationCache(), planComicText: async () => { translations++; throw Error('English input needs no translation'); } });
        const request = { workspaceRoot: root, expectedRevision: state.canvas.revision, nodeId: 'node-fixture', idempotencyKey: 'normalized-prompt-click', connectionId, cost,
            promptTranslationRoute: { kind: 'official_connection', connectionId: 'text-fixture', model: 'text-model' } };
        const first = await harness.runComicCanvasNode(request), record = await store.getRecord(request.idempotencyKey);
        const expected = `She walks to the window.${embedsNegative ? '\n\nAvoid: watermark, captions' : ''}`;
        assert.equal(record.snapshot.prompt, expected);
        assert.equal(record.request.input.prompt, record.snapshot.prompt);
        assert.equal(first.job.input.prompt, record.snapshot.prompt);
        assert.equal(record.snapshot.parameters.negativePrompt, embedsNegative ? undefined : 'watermark, captions');
        assert.equal(record.request.input.negativePrompt, record.snapshot.parameters.negativePrompt);
        assert.equal(record.snapshot.inputFingerprint, createGenerationSnapshot(canvas, 'node-fixture', { capabilityVersion: 'verified-v1' }).inputFingerprint);
        harness.canvasCapability = () => { throw Error('Replay cannot recompile the model'); };
        const replay = await harness.runComicCanvasNode({ ...request, connectionId: 'changed-route', promptTranslationRoute: undefined });
        assert.equal(replay.job.id, first.job.id);
        assert.equal(replay.job.input.prompt, record.snapshot.prompt);
        assert.equal(translations, 0); assert.equal(queueEnqueues, 1); assert.equal((await queue.list()).length, 1);
    } finally { await rm(root, { recursive: true, force: true }); }
});

for (const [label, invalid] of [
    ['NUL in source prompt', { prompt: '她走到窗边。\0' }],
    ['NUL in source negative prompt', { negativePrompt: '水印\0' }],
    ['invalid managed price quote', { managed: true, keyPriceQuoteId: 'invalid-quote' }],
    ['empty billing description', { cost: { ...cost, description: '' } }],
]) test(`${label} is refused before an English prompt translation can be billed`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-canvas-text-preflight-'));
    try {
        const store = new ComicCanvasStore(root), fixture = canvasFixture(), modelId = 'google/veo-3.1';
        const canvas = { ...fixture, nodes: [{ ...fixture.nodes[0], payload: { ...fixture.nodes[0].payload, modelId, prompt: invalid.prompt ?? '她走到窗边。',
            parameters: { ...fixture.nodes[0].payload.parameters, ...(invalid.negativePrompt ? { negativePrompt: invalid.negativePrompt } : {}) } } }] };
        const state = await store.save(canvas, 0, projectId), harness = new Harness();
        let translations = 0;
        Object.assign(harness, { canvasStore: () => store, canvasInputFiles: async () => new Set(),
            canvasCapability: async () => ({ ...capability(mode('textToVideo', { parameters: [{ key: 'negativePrompt', type: 'string' }] })), providerModelId: modelId }),
            canvasAdapterPolicy: async () => invalid.managed ? buildManagedCanvasAdapterPolicy({ providerModelCode: modelId, capabilities: ['text_to_video'], category: 'video' }, { kind: 'video' })
                : buildOfficialCanvasAdapterPolicy({ protocol: 'openai_chat_completions' }, modelId, { kind: 'video' }),
            comicCanvasPromptTranslations: new ComicPromptTranslationCache(), planComicText: async () => { translations++; return '{"prompt":"She walks to the window.","negative":""}'; },
            mediaJobStore: () => { throw Error('Invalid preflight must never enqueue'); } });
        await assert.rejects(harness.runComicCanvasNode({ workspaceRoot: root, expectedRevision: state.canvas.revision, nodeId: 'node-fixture', idempotencyKey: 'invalid-preflight-click',
            connectionId: invalid.managed ? 'managed:fixed:11111111-1111-4111-8111-111111111111' : connectionId,
            ...(invalid.keyPriceQuoteId ? { keyPriceQuoteId: invalid.keyPriceQuoteId } : {}),
            cost: invalid.managed ? { billing: 'platform_billed', description: 'Fixture platform billing' } : invalid.cost ?? cost,
            promptTranslationRoute: { kind: 'official_connection', connectionId: 'text-fixture', model: 'text-model' } }),
            { code: invalid.managed ? 'CANVAS_PRICE_QUOTE_CHANGED' : 'INVALID_MEDIA_REQUEST' });
        assert.equal(translations, 0);
        assert.equal((await store.read()).jobs.length, 0);
        assert.equal((await readdir(root)).includes('nextmux.canvas.jobs.json'), false);
    } finally { await rm(root, { recursive: true, force: true }); }
});
