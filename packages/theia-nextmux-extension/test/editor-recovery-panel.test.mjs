import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url), coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const React = coreRequire('react'), { renderToStaticMarkup } = coreRequire('react-dom/server');
const desktopRequire = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
function sourceModule(filename) {
    const { outputFiles } = desktopRequire('esbuild').buildSync({ entryPoints: [fileURLToPath(new URL(`../src/browser/${filename}`, import.meta.url))],
        bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], logLevel: 'silent' });
    const module = { exports: {} };
    Function('require', 'module', 'exports', outputFiles[0].text)(name => name === 'react' ? React : require(name), module, module.exports);
    return module.exports;
}
const { NextMuxEditorRecoveryPanel } = sourceModule('nextmux-editor-recovery-panel.tsx');
const { editorRecoveryText, editorRecoveryErrorKey, editorSaveAsErrorKey } = sourceModule('nextmux-editor-recovery-locale.ts');
const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const keys = ['title', 'setting', 'settingBody', 'memory', 'saving', 'saved', 'failed', 'readonly', 'unavailable', 'open', 'retry', 'discard', 'confirmDiscard', 'cancel', 'empty', 'tooLarge', 'quota', 'disabled', 'conflict', 'copyAll', 'copied'];
const saveAsKeys = ['saveAs', 'savedAs', 'saveAsExists', 'saveAsSource', 'saveAsTooLarge', 'saveAsChanged', 'saveAsUnsupported', 'saveAsFailed'];
const entry = { key: 'one', name: 'synthetic <script>.txt', path: '/synthetic/only.txt', status: 'saved', version: 'local:one:1:1' };
const props = { locale: 'en', entries: [entry], onOpen() {}, onRetry() {}, onDiscard() {} };
const walk = element => !element || typeof element !== 'object' ? [] : [element, ...React.Children.toArray(element.props?.children).flatMap(walk)];
const button = (tree, text) => walk(tree).find(item => item.type === 'button' && item.props.children === text);
const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
// Execute real component handlers with isolated hook state; not a browser/layout test.
function harness(initial) {
    let current = initial, index = 0; const slots = [];
    return { setProps(next) { current = next; }, render() {
        const dispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
        const previous = dispatcher.current; index = 0;
        dispatcher.current = {
            useState(value) { const at = index++; if (!(at in slots)) slots[at] = value; return [slots[at], next => { slots[at] = next; }]; },
            useRef(value) { const at = index++; if (!(at in slots)) slots[at] = { current: value }; return slots[at]; }, useEffect() {}
        };
        try { return NextMuxEditorRecoveryPanel(current); } finally { dispatcher.current = previous; }
    } };
}

test('recovery panel has 21 fixed messages in all 12 locales and explicitly distinguishes backup from source saving', () => {
    for (const locale of locales) {
        for (const key of keys) assert.ok(editorRecoveryText(locale, key)?.length > 0, `${locale}/${key}`);
        const html = renderToStaticMarkup(React.createElement(NextMuxEditorRecoveryPanel, { ...props, locale }));
        assert.ok(html.includes(editorRecoveryText(locale, 'saved')));
        assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
        if (locale === 'ar') assert.match(html, /dir="rtl"/);
    }
    assert.match(editorRecoveryText('en', 'saved'), /original unsaved/);
    assert.match(editorRecoveryText('en', 'settingBody'), /without changing original/);
});

test('all twelve copy labels identify the current side and do not present copying as file persistence', () => {
    for (const locale of locales) {
        assert.ok(editorRecoveryText(locale, 'copyAll'));
        assert.ok(editorRecoveryText(locale, 'copied'));
        assert.notEqual(editorRecoveryText(locale, 'copied'), editorRecoveryText(locale, 'saved'));
    }
    assert.match(editorRecoveryText('en', 'copyAll'), /all text on this side/);
    assert.match(editorRecoveryText('en', 'copied'), /file was not saved/);
    assert.match(editorRecoveryText('zh-CN', 'copyAll'), /当前侧全文/);
    assert.match(editorRecoveryText('zh-CN', 'copied'), /尚未保存/);
});

test('Save As has all eight new messages in twelve locales and never labels a separate export as source persistence', () => {
    for (const locale of locales) {
        for (const key of saveAsKeys) assert.ok(editorRecoveryText(locale, key)?.length > 0, `${locale}/${key}`);
        assert.notEqual(editorRecoveryText(locale, 'savedAs'), editorRecoveryText(locale, 'saved'));
        assert.notEqual(editorRecoveryText(locale, 'savedAs'), editorRecoveryText(locale, 'copied'));
    }
    assert.match(editorRecoveryText('en', 'saveAs'), /this side.*new file/);
    assert.match(editorRecoveryText('en', 'savedAs'), /original and recovery copy are unchanged/);
    assert.match(editorRecoveryText('zh-CN', 'savedAs'), /原文件未改动.*恢复副本仍保留/);
    const expected = { TARGET_EXISTS: 'saveAsExists', SAME_SOURCE: 'saveAsSource', TOO_LARGE: 'saveAsTooLarge',
        CANCELLED: 'saveAsChanged', UNSUPPORTED_FILESYSTEM: 'saveAsUnsupported', INVALID_URI: 'saveAsFailed',
        INVALID_REQUEST: 'saveAsFailed', UNSAFE_PATH: 'saveAsFailed', UNAVAILABLE: 'saveAsFailed' };
    for (const [code, key] of Object.entries(expected)) assert.equal(editorSaveAsErrorKey({ code: `EDITOR_SAVE_AS_${code}` }), key);
    assert.equal(editorSaveAsErrorKey(new Error('PRIVATE_BODY_AND_PATH_SENTINEL')), 'saveAsFailed');
});

test('list retains 32 durable plus 32 local entries, is bounded to 64, and never exposes raw error content', () => {
    const html = renderToStaticMarkup(React.createElement(NextMuxEditorRecoveryPanel, { ...props,
        entries: Array.from({ length: 70 }, (_, i) => ({ ...entry, key: String(i), status: i < 32 ? 'saved' : 'error', error: 'SENSITIVE_EXCEPTION_BODY' })) }));
    assert.equal((html.match(/data-recovery-key=/g) || []).length, 64);
    assert.match(html, /data-recovery-key="63"/);
    assert.doesNotMatch(html, /SENSITIVE_EXCEPTION_BODY/);
    assert.equal(editorRecoveryErrorKey('EDITOR_RECOVERY_QUOTA_EXCEEDED'), 'quota');
    assert.equal(editorRecoveryErrorKey('EDITOR_RECOVERY_UNSAFE_PATH'), 'unavailable');
    assert.equal(editorRecoveryErrorKey('arbitrary error'), 'failed');
});

test('delete is a two-click inline confirmation scoped to just the selected entry and double submission is locked', async () => {
    const deleted = []; let resolve;
    const h = harness({ ...props, entries: [entry, { ...entry, key: 'two' }], onDiscard: (key, version) => { deleted.push([key, version]); return new Promise(r => { resolve = r; }); } });
    button(h.render(), 'Delete copy').props.onClick(); assert.deepEqual(deleted, []);
    const confirmation = walk(h.render()).find(item => item.props?.className === 'nmx-editor-recovery-confirm');
    assert.ok(confirmation); assert.ok(button(confirmation, 'Cancel'));
    const submit = button(confirmation, 'Delete copy'); submit.props.onClick(); submit.props.onClick();
    assert.deepEqual(deleted, [['one', entry.version]]);
    assert.ok(walk(h.render()).filter(item => item.type === 'button').every(item => item.props.disabled));
    resolve(); await flush(); assert.equal(walk(h.render()).some(item => item.props?.className === 'nmx-editor-recovery-confirm'), false);
});

test('a stale confirmation cannot discard a changed or removed copy even before effects run', () => {
    for (const entries of [[{ ...entry, version: 'local:one:2:2' }], []]) {
        let calls = 0; const h = harness({ ...props, onDiscard() { calls++; } });
        button(h.render(), 'Delete copy').props.onClick();
        const staleConfirm = button(h.render(), 'Delete copy');
        h.setProps({ ...props, entries, onDiscard() { calls++; } }); h.render();
        // Invoking an old handler simulates the narrow render/effect interval.
        staleConfirm.props.onClick(); assert.equal(calls, 0);
        assert.equal(walk(h.render()).some(item => item.props?.className === 'nmx-editor-recovery-confirm'), false);
    }
});

test('cancel never discards, and failed callbacks show fixed inline error while preserving the selected copy', async () => {
    let calls = 0;
    const h = harness({ ...props, onDiscard() { calls++; throw new Error('SENSITIVE_FAILURE'); } });
    button(h.render(), 'Delete copy').props.onClick(); button(h.render(), 'Cancel').props.onClick(); assert.equal(calls, 0);
    button(h.render(), 'Delete copy').props.onClick(); button(h.render(), 'Delete copy').props.onClick(); await flush();
    assert.equal(calls, 1); const tree = h.render();
    assert.equal(walk(tree).find(item => item.props?.role === 'alert').props.children, editorRecoveryText('en', 'failed'));
    assert.ok(walk(tree).find(item => item.props?.className === 'nmx-editor-recovery-confirm'));
});

test('confirmation reveals its mounted element with a stable ref rather than scrolling on every rerender', () => {
    const h = harness(props), calls = [];
    button(h.render(), 'Delete copy').props.onClick();
    const first = walk(h.render()).find(item => item.props?.className === 'nmx-editor-recovery-confirm');
    assert.equal(typeof first.ref, 'function');
    first.ref({ scrollIntoView: options => calls.push(options) });
    assert.deepEqual(calls, [{ block: 'nearest' }]);
    h.setProps({ ...props, busy: true });
    const busy = walk(h.render()).find(item => item.props?.className === 'nmx-editor-recovery-confirm');
    assert.equal(busy.ref, first.ref, 'React must not detach/reattach the ref on a busy-state rerender');
    first.ref(null); assert.equal(calls.length, 1, 'Unmount does not scroll anything');
});

test('busy and saving controls are disabled, callbacks are independent, CSS is scroll bounded and logical-direction aware', async () => {
    let opened = '', retries = 0;
    const h = harness({ ...props, entries: [{ ...entry, status: 'memory' }], onOpen: key => { opened = key; }, onRetry: () => { retries++; } });
    button(h.render(), 'Open copy').props.onClick(); await flush(); assert.equal(opened, 'one');
    button(h.render(), 'Retry backup').props.onClick(); await flush(); assert.equal(retries, 1);
    h.setProps({ ...props, busy: true }); assert.ok(walk(h.render()).filter(item => item.type === 'button').every(item => item.props.disabled));
    h.setProps({ ...props, entries: [{ ...entry, status: 'saving' }] }); assert.ok(walk(h.render()).filter(item => item.type === 'button').every(item => item.props.disabled));
    const css = readFileSync(new URL('../src/browser/style/nextmux.css', import.meta.url), 'utf8');
    assert.match(css, /\.nmx-editor-recovery \{[^}]*max-height: min\(340px, 45vh\)[^}]*overflow: auto/);
    assert.doesNotMatch(css, /\.nmx-editor-recovery ul\s*\{[^}]*(?:overflow: auto|max-height:)/);
    assert.match(css, /\.nmx-editor-recovery li :is\(strong, bdi\)[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis/);
    const html = renderToStaticMarkup(React.createElement(NextMuxEditorRecoveryPanel, props));
    assert.match(html, /<strong title="synthetic &lt;script&gt;\.txt"/);
    assert.match(html, /<bdi dir="ltr" title="\/synthetic\/only\.txt"/);
    assert.match(css, /\.nmx-editor-recovery li[^}]*border-block-end/);
    assert.match(css, /\.nmx-editor-recovery button:focus-visible/);
});
