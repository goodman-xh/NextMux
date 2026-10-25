import assert from 'node:assert/strict';
import test from 'node:test';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { normalizeMerchantDiscoveredModels } from '../lib/common/nextmux-merchant-discovered-models.js';
import { modelTaskCategories } from '@nextmux/model-runtime/model-task-capabilities';

const page = (model = 'vendor/model') => ({ merchantId: 'merchant', state: 'ready', measuredAt: new Date().toISOString(),
  models: [{ id: model, displayName: 'Model', input: ['text'], output: ['text'], capabilities: ['tools'], discoveredAt: 2,
    multiplierBps: 10000, listingIds: [], secret: 'PRIVATE' }], secret: 'PRIVATE' });
class Fixture extends NextMuxPlatformServiceImpl {
  requests = []; response = page();
  async request(path, options) { this.requests.push({ path, options }); return this.response; }
}

test('discovery metadata is whitelisted independently from executable quotations', () => {
  const result = normalizeMerchantDiscoveredModels(page(), 'merchant');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|secret/); assert.deepEqual(result.models[0].listingIds, []);
  assert.equal(result.models[0].id, 'vendor/model'); assert.equal(result.models[0].multiplierBps, 10000);
  for (const value of [{ ...page(), merchantId: 'other' }, { ...page(), nextCursor: 'non-last' },
    { ...page(), models: [page().models[0], page().models[0]] }, { ...page(), state: 'invented' }])
    assert.throws(() => normalizeMerchantDiscoveredModels(value, 'merchant'));
  assert.throws(() => normalizeMerchantDiscoveredModels(page(), 'merchant', 'vendor/model'));
});

test('selected merchant discovery uses bounded deduplicated public cache and slash cursor encoding', async () => {
  const service = new Fixture(); await service.getMerchantDiscoveredModels('merchant'); await service.getMerchantDiscoveredModels('merchant');
  assert.equal(service.requests.length, 1); assert.equal(service.requests[0].options.authenticated, false);
  await service.getMerchantDiscoveredModels('merchant', '', true); assert.equal(service.requests.length, 2);
  service.response = page('vendor/model-2'); await service.getMerchantDiscoveredModels('merchant', 'vendor/model-1');
  const query = new URL(`https://fixture.invalid${service.requests.at(-1).path}`).searchParams;
  assert.equal(query.get('after'), 'vendor/model-1');
  await assert.rejects(service.getMerchantDiscoveredModels('merchant', 'bad cursor'));
  service.response = { ...page(), merchantId: 'wrong' }; await assert.rejects(service.getMerchantDiscoveredModels('other'));
  assert.equal(service.merchantDiscoveredRequests.size, 0);
});

test('an empty alias-only scan page preserves its advancing cursor and reaches later models', async () => {
  const service = new Fixture();
  service.request = async path => {
    service.requests.push(path);
    const after = new URL(`https://fixture.invalid${path}`).searchParams.get('after');
    return after === 'a/alias' ? page('fixture/model') : { ...page(), models: [], nextCursor: 'a/alias' };
  };
  const models = []; let after = '';
  do {
    const result = await service.getMerchantDiscoveredModels('merchant', after);
    models.push(...result.models);
    after = result.nextCursor || '';
  } while (after);
  assert.deepEqual(models.map(model => model.id), ['fixture/model']);
  assert.equal(service.requests.length, 2);
  assert.match(service.requests[1], /after=a%2Falias/);
  assert.throws(() => normalizeMerchantDiscoveredModels({ ...page(), models: [], nextCursor: 'a/alias' }, 'merchant', 'a/alias'));
  assert.throws(() => normalizeMerchantDiscoveredModels({ ...page(), nextCursor: 'z/non-last' }, 'merchant'));
});

test('discovered task classifications survive normalization without granting execution metadata', () => {
  const input = page('future/recognizer');
  input.models[0] = { ...input.models[0], kind: 'transcription', taskCategories: ['transcription', 'invalid', 'transcription'],
    input: ['audio'], output: ['text'], capabilities: [], managedTransport: { protocol: 'PRIVATE' }, secret: 'PRIVATE' };
  const model = normalizeMerchantDiscoveredModels(input, 'merchant').models[0];
  assert.equal(model.kind, 'transcription');
  assert.deepEqual(model.taskCategories, ['transcription']);
  assert.deepEqual(modelTaskCategories(model), ['transcription']);
  assert.doesNotMatch(JSON.stringify(model), /PRIVATE|managedTransport|secret/);
  input.models[0] = { ...input.models[0], kind: 'future_kind', taskCategories: undefined };
  assert.deepEqual(modelTaskCategories(normalizeMerchantDiscoveredModels(input, 'merchant').models[0]), ['other']);
  input.models[0] = { ...input.models[0], id: 'google/deep-research-pro-preview-12-2025', kind: 'image', taskCategories: ['image'], output: ['image'] };
  assert.deepEqual(modelTaskCategories(normalizeMerchantDiscoveredModels(input, 'merchant').models[0]), ['language']);
});

test('pending or unavailable cache completes with an explicit reason without a fake empty discovery success', async () => {
  const service = new Fixture(); service.response = { ...page(), models: [], state: 'unavailable', reason: 'no_available_key' };
  assert.equal((await service.getMerchantDiscoveredModels('merchant')).reason, 'no_available_key');
  const waiters = new Fixture(); let release;
  waiters.request = () => new Promise(resolve => { release = resolve; });
  const first = waiters.getMerchantDiscoveredModels('merchant'), second = waiters.getMerchantDiscoveredModels('merchant');
  release(page()); assert.deepEqual(await first, await second); assert.equal(waiters.merchantDiscoveredPages.size, 1);
});

test('first-page cursor survives positional JSON-RPC serialization before the force argument', async () => {
  const service = new Fixture();
  const args = JSON.parse(JSON.stringify(['merchant', undefined, false]));
  assert.equal(args[1], null, 'JSON arrays replace omitted parameters with null');
  assert.equal((await service.getMerchantDiscoveredModels(...args)).models.length, 1);
  assert.equal(service.requests[0].path, '/api/merchants/public/merchant/models?limit=100');
  await service.getMerchantDiscoveredModels(...JSON.parse(JSON.stringify(['merchant', undefined, true])));
  assert.equal(service.requests.length, 2, 'forced retry uses the same valid first-page cursor');
  for (const invalid of [0, false, {}, []]) await assert.rejects(service.getMerchantDiscoveredModels('merchant', invalid));
});

test('both parallel model-picker requests survive the real first-page JSON-RPC argument shape', async () => {
  const service = new Fixture();
  service.request = async path => {
    service.requests.push(path);
    return path.startsWith('/api/catalog?') ? { offerings: [] } : page();
  };
  for (const force of [false, true]) {
    const args = JSON.parse(JSON.stringify(['merchant', undefined, force]));
    const [catalog, discovered] = await Promise.all([
      service.getMerchantCatalog(...args), service.getMerchantDiscoveredModels(...args)
    ]);
    assert.deepEqual(catalog.offerings, []);
    assert.equal(discovered.models.length, 1);
  }
  assert.equal(service.requests.length, 4, 'force refresh reaches both endpoints');
  assert.ok(service.requests.every(path => !path.includes('after=')));
  for (const invalid of [0, false, {}, []]) await assert.rejects(service.getMerchantCatalog('merchant', invalid));
});


test('capacity metadata survives desktop normalization while invalid fields stay unknown', () => {
  const input = page(); input.models[0] = { ...input.models[0], contextTokens: 128000, inputTokens: 120000, maximumOutputTokens: 16000 };
  const model = normalizeMerchantDiscoveredModels(input, 'merchant').models[0];
  assert.equal(model.contextTokens, 128000); assert.equal(model.inputTokens, 120000); assert.equal(model.maximumOutputTokens, 16000);
  input.models[0] = { ...input.models[0], contextTokens: '128000', inputTokens: null, maximumOutputTokens: -1 };
  const invalid = normalizeMerchantDiscoveredModels(input, 'merchant').models[0];
  assert.equal(invalid.contextTokens, undefined); assert.equal(invalid.inputTokens, undefined); assert.equal(invalid.maximumOutputTokens, undefined);
});


test('merchant audio family labels agree between cards and expanded model categories', async () => {
  const { merchantOutputCategories } = await import('@nextmux/model-runtime/merchant-modalities');
  const { modelCenterModelCategory } = await import('../lib/browser/nextmux-model-center-merchants.js');
  for (const kind of ['speech', 'music', 'sound_effect']) {
    assert.deepEqual(merchantOutputCategories([kind]), ['audio']);
    assert.equal(modelCenterModelCategory({ output: [kind], capabilities: [] }), 'audio');
  }
  assert.equal(modelCenterModelCategory({ output: ['text'], capabilities: ['vision'] }), 'language');
});
