import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = createRequire(require.resolve('@theia/core/package.json'))('react-dom/server');
const { OfferingPriceCard, averageMultiplierBps, offeringMultiplierBps, offeringOfficialPrice, offeringPriceSignature, offeringPriceText, setOfferingPriceExpanded } = require('../lib/browser/nextmux-offering-price.js');
const { dedupeComicPriceVariants } = require('../lib/browser/nextmux-comic-step-models.js');

const dims = (values = {}) => ({ currency: 'USD', inputPerMillionMicros: null, outputPerMillionMicros: null, cachedInputPerMillionMicros: null, cacheWritePerMillionMicros: null,
    imageEachMicros: null, requestEachMicros: null, videoSecondMicros: null, audioPerMillionCharactersMicros: null, imageOutputPerMillionMicros: null, audioSecondMicros: null, ...values });
// Claude Opus 5.5 on two APIs of one relay: official × 0.1, and the relay's own price.
const multiplier = { id: 'o1', apiId: 'api-a', multiplierBps: 1000, keyPrice: { selectedMultiplierBps: 1000 },
    price: { ...dims({ inputPerMillionMicros: 1_000_000, outputPerMillionMicros: 5_000_000, cachedInputPerMillionMicros: 100_000 }), mode: 'reference_multiplier', multiplierBps: 1000 },
    officialPrice: dims({ inputPerMillionMicros: 10_000_000, outputPerMillionMicros: 50_000_000, cachedInputPerMillionMicros: 1_000_000 }) };
const own = { id: 'o2', apiId: 'api-b', multiplierBps: null, keyPrice: { selectedMultiplierBps: null },
    price: { ...dims({ inputPerMillionMicros: 1_000_000, outputPerMillionMicros: 5_000_000, imageEachMicros: 40_000 }), mode: 'direct', multiplierBps: null }, officialPrice: null };

test('a relay model hover shows official price, multiplier and relay price for every billed dimension', () => {
    const html = renderToStaticMarkup(React.createElement(OfferingPriceCard, { locale: 'zh-CN', offering: multiplier }));
    for (const part of ['官方报价', '倍率', '0.1x', '中转商报价', '输入', '输出', '缓存读取', 'US$10.00', 'US$50.00', 'US$1.00', 'US$5.00', 'US$0.10', '百万 Token']) assert.ok(html.includes(part), part);
    assert.equal(html.includes('data-price-mode="multiplier"'), true);
    const tiered = {
        ...multiplier,
        canonicalModel: 'openai/gpt-5.4',
        price: {
            ...multiplier.price,
            rateBasis: 'maximum_context_tier',
            officialTariff: {
                version: 1,
                canonicalModel: 'openai/gpt-5.4',
                inputIncludesCached: true,
                rates: {
                    input_token: [
                        { amountMicros: 5_000_000, unitSize: 1_000_000, promptMin: 0, promptMax: 272_000, sourceType: 'official_variant' },
                        { amountMicros: 10_000_000, unitSize: 1_000_000, promptMin: 272_001, promptMax: 1_050_000, sourceType: 'official_variant' }
                    ],
                    output_token: [
                        { amountMicros: 25_000_000, unitSize: 1_000_000, promptMin: 0, promptMax: 272_000, sourceType: 'official_variant' },
                        { amountMicros: 50_000_000, unitSize: 1_000_000, promptMin: 272_001, promptMax: 1_050_000, sourceType: 'official_variant' }
                    ],
                    cached_input_token: [
                        { amountMicros: 500_000, unitSize: 1_000_000, promptMin: 0, promptMax: 272_000, sourceType: 'official_variant' },
                        { amountMicros: 1_000_000, unitSize: 1_000_000, promptMin: 272_001, promptMax: 1_050_000, sourceType: 'official_variant' }
                    ]
                }
            }
        }
    };
    const tieredHtml = renderToStaticMarkup(React.createElement(OfferingPriceCard, { locale: 'zh-CN', offering: tiered }));
    assert.equal(tieredHtml.includes('输入 Token（含缓存）'), false);
    assert.equal(tieredHtml.includes('272,001'), false);
    assert.equal(tieredHtml.includes('US$5.00 / US$10.00'), false);
});

test('a merchant-set price reads multiplier "无" and official "-", and shows per-image rates too', () => {
    const html = renderToStaticMarkup(React.createElement(OfferingPriceCard, { locale: 'zh-CN', offering: own }));
    assert.ok(html.includes('>倍率<') && html.includes('>无<'));
    assert.ok(html.includes('US$-'));
    assert.ok(html.includes('图片') && html.includes('US$0.04') && html.includes('张'));
    assert.ok(html.includes(offeringPriceText('zh-CN', 'own')));
    assert.equal(offeringMultiplierBps(own), null);
    assert.equal(offeringOfficialPrice(own), null);
});

test('older platforms without officialPrice: official = user price ÷ multiplier; none for merchant prices', () => {
    const { officialPrice: _omit, ...legacy } = multiplier;
    assert.equal(offeringOfficialPrice(legacy).inputPerMillionMicros, 10_000_000);
    assert.equal(offeringOfficialPrice(legacy).imageEachMicros, null);
    const { officialPrice: _none, ...legacyOwn } = own;
    assert.equal(offeringOfficialPrice(legacyOwn), null);
});

test('same model at the same price shows once; different prices are separate rows; the drawer multiplier is the average', () => {
    assert.notEqual(offeringPriceSignature(multiplier), offeringPriceSignature(own));
    assert.equal(offeringPriceSignature(multiplier), offeringPriceSignature({ ...multiplier, id: 'o3', apiId: 'api-c' }));
    assert.equal(averageMultiplierBps([1000, 3000, null, undefined]), 2000);
    assert.equal(averageMultiplierBps([null]), undefined);
    const source = { key: 'managed:m1', kind: 'managed', label: 'Relay' };
    const candidates = [
        { key: 'a', routeId: 'r1', model: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5', source, rank: 2, offering: multiplier },
        { key: 'b', routeId: 'r2', model: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5', source, rank: 1, offering: { ...multiplier, id: 'o3' } },
        { key: 'c', routeId: 'r3', model: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5', source, rank: 3, offering: own },
        { key: 'd', routeId: 'r4', model: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5', source: { key: 'official:x', kind: 'official', label: 'Mine' }, rank: 0 },
    ];
    // The better-ranked of the two identical prices stays; the own price and the own API are kept; order is preserved.
    assert.deepEqual(dedupeComicPriceVariants(candidates).map(candidate => candidate.key), ['b', 'c', 'd']);
});


test('video price cards itemise the source and relay fee per input image alongside seconds', () => {
    const offering = { ...multiplier, price: { ...multiplier.price, videoSecondMicros: 130_000, videoInputImageEachMicros: 40_000 },
        officialPrice: dims({ videoSecondMicros: 130_000, videoInputImageEachMicros: 40_000 }) };
    const html = renderToStaticMarkup(React.createElement(OfferingPriceCard, { locale: 'zh-CN', offering }));
    assert.ok(html.includes('视频输入图') && html.includes('US$0.04') && html.includes('US$0.13'));
    assert.equal((html.match(/视频输入图/gu) || []).length, 2, 'official and relay components are both shown');
});


const card = (offering, props = {}) => renderToStaticMarkup(React.createElement(OfferingPriceCard, { locale: 'zh-CN', offering, ...props }));

test('the official, multiplier and relay quotes sit side by side in three columns; an own API shows the official quote alone', () => {
    assert.match(card(multiplier), /<div class="nmx-offering-price-columns"><section class="nmx-offering-price-block nmx-price-section" data-price-audience="official">.*<div class="nmx-offering-price-multiplier nmx-offering-price-multiplier-column" data-price-audience="multiplier"><span class="nmx-offering-price-multiplier-label">倍率<\/span><strong class="nmx-offering-price-multiplier-value" dir="ltr">0\.1x<\/strong><\/div><section class="nmx-offering-price-block nmx-price-section" data-price-audience="user">/);
    const ownApi = card(multiplier, { officialOnly: true });
    assert.match(ownApi, /^<div class="nmx-offering-price is-official-only"/);
    assert.match(ownApi, /<div class="nmx-offering-price-columns is-single"><section [^>]*data-price-audience="official">/);
    for (const part of ['官方报价', 'US$10.00', 'US$50.00', 'US$1.00', '缓存读取']) assert.ok(ownApi.includes(part), part);
    for (const absent of ['中转商报价', 'data-price-audience="multiplier"', 'US$5.00', 'US$0.10', 'data-price-audience="user"']) assert.ok(!ownApi.includes(absent), absent);
    // Rows follow the official sheet: a dimension only the relay prices is not the own API's price.
    assert.ok(!card({ ...multiplier, price: { ...multiplier.price, imageEachMicros: 40_000 } }, { officialOnly: true }).includes('图片'));
    // A note sits once under both columns, so the official and relay rows stay level.
    const merchantSet = card(own);
    assert.match(merchantSet, /<\/section><\/div><div class="nmx-offering-price-notes"><p class="nmx-offering-price-note">中转商自定价格，不受倍率影响<\/p><\/div>/);
    assert.equal((merchantSet.match(/<dl><div><dt>/g) || []).length, 2, 'both columns list the merchant-set rows');
    assert.ok(merchantSet.includes('US$5.00') && merchantSet.includes('US$-'));
    assert.equal(merchantSet.split('中转商自定价格').length - 1, 1);
    assert.ok(!card(own, { officialOnly: true }).includes('nmx-offering-price-notes'), 'an own API has no relay note');
});

test('in the drawer each quote heading is a badge, title and chevron toggle, and both quotes open together', () => {
    setOfferingPriceExpanded(false);
    const closed = card(multiplier, { collapsible: true, hideMultiplier: true });
    assert.equal((closed.match(/<button type="button" class="nmx-price-section-toggle" aria-expanded="false">/g) || []).length, 2);
    assert.match(closed, /<span class="nmx-price-section-badge" aria-hidden="true"><i class="codicon codicon-workspace-trusted"><\/i><\/span><span class="nmx-price-section-title">官方报价<\/span><span class="nmx-price-section-chevron" aria-hidden="true"><i class="codicon codicon-chevron-down"><\/i><\/span>/);
    assert.match(closed, /codicon-arrow-swap"><\/i><\/span><span class="nmx-price-section-title">中转商报价</);
    assert.ok(!closed.includes('<dl') && closed.includes('is-collapsed'));
    setOfferingPriceExpanded(true);
    const opened = card(multiplier, { collapsible: true, hideMultiplier: true });
    const controls = [...opened.matchAll(/aria-expanded="true" aria-controls="([^"]+)"/g)].map(match => match[1]);
    assert.equal(controls.length, 2, 'both toggles report the shared state');
    assert.equal(controls[0], controls[1]);
    assert.equal(controls[0].split(' ').length, 2, 'each toggle controls both quotes');
    for (const id of controls[0].split(' ')) assert.ok(opened.includes(`<div class="nmx-price-section-body" id="${id}">`), id);
    assert.equal((opened.match(/<dl>/g) || []).length, 2);
    assert.match(opened, /^<div class="nmx-offering-price is-collapsible is-expanded"/);
    const single = card(multiplier, { collapsible: true, officialOnly: true });
    assert.equal((single.match(/aria-controls="[^" ]+"/g) || []).length, 1, 'an own API toggle controls its one quote');
    setOfferingPriceExpanded(false);
});
