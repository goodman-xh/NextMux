import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const tabs = require('../lib/browser/nextmux-conversation-tabs.js');
const { parseAppControlMarker } = require('../lib/browser/nextmux-app-control.js');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['ensureConversationAppMarkerTabs', 'activeVisualTab', 'reopenConversationAppTab', 'handleTabToolRequest', 'announceTab'];
const methods = names.map(name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name).getText(ast));
const js = ts.transpileModule(`class Harness { ${methods.join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture() {
    const calls = [], notices = [], released = [];
    const bridge = { async openAppInTab(...args) { calls.push(args); return { ok: true, pid: 42, windowId: 7, appId: 'com.qa.app', app: 'QA App', title: 'new window' }; } };
    const bindings = { ...tabs, parseAppControlMarker, window: { nextmuxDesktop: bridge }, navigator: { userAgent: 'Macintosh' },
        tabWindowText: (_locale, key) => key, desktopFailureMessage: (_locale, error) => error.message };
    const Harness = Function(...Object.keys(bindings), `${js}; return Harness;`)(...Object.values(bindings));
    const owner = { id: 'owner', turns: [{ prompt: '[App: QA App (com.qa.app)]', stage: 'complete' }] };
    const tab = { id: 'window:0:0:com.qa.app', kind: 'local-desktop', appId: 'com.qa.app', title: 'QA App', target: 'QA App', status: 'disconnected', createdAt: 1 };
    const host = Object.assign(new Harness(), { desktopLocale: 'en', activeCodingSessionId: owner.id, codingPanel: 'thread',
        codingSessions: [owner], conversationTabs: tabs.openVisualTab(tabs.emptyConversationTabs(), owner.id, tab),
        detachedComputerTabs: new Set(), tabInteractedIds: new Set(), closedAppMarkerTabs: new Set(), tabAnnouncements: new Map(),
        loadConversationTabs() {}, update() {}, activeCodingSession() { return owner; },
        setConversationTabs(state) { this.conversationTabs = state; }, async initComputerWindowView() {},
        disconnectInactiveConversationTabs() {}, async reconnectConversationAppTab() {},
        forgetConversationWindows(...args) { released.push(args); }, addNotification(...args) { notices.push(args); }
    });
    return { host, bridge, tab, owner, calls, notices, released };
}

test('an inactive application opens directly in the original tab with the atomic check option', async () => {
    const f = fixture();
    assert.equal(await f.host.reopenConversationAppTab('owner', f.tab, 'check_or_open'), 'opened');
    // The user's own Reopen is never the AI acting: it never lights the "controlling the computer" frame.
    assert.deepEqual(f.calls, [['owner', 'com.qa.app', { onlyIfRunning: false, checkOrOpen: true, restartIfRunning: false, source: 'user' }]]);
    assert.equal(f.host.conversationTabs.tabs.owner.length, 1);
    assert.equal(f.host.conversationTabs.tabs.owner[0].id, f.tab.id);
    assert.equal(f.host.conversationTabs.tabs.owner[0].windowRef.pid, 42);
});

test('a running application requires confirmation without changing its tab, then restart keeps its tab id', async () => {
    const f = fixture(), state = f.host.conversationTabs;
    f.bridge.openAppInTab = async (...args) => {
        f.calls.push(args);
        return args[2].checkOrOpen ? { ok: true, running: true, requiresRestart: true }
            : { ok: true, pid: 9, windowId: 10, appId: 'com.qa.app', app: 'QA App' };
    };
    assert.equal(await f.host.reopenConversationAppTab('owner', f.tab, 'check_or_open'), 'running');
    assert.equal(f.host.conversationTabs, state);
    assert.equal(await f.host.reopenConversationAppTab('owner', f.tab, 'restart'), 'opened');
    assert.deepEqual(f.calls[1][2], { onlyIfRunning: false, checkOrOpen: false, restartIfRunning: true, source: 'user' });
    assert.equal(f.host.conversationTabs.tabs.owner[0].id, f.tab.id);
});

test('closing a tab while opening cannot recreate it and releases the newly mounted window without terminating it', async () => {
    const f = fixture();
    f.bridge.openAppInTab = async () => {
        f.host.conversationTabs = tabs.closeVisualTab(f.host.conversationTabs, 'owner', f.tab.id);
        return { ok: true, pid: 9, windowId: 10, appId: 'com.qa.app', app: 'QA App' };
    };
    assert.equal(await f.host.reopenConversationAppTab('owner', f.tab, 'check_or_open'), 'failed');
    assert.equal(tabs.visualTabsFor(f.host.conversationTabs, 'owner').length, 0);
    assert.equal(f.released[0][2], false);
    assert.deepEqual(tabs.tabWindows(f.released[0][1][0]).map(item => [item.pid, item.windowId]), [[9, 10]]);
});

test('restarting discards stale window refs and releases only the replaced windows', async () => {
    const f = fixture();
    const previous = { ...f.tab, windowRef: { pid: 11, windowId: 12 }, windows: [{ pid: 11, windowId: 12, title: 'old' }] };
    f.host.conversationTabs = tabs.openVisualTab(f.host.conversationTabs, 'owner', previous);
    await f.host.reopenConversationAppTab('owner', previous, 'restart');
    assert.deepEqual(f.host.conversationTabs.tabs.owner[0].windows.map(item => [item.pid, item.windowId]), [[42, 7]]);
    assert.deepEqual(f.released[0][1][0].windows.map(item => [item.pid, item.windowId]), [[11, 12]]);
    assert.equal(f.released[0][2], false);
});

test('activeVisualTab materializes historical markers on its first call and respects explicitly closed markers', () => {
    const f = fixture();
    f.host.conversationTabs = { tabs: {}, active: { owner: f.tab.id } };
    assert.equal(f.host.activeVisualTab()?.id, f.tab.id);
    assert.equal(f.host.conversationTabs.tabs.owner.length, 1);
    f.host.activeVisualTab();
    assert.equal(f.host.conversationTabs.tabs.owner.length, 1);
    f.host.conversationTabs = { tabs: {}, active: { owner: f.tab.id } };
    f.host.closedAppMarkerTabs.add('owner\ncom.qa.app');
    assert.equal(f.host.activeVisualTab(), undefined);
});
