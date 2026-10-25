import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { mergeOfficialDiscoveryCache } from '../lib/node/nextmux-official-discovery.js';

const request = { providerId: 'custom_openai', model: 'model-a', baseUrl: 'https://fixture.example/v1',
  apiKey: 'synthetic-local-key', validate: false };

class Fixture extends NextMuxPlatformServiceImpl {
  connections = []; credentials = new Map(); calls = 0; writes = 0;
  async readOfficialConnectionIndex() { return structuredClone(this.connections); }
  async writeOfficialConnectionIndex(next) { this.writes++; this.connections = structuredClone(next); }
  async readOfficialCredential(id) { return this.credentials.get(id) || null; }
  async writeOfficialCredential(id, key) { this.credentials.set(id, key); }
  async deleteOfficialCredential(id) { this.credentials.delete(id); }
  async validateOfficialModelConnection() { assert.fail('metadata save must not invoke paid inference validation'); }
  networkFetch = async (input, init) => {
    this.calls++; assert.equal(String(input), 'https://fixture.example/v1/models');
    assert.equal(init.method, 'GET'); assert.equal(init.body, undefined);
    return Response.json({ data: [{ id: 'model-a' }, { id: 'model-b' }] });
  };
}

test('saving a personal key automatically caches multiple models locally without paid validation', async () => {
  const service = new Fixture();
  const { connection, validation } = await service.saveOfficialModelConnection(request);
  assert.equal(service.calls, 1); assert.equal(validation, undefined);
  assert.equal(connection.modelDiscoveryStatus, 'verified');
  assert.deepEqual(connection.discoveredModels.map(model => model.id), ['model-a', 'model-b']);
  // The key read these models from the API's own list: the connection is ready without a paid check.
  assert.equal(connection.status, 'verified'); assert.equal(connection.toolCapability, 'verified');
  assert.equal(connection.lastSuccessfulModelDiscoveryAt, connection.lastModelDiscoveryAt);
  assert.deepEqual(service.connections, [connection]);
  assert.equal(service.credentials.get(connection.id), request.apiKey);
  assert.doesNotMatch(JSON.stringify(service.connections), /synthetic-local-key/);
  const restarted = new Fixture(); restarted.connections = structuredClone(service.connections);
  const loaded = await restarted.getOfficialModelConnections();
  assert.equal(loaded.connections[0].discoveredModels.length, 2); assert.equal(restarted.calls, 0);
});

test('a fresh service restores the actual on-disk directory without a provider request or plaintext credential', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-discovery-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const credentials = new Map();
  class DiskFixture extends NextMuxPlatformServiceImpl {
    calls = 0;
    nextmuxDataRoot() { return root; }
    async readOfficialCredential(id) { return credentials.get(id) || null; }
    async writeOfficialCredential(id, key) { credentials.set(id, key); }
    async deleteOfficialCredential(id) { credentials.delete(id); }
    networkFetch = async (_input, init) => {
      this.calls++; assert.equal(init.method, 'GET');
      return Response.json({ data: [{ id: 'model-a', context_length: 1000000, top_provider: { context_length: 128000, max_completion_tokens: 16000 } }, { id: 'model-b' }] });
    };
  }
  const saving = new DiskFixture(); const saved = (await saving.saveOfficialModelConnection(request)).connection;
  const disk = await readFile(join(root, 'official-connections-v1.json'), 'utf8');
  assert.doesNotMatch(disk, /synthetic-local-key|"apiKey"/);
  const restarted = new DiskFixture();
  const loaded = (await restarted.getOfficialModelConnections()).connections[0];
  const catalogIdentityAndLimits = models => models.map(({ id, label, contextTokens, maximumOutputTokens }) =>
    ({ id, label, contextTokens, maximumOutputTokens }));
  assert.deepEqual(catalogIdentityAndLimits(loaded.discoveredModels), catalogIdentityAndLimits(saved.discoveredModels));
  assert.equal(loaded.discoveredModels[0].capabilityDeclarations.tools.support, 'unknown');
  assert.equal(loaded.discoveredModels[0].contextTokens, 128000); assert.equal(loaded.discoveredModels[0].maximumOutputTokens, 16000);
  assert.deepEqual(restarted.contextLimitsForRequest({ route: { kind: 'official_connection', model: 'model-a' }, contextWindowTokens: 256000 }, loaded),
    { contextWindowTokens: 128000, modelOutputTokenLimit: 16000 });
  assert.equal(loaded.lastSuccessfulModelDiscoveryAt, saved.lastSuccessfulModelDiscoveryAt);
  assert.equal(restarted.calls, 0); assert.equal(saving.calls, 1);
});

test('renaming or changing the selected model retains its identity-matched catalog without another scan', async () => {
  const service = new Fixture(); const first = (await service.saveOfficialModelConnection(request)).connection;
  const result = await service.saveOfficialModelConnection({ ...request, connectionId: first.id, apiKey: undefined,
    label: 'Updated label', model: 'model-b' });
  assert.equal(service.calls, 1); assert.equal(result.connection.model, 'model-b');
  assert.deepEqual(result.connection.discoveredModels, first.discoveredModels);
  assert.equal(result.connection.lastSuccessfulModelDiscoveryAt, first.lastSuccessfulModelDiscoveryAt);
});

test('failed initial discovery saves a recoverable connection without upstream response text', async () => {
  const service = new Fixture();
  service.networkFetch = async () => new Response('private-upstream-error', { status: 503 });
  const { connection } = await service.saveOfficialModelConnection(request);
  assert.equal(connection.modelDiscoveryStatus, 'failed'); assert.equal(connection.modelDiscoveryFailure, 'network_error');
  assert.equal(connection.discoveredModels.length, 0); assert.equal(service.connections.length, 1);
  assert.equal(service.credentials.get(connection.id), request.apiKey);
  assert.equal(connection.modelDiscoveryError.kind, 'provider_error');
  assert.equal(connection.modelDiscoveryError.source, 'own_api');
  assert.equal(connection.modelDiscoveryError.detail, '');
  assert.doesNotMatch(JSON.stringify(connection), /private-upstream-error/);
  assert.doesNotMatch(JSON.stringify(connection), /synthetic-local-key/);
});

test('transient refresh failure retains the last good models and success timestamp, but authentication failure clears them', async () => {
  const service = new Fixture(); const first = (await service.saveOfficialModelConnection(request)).connection;
  for (const status of [429, 503]) {
    service.networkFetch = async () => new Response('private-error', { status });
    const result = await service.refreshOfficialModelDiscovery(first.id);
    assert.equal(result.modelDiscoveryStatus, 'failed');
    assert.deepEqual(result.discoveredModels, first.discoveredModels);
    assert.equal(result.lastSuccessfulModelDiscoveryAt, first.lastSuccessfulModelDiscoveryAt);
  }
  service.networkFetch = async () => new Response('private-error', { status: 401 });
  const revoked = await service.refreshOfficialModelDiscovery(first.id);
  assert.equal(revoked.modelDiscoveryFailure, 'authentication_failed');
  assert.equal(revoked.discoveredModels.length, 0); assert.equal(revoked.lastSuccessfulModelDiscoveryAt, undefined);
});

for (const change of ['key', 'endpoint']) test(`changing ${change} cannot inherit a previous credential's models on discovery failure`, async () => {
  const service = new Fixture(); const first = (await service.saveOfficialModelConnection(request)).connection;
  service.networkFetch = async () => new Response('upstream unavailable', { status: 503 });
  const result = await service.saveOfficialModelConnection({ ...request, connectionId: first.id,
    apiKey: change === 'key' ? 'synthetic-replacement' : undefined,
    baseUrl: change === 'endpoint' ? 'https://second-fixture.example/v1' : request.baseUrl });
  assert.equal(result.connection.discoveredModels.length, 0);
  assert.equal(result.connection.lastSuccessfulModelDiscoveryAt, undefined);
});

for (const change of ['deleted', 'edited', 'rotated']) test(`slow save cannot overwrite a connection that was ${change}`, async () => {
  const service = new Fixture(); const first = (await service.saveOfficialModelConnection(request)).connection;
  let release; let entered;
  const started = new Promise(resolve => { entered = resolve; });
  service.networkFetch = async () => { entered(); await new Promise(resolve => { release = resolve; }); return Response.json({ data: [{ id: 'obsolete' }] }); };
  const saving = service.saveOfficialModelConnection({ ...request, connectionId: first.id, apiKey: 'synthetic-replacement' });
  await started;
  if (change === 'deleted') service.connections = [];
  if (change === 'edited') service.connections[0].label = 'Newer label';
  if (change === 'rotated') service.credentials.set(first.id, 'another-key');
  const state = structuredClone(service.connections); const credentials = new Map(service.credentials); const writes = service.writes;
  release(); await assert.rejects(saving, { code: 'CONNECTION_CHANGED' });
  assert.deepEqual(service.connections, state); assert.deepEqual(service.credentials, credentials); assert.equal(service.writes, writes);
});

test('slow save merges unrelated newly added connections instead of restoring its initial index', async () => {
  const service = new Fixture(); let release; let entered;
  const started = new Promise(resolve => { entered = resolve; });
  service.networkFetch = async () => { entered(); await new Promise(resolve => { release = resolve; }); return Response.json({ data: [{ id: 'model-a' }] }); };
  const saving = service.saveOfficialModelConnection(request); await started;
  const unrelated = { id: 'official-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', label: 'Concurrent connection' };
  service.connections.push(unrelated); release(); await saving;
  assert.equal(service.connections.length, 2); assert.deepEqual(service.connections[0], unrelated);
});

test('concurrent refreshes share a bounded directory read and a later retry starts a new read', async () => {
  const service = new Fixture(); const first = (await service.saveOfficialModelConnection(request)).connection;
  let release; let entered; let calls = 0;
  const started = new Promise(resolve => { entered = resolve; });
  service.networkFetch = async () => { calls++; entered(); await new Promise(resolve => { release = resolve; }); return Response.json({ data: [{ id: 'updated-model' }] }); };
  const pending = service.refreshOfficialModelDiscovery(first.id); await started;
  const repeated = service.refreshOfficialModelDiscovery(first.id); release();
  const results = await Promise.all([pending, repeated]);
  assert.equal(calls, 1); assert.deepEqual(results[0], results[1]);
  service.networkFetch = async () => { calls++; return Response.json({ data: [{ id: 'next-model' }] }); };
  assert.equal((await service.refreshOfficialModelDiscovery(first.id)).discoveredModels[0].id, 'next-model');
  assert.equal(calls, 2);
});

test('cache merge distinguishes successful empty lists from failures, bounds legacy success time and clears revoked authority', () => {
  const previous = { discoveredModels: [{ id: 'old', label: 'Old' }], modelDiscoveryStatus: 'verified', lastModelDiscoveryAt: '2026-09-05T01:00:00.000Z' };
  const attemptedAt = '2026-09-05T02:00:00.000Z';
  for (const failure of ['rate_limited', 'timeout', 'network_error', 'invalid_response']) {
    const result = mergeOfficialDiscoveryCache(previous, { discoveredModels: [], modelDiscoveryStatus: 'failed', modelDiscoveryFailure: failure }, attemptedAt);
    assert.deepEqual(result.discoveredModels, previous.discoveredModels); assert.equal(result.lastModelDiscoveryAt, attemptedAt);
    assert.equal(result.lastSuccessfulModelDiscoveryAt, previous.lastModelDiscoveryAt);
  }
  for (const failure of ['credentials_missing', 'authentication_failed', 'permission_denied', 'endpoint_unsupported']) {
    assert.deepEqual(mergeOfficialDiscoveryCache(previous, { discoveredModels: [], modelDiscoveryStatus: 'failed', modelDiscoveryFailure: failure }, attemptedAt).discoveredModels, []);
  }
  const empty = mergeOfficialDiscoveryCache(previous, { discoveredModels: [], modelDiscoveryStatus: 'verified' }, attemptedAt);
  assert.deepEqual(empty.discoveredModels, []); assert.equal(empty.lastSuccessfulModelDiscoveryAt, attemptedAt);
});
