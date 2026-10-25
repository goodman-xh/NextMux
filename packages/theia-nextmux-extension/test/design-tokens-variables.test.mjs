import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// nextmux-Variables.css holds the desktop design tokens taken from the Codex
// desktop app (typography, Shiki "Codex Light/Dark" syntax colours) and the
// final component layer. These checks read the stylesheet as text, so they run
// without a browser.
const css = readFileSync(new URL('../src/browser/style/nextmux-Variables.css', import.meta.url), 'utf8');
const frontendModule = readFileSync(new URL('../src/browser/nextmux-frontend-module.ts', import.meta.url), 'utf8');
const compact = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();

/** Declarations of the first rule whose selector text contains `selector`. */
function block(selector) {
    // Match a whole selector list only: the rule must start after a closing brace.
    const marker = `} ${selector} {`;
    const found = compact.indexOf(marker);
    const index = found >= 0 ? found + 2 : compact.startsWith(`${selector} {`) ? 0 : -1;
    assert.ok(index >= 0, `rule for ${selector}`);
    const start = compact.indexOf('{', index) + 1;
    return compact.slice(start, compact.indexOf('}', start));
}

test('the stylesheet loads after every component sheet and right before motion presets', () => {
    const imports = [...frontendModule.matchAll(/import '\.\.\/\.\.\/src\/browser\/style\/([\w.-]+\.css)';/g)].map(match => match[1]);
    assert.equal(imports.at(-1), 'nextmux-motion.css', 'motion stays the last stylesheet');
    assert.equal(imports.at(-2), 'nextmux-Variables.css');
});

test('UI and code font stacks follow Codex desktop with CJK faces before the generic family', () => {
    const tokenStart = compact.indexOf('body:has(#nextmux\\.desktop\\.widget:not(.lm-mod-hidden)) {');
    assert.ok(tokenStart >= 0, 'typography token rule');
    const tokens = compact.slice(compact.indexOf('{', tokenStart) + 1, compact.indexOf('}', tokenStart));
    const ui = /--nmxv-font-ui: ([^;]+);/.exec(tokens)?.[1] || '';
    assert.match(ui, /^-apple-system-body, ui-sans-serif, -apple-system, system-ui, "Segoe UI", "Helvetica", "Apple Color Emoji", "Arial"/);
    assert.ok(ui.indexOf('"Microsoft YaHei UI"') < ui.indexOf(' sans-serif'), 'Windows CJK text never falls back to SimSun');
    const mono = /--nmxv-font-mono: ([^;]+);/.exec(tokens)?.[1] || '';
    assert.match(mono, /^ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono"/);
    assert.match(tokens, /--nmxv-text-base: 14px; --nmxv-text-sm: 13px; --nmxv-text-xs: 12px;/);
    for (const alias of ['--nmx-ui-font', '--theia-ui-font-family', '--nmx-code-font', '--nmx-mono-font', '--theia-code-font-family', '--monaco-monospace-font']) {
        assert.match(tokens, new RegExp(`${alias}: var\\(--nmxv-font-(?:ui|mono)\\) !important;`), alias);
    }
});

test('composer, timestamps and code use the Codex sizes', () => {
    const composer = block('#nextmux\\.desktop\\.widget .nmx-shell :is(.nmx-composer textarea, .nmx-composer-markdown-overlay, .nmx-comic-chat-dock textarea)');
    assert.match(composer, /font-size: var\(--nmxv-text-base\) !important;/);
    assert.match(composer, /letter-spacing: 0 !important;/, 'textarea and overlay stay metrically identical');
    const time = block('#nextmux\\.desktop\\.widget .nmx-shell :is(.nmx-turn-copy time, .nmx-task-turn time, .nmx-turn-meta time)');
    assert.match(time, /font-size: var\(--nmxv-text-xs\) !important;/);
    assert.match(time, /font-variant-numeric: lining-nums tabular-nums !important;/);
});

test('code tokens use the Codex Dark and Codex Light palettes', () => {
    const dark = block('.nmx-md-code, .nmx-shell .nmx-md-code');
    const light = block('.nmx-theme-light .nmx-md-code, .nmx-shell.nmx-theme-light .nmx-md-code');
    const expected = { keyword: ['#f67576', '#d53538'], string: ['#85df7b', '#008809'], number: ['#6dcbf4', '#0071ea'],
        function: ['#b06dff', '#751ed9'], property: ['#fa994c', '#bd5800'], comment: ['#999999', '#666666'] };
    for (const [token, [darkValue, lightValue]] of Object.entries(expected)) {
        assert.match(dark, new RegExp(`--md-tok-${token}: ${darkValue} !important;`), `dark ${token}`);
        assert.match(light, new RegExp(`--md-tok-${token}: ${lightValue} !important;`), `light ${token}`);
    }
});

test('the top-left logo never paints a hover, press or focus background', () => {
    const logo = block('#nextmux\\.desktop\\.widget .nmx-context-product, #nextmux\\.desktop\\.widget .nmx-context-product:is(:hover, :active, :focus, :focus-visible, .is-active)');
    assert.match(logo, /background: transparent !important;/);
    assert.match(logo, /box-shadow: none !important;/);
});

test('file path pills stay compact on one line, cut at the start of the path and keep the name', () => {
    const pill = block('.nmx-shell .nmx-file-path-pill');
    assert.match(pill, /white-space: nowrap;/);
    assert.match(pill, /max-width: min\(100%, 24ch\);/, 'an inline pill never runs across the prose');
    const parts = block('.nmx-shell .nmx-file-path-dir, .nmx-shell .nmx-file-path-name');
    assert.match(parts, /direction: rtl;/);
    assert.match(parts, /text-overflow: clip;/, 'the name is clipped (and faded), never given an ellipsis');
    const directory = block('.nmx-shell .nmx-file-path-dir');
    assert.match(directory, /max-width: 9ch;/);
    assert.match(directory, /text-overflow: ellipsis;/, 'the directory ends in an ellipsis at its start (RTL box)');
    assert.match(block('.nmx-shell .nmx-file-path-name'), /flex: 0 0 auto;/, 'the name does not shrink before the directory');
    assert.match(block('.nmx-shell :is(.nmx-stream-file-entry-name, .nmx-review-file-path) .nmx-file-path-pill'), /max-width: 100%;/,
        'in a file list the row bounds the path');
    assert.match(compact, /@supports \(animation-timeline: scroll\(self inline\)\) \{ \.nmx-shell \.nmx-file-path-name \{/, 'the fade only appears while the name overflows');
    assert.match(compact, /mask-image: linear-gradient\(to right, transparent 0, #000 1\.7em\)/);
});

test('the goal banner docks flush on the composer top edge', () => {
    const goal = block('#nextmux\\.desktop\\.widget .nmx-shell .nmx-coding-goal');
    assert.match(goal, /border-bottom: 0 !important;/);
    assert.match(goal, /border-radius: 12px 12px 0 0 !important;/);
    assert.match(goal, /margin: 0 14px -1px !important;/);
    assert.match(block('#nextmux\\.desktop\\.widget .nmx-shell .nmx-coding-goal + .nmx-composer'), /margin-top: 0 !important;/);
});

test('every new animation has a reduced-motion opt-out', () => {
    const reduced = compact.slice(compact.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const selector of ['.nmx-goal-drawer', '.nmx-plugin-modal', '.nmx-floating-toast', '.nmx-council-modal-backdrop', '.nmx-image-lightbox']) {
        assert.ok(reduced.includes(selector), selector);
    }
});
