import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const tabs = require('../lib/browser/nextmux-conversation-tabs.js');
const read = name => ts.createSourceFile(name, readFileSync(new URL(`../src/browser/${name}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const view = read('nextmux-conversation-tabs-view.tsx');
const viewNames = ['LIVE_BUBBLE_STORAGE_KEY', 'liveBubbleFallback', 'resetLiveBubbleCounterForTest', 'claimAppTabLiveHint', 'windowCatalog', 'catalog', 'PARK_REASON_TEXT', 'uncheckedConversationWindowText', 'uncheckedConversationTabsText', 'LiveTabView'];
const viewSource = view.statements.filter(n => ts.isFunctionDeclaration(n) && viewNames.includes(n.name?.text)
    || ts.isVariableStatement(n) && n.declarationList.declarations.some(d => viewNames.includes(d.name.getText(view)))).map(n => n.getText(view).replace(/^export /, '')).join('\n');
const widget = read('nextmux-desktop-widget.tsx');
const cls = widget.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'NextMuxDesktopWidget');
const members = ['handleTabToolRequest', 'bindTabWindowEvents', 'disconnectInactiveConversationTabs', 'setConversationWindowVisible', 'conversationWindowControls'];
const classCode = members.map(name => cls.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(widget) === name).getText(widget)).join('\n');
function feedback() {
    const values = [], effects = [], timers = []; let cursor = 0;
    const React = { useState(initial) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], v => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
        useRef(initial) { const i = cursor++; return values[i] ||= { current: initial }; }, useEffect(fn) { effects.push(fn); },
        createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat(Infinity).filter(Boolean) }; } };
    const api = Function('React', 'document', 'ConversationWindowInputQueue', 'setTimeout', 'clearTimeout', ...Object.keys(tabs), ts.transpile(`${viewSource}\nconst conversationWindowText = uncheckedConversationWindowText, conversationTabsText = uncheckedConversationTabsText; return { claimAppTabLiveHint, resetLiveBubbleCounterForTest, LiveTabView, windowCatalog, conversationWindowText };`, { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }))(
        React, { visibilityState: 'visible' }, class {}, (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, () => {}, ...Object.values(tabs));
    return { ...api, effects, timers, render(props) { cursor = 0; effects.length = 0; return api.LiveTabView(props); } };
}
function find(node, predicate) { if (!node || typeof node !== 'object') return; if (predicate(node)) return node; return node.children?.map(n => find(n, predicate)).find(Boolean); }
function fixture(reply) {
    const calls = [], events = {};
    const bridge = { startComputerWindowView: async () => ({ ok: true }), placeComputerWindow: async () => ({ ok: true }), computerWindowSnapshot: async () => ({ ok: false }), openAppInTab: async () => typeof reply === 'function' ? reply() : reply,
        computerWindowState: async () => ({ ok: true, alive: true, sound: false }),
        setComputerWindowSound: async (...args) => { calls.push(args); return { ok: true, sound: args.at(-1) }; },
        onComputerTabWindowEvent: () => () => {}, onComputerTabEvent: fn => { events.follow = fn; return () => {}; } };
    const dependencies = { window: { nextmuxDesktop: bridge }, navigator: { userAgent: 'Windows', mediaDevices: {} }, ...tabs,
        tabWindowText: feedback().conversationWindowText, isFormalTabWindow: tabs.isFormalTabWindow };
    const Harness = Function(...Object.keys(dependencies), ts.transpile(`class Harness { ${classCode} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(dependencies));
    const instance = Object.assign(new Harness(), { conversationTabs: tabs.emptyConversationTabs(), codingSessions: [{ id: 'a' }, { id: 'b' }],
        computerWindowControls: new Map(), computerWindowSoundPreferences: new Map(), computerTabSoundPreferences: new Map(), computerWindowStateSync: new Map(), computerViewCapability: { sound: true }, computerWindowVisibility: new Map(), computerWindowSoundQueues: new Map(),
        detachedComputerTabs: new Set(), tiledCodingSessionIds: new Set(), tabInteractedIds: new Set(), toDispose: [], desktopLocale: 'zh-CN',
        loadConversationTabs() {}, initComputerWindowView: async () => {}, setConversationTabs(next) { this.conversationTabs = next; },
        announceTab(owner, id, text) { this.lastNotice = { owner, id, text }; }, conversationHasActiveRun: () => true });
    return { instance, calls, events };
}
const request = (app = 'Launcher') => ({ id: 'open-app', conversationId: 'a', action: 'tabOpenApp', input: { app } });
const chain = [
    { pid: 1, windowId: 11, app: 'Launcher', title: 'Launcher', role: 'launcher', alive: false },
    { pid: 2, windowId: 22, app: 'Client', title: 'Client', role: 'client', alive: true },
    { pid: 3, windowId: 33, app: 'Match', title: 'Match', role: 'game', alive: true }
];
test('native open reply retains family and ordered dead/live chain while unrelated apps get independent tabs', async () => {
    let reply = { ok: true, pid: 3, windowId: 33, app: 'Match', familyId: 'chain:1', role: 'game', windows: chain };
    const { instance } = fixture(() => reply);
    assert.equal((await instance.handleTabToolRequest(request(), 'win32')).ok, true);
    const tab = instance.conversationTabs.tabs.a[0];
    assert.equal(tab.familyId, 'chain:1'); assert.deepEqual(tab.windows, chain);
    assert.equal(instance.conversationTabs.active.a, tab.id);
    reply = { ok: true, pid: 4, windowId: 44, app: 'Editor', familyId: 'chain:4' };
    await instance.handleTabToolRequest(request('Editor'), 'win32');
    assert.equal(instance.conversationTabs.tabs.a.length, 2);
    assert.equal(tabs.activeTabFor(tabs.selectTab(instance.conversationTabs, 'a', 'conversation'), 'a'), 'conversation');
});
test('window events merge same family and retain closed entries', () => {
    const { instance, events } = fixture();
    instance.conversationTabs = tabs.openVisualTab(instance.conversationTabs, 'a', { ...tabs.appWindowTab({ pid: 2, windowId: 22, app: 'Client', familyId: 'chain:1' }, 'win32'), createdAt: 1 });
    instance.bindTabWindowEvents();
    events.follow({ type: 'window-added', conversationId: 'a', pid: 3, windowId: 33, app: 'Match', root: 1, familyId: 'chain:1', role: 'game', windows: chain });
    assert.equal(instance.conversationTabs.tabs.a.length, 1);
    assert.deepEqual(instance.conversationTabs.tabs.a[0].windows.map(({ followed, ...item }) => item), chain);
    assert.deepEqual(instance.conversationTabs.tabs.a[0].windowRef, { pid: 3, windowId: 33 });
});
test('ownership conflict shows a localized notice in the attempted app tab without retry loops', async () => {
    const { instance } = fixture({ ok: false, error: 'computer_window_owned' });
    const result = await instance.handleTabToolRequest(request('Editor'), 'win32');
    assert.equal(result.ok, false); assert.match(result.error, /另一段对话/); assert.doesNotMatch(result.error, /computer_window_owned/);
    assert.equal(instance.lastNotice.id, instance.conversationTabs.active.a);
    assert.ok(instance.tabInteractedIds.has(`a\n${instance.lastNotice.id}`));
});
test('hidden conversations release mute without losing live refs, then restore the user preference', async () => {
    const { instance, calls } = fixture();
    const tab = { ...tabs.appWindowTab({ pid: 2, windowId: 22, app: 'Editor' }, 'win32'), createdAt: 1 };
    instance.conversationTabs = tabs.openVisualTab(instance.conversationTabs, 'b', tab);
    instance.disconnectInactiveConversationTabs('a');
    await Promise.all(instance.computerWindowSoundQueues.values());
    assert.equal(calls.at(-1).at(-1), true); assert.equal(instance.conversationTabs.tabs.b[0].windowRef.windowId, 22);
    await instance.setConversationWindowVisible('b', 2, 22, true); assert.equal(calls.at(-1).at(-1), false);
    instance.computerWindowSoundPreferences.set('b:2:22', true);
    await instance.setConversationWindowVisible('b', 2, 22, false); await instance.setConversationWindowVisible('b', 2, 22, true);
    assert.equal(calls.at(-1).at(-1), true);
});
test('rapid hide/show sound requests finish with the current visibility preference', async () => {
    const { instance, calls } = fixture();
    await Promise.all([instance.setConversationWindowVisible('a', 1, 2, true), instance.setConversationWindowVisible('a', 1, 2, false)]);
    assert.equal(calls.at(-1).at(-1), true);
});
test('live bubble limits persist across reload and are per app per 24 hours plus five entries', () => {
    const f = feedback(), map = new Map(), storage = { getItem: k => map.get(k), setItem: (k, v) => map.set(k, v) }, now = 1_000_000;
    assert.equal(f.claimAppTabLiveHint('Editor', storage, now), true);
    f.resetLiveBubbleCounterForTest();
    for (let i = 0; i < 4; i++) assert.equal(f.claimAppTabLiveHint('Other', storage, now), false);
    assert.equal(f.claimAppTabLiveHint('Other', storage, now), true);
    for (let i = 0; i < 5; i++) assert.equal(f.claimAppTabLiveHint('EDITOR', storage, now + 1000), false);
    assert.equal(f.claimAppTabLiveHint('Editor', storage, now + 86_400_000), true);
});
test('live header uses a button and chain dropdown shows but disables closed windows', () => {
    const f = feedback(), selected = [];
    const props = { locale: 'zh-CN', tab: { id: 'window:3:33', kind: 'local-desktop', title: 'Match', status: 'connected', windowRef: { pid: 3, windowId: 33 }, windows: chain },
        controls: { terminateProcess: async () => true }, onSelectWindow: (...args) => selected.push(args) };
    let tree = f.render(props);
    assert.equal(find(tree, n => n.props.className?.includes('is-interactive')).type, 'button');
    find(tree, n => n.props.className === 'nmx-visual-tab-window-trigger').props.onClick(); tree = f.render(props);
    const dead = find(tree, n => n.props.role === 'option' && n.props.disabled);
    assert.ok(dead); dead.props.onClick(); assert.deepEqual(selected, []);
    assert.equal(find(tree, n => n.props.role === 'listbox').children.length, 3);
});
test('all locales have ownership notices and concise Esc control hints', () => {
    const f = feedback(); for (const locale of Object.keys(f.windowCatalog)) {
        assert.ok(f.conversationWindowText(locale, 'windowOwned')); assert.ok(f.conversationWindowText(locale, 'controlHint'));
    }
    assert.equal(f.conversationWindowText('zh-CN', 'controlHint'), '按 Esc 可以退出控制');
});
test('removed comic agent bar has no callable declaration or string registry reference', () => {
    assert.doesNotMatch(widget.text, /renderComicAgentBar/);
});

test('a chain keeps the per-tab sound choice when switching to another window', async () => {
    const { instance } = fixture();
    const tab = { ...tabs.appWindowTab({ pid: 3, windowId: 33, app: 'Match', familyId: 'chain:1', windows: chain }, 'win32'), createdAt: 1 };
    instance.conversationTabs = tabs.openVisualTab(instance.conversationTabs, 'a', tab);
    const controls = instance.conversationWindowControls('a', tab);
    assert.equal(await controls.setSound(true), true);
    assert.equal(instance.computerWindowSoundPreferences.get('a:2:22'), true);
    const selected = tabs.selectTabWindow(tab, 2, 22);
    const other = instance.conversationWindowControls('a', selected);
    assert.equal(other.state.sound, true, 'the switch does not briefly reset while native state loads');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(other.state.sound, true);
});

test('app announcements leave after 2700 ms and disappear at 3000 ms inside the body', () => {
    const f = feedback(), props = { locale: 'zh-CN', tab: { id: 'app', title: 'Editor', kind: 'local-desktop', status: 'disconnected' }, announcement: { id: Date.now(), text: 'hello' } };
    f.render(props);
    const effect = f.effects.find(fn => fn.toString().includes('setAnnounced(props.announcement.text)'));
    assert.ok(effect); effect();
    assert.deepEqual(f.timers.map(t => t.delay), [2700, 3000]);
    let tree = f.render(props); assert.ok(find(tree, n => n.props.className?.includes('nmx-visual-tab-toast')));
    f.timers[0].fn(); tree = f.render(props); assert.ok(find(tree, n => n.props.className?.includes('is-leaving')));
    f.timers[1].fn(); tree = f.render(props); assert.equal(find(tree, n => n.props.className?.includes('nmx-visual-tab-toast')), undefined);
});
