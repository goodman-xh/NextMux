import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeManagedWebResearch, managedWebResearchCapabilities, managedWebResearchRequestKey } from '../lib/node/nextmux-managed-web-research.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const capability = { profile: 'openrouter_server_tools', search: 'supported', fetch: 'supported', boundedSearch: true, source: 'live_probe' };
const route = { mode: 'fixed', offeringId: 'a', keyPriceQuoteId: 'kq1_' + 'a'.repeat(64) };
const policy = { version: 1, revision: 0, mode: 'single_route', merchantScope: 'selected_merchant', fallbackRegistryModelIds: [] };
const offerings = [
    { id: 'a', status: 'active', available: true, merchantId: 'one', registryModelId: 'model', nativeWebResearch: capability },
    { id: 'b', status: 'active', available: true, merchantId: 'two', registryModelId: 'model', nativeWebResearch: capability },
    { id: 'c', status: 'active', available: true, merchantId: 'two', registryModelId: 'other', nativeWebResearch: capability }
];

test('optional unproved declarations cannot enable tools or hide ordinary model entries', () => {
    assert.equal(normalizeManagedWebResearch(undefined), undefined);
    assert.equal(normalizeManagedWebResearch({ ...capability, profile: 'made_up' }), undefined);
    assert.equal(normalizeManagedWebResearch({ ...capability, source: 'merchant_declaration' }).search, 'unknown');
    assert.equal(normalizeManagedWebResearch({ ...capability, boundedSearch: false }).search, 'unknown');
    assert.equal(normalizeManagedWebResearch(capability).search, 'supported');
    assert.equal(normalizeManagedWebResearch({ ...capability, reasonCode: 'https://secret.test/' }).reasonCode, undefined);
});

test('fixed API and automatic API research preserve model and merchant scope', () => {
    assert.equal(managedWebResearchCapabilities(offerings, route, policy).search, true);
    const pending = offerings.map(item => item.id === 'a' ? { ...item, nativeWebResearch: undefined } : item);
    assert.equal(managedWebResearchCapabilities(pending, route, policy).search, false);
    assert.equal(managedWebResearchCapabilities(pending, route, { ...policy, mode: 'same_model' }).search, false);
    assert.equal(managedWebResearchCapabilities(pending, route, { ...policy, mode: 'same_model_relays', merchantScope: 'eligible_marketplace' }).search, true);
    assert.equal(managedWebResearchCapabilities(offerings, { mode: 'automatic', registryModelId: 'absent' }, policy).search, false);
    assert.equal(managedWebResearchCapabilities(offerings, { mode: 'automatic', registryModelId: 'model' }, policy).fetch, true);
    assert.equal(managedWebResearchCapabilities(offerings.map(item => ({ ...item, available: false })), route, policy).search, false);
});

test('paid request identity survives recovered runs but separates intentional calls and conversations', () => {
    const context = { runId: 'run', executionScopeId: 'scope', executionId: 'batch' };
    const key = managedWebResearchRequestKey(context, 'search', { query: 'neowow', maxResults: 5 });
    assert.equal(key, managedWebResearchRequestKey({ ...context, runId: 'recovered' }, 'search', { maxResults: 5, query: 'neowow' }));
    assert.match(key, /^desktop-web-[a-f0-9]{64}$/);
    for (const patch of [{ executionScopeId: 'another' }, { executionId: 'another' }])
        assert.notEqual(key, managedWebResearchRequestKey({ ...context, ...patch }, 'search', { query: 'neowow', maxResults: 5 }));
    assert.notEqual(key, managedWebResearchRequestKey(context, 'fetch', { query: 'neowow', maxResults: 5 }));
    assert.doesNotMatch(key, /neowow|scope|batch/);
});

class Service extends NextMuxPlatformServiceImpl {
    body(request) { return this.managedGatewayBody(route, request, {}); }
    async readOfficialConnectionIndex() { return this.connections; }
    async readOfficialCredential() { return 'fixture-key'; }
    async writeOfficialCredential() { this.keyWrites++; }
    async writeOfficialConnectionIndex(connections) { this.connections = connections; }
    async withOfficialConnectionMutation(operation) { return operation(); }
    modelConnectionNetwork() { return { allowInsecure: false }; }
}
const declaration = { version: 1, profile: 'openrouter_server_tools', search: 'supported', fetch: 'supported', source: 'manual_override' };
function service() {
    const s = new Service(); s.keyWrites = 0;
    s.connections = [{ id: 'official-00000000-0000-4000-8000-000000000001', providerId: 'custom_openai', protocol: 'openai_chat_completions',
        label: 'Fixture', model: 'fixture-model', baseUrl: 'https://fixture.test/v1', status: 'unverified', toolCapability: 'untested',
        discoveredModels: [{ id: 'fixture-model', label: 'Fixture' }], lastModelDiscoveryAt: new Date().toISOString(), nativeWebResearch: declaration }];
    return s;
}
const save = { providerId: 'custom_openai', model: 'fixture-model', baseUrl: 'https://fixture.test/v1', validate: false,
    connectionId: 'official-00000000-0000-4000-8000-000000000001' };

test('real own connection save preserves omission, disables with null, and removes override in automatic mode', async () => {
    const s = service();
    assert.deepEqual((await s.saveOfficialModelConnection(save)).connection.nativeWebResearch, declaration);
    assert.equal((await s.saveOfficialModelConnection({ ...save, nativeWebResearch: null })).connection.nativeWebResearch, null);
    assert.deepEqual((await s.saveOfficialModelConnection({ ...save, nativeWebResearch: declaration })).connection.nativeWebResearch, declaration);
    assert.equal(Object.hasOwn((await s.saveOfficialModelConnection({ ...save, nativeWebResearch: 'automatic' })).connection, 'nativeWebResearch'), false);
    assert.equal(s.connections[0].model, save.model);
});

test('manual settings cannot claim platform probe verification or inject provider search pricing', async () => {
    const s = service();
    for (const nativeWebResearch of [{ ...declaration, source: 'live_probe' }, { ...declaration, cost: 0 }, { ...declaration, profile: 'fake' }])
        await assert.rejects(s.saveOfficialModelConnection({ ...save, nativeWebResearch }), error => error.code === 'INVALID_CONNECTION');
    assert.equal(s.keyWrites, 0);
});

test('gateway body carries bounded hosted research separately without replacing ordinary tools or selected route', () => {
    const s = service(), nativeWebResearch = { search: { maxUses: 2, maxResults: 5 } }, tools = [{ name: 'tool', inputSchema: {} }];
    const body = s.body({ messages: [], tools, nativeWebResearch, conversationId: 'fixture' });
    assert.deepEqual(body.nativeWebResearch, nativeWebResearch);
    assert.deepEqual(body.tools, tools);
    assert.equal(body.offeringId, 'a');
    assert.equal(body.automaticRouting, false);
    assert.equal('nativeWebResearch' in s.body({ messages: [], tools: [] }), false);
});
