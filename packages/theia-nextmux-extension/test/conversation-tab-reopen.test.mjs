import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const path = '../src/browser/nextmux-conversation-tabs-view.tsx';
const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = source.statements.filter(node => ts.isFunctionDeclaration(node) && ['LiveTabView', 'uncheckedConversationWindowText', 'uncheckedConversationTabsText'].includes(node.name?.text)
    || ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ['windowCatalog', 'catalog'].includes(declaration.name.getText(source)))).map(node => node.getText(source)).join('\n');
const code = ts.transpile(`${declarations}\nreturn { LiveTabView, windowCatalog, conversationWindowText: uncheckedConversationWindowText };`, { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React });
function harness(modeResult) {
    const values = [], calls = [], effects = [], listeners = new Map(); let index = 0;
    const document = { visibilityState: 'visible', activeElement: undefined, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
    const React = {
        useState(initial) { const at = index++; if (!(at in values)) values[at] = typeof initial === 'function' ? initial() : initial; return [values[at], value => { values[at] = typeof value === 'function' ? value(values[at]) : value; }]; },
        useRef(initial) { const at = index++; return values[at] ||= { current: initial }; }, useEffect(fn) { effects.push(fn); },
        createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat(Infinity).filter(Boolean) }; }
    };
    const actual = Function('React', 'document', 'ConversationWindowInputQueue', 'tabWindows', 'conversationTabsText', 'conversationWindowText', code)(
        React, document, class {}, () => [], (_locale, key) => key, (locale, key, values) => actual.conversationWindowText(locale, key, values));
    const props = { locale: 'zh-CN', tab: { id: 'app:editor', kind: 'local-desktop', title: 'Editor', target: 'Editor', status: 'disconnected' },
        onReopenApp: async mode => { calls.push(mode); return typeof modeResult === 'function' ? modeResult(mode) : modeResult; } };
    const render = () => { index = 0; effects.length = 0; return actual.LiveTabView(props); };
    return { ...actual, props, calls, render, effects, document, listeners };
}
function find(node, predicate) {
    if (typeof node !== 'object' || !node) return undefined;
    if (predicate(node)) return node;
    return node.children?.map(child => find(child, predicate)).find(Boolean);
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const reopen = tree => find(tree, node => node.props.className?.split(' ').includes('nmx-visual-tab-reopen'));
const dialog = tree => find(tree, node => node.props.role === 'dialog');

test('all 12 locales supply app reopen and running confirmation text with an app placeholder', () => {
    const { windowCatalog, conversationWindowText } = harness('opened');
    assert.equal(Object.keys(windowCatalog).length, 12);
    for (const locale of Object.keys(windowCatalog)) {
        for (const key of ['reopenApp', 'reopenRunningTitle', 'reopenRunningBody', 'reopenRunningConfirm', 'reopenFailed']) assert.ok(windowCatalog[locale][key]?.trim());
        assert.ok(conversationWindowText(locale, 'reopenRunningBody', { app: 'Example App' }).includes('Example App'));
    }
    assert.equal(conversationWindowText('zh-CN', 'reopenApp'), '重新打开');
});

test('reopen is shown only for a disconnected local app with a reopen handler', () => {
    const fixture = harness('opened');
    assert.ok(reopen(fixture.render()));
    fixture.props.tab.status = 'connected'; assert.equal(reopen(fixture.render()), undefined);
    fixture.props.tab.status = 'disconnected'; fixture.props.tab.kind = 'remote-desktop'; assert.equal(reopen(fixture.render()), undefined);
    fixture.props.tab.kind = 'local-desktop'; fixture.props.onReopenApp = undefined; assert.equal(reopen(fixture.render()), undefined);
});

test('stopped app reopens directly, with duplicate clicks blocked while the request is pending', async () => {
    let finish;
    const fixture = harness(() => new Promise(resolve => { finish = resolve; }));
    const button = reopen(fixture.render()); button.props.onClick(); button.props.onClick();
    assert.deepEqual(fixture.calls, ['check_or_open']); assert.equal(reopen(fixture.render()).props.disabled, true);
    finish('opened'); await flush();
    assert.equal(dialog(fixture.render()), undefined); assert.equal(reopen(fixture.render()).props.disabled, false);
});

test('running app requires confirmation and cancel never sends restart', async () => {
    const fixture = harness(mode => mode === 'check_or_open' ? 'running' : 'opened');
    reopen(fixture.render()).props.onClick(); await flush();
    let tree = fixture.render(); assert.ok(dialog(tree)); assert.deepEqual(fixture.calls, ['check_or_open']);
    find(tree, node => node.props.className === 'nmx-visual-tab-terminate-cancel').props.onClick();
    assert.equal(dialog(fixture.render()), undefined); assert.deepEqual(fixture.calls, ['check_or_open']);
    reopen(fixture.render()).props.onClick(); await flush(); tree = fixture.render();
    find(tree, node => node.props.className === 'nmx-visual-tab-terminate-confirm').props.onClick(); await flush();
    assert.deepEqual(fixture.calls, ['check_or_open', 'check_or_open', 'restart']); assert.equal(dialog(fixture.render()), undefined);
});

test('reopen failure exits busy state and renders translated failure feedback', async () => {
    const fixture = harness('failed'); reopen(fixture.render()).props.onClick(); await flush();
    const tree = fixture.render(); assert.equal(reopen(tree).props.disabled, false);
    assert.ok(JSON.stringify(tree).includes('未能重新打开应用，请稍后再试'));
});


test('running confirmation contains Tab focus, closes with Escape, and restores focus to its trigger', async () => {
    const fixture = harness('running'); reopen(fixture.render()).props.onClick(); await flush();
    const modal = dialog(fixture.render());
    const focusable = ['cancel', 'confirm'].map(name => ({ name, focus() { fixture.document.activeElement = this; } }));
    const trigger = { isConnected: true, focus() { fixture.document.activeElement = this; } };
    fixture.document.activeElement = trigger;
    modal.props.ref.current = { querySelectorAll: () => focusable, contains: node => focusable.includes(node), focus() {} };
    const effect = fixture.effects.find(fn => fn.toString().includes('const previous = document.activeElement'));
    assert.ok(effect); const cleanup = effect(); assert.equal(fixture.document.activeElement, focusable[0]);
    const key = (value, shiftKey = false) => fixture.listeners.get('keydown')({ key: value, shiftKey, preventDefault() {}, stopImmediatePropagation() {} });
    key('Tab', true); assert.equal(fixture.document.activeElement, focusable[1]);
    key('Tab'); assert.equal(fixture.document.activeElement, focusable[0]);
    fixture.document.activeElement = trigger;
    fixture.listeners.get('focusin')({ target: trigger }); assert.equal(fixture.document.activeElement, focusable[0]);
    key('Escape'); assert.equal(dialog(fixture.render()), undefined); assert.deepEqual(fixture.calls, ['check_or_open']);
    cleanup(); assert.equal(fixture.document.activeElement, trigger); assert.equal(fixture.listeners.size, 0);
});
