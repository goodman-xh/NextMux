import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mediaTierLabel, normalizeOfferingMediaTiers } from '../lib/common/nextmux-media-price-tiers.js';
import { OfferingPriceCard } from '../lib/browser/nextmux-offering-price.js';

// React comes through @theia/core in this package.
const core = createRequire(createRequire(import.meta.url).resolve('@theia/core/package.json'));
const React = core('react');
const { renderToStaticMarkup } = core('react-dom/server');

// gpt-image-1 style tiers: three qualities × three fixed sizes, priced per image (contract v1).
const sizes = ['1024x1024', '1024x1536', '1536x1024'];
const official = { low: [11_000, 16_000, 16_000], medium: [42_000, 63_000, 63_000], high: [167_000, 250_000, 250_000] };
const imageTiers = {
    version: 1, kind: 'image', unit: 'image', currency: 'USD', basis: 'official_multiplier', multiplierBps: 12_000,
    defaultTierId: 'medium_1024x1024', sourceUrl: 'https://platform.openai.com/docs/pricing', verifiedAt: '2026-10-20',
    tiers: Object.entries(official).flatMap(([quality, prices]) => sizes.map((size, index) => ({
        id: `${quality}_${size}`, quality, size, officialMicros: prices[index], customerMicros: Math.round(prices[index] * 1.2)
    })))
};

test('valid v1 tiers are kept; malformed tiers and fields are dropped', () => {
    const tiers = normalizeOfferingMediaTiers(imageTiers);
    assert.equal(tiers.tiers.length, 9);
    assert.equal(tiers.defaultTierId, 'medium_1024x1024');
    assert.equal(normalizeOfferingMediaTiers(null), undefined);
    assert.equal(normalizeOfferingMediaTiers({ ...imageTiers, version: 2 }), undefined);
    assert.equal(normalizeOfferingMediaTiers({ ...imageTiers, unit: 'second' }), undefined, 'image tiers are priced per image');
    const mixed = normalizeOfferingMediaTiers({ ...imageTiers, defaultTierId: 'missing', sourceUrl: 'javascript:alert(1)', tiers: [
        { id: 'ok', customerMicros: 10, officialMicros: -1, quality: 'ultra', size: '1024 x 1024' },
        { id: 'ok', customerMicros: 20 },
        { id: 'bad', customerMicros: 1.5 }
    ] });
    assert.deepEqual(mixed.tiers, [{ id: 'ok', customerMicros: 10, officialMicros: null }]);
    assert.equal(mixed.defaultTierId, 'ok', 'an unknown default falls back to the first tier');
    assert.equal(mixed.sourceUrl, null);
});

test('tier labels read quality, exact size or resolution, aspect ratio and audio', () => {
    const text = { quality: q => ({ high: '高质量' })[q] || q, audio: on => on ? '有声' : '无声' };
    assert.equal(mediaTierLabel({ id: 'a', quality: 'high', size: '1024x1536', officialMicros: 1, customerMicros: 1 }, text), '高质量 · 1024×1536');
    assert.equal(mediaTierLabel({ id: 'b', resolution: '1080p', aspectRatio: '16:9', audio: true, officialMicros: null, customerMicros: 1 }, text), '1080p · 16:9 · 有声');
    assert.equal(mediaTierLabel({ id: 'c_only', officialMicros: null, customerMicros: 1 }, text), 'c_only');
});

test('the shared price card lists every tier with official and relay prices and marks the default', () => {
    const offering = {
        id: 'o1', canonicalModel: 'openai/gpt-image-1', category: 'image', workbenches: ['comic'], status: 'active',
        price: { currency: 'USD', mode: 'reference_multiplier', multiplierBps: 12_000, inputPerMillionMicros: null, outputPerMillionMicros: null,
            cachedInputPerMillionMicros: null, imageEachMicros: 50_400, videoSecondMicros: null, audioPerMillionCharactersMicros: null, mediaTiers: imageTiers }
    };
    const html = renderToStaticMarkup(React.createElement(OfferingPriceCard, { locale: 'zh-CN', offering }));
    assert.match(html, /nmx-media-tier-table/);
    assert.equal((html.match(/<tr class="is-default">/g) || []).length, 1);
    assert.equal((html.match(/<tbody>[\s\S]*<\/tbody>/)[0].match(/<tr/g) || []).length, 9);
    assert.match(html, /高质量 · 1536×1024/);
    assert.match(html, /分档价格/);
    const flat = renderToStaticMarkup(React.createElement(OfferingPriceCard, { locale: 'en', offering: { ...offering, price: { ...offering.price, mediaTiers: null } } }));
    assert.doesNotMatch(flat, /nmx-media-tier-table/, 'a single flat price shows no tier table');
});

test('the tier table has light and dark styling in the design layer', () => {
    const css = readFileSync(new URL('../src/browser/style/nextmux-Variables.css', import.meta.url), 'utf8');
    assert.match(css, /\.nmx-media-tier-table tr\.is-default/);
});
