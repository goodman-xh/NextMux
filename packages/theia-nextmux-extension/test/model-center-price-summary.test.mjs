import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = createRequire(require.resolve('@theia/core/package.json'))('react-dom/server');
import { ModelCenterPricePreview } from '../lib/browser/nextmux-model-center-merchants.js';
import { modelCenterText } from '../lib/browser/nextmux-model-center-locale.js';

const dimension = (metric, amountMicros = 40000, unitSize = 1, official = true) => ({ metric, currency: 'USD', official: official ? { amountMicros, unitSize } : null, user: { amountMicros: amountMicros * 2, unitSize } });
const render = (category, output, dimensions, side = 'user', locale = 'en') => renderToStaticMarkup(React.createElement(ModelCenterPricePreview, { model: { category, output, pricingDetails: { dimensions } }, side, locale }));
for (const [category, output, metric] of [['audio', 'music', 'request'], ['image', 'image', 'image_output_token'], ['audio', 'text', 'audio_second'], ['audio', 'speech', 'audio_character'], ['video', 'video', 'video_second']]) {
    test(`Model Center summarizes ${metric} rather than incidental text input`, () => {
        const dimensions = [dimension('input_token', 1, 1_000_000), dimension(metric, 40000, metric.endsWith('_token') || metric === 'audio_character' ? 1_000_000 : 1)];
        assert.match(render(category, [output], dimensions), /\$0\.08/);
        assert.match(render(category, [output], dimensions, 'official'), /\$0\.04/);
        assert.doesNotMatch(render(category, [output], dimensions), /Price unavailable|↑/);
    });
}

test('official absence is independent from valid user zero quote and unselected supplementary charges', () => {
    const dimensions = [dimension('request', 0, 1, false)];
    // No official price (e.g. a relay's own price for a model without one) reads "US$-", never a pending price.
    assert.match(render('audio', ['music'], dimensions, 'official'), /US\$-/);
    assert.match(render('audio', ['music'], dimensions), /\$0\.00/);
    assert.match(render('image', ['image'], [dimension('cached_input_token')]), /Prices available; see details/);
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        assert.notEqual(modelCenterText(locale, 'priceNotSummarized'), modelCenterText(locale, 'pricePending'));
    }
});

test('summary normalization honors declared unit sizes', () => {
    assert.match(render('image', ['image'], [dimension('image_output_token', 6000, 1000)], 'official'), /\$6\.00/);
    assert.match(render('text', ['text'], [dimension('input_token', 6000, 1000)], 'official'), /↑ \$6\.00/);
});
