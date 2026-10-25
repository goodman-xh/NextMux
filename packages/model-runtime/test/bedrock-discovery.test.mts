import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverOfficialModelCatalog, discoverOfficialModels, isInvokableDiscoveredModel, officialProviderPreset } from '../lib/index.js';
import { bedrockCatalogRequest } from '../lib/bedrock-discovery.js';

const base = { providerId: 'bedrock' as const, protocol: 'openai_chat_completions' as const,
  baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com', apiKey: 'synthetic-bearer-only' };

test('Bedrock reads one same-region control-plane GET using only bearer and never lists an inference profile as verified', async () => {
  let calls = 0;
  const catalog = await discoverOfficialModelCatalog({ ...base, fetchImpl: async (url, init) => {
    calls++; assert.equal(String(url), 'https://bedrock.us-east-1.amazonaws.com/foundation-models');
    assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined); assert.equal(init?.redirect, 'error');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), `Bearer ${base.apiKey}`);
    assert.deepEqual([...headers.keys()].sort(), ['accept', 'authorization']);
    return Response.json({ modelSummaries: [{ modelId: 'amazon.fixture-v1:0', modelName: 'Fixture', responseStreamingSupported: true,
      inputModalities: ['TEXT'], outputModalities: ['TEXT'], inferenceTypesSupported: ['ON_DEMAND'], modelArn: 'PRIVATE_ARN' }],
      nextToken: 'do-not-follow', nextPageToken: 'https://foreign.invalid/models' });
  } });
  assert.equal(calls, 1); assert.equal(catalog.catalogModels.length, 1);
  assert.equal(catalog.catalogModels[0].selectionMode, 'catalog_only'); assert.equal(isInvokableDiscoveredModel(catalog.catalogModels[0]), false);
  assert.equal(catalog.catalogModels[0].interfaceSupport, 'unknown'); assert.deepEqual(catalog.interfaceSupportedModels, []);
  assert.equal(catalog.interfaceUnverifiedModels.length, 1); assert.doesNotMatch(JSON.stringify(catalog), /PRIVATE_ARN|ON_DEMAND/);
  assert.equal(officialProviderPreset('bedrock')?.modelDiscovery, 'bedrock_catalog');
});

test('only API-key supported regions map to their own native control-plane hostname', async () => {
  for (const region of ['us-east-1', 'eu-west-1', 'ap-northeast-1', 'us-gov-west-1']) {
    let calls = 0;
    await discoverOfficialModels({ ...base, baseUrl: `https://bedrock-runtime.${region}.amazonaws.com/`, providerSettings: { region },
      fetchImpl: async url => { calls++; assert.equal(String(url), `https://bedrock.${region}.amazonaws.com/foundation-models`); return Response.json({ modelSummaries: [] }); } });
    assert.equal(calls, 1);
  }
});

test('custom, mismatched, private, non-root, FIPS, unknown and other-partition addresses fail before credentials or fetch', async () => {
  for (const patch of [
    { baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com.evil.invalid' },
    { baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com:8443' },
    { baseUrl: 'http://bedrock-runtime.us-east-1.amazonaws.com', allowInsecure: true },
    { baseUrl: 'https://bedrock-runtime.cn-north-1.amazonaws.com.cn' },
    { baseUrl: 'https://bedrock-runtime-fips.us-east-1.amazonaws.com' },
    { baseUrl: 'https://bedrock-runtime.eu-unknown-9.amazonaws.com' },
    { baseUrl: 'https://bedrock.us-east-1.amazonaws.com' },
    { baseUrl: `${base.baseUrl}/model/example` }, { baseUrl: `${base.baseUrl}/v1` },
    { baseUrl: `${base.baseUrl}?token=private` }, { baseUrl: `${base.baseUrl}#fragment` },
    { baseUrl: 'https://user:private@bedrock-runtime.us-east-1.amazonaws.com' },
    { baseUrl: 'https://127.0.0.1' }, { baseUrl: 'not a URL' },
    { providerSettings: { region: 'us-west-2' } }, { protocol: 'openai_responses' as const },
  ]) await assert.rejects(discoverOfficialModels({ ...base, ...patch, fetchImpl: async () => assert.fail('unsupported endpoint dispatched') }), { code: 'DISCOVERY_UNSUPPORTED' });
  const environment = { get AWS_BEARER_TOKEN_BEDROCK(): string { return assert.fail('unsupported endpoint read an environment credential'); } };
  assert.throws(() => bedrockCatalogRequest({ ...base, baseUrl: 'https://custom.invalid', providerSettings: { credentialSource: 'environment' } }, environment), { code: 'DISCOVERY_UNSUPPORTED' });
});

test('credential source is explicit, with synthetic environment injection and no static AWS or SSO lookup', () => {
  const untouched = { get AWS_BEARER_TOKEN_BEDROCK(): string { return assert.fail('API-key mode must not read environment'); } };
  assert.equal(bedrockCatalogRequest(base, untouched).apiKey, base.apiKey);
  assert.throws(() => bedrockCatalogRequest({ ...base, apiKey: '' }, untouched), { code: 'DISCOVERY_CREDENTIALS_MISSING' });
  assert.equal(bedrockCatalogRequest({ ...base, providerSettings: { credentialSource: 'environment' } }, { AWS_BEARER_TOKEN_BEDROCK: 'synthetic-environment' }).apiKey, 'synthetic-environment');
  const noBearer = new Proxy({}, { get(_target, key) { assert.equal(key, 'AWS_BEARER_TOKEN_BEDROCK', 'do not inspect AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, profile or files'); return undefined; } });
  assert.throws(() => bedrockCatalogRequest({ ...base, providerSettings: { credentialSource: 'environment' } }, noBearer), { code: 'DISCOVERY_UNSUPPORTED' });
  assert.throws(() => bedrockCatalogRequest({ ...base, providerSettings: { credentialSource: 'none' } }, untouched), { code: 'DISCOVERY_UNSUPPORTED' });
  for (const apiKey of ['bad\nkey', 'two tokens', 'x'.repeat(8193)]) assert.throws(() => bedrockCatalogRequest({ ...base, apiKey }, untouched), { code: 'INVALID_API_KEY' });
});

test('Vertex discovery always rejects before the generic models endpoint or ADC credentials can be used', async () => {
  for (const baseUrl of ['https://aiplatform.googleapis.com/v1/publishers/google', 'https://us-central1-aiplatform.googleapis.com/v1/projects/example/locations/us-central1/publishers/google', 'https://custom.invalid/v1']) {
    await assert.rejects(discoverOfficialModels({ providerId: 'vertex', protocol: 'gemini_generate_content', baseUrl, apiKey: '',
      providerSettings: { credentialSource: 'environment' }, fetchImpl: async () => assert.fail('unsupported Vertex catalog dispatched') }), { code: 'DISCOVERY_UNSUPPORTED' });
  }
});

test('Bedrock catalog is bounded, case-deduplicated, and ignores resource ARNs and unrelated capability claims', async () => {
  const rows = await discoverOfficialModels({ ...base, fetchImpl: async () => Response.json({ modelSummaries: [
    { modelId: 'amazon.first:0', modelName: 'Good name' }, { modelId: 'AMAZON.FIRST:0', modelName: 'Duplicate' },
    { modelId: 'amazon.second:0', modelName: 'hidden\u202ename' }, { modelId: 'https://foreign.invalid/model' },
    ...Array.from({ length: 2000 }, (_, index) => ({ modelId: `provider.model-${index}`, modelName: 'Model' }))] }) });
  assert.equal(rows.length, 512); assert.ok(rows.every(row => row.selectionMode === 'catalog_only' && !isInvokableDiscoveredModel(row)));
  assert.equal(rows.filter(row => row.id.toLowerCase() === 'amazon.first:0').length, 1);
  assert.equal(rows.find(row => row.id === 'amazon.first:0')?.label, 'Good name');
  assert.equal(rows.find(row => row.id === 'amazon.second:0')?.label, 'amazon.second:0');
  assert.doesNotMatch(JSON.stringify(rows), /foreign.invalid|\u202e/);
});

test('native malformed and oversized bodies are not misreported as an empty generic model list', async () => {
  for (const payload of [{ data: [{ id: 'generic-wrong' }] }, { publisherModels: [] }, { modelSummaries: {} }, { modelSummaries: [{ modelArn: 'only-arn' }] }]) {
    await assert.rejects(discoverOfficialModels({ ...base, fetchImpl: async () => Response.json(payload) }), { code: 'INVALID_RESPONSE' });
  }
  assert.deepEqual(await discoverOfficialModels({ ...base, fetchImpl: async () => Response.json({ modelSummaries: [] }) }), []);
  await assert.rejects(discoverOfficialModels({ ...base, fetchImpl: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) }), { code: 'RESPONSE_TOO_LARGE' });
});

test('HTTP errors retain status and safe details without switching origins or downgrading inference access', async () => {
  for (const status of [401, 403, 404, 429, 503]) {
    let calls = 0;
    await assert.rejects(discoverOfficialModels({ ...base, fetchImpl: async () => { calls++; return new Response('PRIVATE_AUTH_DIAGNOSTIC', { status }); } }), (error: any) => {
      assert.equal(error.httpStatus, status);
      assert.doesNotMatch(error.publicMessage, /PRIVATE_AUTH_DIAGNOSTIC/);
      assert.match(error.readableError.detail, /PRIVATE_AUTH_DIAGNOSTIC/);
      return true;
    });
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(discoverOfficialModels({ ...base, fetchImpl: async (_url, init) => { calls++; assert.equal(init?.redirect, 'error'); throw new TypeError('redirect denied'); } }));
  assert.equal(calls, 1);
});

test('cancellation before dispatch or while returning a catalog never publishes stale results', async () => {
  const before = new AbortController(); before.abort();
  await assert.rejects(discoverOfficialModels({ ...base, signal: before.signal, fetchImpl: async () => assert.fail('pre-cancelled request dispatched') }), { code: 'CANCELLED' });
  const during = new AbortController(); let calls = 0;
  await assert.rejects(discoverOfficialModels({ ...base, signal: during.signal, fetchImpl: async () => {
    calls++; during.abort(); return Response.json({ modelSummaries: [{ modelId: 'must-not-publish' }] });
  } }), { code: 'CANCELLED' });
  assert.equal(calls, 1);
});

test('a timed-out catalog is classified separately from user cancellation and never retried', async () => {
  let calls = 0;
  await assert.rejects(discoverOfficialModels({ ...base, timeoutMs: 1_000, fetchImpl: async (_url, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
  } }), (error: any) => { assert.equal(error.code, 'TIMEOUT'); assert.equal(error.category, 'timeout'); return true; });
  assert.equal(calls, 1);
});
