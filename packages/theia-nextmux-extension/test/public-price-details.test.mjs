import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizePublicPriceDetails } from '../lib/common/nextmux-public-price-details.js';
test('price evidence keeps exact units, singular metrics and official vs retail values across JSON RPC', () => {
  const source = { status:'complete', currency:'USD', quoteAt:1, multiplierBps:12500, dimensions:[{metric:'input_token',currency:'USD',official:{unitSize:1000000,amountMicros:10,sourceType:'catalog_reference',sourceUrl:'https://example.invalid/pricing'},user:{unitSize:1000000,amountMicros:13}}] };
  assert.deepEqual(normalizePublicPriceDetails(JSON.parse(JSON.stringify(source))),source);
  assert.equal(normalizePublicPriceDetails({...source,multiplierBps:null}).multiplierBps,null);
  assert.throws(()=>normalizePublicPriceDetails({...source,dimensions:[{...source.dimensions[0],metric:'input_tokens'}]}));
  assert.throws(()=>normalizePublicPriceDetails({...source,dimensions:[{...source.dimensions[0],official:{...source.dimensions[0].official,amountMicros:null}}]}));
});

const variants = JSON.parse(readFileSync(new URL('./fixtures/public-official-variant-prices.json', import.meta.url), 'utf8'));
test('production official variant quotes remain usable with cache ceilings and bounded provenance', () => {
  for (const { pricingDetails: source } of variants) {
    const result = normalizePublicPriceDetails(JSON.parse(JSON.stringify(source)));
    assert.deepEqual(result.dimensions, source.dimensions);
    assert.equal(result.status, 'complete');
    assert.ok(result.dimensions.every(row => row.official.sourceType === 'official_variant'));
  }
  assert.equal(variants.find(row => row.canonicalModel === 'openai/gpt-6-astra').pricingDetails.dimensions.some(row => row.metric === 'cache_write_token'), true);
  assert.equal(variants[0].pricingDetails.dimensions.find(row => row.metric === 'cached_input_token').official.referencePriceVariantId, undefined,
    'equivalent cache TTLs legitimately do not identify one variant');
});

test('malformed official variants cannot bypass source, dimensions or safe money validation', () => {
  const source = variants.find(row => row.canonicalModel === 'openai/gpt-6-astra').pricingDetails;
  const original = source.dimensions[0].official;
  for (const patch of [
    { sourceType: 'made_up' }, { sourceUrl: undefined }, { sourceUrl: 'https://' }, { sourceUrl: 'https://secret@fixture.invalid/pricing' },
    { sourceUrl: 'javascript:alert(1)' }, { amountMicros: -1 }, { amountMicros: Number.MAX_SAFE_INTEGER + 1 }, { unitSize: 0 },
    { referencePriceVariantId: '' }, { referencePriceVariantId: 'x'.repeat(161) }, { dimensions: null }, { dimensions: [] },
    { dimensions: { ...original.dimensions, arbitrary: 'unsupported' } }, { dimensions: { ...original.dimensions, region: {} } },
    { dimensions: { ...original.dimensions, prompt_min_tokens: 5, prompt_max_tokens: 4 } },
    { dimensions: { ...original.dimensions, prompt_max_tokens: Number.MAX_SAFE_INTEGER + 1 } },
    { dimensions: { ...original.dimensions, prompt_max_tokens: original.dimensions.context_max_tokens + 1 } },
    { dimensions: { ...original.dimensions, context_max_tokens: -1 } }
  ]) assert.throws(() => normalizePublicPriceDetails({ ...source, dimensions: [{ ...source.dimensions[0], official: { ...original, ...patch } }] }), /PUBLIC_PRICE_DETAILS_INVALID/);
});

test('every official price source the platform publishes is readable by the desktop (a new one once emptied the model list)', async () => {
  const { publicPriceDetails } = await import('../../../apps/cloudflare-platform/src/public-price-details.js');
  const platform = readFileSync(new URL('../../../apps/cloudflare-platform/src/public-price-details.js', import.meta.url), 'utf8');
  const published = JSON.parse(/\.includes\(source\.sourceType\)/.test(platform) ? platform.match(/(\[[^\]]*'official_charge_contract'[^\]]*\])\.includes\(source\.sourceType\)/)[1].replace(/'/g, '"') : '[]');
  assert.ok(published.length >= 4);
  for (const sourceType of published) {
    const official = { unitSize: 1000000, amountMicros: 4000000, sourceType, sourceUrl: 'https://models.dev/api.json',
      ...(sourceType === 'official_charge_contract' ? { chargeContractId: 'occ-5e83b24e-2b77-4ec7-b591-c2f82c8ccb86' } : {}) };
    const details = publicPriceDetails({ price: { currency: 'USD', mode: 'multiplier', multiplierBps: 10000, rateBasis: 'maximum_context_tier',
      inputPerMillionMicros: 4000000, outputPerMillionMicros: 18000000 },
      official: { input_token: official, output_token: { ...official, amountMicros: 18000000 } }, quoteAt: 1790718209603, category: 'coding' });
    const read = normalizePublicPriceDetails(JSON.parse(JSON.stringify(details)));
    assert.equal(read.dimensions[0].official.sourceType, sourceType);
    if (sourceType === 'official_charge_contract') assert.equal(read.dimensions[0].official.chargeContractId, 'occ-5e83b24e-2b77-4ec7-b591-c2f82c8ccb86');
  }
  const contract = { status: 'complete', currency: 'USD', quoteAt: 1, multiplierBps: 10000, dimensions: [{ metric: 'input_token', currency: 'USD',
    official: { unitSize: 1000000, amountMicros: 1, sourceType: 'official_charge_contract', chargeContractId: 'bad id with spaces' }, user: null }] };
  assert.throws(() => normalizePublicPriceDetails(contract), /PUBLIC_PRICE_DETAILS_INVALID/);
});


test('video per-input-image price evidence survives catalog normalization in exact each-image units', () => {
  const source = { status: 'complete', currency: 'USD', quoteAt: 1, multiplierBps: 10_000, dimensions: [
    { metric: 'video_second', currency: 'USD', official: { unitSize: 1, amountMicros: 130_000, sourceType: 'official_charge_contract' }, user: { unitSize: 1, amountMicros: 130_000 } },
    { metric: 'video_input_image', currency: 'USD', official: { unitSize: 1, amountMicros: 40_000, sourceType: 'official_charge_contract' }, user: { unitSize: 1, amountMicros: 40_000 } }
  ] };
  assert.deepEqual(normalizePublicPriceDetails(JSON.parse(JSON.stringify(source))), source);
  assert.throws(() => normalizePublicPriceDetails({ ...source, dimensions: [{ ...source.dimensions[1], user: { unitSize: 2, amountMicros: 40_000 } }] }), /PUBLIC_PRICE_DETAILS_INVALID/u);
});
