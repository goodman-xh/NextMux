import assert from 'node:assert/strict';
import test from 'node:test';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { discoverConnectionModels, isDiscoveredInvocationAllowed } from '../lib/node/nextmux-official-discovery.js';

const id = 'official-8c8642b4-7365-4f0a-ae0d-b26d99ed2f18';
const connection = () => ({ id, providerId: 'bedrock', providerName: 'Amazon Bedrock', modelFamily: 'Bedrock',
    protocol: 'openai_chat_completions', label: 'Manual inference profile', model: 'us.amazon.manual-profile-v1:0',
    baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com', providerSettings: { credentialSource: 'api_key', region: 'us-east-1' },
    keyHint: 'synthetic', status: 'verified', toolCapability: 'verified', capabilityEvidence: [], discoveredModels: [], modelDiscoveryStatus: 'untested',
    createdAt: '2026-09-05T01:00:00.000Z', updatedAt: '2026-09-05T01:00:00.000Z' });

class FixtureService extends NextMuxPlatformServiceImpl {
    connections = [connection()]; credentials = new Map([[id, 'synthetic-bearer']]); writes = 0; calls = 0;
    async readOfficialConnectionIndex() { return structuredClone(this.connections); }
    async writeOfficialConnectionIndex(next) { this.writes++; this.connections = structuredClone(next); }
    async readOfficialCredential(key) { return this.credentials.get(key) || null; }
    networkFetch = async (url, init) => {
        this.calls++; assert.equal(String(url), 'https://bedrock.us-east-1.amazonaws.com/foundation-models');
        assert.equal(init.method, 'GET'); assert.equal(init.body, undefined); assert.equal(init.redirect, 'error');
        assert.equal(new Headers(init.headers).get('authorization'), 'Bearer synthetic-bearer');
        return Response.json({ modelSummaries: [{ modelId: 'amazon.catalog-model-v1:0', modelName: 'Directory model', responseStreamingSupported: true }] });
    };
}

test('actual Bedrock refresh keeps manual profile and existing inference validation, all new rows remain catalog-only', async () => {
    const service = new FixtureService(), result = await service.refreshOfficialModelDiscovery(id);
    assert.equal(service.calls, 1); assert.equal(result.modelDiscoveryStatus, 'catalog_discovered');
    assert.equal(result.model, connection().model); assert.equal(result.status, 'verified'); assert.equal(result.toolCapability, 'verified');
    assert.deepEqual(result.discoveredModels, [{ id: 'amazon.catalog-model-v1:0', label: 'Directory model', selectionMode: 'catalog_only' }]);
    assert.equal(isDiscoveredInvocationAllowed(result, 'amazon.catalog-model-v1:0'), false);
    assert.equal(isDiscoveredInvocationAllowed({ ...result, discoveredModels: [{ id: 'amazon.catalog-model-v1:0', label: 'Old cached row' }] }, 'amazon.catalog-model-v1:0'), false);
    assert.equal(isDiscoveredInvocationAllowed(result, connection().model), true);
    assert.equal(service.writes, 1); assert.doesNotMatch(JSON.stringify(result), /synthetic-bearer/);
});

test('directory authorization failures preserve the working inference connection and never expose provider body', async () => {
    for (const [status, failure] of [[401, 'authentication_failed'], [403, 'permission_denied'], [404, 'endpoint_unsupported'], [429, 'rate_limited'], [503, 'network_error']]) {
        const service = new FixtureService();
        service.networkFetch = async (_url, init) => { service.calls++; assert.equal(init.method, 'GET'); return new Response('PRIVATE_CREDENTIAL_DIAGNOSTIC', { status }); };
        const result = await service.refreshOfficialModelDiscovery(id);
        assert.equal(result.modelDiscoveryFailure, failure); assert.equal(result.status, 'verified'); assert.equal(result.toolCapability, 'verified');
        assert.equal(result.model, connection().model); assert.equal(service.calls, 1); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CREDENTIAL_DIAGNOSTIC/);
    }
    const missing = new FixtureService(); missing.credentials.clear();
    const result = await missing.refreshOfficialModelDiscovery(id);
    assert.equal(result.modelDiscoveryFailure, 'credentials_missing'); assert.equal(missing.calls, 0); assert.equal(result.model, connection().model);
});

test('unsupported Bedrock endpoints and Vertex bypass all requests rather than trying generic /models', async () => {
    for (const providerId of ['bedrock', 'vertex']) {
        const result = await discoverConnectionModels({ providerId, protocol: 'openai_chat_completions', baseUrl: 'https://custom.invalid/v1', apiKey: 'synthetic',
            fetchImpl: async () => assert.fail('unsupported cloud directory was requested') });
        assert.equal(result.modelDiscoveryStatus, 'unsupported'); assert.equal(result.modelDiscoveryFailure, 'endpoint_unsupported');
    }
    const service = new FixtureService(); service.connections[0].baseUrl = 'https://bedrock-runtime.us-east-1.amazonaws.com/inference/';
    const result = await service.refreshOfficialModelDiscovery(id);
    assert.equal(result.modelDiscoveryStatus, 'unsupported'); assert.equal(service.calls, 0); assert.equal(result.model, connection().model);
});

for (const change of ['delete', 'model', 'region', 'key']) test(`late Bedrock catalog after ${change} cannot overwrite the current connection`, async () => {
    const service = new FixtureService(); let entered, release;
    const started = new Promise(resolve => { entered = resolve; });
    service.networkFetch = async () => { service.calls++; entered(); await new Promise(resolve => { release = resolve; }); return Response.json({ modelSummaries: [{ modelId: 'old.catalog-result' }] }); };
    const refreshing = service.refreshOfficialModelDiscovery(id); await started;
    if (change === 'delete') service.connections = [];
    if (change === 'model') service.connections[0].model = 'us.amazon.new-profile';
    if (change === 'region') service.connections[0].providerSettings.region = 'us-west-2';
    if (change === 'key') service.credentials.set(id, 'synthetic-rotated');
    const latest = structuredClone(service.connections); release();
    await assert.rejects(refreshing, { code: 'CONNECTION_CHANGED' });
    assert.deepEqual(service.connections, latest); assert.equal(service.writes, 0); assert.equal(service.calls, 1);
});
