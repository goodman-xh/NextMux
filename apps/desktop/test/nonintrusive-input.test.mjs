import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { ComputerAutomation, registerComputerAutomation } = require('../computer-automation.cjs');
const request = (action, input = {}, id = crypto.randomUUID()) => ({ id, conversationId: 'c', action, input, expiresAt: Date.now() + 10000 });
function engine(platform, extra = {}) {
  const calls = [];
  const host = new ComputerAutomation({ platform, isBuiltinProcess: pid => [process.pid, 9001, 9002].includes(pid),
    sdkLoader: async () => ({ create: async () => ({
      observeWindow: async () => ({ elements: [{ element_token: 't' }], screenshot: { width: 800, height: 600, images: [] } }),
      click: async () => { calls.push('sdk-event'); throw Error('opaque SDK write must not run'); },
      typeText: async () => { calls.push('sdk-event'); throw Error('opaque SDK write must not run'); },
      close: async () => {}
    }) }),
    windowsInput: { post: async input => { calls.push(['post', input]); }, execute: async () => { calls.push('HID'); throw Error('global input'); }, dispose: async () => {} },
    view: { grant: () => {}, pointer: async (_c, _p, _w, input) => { calls.push(['ax-pointer', input]); return { ok: true, effect: 'dispatched' }; },
      keys: async (_c, _p, _w, input) => { calls.push(['ax-keys', input]); return { ok: true, effect: 'dispatched' }; } }, ...extra });
  host.view.dispose ??= async () => {};
  return { host, calls };
}
for (const delivery of [undefined, 'auto', 'background', 'foreground']) {
  test(`mac tab ${delivery} always uses scoped AX, never SDK or HID`, async () => {
    const { host, calls } = engine('darwin');
    try {
      assert.equal((await host.userPointer('c', 1, { pid: 7, windowId: 9, kind: 'click', x: .2, y: .3, delivery, keepFront: true })).ok, true);
      assert.equal((await host.userKeys('c', 1, { pid: 7, windowId: 9, text: 'abc', delivery, keepFront: true })).ok, true);
      assert.deepEqual(calls.map(x => x[0]), ['ax-pointer', 'ax-keys']);
      assert.ok(calls.every(x => x[1].delivery === 'semantic'));
    } finally { await host.dispose(); }
  });
  test(`Windows tab ${delivery} uses posted messages and never execute`, async () => {
    const { host, calls } = engine('win32');
    try {
      assert.equal((await host.userPointer('c', 1, { pid: 7, windowId: 9, kind: 'click', x: .2, y: .3, delivery })).ok, true);
      assert.equal((await host.userKeys('c', 1, { pid: 7, windowId: 9, key: 'a', delivery })).ok, true);
      assert.deepEqual(calls.map(x => x[0]), ['post', 'post']);
    } finally { await host.dispose(); }
  });
}
test('background failure and unknown completion never trigger fallback/replay', async () => {
  for (const platform of ['darwin', 'win32']) {
    let count = 0, fallback = 0;
    const failure = () => { count++; throw Object.assign(Error('unconfirmed'), { code: 'computer_ax_action_unconfirmed' }); };
    const { host } = engine(platform, { view: { pointer: failure }, windowsInput: { post: failure, execute: () => fallback++, dispose: async () => {} } });
    try {
      const result = await host.userPointer('c', 1, { pid: 7, windowId: 9, kind: 'click', x: .2, y: .3, delivery: 'auto' });
      assert.equal(result.error, 'computer_ax_action_unconfirmed'); assert.equal(count, 1); assert.equal(fallback, 0);
    } finally { await host.dispose(); }
  }
});
test('host, renderer and guest PIDs are rejected on all application input routes', async () => {
  const { host, calls } = engine('darwin');
  try {
    for (const pid of [process.pid, 9001, 9002]) {
      assert.equal((await host.run(request('click', { pid, windowId: 9, snapshotId: 'x', x: 3, y: 4 }), 1)).error, 'computer_builtin_surface_requires_browser');
      assert.equal((await host.userPointer('c', 1, { pid, windowId: 9, kind: 'click', x: .2, y: .3 })).error, 'computer_builtin_surface_requires_browser');
      assert.equal((await host.userKeys('c', 1, { pid, windowId: 9, key: 'a' })).error, 'computer_builtin_surface_requires_browser');
    }
    assert.equal(calls.length, 0);
  } finally { await host.dispose(); }
});
test('opaque SDK token/pixel events are denied; fresh screenshot coordinates use scoped AX', async () => {
  const { host, calls } = engine('darwin');
  try {
    let observed = await host.run(request('observeWindow', { pid: 7, windowId: 9 }), 1);
    assert.equal((await host.run(request('click', { pid: 7, windowId: 9, snapshotId: observed.output.snapshotId, elementToken: 't' }), 1)).error, 'computer_element_unlocatable');
    observed = await host.run(request('observeWindow', { pid: 7, windowId: 9 }), 1);
    assert.equal((await host.run(request('click', { pid: 7, windowId: 9, snapshotId: observed.output.snapshotId, x: 400, y: 150 }), 1)).ok, true);
    assert.equal(calls.length, 1); assert.equal(calls[0][0], 'ax-pointer');
    assert.equal(calls[0][1].x, .5); assert.equal(calls[0][1].y, .25);
  } finally { await host.dispose(); }
});
test('held/chord/drag/move Windows operations dispatch via post and never execute global HID', async () => {
  const { host, calls } = engine('win32');
  try {
    for (const input of [{ key: 'a', holdMs: 50 }, { keys: ['ctrl', 'a'] }, { key: 'a', modifiers: ['ctrl'] }, { key: 'ctrl' }])
      assert.equal((await host.userKeys('c', 1, { pid: 7, windowId: 9, ...input })).ok, true);
    assert.equal((await host.userPointer('c', 1, { pid: 7, windowId: 9, kind: 'drag', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } })).ok, true);
    assert.equal((await host.userPointer('c', 1, { pid: 7, windowId: 9, kind: 'move', x: .2, y: .3, keepFront: true })).ok, true);
    assert.equal(calls.length, 6);
    assert.ok(calls.every(([kind]) => kind === 'post'));
  } finally { await host.dispose(); }
});
test('macOS hover uses the scoped native pointer route without substituting a click or global move', async () => {
  const { host, calls } = engine('darwin');
  try {
    const result = await host.userPointer('c', 1, { pid: 7, windowId: 9, kind: 'move', x: .2, y: .3, keepFront: true });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'ax-pointer');
    assert.equal(calls[0][1].kind, 'move');
    assert.equal(calls[0][1].delivery, 'semantic');
  } finally { await host.dispose(); }
});
test('same-window cancellation and ownership remain enforced before dispatch', async () => {
  let release; const barrier = new Promise(resolve => release = resolve); let invoked = 0;
  const { host } = engine('darwin', { view: { pointer: async () => { invoked++; await barrier; return { ok: true }; } } });
  try {
    host.windows.set('7:9', 'c');
    assert.equal((await host.userPointer('other', 2, { pid: 7, windowId: 9, kind: 'click', x: .2, y: .3 })).error, 'computer_window_owned');
    const first = host.userPointer('c', 1, { pid: 7, windowId: 9, kind: 'click', x: .2, y: .3 });
    await new Promise(resolve => setImmediate(resolve));
    const controller = new AbortController();
    const second = host.userPointer('c', 1, { pid: 7, windowId: 9, kind: 'click', x: .2, y: .3, signal: controller.signal });
    controller.abort(); release();
    assert.equal((await first).ok, true); assert.equal((await second).ok, false); assert.equal(invoked, 1);
  } finally { release(); await host.dispose(); }
});

for (const platform of ['darwin', 'win32']) test(`${platform} AI screenshot drag and scroll use normalized background coordinates`, async () => {
  const { host, calls } = engine(platform);
  try {
    let observed = await host.run(request('observeWindow', { pid: 7, windowId: 9 }), 1);
    assert.equal((await host.run(request('drag', { pid: 7, windowId: 9, snapshotId: observed.output.snapshotId,
      fromX: 80, fromY: 120, toX: 400, toY: 300, durationMs: 250 }), 1)).ok, true);
    assert.deepEqual(calls[0][1].from, { x: .1, y: .2 });
    assert.deepEqual(calls[0][1].to, { x: .5, y: .5 });
    observed = await host.run(request('observeWindow', { pid: 7, windowId: 9 }), 1);
    assert.equal((await host.run(request('scroll', { pid: 7, windowId: 9, snapshotId: observed.output.snapshotId,
      x: 400, y: 300, direction: 'down', amount: 2 }), 1)).ok, true);
    assert.equal(calls[1][1].kind, 'scroll');
    assert.equal(calls[1][1].x, .5);
    assert.ok(calls.every(([kind]) => kind === (platform === 'win32' ? 'post' : 'ax-pointer')));
  } finally { await host.dispose(); }
});

// Exercise the real IPC/lifecycle wiring with explicit native-view and plugin
// boundary spies; the plugin suite checks the actual run/decision state machine.
function pluginIpcFixture() {
  const viewModule = require('../computer-window-view.cjs'), pluginModule = require('../app-plugins.cjs');
  const originalView = viewModule.createComputerWindowView, originalPlugins = pluginModule.registerAppPlugins;
  const handlers = new Map(), calls = [], visible = new Map(), running = new Set();
  let windowEvent, inputEnabled = false;
  const host = {
    platform: 'darwin', sessions: new Map(), windows: new Map(),
    openAppInTab: async (conversationId, owner, selector) => {
      const pid = selector === 'second' ? 11 : 10, windowId = pid + 10;
      host.windows.set(`${pid}:${windowId}`, conversationId);
      host.sessions.set(conversationId, { owner });
      return { ok: true, pid, windowId };
    },
    release: async id => { host.sessions.delete(id); },
    forgetWindow: async (id, pid, windowId) => {
      for (const [key, conversationId] of host.windows) if (conversationId === id && (pid === undefined || key === `${pid}:${windowId}`)) host.windows.delete(key);
    },
    userPointer: async (...args) => { calls.push(['pointer', ...args]); return { ok: true }; },
    userKeys: async (...args) => { calls.push(['keys', ...args]); return { ok: true }; }
  };
  const view = {
    canView: (id, pid, windowId) => visible.get(`${pid}:${windowId}`) === id,
    openInTab: async (id, pid, windowId) => { visible.set(`${pid}:${windowId}`, id); return { ok: true }; },
    userInput: () => inputEnabled,
    setUserInput: (id, pid, windowId, on) => {
      calls.push(['user-input', id, pid, windowId, on]);
      if (!view.canView(id, pid, windowId)) return { ok: false };
      inputEnabled = on; return { ok: true };
    },
    forget: async (id, pid, windowId) => {
      for (const [key, conversationId] of visible) if (conversationId === id && (pid === undefined || key === `${pid}:${windowId}`)) visible.delete(key);
    },
    hasWindows: id => [...visible.values()].includes(id)
  };
  viewModule.createComputerWindowView = options => { windowEvent = options.onWindowEvent; return view; };
  pluginModule.registerAppPlugins = () => ({
    onUserIntervention: (...args) => calls.push(['tip', ...args]),
    stopForWindow: (...args) => { calls.push(['stop-window', ...args]); running.delete(`${args[0]}:${args[1]}`); },
    stopForConversations: async ids => { calls.push(['stop-conversations', ids]); },
    running: (pid, windowId) => running.has(`${pid}:${windowId}`),
    rebindWindow: (...args) => {
      calls.push(['rebind', ...args]); running.delete(`${args[1]}:${args[2]}`); running.add(`${args[3]}:${args[4]}`); return true;
    }
  });
  try {
    registerComputerAutomation({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, automation: host,
      desktopCapturer: {}, shell: {}, dialog: {}, nativeImage: {}, trustedMainFrame: () => true });
  } finally { viewModule.createComputerWindowView = originalView; pluginModule.registerAppPlugins = originalPlugins; }
  const sender = Object.assign(new EventEmitter(), { id: 1, dead: false, isDestroyed() { return this.dead; }, send() {} });
  const invoke = (method, id, ...args) => handlers.get(`nextmux:computer:view:${method}`)({ sender }, id, ...args);
  return { calls, visible, running, host, sender, invoke, windowEvent: event => windowEvent(event) };
}

test('keyboard/mouse IPC sends a tip after enabling input; clicks, scrolling and typing never request plugin pause or stop', async () => {
  const f = pluginIpcFixture();
  await f.invoke('open-app', 'c1', 'first'); f.running.add('10:20');
  assert.equal((await f.invoke('user-input', 'c1', '10', '20', true)).ok, true);
  assert.deepEqual(f.calls.slice(0, 2), [['user-input', 'c1', 10, 20, true], ['tip', 10, 20, 'user_input']]);
  for (const pointer of [{ kind: 'click', x: .2, y: .3 }, { kind: 'scroll', direction: 'down', amount: 1 }]) {
    assert.equal((await f.invoke('pointer', 'c1', { pid: 10, windowId: 20, ...pointer })).ok, true);
  }
  assert.equal((await f.invoke('keys', 'c1', { pid: 10, windowId: 20, text: 'hello' })).ok, true);
  assert.equal(f.calls.filter(([kind]) => kind === 'tip').length, 4);
  assert.equal((await f.invoke('pointer', 'c1', { pid: 10, windowId: 20, kind: 'click', x: .2, y: .3, restore: true, source: 'agent' })).ok, true);
  assert.equal((await f.invoke('keys', 'c1', { pid: 10, windowId: 20, key: 'Enter', restore: true, source: 'agent' })).ok, true);
  assert.equal(f.calls.filter(([kind]) => kind === 'tip').length, 4, 'agent tabs.* input must not trigger user_takeover');
  assert.equal(f.calls.filter(([kind]) => kind.startsWith('stop')).length, 0);
  assert.equal(f.running.has('10:20'), true);
  await f.invoke('user-input', 'c1', 10, 20, false);
  await f.invoke('user-input', 'c1', 99, 99, true);
  assert.equal(f.calls.filter(([kind]) => kind === 'tip').length, 4, 'off and unrelated windows do not emit intervention tips');
});

test('forgetting an entire conversation and destroying its owner notify plugin cleanup with the correct conversation', async () => {
  const f = pluginIpcFixture();
  await f.invoke('open-app', 'c1', 'first');
  await f.invoke('open-app', 'c2', 'second');
  assert.equal(await f.invoke('forget', 'c1'), true);
  assert.deepEqual(f.calls.filter(([kind]) => kind === 'stop-conversations'), [['stop-conversations', ['c1']]]);
  assert.equal(f.visible.get('11:21'), 'c2');
  f.sender.dead = true; f.sender.emit('destroyed');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls.filter(([kind]) => kind === 'stop-conversations'), [['stop-conversations', ['c1']], ['stop-conversations', ['c2']]]);
  assert.equal(f.visible.size, 0);
});

test('launcher closure rebinds its plugin before old-window cleanup and never moves it merely because another window opened', async () => {
  const f = pluginIpcFixture();
  await f.invoke('open-app', 'c1', 'first'); f.running.add('10:20');
  f.visible.set('11:21', 'c1');
  f.windowEvent({ type: 'window-added', conversationId: 'c1', pid: 11, windowId: 21, root: 10, title: 'Game' });
  assert.equal(f.calls.length, 0);
  f.windowEvent({ type: 'window-closed', conversationId: 'c1', pid: 10, windowId: 20 });
  assert.deepEqual(f.calls, [['rebind', 'c1', 10, 20, 11, 21, 'Game'], ['stop-window', 10, 20, 'window_closed']]);
  assert.equal(f.running.has('11:21'), true);
  assert.equal(f.host.windows.get('11:21'), 'c1');
});
