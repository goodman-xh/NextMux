import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import { normalizeOfferingMediaTiers } from '../lib/common/nextmux-media-price-tiers.js';
import { OfferingPriceCard } from '../lib/browser/nextmux-offering-price.js';

// React comes through @theia/core in this package.
const core = createRequire(createRequire(import.meta.url).resolve('@theia/core/package.json'));
const React = core('react');
const { renderToStaticMarkup } = core('react-dom/server');

const veoTiers = extra => ({
    version: 1, kind: 'video', unit: 'second', currency: 'USD', basis: 'official_multiplier', multiplierBps: 12_000, defaultTierId: '1080p',
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', verifiedAt: '2026-10-21',
    tiers: [['720p', 100_000], ['1080p', 120_000], ['4k', 300_000]].map(([resolution, micros]) => ({ id: resolution, resolution, audio: true, officialMicros: micros, customerMicros: micros * 1.2 })),
    ...extra
});
const offering = mediaTiers => ({
    id: 'veo', canonicalModel: 'google/veo-3.1-fast', category: 'video', workbenches: ['comic'], status: 'active',
    price: { currency: 'USD', mode: 'reference_multiplier', multiplierBps: 12_000, inputPerMillionMicros: null, outputPerMillionMicros: null, cachedInputPerMillionMicros: null,
        imageEachMicros: null, videoSecondMicros: 144_000, videoInputImageEachMicros: 0, audioPerMillionCharactersMicros: null, mediaTiers }
});
const render = (locale, mediaTiers) => renderToStaticMarkup(React.createElement(OfferingPriceCard, { locale, offering: offering(mediaTiers) }));

test('a video tier billed by the requested size keeps the requestTier; a fixed tier must name one of its tiers', () => {
    assert.equal(normalizeOfferingMediaTiers(veoTiers({ requestTier: 'output_size' })).requestTier, 'output_size');
    const fixed = normalizeOfferingMediaTiers(veoTiers({ requestTier: 'fixed', billedTierId: '720p' }));
    assert.deepEqual([fixed.requestTier, fixed.billedTierId], ['fixed', '720p']);
    // A fixed tier naming no known tier is not trusted; image tables never carry the field.
    assert.equal(normalizeOfferingMediaTiers(veoTiers({ requestTier: 'fixed', billedTierId: '8k' })).requestTier, undefined);
    assert.equal(normalizeOfferingMediaTiers(veoTiers({ requestTier: 'sometimes' })).requestTier, undefined);
    const image = normalizeOfferingMediaTiers({ ...veoTiers({ requestTier: 'fixed', billedTierId: '720p' }), kind: 'image', unit: 'image' });
    assert.equal(image.requestTier, undefined);
});

test('the price card marks the tier a fixed video format is billed at and says why; otherwise the default tier', () => {
    const fixed = render('zh-CN', veoTiers({ requestTier: 'fixed', billedTierId: '720p' }));
    assert.equal((fixed.match(/<tr class="is-default">/g) || []).length, 1);
    assert.match(fixed, /<tr class="is-default"><th scope="row"><span data-nmx-literal="true">720p · 有声<\/span><em>实际计费<\/em>/);
    assert.match(fixed, /class="nmx-media-tier-note">该接口不传视频分辨率：每个视频都按 720p · 有声 生成和计费。/);
    const sized = render('en', veoTiers({ requestTier: 'output_size' }));
    assert.match(sized, /<tr class="is-default"><th scope="row"><span data-nmx-literal="true">1080p · With audio<\/span><em>Default<\/em>/);
    assert.doesNotMatch(sized, /nmx-media-tier-note/);
    // Every locale names the billed tier.
    for (const locale of ['zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'])
        assert.match(render(locale, veoTiers({ requestTier: 'fixed', billedTierId: '720p' })), /class="nmx-media-tier-note">[^<]*720p/u, locale);
});

test('the tier note is styled with the design tokens shared by light and dark themes', () => {
    const css = readFileSync(new URL('../src/browser/style/nextmux-Variables.css', import.meta.url), 'utf8');
    assert.match(css, /\.nmx-media-tier-note \{[^}]*color: var\(--nmxv-fg-3\)/);
    const canvas = readFileSync(new URL('../src/browser/style/nextmux-comic-canvas.css', import.meta.url), 'utf8');
    assert.match(canvas, /\.is-quality select \{[^}]*field-sizing:content/, 'the quality choice keeps its full word in every language');
});

// Additive prompt input tokens on tier-priced images (gpt-image-*): the official sheet bills the text
// prompt per input token on top of the per-image quality × size tier, passed on at the merchant multiplier.
const { mediaTierInputRates } = await import('../lib/common/nextmux-media-price-tiers.js');
const { managedCanvasImageEstimate } = await import('../lib/browser/nextmux-comic-canvas-price.js');
const imageTiers = {
    version: 1, kind: 'image', unit: 'image', currency: 'USD', basis: 'official_multiplier', multiplierBps: 12_000, defaultTierId: 'medium_1024x1024',
    sourceUrl: 'https://developers.openai.com/api/docs/guides/image-generation', verifiedAt: '2026-10-21',
    tiers: [['low', 11_000], ['medium', 42_000], ['high', 167_000]].map(([quality, micros]) => ({
        id: `${quality}_1024x1024`, quality, size: '1024x1024', officialMicros: micros, customerMicros: Math.round(micros * 1.2)
    }))
};
const imageOffering = (price, extra = {}) => ({
    id: 'gpt-image', canonicalModel: 'openai/gpt-image-2', category: 'image', workbenches: ['comic'], status: 'active', multiplierBps: 12_000,
    price: { currency: 'USD', mode: 'reference_multiplier', multiplierBps: 12_000, inputPerMillionMicros: null, outputPerMillionMicros: null,
        cachedInputPerMillionMicros: null, imageEachMicros: 50_400, videoSecondMicros: null, audioPerMillionCharactersMicros: null, mediaTiers: imageTiers, ...price },
    officialPrice: { inputPerMillionMicros: 5_000_000, cachedInputPerMillionMicros: 1_250_000, imageInputPerMillionMicros: 8_000_000 },
    ...extra
});

test('the additive prompt input rate is read from the published price, else official × the merchant multiplier', () => {
    const published = mediaTierInputRates({ price: { inputPerMillionMicros: 6_000_000 }, officialPrice: { inputPerMillionMicros: 5_000_000 }, multiplierBps: 12_000 });
    assert.equal(published.promptPerMillionMicros, 6_000_000);
    assert.equal(published.official.promptPerMillionMicros, 5_000_000);
    const derived = mediaTierInputRates({ price: { inputPerMillionMicros: null }, officialPrice: { inputPerMillionMicros: 5_000_000, cachedInputPerMillionMicros: 1_250_000, imageInputPerMillionMicros: 8_000_000 }, multiplierBps: 12_000 });
    assert.deepEqual([derived.promptPerMillionMicros, derived.cachedPromptPerMillionMicros, derived.imageInputPerMillionMicros], [6_000_000, 1_500_000, 9_600_000]);
    assert.equal(mediaTierInputRates({ price: {}, officialPrice: { inputPerMillionMicros: 5_000_000 }, multiplierBps: 12_000, direct: true }), undefined,
        'a merchant’s own price never derives from the official sheet');
    assert.equal(mediaTierInputRates({ price: { inputPerMillionMicros: 0 }, multiplierBps: 12_000 }), undefined, 'no fee, no add-on');
    assert.equal(mediaTierInputRates({ price: {}, mediaTiers: { promptInputPerMillionMicros: 7_000_000 }, multiplierBps: null }).promptPerMillionMicros, 7_000_000);
});

test('the price card shows the per-image tiers and the additive prompt input line together', () => {
    const html = renderToStaticMarkup(React.createElement(OfferingPriceCard, { locale: 'zh-CN', offering: imageOffering({}) }));
    assert.match(html, /nmx-media-tier-table/);
    assert.match(html, /<p class="nmx-media-tier-addon"[^>]*>/);
    assert.match(html, /另计提示词输入/);
    assert.match(html, /\+US\$6\.00/, 'official 5/M × 1.2');
    assert.match(html, /缓存读取 <b dir="ltr">US\$1\.50<\/b>/);
    assert.match(html, /图片输入 <b dir="ltr">US\$9\.60<\/b>/);
    assert.match(html, /title="官方报价 输入 US\$5\.00 · 缓存读取 US\$1\.25 \/ 百万 Token"/);
    const noPrompt = renderToStaticMarkup(React.createElement(OfferingPriceCard, { locale: 'en', offering: imageOffering({}, { officialPrice: {} }) }));
    assert.doesNotMatch(noPrompt, /nmx-media-tier-addon/);
});

test('an own API price card lists the official tier column and the official token fees only', () => {
    const own = renderToStaticMarkup(React.createElement(OfferingPriceCard, { locale: 'zh-CN', offering: imageOffering({}), officialOnly: true }));
    assert.match(own, /nmx-media-tier-table/);
    assert.doesNotMatch(own, /中转商报价/, 'no relay column or quote');
    assert.match(own, /\+US\$5\.00/, 'the official prompt rate, not the relay’s 6.00');
    assert.match(own, /缓存读取 <b dir="ltr">US\$1\.25<\/b>/);
    assert.doesNotMatch(own, /title="官方报价/, 'the official rates need no second, official tooltip');
    const video = renderToStaticMarkup(React.createElement(OfferingPriceCard, { locale: 'en', offering: offering(veoTiers()), officialOnly: true }));
    assert.match(video, /<th scope="col">Official price<\/th><\/tr>/, 'the official column closes the header row');
    assert.doesNotMatch(video, /US\$0\.36/, 'no relay tier price (4K × 1.2)');
});

test('the canvas generate pill prices the chosen tier plus the prompt input rate', () => {
    const node = { id: 'n1', kind: 'imageGen', payload: { mode: 'textToImage', parameters: { width: 1024, height: 1024, quality: 'high' } } };
    const estimate = managedCanvasImageEstimate('zh-CN', node, imageOffering({}));
    assert.match(estimate, /^US\$0\.2004 \+ 输入 US\$6\.00\/百万 Token$/);
    // One currency format on the whole pill (formatPriceMicros), with or without a token fee.
    const flat = managedCanvasImageEstimate('en', node, imageOffering({}, { officialPrice: {} }));
    assert.equal(flat, 'US$0.2004');
});

// Token fees beside a picture (media-benchmark-tiers.js tokenDisplay): customer rates are published already multiplied.
const { normalizeOfferingMediaTiers: normalizeTiers } = await import('../lib/common/nextmux-media-price-tiers.js');
const { offeringPriceSignature } = await import('../lib/browser/nextmux-offering-price.js');
const { canvasImageTier, canvasImageTierPolicy } = await import('../lib/common/nextmux-canvas-media-tiers.js');
const flashLite = {
    version: 1, kind: 'image', unit: 'image', currency: 'USD', basis: 'official_multiplier', multiplierBps: 12_000, defaultTierId: '1k',
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', verifiedAt: '2026-10-21',
    tokenRates: [{ metric: 'input_token', modality: 'text_image', officialMicros: 250_000, customerMicros: 300_000 },
        { metric: 'output_token', modality: 'text_thinking', officialMicros: 1_500_000, customerMicros: 1_800_000 }],
    promptInputPerMillionMicros: 300_000, textOutputPerMillionMicros: 1_800_000,
    tiers: [{ id: '1k', resolution: '1K', officialMicros: 33_600, customerMicros: 40_320 }]
};

test('published customer rates are never multiplied again; only an official rate is scaled when nothing is published', () => {
    const rates = mediaTierInputRates({ price: {}, mediaTiers: { promptInputPerMillionMicros: 6_000_000, imageInputPerMillionMicros: 9_600_000 },
        officialPrice: { inputPerMillionMicros: 5_000_000, imageInputPerMillionMicros: 8_000_000 }, multiplierBps: 12_000 });
    assert.deepEqual([rates.promptPerMillionMicros, rates.imageInputPerMillionMicros], [6_000_000, 9_600_000]);
    assert.equal(rates.official.imageInputPerMillionMicros, 8_000_000);
    const thinking = mediaTierInputRates({ price: {}, mediaTiers: flashLite, multiplierBps: 12_000 });
    assert.deepEqual([thinking.promptPerMillionMicros, thinking.textOutputPerMillionMicros, thinking.textOutputModality], [300_000, 1_800_000, 'text_thinking']);
    assert.deepEqual(thinking.official, { promptPerMillionMicros: 250_000, textOutputPerMillionMicros: 1_500_000 });
    const officialOnly = mediaTierInputRates({ price: {}, multiplierBps: 12_000,
        mediaTiers: { tokenRates: [{ metric: 'output_token', modality: 'text', officialMicros: 10_000_000, customerMicros: null }] } });
    assert.equal(officialOnly.textOutputPerMillionMicros, 12_000_000, 'official × multiplier when no customer rate is published');
    assert.equal(officialOnly.promptPerMillionMicros, undefined, 'an output fee alone still shows');
    assert.equal(mediaTierInputRates({ price: {}, multiplierBps: null, direct: true,
        mediaTiers: { tokenRates: [{ metric: 'output_token', modality: 'text', officialMicros: 10_000_000, customerMicros: null }] } }), undefined);
});

test('normalized tiers keep their token rates and customer token fields; invalid rows are dropped', () => {
    const tiers = normalizeTiers({ ...flashLite, tokenRates: [...flashLite.tokenRates, { metric: 'output_token', modality: 'text', officialMicros: 1, customerMicros: 1 },
        { metric: 'audio_token', modality: 'text', officialMicros: 1, customerMicros: 1 }, { metric: 'cached_input_token', modality: 'text', officialMicros: null, customerMicros: null }] });
    assert.deepEqual(tiers.tokenRates.map(rate => rate.metric), ['input_token', 'output_token']);
    assert.equal(tiers.textOutputPerMillionMicros, 1_800_000);
    assert.equal(normalizeTiers({ ...flashLite, kind: 'video', unit: 'second' }).tokenRates, undefined, 'video tiers carry no token fees');
});

test('a single-tier picture still shows its tier and its prompt and thinking output fees', () => {
    const offering = { ...imageOffering({ mediaTiers: flashLite, imageEachMicros: 40_320 }), canonicalModel: 'google/gemini-3.1-flash-lite-image', officialPrice: {} };
    const html = renderToStaticMarkup(React.createElement(OfferingPriceCard, { locale: 'zh-CN', offering }));
    assert.match(html, /nmx-media-tier-table/);
    assert.match(html, /<span data-nmx-literal="true">1K<\/span>/);
    assert.match(html, /另计提示词输入/);
    assert.match(html, /文本\/思考输出 <b dir="ltr">US\$1\.80<\/b>/);
    assert.match(html, /title="官方报价 输入 US\$0\.25 · 文本\/思考输出 US\$1\.50 \/ 百万 Token"/);
    assert.doesNotMatch(html, /缓存读取 <b|图片输入 <b/, 'no fee the sheet does not bill');
    // A single flat tier without a class, size, quality or token fee stays out of the card.
    const flat = renderToStaticMarkup(React.createElement(OfferingPriceCard, { locale: 'en', offering: { ...offering,
        officialPrice: {}, price: { ...offering.price, mediaTiers: { ...flashLite, tokenRates: undefined, promptInputPerMillionMicros: undefined,
            textOutputPerMillionMicros: undefined, tiers: [{ id: 'standard', officialMicros: 40_000, customerMicros: 48_000 }] } } } }));
    assert.doesNotMatch(flat, /nmx-media-tier-table/);
});

test('a 1K-only image model offers 1K on the canvas and promises no price for a larger picture', () => {
    const tiers = normalizeTiers(flashLite);
    assert.deepEqual(canvasImageTierPolicy(tiers, ['1:1', '16:9']).imageOutputVariants.map(variant => variant.resolution), ['1K']);
    assert.equal(canvasImageTier(tiers, { width: 1024, height: 1024 }).id, '1k');
    assert.equal(canvasImageTier(tiers, { width: 2048, height: 2048 }), undefined, 'the gateway refuses 2K on a 1K-only model');
    assert.equal(canvasImageTier(tiers, { width: 1024, height: 1024, resolution: ' 1k ' }).id, '1k');
});

test('offerings that differ only in a non-default tier price never collapse into one', () => {
    const base = imageOffering({});
    const other = imageOffering({ mediaTiers: { ...imageTiers, tiers: imageTiers.tiers.map(tier => tier.quality === 'high' ? { ...tier, customerMicros: tier.customerMicros + 1 } : tier) } });
    assert.notEqual(offeringPriceSignature(base), offeringPriceSignature(other));
    assert.equal(offeringPriceSignature(base), offeringPriceSignature(imageOffering({})));
});

test('the price hover card and the model drawer, both on <body>, get the tier styles and the theme tokens', () => {
    const css = readFileSync(new URL('../src/browser/style/nextmux-Variables.css', import.meta.url), 'utf8');
    assert.match(css, /\.nmx-floating-toast,\n\.nmx-offering-price-pop,\n\.nmx-image-lightbox \{/);
    assert.match(css, /:is\(\.nmx-model-picker-portal, \.nmx-model-effort-portal, \.nmx-shell, \.nmx-offering-price-pop\) \.nmx-media-tier-table tr\.is-default/);
    assert.match(css, /:is\(\.nmx-model-picker-portal, \.nmx-model-effort-portal, \.nmx-shell, \.nmx-offering-price-pop\) \.nmx-price-section-toggle \{/,
        'the drawer\'s quote toggles are styled inside its portal');
    assert.doesNotMatch(css, /:is\(> /, 'no relative selector inside :is()');
});
