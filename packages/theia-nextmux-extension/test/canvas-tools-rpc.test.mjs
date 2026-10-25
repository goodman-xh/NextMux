import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { createCanvasDocument, createGenerationSnapshot, sameCanvasCapabilityVersion } from '@nextmux/comic-core';
import { enqueueRequest, MediaJobStore } from '@nextmux/media-core';
import { sourceModule } from './helpers/comic-organizer-source-loader.mjs';
const { ComicCanvasStore, CanvasServiceError } = sourceModule('node/nextmux-canvas-store.ts');
const { PersistentComicCanvasToolsService } = sourceModule('node/nextmux-canvas-tools-backend.ts');
import { canvasStartFrameRecords } from '../lib/node/nextmux-canvas-start-frame-service.js';
import { canvasMediaClickKey, compileCanvasGenerationJob } from '../lib/node/nextmux-canvas-generation.js';
import { resolveCanvasToolFfprobe } from '../lib/node/nextmux-canvas-tools.js';
import { buildOfficialCanvasAdapterPolicy } from '../lib/common/nextmux-canvas-adapter-policy.js';
import { buildOfficialCanvasCapability } from '../lib/common/nextmux-canvas-capabilities.js';
import { canvasModelToolClick, canvasModelToolNodeFingerprint, canvasModelToolRequestFingerprint, canvasModelToolSource, prepareCanvasModelToolGeneration } from '../lib/node/nextmux-canvas-model-tool-generation.js';

// Read the additive route helper alongside the live platform methods during parallel builds.
const modelTools = {};
const modelToolsSource = await readFile(new URL('../src/common/nextmux-canvas-model-tools.ts', import.meta.url), 'utf8');
new Function('require', 'exports', ts.transpileModule(modelToolsSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText)(createRequire(new URL('../lib/common/nextmux-canvas-model-tools.js', import.meta.url)), modelTools);
const { planCanvasModelToolRoute, canvasModelToolMissingRoute, isCanvasOnDeviceToolOperation, planCanvasOnDeviceToolRoute } = modelTools;

const source = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true);
const methods = new Set(['canvasStore', 'canvasToolsService', 'runComicCanvasTool', 'getComicCanvasToolJob', 'cancelComicCanvasTool',
    'canvasModelToolPlan', 'getComicCanvasModelToolRoute', 'runComicCanvasModelTool', 'executeComicCanvasModelTool', 'runComicCanvasNode', 'validateCanvasMediaBilling', 'prepareCanvasSnapshot', 'canvasMediaJobExecution',
    // A generate click claims its node first, so a second click or a retry never races the reservation.
    'canvasMediaPendingNodeKey', 'claimCanvasMediaPendingNode', 'releaseCanvasMediaPendingNode', 'runComicCanvasNodeClaimed']);
const fields = new Set(['comicCanvasStores', 'comicCanvasTools', 'comicCanvasModelToolRuns']);
const members = [], helpers = [];
(function walk(node) {
    if ((ts.isMethodDeclaration(node) && methods.has(node.name.getText(ast))) || (ts.isPropertyDeclaration(node) && fields.has(node.name.getText(ast)))) members.push(node.getText(ast));
    if (ts.isFunctionDeclaration(node) && ['isOpenRouterBaseUrl', 'isOpenRouterMediaConnection', 'mediaJobActionKey', 'workspaceIdentityPath'].includes(node.name?.getText(ast))) helpers.push(node.getText(ast));
    if (ts.isVariableStatement(node) && node.parent === ast && node.declarationList.declarations.some(item => ['MEDIA_JOB_ACTION_CLAIMS', 'MEDIA_CANVAS_PENDING_ACTIONS'].includes(item.name.getText(ast)))) helpers.push(node.getText(ast));
    ts.forEachChild(node, walk);
})(ast);
function harness(runtimeClass = PersistentComicCanvasToolsService) {
    const deps = { canvasModelToolClick, canvasModelToolNodeFingerprint, canvasModelToolRequestFingerprint, canvasModelToolSource, prepareCanvasModelToolGeneration,
        ComicCanvasStore, CanvasServiceError, PersistentComicCanvasToolsService: runtimeClass, realpathSync, resolve, dirname,
        resolveCanvasToolFfprobe, planCanvasModelToolRoute, canvasModelToolMissingRoute, isCanvasOnDeviceToolOperation, planCanvasOnDeviceToolRoute,
        join, createGenerationSnapshot, enqueueRequest, canvasMediaClickKey, compileCanvasGenerationJob, canvasStartFrameRecords, sameCanvasCapabilityVersion };
    const compiled = ts.transpileModule(`const { ${Object.keys(deps).join(', ')} } = deps; ${helpers.join('\n')} class Harness { ${members.join('\n')} }`,
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const Harness = new Function('deps', `${compiled}\nreturn Harness;`)(deps);
    const result = new Harness();
    result.validateWorkspaceRootInput = value => assert.equal(typeof value, 'string');
    // This local tool fixture has no configured provider connections; keep execution-policy collection real.
    result.readOfficialConnectionIndex = async () => [];
    result.nextmuxDataRoot = () => join(tmpdir(), 'nextmux-test-app-data');
    result.canvasAdapterPolicy = async () => buildOfficialCanvasAdapterPolicy({ protocol: 'openai_chat_completions', baseUrl: 'https://openrouter.ai/api/v1' }, 'edit-model', { kind: 'image' });
    return result;
}

const now = '2026-09-30T12:00:00.000Z';
const projectId = 'project-11111111-1111-4111-8111-111111111111';
const connectionId = 'official-11111111-1111-4111-8111-111111111111';
const media = { id: 'source-v1', assetId: 'source-asset', kind: 'image', uri: 'nextmux.media/source.png', createdAt: now, metadata: { width: 320, height: 320 } };
const output = { versions: [{ ...media, id: 'result-v1', assetId: 'result-asset', uri: 'nextmux.media/result.png' }] };
const cost = { billing: 'provider_billed', description: 'Confirmed image edit cost' };
const capability = { id: 'fixture-route', providerId: 'fixture', providerModelId: 'edit-model', displayName: 'Edit', version: 'fixture-v1', status: 'available', sources: ['fixture'], modes: [{
    mode: 'imageToImage', outputVariants: [{ id: '1024', resolution: '1024x1024', aspectRatios: ['1:1'], defaultAspectRatio: '1:1', dimensions: { '1:1': { width: 1024, height: 1024 } } }],
    defaultResolution: '1024x1024', referenceRules: { image: { supported: true, maxCount: 4 } }, combinationConstraints: [{ combination: 'image', maxImages: 4 }] }] };

async function fixture(runtimeClass, kind = 'image') {
    const root = await mkdtemp(join(tmpdir(), 'canvas-tool-rpc-'));
    await mkdir(join(root, 'nextmux.media'));
    await writeFile(join(root, media.uri), 'fixture');
    const rpc = harness(runtimeClass), store = rpc.canvasStore(root);
    const canvas = createCanvasDocument({ id: 'canvas-rpc', projectId, now });
    const state = await store.save({ ...canvas, nodes: [{ id: 'source', title: 'Source', kind, position: { x: 10, y: 20 }, size: { width: 320, height: 240 }, payload: { versions: [{ ...media, kind }], currentVersionId: media.id } }] }, 0, projectId);
    const queue = await MediaJobStore.create({ root: join(root, 'queue') });
    Object.assign(rpc, { getMediaRuntimeState: async () => ({ ffmpeg: { available: true, path: '/fixture/ffmpeg' } }),
        canvasCapability: async () => capability, canvasInputFiles: async () => new Set([media.uri]), validateCanvasAdapterInput: async () => {},
        mediaJobStore: async () => queue, ensureMediaRecovery: async () => {}, scheduleMediaWorker() {} });
    return { rpc, root, store, state, queue, clean: () => rm(root, { recursive: true, force: true }) };
}

test('local RPC shares the canvas store, survives renderer reconnect and exposes progress plus added output', async () => {
    let calls = 0, release, started;
    const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { started = resolve; });
    class Tools extends PersistentComicCanvasToolsService {
        constructor(root, store, options) { super(root, store, options, async (_request, runtime) => { calls++; runtime.onProgress({ stage: 'process', fraction: .4, completedOutputs: 0, totalOutputs: 1 }); started(); await gate; return output; }); }
    }
    const f = await fixture(Tools);
    try {
        assert.equal(f.rpc.canvasStore(f.root + '/.'), f.store);
        assert.equal(f.rpc.canvasToolsService(f.root).store, f.store);
        const request = { workspaceRoot: f.root, requestId: 'local-click', nodeId: 'source', sourceVersionId: media.id, expectedRevision: f.state.canvas.revision, tool: 'image.mirror' };
        const first = f.rpc.runComicCanvasTool(request), second = f.rpc.runComicCanvasTool(request);
        await ready;
        const progress = await f.rpc.getComicCanvasToolJob(f.root, request.requestId, f.state.canvas.id);
        assert.equal(progress.job.stage, 'process'); assert.equal(progress.job.percent, 40);
        assert.equal(progress.job.status, 'running');
        assert.equal(f.rpc.comicCanvasTools.size, 1, 'actual and default main IDs must share a live facade');
        assert.equal(f.rpc.canvasToolsService(f.root), f.rpc.canvasToolsService(f.root));
        release();
        const [result, duplicate] = await Promise.all([first, second]);
        assert.equal(calls, 1); assert.equal(result.job.status, 'succeeded'); assert.deepEqual(result.job.nodeIds, duplicate.job.nodeIds);
        assert.equal(result.state.canvas.nodes.length, 2); assert.equal(result.state.canvas.nodes[1].payload.currentVersionId, 'result-v1');
        assert.equal(result.job.percent, 100);
        const restarted = harness();
        restarted.getMediaRuntimeState = () => { throw new Error('History must not resolve binaries'); };
        assert.equal((await restarted.getComicCanvasToolJob(f.root, request.requestId)).job.status, 'succeeded');
    } finally { release(); await f.clean(); }
});

test('local RPC cancel and stale revision do not attach output', async () => {
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    class Tools extends PersistentComicCanvasToolsService {
        constructor(root, store, options) { super(root, store, options, async (_request, runtime) => {
            started(); await new Promise(resolve => runtime.signal.addEventListener('abort', resolve, { once: true })); throw new Error('cancelled');
        }); }
    }
    const f = await fixture(Tools);
    try {
        const request = { workspaceRoot: f.root, requestId: 'stale', nodeId: 'source', sourceVersionId: media.id, expectedRevision: 0, tool: 'image.mirror' };
        const conflict = await f.rpc.runComicCanvasTool(request);
        assert.equal(conflict.job.error.code, 'CANVAS_REVISION_CONFLICT');
        const pending = f.rpc.runComicCanvasTool({ ...request, requestId: 'cancel', expectedRevision: f.state.canvas.revision });
        await ready;
        assert.equal((await f.rpc.cancelComicCanvasTool(f.root, 'cancel')).job.status, 'cancelled');
        assert.equal((await pending).job.status, 'cancelled');
        assert.equal((await f.store.read()).canvas.nodes.length, 1);
    } finally { await f.clean(); }
});

test('local RPC reports interrupted running journal after backend restart without restarting work', async () => {
    const f = await fixture();
    try {
        const request = { requestId: 'old-running', nodeId: 'source', sourceVersionId: media.id, expectedRevision: 1, tool: 'image.mirror' };
        await writeFile(join(f.root, 'nextmux.canvas.tools.jobs.json'), JSON.stringify([{ request, fingerprint: JSON.stringify(request),
            job: { requestId: request.requestId, status: 'running', stage: 'process', percent: 35 } }]));
        f.rpc.getMediaRuntimeState = () => { throw new Error('Interrupted history must not resolve binaries'); };
        const restored = await f.rpc.getComicCanvasToolJob(f.root, request.requestId);
        assert.equal(restored.job.status, 'interrupted'); assert.equal(restored.job.error.code, 'LOCAL_TOOL_INTERRUPTED');
        const retried = await f.rpc.runComicCanvasTool({ ...request, workspaceRoot: f.root });
        assert.equal(retried.job.status, 'interrupted'); assert.equal(retried.state.canvas.nodes.length, 1);
    } finally { await f.clean(); }
});

const modelRequest = f => ({ workspaceRoot: f.root, nodeId: 'source', sourceVersionId: media.id, operation: 'image.upscale', connectionId,
    modelId: 'edit-model', expectedRevision: f.state.canvas.revision, idempotencyKey: 'model-tool-click', cost });

test('on-device model-tool RPC bridge bypasses provider, credentials, billing and FFmpeg requirements', async () => {
    for (const operation of ['image.matting', 'image.depth']) {
        let captured;
        class Tools extends PersistentComicCanvasToolsService {
            constructor(root, store, options) { super(root, store, options, async (request, runtime) => {
                captured = { request, runtime };
                runtime.onProgress({ stage: 'download', completedOutputs: 0, totalOutputs: 1, fraction: .4, downloadedBytes: 4, totalBytes: 10 });
                return { versions: output.versions.map(version => ({ ...version, provenance: {
                    sourceVersionId: media.id, operation, tool: operation, parameters: request.parameters, sourceVersionIds: [media.id]
                } })) };
            }); }
        }
        const f = await fixture(Tools);
        try {
            f.rpc.getMediaRuntimeState = async () => ({ ffmpeg: { available: false, message: 'No FFmpeg installed' } });
            f.rpc.canvasCapability = () => { throw new Error('On-device tools cannot consult an API route or credentials'); };
            f.rpc.validateCanvasMediaBilling = () => { throw new Error('On-device tools cannot require paid billing'); };
            const request = { ...modelRequest(f), operation, connectionId: '', modelId: '', parameters: operation === 'image.depth' ? { invert: true } : {} };
            const plan = await f.rpc.getComicCanvasModelToolRoute(request);
            assert.equal(plan.status, 'local'); assert.equal(plan.operation, operation);
            const result = await f.rpc.runComicCanvasModelTool(request);
            assert.equal(result.status, 'local'); assert.equal(result.job.status, 'succeeded');
            assert.equal(result.job.requestId, 'on-device:model-tool-click');
            assert.equal(captured.request.tool, operation);
            assert.equal(captured.runtime.ffmpegPath, undefined);
            assert.equal(captured.runtime.modelDirectory, join(tmpdir(), 'nextmux-test-app-data', 'canvas-models'));
            assert.deepEqual(captured.request.parameters, operation === 'image.depth' ? { invert: true } : {});
            assert.equal(result.state.canvas.nodes.length, 2);
            assert.equal((await f.queue.list()).length, 0);
            const replay = await f.rpc.runComicCanvasModelTool(request);
            assert.deepEqual(replay.job.nodeIds, result.job.nodeIds);
        } finally { await f.clean(); }
    }
});

test('model tool RPC uses one generation node and queue task for concurrent clicks and restart recovery', async () => {
    const f = await fixture();
    try {
        const request = modelRequest(f);
        const [result, duplicate] = await Promise.all([f.rpc.runComicCanvasModelTool(request), f.rpc.runComicCanvasModelTool({ ...request, expectedRevision: 999 })]);
        assert.equal(result.status, 'submitted'); assert.equal(result.job.id, duplicate.job.id);
        assert.equal(result.state.canvas.nodes.length, 2); assert.equal((await f.queue.list()).length, 1);
        assert.equal(result.job.input.characterReferenceUris[0], media.uri);
        assert.equal(result.job.input.width, 1024); assert.equal(result.job.cost.description, cost.description);
        const record = await f.store.getRecord(request.idempotencyKey);
        assert.equal(record.snapshot.mode, 'imageToImage'); assert.equal(record.snapshot.resolvedInputs[0].versionId, media.id);
        // Once queued, source selection and route availability cannot turn recovery into another paid click.
        const edited = { ...result.state.canvas, nodes: result.state.canvas.nodes.filter(node => node.id !== 'source') };
        await f.store.save(edited, edited.revision, projectId);
        const restarted = harness();
        Object.assign(restarted, { canvasCapability: () => { throw new Error('Recovery must retain the original queued request'); },
            mediaJobStore: async () => f.queue, ensureMediaRecovery: async () => {}, scheduleMediaWorker() {} });
        const recovered = await restarted.runComicCanvasModelTool(request);
        assert.equal(recovered.job.id, result.job.id); assert.equal((await f.queue.list()).length, 1);
        await assert.rejects(restarted.runComicCanvasModelTool({ ...request, operation: 'image.relight' }), { code: 'REQUEST_ID_CONFLICT' });
    } finally { await f.clean(); }
});

test('model route absence returns a named capability gap and never reserves or charges', async () => {
    const f = await fixture();
    try {
        f.rpc.canvasCapability = () => { throw new Error('Unsupported output semantics require no provider lookup'); };
        for (const operation of ['audio.separateVoice', 'audio.separateBackground', 'video.upscale', 'video.removeSubtitles']) {
            const result = await f.rpc.runComicCanvasModelTool({ ...modelRequest(f), operation });
            assert.equal(result.code, 'CANVAS_TOOL_NO_MODEL'); assert.ok(result.missingCapabilities.length);
            assert.equal(result.state.canvas.revision, f.state.canvas.revision);
        }
        assert.equal((await f.queue.list()).length, 0); assert.equal((await f.store.read()).canvas.nodes.length, 1);
    } finally { await f.clean(); }
});

test('model preflight and revision failures never create a queue reservation', async () => {
    const f = await fixture();
    try {
        await assert.rejects(f.rpc.runComicCanvasModelTool({ ...modelRequest(f), expectedRevision: 0 }), { code: 'CANVAS_REVISION_CONFLICT' });
        f.rpc.validateCanvasAdapterInput = async () => { throw new CanvasServiceError('CANVAS_ADAPTER_UNSUPPORTED', 'Reference transmission missing'); };
        const unavailable = await f.rpc.runComicCanvasModelTool({ ...modelRequest(f), idempotencyKey: 'adapter-failure' });
        assert.equal(unavailable.code, 'CANVAS_TOOL_NO_MODEL');
        assert.deepEqual(unavailable.missingCapabilities, ['Reference transmission missing']);
        assert.equal((await f.rpc.getComicCanvasModelToolRoute(modelRequest(f))).code, 'CANVAS_TOOL_NO_MODEL');
        assert.equal((await f.queue.list()).length, 0); assert.equal((await f.store.read()).jobs.length, 0);
        assert.equal((await f.store.read()).canvas.nodes.length, 1);
    } finally { await f.clean(); }
});

test('a capability change between tool planning and reservation cannot reinterpret a paid click', async () => {
    const f = await fixture();
    try {
        let reads = 0;
        f.rpc.canvasCapability = async () => ++reads === 1 ? capability : { ...capability, version: 'changed-v2' };
        await assert.rejects(f.rpc.runComicCanvasModelTool(modelRequest(f)), { code: 'CANVAS_CAPABILITY_CHANGED' });
        assert.equal((await f.queue.list()).length, 0);
        assert.equal((await f.store.read()).canvas.nodes.length, 1);
    } finally { await f.clean(); }
});

test('malformed persisted click metadata and unknown operations fail before media submission', async () => {
    const f = await fixture();
    try {
        await assert.rejects(f.rpc.getComicCanvasModelToolRoute({ ...modelRequest(f), operation: '__proto__' }), { code: 'CANVAS_TOOL_PARAMETERS_INVALID' });
        await f.store.save({ ...f.state.canvas, settings: { canvasModelToolClicks: [null] } }, f.state.canvas.revision, projectId);
        await assert.rejects(f.rpc.runComicCanvasModelTool(modelRequest(f)), { code: 'CANVAS_TOOL_CLICK_INVALID' });
        assert.equal((await f.queue.list()).length, 0);
    } finally { await f.clean(); }
});

test('unsupported model protocols report no model while credential errors remain actionable', async () => {
    const f = await fixture();
    try {
        f.rpc.canvasCapability = async () => { throw new CanvasServiceError('MEDIA_PROTOCOL_UNSUPPORTED', 'Unsupported media protocol'); };
        assert.equal((await f.rpc.runComicCanvasModelTool(modelRequest(f))).code, 'CANVAS_TOOL_NO_MODEL');
        f.rpc.canvasCapability = async () => { throw new CanvasServiceError('API_KEY_MISSING', 'Add route credentials'); };
        await assert.rejects(f.rpc.getComicCanvasModelToolRoute(modelRequest(f)), { code: 'API_KEY_MISSING' });
        assert.equal((await f.queue.list()).length, 0);
    } finally { await f.clean(); }
});

test('automatic image editing freezes project dimensions and retains the original request on replay', async () => {
    const f = await fixture();
    try {
        f.rpc.canvasCapability = async () => buildOfficialCanvasCapability({ id: connectionId, providerId: 'openrouter', providerName: 'OpenRouter',
            label: 'Fixture OpenRouter', protocol: 'openai_chat_completions', baseUrl: 'https://openrouter.ai/api/v1', updatedAt: now }, 'edit-model', {}, { kind: 'image' });
        f.rpc.canvasProjectSize = async () => ({ width: 1280, height: 720 });
        const request = { ...modelRequest(f), operation: 'image.relight' };
        const result = await f.rpc.runComicCanvasModelTool(request);
        assert.equal(result.status, 'submitted');
        assert.equal(result.job.input.resolution, 'auto');
        assert.equal(result.job.input.width, 720); assert.equal(result.job.input.height, 720);
        const record = await f.store.getRecord(request.idempotencyKey);
        assert.equal(record.snapshot.parameters.width, 720);
        f.rpc.canvasProjectSize = () => { throw new Error('A queued click must retain its frozen dimensions'); };
        assert.equal((await f.rpc.runComicCanvasModelTool(request)).job.id, result.job.id);
        assert.equal((await f.queue.list()).length, 1);
    } finally { await f.clean(); }
});

test('a changed adapter policy during snapshot preparation returns no model without persisting a draft', async () => {
    const f = await fixture();
    try {
        const original = f.rpc.canvasAdapterPolicy;
        let reads = 0;
        f.rpc.canvasAdapterPolicy = async (...args) => {
            const policy = await original(...args);
            return ++reads === 1 ? policy : { ...policy, maxImageReferences: 0 };
        };
        const result = await f.rpc.runComicCanvasModelTool(modelRequest(f));
        assert.equal(result.code, 'CANVAS_TOOL_NO_MODEL');
        assert.match(result.missingCapabilities[0], /image references/);
        assert.equal((await f.store.read()).canvas.nodes.length, 1);
        assert.equal((await f.queue.list()).length, 0);
    } finally { await f.clean(); }
});

test('billing and known stale revisions reject before any paid prompt preparation', async () => {
    const f = await fixture();
    try {
        const videoCapability = { ...capability, modes: [{ mode: 'textToVideo', outputVariants: capability.modes[0].outputVariants,
            duration: { kind: 'fixed', seconds: 8 }, audioGeneration: { mode: 'unsupported', defaultEnabled: false } }] };
        const snapshot = { modelId: capability.providerModelId, capabilityVersion: capability.version, mode: 'textToVideo', prompt: '需要翻译的提示词',
            parameters: { resolution: '1024x1024', aspectRatio: '1:1', durationSeconds: 8, generateAudio: false }, inputFingerprint: 'fixture', resolvedInputs: [] };
        const policy = { ...await f.rpc.canvasAdapterPolicy(), kind: 'video', modes: ['textToVideo'], maxImageReferences: 0 };
        await assert.rejects(f.rpc.prepareCanvasSnapshot(snapshot, { workspaceRoot: f.root, connectionId, cost: { billing: 'free', description: 'Wrong billing' } },
            projectId, policy, videoCapability), { code: 'COST_CONFIRMATION_REQUIRED' });
        f.rpc.prepareCanvasSnapshot = () => { throw new Error('Stale clicks must not reach paid prompt preparation'); };
        await assert.rejects(f.rpc.runComicCanvasModelTool({ ...modelRequest(f), expectedRevision: 0 }), { code: 'CANVAS_REVISION_CONFLICT' });
        assert.equal((await f.queue.list()).length, 0);
    } finally { await f.clean(); }
});

test('video depth RPC selects local processing and attaches one video node without a provider or media queue', async () => {
    let captured;
    class Tools extends PersistentComicCanvasToolsService {
        constructor(root, store, options) { super(root, store, options, async (request, runtime) => {
            captured = { request, runtime };
            return { versions: [{ ...output.versions[0], kind: 'video', uri: 'nextmux.media/depth.mp4',
                metadata: { width: 320, height: 240, durationMs: 1000, hasAudio: false, frameCount: 25 },
                provenance: { sourceVersionId: media.id, operation: 'video.depth', tool: 'video.depth',
                    parameters: request.parameters, sourceVersionIds: [media.id] } }] };
        }); }
    }
    const f = await fixture(Tools, 'video');
    try {
        f.rpc.canvasCapability = () => { throw new Error('Local depth must not resolve a provider'); };
        f.rpc.validateCanvasMediaBilling = () => { throw new Error('Local depth must not reserve a wallet'); };
        const request = { ...modelRequest(f), operation: 'video.depth', connectionId: '', modelId: '', parameters: {} };
        const plan = await f.rpc.getComicCanvasModelToolRoute(request);
        assert.equal(plan.status, 'local'); assert.equal(plan.kind, 'video');
        const result = await f.rpc.runComicCanvasModelTool(request);
        assert.equal(result.status, 'local'); assert.equal(result.operation, 'video.depth');
        assert.equal(result.job.status, 'succeeded'); assert.equal(result.state.canvas.nodes[1].kind, 'video');
        assert.equal(captured.request.source.kind, 'video'); assert.equal(captured.runtime.ffmpegPath, '/fixture/ffmpeg');
        assert.deepEqual(captured.request.parameters, { resolution: 'source', invert: false, smooth: true });
        assert.equal((await f.queue.list()).length, 0);
        const replay = await f.rpc.runComicCanvasModelTool(request);
        assert.deepEqual(replay.job.nodeIds, result.job.nodeIds);
    } finally { await f.clean(); }
});
