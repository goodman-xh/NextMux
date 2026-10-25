import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ComputerAutomation, registerComputerAutomation } = require('../computer-automation.cjs');

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

let seq = 0;
const makeRequest = (conversationId, action, input = {}) => ({
  id: `req-${++seq}`,
  conversationId,
  runId: 'run-1',
  action,
  input,
  expiresAt: Date.now() + 10_000
});

test('user Esc trips per-conversation circuit breaker across computer.* and tabs.*, while allowing user mirror input until clearUserEsc', async t => {
  const clickGate = deferred();
  const tabGate = deferred();
  const engine = new ComputerAutomation({
    platform: 'darwin',
    view: {
      grant: () => {},
      dispose: async () => {},
      pointer: async (_cid, _pid, _wid, payload) => {
        if (payload.x === 0.25) await clickGate.promise;
        else if (payload.source !== 'user') await tabGate.promise;
        return { ok: true, effect: 'dispatched' };
      },
      keys: async () => ({ ok: true, effect: 'dispatched' }),
      snapshot: async () => ({ ok: true, dataUrl: 'data:image/jpeg;base64,AAAA', width: 800, height: 600 })
    },
    sdkLoader: async () => ({
      create: async () => ({
        observeWindow: async () => ({
          window: { pid: 7, windowId: 9, title: 'Demo', bounds: { x: 0, y: 0, width: 800, height: 600 } },
          screenshot: { width: 800, height: 600, images: [] },
          elements: []
        }),
        listApps: async () => [{ pid: 7, name: 'Demo' }],
        listWindows: async () => [{ pid: 7, windowId: 9, title: 'Demo', bounds: { x: 0, y: 0, width: 800, height: 600 } }],
        close: async () => {}
      })
    })
  });
  t.after(() => engine.dispose());

  const observed = await engine.run(makeRequest('conv-a', 'observeWindow', { pid: 7, windowId: 9 }), 1);
  assert.equal(observed.ok, true);

  const inFlightComputer = engine.run(makeRequest('conv-a', 'click', {
    pid: 7, windowId: 9, snapshotId: observed.output.snapshotId, x: 200, y: 300
  }), 1);
  const inFlightTab = engine.userPointer('conv-b', 2, {
    pid: 7, windowId: 10, kind: 'click', x: 0.5, y: 0.5, source: 'agent'
  });
  engine.rememberActivity('conv-b', 2);

  await new Promise(resolve => setImmediate(resolve));
  const stopped = engine.stopAllForUser();
  clickGate.resolve();
  tabGate.resolve();

  assert.deepEqual(
    stopped.map(item => [item.conversationId, item.owner]).sort(),
    [['conv-a', 1], ['conv-b', 2]]
  );

  const computerRes = await inFlightComputer;
  assert.equal(computerRes.ok, false);
  assert.equal(computerRes.error, 'interrupted_by_user_esc');
  assert.equal(computerRes.userInterrupted, true);

  const tabRes = await inFlightTab;
  assert.equal(tabRes.ok, false);
  assert.equal(tabRes.error, 'interrupted_by_user_esc');
  assert.equal(tabRes.userInterrupted, true);

  // Subsequent computer.*, tabs.* (agent), and openAppInTab calls are refused immediately.
  const nextComputer = await engine.run(makeRequest('conv-a', 'listApps', {}), 1);
  assert.equal(nextComputer.ok, false);
  assert.equal(nextComputer.error, 'interrupted_by_user_esc');
  assert.equal(nextComputer.userInterrupted, true);

  const nextTabPointer = await engine.userPointer('conv-a', 1, { pid: 7, windowId: 9, kind: 'click', x: 0.5, y: 0.5, source: 'agent' });
  assert.equal(nextTabPointer.ok, false);
  assert.equal(nextTabPointer.error, 'interrupted_by_user_esc');
  assert.equal(nextTabPointer.userInterrupted, true);

  const nextTabKeys = await engine.userKeys('conv-a', 1, { pid: 7, windowId: 9, text: 'hi', source: 'agent' });
  assert.equal(nextTabKeys.ok, false);
  assert.equal(nextTabKeys.error, 'interrupted_by_user_esc');
  assert.equal(nextTabKeys.userInterrupted, true);

  const nextSnapshot = await engine.captureView('conv-a', 1, 7, 9, 800, { source: 'agent' });
  assert.equal(nextSnapshot.ok, false);
  assert.equal(nextSnapshot.error, 'interrupted_by_user_esc');
  assert.equal(nextSnapshot.userInterrupted, true);

  const nextOpenApp = await engine.openAppInTab('conv-a', 1, 'Demo');
  assert.equal(nextOpenApp.ok, false);
  assert.equal(nextOpenApp.error, 'interrupted_by_user_esc');
  assert.equal(nextOpenApp.userInterrupted, true);

  // User's own interactive mirror mouse/keyboard in the tab still works after Esc.
  const userPointerRes = await engine.userPointer('conv-a', 1, { pid: 7, windowId: 9, kind: 'click', x: 0.5, y: 0.5, source: 'user' });
  assert.equal(userPointerRes.ok, true);
  const userKeysRes = await engine.userKeys('conv-a', 1, { pid: 7, windowId: 9, text: 'user-input', source: 'user' });
  assert.equal(userKeysRes.ok, true);

  // release() and renew() must not clear the circuit breaker.
  await engine.release('conv-a', 1);
  engine.renew(['conv-a'], 1);
  assert.equal(engine.userEscInterrupted.has('conv-a'), true);

  // Explicit clearUserEsc re-enables automation for that conversation only.
  assert.equal(engine.clearUserEsc('conv-a'), true);
  assert.equal(engine.userEscInterrupted.has('conv-a'), false);
  assert.equal(engine.userEscInterrupted.has('conv-b'), true);

  const resumed = await engine.run(makeRequest('conv-a', 'listApps', {}), 1);
  assert.equal(resumed.ok, true);
});

test('synthetic keys on darwin and win32 increment sendingKeys so Esc during agent key dispatch does not self-interrupt', async t => {
  const stopKeyDuring = [];
  for (const platform of ['darwin', 'win32']) {
    const engine = new ComputerAutomation({
      platform,
      windowsInput: {
        post: async () => {
          stopKeyDuring.push([platform, 'win-post', engine.userStopKey()]);
        },
        execute: async () => {},
        dispose: async () => {}
      },
      view: {
        grant: () => {},
        dispose: async () => {},
        pointer: async () => ({ ok: true, effect: 'dispatched' }),
        keys: async () => {
          stopKeyDuring.push([platform, 'view-keys', engine.userStopKey()]);
          return { ok: true, effect: 'dispatched' };
        }
      },
      sdkLoader: async () => ({
        create: async () => ({
          observeWindow: async () => ({
            window: { pid: 7, windowId: 9, title: 'Demo', bounds: { x: 0, y: 0, width: 800, height: 600 } },
            screenshot: { width: 800, height: 600, images: [] },
            elements: []
          }),
          pressKey: async () => {
            stopKeyDuring.push([platform, 'sdk-pressKey', engine.userStopKey()]);
            return { sent: true };
          },
          close: async () => {}
        })
      })
    });
    t.after(() => engine.dispose());

    const observed = await engine.run(makeRequest(`c-${platform}`, 'observeWindow', { pid: 7, windowId: 9 }), 1);
    assert.equal(observed.ok, true);
    assert.equal((await engine.run(makeRequest(`c-${platform}`, 'pressKey', {
      pid: 7, windowId: 9, snapshotId: observed.output.snapshotId, key: 'Escape'
    }), 1)).ok, true);
    assert.equal(engine.userStopKey(Date.now() + 1000), true, 'sendingKeys balanced after executeSession');

    assert.equal((await engine.userKeys(`c-${platform}`, 1, {
      pid: 7, windowId: 9, key: 'Escape', source: 'agent'
    })).ok, true);
    assert.equal(engine.userStopKey(Date.now() + 1000), true, 'sendingKeys balanced after agent userKeys');

    // User mirror keys must NOT suppress Escape stop detection.
    stopKeyDuring.length = 0;
    assert.equal((await engine.userKeys(`c-${platform}`, 1, {
      pid: 7, windowId: 9, key: 'Escape', source: 'user'
    })).ok, true);
    assert.equal(stopKeyDuring[0][2], true, `user mirror keys on ${platform} do not mask Escape`);
  }
});

test('registerComputerAutomation holds Escape during tabs.* activity, emits user-stop with escape_key reason, and exposes clear-user-esc IPC', async t => {
  const viewModule = require('../computer-window-view.cjs');
  const originalCreateView = viewModule.createComputerWindowView;
  const handlers = new Map();
  const sentEvents = [];
  let registeredEscape = null;

  const fakeView = {
    canView: () => true,
    userInput: () => false,
    grant: () => {},
    dispose: async () => {},
    pointer: async () => ({ ok: true, effect: 'dispatched' }),
    keys: async () => ({ ok: true, effect: 'dispatched' }),
    snapshot: async () => ({ ok: true, dataUrl: 'data:image/jpeg;base64,AAAA', width: 400, height: 300 }),
    openInTab: async () => ({ ok: true, mode: 'parked' }),
    forget: async () => true,
    hasWindows: () => false
  };
  viewModule.createComputerWindowView = () => fakeView;
  t.after(() => { viewModule.createComputerWindowView = originalCreateView; });

  const sender = Object.assign(new EventEmitter(), {
    id: 42,
    isDestroyed: () => false,
    send: (channel, payload) => sentEvents.push([channel, payload])
  });

  const engine = registerComputerAutomation({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    trustedMainFrame: () => true,
    desktopCapturer: {},
    webContents: { fromId: id => (id === 42 ? sender : undefined), getAllWebContents: () => [sender] },
    globalShortcut: {
      register: (key, fn) => { if (key === 'Escape') { registeredEscape = fn; return true; } return false; },
      unregister: key => { if (key === 'Escape') registeredEscape = null; }
    }
  });
  t.after(() => engine.dispose());

  // User mirror pointer does not arm Escape shortcut.
  const userClick = await handlers.get('nextmux:computer:view:pointer')({ sender }, 'tab-only-conv', {
    pid: 10, windowId: 20, kind: 'click', x: 0.5, y: 0.5, source: 'user'
  });
  assert.equal(userClick.ok, true);
  assert.equal(registeredEscape, null, 'user mirror input does not arm Escape');

  // Agent tab pointer arms Escape shortcut even without a computer.* session.
  const agentClick = await handlers.get('nextmux:computer:view:pointer')({ sender }, 'tab-only-conv', {
    pid: 10, windowId: 20, kind: 'click', x: 0.5, y: 0.5, source: 'agent'
  });
  assert.equal(agentClick.ok, true);
  assert.equal(typeof registeredEscape, 'function', 'agent tab input arms Escape');

  // User presses Escape.
  registeredEscape();
  assert.equal(registeredEscape, null, 'Escape shortcut unregistered immediately on stop');
  assert.deepEqual(sentEvents, [[
    'nextmux:computer:tab-event',
    { type: 'user-stop', reason: 'escape_key', conversationId: 'tab-only-conv', pid: 0, windowId: 0 }
  ]]);

  // Subsequent agent tab pointer/keys/snapshot are blocked with interrupted_by_user_esc.
  const blockedPointer = await handlers.get('nextmux:computer:view:pointer')({ sender }, 'tab-only-conv', {
    pid: 10, windowId: 20, kind: 'click', x: 0.5, y: 0.5, source: 'agent'
  });
  assert.equal(blockedPointer.ok, false);
  assert.equal(blockedPointer.error, 'interrupted_by_user_esc');
  assert.equal(blockedPointer.userInterrupted, true);

  const blockedSnapshot = await handlers.get('nextmux:computer:view:snapshot')({ sender }, 'tab-only-conv', 10, 20, 800, { source: 'agent' });
  assert.equal(blockedSnapshot.ok, false);
  assert.equal(blockedSnapshot.error, 'interrupted_by_user_esc');
  assert.equal(blockedSnapshot.userInterrupted, true);

  // User mirror pointer still works.
  const userAfterEsc = await handlers.get('nextmux:computer:view:pointer')({ sender }, 'tab-only-conv', {
    pid: 10, windowId: 20, kind: 'click', x: 0.5, y: 0.5, source: 'user'
  });
  assert.equal(userAfterEsc.ok, true);

  // Clearing via IPC re-enables agent tab actions.
  const cleared = await handlers.get('nextmux:computer:clear-user-esc')({ sender }, 'tab-only-conv');
  assert.equal(cleared, true);
  const resumedPointer = await handlers.get('nextmux:computer:view:pointer')({ sender }, 'tab-only-conv', {
    pid: 10, windowId: 20, kind: 'click', x: 0.5, y: 0.5, source: 'agent'
  });
  assert.equal(resumedPointer.ok, true);
});

test('closing a window mid-automation aborts in-flight actions and returns computer_window_closed on subsequent actions', async t => {
  const gate = deferred();
  const engine = new ComputerAutomation({
    platform: 'darwin',
    view: {
      grant: () => {},
      dispose: async () => {},
      pointer: async () => {
        await gate.promise;
        return { ok: true, effect: 'dispatched' };
      },
      keys: async () => ({ ok: true, effect: 'dispatched' })
    },
    sdkLoader: async () => ({
      create: async () => ({
        observeWindow: async () => ({
          window: { pid: 7, windowId: 9, title: 'Demo', bounds: { x: 0, y: 0, width: 800, height: 600 } },
          screenshot: { width: 800, height: 600, images: [] },
          elements: []
        }),
        close: async () => {}
      })
    })
  });
  t.after(() => engine.dispose());

  const observed = await engine.run(makeRequest('conv-close', 'observeWindow', { pid: 7, windowId: 9 }), 1);
  assert.equal(observed.ok, true);

  const inFlight = engine.run(makeRequest('conv-close', 'click', {
    pid: 7, windowId: 9, snapshotId: observed.output.snapshotId, x: 100, y: 100
  }), 1);
  await new Promise(resolve => setImmediate(resolve));

  const forgetting = engine.forgetWindow('conv-close', 7, 9, 'computer_window_closed');
  gate.resolve();
  await forgetting;

  const aborted = await inFlight;
  assert.equal(aborted.ok, false);
  assert.equal(aborted.error, 'computer_window_closed');

  // Subsequent click with the old snapshotId reports computer_window_closed rather than computer_snapshot_stale.
  const afterCloseClick = await engine.run(makeRequest('conv-close', 'click', {
    pid: 7, windowId: 9, snapshotId: observed.output.snapshotId, x: 100, y: 100
  }), 1);
  assert.equal(afterCloseClick.ok, false);
  assert.equal(afterCloseClick.error, 'computer_window_closed');

  const afterCloseObserve = await engine.run(makeRequest('conv-close', 'observeWindow', { pid: 7, windowId: 9 }), 1);
  assert.equal(afterCloseObserve.ok, false);
  assert.equal(afterCloseObserve.error, 'computer_window_closed');

  const afterCloseTabPointer = await engine.userPointer('conv-close', 1, {
    pid: 7, windowId: 9, kind: 'click', x: 0.5, y: 0.5, source: 'agent'
  });
  assert.equal(afterCloseTabPointer.ok, false);
  assert.equal(afterCloseTabPointer.error, 'computer_window_closed');
});

test('after Esc only the AI is refused: the user, the live picture and plugin runs keep their window; idle conversations keep control', async t => {
  const viewModule = require('../computer-window-view.cjs');
  const originalCreateView = viewModule.createComputerWindowView;
  const handlers = new Map();
  let registeredEscape = null;
  viewModule.createComputerWindowView = () => ({
    canView: () => true, userInput: () => false, grant: () => {}, dispose: async () => {},
    pointer: async () => ({ ok: true, effect: 'dispatched' }), keys: async () => ({ ok: true, effect: 'dispatched' }),
    snapshot: async () => ({ ok: true, dataUrl: 'data:image/jpeg;base64,AAAA', width: 400, height: 300 }),
    openInTab: async () => ({ ok: true, mode: 'parked' }), forget: async () => true, hasWindows: () => false
  });
  t.after(() => { viewModule.createComputerWindowView = originalCreateView; });
  const sender = Object.assign(new EventEmitter(), { id: 42, isDestroyed: () => false, send: () => {} });
  const engine = registerComputerAutomation({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    trustedMainFrame: () => true, desktopCapturer: {},
    webContents: { fromId: id => (id === 42 ? sender : undefined), getAllWebContents: () => [sender] },
    globalShortcut: {
      register: (key, fn) => { if (key === 'Escape') { registeredEscape = fn; return true; } return false; },
      unregister: key => { if (key === 'Escape') registeredEscape = null; }
    }
  });
  t.after(() => engine.dispose());
  const pointer = (conversationId, extra) => handlers.get('nextmux:computer:view:pointer')({ sender }, conversationId,
    { pid: 10, windowId: 20, kind: 'click', x: 0.5, y: 0.5, ...extra });
  const keys = (conversationId, extra) => handlers.get('nextmux:computer:view:keys')({ sender }, conversationId,
    { pid: 10, windowId: 20, key: 'a', ...extra });

  // A conversation that used the desktop a minute ago is not the one Esc stops.
  engine.rememberActivity('idle-conv', 42);
  engine.activityAt.set('idle-conv', Date.now() - 60_000);
  assert.equal((await pointer('esc-conv', { source: 'agent' })).ok, true);
  assert.doesNotThrow(() => registeredEscape(), 'Esc never throws, whatever the overlay holds');
  assert.equal(engine.userEscInterrupted.has('esc-conv'), true);
  assert.equal(engine.userEscInterrupted.has('idle-conv'), false);

  // The tab's own mirror (no source, no restore) is the user and is never refused.
  assert.equal((await pointer('esc-conv', {})).ok, true);
  assert.equal((await keys('esc-conv', {})).ok, true);
  // An AI call in the older shape (restore without a source) is refused like source 'agent'.
  assert.equal((await keys('esc-conv', { restore: true })).error, 'interrupted_by_user_esc');
  assert.equal((await keys('esc-conv', { source: 'agent' })).userInterrupted, true);
  // The live picture keeps refreshing; only the AI's tabs.screenshot is refused.
  assert.equal((await handlers.get('nextmux:computer:view:snapshot')({ sender }, 'esc-conv', 10, 20, 800)).ok, true);
  assert.equal((await handlers.get('nextmux:computer:view:snapshot')({ sender }, 'esc-conv', 10, 20, 800, { source: 'agent' })).error, 'interrupted_by_user_esc');
  // A plugin run the user resumes is paused by Esc through its takeover path, not refused by the AI's block.
  const plugin = await engine.userKeys('esc-conv', 42, { pid: 10, windowId: 20, key: 'a', source: 'plugin' });
  assert.notEqual(plugin.error, 'interrupted_by_user_esc');
});
