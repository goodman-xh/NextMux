import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { discoverConnectionModels, isDiscoveredInvocationAllowed } from '../lib/node/nextmux-official-discovery.js';

const id = 'official-1d2a8788-98c3-4670-bc3c-69cdeacf8a5c';
const connection = () => ({ id, providerId: 'azure_openai', providerName: 'Azure OpenAI', modelFamily: 'OpenAI',
  protocol: 'openai_responses', label: 'My deployment', model: 'my-handwritten-deployment', baseUrl: 'https://fixture.openai.azure.com/openai/v1',
  providerSettings: { credentialSource: 'api_key' }, keyHint: 'fixture', status: 'verified', toolCapability: 'verified',
  capabilityEvidence: [], discoveredModels: [], modelDiscoveryStatus: 'untested',
  createdAt: '2026-09-05T01:00:00.000Z', updatedAt: '2026-09-05T01:00:00.000Z' });

class FixtureService extends NextMuxPlatformServiceImpl {
  connections = [connection()]; credentials = new Map([[id, 'fixture-api-key']]); writes = 0; calls = 0;
  async readOfficialConnectionIndex() { return structuredClone(this.connections); }
  async writeOfficialConnectionIndex(next) { this.writes++; this.connections = structuredClone(next); }
  async readOfficialCredential(key) { return this.credentials.get(key) || null; }
  networkFetch = async (url, init) => {
    this.calls++; assert.equal(String(url), 'https://fixture.openai.azure.com/openai/v1/models');
    assert.equal(init.method, 'GET'); assert.equal(init.body, undefined);
    return Response.json({ data: [{ id: 'a-catalog-model' }] });
  };
}

test('actual refresh changes only directory evidence, keeps manual deployment and cannot authorize a catalog-only invocation', async () => {
  const service = new FixtureService();
  const result = await service.refreshOfficialModelDiscovery(id);
  assert.equal(service.calls, 1); assert.equal(result.modelDiscoveryStatus, 'catalog_discovered');
  assert.equal(result.model, 'my-handwritten-deployment'); assert.equal(result.status, 'verified'); assert.equal(result.toolCapability, 'verified');
  assert.equal(result.discoveredModels[0].selectionMode, 'catalog_only');
  assert.equal(isDiscoveredInvocationAllowed(result, 'a-catalog-model'), false);
  assert.equal(isDiscoveredInvocationAllowed(result, 'my-handwritten-deployment'), true);
  assert.equal(isDiscoveredInvocationAllowed({ ...result, discoveredModels: [{ id: 'a-catalog-model', label: 'legacy' }] }, 'a-catalog-model'), false);
  assert.equal(isDiscoveredInvocationAllowed({ ...result, providerId: 'openai', discoveredModels: [{ id: 'a-catalog-model', label: 'legacy' }] }, 'a-catalog-model'), true);
});

test('read-only discovery failure exposes precise bounded manual fallback without downgrading inference credentials or leaking response text', async () => {
  for (const [status, failure] of [[401, 'authentication_failed'], [403, 'permission_denied'], [404, 'endpoint_unsupported'], [429, 'rate_limited'], [503, 'network_error']]) {
    const service = new FixtureService();
    service.networkFetch = async (_url, init) => { assert.equal(init.method, 'GET'); return new Response('sensitive upstream credential detail', { status }); };
    const result = await service.refreshOfficialModelDiscovery(id);
    assert.equal(result.modelDiscoveryFailure, failure); assert.equal(result.status, 'verified'); assert.equal(result.model, connection().model);
    assert.doesNotMatch(JSON.stringify(result), /sensitive upstream/);
  }
  const missing = new FixtureService(); missing.credentials.clear();
  const result = await missing.refreshOfficialModelDiscovery(id);
  assert.equal(result.modelDiscoveryFailure, 'credentials_missing'); assert.equal(missing.calls, 0);
  assert.equal(missing.connections.length, 1); assert.equal(result.model, connection().model);
});

test('unsupported native catalogs do not scan another project or use a generic-compatible provider request', async () => {
  for (const providerId of ['vertex', 'bedrock']) {
    const result = await discoverConnectionModels({ providerId, protocol: 'openai_chat_completions', baseUrl: 'https://fixture.example/v1', apiKey: 'fixture',
      fetchImpl: async () => assert.fail('unsupported control plane was requested') });
    assert.equal(result.modelDiscoveryStatus, 'unsupported'); assert.equal(result.modelDiscoveryFailure, 'endpoint_unsupported');
  }
});

for (const change of ['delete_self', 'edit_self', 'change_source', 'rotate_key']) test(`slow refresh cannot restore stale connection after ${change}`, async () => {
  const service = new FixtureService(); let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  service.networkFetch = async (_url, init) => {
    assert.equal(init.method, 'GET'); entered();
    await new Promise(resolve => { release = resolve; });
    return Response.json({ data: [{ id: 'old-key-catalog-model' }] });
  };
  const refreshing = service.refreshOfficialModelDiscovery(id); await started;
  if (change === 'delete_self') service.connections = [];
  if (change === 'edit_self') service.connections[0].model = 'replacement-deployment';
  if (change === 'change_source') service.connections[0].providerSettings = { credentialSource: 'environment' };
  if (change === 'rotate_key') service.credentials.set(id, 'new-key');
  const state = structuredClone(service.connections); release();
  await assert.rejects(refreshing, { code: 'CONNECTION_CHANGED' });
  assert.deepEqual(service.connections, state); assert.equal(service.writes, 0);
});

test('slow refresh merges the latest unrelated connections rather than replacing the whole index', async () => {
  const service = new FixtureService(); let release, entered;
  service.connections.push({ ...connection(), id: 'official-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', label: 'old label' });
  const started = new Promise(resolve => { entered = resolve; });
  service.networkFetch = async () => { entered(); await new Promise(resolve => { release = resolve; }); return Response.json({ data: [{ id: 'catalog' }] }); };
  const refreshing = service.refreshOfficialModelDiscovery(id); await started;
  service.connections[1].label = 'edited other connection';
  service.connections.push({ ...connection(), id: 'official-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', label: 'new other connection' });
  release(); await refreshing;
  assert.equal(service.connections.length, 3); assert.equal(service.connections[1].label, 'edited other connection');
  assert.equal(service.connections[2].label, 'new other connection'); assert.equal(service.connections[0].modelDiscoveryStatus, 'catalog_discovered');
});

test('loading old Azure catalog rows marks them catalog-only without dropping their manually configured connection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-azure-directory-'));
  try {
    await writeFile(join(root, 'official-connections-v1.json'), JSON.stringify([{ ...connection(), discoveredModels: [{ id: 'legacy-base', label: 'Legacy Base' }] }]));
    class DiskFixture extends NextMuxPlatformServiceImpl { nextmuxDataRoot() { return root; } }
    const service = new DiskFixture();
    const result = await service.readOfficialConnectionIndex();
    assert.equal(result.length, 1); assert.equal(result[0].model, connection().model);
    assert.equal(result[0].discoveredModels[0].selectionMode, 'catalog_only');
    const stored = JSON.parse(await readFile(join(root, 'official-connections-v1.json'), 'utf8'));
    assert.equal(stored[0].discoveredModels[0].selectionMode, 'catalog_only');
  } finally { await rm(root, { recursive: true, force: true }); }
});
