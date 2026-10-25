import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Clicking a tab (pointer focus) used to run `box-shadow: none !important` on it, which erased the
// inset-shadow underline or pill of the selected tab until focus moved elsewhere (选择中转商 tabs
// 中转商 / 收藏 / 我的 API, plugin center, model center, comic and canvas tabs).
const read = name => readFileSync(new URL(`../src/browser/style/${name}`, import.meta.url), 'utf8').replace(/\s+/g, ' ');

test('pointer focus clears focus rings but never a selected element’s own indicator', () => {
    const css = read('nextmux.css');
    const resets = [...css.matchAll(/([^{}]*:focus:not\(:focus-visible\)[^{}]*)\{([^}]*box-shadow: none !important[^}]*)\}/g)]
        .filter(([, selector]) => /:is\(\.nmx-desktop-widget, [^)]*\) :is\(button, a, input, select, textarea, summary\)/.test(selector));
    assert.equal(resets.length, 1, 'one box-shadow reset for pointer focus');
    // Surfaces portalled to <body> get the same reset (canvas dialogs, global history, price cards, council popovers).
    for (const surface of ['.nmx-board-modal-layer', '.nmx-canvas-history', '.nmx-offering-price-pop', '.nmx-council-popover', '.nmx-portal']) {
        assert.ok(resets[0][1].includes(surface), `covers ${surface}`);
    }
    for (const state of ["[aria-selected='true']", "[aria-current='page']", "[aria-pressed='true']", '.is-active', '.is-selected']) {
        assert.ok(resets[0][1].includes(state), `exempts ${state}`);
    }
});

test('the design layer does not force an extra underline onto pill or segmented tabs', () => {
    const css = read('nextmux-Variables.css');
    assert.doesNotMatch(css, /\.nmx-titlebar-primary-nav > button:is\(\.is-active[^{]*\)::after/);
    assert.doesNotMatch(css, /\.nmx-plugins-tabs > button:is\([^)]*\)[^{]*::after \{ content: '' !important/);
});

test('the light theme’s universal border colour never outlines inactive canvas tabs', () => {
    const css = read('nextmux-Variables.css');
    assert.match(css, /\.nmx-theme-light \.nmx-canvas-tab:not\(:has\(\[aria-selected='true'\]\)\), \.nmx-theme-light \.nmx-canvas-tabs-dialog button:last-child \{ border-color: transparent !important; \}/);
    assert.match(css, /\.nmx-theme-light \.nmx-canvas-tabs-dialog input:focus \{ border-color: var\(--cv-ring\) !important; \}/);
});
