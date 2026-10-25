import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { loadCanvasToolsSource } from './helpers/canvas-tools-source-loader.mjs';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const React = core('react');
const { renderToStaticMarkup } = core('react-dom/server');
const copy = await loadCanvasToolsSource('browser/nextmux-comic-canvas-tools-text.ts');
const models = await loadCanvasToolsSource('common/nextmux-canvas-on-device-models.ts');
const canvasCopy = await loadCanvasToolsSource('browser/nextmux-comic-canvas-text.ts');
const source = await readFile(new URL('../src/browser/nextmux-comic-canvas-tools.tsx', import.meta.url), 'utf8');

// Isolate the dialog/menu from the canvas host, keeping production React markup and form callbacks.
function loadUi(react = React) {
    const imports = {
        '@theia/core/shared/react': react,
        '@theia/core/shared/react-dom': { createPortal: value => value },
        '@xyflow/react': { useViewport: () => ({ x: 0, y: 0, zoom: 1 }) },
        './nextmux-ime-field': { ImeInput: props => React.createElement('input', props) },
        './nextmux-comic-canvas-logic': { focusDialogOnMount() {} },
        './nextmux-comic-canvas-tools-text': copy,
        '@nextmux/comic-core/canvas-image-tools': { CANVAS_IMAGE_TOOLS: {} },
        '../common/nextmux-canvas-local-image-tools': {},
        './nextmux-comic-canvas-ai-tools': { AI_IMAGE_TOOL_GROUPS: [] },
        '../common/nextmux-canvas-on-device-models': models,
        './nextmux-comic-canvas-text': canvasCopy
    };
    const output = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }
    }).outputText;
    const exports = {};
    new Function('require', 'exports', output)(id => {
        assert.ok(id in imports, `Known isolated UI dependency: ${id}`);
        return imports[id];
    }, exports);
    return exports;
}

const ui = loadUi();
const version = { id: 'v1', assetId: 'a1', kind: 'image', uri: 'assets/source.png', createdAt: '2026-10-01T00:00:00.000Z', metadata: { width: 641, height: 359 } };
const props = (tool, extra = {}) => ({ locale: 'en', tool, version, mediaUrl: uri => uri, busy: false,
    onPickLut: async () => undefined, onRun() {}, onCancel() {}, onClose() {}, ...extra });
const descendants = element => !React.isValidElement(element) ? [] : [element,
    ...React.Children.toArray(element.props.children).flatMap(descendants)];

test('all 12 locale tables explicitly translate every on-device key and preserve the size placeholder', async () => {
    const filename = 'nextmux-comic-canvas-tools-text.ts';
    const syntax = ts.createSourceFile(filename, await readFile(new URL(`../src/browser/${filename}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const declarations = new Map(syntax.statements.filter(ts.isVariableStatement)
        .flatMap(statement => statement.declarationList.declarations).map(declaration => [declaration.name.text, declaration.initializer]));
    const keys = ['tool.image.matting', 'tool.image.depth', 'hint.image.matting', 'hint.image.depth', 'localModelDownload', 'invertDepth', 'tool.video.depth', 'hint.video.depth', 'depthResolution', 'depthSource', 'smoothDepth'];
    for (const property of declarations.get('TEXT').properties) {
        const entries = new Map(declarations.get(property.initializer.text).properties.map(entry => [entry.name.text, entry.initializer.text]));
        for (const key of keys) {
            assert.ok(entries.get(key)?.trim(), `${property.name.text}:${key} is explicit`);
            assert.equal(copy.toolText(property.name.text, key), entries.get(key));
        }
        assert.deepEqual([...entries.get('localModelDownload').matchAll(/\{(\w+)\}/g)].map(match => match[1]), ['size']);
        assert.ok(entries.get('hint.image.matting').includes('PNG'));
    }
});

test('on-device dialogs show the pinned first-use model sizes in all 12 languages', () => {
    assert.equal(copy.COMIC_CANVAS_TOOL_LOCALES.length, 12);
    for (const locale of copy.COMIC_CANVAS_TOOL_LOCALES) {
        for (const tool of ['image.matting', 'image.depth']) {
            const markup = renderToStaticMarkup(React.createElement(ui.ToolDialog, props(tool, { locale })));
            assert.ok(markup.includes(`${models.CANVAS_ON_DEVICE_MODELS[tool].downloadMiB} MiB`), `${locale}:${tool} model size`);
            assert.doesNotMatch(markup, /\{size\}|localModelDownload|aiNoModel/);
            assert.ok(copy.toolText(locale, `tool.${tool}`).trim());
            assert.ok(copy.toolText(locale, `hint.${tool}`).trim());
        }
    }
});

test('depth defaults to near-bright and locks its inversion setting during processing', () => {
    const ready = renderToStaticMarkup(React.createElement(ui.ToolDialog, props('image.depth')));
    assert.match(ready, /type="checkbox"/);
    assert.doesNotMatch(ready, /checked=""/);
    const busy = renderToStaticMarkup(React.createElement(ui.ToolDialog, props('image.depth', { busy: true, progress: 0.42 })));
    assert.match(busy, /type="checkbox"[^>]*disabled=""/);
    assert.match(busy, /42%/);
    assert.match(busy, />Cancel<\/button>/);
    const matting = renderToStaticMarkup(React.createElement(ui.ToolDialog, props('image.matting')));
    assert.doesNotMatch(matting, /type="checkbox"/);
});

test('depth toggle submits an explicit boolean to the existing local-tool callback', () => {
    const states = [];
    let cursor = 0;
    const hooked = loadUi({ ...React, useRef: () => ({ current: null }), useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], next => { states[index] = next; }];
    } });
    const received = [];
    const dialogProps = props('image.depth', { onRun: value => received.push(value) });
    const render = () => { cursor = 0; return descendants(hooked.ToolDialog(dialogProps)); };
    let elements = render();
    elements.find(element => element.props.className === 'nmx-board-generate').props.onClick();
    assert.deepEqual(received.pop(), { invert: false });
    elements.find(element => element.type === 'input' && element.props.type === 'checkbox').props.onChange({ currentTarget: { checked: true } });
    elements = render();
    assert.equal(elements.find(element => element.type === 'input' && element.props.type === 'checkbox').props.checked, true);
    elements.find(element => element.props.className === 'nmx-board-generate').props.onClick();
    assert.deepEqual(received.pop(), { invert: true });
});

test('both local operations are reachable in the image menu without a provider model', () => {
    const hooked = loadUi({ ...React, useRef: () => ({ current: null }), useLayoutEffect() {},
        useState: initial => [initial ?? {}, () => {}] });
    const picked = [];
    const elements = descendants(hooked.ToolMenu({ locale: 'en', kind: 'image', onPick: value => picked.push(value) }));
    for (const tool of ['image.matting', 'image.depth']) {
        const button = elements.find(element => element.type === 'button' && element.props.children === copy.toolText('en', `tool.${tool}`));
        assert.ok(button, `${tool} is a local menu item`);
        button.props.onClick();
        assert.equal(picked.at(-1), tool);
        assert.equal(ui.toolRunsImmediately(tool), false, `${tool} exposes its first-use dialog`);
    }
});


test('video depth is local, submits source/invert/smooth defaults and exposes the three short-side choices', () => {
    const states = []; let cursor = 0;
    const hooked = loadUi({ ...React, useRef: () => ({ current: null }), useLayoutEffect() {}, useState(initial) {
        const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], next => { states[index] = next; }];
    } });
    const received = [], settings = props('video.depth', { version: { ...version, kind: 'video' }, onRun: value => received.push(value) });
    const render = () => { cursor = 0; return descendants(hooked.ToolDialog(settings)); };
    let elements = render();
    elements.find(element => element.props.className === 'nmx-board-generate').props.onClick();
    assert.deepEqual(received.pop(), { resolution: 'source', invert: false, smooth: true });
    assert.deepEqual(elements.filter(element => element.type === 'option').map(element => element.props.value), ['source', '720', '480']);
    elements.find(element => element.type === 'select').props.onChange({ currentTarget: { value: '480' } });
    elements.filter(element => element.type === 'input' && element.props.type === 'checkbox')[1].props.onChange({ currentTarget: { checked: false } });
    elements = render(); elements.find(element => element.props.className === 'nmx-board-generate').props.onClick();
    assert.deepEqual(received.pop(), { resolution: '480', invert: false, smooth: false });
    for (const locale of copy.COMIC_CANVAS_TOOL_LOCALES) {
        const html = renderToStaticMarkup(React.createElement(ui.ToolDialog, { ...settings, locale, busy: true }));
        assert.ok(html.includes('26 MiB')); assert.match(html, /<select[^>]*disabled/);
    }
});
