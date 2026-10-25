import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { isDesktopPluginAction, isDesktopTabAction } from '../lib/common/nextmux-computer-automation.js';
import { attachTabWindow, findConversationTabByTarget, isSameTabAppFamily, removeTabWindow, tabWindows } from '../lib/browser/nextmux-conversation-tabs.js';

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widgetClass = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['handleTabControlRequest', 'handleTabToolRequest', 'handleComputerToolRequest'];
const methods = names.map(name => {
    const method = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
    assert.ok(method, `real widget method ${name}`); return method.getText(file);
}).join('\n');

function fixture({ screenshot = true, pointerResults = [], keyResult = { ok: true } } = {}) {
    const pointerCalls = [], keyCalls = [], nativeCalls = [];
    const bridge = {
        async getComputerCapability() { return { available: true, platform: 'darwin' }; },
        async performComputerAction(request) { nativeCalls.push(request); return { requestId: request.id, ok: true }; },
        async computerWindowPointer(conversationId, input) {
            pointerCalls.push({ conversationId, input });
            return pointerResults.length ? pointerResults.shift() : { ok: true };
        },
        async computerWindowKeys(conversationId, input) { keyCalls.push({ conversationId, input }); return keyResult; },
        async computerWindowSnapshot() { return { ok: true, width: 800, height: 400, mimeType: 'image/jpeg', data: 'AAAA' }; }
    };
    const Widget = new Function('window', 'visualTabsFor', 'isDesktopTabAction', 'isDesktopPluginAction',
        'findConversationTabByTarget', 'tabWindows', 'removeTabWindow', 'attachTabWindow', 'isSameTabAppFamily',
        ts.transpile(`class Widget { ${methods} }; return Widget;`, {
            target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
        }))({ nextmuxDesktop: bridge }, (state, id) => state[id] || [], isDesktopTabAction, isDesktopPluginAction,
            findConversationTabByTarget, tabWindows, removeTabWindow, attachTabWindow, isSameTabAppFamily);
    const widget = new Widget();
    Object.assign(widget, {
        codingSessions: [{ id: 'owner-a' }, { id: 'owner-b' }], loadConversationTabs() {}, detachedComputerTabs: new Set(),
        tabInteractedIds: new Set(),
        computerPermissionRequests: new Set(),
        platformService: { async getComputerToolRequests() { return [{ id: 'request-1' }]; }, async setDesktopComputerCapability() {} },
        conversationTabs: { 'owner-a': [{ id: 'tab-1', windowRef: { pid: 123, windowId: 456 } }] },
        tabShotSizes: new Map(screenshot ? [['owner-a\ntab-1', { width: 800, height: 400 }]] : []),
        updateConversationVisualTab() {}
    });
    const run = (action, input, conversationId = 'owner-a') => widget.handleTabToolRequest({
        id: 'request-1', action, conversationId, input: { tabId: 'tab-1', ...input }
    }, 'darwin');
    return { run, widget, pointerCalls, keyCalls, nativeCalls };
}

test('tab drag dispatch converts both screenshot pixel points to window proportions', async () => {
    const { run, pointerCalls } = fixture();
    assert.equal((await run('tabDrag', { from: { x: 100, y: 300 }, to: { x: 800, y: 0 }, durationMs: 650 })).ok, true);
    assert.deepEqual(pointerCalls, [{ conversationId: 'owner-a', input: {
        pid: 123, windowId: 456, kind: 'drag', from: { x: 0.125, y: 0.75 }, to: { x: 1, y: 0 }, durationMs: 650, restore: true, delivery: 'background', source: 'agent'
    } }]);
    assert.equal((await run('tabDrag', { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } })).ok, true);
    assert.equal(pointerCalls[1].input.durationMs, 300);
});

test('tab drag requires a screenshot and validates both endpoints before any pointer call', async () => {
    const missing = fixture({ screenshot: false });
    assert.match((await missing.run('tabDrag', { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } })).error, /tabs\.screenshot/);
    assert.deepEqual(missing.pointerCalls, []);
    const { run, pointerCalls } = fixture();
    for (const bad of [{ x: -1, y: 2 }, { x: 801, y: 2 }, { x: 1, y: 401 }, { x: NaN, y: 0 },
        { x: Infinity, y: 0 }, { x: '1', y: 0 }, { x: 1 }, null]) {
        for (const endpoint of ['from', 'to']) {
            const request = { from: { x: 0, y: 0 }, to: { x: 400, y: 200 }, [endpoint]: bad };
            assert.equal((await run('tabDrag', request)).ok, false, `${endpoint}: ${JSON.stringify(bad)}`);
        }
    }
    for (const durationMs of [0, 49, 2001, 1.5, NaN, Infinity, '50']) {
        assert.equal((await run('tabDrag', { from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, durationMs })).ok, false);
    }
    assert.deepEqual(pointerCalls, []);
});

test('double click is one owned background operation and failures are never partially replayed', async () => {
    const { run, pointerCalls } = fixture();
    assert.equal((await run('tabClick', { x: 400, y: 100, button: 'right', double: true })).ok, true);
    assert.deepEqual(pointerCalls.map(call => call.input), [
        { pid: 123, windowId: 456, x: 0.5, y: 0.25, restore: true, delivery: 'background', source: 'agent', kind: 'doubleClick', whole: true, button: 'right' }
    ]);
    const failed = fixture({ pointerResults: [{ ok: false, error: 'background_unsupported' }] });
    const result = await failed.run('tabClick', { x: 0, y: 0, double: true });
    assert.equal(result.ok, false);
    assert.match(result.error, /background_unsupported/);
    assert.equal(failed.pointerCalls.length, 1);
});

test('tab key keeps modifier-only, simultaneous keys and explicit zero hold intact without requiring a screenshot', async () => {
    const { run, keyCalls } = fixture({ screenshot: false });
    assert.equal((await run('tabKey', { key: 'ctrl', holdMs: 0 })).ok, true);
    assert.equal((await run('tabKey', { keys: ['left', 'alt'], modifiers: ['shift'], holdMs: 300 })).ok, true);
    assert.equal((await run('tabKey', { key: 'enter' })).ok, true);
    assert.deepEqual(keyCalls.map(call => call.input), [
        { pid: 123, windowId: 456, restore: true, delivery: 'background', source: 'agent', key: 'ctrl', modifiers: [], holdMs: 0 },
        { pid: 123, windowId: 456, restore: true, delivery: 'background', source: 'agent', keys: ['left', 'alt'], modifiers: ['shift'], holdMs: 300 },
        { pid: 123, windowId: 456, restore: true, delivery: 'background', source: 'agent', key: 'enter', modifiers: [], holdMs: undefined }
    ]);
});

test('tab key rejects ambiguous, oversized or invalid holds and preserves explicit host errors', async () => {
    const { run, keyCalls } = fixture();
    for (const input of [{}, { key: 'a', keys: ['a'] }, { key: '' }, { key: ' ' }, { keys: [] },
        { keys: ['a', 'a'] }, { keys: ['a', 3] }, { keys: ['a', 'b', 'c', 'd', 'e'] },
        { key: 'ctrl', holdMs: -1 }, { key: 'ctrl', holdMs: 3001 }, { key: 'ctrl', holdMs: 0.5 }]) {
        assert.equal((await run('tabKey', input)).ok, false, JSON.stringify(input));
    }
    assert.deepEqual(keyCalls, []);
    const unsupported = fixture({ keyResult: { ok: false, error: 'computer_hold_unsupported' } });
    assert.match((await unsupported.run('tabKey', { key: 'ctrl', holdMs: 80 })).error, /computer_hold_unsupported/);
});

test('tab input resolves only its owning conversation and uses the latest screenshot dimensions', async () => {
    const { run, pointerCalls } = fixture({ screenshot: false });
    assert.equal((await run('tabDrag', { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }, 'owner-b')).ok, false);
    assert.equal((await run('tabScreenshot', {})).ok, true);
    assert.equal((await run('tabClick', { x: 400, y: 200 })).ok, true);
    assert.deepEqual(pointerCalls.map(call => call.input), [{ pid: 123, windowId: 456, x: 0.5, y: 0.5, restore: true, delivery: 'background', source: 'agent', kind: 'click', button: 'left' }]);
});

test('actual computer request dispatcher sends every tab input through the tab bridge', async () => {
    const { widget, pointerCalls, keyCalls, nativeCalls } = fixture();
    for (const [action, input] of [
        ['tabScreenshot', {}], ['tabClick', { x: 2, y: 3 }], ['tabScroll', { x: 2, y: 3, direction: 'down' }],
        ['tabDrag', { from: { x: 1, y: 2 }, to: { x: 3, y: 4 } }],
        ['tabKey', { keys: ['left', 'alt'] }], ['tabType', { text: 'input' }]
    ]) {
        const result = await widget.handleComputerToolRequest({ id: 'request-1', conversationId: 'owner-a',
            expiresAt: Date.now() + 45_000, action, input: { tabId: 'tab-1', ...input } });
        assert.equal(result.ok, true, action);
    }
    assert.equal(pointerCalls.length, 3); assert.equal(keyCalls.length, 2); assert.deepEqual(nativeCalls, []);
});

test('expired or cancelled tab requests cannot dispatch native input', async () => {
    for (const state of ['expired', 'cancelled']) {
        const { widget, pointerCalls, keyCalls, nativeCalls } = fixture();
        if (state === 'cancelled') widget.platformService.getComputerToolRequests = async () => [];
        const result = await widget.handleComputerToolRequest({ id: 'request-1', conversationId: 'owner-a',
            expiresAt: Date.now() + (state === 'expired' ? -1 : 45_000), action: 'tabDrag',
            input: { tabId: 'tab-1', from: { x: 1, y: 2 }, to: { x: 3, y: 4 } } });
        assert.equal(result.ok, false, state);
        assert.deepEqual(pointerCalls, []); assert.deepEqual(keyCalls, []); assert.deepEqual(nativeCalls, []);
    }
});


test('disconnected or missing target never reconnects into a same-name sibling window', async () => {
    for (const target of [
        { id: 'tab-1', appId: 'editor', title: 'Document', status: 'disconnected', windowRef: { pid: 123, windowId: 456 } },
        { id: 'tab-1', appId: 'editor', title: 'Document', status: 'disconnected' },
        { id: 'tab-1', appId: 'editor', title: 'Document' }
    ]) {
        for (const action of ['tabType', 'tabKey', 'tabClick', 'tabScreenshot']) {
            const { widget, run, keyCalls, pointerCalls, nativeCalls } = fixture();
            let reconnects = 0;
            widget.reconnectConversationAppTab = async () => { reconnects++; await Promise.resolve(); widget.conversationTabs['owner-a'] = widget.conversationTabs['owner-a'].filter(tab => tab.id !== 'tab-1'); };
            widget.conversationTabs['owner-a'] = [target, { id: 'sibling', appId: 'editor', title: 'Document', windowRef: { pid: 555, windowId: 777 } }];
            const result = await run(action, { text: 'xx', key: 'a', x: 10, y: 10 });
            assert.equal(result.ok, false, action);
            assert.equal(reconnects, 0);
            assert.deepEqual(keyCalls, []);
            assert.deepEqual(pointerCalls, []);
            assert.deepEqual(nativeCalls, []);
        }
    }
});
