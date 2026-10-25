import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { mediaTierInputRates, mediaTierLabel, normalizeOfferingMediaTiers } from '../lib/common/nextmux-media-price-tiers.js';
import { offeringIsOwnPriced, offeringMultiplierBps } from '../lib/common/nextmux-media-cost-estimator.js';
import { requireCopyFallback } from './copy-fallback-module.mjs';

const require = createRequire(import.meta.url);
function sourceModule(name, imports = {}) {
    const exports = {};
    new Function('exports', 'require', ts.transpile(readFileSync(new URL(`../src/browser/${name}`, import.meta.url), 'utf8'), {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React
    }))(exports, request => request in imports ? imports[request]
        : request === './nextmux-copy-fallback' ? requireCopyFallback(request) : require(request));
    return exports;
}
// The offering module is written for `src/browser/`, so its relative `../common/*` imports have to be
// supplied here: the compiled `lib/` implementation is the same code the app runs.
const offering = sourceModule('nextmux-offering-price.tsx', {
    '../common/nextmux-media-price-tiers': { mediaTierInputRates, mediaTierLabel, normalizeOfferingMediaTiers },
    '../common/nextmux-media-cost-estimator': { offeringIsOwnPriced, offeringMultiplierBps }
});
const routePrice = sourceModule('nextmux-route-price-text.ts');
const { routePriceText, formatRoutePriceChangedNotice, formatRoutePriceChangedDetail, formatRouteMultiplier } = routePrice;
const { managedPriceSummary, managedPriceText } = sourceModule('nextmux-managed-price-text.ts', { './nextmux-offering-price': offering, './nextmux-route-price-text': routePrice });
const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const metrics = ['input_token', 'output_token', 'cached_input_token', 'cache_write_token', 'image_output_token',
    'image', 'video_second', 'video_input_image', 'audio_character', 'audio_second', 'request'];
const price = (overrides = {}) => ({
    id: 'price-event', requestId: 'call-1', at: 1, previousQuoteId: 'previous-quote', effectiveQuoteId: 'effective-quote',
    offeringId: 'offering', model: 'MODEL_FOR_THIS_CALL', currency: 'USD', usageMultiplierBps: null,
    rates: [{ metric: 'input_token', unitSize: 1_000_000, customerAmountMicros: 1_250_000 }], ...overrides
});

test('all twelve locales keep the composer adjustment notice concise and move multipliers into the tooltip', () => {
    const observation = { previousUsageMultiplierBps: 12500, usageMultiplierBps: 20000 };
    assert.equal(formatRoutePriceChangedNotice('zh-CN'), '该模型的倍率已被商家调整，请知悉！');
    assert.equal(formatRoutePriceChangedNotice('zh-TW'), '該模型的倍率已被商家調整，請知悉！');
    assert.equal(formatRoutePriceChangedNotice('en'), "The merchant adjusted this model's multiplier. Please note!");
    assert.equal(formatRoutePriceChangedDetail('zh-CN', observation), '倍率已从 ×1.25 调整为 ×2');
    assert.equal(formatRoutePriceChangedDetail('zh-CN', { usageMultiplierBps: 20000 }), '当前倍率：×2');
    assert.equal(formatRoutePriceChangedDetail('en', { usageMultiplierBps: null }), '');
    for (const locale of locales) {
        const message = formatRoutePriceChangedNotice(locale), detail = formatRoutePriceChangedDetail(locale, observation);
        assert.ok(message.length > 0); assert.doesNotMatch(message, /×|\n|\{.*\}/);
        assert.match(detail, /×1\.25/); assert.match(detail, /×2/); assert.doesNotMatch(detail, /\{.*\}/);
        const current = formatRoutePriceChangedDetail(locale, { usageMultiplierBps: 20000 });
        assert.match(current, /×2/); assert.doesNotMatch(current, /×1\.25|\{.*\}/);
        if (locale !== 'en') {
            assert.notEqual(message, formatRoutePriceChangedNotice('en'));
            assert.notEqual(detail, formatRoutePriceChangedDetail('en', observation));
        }
    }
});

test('all twelve languages localize the shared call-price message and every known billing dimension', () => {
    const update = price({ rates: metrics.map(metric => ({ metric, unitSize: 1_000, customerAmountMicros: 125_000 })) });
    for (const locale of locales) {
        const summary = managedPriceSummary(locale, update);
        for (const metric of metrics.filter(metric => metric.includes('_'))) assert.ok(!summary.includes(metric), `${locale} ${metric}`);
        assert.equal(summary.split('; ').length, metrics.length);
        for (const key of ['title', 'body', 'close']) {
            const value = managedPriceText(locale, key, { model: update.model, price: summary });
            assert.ok(value.length > 0, `${locale} ${key}`); assert.doesNotMatch(value, /\{(?:model|price|count)\}/);
            if (locale !== 'en') assert.notEqual(value, managedPriceText('en', key, { model: update.model, price: summary }));
            if (key === 'body') { assert.ok(value.includes(update.model)); assert.ok(value.includes(summary)); }
        }
    }
});

test('current-price wording does not claim an old amount, a price increase or a loss', () => {
    assert.equal(managedPriceText('zh-CN', 'body', { model: '模型 A', price: 'USD 1.25' }), '本次调用采用 模型 A 的当前价格：USD 1.25。');
    assert.equal(managedPriceText('en', 'body', { model: 'Model A', price: 'USD 1.25' }), 'This call uses the current price for Model A: USD 1.25.');
    assert.doesNotMatch(managedPriceText('en', 'body', { model: 'Model A', price: 'USD 1.25' }), /increase|previous|loss|from .* to/i);
    assert.doesNotMatch(managedPriceText('zh-CN', 'body', { model: '模型 A', price: 'USD 1.25' }), /涨价|损失|原价|从.*到/);
});

test('zero customer prices remain visible and null multipliers never become zero', () => {
    const update = price({ rates: [{ metric: 'input_token', unitSize: 1_000_000, customerAmountMicros: 0 }] });
    const summary = managedPriceSummary('en', update);
    assert.equal(summary, 'Input: USD 0 / 1,000,000 tokens');
    assert.doesNotMatch(summary, /Multiplier|×/);
    assert.equal(managedPriceSummary('en', { ...update, usageMultiplierBps: 0 }), `${summary}; Multiplier: ×0`);
});

test('rates use the authoritative currency and unitSize without assuming dollars or a million units', () => {
    const update = price({ currency: 'JPY', rates: [
        { metric: 'input_token', unitSize: 1500.25, customerAmountMicros: 125_000 },
        { metric: 'request', unitSize: 10, customerAmountMicros: 2_500_000 },
        { metric: 'audio_character', unitSize: 500, customerAmountMicros: 50_000 }
    ] });
    const summary = managedPriceSummary('en', update);
    assert.equal(summary, 'Input: JPY 0.125 / 1,500.25 tokens; Request: JPY 2.5 / 10 request; Speech: JPY 0.05 / 500 characters');
    assert.doesNotMatch(summary, /USD|\$/);
    assert.ok(managedPriceSummary('de', update).includes('1.500,25'));
});

test('fractional micros and bps are not rounded, floored or applied to customer rates twice', () => {
    const update = price({ usageMultiplierBps: 1000.5, rates: [
        { metric: 'output_token', unitSize: 1, customerAmountMicros: 0.5 },
        { metric: 'input_token', unitSize: 1, customerAmountMicros: 0.1 }
    ] });
    assert.equal(managedPriceSummary('en', update), 'Output: USD 0.0000005 / 1 tokens; Input: USD 0.0000001 / 1 tokens; Multiplier: ×0.1');
    assert.match(managedPriceSummary('en', price({ rates: [{ metric: 'request', unitSize: 1, customerAmountMicros: Number.MIN_VALUE }] })), /USD 5e-330/);
});

test('unrecognized dimensions retain their name and actual price while large payloads remain bounded', () => {
    assert.equal(managedPriceSummary('en', price({ rates: [{ metric: 'future_compute_hour', unitSize: 24, customerAmountMicros: 12_000_000 }] })),
        'future_compute_hour: USD 12 / 24 units');
    const update = price({ rates: Array.from({ length: 64 }, (_, index) => ({ metric: `future_${index}`, unitSize: 1, customerAmountMicros: index })) });
    const summary = managedPriceSummary('en', update);
    assert.ok(summary.includes('future_63:')); assert.equal(summary.split('; ').length, 64);
    assert.ok(managedPriceText('en', 'body', { model: update.model, price: summary }).includes(summary));
    const oversized = managedPriceSummary('en', price({ rates: [...update.rates, ...update.rates] }));
    assert.ok(oversized.endsWith('64 additional rates')); assert.ok(oversized.length < 20_000);
});

test('missing or invalid numeric values do not become free prices and unknown locales remain readable', () => {
    const summary = managedPriceSummary('en', price({ usageMultiplierBps: NaN, rates: [
        { metric: 'request', unitSize: 0, customerAmountMicros: NaN },
        { metric: 'image', unitSize: 1, customerAmountMicros: Infinity }
    ] }));
    assert.equal(summary, 'Request: USD — / — request; Image: USD — / 1 image');
    for (const locale of locales) assert.ok(managedPriceSummary(locale, price({ rates: [] })).length > 0);
    assert.equal(managedPriceSummary('xx-UNKNOWN', price()), managedPriceSummary('en', price()));
    assert.equal(managedPriceText('xx-UNKNOWN', 'title'), managedPriceText('en', 'title'));
});

test('formatting leaves the original event payload and existing price notification copy unchanged', () => {
    const update = price(); Object.freeze(update.rates[0]); Object.freeze(update.rates); Object.freeze(update);
    const original = JSON.stringify(update);
    const previousBody = routePriceText('zh-CN', 'body', { model: '旧模型', from: '1', to: '2' });
    for (const locale of locales) managedPriceText(locale, 'body', { model: update.model, price: managedPriceSummary(locale, update) });
    assert.equal(JSON.stringify(update), original);
    assert.equal(previousBody, '你正在使用的 旧模型，商家已将倍率从 1 调整为 2。为避免资金损失，请及时调整模型使用。');
    assert.equal(routePriceText('zh-CN', 'body', { model: '旧模型', from: '1', to: '2' }), previousBody);
    assert.equal(managedPriceText('en', 'body', { model: 'literal {price}', price: 'USD 1' }), 'This call uses the current price for literal {price}: USD 1.');
});

test('multipliers in notices and price summaries keep at most two decimals, and a paid quote never reads as zero', () => {
    assert.equal(formatRouteMultiplier(6666), '0.67');
    assert.equal(formatRouteMultiplier(1450), '0.15', 'a half rounds up, unlike (0.145).toFixed(2)');
    assert.equal(formatRouteMultiplier(1000.5), '0.1');
    assert.equal(formatRouteMultiplier(12_500), '1.25');
    assert.equal(formatRouteMultiplier(20_000), '2');
    assert.equal(formatRouteMultiplier(12_345_000), '1234.5');
    assert.equal(formatRouteMultiplier(50), '0.01');
    assert.equal(formatRouteMultiplier(49), '<0.01');
    assert.equal(formatRouteMultiplier(0), '0');
    for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(formatRouteMultiplier(invalid), '—');
    assert.equal(formatRoutePriceChangedDetail('en', { previousUsageMultiplierBps: 6666, usageMultiplierBps: 1 }), 'The multiplier changed from ×0.67 to ×<0.01');
    assert.equal(formatRoutePriceChangedDetail('de', { usageMultiplierBps: 6666 }), 'Aktueller Multiplikator: ×0.67');
    assert.ok(managedPriceSummary('en', price({ usageMultiplierBps: 6666 })).endsWith('; Multiplier: ×0.67'));
});
