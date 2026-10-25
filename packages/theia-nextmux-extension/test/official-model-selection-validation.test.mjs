import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const request = { providerId: 'custom_openai', model: 'model-a', baseUrl: 'https://fixture.example/v1',
  apiKey: 'synthetic-local-key', validate: false };
const proof = model => ({ checkedAt: new Date().toISOString(), latencyMs: 8, resolvedModel: model, toolCalling: true });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

class Fixture extends NextMuxPlatformServiceImpl {
  connections = []; credentials = new Map(); probes = [];
  async readOfficialConnectionIndex() { return structuredClone(this.connections); }
  async writeOfficialConnectionIndex(next) { await Promise.resolve(); this.connections = structuredClone(next); }
  async readOfficialCredential(id) { return this.credentials.get(id) || null; }
  async writeOfficialCredential(id, key) { this.credentials.set(id, key); }
  async deleteOfficialCredential(id) { this.credentials.delete(id); }
  async validateOfficialModelConnection(options) { this.probes.push(options); return proof(options.model); }
  networkFetch = async (_input, init) => {
    assert.equal(init.method, 'GET');
    return Response.json({ data: ['model-a', 'model-b', 'model-c'].map(id => ({ id })) });
  };
}

test('selection validates and caches each exact API model without changing its configured model', async () => {
  const service = new Fixture(); const { connection } = await service.saveOfficialModelConnection(request);
  const validated = await service.validateOfficialModelSelection(connection.id, 'model-b');
  assert.equal(validated.model, 'model-a');
  assert.equal(validated.status, 'verified', 'the API listed model-a for this key, so the connection was ready without a check');
  assert.equal(validated.lastCheckedAt, undefined, 'checking model-b is not a check of the configured model');
  assert.equal(validated.discoveredModels.find(model => model.id === 'model-b').validation.toolCalling, true);
  assert.equal(validated.discoveredModels.find(model => model.id === 'model-a').validation, undefined);
  assert.equal(service.probes[0].apiKey, request.apiKey);
  const cached = await service.validateOfficialModelSelection(connection.id, 'model-b');
  assert.deepEqual(cached, validated); assert.equal(service.probes.length, 1);
  for (const alias of ['MODEL-B', 'publisher/model-b', 'model-b-new']) {
    await assert.rejects(service.validateOfficialModelSelection(connection.id, alias), { code: 'MODEL_NOT_DISCOVERED' });
  }
  assert.equal(service.probes.length, 1);
  assert.doesNotMatch(JSON.stringify(validated), /synthetic-local-key/);
});

test('validating the configured primary model updates its own evidence and cache', async () => {
  const service = new Fixture(); const { connection } = await service.saveOfficialModelConnection(request);
  assert.equal(connection.status, 'verified', 'listed by the API');
  const validated = await service.validateOfficialModelSelection(connection.id, 'model-a');
  assert.equal(service.probes.length, 1, 'a status the list earned still gets its first real check');
  assert.equal(validated.model, 'model-a'); assert.equal(validated.status, 'verified');
  assert.equal(validated.toolCapability, 'verified');
  for (const capability of ['model:generatable', 'tools']) {
    assert.ok(validated.capabilityEvidence.some(item => item.capability === capability && item.support === 'supported'
      && item.confidence === 'verified' && item.source === 'live_probe'));
  }
  assert.equal(validated.discoveredModels.find(model => model.id === 'model-a').validation.toolCalling, true);
  assert.ok(Date.parse(validated.updatedAt) > Date.parse(connection.updatedAt));
});

test('simultaneous validations deduplicate one model and retain results of other models', async () => {
  const service = new Fixture(); const { connection } = await service.saveOfficialModelConnection(request);
  const entered = deferred(); const release = deferred();
  service.validateOfficialModelConnection = async options => {
    service.probes.push(options); if (service.probes.length === 2) entered.resolve();
    await release.promise; return proof(options.model);
  };
  const b1 = service.validateOfficialModelSelection(connection.id, 'model-b');
  const b2 = service.validateOfficialModelSelection(connection.id, 'model-b');
  const c = service.validateOfficialModelSelection(connection.id, 'model-c');
  await entered.promise; release.resolve(); const [b, , cResult] = await Promise.all([b1, b2, c]);
  assert.deepEqual(service.probes.map(value => value.model).sort(), ['model-b', 'model-c']);
  assert.equal(service.connections[0].discoveredModels.filter(model => model.validation?.toolCalling).length, 2);
  assert.ok(Date.parse(cResult.updatedAt) > Date.parse(b.updatedAt), 'each merged commit needs a distinct timestamp for renderer ordering');
});

for (const mutation of ['deleted', 'credential', 'endpoint', 'directory']) test(`slow validation cannot restore stale proof after ${mutation} changes`, async () => {
  const service = new Fixture(); const { connection } = await service.saveOfficialModelConnection(request);
  const entered = deferred(); const release = deferred();
  service.validateOfficialModelConnection = async options => { entered.resolve(); await release.promise; return proof(options.model); };
  const validating = service.validateOfficialModelSelection(connection.id, 'model-b'); await entered.promise;
  if (mutation === 'deleted') await service.removeOfficialModelConnection(connection.id);
  if (mutation === 'credential') service.credentials.set(connection.id, 'new-credential');
  if (mutation === 'endpoint') service.connections[0].baseUrl = 'https://other.example/v1';
  if (mutation === 'directory') service.connections[0].discoveredModels = [];
  const state = structuredClone(service.connections); release.resolve();
  await assert.rejects(validating, { code: 'CONNECTION_CHANGED' });
  assert.deepEqual(service.connections, state);
});

test('directory refresh retains exact successful proof, resets negative probe and removes absent model proof', async () => {
  const service = new Fixture(); const { connection } = await service.saveOfficialModelConnection(request);
  await service.validateOfficialModelSelection(connection.id, 'model-b');
  service.validateOfficialModelConnection = async options => ({ ...proof(options.model), toolCalling: false });
  await service.validateOfficialModelSelection(connection.id, 'model-c');
  const refreshed = await service.refreshOfficialModelDiscovery(connection.id);
  assert.equal(refreshed.discoveredModels.find(model => model.id === 'model-b').validation.toolCalling, true);
  assert.equal(refreshed.discoveredModels.find(model => model.id === 'model-c').validation, undefined);
  service.networkFetch = async () => Response.json({ data: [{ id: 'model-a' }, { id: 'MODEL-B' }] });
  const changed = await service.refreshOfficialModelDiscovery(connection.id);
  assert.equal(changed.discoveredModels.some(model => model.validation), false, 'case-changed ID must not inherit proof');
});

test('concurrent directory refresh merges exact validation completed while metadata was in flight', async () => {
  const service = new Fixture(); const { connection } = await service.saveOfficialModelConnection(request);
  const entered = deferred(); const release = deferred();
  service.networkFetch = async () => { entered.resolve(); await release.promise; return Response.json({ data: [{ id: 'model-a' }, { id: 'model-b' }] }); };
  const refreshing = service.refreshOfficialModelDiscovery(connection.id); await entered.promise;
  await service.validateOfficialModelSelection(connection.id, 'model-b');
  release.resolve(); const refreshed = await refreshing;
  assert.equal(refreshed.discoveredModels.find(model => model.id === 'model-b').validation.toolCalling, true);
});

test('cached proof cannot transfer between API credentials or connection identities', async () => {
  const service = new Fixture(); const first = (await service.saveOfficialModelConnection(request)).connection;
  await service.validateOfficialModelSelection(first.id, 'model-b');
  const second = (await service.saveOfficialModelConnection({ ...request, apiKey: 'another-principal' })).connection;
  assert.equal(second.discoveredModels.some(model => model.validation), false);
  await service.validateOfficialModelSelection(second.id, 'model-b');
  assert.equal(service.probes.length, 2); assert.equal(service.probes[1].apiKey, 'another-principal');
  const rotated = (await service.saveOfficialModelConnection({ ...request, connectionId: first.id, apiKey: 'rotated-principal' })).connection;
  assert.equal(rotated.discoveredModels.some(model => model.validation), false);
  await service.validateOfficialModelSelection(first.id, 'model-b');
  assert.equal(service.probes.length, 3); assert.equal(service.probes[2].apiKey, 'rotated-principal');
});

test('exact-model proof survives disk restart without another paid probe or plaintext credential', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-model-proof-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const credentials = new Map(); let probes = 0;
  class DiskFixture extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return root; }
    async readOfficialCredential(id) { return credentials.get(id) || null; }
    async writeOfficialCredential(id, key) { credentials.set(id, key); }
    async validateOfficialModelConnection(options) { probes++; return proof(options.model); }
    networkFetch = async () => Response.json({ data: [{ id: 'model-a' }, { id: 'model-b', reasoning_options: { effort: ['low', 'high'] } }] });
  }
  const service = new DiskFixture(); const { connection } = await service.saveOfficialModelConnection(request);
  await service.validateOfficialModelSelection(connection.id, 'model-b');
  const restarted = new DiskFixture();
  const cached = await restarted.validateOfficialModelSelection(connection.id, 'model-b');
  assert.equal(cached.discoveredModels.find(model => model.id === 'model-b').validation.toolCalling, true);
  assert.deepEqual(cached.discoveredModels.find(model => model.id === 'model-b').reasoningEfforts, ['low', 'high']);
  restarted.networkFetch = async () => Response.json({ data: [{ id: 'model-a' }, { id: 'model-b' }] });
  const refreshed = await restarted.refreshOfficialModelDiscovery(connection.id);
  assert.equal(refreshed.discoveredModels.find(model => model.id === 'model-b').reasoningEfforts, undefined,
    'a fresh API response without an effort enum removes outdated metadata');
  assert.equal(probes, 1);
  assert.doesNotMatch(await readFile(join(root, 'official-connections-v1.json'), 'utf8'), /synthetic-local-key/);
});

test('temporary probe failures store no rejection evidence and may be retried', async () => {
  const service = new Fixture(); const { connection } = await service.saveOfficialModelConnection(request);
  service.validateOfficialModelConnection = async () => { throw new Error('temporary timeout'); };
  await assert.rejects(service.validateOfficialModelSelection(connection.id, 'model-b'), /temporary timeout/);
  assert.equal(service.connections[0].discoveredModels.some(model => model.validation), false);
  service.validateOfficialModelConnection = async options => proof(options.model);
  const retried = await service.validateOfficialModelSelection(connection.id, 'model-b');
  assert.equal(retried.discoveredModels.find(model => model.id === 'model-b').validation.toolCalling, true);
});

test('catalog-only provider IDs are not probed as if they were configured deployments', async () => {
  const service = new Fixture(); const { connection } = await service.saveOfficialModelConnection({ ...request,
    providerId: 'azure_openai', model: 'my-deployment', baseUrl: 'https://resource.openai.azure.com/openai/v1' });
  await assert.rejects(service.validateOfficialModelSelection(connection.id, 'model-b'), { code: 'MODEL_NOT_DISCOVERED' });
  assert.equal(service.probes.length, 0);
});
