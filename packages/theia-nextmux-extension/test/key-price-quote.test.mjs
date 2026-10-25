import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { bindPriceQuote, optionalKeyPriceQuoteId, requireValidKeyPriceQuoteId, priceAuthorizationErrorCode } from '../lib/common/nextmux-price-quote.js';
import { createConversationHistoryMirror, readConversationHistoryMirror } from '../lib/browser/nextmux-conversation-history.js';
import { automaticRelaySource, sameModelRelayPolicy } from '../lib/common/nextmux-relay-switch.js';
import { AgentQuestionController } from '../lib/browser/nextmux-agent-question.js';
import { scheduledTaskNeedsAttention } from '../lib/common/nextmux-schedule.js';
import { declaredReasoningSettings } from '../lib/common/nextmux-model-controls.js';
import { domainMessageFromError } from '../lib/common/nextmux-domain-errors.js';
import { desktopStatus } from '../lib/common/nextmux-desktop-status.js';
import { desktopDomainMessage } from '../lib/browser/nextmux-domain-error-locale.js';

const require = createRequire(import.meta.url);
const URI = require('@theia/core/lib/common/uri').default;
const { FileType } = require('@theia/filesystem/lib/common/files');

const oldQuote = `kq1_${'a'.repeat(64)}`, newQuote = `kq1_${'b'.repeat(64)}`;
const request = { messages: [{ role: 'user', content: 'synthetic' }], tools: [], conversationId: 'synthetic', workbench: 'coding' };
const privacy = { requireZeroDataRetention: false, denyDataCollection: false };
const priceError = () => Response.json({ code: 'price_quote_changed', message: 'Price changed' }, { status: 409 });
const testRoot = mkdtempSync(join(tmpdir(), 'nextmux-price-quote-'));
after(() => rmSync(testRoot, { recursive: true, force: true }));
class Service extends NextMuxPlatformServiceImpl {
    constructor() {
        super();
        this.root = mkdtempSync(join(testRoot, 'service-'));
        this.baseUrl = 'https://fixture.invalid';
        this.mediaDeliveryAccountId = 'synthetic-owner';
    }
    calls = [];
    nextmuxDataRoot() { return this.root; }
    managedSessionPool() { return undefined; }
    async mediaJobStore() {
        return { setCapacityWaiting: async (jobId, workerId, waiting) => {
            assert.equal(jobId, 'synthetic-video-job');
            assert.equal(workerId, this.mediaWorkerId);
            assert.equal(waiting, false);
        } };
    }
    async deviceId() { return 'synthetic-device'; }
    async getPrivacySettings() { return privacy; }
    async request(path, options) { this.calls.push({ path, body: options.body }); return this.managedJson(priceError()); }
    networkFetch = async (path, options) => { this.calls.push({ path, body: JSON.parse(options.body) }); return priceError(); };
}

test('quote validation accepts only bounded opaque IDs and rebinding never adopts a fresh catalog price', () => {
    assert.equal(requireValidKeyPriceQuoteId(oldQuote), oldQuote);
    for (const value of [null, '', 'kq1_synthetic', `kq1_${'A'.repeat(64)}`, oldQuote + '\n', { key: oldQuote }]) {
        assert.equal(optionalKeyPriceQuoteId(value), undefined); assert.throws(() => requireValidKeyPriceQuoteId(value));
    }
    assert.equal(requireValidKeyPriceQuoteId(undefined), undefined);
    const route = { kind: 'managed_gateway', keyPriceQuoteId: newQuote };
    assert.equal(bindPriceQuote(route, oldQuote).keyPriceQuoteId, oldQuote);
    assert.equal(bindPriceQuote(route, undefined).keyPriceQuoteId, undefined);
    assert.equal(route.keyPriceQuoteId, newQuote);
});

for (const mode of ['fixed', 'automatic']) for (const streaming of [false, true]) {
    test(`${mode} ${streaming ? 'streaming' : 'buffered'} text dispatch freezes quote before await and never retries a 409`, async () => {
        const service = new Service();
        const route = { mode, ...(mode === 'fixed' ? { offeringId: 'synthetic' } : { registryModelId: 'synthetic' }), keyPriceQuoteId: oldQuote };
        const pending = streaming ? service.completeManagedGatewayWithEvents(route, request, 'synthetic', undefined, {})
            : service.completeManagedGateway(route, request, 'synthetic');
        route.keyPriceQuoteId = newQuote;
        await assert.rejects(pending, error => {
            assert.equal(error.code, 'price_quote_changed');
            const failure = service.stableAgentRunError(error);
            assert.equal(failure.kind, 'waiting_user'); assert.equal(failure.retryable, false);
            assert.equal(failure.resumable, false); assert.equal(failure.retrySafe, false);
            return true;
        });
        assert.equal(service.calls.length, 1); assert.equal(service.calls[0].body.keyPriceQuoteId, oldQuote);
    });
}

test('direct dispatch body snapshots all route fields before the privacy lookup yields', async () => {
    const service = new Service();
    let resume;
    service.getPrivacySettings = () => new Promise(resolve => { resume = () => resolve(privacy); });
    const route = { mode: 'fixed', offeringId: 'original-offering', keyPriceQuoteId: oldQuote };
    const pending = service.managedGatewayDispatchBody(route, request, 'direct-body', false);
    Object.assign(route, { mode: 'automatic', offeringId: 'edited-offering', registryModelId: 'edited-model', keyPriceQuoteId: newQuote });
    resume();
    const body = await pending;
    assert.equal(body.offeringId, 'original-offering');
    assert.equal(body.automaticRouting, false);
    assert.equal(body.registryModelId, undefined);
    assert.equal(body.keyPriceQuoteId, oldQuote);
    assert.equal(service.calls.length, 0);
});

for (const streaming of [false, true]) test(`${streaming ? 'streaming' : 'buffered'} history preparation and dispatch retain one route snapshot`, async () => {
    const service = new Service(), bodies = [];
    let resume, privacyReads = 0;
    service.getPrivacySettings = async () => {
        if (++privacyReads === 1) await new Promise(resolve => { resume = resolve; });
        return privacy;
    };
    const buildBody = service.managedGatewayBody.bind(service);
    service.managedGatewayBody = (...args) => {
        const body = buildBody(...args); bodies.push(body); return body;
    };
    const bytes = Buffer.from('synthetic-history-image'), sha256 = createHash('sha256').update(bytes).digest('hex');
    const historyRequest = { ...request, messages: [{ role: 'assistant', content: '', outputParts: [{
        type: 'image', asset: { sha256, mimeType: 'image/png', sizeBytes: bytes.length }, dataBase64: bytes.toString('base64')
    }] }] };
    const route = { mode: 'fixed', offeringId: 'original-offering', keyPriceQuoteId: oldQuote };
    const pending = streaming ? service.completeManagedGatewayWithEvents(route, historyRequest, 'history-route', undefined, {})
        : service.completeManagedGateway(route, historyRequest, 'history-route');
    Object.assign(route, { mode: 'automatic', offeringId: 'edited-offering', registryModelId: 'edited-model', keyPriceQuoteId: newQuote });
    resume();
    await assert.rejects(pending, error => error.code === 'price_quote_changed');
    assert.equal(bodies.length, 2, 'history preparation and dispatch both construct a body');
    for (const body of bodies) {
        assert.equal(body.offeringId, 'original-offering');
        assert.equal(body.automaticRouting, false);
        assert.equal(body.registryModelId, undefined);
        assert.equal(body.keyPriceQuoteId, oldQuote);
    }
    assert.equal(service.calls.length, 1, 'a price rejection never resubmits inference');
    assert.equal(service.calls[0].body.inlineMedia[sha256], bytes.toString('base64'));
    assert.equal(service.calls[0].body.messages[0].outputParts[0].dataBase64, undefined);
});

for (const kind of ['image', 'speech', 'video']) test(`${kind} dispatch carries the persisted price and preserves a nonretryable price error`, async () => {
    const service = new Service();
    const input = { connectionId: 'managed:fixed:00000000-0000-4000-8000-000000000002', model: 'synthetic', prompt: 'synthetic',
        width: 512, height: 512, text: 'synthetic', voice: 'alloy', format: 'mp3', durationSeconds: 1, keyPriceQuoteId: oldQuote };
    const job = { kind, id: 'synthetic-video-job', idempotencyKey: 'synthetic-price' }, signal = new AbortController().signal;
    const pending = kind === 'video' ? service.requestManagedVideo('/synthetic', job, input, signal)
        : service.requestManagedMedia(job, input, signal);
    input.keyPriceQuoteId = newQuote;
    await assert.rejects(pending, error => {
        assert.equal(error.code, 'price_quote_changed');
        assert.equal(service.mediaFailure(error).retryable, false); return true;
    });
    assert.equal(service.calls.length, 1); assert.equal(service.calls[0].body.keyPriceQuoteId, oldQuote);
});

test('managed video dispatch keeps the accepted route and request fields while device identity resolves', async () => {
    const service = new Service();
    const referenceAssetUris = ['original-reference.png'], characterReferenceUris = ['original-character.png'];
    const requestedImages = [];
    service.getCatalogOffering = async () => ({ status: 'active', mediaInput: { firstFrame: true, referenceImages: true, maxReferences: 4 } });
    service.managedVideoReferenceImage = async (_root, uri) => {
        requestedImages.push(uri);
        return { referenceImage: { mimeType: 'image/png', dataBase64: Buffer.from(uri).toString('base64') } };
    };
    const input = { connectionId: 'managed:fixed:00000000-0000-4000-8000-000000000002', model: 'original-model',
        prompt: 'original shot', negativePrompt: 'original exclusion', durationSeconds: 3, width: 640, height: 480,
        keyPriceQuoteId: oldQuote, referenceAssetUris, characterReferenceUris };
    const pending = service.requestManagedVideo('/synthetic', { kind: 'video', id: 'synthetic-video-job', idempotencyKey: 'synthetic-video' },
        input, new AbortController().signal);
    Object.assign(input, { connectionId: 'managed:fixed:00000000-0000-4000-8000-000000000003', model: 'other-model',
        prompt: 'different shot', negativePrompt: 'different exclusion', durationSeconds: 8, width: 1280, height: 720,
        keyPriceQuoteId: newQuote });
    referenceAssetUris[0] = 'different-reference.png'; characterReferenceUris[0] = 'different-character.png';
    await assert.rejects(pending, error => error.code === 'price_quote_changed');
    assert.equal(service.calls.length, 1);
    assert.equal(service.calls[0].body.offeringId, '00000000-0000-4000-8000-000000000002');
    assert.equal(service.calls[0].body.keyPriceQuoteId, oldQuote);
    assert.equal(service.calls[0].body.prompt, 'original shot');
    assert.equal(service.calls[0].body.negativePrompt, 'original exclusion');
    assert.equal(service.calls[0].body.durationSeconds, 3);
    assert.equal(service.calls[0].body.width, 640);
    assert.equal(service.calls[0].body.height, 480);
    assert.deepEqual(requestedImages, ['original-reference.png', 'original-character.png']);
});

test('restart mirror retains independent session, turn and queued-task price snapshots without accepting malformed IDs', () => {
    const session = { id: 'session', workspacePath: '/synthetic', title: 'synthetic', updatedAt: 1, createdAt: 1,
        routeId: 'route-new', keyPriceQuoteId: newQuote,
        turns: [{ id: 'turn', createdAt: 1, prompt: 'synthetic', response: '', error: '', routeId: 'route-old', keyPriceQuoteId: oldQuote }],
        followUpQueue: [{ id: 'queue', sessionId: 'session', source: 'user', prompt: 'synthetic', routeId: 'route-old', relayKey: 'managed:merchant', keyPriceQuoteId: oldQuote }] };
    const mirror = createConversationHistoryMirror([session]);
    const restored = readConversationHistoryMirror(JSON.stringify(mirror)).sessions;
    assert.equal(restored[0].keyPriceQuoteId, newQuote); assert.equal(restored[0].turns[0].keyPriceQuoteId, oldQuote);
    assert.equal(restored[0].turns[0].routeId, 'route-old'); assert.equal(restored[0].followUpQueue[0].keyPriceQuoteId, oldQuote);
    const invalid = createConversationHistoryMirror([{ ...session, keyPriceQuoteId: 'invalid-secret' }]);
    assert.doesNotMatch(JSON.stringify(invalid), /invalid-secret/);
});

test('explicit merchant refresh bypasses a fresh cache and malformed price evidence never becomes selectable', async () => {
    const service = new Service(); let calls = 0;
    service.request = async () => { calls++; return { offerings: [{ id: 'a', merchantId: 'merchant', keyPriceQuoteId: calls === 1 ? oldQuote : newQuote }] }; };
    assert.equal((await service.getMerchantCatalog('merchant')).offerings[0].keyPriceQuoteId, oldQuote);
    assert.equal((await service.getMerchantCatalog('merchant')).offerings[0].keyPriceQuoteId, oldQuote);
    assert.equal((await service.getMerchantCatalog('merchant', undefined, true)).offerings[0].keyPriceQuoteId, newQuote);
    assert.equal(calls, 2);
    service.request = async () => ({ offerings: [{ id: 'a', merchantId: 'bad', keyPriceQuoteId: 'invalid' }] });
    await assert.rejects(service.getMerchantCatalog('bad')); assert.equal(service.merchantCatalogPages.size, 1);
});

test('all price authorization errors are nonretryable and the synchronous RPC preserves a safe machine-readable tag', async () => {
    const service = new Service();
    for (const code of ['price_quote_changed', 'price_authorization_required', 'price_quote_invalid']) {
        let failure;
        try { await service.managedJson(Response.json({ error: { code, message: 'Synthetic price error' } }, { status: 409 })); }
        catch (error) { failure = error; }
        assert.equal(service.stableAgentRunError(failure).kind, 'waiting_user');
        assert.equal(service.stableAgentRunError(failure).retryable, false);
        service.executeAgentRun = async () => { throw { failure: { code } }; };
        await assert.rejects(service.runAgent({ toolScope: 'comic-json' }), error => {
            assert.equal(priceAuthorizationErrorCode(new Error(error.message)), code.toUpperCase()); return true;
        });
    }
});

test('a scheduled task uses its own frozen quote and stops recurrence when explicit price confirmation is required', async () => {
    const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const methods = [];
    const visit = node => { if (ts.isMethodDeclaration(node) && ['executeScheduledTask', 'managedModelRoute'].includes(node.name.getText(file))) methods.push(node.getText(file)); ts.forEachChild(node, visit); };
    visit(file); assert.equal(methods.length, 2);
    const dependencies = { bindPriceQuote, priceAuthorizationErrorCode, automaticRelaySource, sameModelRelayPolicy,
        AgentQuestionController, scheduledTaskNeedsAttention, declaredReasoningSettings, domainMessageFromError,
        desktopStatus, desktopDomainMessage, URI, FileType, window: {} };
    const Harness = new Function(...Object.keys(dependencies), ts.transpile(`class Harness { ${methods.join('\n')} }; return Harness;`, {
        target: ts.ScriptTarget.ES2022
    }))(...Object.values(dependencies));
    const state = new Harness(), patches = [], removed = [], dispatched = [];
    Object.assign(state, { desktopLocale: 'en', scheduledTasksReady: true, scheduledTasks: [], scheduledTasksPersistence: Promise.resolve(), scheduledAgentRuns: new Map(),
        scheduledTaskDueAt: () => Date.now() - 1000, flushConversationHistory: async () => {},
        runningScheduledTaskIds: new Set(), workspaceOptions: [{ path: '/synthetic' }],
        fileService: { activateProvider: async () => ({ stat: async () => ({ type: FileType.Directory }) }) },
        conversationHistoryReady: () => true, updateScheduledTask: (_id, patch) => patches.push(patch),
        allModelRoutes: () => [{ id: 'route', kind: 'managed_gateway', offering: { id: 'offering', keyPriceQuoteId: newQuote } }],
        scheduledTaskSession: () => ({ id: 'session' }), codingConversationHistory: () => [],
        appendCodingTurn: () => ({ id: 'turn' }), updateCodingTurn() {}, addNotification() {},
        modelSwitchSettings: { get: () => undefined }, reasoningEffortForRoute: () => undefined,
        modelReasoningContract: () => undefined, prepareAgentSkills: async () => [],
        platformService: { async claimDesktopScheduledTaskRun() { return { claimed: true }; },
            async startAgentRun(request) { dispatched.push(request); throw new Error('[PRICE_QUOTE_CHANGED] synthetic'); },
            async removeDesktopScheduledTask(id) { removed.push(id); } }
    });
    await state.executeScheduledTask({ id: 'scheduled', routeId: 'route', keyPriceQuoteId: oldQuote, workspacePath: '/synthetic', prompt: 'synthetic', cadence: 'daily', enabled: true });
    assert.equal(dispatched.length, 1); assert.equal(dispatched[0].route.route.keyPriceQuoteId, oldQuote);
    assert.equal(patches.at(-1).enabled, false); assert.equal(patches.at(-1).lastStatus, 'error');
    assert.deepEqual(removed, ['scheduled']); assert.equal(state.runningScheduledTaskIds.size, 0);
});

test('a stale media cost checkbox cannot approve a newly refreshed price', () => {
    const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let method;
    const visit = node => { if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'setMediaDraft') method = node.getText(file); ts.forEachChild(node, visit); };
    visit(file); assert.ok(method);
    const Harness = new Function('optionalKeyPriceQuoteId', ts.transpile(`class Harness { ${method} }; return Harness;`, {
        target: ts.ScriptTarget.ES2022
    }))(optionalKeyPriceQuoteId);
    const state = new Harness();
    Object.assign(state, { mediaDraft: { kind: 'image', connectionId: 'managed', costConfirmed: false }, update() {},
        comicMediaRoute: (_kind, routeId) => routeId === 'managed' ? { id: 'managed', kind: 'managed', offering: { keyPriceQuoteId: newQuote } } : undefined });
    state.setMediaDraft({ costConfirmed: true, keyPriceQuoteId: oldQuote });
    assert.equal(state.mediaDraft.costConfirmed, false); assert.equal(state.mediaDraft.keyPriceQuoteId, undefined);
    state.setMediaDraft({ costConfirmed: true, keyPriceQuoteId: newQuote });
    assert.equal(state.mediaDraft.costConfirmed, true); assert.equal(state.mediaDraft.keyPriceQuoteId, newQuote);
});
