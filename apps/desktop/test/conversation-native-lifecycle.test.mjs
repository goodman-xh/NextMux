import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const extensionRequire = createRequire(new URL('../../../packages/theia-nextmux-extension/package.json', import.meta.url));
const ts = extensionRequire('typescript');
const source = readFileSync(new URL('../../../packages/theia-nextmux-extension/src/electron-main/nextmux-conversation-windows.ts', import.meta.url), 'utf8');
const commonSource = readFileSync(new URL('../../../packages/theia-nextmux-extension/src/common/nextmux-conversation-window.ts', import.meta.url), 'utf8');
const common = {};
vm.runInNewContext(ts.transpileModule(commonSource, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
} }).outputText, { exports: common, require: name => extensionRequire(name.startsWith('./') ? `./lib/common/${name.slice(2)}` : name) },
{ filename: 'actual-conversation-window-common.js' });
const settle = () => new Promise(resolve => setImmediate(resolve));

// Exercise the actual native contribution without opening windows, changing a
// user profile, running a model, or letting app.quit terminate the test runner.
function fixture({ reducedMotion = false, diagnosticEnv, diagnosticSinkThrow = false, tabWindows = false, confirmQuit } = {}) {
  const app = new EventEmitter(), handlers = new Map(), windows = [], closeOrder = [], timers = new Map(), diagnostics = [];
  let nextId = 0, requestId = 0, time = 0;
  app.quitCalls = 0; app.committedQuits = 0;
  app.quit = () => {
    app.quitCalls++;
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    app.emit('before-quit', event);
    if (!event.defaultPrevented) app.committedQuits++;
  };
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.destroyed = false; this.visible = true; this.minimized = false; this.focusCalls = 0; this.messages = [];
      this.tabWindow = Boolean(options?.webPreferences?.preload);
      this.bounds = { x: 0, y: 24, width: 1000, height: 700 };
      this.webContents = Object.assign(new EventEmitter(), {
        id: ++nextId, mainFrame: {}, url: 'file:///fixture/index.html',
        getURL() { return this.url; }, isDestroyed: () => this.destroyed, setWindowOpenHandler() {},
        send: (channel, ...args) => this.messages.push({ channel, args })
      });
      windows.push(this);
      this[Symbol.for('nextmux.conversation-window.quit-request')] = () => {
        closeOrder.push(this);
        return new Promise(resolve => { this.finishQuit = saved => { if (saved) this.destroyFixture(); resolve(saved); }; });
      };
    }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    isMinimized() { return this.minimized; }
    restore() { this.minimized = false; }
    hide() { this.visible = false; }
    show() { this.visible = true; }
    focus() { this.focusCalls++; }
    getBounds() { return { ...this.bounds }; }
    setBounds(bounds) { this.bounds = bounds; }
    setMinimumSize() {}
    setResizable() {}
    isFullScreen() { return false; }
    isMaximized() { return false; }
    flashFrame() {}
    close() { if (this.tabWindow) this.destroyFixture(); else this[Symbol.for('nextmux.conversation-window.close')]?.(); }
    destroy() { if (this.tabWindow) this.destroyFixture(); else assert.fail('Native lifecycle must never force-destroy a window during quit/reclaim'); }
    destroyFixture() { this.destroyed = true; this.visible = false; this.emit('closed'); }
    async loadFile() {}
    async loadURL(url) { this.webContents.url = url; invoke('state', this); }
    events(type) { return this.messages.filter(message => message.channel === 'nextmux:conversation:event' && message.args[0].type === type).map(message => message.args[0]); }
  }
  Window.fromWebContents = contents => windows.find(window => window.webContents === contents);
  Window.getAllWindows = () => windows.filter(window => !window.destroyed);
  const electron = { app, BrowserWindow: Window, ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    dialog: confirmQuit ? { showMessageBox: confirmQuit } : undefined,
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 24, width: 1440, height: 900 } }) },
    systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: reducedMotion }) } };
  if (tabWindows) {
    const require = createRequire(import.meta.url), viewModule = require('../computer-window-view.cjs');
    const createView = viewModule.createComputerWindowView;
    try {
      viewModule.createComputerWindowView = () => ({ canView: () => true, capability: () => ({}) });
      require('../computer-automation.cjs').registerComputerAutomation({ ...electron, screen: () => electron.screen,
        desktopCapturer: {}, trustedMainFrame: () => true, automation: { platform: 'darwin', dispose: async () => undefined } });
    } finally { viewModule.createComputerWindowView = createView; }
  }
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true
  } }).outputText, {
    exports, URL, process: { platform: 'darwin', env: diagnosticEnv === undefined ? {} : { NEXTMUX_CONVERSATION_SYNC_DIAGNOSTIC: diagnosticEnv } },
    console: { info: (...args) => {
      if (diagnosticSinkThrow) throw new Error('Diagnostic sink unavailable');
      diagnostics.push(args);
    } },
    require(name) {
      if (name === '@theia/core/shared/inversify') return { injectable: () => value => value };
      if (name === '@theia/core/electron-shared/electron') return electron;
      if (name === 'node:crypto') return { randomUUID: () => `flush-${++requestId}` };
      if (name === '../common/nextmux-conversation-window') return common;
      throw new Error(`Unexpected native dependency: ${name}`);
    },
    setTimeout(callback, milliseconds) { const timer = { callback, due: time + milliseconds }; timers.set(timer, timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); }
  }, { filename: 'actual-conversation-windows.js' });
  const native = new exports.NextMuxConversationWindows();
  const application = { createWindow: async () => new Window() };
  native.onStart(application);
  const event = window => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  function invoke(name, window, ...args) { return handlers.get(`nextmux:conversation:${name}`)(event(window), ...args); }
  const primary = new Window(); invoke('state', primary);
  function workbench() {
    const window = new Window();
    invoke('state', window);
    return window;
  }
  async function open(...ids) {
    invoke('publish', primary, ids.map(id => ({ id, set: { id, draftPrompt: `draft ${id}` }, unset: [] })));
    assert.equal(await invoke('open', primary, ids), true);
    return windows.filter(window => !window.destroyed && new URL(window.webContents.url).searchParams.has('nextmuxConversation'));
  }
  function advance(milliseconds) {
    time += milliseconds;
    for (const timer of [...timers.values()]) if (timer.due <= time) { timers.delete(timer); timer.callback(); }
  }
  return { app, handlers, event, invoke, primary, workbench, open, native, application, windows, closeOrder, advance, exports, diagnostics };
}

test('conversation sync diagnostics are silent by default and only the exact opt-in value enables them', async () => {
  for (const diagnosticEnv of [undefined, '', '0', 'true', 'false']) {
    const f = fixture({ diagnosticEnv });
    assert.equal(Object.hasOwn(f.invoke('state', f.primary), 'syncDiagnostic'), false);
    assert.equal(f.invoke('sync-diagnostic', f.primary, { event: 'input', draftLength: 12 }), false);
    assert.equal(f.invoke('publish', f.primary, [{ id: 'private-session', set: { id: 'private-session', draftPrompt: 'private text' }, unset: [] }]), true);
    assert.equal(await f.invoke('flush', f.primary), 'primary');
    assert.deepEqual(f.diagnostics, []);
  }
});

test('enabled sync diagnostics contain only fixed events, booleans, bounded counts, and main-derived window ids', async () => {
  const f = fixture({ diagnosticEnv: '1' }), peer = f.workbench();
  assert.equal(f.invoke('state', peer).syncDiagnostic, true);
  const payload = { event: 'input', ready: true, primary: false, dirty: true, historyReady: true,
    active: true, historyLoaded: false, changed: true, saved: false, debouncePending: true,
    draftLength: 0, storedDraftLength: 1_000_000_000, sessionCount: 2, deltaCount: 3, removedCount: 4 };
  assert.equal(f.invoke('sync-diagnostic', peer, payload), true);
  const [prefix, json] = f.diagnostics.at(-1);
  assert.equal(prefix, '[NextMux conversation sync diagnostic]');
  assert.deepEqual(JSON.parse(json), { ...payload, windowId: peer.webContents.id, primaryWindowId: f.primary.webContents.id });

  assert.equal(f.invoke('publish', peer, [{ id: 'secret-session-id', set: { id: 'secret-session-id', draftPrompt: 'secret prompt body' }, unset: [] }]), true);
  assert.equal(await f.invoke('flush', f.primary), 'primary');
  const events = f.diagnostics.map(entry => JSON.parse(entry[1]));
  assert.ok(events.some(entry => entry.event === 'state'));
  assert.ok(events.some(entry => entry.event === 'publish_received' && entry.deltaCount === 1 && entry.removedCount === 0));
  assert.ok(events.some(entry => entry.event === 'flush_received' && entry.primary === true));
  assert.doesNotMatch(JSON.stringify(f.diagnostics), /secret-session-id|secret prompt body/);
});

test('sync diagnostics reject undeclared keys and invalid values without reading accessors or echoing rejected payloads', () => {
  const f = fixture({ diagnosticEnv: '1' }), before = f.diagnostics.length;
  const invalid = [null, undefined, [], 'private body', 1, {}, { event: 'not-a-fixed-event' },
    ...['body', 'prompt', 'sessionId', 'error', 'stack', 'windowId', 'primaryWindowId'].map(key => ({ event: 'input', [key]: 'private value' })),
    ...['ready', 'primary', 'dirty', 'historyReady', 'active', 'historyLoaded', 'changed', 'saved', 'debouncePending']
      .flatMap(key => [0, 1, 'true', null, undefined].map(value => ({ event: 'input', [key]: value }))),
    ...['draftLength', 'storedDraftLength', 'sessionCount', 'deltaCount', 'removedCount']
      .flatMap(key => [-1, 0.5, 1_000_000_001, Infinity, -Infinity, NaN, '1', null, undefined].map(value => ({ event: 'input', [key]: value })))];
  let accessed = false;
  invalid.push(Object.defineProperty({ event: 'input' }, 'draftLength', { get() { accessed = true; throw new Error('private error'); } }));
  invalid.push({ event: 'input', [Symbol('private symbol')]: true });
  invalid.push(Object.defineProperty({ event: 'input' }, 'sessionId', { value: 'hidden private value' }));
  for (const payload of invalid) assert.equal(f.invoke('sync-diagnostic', f.primary, payload), false);
  assert.equal(accessed, false);
  assert.equal(f.diagnostics.length, before);
});

test('sync diagnostics reject subframes, remote origins, unknown senders, and destroyed windows', () => {
  const f = fixture({ diagnosticEnv: '1' }), peer = f.workbench(), before = f.diagnostics.length;
  const handler = f.handlers.get('nextmux:conversation:sync-diagnostic');
  const payload = { event: 'input', draftLength: 7 };
  assert.equal(handler({ ...f.event(peer), senderFrame: {} }, payload), false);
  peer.webContents.url = 'https://example.invalid/private';
  assert.equal(f.invoke('sync-diagnostic', peer, payload), false);
  peer.webContents.url = 'not a URL';
  assert.equal(f.invoke('sync-diagnostic', peer, payload), false);
  const sender = { mainFrame: {} };
  assert.equal(handler({ sender, senderFrame: sender.mainFrame }, payload), false);
  peer.webContents.url = 'file:///fixture/index.html';
  peer.destroyFixture();
  assert.equal(f.invoke('sync-diagnostic', peer, payload), false);
  assert.equal(f.diagnostics.length, before);
});

test('quit and close diagnostics trace the primary receipt without permitting renderer-forged native events', async () => {
  const f = fixture({ diagnosticEnv: '1' }), peer = f.workbench();
  for (const event of ['state', 'publish_received', 'flush_received', 'quit_requested', 'close_requested', 'flush_ack']) {
    assert.equal(f.invoke('sync-diagnostic', peer, { event, saved: true }), false);
    assert.equal(f.invoke('sync-diagnostic', f.primary, { event, saved: true }), false);
  }
  const before = f.diagnostics.length;
  const flush = f.invoke('flush', peer);
  const request = f.primary.events('flush').at(-1).requestId;
  f.invoke('flushed', peer, request, true);
  assert.equal(f.diagnostics.slice(before).some(entry => JSON.parse(entry[1]).event === 'flush_ack'), false);
  f.invoke('flushed', f.primary, request, true);
  assert.equal(await flush, true);
  const ack = JSON.parse(f.diagnostics.at(-1)[1]);
  assert.deepEqual(ack, { event: 'flush_ack', saved: true, windowId: f.primary.webContents.id, primaryWindowId: f.primary.webContents.id });
  f.primary.close();
  f.app.quit(); await settle();
  const events = f.diagnostics.slice(before).map(entry => JSON.parse(entry[1]));
  assert.ok(events.some(entry => entry.event === 'close_requested' && entry.primary === true));
  assert.ok(events.some(entry => entry.event === 'quit_requested' && entry.primary === true));
  assert.doesNotMatch(JSON.stringify(f.diagnostics), new RegExp(request));
  peer.finishQuit(false); await settle();
  assert.equal(f.app.committedQuits, 0);
});

test('sync diagnostics share one 100-record budget across native events, windows, and manager instances', async () => {
  const f = fixture({ diagnosticEnv: '1' }), peer = f.workbench();
  assert.equal(await f.invoke('flush', f.primary), 'primary');
  const initialCount = f.diagnostics.length;
  assert.ok(initialCount > 0 && initialCount < 100);
  for (let index = initialCount; index < 100; index++) {
    assert.equal(f.invoke('sync-diagnostic', index % 2 ? peer : f.primary, { event: 'draft_timer', draftLength: index }), true);
  }
  assert.equal(f.diagnostics.length, 100);
  assert.equal(f.invoke('sync-diagnostic', peer, { event: 'input', draftLength: 1 }), false);
  f.invoke('state', f.primary);
  assert.equal(await f.invoke('flush', f.primary), 'primary');
  const replacement = new f.exports.NextMuxConversationWindows();
  replacement.onStart(f.application);
  assert.equal(f.invoke('sync-diagnostic', f.primary, { event: 'input', draftLength: 1 }), false);
  assert.equal(f.diagnostics.length, 100, 'Replacing a manager cannot reset the main-process log budget');
});

test('a throwing diagnostic sink cannot interrupt window registration, publishing, saving, or ordered quit', async () => {
  const f = fixture({ diagnosticEnv: '1', diagnosticSinkThrow: true }), peer = f.workbench();
  assert.equal(f.invoke('state', peer).primaryWindowId, f.primary.webContents.id);
  assert.equal(f.invoke('sync-diagnostic', peer, { event: 'input', draftLength: 3 }), false);
  assert.equal(f.invoke('publish', peer, [{ id: 'healthy', set: { id: 'healthy', draftPrompt: 'kept' }, unset: [] }]), true);
  assert.equal(f.invoke('state', f.primary).sessions.find(session => session.id === 'healthy').draftPrompt, 'kept');
  const flush = f.invoke('flush', peer);
  f.invoke('flushed', f.primary, f.primary.events('flush').at(-1).requestId, true);
  assert.equal(await flush, true);
  f.primary.close();
  f.app.quit(); await settle();
  assert.deepEqual(f.closeOrder, [peer]);
  peer.finishQuit(true); await settle();
  assert.deepEqual(f.closeOrder, [peer, f.primary]);
  f.primary.finishQuit(true); await settle();
  assert.equal(f.app.committedQuits, 1);
  assert.deepEqual(f.diagnostics, []);
});

test('ordinary workbenches exchange all conversation changes while detached windows receive only their conversation', async () => {
  const f = fixture(), [child] = await f.open('detached');
  const peer = f.workbench(), other = f.workbench();
  const delta = (id, set) => ({ id, set: { id, ...set }, unset: [] });
  for (const window of f.windows) window.messages.length = 0;

  assert.equal(f.invoke('publish', peer, [delta('new-from-peer', { draftPrompt: 'peer draft', turns: [] })]), true);
  assert.equal(f.primary.events('delta').at(-1).delta.id, 'new-from-peer');
  assert.equal(other.events('delta').at(-1).delta.id, 'new-from-peer');
  assert.equal(peer.events('delta').length, 0, 'The publisher does not receive its own delta');
  assert.equal(child.events('delta').length, 0, 'An unrelated session must not appear in a detached window');

  assert.equal(f.invoke('publish', f.primary, [delta('new-from-peer', { draftPrompt: 'primary edit' })]), true);
  assert.equal(peer.events('delta').at(-1).delta.set.draftPrompt, 'primary edit');
  assert.equal(other.events('delta').at(-1).delta.set.draftPrompt, 'primary edit');
  assert.equal(f.invoke('state', peer).sessions.find(session => session.id === 'new-from-peer').draftPrompt, 'primary edit');

  assert.equal(f.invoke('publish', peer, [delta('detached', { draftPrompt: 'shared edit' })]), true);
  assert.equal(child.events('delta').at(-1).delta.set.draftPrompt, 'shared edit');
  assert.equal(f.invoke('publish', child, [delta('detached', { draftPrompt: 'child edit' })]), true);
  for (const window of [f.primary, peer, other]) assert.equal(window.events('delta').at(-1).delta.set.draftPrompt, 'child edit');
  assert.equal(f.invoke('publish', child, [delta('outside-child', { turns: [] })]), false);

  assert.equal(f.invoke('publish', peer, [], ['new-from-peer']), true);
  for (const window of [f.primary, other]) assert.deepEqual(Array.from(window.events('delta').at(-1).removed), ['new-from-peer']);
  for (const window of [f.primary, peer, other]) assert.equal(f.invoke('state', window).sessions.some(session => session.id === 'new-from-peer'), false);
  assert.deepEqual(Array.from(f.invoke('state', child).sessions, session => session.id), ['detached']);
});

test('ordinary workbench flush waits for the primary durable receipt and ignores every other acknowledgement', async () => {
  const f = fixture(), [child] = await f.open('detached');
  const peer = f.workbench(), other = f.workbench();
  assert.equal(f.invoke('state', peer).primaryWindowId, f.primary.webContents.id);
  assert.equal(await f.invoke('flush', f.primary), 'primary', 'A promoted renderer can discover that it is now the writer');
  let result = 'pending';
  const flush = f.invoke('flush', peer).then(saved => { result = saved; return saved; });
  const request = f.primary.events('flush').at(-1);
  assert.ok(request?.requestId);
  assert.equal(peer.events('flush').length, 0);
  assert.equal(other.events('flush').length, 0);
  for (const window of [peer, other, child]) f.invoke('flushed', window, request.requestId, true);
  f.invoke('flushed', f.primary, 'unrelated-request', true);
  await settle(); assert.equal(result, 'pending');
  f.invoke('flushed', f.primary, request.requestId, true);
  assert.equal(await flush, true);

  const rejected = f.invoke('flush', peer);
  f.invoke('flushed', f.primary, f.primary.events('flush').at(-1).requestId, false);
  assert.equal(await rejected, false, 'A failed durable save cannot approve peer closure');
});

test('cancelled quit preserves torn-off app tabs and their subsequent drag-out, merge and close notifications', async () => {
  let confirm = false;
  const f = fixture({ tabWindows: true, confirmQuit: async () => ({ response: confirm ? 0 : 1 }) });
  const request = { conversationId: 'conversation-a', tabId: 'window:10:77', pid: 10, windowId: 77, title: 'Fixture' };
  const callTab = (name, ...args) => f.handlers.get(`nextmux:computer:tab-window:${name}`)(f.event(f.primary), ...args);
  assert.equal(callTab('open', request), true);
  const first = f.windows.at(-1);
  f.invoke('running', f.primary, 'conversation-a', true);
  f.app.quit(); await settle();
  assert.equal(first.isDestroyed(), false, 'The native running-task cancellation retains the torn-off window');
  assert.equal(f.closeOrder.length, 0);
  assert.equal(f.app[Symbol.for('nextmux.desktop.is-quitting.v1')](), false);
  assert.equal(callTab('close', request.conversationId, request.tabId, true), true);
  assert.equal(f.primary.messages.at(-1).args[0].merged, true);
  assert.equal(callTab('open', request), true, 'A second drag-out succeeds after cancellation');
  const second = f.windows.at(-1);
  second.close();
  assert.equal(f.primary.messages.at(-1).args[0].merged, false, 'Ordinary close still notifies the parent');
  assert.equal(callTab('open', request), true);
  const third = f.windows.at(-1);
  confirm = true;
  f.app.quit(); await settle();
  assert.equal(third.isDestroyed(), false, 'Confirmed quit still waits for the workbench save veto');
  f.primary.finishQuit(false); await settle();
  assert.equal(third.isDestroyed(), false, 'A later save veto also preserves app tabs');
  assert.equal(f.app[Symbol.for('nextmux.desktop.is-quitting.v1')](), false);
  assert.equal(callTab('focus', request.conversationId, request.tabId), true);
  f.app.quit(); await settle();
  f.primary.finishQuit(true); await settle();
  assert.equal(third.isDestroyed(), true, 'Only the committed quit cleans up app tabs');
  assert.equal(f.app.committedQuits, 1);
});

test('quit closes detached windows, then ordinary workbenches, and keeps the primary until peer vetoes are resolved', async () => {
  const f = fixture(), peer = f.workbench(), other = f.workbench();
  const [child] = await f.open('detached');
  peer.hide();
  assert.equal(f.invoke('running', peer, 'peer-run', true), true);
  f.app.quit(); await settle();
  assert.deepEqual(f.closeOrder, [child]);
  child.finishQuit(true); await settle();
  assert.deepEqual(f.closeOrder, [child, peer]);
  assert.equal(peer.isVisible(), true, 'A running hidden workbench must show its close confirmation');
  assert.equal(f.primary.isDestroyed(), false);
  const receipt = f.invoke('flush', peer);
  f.invoke('flushed', f.primary, f.primary.events('flush').at(-1).requestId, true);
  assert.equal(await receipt, true);
  peer.finishQuit(false); await settle();
  assert.equal(f.app.committedQuits, 0);
  assert.equal(other.isDestroyed(), false);
  assert.equal(f.primary.isDestroyed(), false);
  assert.equal(f.app[f.exports.showMainWindowKey](), true);

  f.app.quit(); await settle();
  assert.deepEqual(f.closeOrder, [child, peer, peer]);
  peer.finishQuit(true); await settle();
  assert.deepEqual(f.closeOrder, [child, peer, peer, other]);
  other.finishQuit(true); await settle();
  assert.deepEqual(f.closeOrder, [child, peer, peer, other, f.primary]);
  f.primary.finishQuit(true); await settle();
  assert.equal(f.app.committedQuits, 1);
  assert.equal(f.windows.every(window => window.isDestroyed()), true);
});

test('quit includes an ordinary workbench that finishes registering while another peer is saving', async () => {
  const f = fixture(), first = f.workbench();
  f.app.quit(); await settle();
  assert.deepEqual(f.closeOrder, [first]);
  const late = f.workbench();
  first.finishQuit(true); await settle();
  assert.deepEqual(f.closeOrder, [first, late], 'A late OPEN_FOLDER window must save and pass its veto before the writer closes');
  assert.equal(f.primary.isDestroyed(), false);
  late.finishQuit(false); await settle();
  assert.equal(f.app.committedQuits, 0);
  assert.equal(f.primary.isDestroyed(), false);
  f.app.quit(); await settle();
  late.finishQuit(true); await settle();
  f.primary.finishQuit(true); await settle();
  assert.equal(f.app.committedQuits, 1);
  assert.equal(f.windows.every(window => window.isDestroyed()), true);
});

test('a destroyed workbench is pruned without reading native webContents and releases its run when a later peer vetoes quit', async () => {
  const f = fixture(), stale = f.workbench(), blocked = f.workbench();
  const staleId = stale.webContents.id;
  assert.equal(f.invoke('claim', stale, 'stale-run', false), true);
  assert.equal(f.invoke('running', stale, 'stale-run', true), true);
  // Model a prior native listener interrupting `closed`: the manager retains
  // the entry, but Electron's native webContents getter is already unusable.
  stale.destroyed = true;
  Object.defineProperty(stale, 'webContents', { get() { throw new Error('Object has been destroyed'); } });
  assert.doesNotThrow(() => f.invoke('publish', f.primary, [{ id: 'healthy', set: { id: 'healthy', draftPrompt: 'still usable' }, unset: [] }]));
  f.app.quit(); await settle();
  assert.deepEqual(f.closeOrder, [blocked]);
  blocked.finishQuit(false); await settle();
  assert.equal(f.app.committedQuits, 0);
  assert.equal(f.primary.isDestroyed(), false);
  assert.equal(f.invoke('state', f.primary).windows.some(entry => entry.owner === staleId), false);
  assert.equal(f.invoke('claim', f.primary, 'stale-run', false), true, 'An aborted quit cannot leave an unfinished run owned by the destroyed peer');
});

test('a surviving workbench takes over the primary role and abandoned flushes, claims, and running flags are cleared', async () => {
  const f = fixture(), [child] = await f.open('detached');
  const peer = f.workbench(), other = f.workbench();
  const oldId = f.primary.webContents.id;
  assert.equal(f.invoke('claim', f.primary, 'old-run', false), true);
  assert.equal(f.invoke('running', f.primary, 'old-run', true), true);
  assert.equal(f.invoke('claim', peer, 'old-run', false), false);
  let pendingResult = 'pending';
  const pending = f.invoke('flush', peer).then(saved => { pendingResult = saved; return saved; });
  const oldRequest = f.primary.events('flush').at(-1).requestId;
  for (const window of [peer, other, child]) window.messages.length = 0;
  f.primary.destroyFixture(); await settle();
  assert.equal(pendingResult, false, 'Losing the writer resolves its pending receipts immediately');
  assert.equal(await pending, false);

  const newId = peer.webContents.id;
  for (const window of [peer, other, child]) {
    const roleEvent = window.messages.map(message => message.args[0]).findLast(event => event?.primaryWindowId === newId);
    assert.ok(roleEvent, 'Every surviving renderer learns the writer role without polling state');
    const state = f.invoke('state', window);
    assert.equal(state.primaryWindowId, newId);
    assert.equal(state.windows.some(entry => entry.owner === oldId), false);
  }
  assert.equal(await f.invoke('flush', peer), 'primary');
  assert.equal(f.invoke('claim', peer, 'old-run', false), true, 'The destroyed writer no longer owns its unfinished run');
  assert.equal(f.invoke('claim', peer, 'old-run', true), true);

  let replacementResult = 'pending';
  const replacement = f.invoke('flush', other).then(saved => { replacementResult = saved; return saved; });
  const newRequest = peer.events('flush').at(-1).requestId;
  f.invoke('flushed', f.primary, oldRequest, true);
  f.invoke('flushed', f.primary, newRequest, true);
  await settle(); assert.equal(replacementResult, 'pending', 'Late acknowledgements from the former writer cannot confirm a new save');
  f.invoke('flushed', peer, newRequest, true);
  assert.equal(await replacement, true);

  assert.equal(f.invoke('claim', other, 'peer-run', false), true);
  assert.equal(f.invoke('running', other, 'peer-run', true), true);
  const running = f.invoke('state', peer).windows.find(entry => entry.sessionId === 'peer-run');
  assert.equal(running?.owner, other.webContents.id);
  assert.equal(running?.running, true);
  assert.equal(running?.visible, false, 'Ordinary workbench runs must not replace another workbench with a detached-window placeholder');
  other.destroyFixture();
  assert.equal(f.invoke('state', peer).windows.some(entry => entry.owner === other.webContents.id), false);
  assert.equal(f.invoke('claim', peer, 'peer-run', false), true);
  peer.hide();
  assert.equal(f.app[f.exports.showMainWindowKey](), true);
  assert.equal(peer.isVisible(), true);
});

test('quit saves and closes visible/hidden children serially, keeping the primary writer alive until last', async () => {
  const f = fixture(), [first, hidden] = await f.open('first', 'hidden');
  hidden.hide(); f.invoke('running', hidden, 'hidden', true);
  f.app.quit(); f.app.quit(); await settle();
  assert.deepEqual(f.closeOrder, [first]); assert.equal(f.app.committedQuits, 0);
  assert.equal(f.primary.isDestroyed(), false);
  f.primary.close(); assert.equal(f.primary.isVisible(), true, 'An incidental main-window close cannot remove the writer during child save');
  const flush = f.invoke('flush', first);
  const request = f.primary.events('flush').at(-1);
  f.invoke('flushed', f.primary, request.requestId, true);
  assert.equal(await flush, true, 'A child can still obtain a durable receipt from the primary during quit');
  first.finishQuit(true); await settle();
  assert.deepEqual(f.closeOrder, [first, hidden]); assert.equal(f.primary.isDestroyed(), false);
  hidden.finishQuit(true); await settle();
  assert.deepEqual(f.closeOrder, [first, hidden, f.primary]);
  f.primary.finishQuit(true); await settle();
  assert.equal(f.app.committedQuits, 1); assert.equal(f.windows.every(window => window.isDestroyed()), true);
  assert.equal(f.app.listenerCount('will-quit'), 0, 'No destructive last-minute cleanup');
});

test('quit waits for an in-flight child creation before closing the primary', async () => {
  const f = fixture(); let releaseCreation;
  const gate = new Promise(resolve => { releaseCreation = resolve; });
  f.application.createWindow = async () => { await gate; return new f.primary.constructor(); };
  f.invoke('publish', f.primary, [{ id: 'opening', set: { id: 'opening' }, unset: [] }]);
  const opening = f.invoke('open', f.primary, ['opening']);
  f.app.quit(); await settle(); assert.equal(f.closeOrder.length, 0);
  releaseCreation(); assert.equal(await opening, false); await settle();
  const child = f.windows.find(window => window !== f.primary);
  assert.deepEqual(f.closeOrder, [child]); assert.equal(f.primary.isDestroyed(), false);
  child.finishQuit(true); await settle(); f.primary.finishQuit(true); await settle();
  assert.equal(f.app.committedQuits, 1);
});

test('quit prunes already-destroyed entries even if another native closed listener interrupted notification', async () => {
  const f = fixture(), [child] = await f.open('child');
  child.destroyed = true;
  f.app.quit(); await settle();
  assert.deepEqual(f.closeOrder, [f.primary]);
  f.primary.finishQuit(true); await settle(); assert.equal(f.app.committedQuits, 1);
});

test('a child save/veto failure aborts quit with primary and remaining children usable, and retries once', async () => {
  const f = fixture(), [saved, blocked] = await f.open('saved', 'blocked');
  f.app.quit(); await settle(); saved.finishQuit(true); await settle(); blocked.finishQuit(false); await settle();
  assert.equal(f.app.committedQuits, 0); assert.equal(f.primary.isDestroyed(), false); assert.equal(blocked.isDestroyed(), false);
  assert.equal(f.invoke('state', f.primary).sessions.some(session => session.id === 'saved' && session.draftPrompt === 'draft saved'), true);
  assert.equal(f.app[f.exports.showMainWindowKey](), true);
  assert.equal(await f.invoke('focus', f.primary, 'blocked'), true);
  f.app.quit(); await settle();
  assert.deepEqual(f.closeOrder, [saved, blocked, blocked]);
  blocked.finishQuit(true); await settle(); f.primary.finishQuit(true); await settle();
  assert.equal(f.app.committedQuits, 1);
});

test('Exit tiling returns one conversation: its window hides at once and the main window reveals that conversation', async () => {
  const f = fixture(), [first, second] = await f.open('first', 'second');
  const third = (await f.open('third')).find(window => new URL(window.webContents.url).searchParams.get('nextmuxConversation') === 'third');
  const reveals = () => f.primary.events('reveal').map(event => event.sessionId);
  const listed = sessionId => f.invoke('state', f.primary).windows.find(entry => entry.sessionId === sessionId);
  f.primary.hide();

  // A detached window exits tiling for its own conversation only.
  assert.equal(f.invoke('reclaim', second, 'first'), false);
  assert.equal(f.invoke('reclaim', second, '__warm__'), false);
  assert.equal(first.isVisible(), true);
  assert.equal(f.primary.isVisible(), false);
  assert.deepEqual(reveals(), []);

  // "Exit tiling" in the window (closing its conversation tab sends no id).
  const bounds = first.getBounds();
  assert.equal(f.invoke('reclaim', first), true);
  assert.equal(first.isVisible(), false, 'hidden at once, without the bulk fade-out interval');
  assert.equal(first.isDestroyed(), false);
  assert.equal(first.events('hidden').length, 1);
  assert.equal(first.events('reclaiming').length, 0);
  assert.equal(f.primary.isVisible(), true, 'the main window comes forward');
  assert.equal(f.primary.events('motion').at(-1).motion.kind, 'reclaim');
  assert.deepEqual(f.primary.events('motion').at(-1).motion.bounds, bounds);
  assert.deepEqual(reveals(), ['first']);
  assert.equal(listed('first').visible, false);
  for (const window of [second, third]) {
    assert.equal(window.isVisible(), true, 'the other tiles stay');
    assert.equal(window.events('hidden').length, 0);
    assert.equal(window.events('reclaiming').length, 0);
  }

  // Its own id, as the tab menu's "Exit tiling" sends it.
  assert.equal(f.invoke('reclaim', second, 'second'), true);
  assert.equal(second.isVisible(), false);
  assert.equal(second.events('hidden').length, 1);
  assert.deepEqual(reveals(), ['first', 'second']);

  // The main window returns one conversation by its id.
  assert.equal(f.invoke('reclaim', f.primary, 'third'), true);
  assert.equal(third.isVisible(), false);
  assert.equal(third.events('hidden').length, 1);
  assert.deepEqual(reveals(), ['first', 'second', 'third']);
  assert.deepEqual(['first', 'second', 'third'].map(id => listed(id).visible), [false, false, false]);
  f.advance(1_000);
  assert.equal([first, second, third].every(window => !window.isDestroyed() && !window.isVisible()), true, 'no window is closed or shown again');
  assert.equal(f.closeOrder.length, 0);
});

test('only the primary reclaims every tile; running children stay alive and hide after the native animation interval', async () => {
  const f = fixture(), [first, last] = await f.open('first', 'last');
  const peer = f.workbench();
  assert.equal(f.primary.events('motion').at(-1).motion.kind, 'detach');
  assert.deepEqual(f.primary.events('motion').at(-1).motion.bounds, last.getBounds());
  f.invoke('running', last, 'last', true);
  // Without an id, an ordinary workbench (neither the main window nor a tile) returns nothing.
  assert.equal(f.invoke('reclaim', peer), false);
  assert.equal(first.isVisible(), true); assert.equal(last.isVisible(), true);
  assert.equal(first.events('reclaiming').length, 0); assert.equal(last.events('reclaiming').length, 0);
  assert.equal(f.primary.events('reveal').length, 0);
  assert.equal(f.invoke('reclaim', f.primary), true);
  assert.equal(first.events('reclaiming').length, 1); assert.equal(last.events('reclaiming').length, 1);
  assert.equal(f.primary.events('motion').at(-1).motion.kind, 'reclaim');
  assert.equal(first.isVisible(), true); f.advance(219); assert.equal(first.isVisible(), true);
  f.advance(1); assert.equal(first.isVisible(), false); assert.equal(last.isVisible(), false);
  assert.equal(last.isDestroyed(), false); assert.equal(f.invoke('state', f.primary).windows.find(entry => entry.sessionId === 'last').running, true);
  assert.equal(last.events('hidden').length, 1); assert.equal(f.closeOrder.length, 0);
});

test('detach motion carries the initiating pointer origin for the first reclaim control', async () => {
  const f = fixture();
  f.invoke('publish', f.primary, [{ id: 'origin', set: { id: 'origin' }, unset: [] }]);
  assert.equal(await f.invoke('open', f.primary, ['origin'], { x: 420, y: 310 }), true);
  const motion = f.primary.events('motion').at(-1).motion;
  assert.equal(motion.kind, 'detach');
  assert.equal(motion.origin.x, 420);
  assert.equal(motion.origin.y, 310);
});

test('reduced motion hides immediately and a reopened child cannot be hidden by an old reclaim timer', async () => {
  const reduced = fixture({ reducedMotion: true }), [child] = await reduced.open('child');
  reduced.invoke('reclaim', reduced.primary); assert.equal(child.isVisible(), false); assert.equal(child.events('hidden').length, 1);
  const f = fixture(), [other] = await f.open('other');
  f.invoke('reclaim', f.primary); f.invoke('focus', f.primary, 'other'); f.advance(220);
  assert.equal(other.isVisible(), true); assert.equal(other.events('hidden').length, 0);
});

test('shared native show-main entry restores only the primary even when a child is visible', async () => {
  const f = fixture(), [child] = await f.open('child');
  f.primary.hide(); f.primary.minimized = true; const focused = child.focusCalls;
  assert.equal(f.app[f.exports.showMainWindowKey](), true);
  assert.equal(f.primary.isVisible(), true); assert.equal(f.primary.isMinimized(), false); assert.equal(child.focusCalls, focused);
  f.primary.hide();
  assert.equal(f.handlers.get('nextmux:window:show-main')(f.event(child)), true);
  assert.equal(f.primary.isVisible(), true);
  assert.equal(f.handlers.get('nextmux:window:show-main')({ ...f.event(child), senderFrame: {} }), false);
});

test('closing the primary with no detached children hides the interface without quitting the app', async () => {
  const f = fixture();
  f.primary.close();
  assert.equal(f.primary.isVisible(), false);
  assert.equal(f.app.quitCalls, 0);
});

// Theia keeps one saved window state, the one the next main window reopens with, and writes it from every window
// it created. The actual Theia methods run under the actual NextMux overrides, without Electron.
const mainModuleSource = readFileSync(new URL('../../../packages/theia-nextmux-extension/src/electron-main/nextmux-electron-main-module.ts', import.meta.url), 'utf8');
const theiaApplicationSource = readFileSync(extensionRequire.resolve('@theia/core/src/electron-main/electron-main-application.ts'), 'utf8');
const windowBoundsSource = readFileSync(new URL('../../../packages/theia-nextmux-extension/src/electron-main/nextmux-window-bounds.ts', import.meta.url), 'utf8');

function classMethodSource(text, className, names) {
  const file = ts.createSourceFile('source.ts', text, ts.ScriptTarget.Latest, true);
  const declaration = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
  return names.map(name => {
    const member = declaration?.members.find(node => node.name?.getText(file) === name);
    assert.ok(member, `${className}.${name} exists`);
    return member.getText(file);
  }).join('\n');
}

function windowStateFixture() {
  const { exports } = fixture();
  const bounds = {};
  new Function('exports', ts.transpileModule(windowBoundsSource, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
  } }).outputText)(bounds);
  const stored = new Map(), writes = [], logged = [], nativeWindows = [];
  const electronStore = {
    get: key => stored.has(key) ? structuredClone(stored.get(key)) : undefined,
    set: (key, value) => { stored.set(key, structuredClone(value)); writes.push(key); }
  };
  const display = { bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 875 } };
  const screen = { getAllDisplays: () => [display], getDisplayMatching: () => display };
  const BrowserWindow = { fromWebContents: contents => nativeWindows.find(window => window.webContents === contents) };
  const Application = new Function('BrowserWindow', 'screen', 'path', 'console', 'fitWindowToWorkArea', 'mainWindowMinimumSize',
    'isDetachedConversationWindow', 'isRestorableWorkbenchWindowState', 'WORKBENCH_WINDOW_STATE_ROLE', ts.transpile(`
      class ElectronMainApplication { ${classMethodSource(theiaApplicationSource, 'ElectronMainApplication', ['saveState', 'saveWindowState', 'getLastWindowOptions', 'getCurrentScreenLayout'])} }
      class NextMuxElectronMainApplication extends ElectronMainApplication { ${classMethodSource(mainModuleSource, 'NextMuxElectronMainApplication', ['getLastWindowOptions', 'saveWindowState'])} }
      return NextMuxElectronMainApplication;`, { target: ts.ScriptTarget.ES2022 }))(
    BrowserWindow, screen, path, { error: (...args) => logged.push(args), warn: (...args) => logged.push(args) },
    bounds.fitWindowToWorkArea, bounds.mainWindowMinimumSize,
    exports.isDetachedConversationWindow, exports.isRestorableWorkbenchWindowState, exports.WORKBENCH_WINDOW_STATE_ROLE);
  const defaults = { frame: true, show: false, x: 116, y: 95, width: 1209, height: 735 };
  const application = Object.assign(new Application(), {
    electronStore, useNativeWindowFrame: true, globals: { THEIA_APP_PROJECT_PATH: '/fixture' },
    getDefaultTheiaWindowOptions: () => ({ ...defaults }), getDefaultOptions: () => ({ show: false, minWidth: 360, minHeight: 420 })
  });
  const nativeWindow = ({ x, y, width, height, url = 'file:///fixture/index.html', detached = false }) => {
    const window = {
      destroyed: false, bounds: { x, y, width, height }, webContents: { getURL: () => url },
      isDestroyed: () => window.destroyed,
      getBounds() { if (window.destroyed) throw new Error('Object has been destroyed'); return { ...window.bounds }; },
      isFullScreen: () => false, isMaximized: () => false, getBackgroundColor: () => '#181818'
    };
    if (detached) window[Symbol.for('nextmux.conversation-window.detached.v1')] = true;
    nativeWindows.push(window);
    return window;
  };
  const size = options => ({ x: options.x, y: options.y, width: options.width, height: options.height });
  return { application, exports, stored, writes, logged, nativeWindow, defaults, size };
}

test('detached and standby windows are recognised before and after loading; only a mark or a non-tile size restores the main window', () => {
  const { exports } = fixture();
  const key = Symbol.for('nextmux.conversation-window.detached.v1');
  const window = (url, extra = {}) => ({ isDestroyed: () => false, webContents: { getURL: () => url }, ...extra });
  assert.equal(exports.isDetachedConversationWindow(undefined), false);
  assert.equal(exports.isDetachedConversationWindow(window('file:///fixture/index.html')), false);
  assert.equal(exports.isDetachedConversationWindow(window('file:///fixture/index.html?locale=en&nextmuxConversation=chat')), true, 'loaded with its conversation');
  assert.equal(exports.isDetachedConversationWindow(window('', { [key]: true })), true, 'marked before its page loads');
  assert.equal(exports.isDetachedConversationWindow(window('not a URL')), false);
  const destroyed = { isDestroyed: () => true, get webContents() { throw new Error('Object has been destroyed'); } };
  const destroyedTile = { [key]: true, isDestroyed: () => true, get webContents() { throw new Error('Object has been destroyed'); } };
  assert.equal(exports.isDetachedConversationWindow(destroyed), false);
  assert.equal(exports.isDetachedConversationWindow(destroyedTile), true);

  const role = exports.WORKBENCH_WINDOW_STATE_ROLE;
  for (const [state, restorable] of [
    [{ width: 380, height: 540 }, false], [{ width: 240, height: 300 }, false], [{ width: 380, height: 422 }, false],
    [{ width: 381, height: 540 }, true], [{ width: 380, height: 541 }, true], [{ width: 1200, height: 800 }, true],
    [{ width: 370, height: 460, nextmuxWindowRole: role }, true], [{ width: 370, height: 460, nextmuxWindowRole: 'other' }, false], [{}, true]
  ]) assert.equal(exports.isRestorableWorkbenchWindowState(state), restorable, JSON.stringify(state));
});

test('detached tiles and standby windows never become the size the main window reopens at', async () => {
  const f = windowStateFixture();
  const main = f.nativeWindow({ x: 120, y: 80, width: 1180, height: 760 });
  f.application.saveWindowState(main);
  const saved = structuredClone(f.stored.get('windowstate'));
  assert.deepEqual(f.size(saved), { x: 120, y: 80, width: 1180, height: 760 });
  assert.equal(saved.nextmuxWindowRole, f.exports.WORKBENCH_WINDOW_STATE_ROLE, 'a workbench window marks the state it saves');
  assert.equal(saved.screenLayout, f.application.getCurrentScreenLayout());
  const writes = f.writes.length;

  const tile = f.nativeWindow({ x: 10, y: 35, width: 380, height: 422, url: 'file:///fixture/index.html?nextmuxConversation=chat', detached: true });
  const standby = f.nativeWindow({ x: 400, y: 35, width: 380, height: 422, url: 'file:///fixture/index.html?nextmuxConversation=__warm__', detached: true });
  const unmarked = f.nativeWindow({ x: 790, y: 35, width: 460, height: 540, url: 'file:///fixture/index.html?nextmuxConversation=other' });
  const loading = f.nativeWindow({ x: 10, y: 467, width: 380, height: 422, url: '', detached: true });
  for (const window of [tile, standby, unmarked, loading]) {
    // Moving, resizing and closing save directly; a page reporting its theme or title bar saves through saveState.
    f.application.saveWindowState(window);
    f.application.saveState(window.webContents);
  }
  assert.equal(f.writes.length, writes, 'no detached window wrote the saved state');
  assert.deepEqual(f.stored.get('windowstate'), saved);

  // A resize debounced before the main window closed has nothing to save, and logs no error.
  main.destroyed = true;
  f.application.saveWindowState(main);
  assert.equal(f.writes.length, writes);
  assert.deepEqual(f.logged, []);

  const restored = await f.application.getLastWindowOptions();
  assert.deepEqual(f.size(restored), { x: 120, y: 80, width: 1180, height: 760 });
  assert.equal(Object.hasOwn(restored, 'nextmuxWindowRole'), false, 'the mark never reaches BrowserWindow');
  assert.equal(restored.minWidth, 360);
  assert.equal(restored.webPreferences.preload, path.resolve('/fixture', 'lib', 'frontend', 'preload.js'));
});

test('a state an earlier version left at a tile size reopens the main window at its default size', async () => {
  const f = windowStateFixture();
  const layout = f.application.getCurrentScreenLayout();
  const restore = state => { f.stored.set('windowstate', { ...state, screenLayout: layout }); return f.application.getLastWindowOptions(); };
  // A detached tile was the last window an earlier version saved.
  assert.deepEqual(f.size(await restore({ x: 10, y: 35, width: 380, height: 422 })), f.size(f.defaults));
  assert.deepEqual(f.size(await restore({ x: 400, y: 35, width: 240, height: 300 })), f.size(f.defaults));
  // An earlier main window of any other size reopens as it was.
  assert.deepEqual(f.size(await restore({ x: 60, y: 40, width: 1100, height: 700 })), { x: 60, y: 40, width: 1100, height: 700 });
  assert.deepEqual(f.size(await restore({ x: 60, y: 40, width: 420, height: 700 })), { x: 60, y: 40, width: 420, height: 700 });
  // A main window saved by this version keeps even a small size the user chose.
  const marked = await restore({ x: 30, y: 60, width: 370, height: 460, nextmuxWindowRole: f.exports.WORKBENCH_WINDOW_STATE_ROLE });
  assert.deepEqual(f.size(marked), { x: 30, y: 60, width: 370, height: 460 });
  assert.equal(Object.hasOwn(marked, 'nextmuxWindowRole'), false);
  // Its next save marks the state again, so that size keeps being restored.
  f.application.saveWindowState(f.nativeWindow({ x: 30, y: 60, width: 370, height: 460 }));
  assert.equal(f.stored.get('windowstate').nextmuxWindowRole, f.exports.WORKBENCH_WINDOW_STATE_ROLE);
  assert.deepEqual(f.size(await f.application.getLastWindowOptions()), { x: 30, y: 60, width: 370, height: 460 });
});
