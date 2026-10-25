import assert from 'node:assert/strict';
import test from 'node:test';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { normalizePublicMerchantDirectory, publicMerchantDirectoryParameters } from '../lib/common/nextmux-public-merchants.js';

const page = (id = 'a') => ({ merchants: [{ id, name: `Merchant ${id}`, email: 'PRIVATE' }], measuredAt: new Date().toISOString(), private: 'PRIVATE' });
class Fixture extends NextMuxPlatformServiceImpl {
  requests = []; response = page();
  async request(path, options) { this.requests.push({ path, options }); return this.response; }
}

test('a rich global catalog above one MiB loads while ordinary responses retain their bounded limit', async () => {
  const service = new NextMuxPlatformServiceImpl();
  const payload = JSON.stringify({ offerings: [], measuredAt: new Date().toISOString(), padding: 'x'.repeat(1300000) });
  service.networkFetch = async () => new Response(payload, { headers: { 'content-type': 'application/json' } });
  assert.equal((await service.getCatalog()).online, true);
  await assert.rejects(service.request('/api/ordinary'));
  service.networkFetch = async () => new Response('x'.repeat(4 * 1024 * 1024 + 1));
  assert.equal((await service.getCatalog()).online, false, 'oversized catalogs remain bounded');
});

test('public pages have a strict bounded identity projection and safe query encoding', () => {
  assert.deepEqual(normalizePublicMerchantDirectory(page()).merchants, [{ id: 'a', name: 'Merchant a' }]);
  assert.doesNotMatch(JSON.stringify(normalizePublicMerchantDirectory(page())), /PRIVATE|email|private/);
  assert.equal(publicMerchantDirectoryParameters({ query: ' 世界 & 100% ', after: 'id-100' }).get('q'), '世界 & 100%');
  for (const value of [{ ...page(), merchants: Array.from({ length: 101 }, () => ({ id: 'a', name: 'A' })) },
    { ...page(), merchants: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] }, { ...page(), nextCursor: '../secret' },
    { ...page(), merchants: [{ id: 'a', name: 'x'.repeat(161) }] }]) assert.throws(() => normalizePublicMerchantDirectory(value));
  assert.throws(() => publicMerchantDirectoryParameters({ query: 'x'.repeat(161) }));
  assert.throws(() => publicMerchantDirectoryParameters({ before: 'a', after: 'b' }));
});

test('the desktop public page cache is bounded, short-lived and never requests account credentials', async () => {
  const service = new Fixture();
  const first = await service.getPublicMerchantDirectory(); await service.getPublicMerchantDirectory();
  assert.equal(service.requests.length, 1); assert.equal(service.requests[0].options.authenticated, false);
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE/);
  service.publicMerchantPages.get('limit=100').expiresAt = 0; await service.getPublicMerchantDirectory();
  assert.equal(service.requests.length, 2);
  for (let i = 0; i < 40; i++) await service.getPublicMerchantDirectory({ query: `query-${i}` });
  assert.equal(service.publicMerchantPages.size, 32);
  assert.ok(service.requests.every(row => row.path.startsWith('/api/merchants/public?')));
});

test('directory metrics whitelist real finite measurements and preserve observed zero', () => {
  const result = normalizePublicMerchantDirectory({ ...page(), merchants: [{ id: 'a', name: 'A', metrics: {
    quality: 0, availability: 0, latencyMs: 0, multiplierBps: 0, credentialId: 'PRIVATE'
  } }] });
  assert.deepEqual(result.merchants[0].metrics, { quality: 0, availability: 0, latencyMs: 0, multiplierBps: 0 });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|credentialId/);
  const unknown = normalizePublicMerchantDirectory({ ...page(), merchants: [{ id: 'a', name: 'A', metrics: {
    quality: 101, availability: 2, latencyMs: null, multiplierBps: -1
  } }] });
  assert.deepEqual(unknown.merchants[0].metrics, { quality: undefined, availability: undefined, latencyMs: undefined, multiplierBps: undefined });
});

test('server-global directory filters and distinct-model stats survive RPC normalization with independent API status', () => {
  const params = publicMerchantDirectoryParameters({ sort: 'quality', direction: 'desc', capability: 'coding', merchantIds: ['b','a','a'] });
  assert.deepEqual(params.getAll('merchantId'), ['a','b']); assert.equal(params.get('sort'), 'quality');
  const value = normalizePublicMerchantDirectory({ ...page(), totalCount: 19, capabilityScope: 'executable_offerings', merchants: [{ id: 'a', name: 'A',
    metrics: { quality: 75, availability: 0.8 }, stats: { discoveredCount: 428, executableCount: 15 }, outputCategories: ['text'], capabilities: ['tools'],
    apiStatus: { state: 'ready', lastCheckedAt: 1 }, measurement: { quality: { state: 'measured', sampleCount: 4 }, availability: { state: 'unknown', reason: 'measurement_not_enabled', sampleCount: 0 }, latency: { state: 'unknown', reason: 'measurement_not_enabled', sampleCount: 0 } } }] });
  assert.equal(value.totalCount, 19); assert.equal(value.merchants[0].apiStatus.state, 'ready');
  assert.equal(value.merchants[0].metrics.quality, 75); assert.equal(value.merchants[0].metrics.availability, 0.8);
  assert.equal(value.merchants[0].measurement.availability.state, 'unknown'); assert.deepEqual(value.merchants[0].stats, { discoveredCount: 428, executableCount: 15 });
  assert.throws(() => publicMerchantDirectoryParameters({ merchantIds: Array.from({length:101},(_,i)=>'m-'+i) }));
});

test('public merchant numbers are server-assigned, with old server omission preserved', () => {
  const value = { ...page(), merchants: [{ id: 'internal-id', name: 'Merchant', publicCode: 'RLY-0123456789ABCDEF' }] };
  assert.equal(normalizePublicMerchantDirectory(value).merchants[0].publicCode, 'RLY-0123456789ABCDEF');
  assert.equal(normalizePublicMerchantDirectory(page()).merchants[0].publicCode, undefined);
  assert.throws(() => normalizePublicMerchantDirectory({ ...value, merchants: [{ ...value.merchants[0], publicCode: 'RLY-client-hash' }] }));
});

test('concurrent same-page reads share a request; rejected or malformed results never become cached public identities', async () => {
  const service = new Fixture(); let complete, calls = 0;
  service.request = async () => { calls++; return new Promise(resolve => { complete = resolve; }); };
  const first = service.getPublicMerchantDirectory({ query: 'same' });
  const second = service.getPublicMerchantDirectory({ query: 'same' });
  complete(page()); assert.deepEqual(await first, await second); assert.equal(calls, 1);
  service.request = async () => ({ ...page(), merchants: [{ id: 'a', name: 'x'.repeat(161) }] });
  await assert.rejects(service.getPublicMerchantDirectory({ query: 'invalid' }));
  assert.equal(service.publicMerchantRequests.size, 0); assert.equal(service.publicMerchantPages.size, 1);
  service.request = async () => { throw new Error('PRIVATE_UPSTREAM'); };
  await assert.rejects(service.getPublicMerchantDirectory({ query: 'failed' }));
    assert.equal(service.publicMerchantPages.size, 1);
});
test('a failed favorites lookup never uses an incomplete catalog to declare saved merchants unavailable', async () => {
  const service = new Fixture();
  service.request = async path => {
    service.requests.push(path);
    if (path.startsWith('/api/merchants/public?')) throw new Error('directory temporarily unavailable');
    return { offerings: [{ merchantId: 'unrelated', providerName: 'Partial catalog merchant' }] };
  };
  await assert.rejects(service.getPublicMerchantDirectory({ merchantIds: ['saved-merchant'] }), /temporarily unavailable/);
  assert.equal(service.requests.length, 1);
  assert.equal(service.publicMerchantPages.size, 0);
  assert.equal(service.publicMerchantRequests.size, 0);
});

test('merchant model pages keep scope and quoted identity, use unauthenticated bounded cache and reject cross-merchant or nonadvancing pages', async () => {
  const service = new Fixture();
  service.response = { offerings: [{ id: 'model-100', merchantId: 'merchant-a', keyPriceQuoteId: `kq1_${'a'.repeat(64)}` }], nextCursor: 'model-100' };
  const first = await service.getMerchantCatalog('merchant-a');
  assert.equal(first.offerings[0].keyPriceQuoteId, `kq1_${'a'.repeat(64)}`);
  assert.equal(first.nextCursor, 'model-100'); assert.equal(first.merchantId, 'merchant-a');
  await service.getMerchantCatalog('merchant-a'); assert.equal(service.requests.length, 1);
  assert.equal(service.requests[0].options.authenticated, false);
  const query = new URL(`https://fixture.invalid${service.requests[0].path}`).searchParams;
  assert.equal(query.get('merchantId'), 'merchant-a'); assert.equal(query.get('limit'), '100');
  await assert.rejects(service.getMerchantCatalog('merchant-b'), /MERCHANT_CATALOG_INVALID|不兼容/);
  await assert.rejects(service.getMerchantCatalog('merchant-a', 'model-100'), /MERCHANT_CATALOG_INVALID|不兼容/);
  assert.equal(service.merchantCatalogPages.size, 1); assert.equal(service.merchantCatalogRequests.size, 0);
  service.response = { offerings: [], nextCursor: null };
  assert.equal((await service.getMerchantCatalog('merchant-empty')).offerings.length, 0);
  await assert.rejects(service.getMerchantCatalog(''));
});

test('the public catalog accepts quoted direct prices with null multiplier fields', async () => {
  const service = new Fixture();
  const quote = `kq1_${'a'.repeat(64)}`;
  service.response = { offerings: [{ id: 'direct-audio', merchantId: 'merchant-a', keyPriceQuoteId: quote,
    keyPrice: { pricingMode: 'direct', minimumMultiplierBps: null, maximumMultiplierBps: null,
      selectedMultiplierBps: null, quoteRequired: true } }] };
  const catalog = await service.getMerchantCatalog('merchant-a');
  assert.equal(catalog.offerings[0].keyPriceQuoteId, quote);
  assert.equal(catalog.offerings[0].keyPrice.pricingMode, 'direct');
});

test('scoped catalog preserves the optional discovery-pending signal and rejects malformed values', async () => {
  const service = new Fixture();
  service.response = { offerings: [], discoveryPending: true };
  assert.equal((await service.getMerchantCatalog('pending-merchant')).discoveryPending, true);
  service.response = { offerings: [], discoveryPending: false };
  assert.equal((await service.getMerchantCatalog('ready-merchant')).discoveryPending, false);
  service.response = { offerings: [], discoveryPending: 'yes' };
  await assert.rejects(service.getMerchantCatalog('malformed-merchant'), /MERCHANT_CATALOG_INVALID|不兼容/);
});

test('one offering the desktop cannot read is left out; the rest of the model list stays', async () => {
  const service = new Fixture();
  const good = { id: 'good', merchantId: 'merchant-a', keyPriceQuoteId: `kq1_${'a'.repeat(64)}` };
  const unreadable = { id: 'unreadable', merchantId: 'merchant-a', keyPriceQuoteId: `kq1_${'b'.repeat(64)}`,
    pricingDetails: { status: 'complete', currency: 'USD', quoteAt: 1, multiplierBps: 10000, dimensions: [{ metric: 'input_token', currency: 'USD',
      official: { unitSize: 1000000, amountMicros: 1, sourceType: 'a_source_from_the_future' }, user: null }] } };
  service.response = { offerings: [good, unreadable] };
  assert.deepEqual((await service.getMerchantCatalog('merchant-a')).offerings.map(offering => offering.id), ['good']);
  service.response = { offerings: [unreadable] };
  await assert.rejects(service.getMerchantCatalog('merchant-only-unreadable'), /CATALOG_INVALID|不兼容/, 'nothing readable at all is still a failure');
});
