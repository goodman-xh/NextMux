import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateModelSwitchPolicy, modelSwitchRouteKey, modelSwitchUsdMicros } from '../lib/common/nextmux-model-switch-policy.js';
import { ModelSwitchSettings } from '../lib/browser/nextmux-model-switch-settings.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { ManagedSessionCapacityError } from '../lib/node/nextmux-managed-session.js';

const route = { mode: 'automatic', registryModelId: 'primary' };
const policy = (revision = 1) => ({ version: 1, revision, mode: 'allowlisted_models', fallbackRegistryModelIds: ['alternate'], merchantScope: 'eligible_marketplace', maxRequestChargeMicros: 250000 });

test('policy parsing matches the fail-closed CF contract and never trusts invalid persistence', () => {
    assert.equal(validateModelSwitchPolicy(undefined, route).mode, 'same_model');
    for (const patch of [{ version: 2 }, { revision: -1 }, { merchantScope: 'selected_merchant' }, { fallbackRegistryModelIds: ['alternate', 'alternate'] }, { fallbackRegistryModelIds: ['a', 'b', 'c', 'd'] }, { fallbackRegistryModelIds: ['primary'] }, { mode: 'same_model' }, { maxRequestChargeMicros: '100' }, { maxRequestChargeMicros: 0.5 }, { secret: 'not-permitted' }]) assert.throws(() => validateModelSwitchPolicy({ ...policy(), ...patch }, route));
    const source = policy(), frozen = validateModelSwitchPolicy(source, route); source.fallbackRegistryModelIds.push('late'); assert.deepEqual(frozen.fallbackRegistryModelIds, ['alternate']);
    assert.notEqual(modelSwitchRouteKey(route), modelSwitchRouteKey({ mode: 'fixed', offeringId: 'primary' }));
    assert.equal(new ModelSwitchSettings('{bad').get(route).mode, 'same_model');
    const store = new ModelSwitchSettings(null), serialized = store.set(route, policy());
    assert.deepEqual(new ModelSwitchSettings(serialized).get(route), policy());
    assert.equal(new ModelSwitchSettings(serialized).get({ mode: 'automatic', registryModelId: 'other' }).mode, 'same_model');
    assert.equal(new ModelSwitchSettings(JSON.stringify({ [modelSwitchRouteKey(route)]: { ...policy(), apiKey: 'untrusted' } })).get(route).mode, 'same_model');
});

test('USD authorization uses exact integer micros, supports zero and rejects rounding or exponents', () => {
    for (const [value, expected] of [['', undefined], ['0', 0], ['0.000001', 1], ['1.000009', 1000009], ['12.34', 12340000], ['999999999.999999', 999999999999999]]) assert.equal(modelSwitchUsdMicros(value), expected);
    for (const value of ['1.0000001', '-1', '1e3', 'Infinity', '1,23', '.5']) assert.throws(() => modelSwitchUsdMicros(value));
});

class Service extends NextMuxPlatformServiceImpl {
    async getPrivacySettings() { return {}; }
    async deviceId() { return 'synthetic-device-0000001'; }
    async managedTaskCapability() { return { userId: 'synthetic-account-0000001', enabled: false }; }
    seed(id = 'run-one', task = 'task-one') {
        const job = { runId: id, managedRoute: route, switchPolicy: policy(), status: 'running', controller: new AbortController(), cancelRequested: false, recoveryRecord: { owner: { conversationId: task } } };
        this.agentJobs.set(id, job); return job;
    }
    body(request, privacy = { requireZeroDataRetention: true, denyDataCollection: true }) { return this.managedGatewayBody(route, request, privacy); }
    consume(response) { return this.consumeManagedGatewayStream(response, {}); }
    stream(signal) { return this.completeManagedGatewayWithEvents(route, { messages: [{ role: 'user', content: 'hello' }], tools: [], workbench: 'coding', conversationId: 'task-one' }, 'stable-request-0001', signal, {}); }
    classify(error) { return this.stableAgentRunError(error); }
}

test('managed session capacity returns a bounded error without a legacy POST', async () => {
    class CapacityService extends Service {
        constructor() {
            super();
            this.capacityPool = {
                openStream: async () => { throw new ManagedSessionCapacityError(); },
            };
        }
        managedSessionPool() { return this.capacityPool; }
    }
    const service = new CapacityService();
    let posts = 0;
    service.networkFetch = async () => { posts++; throw new Error('legacy POST must not be attempted'); };
    await assert.rejects(service.stream(), error => {
        assert.equal(error.code, 'MANAGED_SESSION_CAPACITY');
        assert.equal(error.status, 503);
        assert.equal(error.retryAfterMs, 1_000);
        return true;
    });
    assert.equal(posts, 0);
});

test('actual hot-update RPC isolates task/run/primary, rejects old revisions, and leaves accepted snapshots unchanged', async () => {
    const service = new Service(), first = service.seed(), second = service.seed('run-two', 'task-two');
    const acceptedSnapshot = validateModelSwitchPolicy(first.switchPolicy, route);
    const next = policy(2); next.fallbackRegistryModelIds = ['next'];
    assert.deepEqual(await service.updateAgentRunSwitchPolicy('run-one', 'task-one', route, next), { revision: 2, applies: 'next_model_turn' });
    assert.deepEqual(acceptedSnapshot.fallbackRegistryModelIds, ['alternate']); assert.deepEqual(first.switchPolicy.fallbackRegistryModelIds, ['next']); assert.equal(second.switchPolicy.revision, 1);
    next.fallbackRegistryModelIds.push('mutated'); assert.deepEqual(first.switchPolicy.fallbackRegistryModelIds, ['next']);
    assert.deepEqual(await service.updateAgentRunSwitchPolicy('run-one', 'task-one', route, first.switchPolicy), { revision: 2, applies: 'next_model_turn' });
    await assert.rejects(service.updateAgentRunSwitchPolicy('run-one', 'task-one', route, policy(1)), { code: 'MODEL_SWITCH_REVISION_CONFLICT' });
    for (const [runId, taskId, selected] of [['missing', 'task-one', route], ['run-one', 'task-two', route], ['run-one', 'task-one', { mode: 'fixed', offeringId: 'other' }]]) await assert.rejects(service.updateAgentRunSwitchPolicy(runId, taskId, selected, policy(3)), { code: 'MODEL_SWITCH_OWNER_MISMATCH' });
    first.controller.abort(); await assert.rejects(service.updateAgentRunSwitchPolicy('run-one', 'task-one', route, policy(3)), { code: 'MODEL_SWITCH_OWNER_MISMATCH' });
    second.status = 'completed'; await assert.rejects(service.updateAgentRunSwitchPolicy('run-two', 'task-two', route, policy(3)), { code: 'MODEL_SWITCH_OWNER_MISMATCH' });
});

test('managed gateway sends privacy preferences separately from explicit constraints', async () => {
    const service = new Service(), original = policy();
    const body = service.body({ messages: [], tools: [], workbench: 'coding', conversationId: 'task-one', switchPolicy: original, zeroDataRetention: false, dataCollection: 'allow' });
    assert.deepEqual(body.privacyPreference, { mode: 'advisory-v1', zeroDataRetention: true, dataCollection: 'deny' });
    assert.equal(body.zeroDataRetention, false); assert.equal(body.dataCollection, 'allow'); assert.deepEqual(body.switchPolicy, original);
    original.fallbackRegistryModelIds.push('mutated'); assert.deepEqual(body.switchPolicy.fallbackRegistryModelIds, ['alternate']);
    const switchReceipt = { version: 1, policyRevision: 2, fromRegistryModelId: 'primary', toRegistryModelId: 'alternate', toAttemptId: 'attempt', reason: 'pre_acceptance_failure', actualOfferingId: 'offering', contextViewHash: 'hash', privateStateReused: false };
    const envelope = { type: 'completed', result: { call: { requestedRegistryModelId: 'primary', servedRegistryModelId: 'alternate' }, switchReceipt, response: { content: '', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, usageKnown: true } } } };
    const result = await service.consume(new Response(JSON.stringify(envelope) + '\n', { headers: { 'content-type': 'application/x-ndjson' } }));
    assert.deepEqual(result.switchReceipt, switchReceipt); assert.equal(result.call.servedRegistryModelId, 'alternate');
});

test('new UI imports no cross-model allowlist editor while historical policy updates stay request-boundary scoped', () => {
    const widget = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(widget, /from ['"].*nextmux-model-switch-panel|<ModelSwitchPanel/);
    assert.match(widget, /<RelaySwitchControl/);
    const source = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
    assert.match(source, /const switchPolicy = normalizeModelSwitchPolicyForDispatch\(execution.getSwitchPolicy\?\.\(\) \|\| initialSwitchPolicy, managedRoute\)/);
    const body = source.slice(source.indexOf('async updateAgentRunSwitchPolicy'), source.indexOf('async runAgent('));
    assert.doesNotMatch(body, /abort\(|completeManagedGateway|executeAgentRun/);
});

test('CF unknown acceptance stays billing-only across desktop parsing and persisted error classification', async () => {
    const service = new Service();
    const envelope = { type: 'error', error: { code: 'upstream_transport_unknown', acceptanceUnknown: true, recoveryMode: 'billing_review', requestId: 'original-cf-request', status: 502, message: 'Review original request' } };
    await assert.rejects(service.consume(new Response(JSON.stringify(envelope) + '\n', { headers: { 'content-type': 'application/x-ndjson' } })), error => {
        assert.equal(error.code, 'BILLING_TRANSPORT_UNKNOWN'); assert.equal(error.retrySafe, false); assert.equal(error.requestId, 'original-cf-request');
        const failure = service.classify(error); assert.equal(failure.resumable, false); assert.equal(failure.retryable, false); assert.equal(failure.kind, 'waiting_user'); return true;
    });
});

test('desktop-to-CF dispatched POST with no response never becomes ordinary retry or a fabricated request ID', async () => {
    for (const type of ['stream', 'buffered']) for (const name of ['TypeError', 'AbortError']) {
        const service = new Service(); let calls = 0; let recoveryCalls = 0;
        service.networkFetch = async (url, init) => {
            if (String(url).endsWith('/api/gateway/recover')) {
                recoveryCalls++;
                assert.equal(init.headers['idempotency-key'], 'stable-request-0001');
                assert.equal(init.body, undefined);
                return Response.json({ code: 'request_initialization_pending', details: { acceptanceUnknown: true, recoveryMode: 'billing_review' } }, { status: 503 });
            }
            calls++; assert.equal(init.method, 'POST'); assert.equal(init.headers['idempotency-key'], 'stable-request-0001'); throw Object.assign(new Error('synthetic socket closed after dispatch'), { name });
        };
        const result = type === 'stream' ? service.stream() : service.completeManagedGateway(route, { messages: [], tools: [], workbench: 'coding', conversationId: 'task-one' }, 'stable-request-0001');
        await assert.rejects(result, error => { assert.equal(error.code, 'BILLING_INITIALIZATION_PENDING'); assert.equal(error.requestId, undefined); assert.equal(error.retrySafe, false); assert.equal(service.classify(error).resumable, false); assert.equal(service.classify(error).readableError.kind, 'request_initialization_pending'); return true; });
        assert.equal(calls, 1);
        assert.equal(recoveryCalls, 4);
    }
});

test('pre-dispatch cancellation sends nothing, but a lost completion envelope requires billing review', async () => {
    const service = new Service(); let calls = 0; let recoveryCalls = 0;
    service.networkFetch = async url => {
        if (String(url).endsWith('/api/gateway/recover')) {
            recoveryCalls++;
            return Response.json({ code: 'request_initialization_pending', details: { acceptanceUnknown: true, recoveryMode: 'billing_review' } }, { status: 503 });
        }
        calls++;
        return new Response('{"type":"content.delta","delta":"partial"}\n', { headers: { 'content-type': 'application/x-ndjson' } });
    };
    const controller = new AbortController(); controller.abort();
    await assert.rejects(service.stream(controller.signal), { code: 'CANCELLED' }); assert.equal(calls, 0);
    await assert.rejects(service.stream(), error => ['BILLING_TRANSPORT_UNKNOWN', 'BILLING_INITIALIZATION_PENDING', 'BILLING_RECOVERY_UNAVAILABLE'].includes(error.code)); assert.equal(calls, 1); assert.equal(recoveryCalls, 4);
});
