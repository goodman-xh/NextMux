import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import test from 'node:test';
import { loadCurrentSource } from './helpers/current-source-loader.mjs';

// The test runner isolates this file in its own process. Wire the source reader
// into the source service in memory, preserving all generated files on disk.
const readerSource = loadCurrentSource(new URL('../src/node/nextmux-merchant-support-reader.ts', import.meta.url));
const { MerchantSupportCatalogReader, normalizeSupportQuery } = readerSource;
const require = createRequire(import.meta.url);
const readerFilename = require.resolve('../lib/node/nextmux-merchant-support-reader.js');
const readerModule = new Module(readerFilename);
readerModule.filename = readerFilename;
readerModule.exports = readerSource;
readerModule.loaded = true;
require.cache[readerFilename] = readerModule;
await import('./helpers/platform-service-source-loader.mjs');
const { NextMuxPlatformServiceImpl: SupportServiceHarness } = await import('../lib/node/nextmux-platform-service.js');

async function settleRetries(t, pending) {
    let outcome;
    // Handle rejection immediately so the deliberately failing stale-cache
    // assertion reports the missing behavior, never an unhandled rejection.
    pending.then(value => { outcome = { value }; }, error => { outcome = { error }; });
    for (let turn = 0; turn < 10 && !outcome; turn++) {
        await new Promise(resolve => setImmediate(resolve));
        t.mock.timers.runAll();
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(outcome, 'transient retry must settle within a finite retry budget');
    return outcome;
}

const row = (id, extra = {}) => ({ id: String(id), merchantId: 'merchant', displayName: `GPT-${id}`, canonicalModel: `openai/gpt-${id}`,
    registryModelId: `registry-${id}`, modelFamily: 'GPT', providerModelCode: `gpt-${id}`, output: ['text'], status: 'active', ...extra });
const rawPage = (offerings, extra = {}) => ({ merchantId: 'merchant', displayOnly: true, snapshotVersion: 'version-1', matchedOfferingCount: offerings.length, offerings, ...extra });
const setup = (request, legacyPage = async () => { throw new Error('legacy must not run'); }, now) => new MerchantSupportCatalogReader({ request, legacyPage, normalize: rows => rows, now });

test('support query is bounded, NFKC/case/whitespace normalized; cursors remain opaque', () => {
    assert.deepEqual(normalizeSupportQuery('merchant', { search: '  ＧＰＴ4  中文 ' }), { search: 'gpt4 中文', category: 'all' });
    for (const query of [{ search: 'x'.repeat(121) }, { category: 'unknown' }, { after: '../secret' }, { search: 3 }]) {
        assert.throws(() => normalizeSupportQuery('merchant', query));
    }
});

test('shared pending and bounded page cache never carry executable quote metadata', async () => {
    let resolve, calls = 0;
    const reader = setup(async () => { calls++; return new Promise(done => { resolve = done; }); });
    const first = reader.read('merchant', { search: 'GPT4' });
    const second = reader.read('merchant', { search: 'gpt4' });
    resolve(rawPage([row(1, { keyPriceQuoteId: 'quote-secret', keyPrice: {}, canvasCapabilities: {} })]));
    assert.deepEqual(await first, await second);
    assert.equal(calls, 1);
    assert.equal((await reader.read('merchant', { search: 'gpt4' })).offerings[0].keyPriceQuoteId, undefined);
    assert.equal(reader.pages.size, 1);
    reader.dependencies.request = async () => rawPage([]);
    for (let i = 0; i < 40; i++) await reader.read('merchant', { search: String(i) });
    assert.equal(reader.pages.size, 32);
});

test('support pages stay cached for 60 seconds and refresh at the exact TTL boundary', async () => {
    let clock = 10_000, requests = 0;
    const reader = setup(async () => rawPage([row(++requests)], { snapshotVersion: `version-${requests}` }), undefined, () => clock);
    const first = await reader.read('merchant', { search: 'GPT' });
    clock += 59_999;
    assert.deepEqual(await reader.read('merchant', { search: 'gpt' }), first);
    assert.equal(requests, 1, 'a normalized query reuses the page until the full 60-second TTL expires');

    clock++;
    const refreshed = await reader.read('merchant', { search: 'gpt' });
    assert.equal(requests, 2);
    assert.equal(refreshed.offerings[0].id, '2');
    clock += 59_999;
    assert.deepEqual(await reader.read('merchant', { search: 'gpt' }), refreshed);
    assert.equal(requests, 2, 'a successful refresh starts a new full TTL');

    const forced = await reader.read('merchant', { search: 'gpt' }, true);
    assert.equal(requests, 3, 'explicit refresh bypasses a still-fresh display page');
    assert.equal(forced.offerings[0].id, '3');
});

test('the support service retries transient failures before returning a successful page', async t => {
    // Retry belongs to the service dependency injected into the reader, so exercise
    // the actual public entry point instead of teaching the fixture to retry.
    for (const [name, details] of [
        ['HTTP 502', { status: 502 }], ['HTTP 503', { status: 503 }],
        ['HTTP 504', { httpStatus: 504 }], ['HTTP 429 through RPC data', { data: { httpStatus: 429 } }],
        ['catalog refreshing', { code: 'merchant_catalog_refreshing' }],
        ['platform timeout', { messageKey: 'PLATFORM_TIMEOUT' }]
    ]) {
        await t.test(name, async t => {
            t.mock.timers.enable({ apis: ['setTimeout'] });
            const service = new SupportServiceHarness();
            const requests = [];
            service.getMerchantCatalog = async () => assert.fail('a transient error must not trigger a legacy full scan');
            service.request = async (path, options) => {
                requests.push({ path, options });
                if (requests.length === 1) throw Object.assign(new Error('temporary interruption'), details);
                return rawPage([row('recovered', { workbenches: ['coding'] })]);
            };
            const pending = service.getMerchantSupportCatalog('merchant', { search: 'gpt' });
            await new Promise(resolve => setImmediate(resolve));
            t.mock.timers.runAll();
            assert.equal((await pending).offerings[0].id, 'recovered');
            assert.equal(requests.length, 2, 'the same read retries its failed request and stops after success');
            assert.deepEqual(requests[1], requests[0], 'retry preserves the merchant, query and request options');
            assert.equal((await service.getMerchantSupportCatalog('merchant', { search: 'gpt' })).offerings[0].id, 'recovered');
            assert.equal(requests.length, 2, 'the recovered page is admitted to the display cache');
        });
    }
});

test('expired support pages fall back to the last successful display page after transient retries are exhausted', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const service = new SupportServiceHarness();
    let clock = 10_000, requests = 0;
    service.merchantSupportReader.now = () => clock;
    service.getMerchantCatalog = async () => assert.fail('an outage must not trigger a legacy full scan');
    service.request = async () => {
        if (++requests > 1) throw Object.assign(new Error('temporary catalog outage'), { status: 503 });
        return rawPage([row('cached', { workbenches: ['coding'] })]);
    };
    const cached = await service.getMerchantSupportCatalog('merchant');
    clock += 60_000;
    const outcome = await settleRetries(t, service.getMerchantSupportCatalog('merchant'));
    assert.equal(requests, 4, 'the expired page is refreshed with one attempt and two bounded retries');
    assert.equal(service.merchantSupportReader.pending.size, 0, 'failed refresh releases the shared pending read');
    assert.deepEqual(outcome, { value: cached }, 'a transient refresh failure should preserve the last readable display page');
});

test('exhausted transient retries propagate the original error when no cached page exists', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const service = new SupportServiceHarness();
    const failure = Object.assign(new Error('temporary catalog outage'), { status: 503 });
    let requests = 0;
    service.request = async () => { requests++; throw failure; };
    service.getMerchantCatalog = async () => assert.fail('an outage must not trigger a legacy full scan');
    const outcome = await settleRetries(t, service.getMerchantSupportCatalog('merchant'));
    assert.equal(outcome.error, failure, 'there is no successful display page with which to mask the exhausted failure');
    assert.equal(requests, 3, 'one request and two retries form the bounded retry budget');
    assert.equal(service.merchantSupportReader.pages.size, 0);
    assert.equal(service.merchantSupportReader.pending.size, 0);

    service.request = async () => rawPage([row('recovered', { workbenches: ['coding'] })]);
    assert.equal((await service.getMerchantSupportCatalog('merchant')).offerings[0].id, 'recovered', 'a later read is not poisoned by the rejected pending request');
});

test('transient support failures fall back to known active catalog offerings for the merchant when no cached display page exists', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const service = new SupportServiceHarness();
    service.contextCatalogOfferings = [row('catalog-fallback', { workbenches: ['coding'], keyPriceQuoteId: 'quote-1' })];
    service.request = async () => {
        throw Object.assign(new Error('temporary catalog outage'), { status: 503 });
    };
    const outcome = await settleRetries(t, service.getMerchantSupportCatalog('merchant'));
    assert.equal(outcome.error, undefined);
    assert.equal(outcome.value.offerings.length, 1);
    assert.equal(outcome.value.offerings[0].id, 'catalog-fallback');
    assert.equal(outcome.value.offerings[0].keyPriceQuoteId, undefined, 'fallback projection strips quote authorization');
});

test('permanent support failures neither retry nor hide behind an expired display page', async () => {
    for (const details of [{ status: 401 }, { status: 403 }, { status: 404, code: 'merchant_not_found' },
        { status: 409, code: 'merchant_catalog_cursor_stale' }]) {
        const service = new SupportServiceHarness();
        let clock = 10_000, requests = 0;
        service.merchantSupportReader.now = () => clock;
        const failure = Object.assign(new Error('permanent support failure'), details);
        service.request = async () => {
            if (++requests > 1) throw failure;
            return rawPage([row('cached', { workbenches: ['coding'] })]);
        };
        service.getMerchantCatalog = async () => assert.fail('a permanent failure must not trigger a legacy full scan');
        await service.getMerchantSupportCatalog('merchant');
        clock += 60_000;
        await assert.rejects(service.getMerchantSupportCatalog('merchant'), error =>
            details.code === 'merchant_catalog_cursor_stale' ? error.message === 'SUPPORT_CURSOR_STALE' : error === failure);
        assert.equal(requests, 2, `HTTP ${details.status} must fail without retrying or returning stale data`);
    }
});

test('old platform fallback searches the complete catalog once; later queries/scroll are local', async () => {
    let remote = 0, legacy = 0;
    const source = Array.from({ length: 205 }, (_, i) => row(String(i).padStart(4, '0')));
    source[204] = row('0204', { displayName: 'GPT-4.1 中文视频', output: ['video'] });
    const reader = setup(async () => { remote++; throw Object.assign(new Error('old server'), { status: 404 }); }, async (_, after) => {
        legacy++; const offset = after ? Number(after) : 0;
        return { merchantId: 'merchant', online: true, offerings: source.slice(offset, offset + 100),
            ...(offset + 100 < source.length ? { nextCursor: String(offset + 100).padStart(4, '0') } : {}) };
    });
    const target = await reader.read('merchant', { search: 'ＧＰＴ4 中文', category: 'video' });
    assert.deepEqual(target.offerings.map(item => item.id), ['0204']);
    assert.equal(legacy, 3); assert.equal(remote, 1);
    const first = await reader.read('merchant');
    const second = await reader.read('merchant', { after: first.nextCursor });
    const third = await reader.read('merchant', { after: second.nextCursor });
    assert.deepEqual([first.offerings.length, second.offerings.length, third.offerings.length], [100, 100, 5]);
    assert.equal(legacy, 3); assert.equal(remote, 1);
    await assert.rejects(reader.read('merchant', { search: 'changed', after: first.nextCursor }), /SUPPORT_CURSOR_STALE/);
    assert.equal((await reader.read('merchant', { search: '%' })).offerings.length, 0);
    assert.equal((await reader.read('merchant', { search: '_' })).offerings.length, 0);
});

test('legacy support search uses authoritative kinds across all pages without losing original modalities', async () => {
    let legacy = 0;
    const source = Array.from({ length: 205 }, (_, i) => row(String(i).padStart(4, '0'), { kind: 'llm' }));
    for (const index of [0, 204]) source[index] = row(String(index).padStart(4, '0'), {
        displayName: index ? 'GPT-5.5 Pro' : 'GPT-5.5', canonicalModel: index ? 'openai/gpt-5.5-pro' : 'openai/gpt-5.5',
        kind: 'llm', category: 'coding', output: ['text', 'image'], capabilities: ['tools', 'reasoning', 'vision']
    });
    source[100] = row('0100', { displayName: 'GPT Image', kind: 'image', output: ['text', 'image'] });
    source[101] = row('0101', { kind: 'video', output: ['video', 'audio'] });
    source[102] = row('0102', { kind: 'speech', output: ['audio'] });
    source[103] = row('0103', { output: ['image'] }); // Older servers may omit kind.
    const reader = setup(async () => { throw Object.assign(new Error('old server'), { status: 404 }); }, async (_, after) => {
        legacy++;
        const offset = Number(after || 0);
        return { merchantId: 'merchant', offerings: source.slice(offset, offset + 100),
            ...(offset + 100 < source.length ? { nextCursor: String(offset + 100).padStart(4, '0') } : {}) };
    });
    const first = await reader.read('merchant', { category: 'language' });
    const second = await reader.read('merchant', { category: 'language', after: first.nextCursor });
    const third = await reader.read('merchant', { category: 'language', after: second.nextCursor });
    assert.deepEqual([first.offerings.length, second.offerings.length, third.offerings.length], [100, 100, 1]);
    const language = [...first.offerings, ...second.offerings, ...third.offerings];
    assert.equal(new Set(language.map(item => item.id)).size, 201);
    assert.equal(third.nextCursor, undefined);
    const gpt = await reader.read('merchant', { category: 'language', search: 'gpt55' });
    assert.deepEqual(gpt.offerings.map(item => item.id), ['0000', '0204']);
    assert.ok(gpt.offerings.every(item => item.kind === 'llm'));
    assert.deepEqual(gpt.offerings.map(item => item.output), [['text', 'image'], ['text', 'image']]);
    assert.deepEqual((await reader.read('merchant', { category: 'image', search: 'gpt55' })).offerings.map(item => item.id), ['0000', '0204']);
    assert.deepEqual((await reader.read('merchant', { category: 'image' })).offerings.map(item => item.id), ['0000', '0100', '0103', '0204']);
    assert.deepEqual((await reader.read('merchant', { category: 'video' })).offerings.map(item => item.id), ['0101']);
    assert.deepEqual((await reader.read('merchant', { category: 'audio' })).offerings.map(item => item.id), ['0102']);
    assert.equal(legacy, 3, 'classification and search must reuse the existing bounded snapshot');
});

test('overload and malformed successful responses never trigger a legacy full scan', async () => {
    for (const request of [async () => { throw Object.assign(new Error('busy'), { status: 503 }); }, async () => rawPage([row(1, { merchantId: 'other' })]),
        async () => rawPage([row(1), row(1)]), async () => rawPage([row(1)], { nextCursor: 'cursor' })]) {
        let legacy = 0;
        const reader = setup(request, async () => { legacy++; return {}; });
        await assert.rejects(reader.read('merchant', { after: 'cursor' })); assert.equal(legacy, 0);
    }
});

test('changed catalog invalidates an in-flight response and never reuses a stale cursor', async () => {
    let resolve;
    const reader = setup(async () => new Promise(done => { resolve = done; }));
    const pending = reader.read('merchant');
    reader.invalidate('new');
    resolve(rawPage([row(1)]));
    await assert.rejects(pending, /SUPPORT_CURSOR_STALE/);
    assert.equal(reader.pages.size, 0); assert.equal(reader.pending.size, 0);
});

test('legacy stalled or unbounded pagination is a visible failure, never a truncated success', async () => {
    let calls = 0;
    const reader = setup(async () => { throw Object.assign(new Error('old'), { status: 404 }); }, async () => {
        calls++; return { merchantId: 'merchant', offerings: [row('0001')], nextCursor: '0001' };
    });
    await assert.rejects(reader.read('merchant'), /SNAPSHOT_INCOMPLETE/);
    assert.equal(calls, 2); assert.equal(reader.snapshots.size, 0);
});

test('concurrent distinct searches on old servers share one catalog snapshot', async () => {
    let release, legacy = 0;
    const reader = setup(async () => { throw Object.assign(new Error('old'), { status: 404 }); }, async () => {
        legacy++; await new Promise(done => { release = done; }); return { merchantId: 'merchant', offerings: [row(1)] };
    });
    const first = reader.read('merchant', { search: 'gpt' });
    const second = reader.read('merchant', { search: 'no-match' });
    await new Promise(done => setImmediate(done)); release();
    assert.equal((await first).offerings.length, 1); assert.equal((await second).offerings.length, 0);
    assert.equal(legacy, 1);
});

test('display projection preserves the selected multiplier without keeping quote authorization', async () => {
    const reader = setup(async () => rawPage([row(1, { multiplierBps: 10000, price: { mode: 'reference_multiplier', multiplierBps: 10000 },
        keyPrice: { selectedMultiplierBps: 15000 }, keyPriceQuoteId: 'quote' })]));
    const displayed = (await reader.read('merchant')).offerings[0];
    assert.equal(displayed.multiplierBps, 15000); assert.equal(displayed.price.multiplierBps, 15000);
    assert.equal(displayed.keyPrice, undefined); assert.equal(displayed.keyPriceQuoteId, undefined);
});

test('a delisted merchant is not mistaken for an old platform without search', async () => {
    const reader = setup(async () => { throw Object.assign(new Error('not found'), { status: 404, code: 'merchant_not_found' }); });
    await assert.rejects(reader.read('merchant'), /not found/);
    assert.equal(reader.unsupportedUntil, 0);
});

test('actual server browse projection passes desktop normalization and stays out of execution caches', async () => {
    const { createMerchantCatalogBrowser } = await import('../../../apps/cloudflare-platform/src/public-merchant-catalog.js');
    const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => ({ user_id: 'merchant' }) }) }) } };
    const source = row('offering', { kind: 'llm', output: ['text', 'image'], workbenches: ['coding'], keyPriceQuoteId: 'kq_old', keyPrice: { selectedMultiplierBps: 12500 },
        multiplierBps: 10000, price: { mode: 'reference_multiplier', currency: 'USD', inputPerMillionMicros: 10000 },
        fidelity: { index: 98, sampleCount: 2, confidence: 'high' }, pricingDetails: { status: 'complete', currency: 'USD', quoteAt: Date.now(),
            multiplierBps: 12500, dimensions: [{ metric: 'input_token', currency: 'USD', user: { unitSize: 1000000, amountMicros: 10000 },
                official: { unitSize: 1000000, amountMicros: 8000, sourceType: 'official_charge_contract', chargeContractId: 'private-contract' } }] } });
    const handler = createMerchantCatalogBrowser({ getCache: () => undefined, readVersion: async () => ({ version: 'abcd1234', nextEffectiveAt: null }),
        loadCatalog: async () => new Response(JSON.stringify({ offerings: [source] })) });
    const service = new SupportServiceHarness();
    service.publicMerchantMetadataVersion = 'abcd1234';
    service.merchantSupportReader.invalidate('abcd1234');
    service.request = async path => {
        const req = new Request('https://unit.example' + path), response = await handler(req, env, new URL(req.url), 'merchant');
        const body = await response.json();
        if (!response.ok) throw Object.assign(new Error(body.code), { status: response.status, code: body.code });
        return body;
    };
    const page = await service.getMerchantSupportCatalog('merchant', { search: 'gpt offering', category: 'language' });
    assert.equal(page.offerings.length, 1);
    assert.equal(page.offerings[0].kind, 'llm');
    assert.deepEqual(page.offerings[0].output, ['text', 'image']);
    assert.equal(page.offerings[0].multiplierBps, 12500);
    assert.equal(page.offerings[0].pricingDetails.dimensions[0].user.amountMicros, 10000);
    assert.equal(page.offerings[0].keyPriceQuoteId, undefined);
    assert.equal(page.offerings[0].pricingDetails.dimensions[0].official.chargeContractId, undefined);
    assert.equal(service.merchantCatalogPages.size, 0, 'display cache is never admitted as an execution quote');
});

test('a reader can spend more than 30 seconds on a page without rebuilding or losing its next page', async () => {
    let clock = 1000, loads = 0;
    const source = Array.from({length: 205}, (_, i) => row(String(i).padStart(4, '0')));
    const reader = setup(async () => { throw Object.assign(new Error('old'), { status: 404 }); }, async (_, after) => {
        loads++; const start = Number(after || 0); return { merchantId: 'merchant', offerings: source.slice(start, start + 100),
            ...(start + 100 < source.length ? { nextCursor: String(start + 100).padStart(4, '0') } : {}) };
    }, () => clock);
    const first = await reader.read('merchant');
    clock += 31_000;
    const second = await reader.read('merchant', { after: first.nextCursor });
    assert.equal(second.offerings[0].id, '0100'); assert.equal(loads, 3);
    clock += 301_000;
    await assert.rejects(reader.read('merchant', { after: second.nextCursor }), /SUPPORT_CURSOR_STALE/);
    assert.equal(loads, 3, 'expired cursor fails without a useless full scan');
});

test('remote stale-cursor recovery survives an RPC codec that discards Error.code', async () => {
    const reader = setup(async () => { throw Object.assign(new Error('Model list changed; restart browsing'), { code: 'merchant_catalog_cursor_stale', status: 409 }); });
    try { await reader.read('merchant', { after: 'server_cursor' }); assert.fail('must reject'); }
    catch (error) { const received = new Error(error.message); assert.match(received.message, /SUPPORT_CURSOR_STALE/); }
});
