import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { registerComputerTabWindows } = require('../computer-tab-window.cjs');

function fakes() {
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const created = [];
  let nextId = 100;
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false; created.push(this);
      const window = this;
      this.webContents = Object.assign(new EventEmitter(), { id: nextId++, mainFrame: {}, setWindowOpenHandler() {}, isDestroyed: () => window.destroyed });
      Object.defineProperty(this, Symbol.for('nextmux.desktop.close-coordinator.v1'), { value: { managed: false } });
    }
    loadFile(file, options) { this.loaded = { file, options }; return Promise.resolve(); }
    setMenuBarVisibility() {}
    isDestroyed() { return this.destroyed; }
    show() { this.shown = true; } focus() { this.focused = true; }
    close() { this.destroyed = true; this.emit('closed'); }
    destroy() { this.close(); }
  }
  const screen = () => ({ getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1600, height: 1000 } }) });
  const calls = [];
  const view = {
    canView: (conversationId, pid, windowId) => conversationId === 'conversation-a' && pid === 10 && windowId === 77,
    capability: () => ({ park: true, pointer: true, sound: true }),
    arm: async (...args) => { calls.push(['arm', ...args]); return { ok: true, placement: 'tab', sound: false }; },
    setSound: async (...args) => { calls.push(['sound', ...args]); return { ok: true, sound: args[3] }; },
    place: async (...args) => { calls.push(['place', ...args]); return { ok: true, placement: args[3] }; }
  };
  const pointer = async (...args) => { calls.push(['pointer', ...args]); return { ok: true }; };
  const parentMessages = [];
  const parent = { id: 1, isDestroyed: () => false, send: (...args) => parentMessages.push(args) };
  const trusted = event => event.sender === parent;
  const windows = registerComputerTabWindows({ ipcMain, BrowserWindow, screen, view, trusted, pointer });
  const invoke = (channel, sender, ...args) => handlers.get(channel)({ sender, senderFrame: sender.mainFrame }, ...args);
  return { handlers, created, calls, parent, parentMessages, invoke, windows };
}

test('a tab torn off opens one window for that tab only, from the trusted app window only', async () => {
  const f = fakes();
  const request = { conversationId: 'conversation-a', tabId: 'window:10:77', pid: 10, windowId: 77, title: 'WeChat', point: { x: 1590, y: 20 }, theme: 'light', labels: { live: '实时', bad_key: 'x' } };
  assert.equal(await f.invoke('nextmux:computer:tab-window:open', { id: 9, mainFrame: {} }, request), false, 'an untrusted page cannot open one');
  assert.equal(await f.invoke('nextmux:computer:tab-window:open', f.parent, { ...request, windowId: 78 }), false, 'only a window the conversation may view');
  assert.equal(await f.invoke('nextmux:computer:tab-window:open', f.parent, request), true);
  assert.equal(await f.invoke('nextmux:computer:tab-window:open', f.parent, request), true, 'the same tab focuses its window');
  assert.equal(f.created.length, 1);
  const [window] = f.created;
  assert.equal(window[Symbol.for('nextmux.desktop.close-coordinator.v1')]?.managed, true, 'closes without the workbench save handshake');
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.ok(window.options.x <= 1600 - 960, 'kept on the display');
  assert.deepEqual(JSON.parse(window.loaded.options.query.labels), { live: '实时' });
  assert.equal(window.loaded.options.query.theme, 'light');

  // The window's page reaches only its own tab.
  assert.deepEqual(await f.invoke('nextmux:tab-window:start', window.webContents), { ok: true, placement: 'tab', sound: false });
  await f.invoke('nextmux:tab-window:pointer', window.webContents, { kind: 'click', x: 0.5, y: 0.5 });
  await f.invoke('nextmux:tab-window:sound', window.webContents, true);
  await f.invoke('nextmux:tab-window:place', window.webContents, 'desktop');
  assert.deepEqual(f.calls, [['arm', window.webContents.id, 'conversation-a', 10, 77], ['pointer', 'conversation-a', 1, 10, 77, { kind: 'click', x: 0.5, y: 0.5 }],
    ['sound', 'conversation-a', 10, 77, true], ['place', 'conversation-a', 10, 77, 'desktop', { activate: true }]]);
  assert.deepEqual(await f.invoke('nextmux:tab-window:start', f.parent), { ok: false, error: 'window_not_viewable' }, 'another page is not a tab window');
  assert.deepEqual(await f.invoke('nextmux:tab-window:identity', window.webContents), { conversationId: 'conversation-a', tabId: 'window:10:77' });

  // Closing its own tab closes the tab, as a browser window's last tab does.
  assert.equal(await f.invoke('nextmux:tab-window:close-tab', window.webContents), true);
  assert.deepEqual(f.parentMessages.at(-1), ['nextmux:computer:tab-window:event', { type: 'closed', conversationId: 'conversation-a', tabId: 'window:10:77', merged: false }]);
});

test('dragging the tab back onto the conversation\'s strip merges it; quitting leaves the conversation\'s tabs alone', async () => {
  const f = fakes();
  const request = { conversationId: 'conversation-a', tabId: 'window:10:77', pid: 10, windowId: 77, title: 'WeChat', point: { x: 10, y: 10 } };
  await f.invoke('nextmux:computer:tab-window:open', f.parent, request);
  assert.equal(await f.invoke('nextmux:computer:tab-window:close', { id: 9, mainFrame: {} }, 'conversation-a', 'window:10:77', true), false, 'only the app window can merge');
  assert.equal(await f.invoke('nextmux:computer:tab-window:close', f.parent, 'conversation-a', 'window:10:77', true), true);
  assert.deepEqual(f.parentMessages.at(-1)[1], { type: 'closed', conversationId: 'conversation-a', tabId: 'window:10:77', merged: true });
  await f.invoke('nextmux:computer:tab-window:open', f.parent, request);
  const count = f.parentMessages.length;
  f.windows.closeAll();
  assert.equal(f.parentMessages.length, count, 'no tab closes because NextMux quits');
  await f.invoke('nextmux:computer:tab-window:open', f.parent, request);
  f.created.at(-1).close();
  assert.equal(f.parentMessages.length, count + 1, 'cleanup does not leave a global quitting flag on later windows');
});
