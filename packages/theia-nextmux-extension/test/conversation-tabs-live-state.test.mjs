import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const tabs = require('../lib/browser/nextmux-conversation-tabs.js');
const sourcePath = '../src/browser/nextmux-desktop-widget.tsx';
const source = ts.createSourceFile(sourcePath, readFileSync(new URL(sourcePath, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const methods = ['setConversationTabs', 'handleTabControlRequest', 'updateConversationVisualTab'].map(name => {
    const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name);
    assert(method, name); return method.getText(source);
}).join('\n');
const code = ts.transpile(`class Harness { ${methods} }; return Harness;`, { target: ts.ScriptTarget.ES2022 });
function sharedStorage(state = tabs.emptyConversationTabs()) {
    let raw = tabs.serializeConversationTabs(state);
    return { getItem: () => raw, setItem: (_key, value) => { raw = value; }, state: () => tabs.parseConversationTabs(raw), raw: () => raw };
}
function fixture(state, storage = sharedStorage(state)) {
    const snapshots = [];
    const bridge = { async computerWindowSnapshot(conversationId, pid, windowId) {
        snapshots.push({ conversationId, pid, windowId });
        return { ok: true, width: 200, height: 100, mimeType: 'image/png', data: 'QA_FRAME' };
    } };
    const Harness = Function('window', ...Object.keys(tabs), code)({ localStorage: storage, nextmuxDesktop: bridge }, ...Object.values(tabs));
    const instance = Object.assign(new Harness(), { conversationTabs: state, tabShotSizes: new Map(), update() {}, loadConversationTabs() {} });
    return { instance, storage, snapshots };
}
function open(state, owner, pid, windowId, followed = false) {
    return tabs.openVisualTab(state, owner, { ...tabs.appWindowTab({ pid, windowId, app: 'QA App', followed }, 'darwin'), createdAt: 1, frameUrl: 'data:image/png;base64,QA_FRAME' });
}

test('show of an already-selected tab retains its window ownership for a subsequent screenshot', async () => {
    const state = open(tabs.emptyConversationTabs(), 'a', 14924, 47290);
    const { instance, snapshots, storage } = fixture(state);
    const id = state.active.a;
    instance.setConversationTabs(tabs.selectTab(instance.conversationTabs, 'a', id));
    assert.equal(instance.conversationTabs.tabs.a[0], state.tabs.a[0]);
    const result = await instance.handleTabControlRequest({ conversationId: 'a', action: 'tabScreenshot', input: {} }, id,
        output => ({ ok: true, output }), error => ({ ok: false, error }));
    assert.equal(result.ok, true);
    assert.deepEqual(snapshots, [{ conversationId: 'a', pid: 14924, windowId: 47290 }]);
    assert.equal(instance.conversationTabs.tabs.a[0].windowRef.windowId, 47290);
    assert.doesNotMatch(storage.raw(), /windowRef|frameUrl|QA_FRAME/);
    assert.equal(storage.state().tabs.a[0].status, 'disconnected');
});

test('changing conversation B preserves conversation A live refs and followed windows', () => {
    const state = open(open(tabs.emptyConversationTabs(), 'a', 10, 1, true), 'b', 20, 2);
    const { instance, storage } = fixture(state);
    instance.setConversationTabs(tabs.selectTab(state, 'b', tabs.CONVERSATION_TAB_ID));
    assert.equal(instance.conversationTabs.tabs.a[0], state.tabs.a[0]);
    assert.equal(instance.conversationTabs.tabs.b[0], state.tabs.b[0]);
    assert.equal(instance.conversationTabs.tabs.a[0].windowRef.pid, 10);
    assert.equal(storage.state().tabs.a, undefined, 'followed windows remain session-only');
});

test('two app windows preserve each other stored conversations without importing live references', () => {
    const storage = sharedStorage();
    const a = fixture(tabs.emptyConversationTabs(), storage).instance;
    const b = fixture(tabs.emptyConversationTabs(), storage).instance;
    a.setConversationTabs(open(a.conversationTabs, 'a', 10, 1));
    b.setConversationTabs(open(b.conversationTabs, 'b', 20, 2));
    a.setConversationTabs(tabs.updateVisualTab(a.conversationTabs, 'a', 'window:10:1', { title: 'A updated' }));
    assert.deepEqual(Object.keys(storage.state().tabs).sort(), ['a', 'b']);
    assert.equal(storage.state().tabs.a[0].title, 'A updated');
    assert.equal(a.conversationTabs.tabs.a[0].windowRef.pid, 10);
    assert.equal(b.conversationTabs.tabs.b[0].windowRef.pid, 20);
    assert.equal(a.conversationTabs.tabs.b, undefined, 'storage never authorizes control of another window');
    assert.equal(b.conversationTabs.tabs.a, undefined);
});

test('a stale app window does not resurrect another conversation removed from storage', () => {
    const state = open(open(tabs.emptyConversationTabs(), 'a', 10, 1), 'b', 20, 2);
    const storage = sharedStorage(state);
    const a = fixture(state, storage).instance;
    const b = fixture(tabs.parseConversationTabs(storage.raw()), storage).instance;
    b.setConversationTabs(tabs.closeVisualTab(b.conversationTabs, 'b', 'window:20:2'));
    a.setConversationTabs(tabs.selectTab(a.conversationTabs, 'a', 'window:10:1'));
    assert.equal(storage.state().tabs.b, undefined);
    assert.equal(a.conversationTabs.tabs.a[0].windowRef.pid, 10);
});

test('closing an owned tab removes its memory and stored record without erasing other windows', () => {
    const storage = sharedStorage(open(tabs.emptyConversationTabs(), 'other', 30, 3));
    const state = open(tabs.emptyConversationTabs(), 'a', 10, 1);
    const { instance } = fixture(state, storage);
    instance.setConversationTabs(tabs.closeVisualTab(state, 'a', 'window:10:1'));
    assert.equal(instance.conversationTabs.tabs.a, undefined);
    assert.equal(storage.state().tabs.a, undefined);
    assert.equal(storage.state().tabs.other[0].id, 'window:30:3');
});

test('storage failure cannot disconnect the live tab or rehydrate a persisted window reference', () => {
    const state = open(tabs.emptyConversationTabs(), 'a', 10, 1);
    const { instance } = fixture(state, { getItem() { throw new Error('storage unavailable'); }, setItem() { throw new Error('storage unavailable'); } });
    instance.setConversationTabs(tabs.selectTab(state, 'a', 'window:10:1'));
    assert.equal(instance.conversationTabs.tabs.a[0].windowRef.pid, 10);
    const forged = JSON.stringify({ version: 1, tabs: state.tabs, active: state.active });
    assert.equal(tabs.parseConversationTabs(forged).tabs.a[0].windowRef, undefined);
    assert.equal(tabs.parseConversationTabs(forged).tabs.a[0].frameUrl, undefined);
});
