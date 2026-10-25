import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

// Stage 3e: the cost summary under a desk/canvas confirmation, and the add-funds action of a balance error.
const require = createRequire(import.meta.url);
require.extensions['.css'] ??= () => {};
const React = require('react');
const { renderToStaticMarkup } = createRequire(require.resolve('@theia/core/package.json'))('react-dom/server');
const { ConfirmCost } = require('../lib/browser/nextmux-comic-desk.js');
const css = name => readFileSync(new URL(`../src/browser/style/${name}`, import.meta.url), 'utf8');

test('the cost summary lists each step, keeps the total and balance apart, and says a shortfall plainly', () => {
    const html = renderToStaticMarkup(React.createElement(ConfirmCost, { cost: {
        rows: [{ label: 'Set plates', detail: '× 2', amount: 'US$0.20' }, { label: 'Clips', detail: '× 3 · 15 s', amount: 'US$1.50' }],
        total: { label: 'Estimated total', amount: 'US$1.70' }, balance: { label: 'Available balance', amount: 'US$1.00' }, short: 'US$0.70 short', note: 'An estimate.' } }));
    assert.match(html, /^<div class="nmx-desk-confirm-cost is-short">/);
    assert.match(html, /<dl class="nmx-desk-confirm-cost-rows">.*Set plates.*<span class="nmx-desk-confirm-cost-detail" data-nmx-literal="true">× 2<\/span>.*<dd><bdi>US\$0\.20<\/bdi><\/dd>/);
    assert.match(html, /<dl class="nmx-desk-confirm-cost-sum"><div class="nmx-desk-confirm-cost-row is-total">.*US\$1\.70.*<div class="nmx-desk-confirm-cost-row is-balance">.*US\$1\.00/);
    assert.match(html, /<p class="nmx-desk-confirm-cost-short" role="status"><i class="codicon codicon-warning" aria-hidden="true"><\/i><span>US\$0\.70 short<\/span><\/p>/);
    assert.match(html, /<p class="nmx-desk-confirm-cost-note">An estimate\.<\/p>/);
    // Covered: no shortfall class, no total when there is one row and no sum.
    const plain = renderToStaticMarkup(React.createElement(ConfirmCost, { cost: { rows: [{ label: 'Video', amount: 'US$0.50' }] } }));
    assert.match(plain, /^<div class="nmx-desk-confirm-cost">/);
    assert.doesNotMatch(plain, /nmx-desk-confirm-cost-sum|nmx-desk-confirm-cost-short/);
});

test('amounts line up in tabular numerals, the list scrolls while the total stays, and actions keep their tint in light theme', () => {
    const desk = css('nextmux-comic-desk.css'), canvas = css('nextmux-comic-canvas.css');
    assert.match(desk, /\.nmx-desk-confirm-cost \{[^}]*font-variant-numeric: tabular-nums/);
    assert.match(desk, /\.nmx-desk-confirm-cost-rows \{[^}]*max-height: 216px; overflow-y: auto/);
    assert.match(desk, /\.nmx-desk-confirm > p \{[^}]*white-space: pre-line/);
    assert.match(desk, /\.nmx-desk-error\.has-action \{ display: flex/);
    assert.match(desk, /\.nmx-shell\.nmx-theme-light \.nmx-desk-error-action \{ border-color: [^}]*!important/);
    assert.match(canvas, /\.nmx-desk-canvas-notice\.has-action \{/);
    assert.match(canvas, /\.nmx-shell\.nmx-theme-light \.nmx-desk-canvas-notice-action \{ border-color: [^}]*!important/);
    // A balance notice on the canvas and the desk offers to add funds.
    const widget = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    assert.match(widget, /className='nmx-desk-canvas-notice-action'/);
    assert.match(widget, /desk\.error === desk\.balanceError \? \{ errorAction: \{ label: mediaBudgetText\(this\.desktopLocale, 'topUp'\), onClick: \(\) => this\.openWalletTopup\(\) \} \}/);
});
