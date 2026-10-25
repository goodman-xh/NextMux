import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { formatManagedVideoPrice, formatManagedVideoEstimate } from '../lib/browser/nextmux-video-price.js';
import { offeringPriceText, offeringMultiplierBps, offeringIsOwnPriced } from '../lib/browser/nextmux-offering-price.js';
import { canvasImageTier, offeringMediaTiers } from '../lib/common/nextmux-canvas-media-tiers.js';
import { mediaTierInputRates } from '../lib/common/nextmux-media-price-tiers.js';
import { comicChatSize } from '../lib/common/nextmux-comic-chat.js';

// The widget's one-line prices (model lists, the route sheet, the comic chat's 发送 estimate), run as written.
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['formatOfferingPrice', 'formatManagedMediaPrice', 'comicChatEstimate']);
const methods = [];
(function walk(node) { if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast)); ts.forEachChild(node, walk); })(ast);
assert.equal(methods.length, names.size);
const deps = { formatManagedVideoPrice, formatManagedVideoEstimate, offeringPriceText, offeringMultiplierBps, offeringIsOwnPriced, canvasImageTier,
    offeringMediaTiers, mediaTierInputRates, comicChatSize, managedVideoInputImageCount: () => 0 };
const compiled = ts.transpileModule(`const { ${Object.keys(deps).join(', ')} } = deps;\nclass Harness { ${methods.join('\n')} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const Harness = new Function('deps', `${compiled}\nreturn Harness;`)(deps);
const harness = locale => Object.assign(new Harness(), { desktopLocale: locale, mediaDraft: { kind: 'image' },
    comicChatT: (key, values = {}) => key === 'estimate' ? `≈ ${values.price}` : key });

const gptTiers = {
    version: 1, kind: 'image', unit: 'image', currency: 'USD', basis: 'official_multiplier', multiplierBps: 10_000, defaultTierId: 'medium_1024x1024',
    sourceUrl: null, verifiedAt: null,
    tokenRates: [{ metric: 'input_token', modality: 'text', officialMicros: 5_000_000, customerMicros: 5_000_000 }],
    tiers: [['low', '1024x1024', 11_000], ['medium', '1024x1024', 42_000], ['medium', '1536x1024', 63_000], ['high', '1536x1024', 250_000]]
        .map(([quality, size, micros]) => ({ id: `${quality}_${size}`, quality, size, officialMicros: micros, customerMicros: micros }))
};
const image = (extra = {}) => ({ category: 'image', multiplierBps: 10_000, officialPrice: {},
    price: { currency: 'USD', mode: 'reference_multiplier', multiplierBps: 10_000, imageEachMicros: 42_000, inputPerMillionMicros: null, outputPerMillionMicros: null, ...extra } });

test('a tier-priced picture reads as the range of its tiers, a flat one as its price, both with a localized unit', () => {
    assert.equal(harness('en').formatOfferingPrice(image({ mediaTiers: gptTiers })), '$0.011–$0.25 / image');
    assert.equal(harness('zh-CN').formatOfferingPrice(image()), 'US$0.042 / 张');
    assert.equal(harness('ja').formatOfferingPrice(image({ imageEachMicros: null })), '価格未確定', 'no Chinese fallback in other languages');
});

test('token prices name input and output and their unit; nothing repeats the unit after the price', () => {
    const chat = { category: 'chat', price: { currency: 'USD', inputPerMillionMicros: 3_000_000, outputPerMillionMicros: 15_000_000 } };
    assert.equal(harness('en').formatOfferingPrice(chat), 'Input $3.00 · Output $15.00 / 1M tokens');
    assert.doesNotMatch(source, /offeringPriceUnit\(/, 'the route sheet no longer appends a second unit');
    assert.equal(harness('de').formatOfferingPrice({ category: 'audio', price: { currency: 'USD', audioPerMillionCharactersMicros: null } }), 'Preis ausstehend');
});

test('the comic chat prices the tier its frame size is billed at and says token fees are extra', () => {
    const h = harness('en');
    const candidate = { source: { kind: 'managed' }, offering: image({ mediaTiers: gptTiers }) };
    // 16:9 (1920×1080) bills the medium 1536×1024 tier, not the 1024×1024 default.
    assert.equal(h.comicChatEstimate('image', candidate, { aspect: '16:9', count: 2 }, '', 0), '≈ $0.126 · Plus tokens');
    assert.equal(h.comicChatEstimate('image', candidate, { aspect: '1:1', count: 1 }, '', 0), '≈ $0.042 · Plus tokens');
    const flat = { source: { kind: 'managed' }, offering: image() };
    assert.equal(h.comicChatEstimate('image', flat, { aspect: '16:9', count: 1 }, '', 0), '≈ $0.042');
    assert.equal(harness('en').formatManagedMediaPrice({ offering: { category: 'music', price: { currency: 'USD', requestEachMicros: 50_000 } } }, 'music'), '$0.05 / song');
});
