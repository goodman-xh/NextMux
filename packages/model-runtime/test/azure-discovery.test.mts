import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverOfficialModelCatalog, discoverOfficialModels, isInvokableDiscoveredModel, officialProviderPreset } from '../lib/index.js';

const base = { providerId: 'azure_openai' as const, protocol: 'openai_responses' as const,
  baseUrl: 'https://fixture.openai.azure.com/openai/v1', apiKey: 'fixture-azure-key' };

test('Azure directory is one same-resource GET with native header and catalog-only identifiers, never inference', async () => {
  let calls = 0;
  const catalog = await discoverOfficialModelCatalog({ ...base, fetchImpl: async (url, init) => {
    calls++; assert.equal(String(url), `${base.baseUrl}/models`);
    assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined); assert.equal(init?.redirect, 'error');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('api-key'), base.apiKey); assert.equal(headers.has('authorization'), false);
    return Response.json({ data: [{ id: 'base-model', capability: 'not-trusted' }, { id: 'base-model' }, { id: 'second-model' }] });
  } });
  assert.equal(calls, 1); assert.equal(catalog.catalogModels.length, 2);
  assert.ok(catalog.catalogModels.every(model => model.selectionMode === 'catalog_only' && !isInvokableDiscoveredModel(model)));
  assert.deepEqual(catalog.interfaceSupportedModels, []); assert.equal(catalog.interfaceUnverifiedModels.length, 2);
  const rows = await discoverOfficialModels({ ...base, fetchImpl: async () => Response.json({ data: [{ id: 'base-model' }] }) });
  assert.deepEqual(rows, [{ id: 'base-model', label: 'base-model', selectionMode: 'catalog_only' }]);
});

test('environment credentials are read only when explicitly selected and cannot silently replace an empty API-key source', async () => {
  const previous = process.env.AZURE_API_KEY;
  process.env.AZURE_API_KEY = 'fixture-environment-key';
  try {
    let calls = 0;
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls++; assert.equal(new Headers(init?.headers).get('api-key'), 'fixture-environment-key');
      return Response.json({ data: [] });
    };
    await assert.rejects(discoverOfficialModels({ ...base, apiKey: '', fetchImpl }), { code: 'DISCOVERY_CREDENTIALS_MISSING' });
    assert.equal(calls, 0);
    await discoverOfficialModels({ ...base, apiKey: '', providerSettings: { credentialSource: 'environment' }, fetchImpl });
    assert.equal(calls, 1);
    delete process.env.AZURE_API_KEY;
    await assert.rejects(discoverOfficialModels({ ...base, providerSettings: { credentialSource: 'environment' }, fetchImpl }), { code: 'DISCOVERY_CREDENTIALS_MISSING' });
    assert.equal(calls, 1, 'an environment connection must not fall back to the supplied API key');
  } finally { if (previous === undefined) delete process.env.AZURE_API_KEY; else process.env.AZURE_API_KEY = previous; }
});

test('legacy, custom, sovereign-unverified and deployment URLs fall back manually without fetching another cloud origin', async () => {
  for (const patch of [
    { baseUrl: 'https://fixture.openai.azure.com/openai' },
    { baseUrl: 'https://fixture.openai.azure.com/openai/deployments/my-alias' },
    { baseUrl: 'https://fixture.openai.azure.com/openai/v1', providerSettings: { useDeploymentBasedUrls: true } },
    { providerSettings: { apiVersion: '2024-10-21' } },
    { baseUrl: 'https://fixture.openai.azure.us/openai/v1' },
    { baseUrl: 'https://fixture.openai.azure.com.attacker.example/openai/v1' },
    { baseUrl: 'https://fixture.openai.azure.com:8443/openai/v1' },
    { baseUrl: 'https://management.azure.com/openai/v1' },
  ]) await assert.rejects(discoverOfficialModels({ ...base, ...patch, fetchImpl: async () => assert.fail('unsupported catalog dispatched') }), { code: 'DISCOVERY_UNSUPPORTED' });
});

test('Azure preserves exact HTTP failure status without exposing non-JSON error bodies', async () => {
  for (const status of [401, 403, 404, 429, 503]) {
    await assert.rejects(discoverOfficialModels({ ...base,
      fetchImpl: async () => new Response('private credential diagnostic', { status }) }), (error: any) => {
      assert.equal(error.httpStatus, status); assert.doesNotMatch(error.message, /private credential diagnostic/); return true;
    });
  }
});

test('Azure bounds rows and success bodies and rejects malformed directories without claiming model support', async () => {
  const rows = await discoverOfficialModels({ ...base, fetchImpl: async () => Response.json({ data: Array.from({ length: 2000 }, (_, i) => ({ id: `base-${i}` })) }) });
  assert.equal(rows.length, 512); assert.ok(rows.every(row => row.selectionMode === 'catalog_only'));
  await assert.rejects(discoverOfficialModels({ ...base, fetchImpl: async () => Response.json({ unexpected: [] }) }), { code: 'INVALID_RESPONSE' });
  await assert.rejects(discoverOfficialModels({ ...base, fetchImpl: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) }), { code: 'RESPONSE_TOO_LARGE' });
});

test('cancelled Azure discovery never dispatches and transport redirect errors never fall back to another address', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(discoverOfficialModels({ ...base, signal: controller.signal, fetchImpl: async () => assert.fail('cancelled request dispatched') }), { code: 'CANCELLED' });
  let calls = 0;
  await assert.rejects(discoverOfficialModels({ ...base, fetchImpl: async (_url, init) => {
    calls++; assert.equal(init?.redirect, 'error'); throw new TypeError('redirect not allowed');
  } }));
  assert.equal(calls, 1);
});

test('catalog selection keeps legacy invocation IDs but requires manual Azure deployment names; Bedrock text matches installed auth', () => {
  assert.equal(isInvokableDiscoveredModel({}), true);
  assert.equal(isInvokableDiscoveredModel({ selectionMode: 'invokable' }), true);
  assert.equal(isInvokableDiscoveredModel({ selectionMode: 'catalog_only' }), false);
  assert.equal(officialProviderPreset('azure_openai')?.defaultModel, '');
  assert.deepEqual(officialProviderPreset('azure_openai')?.suggestedModels, []);
  const note = officialProviderPreset('bedrock')!.connectionNote;
  assert.match(note, /AWS_ACCESS_KEY_ID/); assert.match(note, /尚未接入.*SSO/); assert.doesNotMatch(note, /默认凭据链/);
});
