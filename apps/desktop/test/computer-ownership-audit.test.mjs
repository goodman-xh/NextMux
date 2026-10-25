import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const { ComputerAutomation, registerComputerAutomation } = require('../computer-automation.cjs');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const target = { pid: 10, windowId: 77 };
const request = (action, input = target, conversationId = 'a') => ({ id: crypto.randomUUID(), conversationId, action, input, expiresAt: Date.now() + 10000 });
function fixture(t, { client = {}, ...options } = {}) {
  const calls = [];
  const { click = async () => { calls.push('click'); }, ...clientMethods } = client;
  const engine = new ComputerAutomation({ platform: 'darwin', view: {
    grant() {}, pointer: async (_conversation, pid, windowId, input) => { await click({ pid, windowId, ...input }); return { ok: true }; },
    dispose: async () => {}
  }, sdkLoader: async () => ({ create: async () => ({
    listApps: async () => [{ name: 'Editor', bundle_id: 'test.editor', launch_path: '/Applications/Editor.app', pid: 10, running: true }],
    getApp: async selector => { calls.push(selector); return { name: 'Editor', getState: async () => ({}) }; },
    listWindows: async () => [{ window_id: 77, is_app_target: true, bounds: { width: 800, height: 600 } }],
    observeWindow: async () => ({ elements: [], text: 'ready', screenshot: { width: 800, height: 600 } }),
    click: async () => assert.fail('ownership tests must use the scoped background adapter'), close: async () => {}, ...clientMethods
  }) }), ...options });
  t.after(() => engine.dispose());
  return { engine, calls };
}

test('macOS ambiguous partial app names fail before launching either candidate', async t => {
  const { engine, calls } = fixture(t, { client: { listApps: async () => [
    { name: 'Editor One', bundle_id: 'test.one' }, { name: 'Editor Two', bundle_id: 'test.two' }
  ] } });
  assert.equal((await engine.openAppInTab('a', 1, 'Editor')).error, 'computer_app_ambiguous');
  assert.deepEqual(calls, []);
});

test('macOS explicit paths preserve app identity and pre-existing launch ownership', async t => {
  const { engine, calls } = fixture(t);
  const result = await engine.openAppInTab('a', 1, '/Applications/Editor.app');
  assert.equal(result.ok, true); assert.equal(result.launched, false);
  assert.equal(calls[0], '/Applications/Editor.app');
});

test('macOS explicit path selects the right process when bundles share a name and id', async t => {
  const selected = [];
  const { engine } = fixture(t, { client: {
    listApps: async () => [
      { name: 'Editor', bundle_id: 'test.editor', launch_path: '/Applications/Editor.app', pid: 10, running: true },
      { name: 'Editor', bundle_id: 'test.editor', launch_path: '/Volumes/Test/Editor.app', pid: 20, running: true }
    ], listWindows: async ({ pid }) => { selected.push(pid); return [{ window_id: 77, is_app_target: true, bounds: { width: 800, height: 600 } }]; }
  } });
  const result = await engine.openAppInTab('a', 1, '/Volumes/Test/Editor.app');
  assert.equal(result.ok, true); assert.equal(result.pid, 20); assert.deepEqual(selected, [20]);
});

test('macOS alias lookup retains cancellation and ambiguous outcomes instead of reporting a discovery miss', async t => {
  const { engine } = fixture(t);
  for (const code of ['cancelled', 'app_ambiguous', 'computer_driver_transport']) {
    const client = { getApp: async selector => { throw Object.assign(Error('private error'), { code: selector === 'Calculator' ? 'app_not_running' : code }); } };
    await assert.rejects(engine.macAppHandle(client, 'Calculator', new AbortController().signal), { code });
  }
});

test('forgetWindow invalidates old observations without disturbing another owner', async t => {
  const { engine, calls } = fixture(t);
  const observation = await engine.run(request('observeWindow'), 1);
  await engine.forgetWindow('b', 10, 77);
  assert.equal(engine.windows.get('10:77'), 'a');
  await engine.forgetWindow('a', 10, 77);
  const result = await engine.run(request('click', { ...target, snapshotId: observation.output.snapshotId, x: 1, y: 1 }), 1);
  assert.equal(result.error, 'computer_snapshot_stale'); assert.deepEqual(calls, []);
});

test('forgetWindow drains an in-flight write before another conversation can own the window', async t => {
  const started = deferred(), finish = deferred();
  t.after(() => finish.resolve());
  const { engine } = fixture(t, { client: { click: async () => { started.resolve(); await finish.promise; return {}; } } });
  const observation = await engine.run(request('observeWindow'), 1);
  const writing = engine.run(request('click', { ...target, snapshotId: observation.output.snapshotId, x: 1, y: 1 }), 1);
  await started.promise;
  const forgotten = engine.forgetWindow('a', 10, 77);
  const second = await engine.run(request('observeWindow', target, 'b'), 2);
  finish.resolve(); await writing; await forgotten;
  assert.equal(second.error, 'computer_window_owned');
  assert.equal((await engine.run(request('observeWindow', target, 'b'), 2)).ok, true);
});

test('forgetWindow cannot publish a late observation as a usable snapshot', async t => {
  const started = deferred(), finish = deferred();
  t.after(() => finish.resolve());
  const { engine } = fixture(t, { client: { observeWindow: async () => { started.resolve(); await finish.promise; return { elements: [] }; } } });
  const pending = engine.run(request('observeWindow'), 1); await started.promise;
  const forgotten = engine.forgetWindow('a', 10, 77); finish.resolve();
  assert.equal((await pending).ok, false); await forgotten;
  assert.equal(engine.sessions.get('a').observations.size, 0);
});

test('an old forget drain cannot remove the replacement generation\'s window claim', async t => {
  const started = deferred(), finish = deferred();
  t.after(() => finish.resolve());
  const { engine } = fixture(t, { client: { click: async () => { started.resolve(); await finish.promise; return {}; } } });
  const observation = await engine.run(request('observeWindow'), 1);
  const writing = engine.run(request('click', { ...target, snapshotId: observation.output.snapshotId, x: 1, y: 1 }), 1);
  await started.promise;
  const forgotten = engine.forgetWindow('a', 10, 77);
  engine.invalidateGeneration();
  assert.equal((await engine.run(request('observeWindow'), 1)).ok, true);
  const replacement = engine.sessions.get('a');
  finish.resolve(); await writing; await forgotten;
  assert.equal(engine.windows.get('10:77'), 'a');
  assert.equal(engine.sessions.get('a'), replacement);
  assert.equal(replacement.observations.size, 1);
});

test('macOS release aborts and drains an opening tab without recreating its claim', async t => {
  const started = deferred(), finish = deferred(); let closed = false, signal;
  t.after(() => finish.resolve());
  const { engine } = fixture(t, { client: {
    getApp: async () => ({ name: 'Editor', getState: async options => { signal = options.signal; started.resolve(); await finish.promise; return {}; } }),
    close: async () => { closed = true; }
  } });
  const opening = engine.openAppInTab('a', 1, 'Editor'); await started.promise;
  const releasing = engine.release('a', 1);
  await new Promise(resolve => setImmediate(resolve));
  const closedEarly = closed, cancelled = signal.aborted;
  finish.resolve(); const result = await opening; await releasing;
  assert.equal(cancelled, true); assert.equal(closedEarly, false);
  assert.equal(result.ok, false); assert.equal(engine.windows.size, 0);
});

function ipcFixture(t) {
  const { engine } = fixture(t);
  const module = require('../computer-window-view.cjs'), original = module.createComputerWindowView;
  const handlers = new Map(), calls = [];
  const view = Object.fromEntries(['arm', 'place', 'pointer', 'keys', 'snapshot', 'windowState', 'setUserInput', 'setSound', 'forget', 'openInTab']
    .map(name => [name, async (...args) => { calls.push([name, ...args]); return { ok: true }; }]));
  view.canView = () => true;
  view.hasWindows = () => calls.findLast(([name]) => ['openInTab', 'forget'].includes(name))?.[0] === 'openInTab';
  view.revokeCapture = (...args) => { calls.push(['revokeCapture', ...args]); };
  module.createComputerWindowView = () => view;
  try { registerComputerAutomation({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, automation: engine,
    desktopCapturer: {}, trustedMainFrame: () => true }); }
  finally { module.createComputerWindowView = original; }
  // Production has one window view for the engine and the IPC handlers. This engine brings its own pointer adapter, so it
  // also gets the registered view's capture: the snapshot channel goes through engine.captureView (this.view.snapshot).
  engine.view.snapshot = view.snapshot;
  const sender = id => Object.assign(new EventEmitter(), { id, dead: false, isDestroyed() { return this.dead; }, send() {} });
  const a = { sender: sender(1) }, b = { sender: sender(2) };
  return { engine, calls, view, a, b, handlers, invoke: (name, event, ...args) => handlers.get(`nextmux:computer:view:${name}`)(event, 'a', ...args) };
}

test('trusted workbenches cannot capture, control or forget another renderer\'s tab after driver release', async t => {
  const f = ipcFixture(t);
  assert.equal((await f.invoke('open-app', f.a, 'Editor')).ok, true);
  await f.engine.release('a', 1); f.calls.length = 0;
  for (const [method, args] of [
    ['start', [10, 77]], ['snapshot', [10, 77]], ['place', [10, 77, 'desktop']], ['state', [10, 77]],
    ['user-input', [10, 77, true]], ['sound', [10, 77, true]], ['forget', [10, 77]],
    ['pointer', [{ ...target, kind: 'click', x: 0.5, y: 0.5 }]], ['keys', [{ ...target, key: 'a' }]], ['open-app', ['Editor']]
  ]) {
    const result = await f.invoke(method, f.b, ...args);
    assert.ok(result === false || result.ok === false, method);
  }
  assert.deepEqual(f.calls, []);
  assert.equal((await f.invoke('snapshot', f.a, 10, 77)).ok, true);
});

test('renderer destroyed after only open-app releases its session and view', async t => {
  const f = ipcFixture(t);
  assert.equal((await f.invoke('open-app', f.a, 'Editor')).ok, true);
  f.a.sender.dead = true; f.a.sender.emit('destroyed');
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.engine.sessions.size, 0); assert.equal(f.engine.windows.size, 0);
  assert.ok(f.calls.some(([name]) => name === 'forget'));
});

test('plain computer actions cannot steal a released driver session from a still-open tab owner', async t => {
  const f = ipcFixture(t);
  await f.invoke('open-app', f.a, 'Editor'); await f.engine.release('a', 1);
  const result = await f.handlers.get('nextmux:computer:action')(f.b, request('listApps', {}));
  assert.equal(result.error, 'computer_untrusted_sender');
  assert.equal(f.engine.sessions.size, 0);
  assert.equal((await f.invoke('snapshot', f.a, 10, 77)).ok, true);
});

test('partial forget targets never clear all of a conversation\'s windows', async t => {
  const f = ipcFixture(t);
  await f.invoke('open-app', f.a, 'Editor'); f.calls.length = 0;
  for (const args of [[10], [undefined, 77], [10, NaN], [null, 77]]) {
    assert.equal(await f.invoke('forget', f.a, ...args), false);
    assert.equal(await f.engine.forgetWindow('a', ...args), false);
  }
  assert.equal(f.engine.windows.get('10:77'), 'a'); assert.deepEqual(f.calls, []);
});

test('forget IPC revokes capture immediately, drains native work, then cleans up the window and its last renderer owner', async t => {
  const f = ipcFixture(t), finish = deferred();
  await f.invoke('open-app', f.a, 'Editor');
  f.engine.forgetWindow = () => finish.promise; f.calls.length = 0;
  const closing = f.invoke('forget', f.a, 10, 77);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls.map(([name]) => name), ['revokeCapture']);
  finish.resolve(); assert.equal(await closing, true);
  assert.deepEqual(f.calls.map(([name]) => name), ['revokeCapture', 'forget']);
  await f.engine.release('a', 1);
  assert.equal((await f.invoke('open-app', f.b, 'Editor')).ok, true);
});

test('forgetting one window retains the renderer owner while another tab remains live', async t => {
  const f = ipcFixture(t);
  await f.invoke('open-app', f.a, 'Editor');
  f.view.hasWindows = () => true;
  assert.equal(await f.invoke('forget', f.a, 10, 77), true);
  await f.engine.release('a', 1);
  assert.equal((await f.invoke('open-app', f.b, 'Editor')).ok, false);
  assert.equal((await f.invoke('snapshot', f.a, 10, 78)).ok, true);
});
