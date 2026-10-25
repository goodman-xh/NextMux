import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Compile current sources in memory. These tests never replace the installed lib or call a provider.
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const helperPath = join(root, 'packages/model-runtime/src/capacity-reasons.ts');
const bundles = new Map();
async function sourceModule(relative) {
    if (!bundles.has(relative)) bundles.set(relative, (async () => {
        const entry = join(root, relative);
        const { outputFiles } = await desktop('esbuild').build({ entryPoints: [entry], bundle: true, write: false,
            platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'current-capacity-metadata',
                setup(build) {
                    build.onResolve({ filter: /^@nextmux\/agent-runtime\/capacity-reasons$/ }, () => ({ path: join(root, 'packages/agent-runtime/src/capacity-reasons.ts') }));
                    build.onResolve({ filter: /^@nextmux\/model-runtime\/capacity-reasons$/ }, () => ({ path: helperPath }));
                    build.onResolve({ filter: /^@nextmux\/model-runtime$/ }, () => ({ path: 'current-model-runtime', namespace: 'capacity' }));
                    build.onResolve({ filter: /^capacity-installed-runtime$/ }, () => ({ path: require.resolve('@nextmux/model-runtime'), external: true }));
                    build.onLoad({ filter: /.*/, namespace: 'capacity' }, () => ({ contents:
                        `export * from 'capacity-installed-runtime'; export { normalizedCapacityReasons, capacityReasonMetadata } from ${JSON.stringify(helperPath)};`,
                        loader: 'ts', resolveDir: root }));
                }
            }] });
        const module = { exports: {} };
        new Function('require', 'module', 'exports', '__filename', '__dirname', outputFiles[0].text)(createRequire(entry), module, module.exports, entry, dirname(entry));
        return module.exports;
    })());
    return bundles.get(relative);
}
const [metadata, activity, history, journal, media, runtime, service] = await Promise.all([
    sourceModule('packages/model-runtime/src/capacity-reasons.ts'),
    sourceModule('packages/theia-nextmux-extension/src/browser/nextmux-agent-activity.ts'),
    sourceModule('packages/theia-nextmux-extension/src/browser/nextmux-conversation-history.ts'),
    sourceModule('packages/theia-nextmux-extension/src/node/nextmux-agent-run-journal.ts'),
    sourceModule('packages/media-core/src/store.ts'),
    sourceModule('packages/agent-runtime/src/runner.ts'),
    sourceModule('packages/theia-nextmux-extension/src/node/nextmux-platform-service.ts')
]);
const at = '2026-10-08T08:00:00.000Z';
const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const reasons = ['concurrency', 'rpm', 'tpm', 'daily_tokens'];
async function temporary(t) {
    const directory = await mkdtemp(join(tmpdir(), 'nextmux-capacity-metadata-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    return directory;
}

test('reason metadata is bounded, ordered and cannot infer a provider quota from unknown values', () => {
    assert.deepEqual(metadata.normalizedCapacityReasons(['tpm', 'concurrency', 'tpm', 'foreign_quota']), ['concurrency', 'tpm']);
    for (const value of [null, 'rpm', { rpm: true }, ['foreign'], Array(5).fill('rpm')]) assert.deepEqual(metadata.capacityReasonMetadata(value), {});
    assert.deepEqual(metadata.normalizedCapacityReasons(['daily_tokens', 'tpm', 'rpm', 'concurrency']), reasons);
});

test('all 12 locales explain each actual reason while older and nonwaiting phases keep their text', () => {
    for (const locale of locales) {
        const base = activity.modelPhasePresentation(locale, 'waiting_capacity');
        const titles = reasons.map(reason => {
            const text = activity.modelPhasePresentation(locale, 'waiting_capacity', [reason]);
            assert.notEqual(text.title, base.title, `${locale}/${reason}`);
            assert(text.detail.includes(base.detail));
            assert.doesNotMatch(text.title + text.detail, /daily_tokens|foreign_quota|provider_quota|\{.*\}/);
            return text.title;
        });
        assert.equal(new Set(titles).size, 4, locale);
        assert.deepEqual(activity.modelPhasePresentation(locale, 'waiting_capacity', ['unknown']), base);
        assert.deepEqual(activity.modelPhasePresentation(locale, 'thinking', reasons), activity.modelPhasePresentation(locale, 'thinking'));
    }
    assert(activity.modelPhasePresentation('zh-CN', 'waiting_capacity', ['concurrency']).detail.includes('当前中转商的该模型较忙，可切换模型或等待。'));
    for (const reason of reasons.slice(1)) assert.doesNotMatch(activity.modelPhasePresentation('zh-CN', 'waiting_capacity', [reason]).detail, /人数|较忙/);
    const both = activity.modelPhasePresentation('en', 'waiting_capacity', ['tpm', 'rpm']);
    assert(both.title.indexOf('Request-') < both.title.indexOf('Token-'));
});

test('the real stream projection uses the current wait reason and omits raw retry diagnostics', async () => {
    const stream = await sourceModule('packages/theia-nextmux-extension/src/browser/nextmux-conversation-stream-model.ts');
    const events = [{ type: 'model_started', turn: 1, at },
        { type: 'model_phase', phase: 'waiting_capacity', capacityReasons: ['concurrency'], turn: 1, at },
        { type: 'model_phase', phase: 'waiting_capacity', capacityReasons: ['rpm'], turn: 1, at },
        { type: 'model_attempt_completed', turn: 1, attempt: 1, outcome: 'failed', retryScheduled: true, at,
            failure: { code: 'RAW_PRIVATE_CODE', requestId: 'raw-private-id', reason: 'RAW_PRIVATE_MESSAGE' } }];
    const view = stream.projectConversationStream({ locale: 'zh-CN', running: true, events });
    const phase = view.items.find(item => item.activity === 'model-waiting_capacity');
    assert.equal(phase.title, activity.modelPhasePresentation('zh-CN', 'waiting_capacity', ['rpm']).title);
    assert.doesNotMatch(JSON.stringify(view), /RAW_PRIVATE_CODE|raw-private-id|RAW_PRIVATE_MESSAGE|中转模型较忙/);
    assert.equal(events.at(-1).failure.code, 'RAW_PRIVATE_CODE');
});

test('model attempt details expose only the localized attempt while raw recovery evidence stays intact', () => {
    const failure = { code: 'SECRET_INTERNAL_CODE', requestId: 'raw-private-request', reason: 'PRIVATE_DIAGNOSTIC' };
    const event = { type: 'model_attempt_completed', outcome: 'failed', attempt: 2, retryScheduled: true, failure, at };
    for (const locale of locales) {
        const view = activity.modelAttemptPresentation(locale, event);
        assert.doesNotMatch(JSON.stringify(view), /SECRET_INTERNAL_CODE|raw-private-request|PRIVATE_DIAGNOSTIC/);
        assert(view.detail.includes('2'));
    }
    assert.equal(event.failure, failure);
    assert.equal(failure.code, 'SECRET_INTERNAL_CODE');
});

test('one actual runner invocation emits changed wait reasons and filters nonwaiting metadata', async t => {
    let calls = 0;
    const result = await new runtime.AgentRunner({ tools: new (require('@nextmux/agent-runtime').AgentToolRegistry)(), permissionMode: 'read_only',
        model: { async complete(request) {
            calls++;
            for (const capacityReasons of [['concurrency'], ['concurrency'], ['tpm', 'rpm'], ['alien']])
                await request.onProviderEvent({ type: 'capacity.waiting', capacityReasons, attemptId: 'same-attempt' });
            await request.onProviderEvent({ type: 'content.started', capacityReasons: ['daily_tokens'] });
            return { content: 'original response', usage: { inputTokens: 1, outputTokens: 1 } };
        } }
    }).run({ prompt: 'local fixture', runId: 'run-capacity-metadata-001' });
    assert.equal(calls, 1);
    const events = result.events.filter(event => event.type === 'model_phase');
    assert.deepEqual(events.map(event => [event.phase, event.capacityReasons]), [
        ['waiting_capacity', ['concurrency']], ['waiting_capacity', ['rpm', 'tpm']], ['waiting_capacity', undefined], ['responding', undefined]
    ]);
    assert.equal(result.finalText, 'original response');
    const directory = await temporary(t), store = new journal.AgentRunJournalStore(directory);
    for (const event of events) await store.appendEvent(result.runId, event);
    const cold = await new journal.AgentRunJournalStore(directory).loadEvents(result.runId);
    assert.deepEqual(cold, events);
    const sessions = [{ id: 'session-a', updatedAt: 1, createdAt: 1, workspacePath: '/fixture', turns: [
        { id: 'turn-a', createdAt: 1, prompt: 'local fixture', response: result.finalText, error: '', events: cold }
    ] }];
    const restored = history.readConversationHistoryMirror(JSON.stringify(history.createConversationHistoryMirror(sessions))).sessions[0].turns[0].events;
    assert.deepEqual(restored.map(event => [event.phase, event.capacityReasons]), events.map(event => [event.phase, event.capacityReasons]));
});

test('journal cold read and history mirror discard oversized or nonwaiting reasons without rewriting source evidence', async t => {
    const directory = await temporary(t), store = new journal.AgentRunJournalStore(directory), runId = 'run-capacity-filter-001';
    const events = [
        { type: 'model_phase', phase: 'waiting_capacity', turn: 1, capacityReasons: ['tpm', 'foreign'], at },
        { type: 'model_phase', phase: 'thinking', turn: 1, capacityReasons: ['concurrency'], at },
        { type: 'model_phase', phase: 'waiting_capacity', turn: 1, capacityReasons: Array(5).fill('rpm'), at }
    ];
    for (const event of events) await store.appendEvent(runId, event);
    const restored = await new journal.AgentRunJournalStore(directory).loadEvents(runId);
    assert.deepEqual(restored.map(event => event.capacityReasons), [['tpm'], undefined, undefined]);
    const sessions = [{ id: 's', updatedAt: 1, turns: [{ id: 't', createdAt: 1, prompt: '', response: '', error: '', events }] }];
    const mirrored = history.readConversationHistoryMirror(JSON.stringify(history.createConversationHistoryMirror(sessions))).sessions[0].turns[0].events;
    assert.deepEqual(mirrored.map(event => event.capacityReasons), [['tpm'], undefined, undefined]);
    assert.equal(events[0].capacityReasons[1], 'foreign');
});

test('media reason changes survive cold recovery with the original key, input and attempt; leaving wait clears reasons', async t => {
    const directory = await temporary(t), store = await media.MediaJobStore.create({ root: directory });
    const input = { connectionId: 'managed:fixed:11111111-1111-4111-8111-111111111111', model: 'fixture', prompt: 'local fixture', width: 512, height: 512 };
    const original = await store.enqueue({ idempotencyKey: 'media-capacity-key-001', kind: 'image', projectId: 'project-00000001', sceneId: 'scene-00000001', shotId: 'shot-00000001', input,
        cost: { billing: 'provider_billed', description: 'local fixture' } }, { now: at });
    await store.confirm(original.id, { now: at });
    const claimed = await store.claimNext('media-worker-capacity-001', { now: at });
    await store.setCapacityWaiting(original.id, 'media-worker-capacity-001', true, { now: at, capacityReasons: ['concurrency'] });
    await store.setCapacityWaiting(original.id, 'media-worker-capacity-001', true, { now: at, capacityReasons: ['tpm', 'rpm'] });
    let cold = await media.MediaJobStore.create({ root: directory });
    const waiting = (await cold.list())[0];
    assert.deepEqual(waiting.capacityReasons, ['rpm', 'tpm']);
    assert.equal(waiting.idempotencyKey, original.idempotencyKey);
    assert.deepEqual(waiting.input, original.input);
    assert.equal(waiting.attempt, claimed.attempt);
    await cold.setCapacityWaiting(original.id, 'media-worker-capacity-001', false, { now: at });
    assert.equal((await cold.list())[0].capacityReasons, undefined);
    await cold.releaseWorker('media-worker-capacity-001', { now: at });
    cold = await media.MediaJobStore.create({ root: directory });
    const [restored] = await cold.recoverInterrupted({ now: at });
    assert.equal(restored.status, 'queued');
    assert.equal(restored.capacityWaitRecorded, true);
    assert.equal(restored.capacityReasons, undefined);
    assert.equal(restored.idempotencyKey, original.idempotencyKey);
    assert.deepEqual(restored.input, original.input);
    assert.equal(restored.attempt, 0);
});

class Service extends service.NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return this.root; }
    async deviceId() { return 'metadata-device-0000001'; }
    async getPrivacySettings() { return {}; }
    wait(key, body, submit, callbacks, capacityStatus) { return this.withLegacyCapacity(key, body, submit, undefined, callbacks, undefined, capacityStatus); }
    consume(response, callbacks) { return this.consumeManagedGatewayStream(response, callbacks); }
    managedSessionPool() { return undefined; }
    stream(route, request, key, callbacks, first = true) { return this.dispatchManagedGatewayWithEvents(route, request, key, undefined, callbacks, first); }
}
async function serviceFixture(t) {
    const instance = new Service();
    instance.root = await temporary(t); instance.baseUrl = 'https://capacity.metadata.invalid'; instance.mediaDeliveryAccountId = 'fixture-owner';
    return instance;
}
test('PlatformRequestError forwards only verified preacceptance wait reasons in RPC data', async t => {
    const instance = await serviceFixture(t);
    const base = { waitingCapacity: true, providerAccepted: false, requestId: randomUUID(), bodyHash: 'b'.repeat(64), capacityReasons: ['tpm', 'concurrency'] };
    async function probe(code, extra) {
        instance.networkFetch = async () => Response.json({ ok: false, code, details: { ...base, ...extra } }, { status: 409 });
        return instance.request('/fixture', { method: 'POST', body: {} }).then(() => assert.fail('expected local error'), error => error);
    }
    const valid = await probe('waiting_capacity', {});
    assert.deepEqual(valid.capacityReasons, ['concurrency', 'tpm']);
    assert.deepEqual(valid.data.capacityReasons, valid.capacityReasons);
    for (const extra of [{ providerAccepted: true }, { partial: true }, { acceptanceUnknown: true }, { visibleOutputStarted: true }, { usageKnown: true }, { chargedMicros: 1 }, { capacityReasons: Array(5).fill('rpm') }]) {
        const error = await probe('waiting_capacity', extra);
        assert.equal(error.capacityReasons, undefined);
        assert.equal(error.data.capacityReasons, undefined);
    }
    assert.equal((await probe('UPSTREAM_CAPACITY_EXHAUSTED', {})).capacityReasons, undefined);
});

test('legacy text/media callbacks carry changing reasons and keep the original request/body identity', async t => {
    const instance = await serviceFixture(t), requestId = randomUUID(), bodyHash = 'b'.repeat(64), body = { prompt: 'private original body' };
    const providerEvents = [], mediaStates = [], paths = [], bodies = []; let submits = 0, recoveries = 0;
    instance.networkFetch = async (url, init) => {
        paths.push(url);
        const recovering = url.endsWith('/recover'); if (recovering) recoveries++;
        return Response.json({ ok: false, code: 'waiting_capacity', details: { requestId, bodyHash, waitingCapacity: true,
            providerAccepted: false, canResume: recovering, requiresClientBody: true, retryAfter: 1,
            capacityReasons: recovering ? ['daily_tokens'] : ['concurrency'] } }, { status: 409 });
    };
    const answer = await instance.wait('original-key', body, async (_resuming, identity) => {
        submits++; bodies.push(JSON.stringify(body)); assert.equal(identity.requestKey, 'original-key');
        if (submits === 1) return instance.request('/api/gateway/media', { method: 'POST', body });
        return 'one original response';
    }, { onProviderEvent: event => providerEvents.push(event) }, async (waiting, reasons) => mediaStates.push([waiting, reasons]));
    assert.equal(answer, 'one original response');
    assert.deepEqual(providerEvents.map(event => event.capacityReasons), [['concurrency'], ['daily_tokens']]);
    assert.deepEqual(mediaStates, [[false, undefined], [true, ['concurrency']], [true, ['daily_tokens']], [false, undefined]]);
    assert.equal(submits, 2); assert.equal(recoveries, 1); assert.equal(bodies[0], bodies[1]);
    assert(paths.some(path => path.includes(requestId) && path.endsWith('/recover')));
    async function contents(path) { let text = ''; for (const file of await readdir(path, { withFileTypes: true })) text += file.isDirectory() ? await contents(join(path, file.name)) : await readFile(join(path, file.name), 'utf8'); return text; }
    assert.doesNotMatch(await contents(instance.root), /private original body/);
});

test('managed stream callbacks filter unknown reasons and never attach quota metadata after provider acceptance', async t => {
    const instance = await serviceFixture(t), events = [];
    const lines = [
        { type: 'capacity.waiting', capacityReasons: ['rpm', 'foreign'] },
        { type: 'content.delta', delta: 'answer', capacityReasons: ['daily_tokens'] },
        { type: 'capacity.waiting', capacityReasons: ['concurrency'] },
        { type: 'completed', result: { ok: true, call: { id: randomUUID() }, response: { content: 'answer', model: 'fixture', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, usageKnown: true } } } }
    ];
    await instance.consume(new Response(lines.map(line => JSON.stringify(line)).join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson' } }), { onProviderEvent: event => events.push(event) });
    assert.deepEqual(events.filter(event => event.type === 'capacity.waiting').map(event => event.capacityReasons), [['rpm'], undefined]);
    assert.equal(events.find(event => event.type === 'content.delta').capacityReasons, undefined);
});

test('task-authority waits forward reasons while recovering and submitting only the original task identity', async t => {
    const instance = await serviceFixture(t), userId = instance.mediaDeliveryAccountId, calls = [], events = [];
    const authority = await sourceModule('packages/theia-nextmux-extension/src/node/nextmux-managed-task-authority.ts');
    let admission, posts = 0;
    instance.networkFetch = async (url, init = {}) => {
        const path = new URL(url).pathname, body = init.body ? JSON.parse(init.body) : {}; calls.push({ path, body });
        if (path.endsWith('/enrollment')) return Response.json({ ok: true, protocol: 'task-authority-v1', userId, enabled: true });
        if (path.endsWith('/admit')) {
            assert.equal(admission, undefined, 'the wait must not readmit a fresh task');
            admission = { ok: true, clientNonce: body.clientNonce, bodyHash: authority.authorityBodyHash(body.body), requestId: randomUUID() };
            admission.authorityRef = 'nmx-ta1.' + Buffer.from(JSON.stringify({ version: 1, origin: 'protocol_first_submit', userId,
                clientNonce: admission.clientNonce, bodyHash: admission.bodyHash, requestId: admission.requestId })).toString('base64url') + '.fixture';
            return Response.json(admission);
        }
        const recovering = path.endsWith('/recover');
        if (recovering || path.endsWith('/responses') && posts++ === 0) return Response.json({ ok: false, code: 'waiting_capacity', details: {
            requestId: admission.requestId, bodyHash: admission.bodyHash, providerAccepted: false, waitingCapacity: true, canResume: recovering,
            recoveryMode: 'resume', resumable: true, retryAfter: 1, capacityReasons: recovering ? ['tpm'] : ['concurrency']
        } }, { status: 409 });
        if (path.endsWith('/responses')) return new Response(JSON.stringify({ type: 'completed', result: { ok: true, call: { id: admission.requestId },
            response: { content: 'one original answer', model: 'fixture', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, usageKnown: true } },
            billing: { chargedMicros: 20, currency: 'USD' } } }) + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
        throw new Error(path);
    };
    const result = await instance.stream({ mode: 'fixed', offeringId: 'offering-fixture' }, { messages: [{ role: 'user', content: 'private original task' }], tools: [], workbench: 'coding' },
        'task-reason-key-001', { onProviderEvent: event => events.push(event) });
    assert.equal(result.call.id, admission.requestId);
    assert.deepEqual(events.filter(event => event.type === 'capacity.waiting').map(event => event.capacityReasons), [['concurrency'], ['tpm']]);
    const submissions = calls.filter(call => call.path.endsWith('/responses'));
    assert.equal(submissions.length, 2);
    assert.deepEqual(submissions[0].body, submissions[1].body);
    assert(calls.findIndex(call => call.path.endsWith('/recover')) < calls.findLastIndex(call => call.path.endsWith('/responses')));
    assert.equal(calls.filter(call => call.path.endsWith('/admit')).length, 1);
});
