import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const filename = fileURLToPath(new URL('./frame-extract-tools-runtime.cjs', import.meta.url));
const { outputFiles } = await desktop('esbuild').build({
    entryPoints: [fileURLToPath(new URL('../src/browser/nextmux-comic-canvas-tools.tsx', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external'
});
const runtime = new Module(filename);
runtime.filename = filename;
runtime.paths = Module._nodeModulePaths(dirname(filename));
runtime._compile(outputFiles[0].text, filename);
const { CanvasFrameExtractDialog, canvasFrameTimeSelection } = runtime.exports;
const React = core('react'), { renderToStaticMarkup } = core('react-dom/server');
const video = { id: 'captured-video-v1', assetId: 'asset-1', kind: 'video', uri: 'nextmux.media/source-v1.mp4',
    createdAt: '2026-10-04T00:00:00Z', status: 'ready', metadata: { durationMs: 2345 } };
const render = (overrides = {}) => renderToStaticMarkup(React.createElement(CanvasFrameExtractDialog, {
    locale: 'en', version: video, mediaUrl: uri => `https://media.test/${uri}`, busy: false,
    onRun: async () => assert.fail('rendering must not start extraction'), onClose: () => {}, ...overrides
}));
const submit = html => html.match(/<button\b[^>]*class="nmx-board-generate"[^>]*>/)?.[0];

test('custom capture passes a real millisecond request, not a guessed frame index', () => {
    assert.deepEqual(canvasFrameTimeSelection('0', 2345), { kind: 'time', timeMs: 0 });
    assert.deepEqual(canvasFrameTimeSelection('1.234', 2345), { kind: 'time', timeMs: 1234 });
    assert.deepEqual(canvasFrameTimeSelection('2.345', 2345), { kind: 'last' });
    assert.deepEqual(canvasFrameTimeSelection('1.2345'), { kind: 'time', timeMs: 1235 });
    for (const value of ['', ' ', '-0.001', 'Infinity', 'NaN', '2.346', '9007199254740992'])
        assert.equal(canvasFrameTimeSelection(value, 2345), undefined, value);
});

test('custom picker renders the captured video and controls without a configuration node', () => {
    const html = render();
    assert.match(html, /role="dialog" aria-modal="true" aria-label="At time"/);
    assert.match(html, /src="https:\/\/media\.test\/nextmux\.media\/source-v1\.mp4"/);
    assert.match(html, /type="number"[^>]*min="0"[^>]*max="2.345"[^>]*step="0.001"/);
    assert.match(html, /type="range"[^>]*max="2345"[^>]*step="1"/);
    assert.ok(submit(html));
    assert.doesNotMatch(submit(html), /disabled/);
    assert.doesNotMatch(html, /data-node-panel|is-frame|react-flow__node/);
});

test('busy capture and unavailable/non-video sources cannot submit', () => {
    for (const overrides of [{ busy: true }, { version: { ...video, kind: 'image' } },
        { version: { ...video, status: 'missing' } }, { version: { ...video, status: 'uploading' } }, { version: { ...video, uri: '' } }])
        assert.match(submit(render(overrides)), /disabled=""/);
    const html = render({ busy: true });
    assert.match(html, /type="number"[^>]*disabled=""/);
    assert.match(html, /type="range"[^>]*disabled=""/);
    assert.doesNotMatch(html, /<video[^>]*\scontrols/);
});

test('missing duration retains explicit time entry without a fabricated range', () => {
    const html = render({ version: { ...video, metadata: {} } });
    assert.match(html, /type="number"/);
    assert.doesNotMatch(html, /type="range"/);
    assert.doesNotMatch(submit(html), /disabled/);
});

test('custom picker uses existing translations in all twelve interface languages', () => {
    const labels = new Set();
    for (const locale of ['zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        const html = render({ locale });
        const label = html.match(/role="dialog" aria-modal="true" aria-label="([^"]+)"/)?.[1];
        assert.ok(label && label !== 'extractAt', locale);
        labels.add(label);
        assert.doesNotMatch(html, /\{(?:n|error)\}/);
    }
    assert.equal(labels.size, 12);
});
