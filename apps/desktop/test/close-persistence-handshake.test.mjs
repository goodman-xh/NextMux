import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const extensionRequire = createRequire(new URL('../../../packages/theia-nextmux-extension/package.json', import.meta.url));
const ts = extensionRequire('typescript');
const theiaSource = readFileSync(extensionRequire.resolve('@theia/core/lib/electron-main/theia-electron-window'), 'utf8');
const subclassSource = readFileSync(new URL('../../../packages/theia-nextmux-extension/src/electron-main/nextmux-electron-main-module.ts', import.meta.url), 'utf8');
function classMethods(source, name, names) {
  const file = ts.createSourceFile('actual.ts', source, ts.ScriptTarget.Latest, true);
  const node = file.statements.find(value => ts.isClassDeclaration(value) && value.name?.text === name)
    || file.statements.flatMap(value => ts.isVariableStatement(value) ? value.declarationList.declarations : [])
      .find(value => value.name.getText(file) === name)?.initializer;
  assert.ok(node);
  return names.map(name => { const member = node.members.find(value => value.name?.getText(file) === name); assert.ok(member); return member.getText(file); }).join('\n');
}

const source = readFileSync(new URL('../updater.cjs', import.meta.url), 'utf8');

// Run the actual main-process module with fake Electron and a deterministic clock.
// No real windows, updater, filesystem writes, network, or user profile are opened.
function fixture() {
  const app = new EventEmitter(); const handlers = new Map(); const windows = [];
  const timers = new Map(); const microtasks = []; let sequence = 0; let now = 0;
  Object.assign(app, { setName() {}, setAppUserModelId() {}, getVersion: () => '0.1.0-test', isPackaged: false,
    whenReady: () => new Promise(() => {}) });
  const autoUpdater = new EventEmitter(); autoUpdater.setFeedURL = () => {};
  class FakeWindow extends EventEmitter {
    constructor() {
      super(); this.destroyed = false; this.visible = true; this.closeCalls = 0; this.allowedCloses = 0; this.messages = [];
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: {}, destroyed: false, getURL: () => 'file:///fixture/index.html',
        isDestroyed() { return this.destroyed; },
        send: (channel, ...args) => { this.messages.push({ channel, args }); }
      });
      windows.push(this); app.emit('browser-window-created', {}, this);
    }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    show() { this.visible = true; }
    hide() { this.visible = false; }
    close() {
      this.closeCalls++;
      const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      this.emit('close', event);
      if (!event.defaultPrevented) this.allowedCloses++;
      return event;
    }
    destroyFixture() { this.destroyed = true; this.visible = false; this.webContents.destroyed = true; this.webContents.emit('destroyed'); this.emit('closed'); }
    offer() { this.close(); return this.messages.filter(value => value.channel === 'nextmux:prepare-close').at(-1)?.args[0]; }
    cancelled() { return this.messages.filter(value => value.channel === 'nextmux:prepare-close:cancelled'); }
  }
  FakeWindow.fromWebContents = contents => windows.find(window => window.webContents === contents);
  FakeWindow.getAllWindows = () => windows.filter(window => !window.destroyed);
  const electron = { app, BrowserWindow: FakeWindow, autoUpdater: new EventEmitter(), ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    Notification: class { constructor() { throw new Error('Native notification/dialog not permitted in this fixture'); } },
    session: {}, shell: {}, systemPreferences: {} };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, URL, process: { platform: 'darwin', arch: 'arm64', env: {} },
    require(name) {
      if (name === 'electron') return electron;
      if (name === 'electron-updater') return { autoUpdater };
      if (name === './native-dictation.cjs') return { registerNativeDictation() {} }; // Native speech has its own actual-handler suite.
      if (name === 'node:crypto') return { createHash, randomUUID: () => `fixture-close-${++sequence}` };
      if (name === 'node:fs') {
        const unexpectedFileAccess = () => assert.fail('Unpackaged close fixture must not access update target files');
        return { mkdirSync: unexpectedFileAccess, readFileSync: unexpectedFileAccess, renameSync: unexpectedFileAccess,
          unlinkSync: unexpectedFileAccess, writeFileSync: unexpectedFileAccess };
      }
      if (name === 'node:path') return path;
      if (name === 'node:os') return { release: () => 'fixture' };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    setTimeout(callback, delay) { const timer = { callback, due: now + delay, unref() {} }; timers.set(timer, timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
    setInterval() { throw new Error('No real updater lifecycle in fixture'); },
    queueMicrotask: callback => microtasks.push(callback),
    setImmediate() { throw new Error('No update installation in fixture'); }
  }, { filename: 'actual-updater.cjs' });
  const event = window => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  const invoke = (name, window, ...args) => handlers.get(`nextmux:prepare-close:${name}`)(event(window), ...args);
  function advance(milliseconds) {
    now += milliseconds;
    for (const timer of [...timers.values()]) if (timer.due <= now) { timers.delete(timer); timer.callback(); }
  }
  function flushMicrotasks() { while (microtasks.length) microtasks.shift()(); }
  return { Window: FakeWindow, event, invoke, handlers, timers, advance, flushMicrotasks };
}

function coordinatedFixture() {
  const f = fixture(), window = new f.Window(), calls = { checks: 0, hide: 0, about: 0, closed: 0 };
  window.hide = () => { calls.hide++; window.visible = false; };
  const baseMethods = classMethods(theiaSource, 'TheiaElectronWindow', ['close', 'doCloseWindow', 'handleStopRequest']);
  const childMethods = classMethods(subclassSource, 'NextMuxElectronWindow', ['coordinator', 'attachCloseListeners', 'closeForQuit', 'handleStopRequest', 'prepareThenStop']);
  const Class = Function('createDisposableListener', 'frontend_application_state_1', 'uri_1', 'file_uri_1', 'electron_api_main_1', 'StopReason',
    'conversationCloseKey', 'conversationQuitCancelledKey', 'conversationQuitRequestKey',
    ts.transpile(`const coordinatorKey = Symbol.for('nextmux.desktop.close-coordinator.v1');
      class TheiaElectronWindow { ${baseMethods} }
      class NextMuxElectronWindow extends TheiaElectronWindow { ${childMethods} }
      return NextMuxElectronWindow;`, { target: ts.ScriptTarget.ES2022 }))(
    (target, event, listener) => target.on(event, listener), { StopReason: { Close: 0 } },
    { URI: class { constructor(value) { this.value = value; } toString() { return this.value; } } },
    { FileUri: { create: value => value } }, { TheiaRendererAPI: { sendAboutToClose: async () => { calls.about++; } } },
    { Close: 0 }, Symbol.for('nextmux.conversation-window.close'), Symbol.for('nextmux.conversation-window.quit-cancelled'),
    Symbol.for('nextmux.conversation-window.quit-request'));
  const wrapper = Object.assign(new Class(), { window, _window: window, applicationState: 'ready', closeIsConfirmed: false,
    globals: { THEIA_FRONTEND_HTML_PATH: 'file:///fixture/index.html' },
    onDidCloseEmitter: { fire: () => { calls.closed++; } }, dispose() {},
    checkSafeToStop: async () => { calls.checks++; return true; } });
  wrapper.attachCloseListeners();
  const quitRequestKey = Symbol.for('nextmux.conversation-window.quit-request');
  return { ...f, window, wrapper, calls,
    token: () => window.messages.filter(value => value.channel === 'nextmux:prepare-close').at(-1)?.args[0],
    quit: () => window[quitRequestKey]() };
}

async function emitAfterNativeClose(f, expected = 1) {
  for (let attempt = 0; attempt < 8 && f.window.allowedCloses < expected; attempt += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(f.window.allowedCloses, expected, 'the test must observe Electron allowing the final close before closed');
  f.window.emit('closed');
}

test('coordinated failed save never starts Theia cleanup, hides the window or issues a second offer', async () => {
  const f = coordinatedFixture(); f.window.close(); const token = f.token(), pending = f.wrapper.stopRequest;
  f.window.close(); assert.equal(f.wrapper.stopRequest, pending);
  f.invoke('begin', f.window, token); f.invoke('complete', f.window, token, 'failed');
  assert.equal(await pending, false); await Promise.resolve();
  assert.equal(f.window.allowedCloses, 0); assert.equal(f.window.messages.filter(value => value.channel === 'nextmux:prepare-close').length, 1);
  assert.deepEqual(f.calls, { checks: 0, hide: 0, about: 0, closed: 0 });
});

test('coordinated saved receipt enters actual Theia checks once, then its normal final close without another offer', async () => {
  const f = coordinatedFixture(); f.window.close(); const token = f.token(), pending = f.wrapper.stopRequest;
  f.invoke('begin', f.window, token); assert.equal(f.invoke('complete', f.window, token, 'saved'), true);
  assert.equal(f.window.closeCalls, 1, 'IPC receipt must not close in parallel');
  assert.equal(await pending, true);
  assert.equal(f.window.allowedCloses, 1); assert.equal(f.window.closeCalls, 2);
  assert.equal(f.window.messages.filter(value => value.channel === 'nextmux:prepare-close').length, 1);
  assert.deepEqual(f.calls, { checks: 1, hide: 1, about: 1, closed: 0 });
});

test('Theia veto cancels saved receipt and the next user close needs a fresh save', async () => {
  const f = coordinatedFixture(); f.wrapper.checkSafeToStop = async () => false;
  f.window.close(); const first = f.token(), pending = f.wrapper.stopRequest;
  f.invoke('begin', f.window, first); f.invoke('complete', f.window, first, 'saved');
  assert.equal(await pending, false); assert.equal(f.calls.hide, 0);
  assert.equal(f.window.cancelled().at(-1).args[0], first);
  f.window.close(); const next = f.token(); assert.notEqual(next, first);
  assert.equal(f.invoke('complete', f.window, first, 'saved'), false);
  f.advance(5000); assert.equal(await f.wrapper.stopRequest, false); assert.equal(f.calls.hide, 0);
});

test('navigation during Theia checks invalidates the old approval before hide or teardown', async () => {
  const f = coordinatedFixture(); let finish;
  f.wrapper.checkSafeToStop = () => new Promise(resolve => { finish = resolve; });
  f.window.close(); const token = f.token(), pending = f.wrapper.stopRequest;
  f.invoke('begin', f.window, token); f.invoke('complete', f.window, token, 'saved');
  await new Promise(resolve => setImmediate(resolve));
  f.window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  finish(true); assert.equal(await pending, false);
  assert.equal(f.calls.hide, 0); assert.equal(f.calls.about, 0); assert.equal(f.window.allowedCloses, 0);
});

test('coordinated silent renderer times out, keeps the window and rejects late saved receipts', async () => {
  const f = coordinatedFixture(); f.wrapper.applicationState = 'init';
  f.window.close(); const token = f.token(), pending = f.wrapper.stopRequest;
  f.advance(5000); assert.equal(await pending, false);
  assert.equal(f.invoke('begin', f.window, token), false); assert.equal(f.invoke('complete', f.window, token, 'saved'), false);
  assert.equal(f.window.allowedCloses, 0); assert.equal(f.calls.hide, 0); assert.equal(f.calls.checks, 0);
});

test('quit request stays pending after saved receipt until Electron emits the real closed event', async () => {
  const f = coordinatedFixture();
  const closing = f.quit(); const token = f.token();
  f.invoke('begin', f.window, token); assert.equal(f.invoke('complete', f.window, token, 'saved'), true);
  let settled = false; closing.then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'a saved receipt and successful Theia callback do not prove native destruction');
  assert.equal(f.window.allowedCloses, 1); assert.equal(f.calls.hide, 1); assert.equal(f.calls.closed, 0);
  f.window.emit('closed');
  assert.equal(await closing, true); assert.equal(f.calls.closed, 1);
});

test('quit cleanup does not access BrowserWindow.webContents after native destruction', async () => {
  const f = coordinatedFixture();
  const closing = f.quit(), token = f.token();
  f.invoke('begin', f.window, token); f.invoke('complete', f.window, token, 'saved');
  for (let attempt = 0; attempt < 8 && f.window.allowedCloses < 1; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.window.allowedCloses, 1);
  Object.defineProperty(f.window, 'webContents', { get() { throw new Error('Object has been destroyed'); } });
  f.window.destroyed = true;
  assert.doesNotThrow(() => f.window.emit('closed'));
  assert.equal(await closing, true);
});

test('repeated native close while quit preparation is pending shares the same promise and does not veto it', async () => {
  const f = coordinatedFixture();
  const closing = f.quit(); const token = f.token(); const pending = f.wrapper.stopRequest;
  assert.equal(f.quit(), closing, 'duplicate quit requests share the wrapper quit Promise');
  f.window.close();
  assert.equal(f.wrapper.stopRequest, pending);
  f.invoke('begin', f.window, token); assert.equal(f.invoke('complete', f.window, token, 'saved'), true);
  await emitAfterNativeClose(f); assert.equal(await closing, true);
});

test('quit request retries after a Theia veto with a fresh saved receipt', async () => {
  const f = coordinatedFixture(); f.wrapper.checkSafeToStop = async () => false;
  const firstOperation = f.quit(), first = f.token();
  f.invoke('begin', f.window, first); f.invoke('complete', f.window, first, 'saved');
  assert.equal(await firstOperation, false); assert.equal(f.window.isVisible(), true);
  assert.deepEqual(f.window.cancelled().at(-1).args, [first, 'failed']);
  f.wrapper.checkSafeToStop = async () => true;
  const retry = f.quit(), next = f.token(); assert.notEqual(next, first);
  f.invoke('begin', f.window, next); f.invoke('complete', f.window, next, 'saved');
  await emitAfterNativeClose(f); assert.equal(await retry, true);
});

test('quit request timeout preserves the window and permits a fresh attempt', async () => {
  const f = coordinatedFixture();
  const firstOperation = f.quit(), first = f.token();
  f.advance(5000); assert.equal(await firstOperation, false);
  assert.equal(f.window.isVisible(), true); assert.deepEqual(f.window.cancelled().at(-1).args, [first, 'timeout']);
  const retry = f.quit(), next = f.token(); assert.notEqual(next, first);
  f.invoke('begin', f.window, next); f.invoke('complete', f.window, next, 'saved');
  await emitAfterNativeClose(f); assert.equal(await retry, true);
});

test('final native close veto cancels the consumed receipt, restores visibility and allows retry', async () => {
  const f = coordinatedFixture();
  const veto = event => event.preventDefault(); f.window.on('close', veto);
  const firstOperation = f.quit(), first = f.token();
  f.invoke('begin', f.window, first); f.invoke('complete', f.window, first, 'saved');
  assert.equal(await firstOperation, false); assert.equal(f.window.isVisible(), true);
  assert.deepEqual(f.window.cancelled().at(-1).args, [first, 'failed']);
  f.window.off('close', veto);
  const retry = f.quit(), next = f.token(); assert.notEqual(next, first);
  f.invoke('begin', f.window, next); f.invoke('complete', f.window, next, 'saved');
  await emitAfterNativeClose(f); assert.equal(await retry, true);
});

test('success requires begin and accepts only a single current saved receipt', () => {
  const f = fixture(), window = new f.Window(); const token = window.offer();
  assert.equal(window.allowedCloses, 0); assert.equal(f.timers.size, 1);
  assert.equal(f.invoke('complete', window, token, 'saved'), false);
  assert.equal(f.invoke('begin', window, token), true);
  assert.equal(f.invoke('begin', window, token), true, 'Duplicate begin is harmless and does not reset the deadline');
  assert.equal(f.invoke('complete', window, token), false, 'Old renderer contract cannot silently approve');
  assert.equal(f.invoke('complete', window, token, 'saved'), true);
  assert.equal(window.allowedCloses, 1); assert.equal(f.timers.size, 0);
  assert.equal(f.invoke('complete', window, token, 'saved'), false);
  assert.equal(window.allowedCloses, 1); assert.equal(window.cancelled().length, 0);
});

test('unresponsive renderer times out without any approval or implicit retry', () => {
  const f = fixture(), window = new f.Window(); const token = window.offer();
  f.advance(4999); assert.equal(window.cancelled().length, 0);
  f.advance(1); assert.equal(window.allowedCloses, 0); assert.equal(window.closeCalls, 1);
  assert.deepEqual(window.cancelled().map(value => value.args), [[token, 'timeout']]);
  assert.equal(f.invoke('begin', window, token), false);
  assert.equal(f.invoke('complete', window, token, 'saved'), false);
  assert.equal(f.timers.size, 0);
});

test('slow save cancels at five seconds and an old timer/receipt cannot affect a fresh close', () => {
  const f = fixture(), window = new f.Window(); const first = window.offer();
  const oldTimer = [...f.timers.values()][0]; f.invoke('begin', window, first);
  assert.equal(window.offer(), first, 'Repeated close offers the same nonce once');
  assert.equal(window.messages.filter(value => value.channel === 'nextmux:prepare-close').length, 1);
  f.advance(5000); const second = window.offer(); assert.notEqual(second, first);
  f.invoke('begin', window, second); oldTimer.callback();
  assert.equal(f.timers.size, 1);
  assert.equal(f.invoke('complete', window, first, 'saved'), false);
  assert.equal(f.invoke('complete', window, first, 'failed'), false);
  assert.equal(f.invoke('complete', window, second, 'saved'), true);
  assert.equal(window.allowedCloses, 1);
});

test('failed save preserves the window, reports only the fixed reason and allows a fresh attempt', () => {
  const f = fixture(), window = new f.Window(); const first = window.offer(); f.invoke('begin', window, first);
  assert.equal(f.invoke('complete', window, first, { outcome: 'failed', body: 'private' }), false);
  assert.equal(f.invoke('complete', window, first, 'unknown'), false);
  assert.equal(f.invoke('complete', window, first, 'failed'), true);
  assert.equal(window.allowedCloses, 0); assert.equal(f.timers.size, 0);
  assert.deepEqual(window.cancelled().map(value => value.args), [[first, 'failed']]);
  const next = window.offer(); assert.notEqual(next, first);
  assert.equal(f.invoke('complete', window, first, 'saved'), false);
  assert.equal(window.allowedCloses, 0);
});

test('wrong window, subframe, old frame, untrusted origin and malformed nonce cannot begin or finish', () => {
  const f = fixture(), window = new f.Window(), other = new f.Window();
  const token = window.offer(); other.offer();
  for (const name of ['begin', 'complete']) {
    const handler = f.handlers.get(`nextmux:prepare-close:${name}`);
    assert.equal(handler(f.event(other), token, 'saved'), false);
    assert.equal(handler({ sender: window.webContents, senderFrame: {} }, token, 'saved'), false);
    assert.equal(handler(f.event(window), null, 'saved'), false);
    assert.equal(handler(f.event(window), `${token}-stale`, 'saved'), false);
    assert.equal(handler(undefined, token, 'saved'), false);
  }
  window.webContents.getURL = () => 'https://untrusted.example.invalid';
  assert.equal(f.invoke('begin', window, token), false);
  window.webContents.getURL = () => 'file:///fixture/index.html';
  assert.equal(f.invoke('begin', window, token), true);
  const oldFrame = window.webContents.mainFrame; window.webContents.mainFrame = {};
  assert.equal(f.handlers.get('nextmux:prepare-close:complete')({ sender: window.webContents, senderFrame: oldFrame }, token, 'saved'), false);
  assert.equal(f.invoke('complete', window, token, 'saved'), false);
  assert.equal(window.allowedCloses, 0); assert.equal(other.allowedCloses, 0);
});

test('same-URL full navigation invalidates tokens but subframe and same-document navigation do not', () => {
  for (const modern of [true, false]) {
    const f = fixture(), window = new f.Window(); const token = window.offer(); f.invoke('begin', window, token);
    const navigate = (main, same) => modern
      ? window.webContents.emit('did-start-navigation', { isMainFrame: main, isSameDocument: same, url: 'file:///fixture/index.html' })
      : window.webContents.emit('did-start-navigation', {}, 'file:///fixture/index.html', same, main);
    navigate(false, false); navigate(true, true); assert.equal(f.timers.size, 1);
    navigate(true, false); assert.equal(f.timers.size, 0);
    assert.deepEqual(window.cancelled().map(value => value.args), [[token, 'navigated']]);
    assert.equal(f.invoke('complete', window, token, 'saved'), false);
    assert.notEqual(window.offer(), token); assert.equal(window.allowedCloses, 0);
  }
});

test('renderer crash, content destruction and window close clear timers without inventing saved state', () => {
  for (const mode of ['crash', 'contents', 'window']) {
    const f = fixture(), window = new f.Window(); const token = window.offer(); f.invoke('begin', window, token);
    if (mode === 'crash') window.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    else if (mode === 'contents') { window.webContents.destroyed = true; window.webContents.emit('destroyed'); }
    else window.destroyFixture();
    assert.equal(f.timers.size, 0); f.advance(5000);
    assert.equal(f.invoke('complete', window, token, 'saved'), false);
    assert.equal(window.allowedCloses, 0);
  }
});

test('a close listener veto cancels the saved renderer state and requires a fresh save', () => {
  const f = fixture(), window = new f.Window();
  const veto = event => event.preventDefault(); window.on('close', veto);
  const token = window.offer(); f.invoke('begin', window, token);
  assert.equal(f.invoke('complete', window, token, 'saved'), true); assert.equal(window.allowedCloses, 0);
  assert.equal(f.invoke('complete', window, token, 'saved'), false, 'Consumed nonce is never accepted twice');
  assert.equal(window.offer(), token, 'Before the veto settles, repeated close cannot reuse the receipt');
  f.flushMicrotasks();
  assert.deepEqual(window.cancelled().map(value => value.args), [[token, 'failed']]);
  window.off('close', veto);
  const next = window.offer(); assert.notEqual(next, token);
  assert.equal(window.allowedCloses, 0); assert.equal(f.timers.size, 1);
  assert.equal(f.invoke('begin', window, next), true);
  assert.equal(f.invoke('complete', window, next, 'saved'), true);
  f.flushMicrotasks(); assert.equal(window.allowedCloses, 1);
  assert.equal(window.cancelled().length, 1);
});

test('a beforeunload veto unlocks only its consumed nonce unless Electron explicitly overrides it', () => {
  for (const overridden of [false, true]) {
    const f = fixture(), window = new f.Window(); const token = window.offer(); f.invoke('begin', window, token);
    f.invoke('complete', window, token, 'saved'); f.flushMicrotasks();
    if (overridden) window.webContents.on('will-prevent-unload', event => event.preventDefault());
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    window.webContents.emit('will-prevent-unload', event);
    assert.equal(window.cancelled().length, 0, 'Wait for all synchronous listeners, including a later override');
    f.flushMicrotasks();
    assert.deepEqual(window.cancelled().map(value => value.args), overridden ? [] : [[token, 'failed']]);
    assert.equal(f.invoke('complete', window, token, 'saved'), false);
    if (!overridden) { const next = window.offer(); assert.notEqual(next, token); assert.equal(f.invoke('begin', window, next), true); }
    else { window.offer(); assert.equal(window.allowedCloses, 1, 'The consumed receipt does not approve a repeated close'); }
  }
});

test('late veto callbacks cannot cancel a newer attempt or notify a destroyed renderer', () => {
  for (const destroyed of [false, true]) {
    const f = fixture(), window = new f.Window(); const token = window.offer(); f.invoke('begin', window, token);
    f.invoke('complete', window, token, 'saved');
    window.webContents.emit('will-prevent-unload', { defaultPrevented: false });
    if (destroyed) window.destroyFixture();
    else window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    const count = window.cancelled().length;
    const next = destroyed ? undefined : window.offer();
    f.flushMicrotasks(); assert.equal(window.cancelled().length, count);
    if (next) assert.equal(f.invoke('begin', window, next), true);
    else assert.equal(f.timers.size, 0);
  }
});

test('a native close exception reports fixed failure without leaving consumed approval', () => {
  const f = fixture(), window = new f.Window(); const token = window.offer(); f.invoke('begin', window, token);
  const close = window.close; window.close = () => { throw new Error('synthetic private close failure'); };
  assert.equal(f.invoke('complete', window, token, 'saved'), false);
  assert.deepEqual(window.cancelled().map(value => value.args), [[token, 'failed']]);
  assert.equal(f.timers.size, 0); assert.equal(window.allowedCloses, 0);
  window.close = close; assert.notEqual(window.offer(), token);
});

test('delivery failure is cancelled rather than approving or leaving a stuck pending token', () => {
  const f = fixture(), window = new f.Window(); window.webContents.send = () => { throw new Error('fixture unavailable'); };
  assert.doesNotThrow(() => window.close()); assert.equal(f.timers.size, 0); assert.equal(window.allowedCloses, 0);
});

test('a page the main process built itself (data: helper, overlay, progress) closes at once and never holds up quit', () => {
  const f = fixture(), helper = new f.Window();
  helper.webContents.getURL = () => 'data:text/html;charset=utf-8,%3Cbody%3E';
  helper.close();
  assert.equal(helper.allowedCloses, 1, 'the × on the drag helper and quit/relaunch both close it');
  assert.equal(helper.messages.length, 0, 'no save offer that nobody would answer');
  assert.equal(f.timers.size, 0);
  const workbench = new f.Window();
  workbench.close();
  assert.equal(workbench.allowedCloses, 0, 'a workbench page still has to save first');
});
