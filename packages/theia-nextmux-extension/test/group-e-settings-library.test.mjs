import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const src = name => readFileSync(new URL(`../src/browser/${name}`, import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', src('nextmux-desktop-widget.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const cls = file.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'NextMuxDesktopWidget');
function method(name) { const node = cls.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(file) === name); assert.ok(node, name); return node.getText(file); }
function hooks() {
    const values = [], effects = []; let cursor = 0;
    const React = { useState(initial) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], v => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
        useRef(initial) { const i = cursor++; return values[i] ||= { current: initial }; }, useReducer(fn, initial) { const [v, set] = this.useState(initial); return [v, action => set(old => fn(old, action))]; },
        useEffect(fn) { effects.push(fn); }, useLayoutEffect() {}, createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat(Infinity).filter(Boolean) }; } };
    const load = name => {
        const exports = {}, realRequire = createRequire(new URL(`../lib/browser/${name}.js`, import.meta.url));
        Function('require', 'exports', 'window', 'navigator', readFileSync(new URL(`../lib/browser/${name}.js`, import.meta.url), 'utf8'))(id => {
            if (id === 'react' || id === '@theia/core/shared/react') return React;
            if (id.endsWith('.css')) return {};
            if (id === 'react-virtuoso') return { Virtuoso: () => null };
            if (id === './nextmux-surface-tooltips') return { SurfaceTooltips: () => null };
            if (id === '@theia/core/lib/common/uri') return { fromFilePath: path => ({ toString: () => `file://${path}` }) };
            return realRequire(id);
        }, exports, { addEventListener() {}, removeEventListener() {} }, {});
        return exports;
    };
    return { load, effects, render(component, props) { cursor = 0; effects.length = 0; return component(props); } };
}
function all(node, predicate) { if (!node || typeof node !== 'object') return []; return [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap(n => all(n, predicate))]; }
const flush = () => new Promise(resolve => setImmediate(resolve));
const asset = (assetId, category = 'other') => ({ assetId, assetName: assetId, assetType: 'image', assetCategory: category, mediaPath: `/library/${assetId}.png`, createdAt: '2026-10-20T00:00:00Z', source: { origin: 'local' } });
test('model capability tabs select immediately even with an empty loading catalogue', () => {
    const h = hooks(), { ModelVisibilitySettings, modelVisibilityCopy } = h.load('nextmux-model-visibility-settings');
    const props = { locale: 'zh-CN', preferences: {}, language: [], media: [], loading: true, onChange() {} };
    let tree = h.render(ModelVisibilitySettings, props), buttons = all(tree, n => n.props.role === 'tab');
    assert.equal(buttons.length, 6);
    for (const category of ['video', 'speech', 'music', 'soundEffect', 'transcription', 'image']) {
        buttons.find(n => n.props['data-model-category'] === category).props.onClick({ currentTarget: {} });
        tree = h.render(ModelVisibilitySettings, props); buttons = all(tree, n => n.props.role === 'tab');
        assert.deepEqual(buttons.filter(n => n.props['aria-selected']).map(n => n.props['data-model-category']), [category]);
    }
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        assert.ok(modelVisibilityCopy(locale)[16]); assert.ok(modelVisibilityCopy(locale)[17]);
    }
    assert.equal(modelVisibilityCopy('zh-CN')[16], '灰度测试模型');
});
test('shared library snapshots update an already-open modal and category moves call the shared mutation', async () => {
    const h = hooks(), { CanvasAssetLibraryDialog } = h.load('nextmux-comic-asset-library'), changed = [];
    const props = { locale: 'en', entries: [asset('old')], load: async () => [asset('stale-private-read')], onClose() {},
        onCategoryChange: async (...args) => { changed.push(args); } };
    h.render(CanvasAssetLibraryDialog, props); for (const effect of h.effects) effect(); await flush();
    let tree = h.render(CanvasAssetLibraryDialog, props);
    assert.deepEqual(all(tree, n => n.type === 'article').map(n => n.props['data-library-asset']), ['old']);
    props.entries = [asset('new')]; tree = h.render(CanvasAssetLibraryDialog, props);
    assert.deepEqual(all(tree, n => n.type === 'article').map(n => n.props['data-library-asset']), ['new']);
    await all(tree, n => n.props.className === 'nmx-library-reclassify-btn')[0].props.onClick(); await flush();
    assert.deepEqual(changed, [['new', 'character']]);
    props.entries = [asset('new', 'character')]; tree = h.render(CanvasAssetLibraryDialog, props);
    assert.equal(all(tree, n => n.props.className === 'nmx-library-reclassify-btn')[0].children[0], 'Move to Images');
});
test('library refresh rejects stale responses and retains its last snapshot on read failure', async () => {
    const Harness = Function(ts.transpile(`class Harness { ${method('refreshComicAssetLibrary')} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))();
    const pending = [], widget = Object.assign(new Harness(), { comicAssetLibraryLoadSequence: 0, comicAssetLibraryRevision: 0, comicAssetLibraryEntries: [asset('kept')],
        platformService: { listComicAssetLibrary: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) }, update() {} });
    const old = widget.refreshComicAssetLibrary(), latest = widget.refreshComicAssetLibrary();
    pending[1].resolve([asset('new')]); await latest; pending[0].resolve([asset('old')]); await old;
    assert.equal(widget.comicAssetLibraryEntries[0].assetId, 'new'); assert.equal(widget.comicAssetLibraryRevision, 1);
    const failed = widget.refreshComicAssetLibrary(); pending[2].reject(Error('offline')); await failed;
    assert.equal(widget.comicAssetLibraryEntries[0].assetId, 'new');
});
test('unified library exposes add-to-canvas only in the active infinite canvas surface', () => {
    const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
    const Harness = Function('React', 'CanvasModalLayer', 'CanvasAssetLibraryDialog', ts.transpile(`class Harness { ${method('renderUnifiedComicAssetLibrary')} }; return Harness;`, { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }))(React, 'layer', 'dialog');
    const ui = { surface: 'studio' }, instance = Object.assign(new Harness(), { activeSection: 'comic', comicUnifiedLibraryFilter: 'all', desktopLocale: 'zh-CN', activeComicWorkspaceRoot: '/project',
        comicChatUi: () => ui, comicDesk: { visible: true, step: 'canvas' }, comicCanvas: { doc: {}, workspaceRoot: '/project', canvasId: 'a' }, comicCanvasIsTracked: () => true,
        comicAssetLibraryEntries: [asset('shared')], platformService: {} });
    let props = instance.renderUnifiedComicAssetLibrary().children[0].props;
    assert.equal(props.entries, instance.comicAssetLibraryEntries); assert.equal(typeof props.onUse, 'function'); assert.equal(props.onManageCharacters, undefined);
    ui.editor = {}; props = instance.renderUnifiedComicAssetLibrary().children[0].props; assert.equal(props.onUse, undefined);
    ui.editor = undefined; ui.surface = 'chat'; assert.equal(instance.renderUnifiedComicAssetLibrary().children[0].props.onUse, undefined);
});
test('microphone selector sits in its permission row beside the actions and camera is absent', () => {
    const h = hooks(), { SystemPermissionsList } = h.load('nextmux-system-permissions-panel');
    const slot = { type: 'select', props: { id: 'mic-input' }, children: [] };
    const tree = h.render(SystemPermissionsList, { locale: 'zh-CN', state: { platform: 'darwin', version: 15, items: [{ kind: 'microphone', essential: true, status: 'granted' }] }, onState() {}, microphoneSlot: slot });
    const row = all(tree, n => n.type === 'li')[0];
    // One row like Screen Recording and Accessibility: copy, status, then the picker right before the buttons.
    const copy = row.children.find(n => n.type === 'div'); assert.equal(all(copy, n => n.props.id === 'mic-input').length, 0);
    const slotIndex = row.children.findIndex(n => n.props?.className === 'nmx-system-permission-slot');
    assert.ok(slotIndex > row.children.findIndex(n => n.type === 'span'), 'after the status pill');
    assert.ok(all(row.children[slotIndex], n => n.props.id === 'mic-input').length);
    const firstButton = row.children.findIndex(n => n.type === 'button');
    assert.ok(firstButton === -1 || slotIndex < firstButton, 'before the actions');
    assert.equal(all(row, n => n.props.className === 'nmx-system-permission-slot').length, 1);
    assert.equal(all(tree, n => /camera/i.test(String(n.props?.className || ''))).length, 0);
});
test('start-frame copy stays concise with visible cancel and separate image/video billing', () => {
    const { comicStartFrameText } = require('../lib/browser/nextmux-comic-start-frame-text.js');
    assert.equal(comicStartFrameText('zh-CN', 'feeNotice'), '图片与视频分别计费。');
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        assert.ok(comicStartFrameText(locale, 'hint')); assert.ok(comicStartFrameText(locale, 'feeNotice'));
    }
    assert.match(src('nextmux-comic-start-frame-panel.tsx'), /nmx-start-frame-cancel[^\n]+\{c\('cancel'\)\}/);
    assert.doesNotMatch(src('nextmux-comic-start-frame-panel.tsx'), /\{t\('feeNotice'\)\} ·/);
});
test('cost header and cost cells expose complete text and merged privacy remains advisory', () => {
    assert.match(method('renderSettings'), /<span title=\{localizeDesktopSurface\(this.desktopLocale, '费用'\)\}>费用/);
    assert.match(method('renderSettings'), /<span title=\{this.formatMoneyMicros\(item.currency, item.chargedMicros\)\}>/);
    const { upstreamPrivacyPreference } = require('../lib/common/nextmux-upstream-privacy-preference.js');
    for (const settings of [{ requireZeroDataRetention: true, denyDataCollection: false }, { requireZeroDataRetention: false, denyDataCollection: true }]) {
        assert.deepEqual(upstreamPrivacyPreference(settings), { mode: 'advisory-v1', zeroDataRetention: true, dataCollection: 'deny' });
    }
});
test('material drawer outside handler closes on external menus as well as the page', () => {
    const source = ts.createSourceFile('chat.tsx', src('nextmux-comic-chat-view.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const panel = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'ComicMaterialsPanel');
    let callback; const walk = n => { if (ts.isVariableDeclaration(n) && n.name.getText(source) === 'handleOutsidePress') callback = n.initializer.getText(source); ts.forEachChild(n, walk); }; walk(panel);
    let closes = 0; class Element { constructor(selector = '') { this.selector = selector; } closest(selectors) { return this.selector && selectors.includes(this.selector); } }
    const handler = Function('Element', 'panel', 'props', ts.transpile(`return (${callback});`, { target: ts.ScriptTarget.ES2022 }))(Element, { current: { contains: () => false } }, { onClose: () => closes++ });
    handler({ target: new Element('.nmx-comic-chat-menu') }); handler({ target: new Element() }); assert.equal(closes, 2);
    handler({ target: new Element('.nmx-comic-materials-btn') }); assert.equal(closes, 2, 'trigger owns its own toggle');
});
