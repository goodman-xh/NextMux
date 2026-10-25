import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createComputerWindowView } = require('../computer-window-view.cjs');
const { registerComputerTabWindows } = require('../computer-tab-window.cjs');
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const sources = [{ id: 'window:77:0' }, { id: 'window:78:0' }];

function captureView(getSources = async () => sources) {
  const mainFrame = { parent: null };
  const contents = { id: 1, mainFrame, isDestroyed: () => false };
  const view = createComputerWindowView({ platform: 'darwin', helperPath: '/not-a-nextmux-helper',
    desktopCapturer: { getSources }, webContentsFromFrame: frame => frame && contents });
  view.grant('conversation-a', 10, 77);
  view.grant('conversation-a', 10, 78);
  const consume = (frame = mainFrame) => {
    let answer;
    view.handleDisplayMediaRequest({ frame, videoRequested: true }, value => { answer = value; });
    return answer;
  };
  return { view, consume, mainFrame };
}

test('capture grants are revoked by forget, including an in-flight enumeration followed by re-grant', async () => {
  const ready = captureView();
  await ready.view.arm(1, 'conversation-a', 10, 77);
  await ready.view.forget('conversation-a', 10, 77);
  assert.deepEqual(ready.consume(), {}, 'forget revokes an armed source before getDisplayMedia');
  await ready.view.dispose();

  const enumeration = deferred();
  const pending = captureView(() => enumeration.promise);
  const arming = pending.view.arm(1, 'conversation-a', 10, 77);
  await pending.view.forget('conversation-a', 10, 77);
  pending.view.grant('conversation-a', 10, 77);
  enumeration.resolve(sources);
  assert.equal((await arming).ok, false, 'an old request cannot gain the new grant');
  assert.deepEqual(pending.consume(), {});
  await pending.view.dispose();
});

test('the latest capture request wins even when window enumeration finishes out of order', async () => {
  const a = deferred(), b = deferred();
  let calls = 0;
  const { view, consume } = captureView(() => (++calls === 1 ? a : b).promise);
  const first = view.arm(1, 'conversation-a', 10, 77);
  const second = view.arm(1, 'conversation-a', 10, 78);
  b.resolve(sources);
  assert.equal((await second).ok, true);
  a.resolve(sources);
  assert.equal((await first).ok, false);
  assert.equal(consume().video.id, 'window:78:0');
  await view.dispose();
});

test('a subframe cannot consume its workbench capture grant', async () => {
  const { view, consume, mainFrame } = captureView();
  await view.arm(1, 'conversation-a', 10, 77);
  assert.deepEqual(consume({ parent: mainFrame }), {});
  assert.equal(consume().video.id, 'window:77:0', 'rejecting a subframe preserves the main-frame grant');
  await view.dispose();
});

test('a failed new capture request cannot fall back to the previously armed window', async () => {
  const { view, consume } = captureView();
  await view.arm(1, 'conversation-a', 10, 77);
  assert.equal((await view.arm(1, 'conversation-a', 10, 99)).ok, false);
  assert.deepEqual(consume(), {});
  await view.dispose();
});

function node() {
  const listeners = new Map(), attributes = new Map(), classes = new Set();
  return {
    listeners, hidden: false, checked: false, value: '', style: {}, dataset: {},
    classList: { add: name => classes.add(name), remove: name => classes.delete(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
    setAttribute: (key, value) => attributes.set(key, value), getAttribute: key => attributes.get(key),
    addEventListener(name, fn, options = {}) { const list = listeners.get(name) || []; list.push({ fn, once: options.once }); listeners.set(name, list); },
    removeEventListener(name, fn) { listeners.set(name, (listeners.get(name) || []).filter(item => item.fn !== fn)); },
    async emit(name, event = {}) {
      for (const item of [...(listeners.get(name) || [])]) {
        if (item.once) this.removeEventListener(name, item.fn);
        await item.fn({ preventDefault() {}, stopPropagation() {}, ...event });
      }
    },
    focus() {}, blur() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 })
  };
}

function media() {
  const track = node();
  track.stopped = false;
  track.stop = () => { track.stopped = true; };
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}

function renderer({ getDisplayMedia = async () => media(), start = async () => ({ ok: true, placement: 'desktop' }),
  userInput = async on => ({ ok: true, on: on ?? true }) } = {}) {
  const nodes = new Map();
  const element = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const video = element('video');
  Object.assign(video, { videoWidth: 800, videoHeight: 600, readyState: 2, parentElement: node(), play: async () => undefined });
  const buttons = ['tab', 'desktop'].map(place => { const button = node(); button.dataset.place = place; return button; });
  const document = Object.assign(node(), { documentElement: node(), body: node(), visibilityState: 'visible',
    getElementById: element, querySelectorAll: () => buttons,
    createElement: () => ({ getContext() { throw Error('canvas not needed'); } }) });
  const events = [], timers = new Map();
  let timerId = 0;
  const window = Object.assign(node(), { devicePixelRatio: 1, nextmuxTab: {
    start, userInput, identity: async () => ({}),
    keys: async input => { events.push(['keys', JSON.parse(JSON.stringify(input))]); return { ok: true }; },
    pointer: async input => { events.push(['pointer', JSON.parse(JSON.stringify(input))]); return { ok: true }; },
    place: async placement => ({ ok: true, placement }), setSound: async () => ({ ok: true }), closeTab: async () => true
  } });
  vm.runInNewContext(readFileSync(new URL('../computer-tab-window.js', import.meta.url), 'utf8'), {
    window, document, location: { search: '?canPoint=1&canPark=1' }, navigator: { mediaDevices: { getDisplayMedia } }, URLSearchParams,
    ResizeObserver: class { observe() {} },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id)
  });
  const flush = async ms => { for (const [id, timer] of [...timers]) if (timer.ms === ms || (ms === 90 && timer.ms === 8)) { timers.delete(id); timer.fn(); } await turn(); };
  return { element, document, events, flush, video, buttons };
}

test('independent tab sends buffered text before Enter and shortcut keys', async () => {
  const f = renderer(); await turn();
  f.element('keys').value = 'hello';
  await f.element('keys').emit('input');
  await f.element('keys').emit('keydown', { key: 'Enter', code: 'Enter' });
  await f.flush(90);
  assert.deepEqual(f.events, [['keys', { text: 'hello' }], ['keys', { key: 'enter' }]]);
});

test('independent tab retains long pasted text and does not split Unicode surrogate pairs', async () => {
  const f = renderer(); await turn();
  const text = 'a'.repeat(1999) + '😀' + 'b'.repeat(2100);
  f.element('keys').value = text;
  await f.element('keys').emit('input');
  await f.flush(90);
  const chunks = f.events.map(([, input]) => input.text);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every(chunk => chunk.length <= 2000 && !/[\uD800-\uDBFF]$/.test(chunk)));
});

test('disabling independent tab keyboard and mouse cancels buffered input', async () => {
  const f = renderer(); await turn();
  f.element('keys').value = 'late';
  await f.element('keys').emit('input');
  await f.video.emit('wheel', { clientX: 400, clientY: 300, deltaY: 80 });
  f.element('mouse').checked = false;
  await f.element('mouse').emit('change');
  await f.flush(90); await f.flush(120);
  assert.deepEqual(f.events, []);
});

test('a capture that resolves after the independent tab becomes hidden is stopped', async () => {
  const capture = deferred(), stream = media();
  const f = renderer({ getDisplayMedia: () => capture.promise }); await turn();
  f.document.visibilityState = 'hidden'; await f.document.emit('visibilitychange');
  capture.resolve(stream); await turn();
  assert.equal(stream.track.stopped, true);
  assert.equal(f.video.srcObject, null);
  assert.equal(f.video.hidden, true);
});

test('an ended independent-tab capture can be resumed after showing the window again', async () => {
  let count = 0;
  const initial = media();
  const f = renderer({ getDisplayMedia: async () => ++count === 1 ? initial : media() }); await turn();
  await initial.track.emit('ended');
  await f.document.emit('visibilitychange'); await turn();
  assert.equal(count, 2);
});

test('a slow initial switch query cannot overwrite a newer independent-tab user choice', async () => {
  const initial = deferred();
  const f = renderer({ userInput: on => on === undefined ? initial.promise : Promise.resolve({ ok: true, on }) });
  f.element('mouse').checked = true;
  await f.element('mouse').emit('change');
  initial.resolve({ ok: true, on: false }); await turn();
  assert.equal(f.element('mouse').checked, true);
});

test('AltGraph text goes through text input while IME keys stay local until composition ends', async () => {
  const f = renderer(); await turn();
  await f.element('keys').emit('keydown', { key: '@', code: 'KeyQ', ctrlKey: true, altKey: true, getModifierState: key => key === 'AltGraph' });
  f.element('keys').value = '@'; await f.element('keys').emit('input');
  await f.element('keys').emit('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  f.element('keys').value = '中文'; await f.element('keys').emit('input', { isComposing: true });
  await f.element('keys').emit('compositionend', { data: '中文' });
  await f.flush(90);
  assert.deepEqual(f.events, [['keys', { text: '@中文' }]]);
});

test('overlapping independent-tab capture starts keep the latest stream and stop a late old stream', async () => {
  const first = deferred(), second = deferred(), oldStream = media(), newStream = media();
  let calls = 0;
  const f = renderer({ getDisplayMedia: () => (++calls === 1 ? first : second).promise }); await turn();
  await f.buttons[0].emit('click'); await turn();
  second.resolve(newStream); await turn();
  first.resolve(oldStream); await turn();
  assert.equal(f.video.srcObject, newStream);
  assert.equal(oldStream.track.stopped, true);
  assert.equal(newStream.track.stopped, false);
});

test('hiding a capture waiting for its first decoded frame removes the pending frame listener', async () => {
  const capture = deferred(), stream = media();
  const f = renderer({ getDisplayMedia: () => capture.promise });
  f.video.readyState = 0;
  capture.resolve(stream); await turn();
  assert.equal(f.video.listeners.get('loadeddata').length, 1);
  f.document.visibilityState = 'hidden'; await f.document.emit('visibilitychange');
  assert.equal(f.video.listeners.get('loadeddata').length, 0);
  assert.equal(stream.track.stopped, true);
});

test('independent-tab pointer mapping rejects letterbox borders and maps the actual image fraction', async () => {
  const f = renderer(); await turn();
  f.video.getBoundingClientRect = () => ({ left: 10, top: 20, width: 400, height: 400 });
  await f.video.emit('click', { clientX: 210, clientY: 25, detail: 1 });
  await f.video.emit('click', { clientX: 210, clientY: 220, detail: 1 });
  await turn();
  assert.deepEqual(f.events, [['pointer', { kind: 'click', x: 0.5, y: 0.5 }]]);
});

test('independent tab checks conversation ownership before reopening, focusing, merging and forwarding input', async () => {
  const handlers = new Map(), created = [], calls = [];
  const parent = id => ({ id, mainFrame: {}, isDestroyed: () => false, send() {} });
  const a = parent(1), b = parent(2);
  let owner = a;
  class BrowserWindow extends EventEmitter {
    constructor() { super(); this.destroyed = false; this.webContents = Object.assign(new EventEmitter(), { id: 100, mainFrame: {}, setWindowOpenHandler() {} }); created.push(this); }
    isDestroyed() { return this.destroyed; } show() {} focus() {} loadFile() { return Promise.resolve(); }
    close() { this.destroyed = true; this.emit('closed'); } destroy() { this.close(); }
  }
  registerComputerTabWindows({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, BrowserWindow,
    screen: () => ({ getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 } }) }),
    view: { canView: () => true, capability: () => ({}), arm: async () => ({ ok: true }) },
    trusted: event => event.sender === a || event.sender === b,
    ownsConversation: event => event.sender === owner,
    pointer: async (...args) => { calls.push(args); return { ok: true }; }
  });
  const invoke = (channel, sender, ...args) => handlers.get(channel)({ sender, senderFrame: sender.mainFrame }, ...args);
  const request = { conversationId: 'conversation-a', tabId: 'window:10:77', pid: 10, windowId: 77 };
  const open = 'nextmux:computer:tab-window:open';
  assert.equal(await invoke(open, a, request), true);
  assert.equal(await invoke(open, b, request), false);
  for (const suffix of ['focus', 'close']) assert.equal(await invoke(`nextmux:computer:tab-window:${suffix}`, b, 'conversation-a', request.tabId, true), false);
  assert.equal(await invoke(open, a, { ...request, windowId: 78 }), false, 'the same tab ID cannot silently retain a different window');
  owner = b;
  const detached = created[0].webContents;
  assert.equal((await invoke('nextmux:tab-window:pointer', detached, { kind: 'click', x: 0.5, y: 0.5 })).ok, false, 'a stale parent cannot forward input');
  assert.equal(await invoke(open, b, request), true, 'the new authorized owner can take over');
  assert.equal((await invoke('nextmux:tab-window:pointer', detached, { kind: 'click', x: 0.5, y: 0.5 })).ok, true);
  assert.equal(calls[0][1], b.id);
});

for (const closeBehavior of ['default', 'quit']) {
  for (const cleanup of ['forget', 'dispose']) {
    test(`Windows ${closeBehavior} close behavior on ${cleanup} returns windows before any normal close`, async t => {
      const calls = [];
      const view = createComputerWindowView({ platform: 'win32', execFile: () => { throw Error('must never quit the whole process'); },
        windowsServices: {
          ready: async () => undefined, capability: () => ({ sound: false, lock: true, canPark: true }),
          windowCapability: async () => ({ canPark: true }), shield: async () => ({ ok: true }),
          park: async () => ({ ok: true }),
          unpark: async (pid, windowId, _host, activate) => { calls.push(['unpark', { pid, windowId, activate }]); return { ok: true }; },
          call: async (op, fields) => { calls.push([op, fields]); return { ok: true }; },
          restoreDesktops: async () => { calls.push(['restoreDesktops']); return { ok: true }; },
          dispose: async () => undefined
        }
      });
      t.after(() => view.dispose());
      if (closeBehavior === 'quit') view.setCloseBehavior('quit');
      else assert.equal(view.setCloseBehavior('invalid'), 'desktop');
      // A launched window can share an existing tray process: ownership is per HWND.
      await view.openInTab('conversation-a', 42, 90, { launched: true });
      await view.openInTab('conversation-a', 42, 91, { launched: false });
      await view.openInTab('conversation-a', 43, 92, { launched: false });
      assert.equal(view.isParked(42, 90), true);
      await view[cleanup]('conversation-a');
      assert.deepEqual(calls.filter(([op]) => op === 'unpark').map(([, fields]) => fields.windowId).sort(), [90, 91, 92]);
      assert.ok(calls.filter(([op]) => op === 'unpark').every(([, fields]) => fields.activate === false));
      assert.deepEqual(calls.filter(([op]) => op === 'closeWindow'), closeBehavior === 'quit'
        ? [['closeWindow', { pid: 42, windowId: 90 }]] : [], 'pre-existing app windows are never closed');
      const restored = calls.findIndex(([op]) => op === 'restoreDesktops');
      assert.ok(restored > calls.findLastIndex(([op]) => op === 'unpark'), 'cleanup removes the now-empty virtual desktop');
      if (closeBehavior === 'quit') {
        assert.ok(calls.findIndex(([op, fields]) => op === 'unpark' && fields.windowId === 90)
          < calls.findIndex(([op]) => op === 'closeWindow'), 'a save confirmation can be seen before WM_CLOSE is sent');
      }
    });
  }
}

test('capture revocation suspends access immediately but retains records until physical cleanup', async () => {
  const { view, consume } = captureView();
  await view.arm(1, 'conversation-a', 10, 77);
  assert.equal(view.revokeCapture('conversation-a', 10, 77), true);
  assert.equal(view.canView('conversation-a', 10, 77), false);
  assert.equal(view.canView('conversation-a', 10, 78), true);
  assert.equal(view.hasWindows('conversation-a'), true);
  assert.deepEqual(consume(), {});
  assert.equal((await view.keys('conversation-a', 10, 77, { key: 'enter' })).error, 'window_not_viewable');
  assert.equal((await view.snapshot('conversation-a', 10, 77)).error, 'window_not_viewable');
  view.grant('conversation-a', 10, 77);
  assert.equal(view.canView('conversation-a', 10, 77), true, 'an explicit new grant clears suspension');
  await view.forget('conversation-a', 10, 77);
  assert.equal(view.hasWindows('conversation-a'), true);
  await view.forget('conversation-a', 10, 78);
  assert.equal(view.hasWindows('conversation-a'), false);
  await view.dispose();
});

test('invalid and partial forget/revoke targets never fall back to forgetting all windows', async () => {
  const { view, consume } = captureView();
  for (const [pid, windowId] of [[10, undefined], [undefined, 77], ['10', 77], [10, NaN], [0, 77]]) {
    await view.arm(1, 'conversation-a', 10, 77);
    assert.equal(view.revokeCapture('conversation-a', pid, windowId), false);
    assert.equal(await view.forget('conversation-a', pid, windowId), false);
    assert.equal(view.canView('conversation-a', 10, 77), true);
    assert.equal(view.canView('conversation-a', 10, 78), true);
    assert.equal(consume().video.id, 'window:77:0', 'invalid cleanup must not revoke a valid grant either');
  }
  assert.equal(view.revokeCapture('conversation-a'), true);
  assert.equal(view.canView('conversation-a', 10, 77), false);
  assert.equal(view.canView('conversation-a', 10, 78), false);
  assert.equal(view.hasWindows('conversation-a'), true);
  await view.forget('conversation-a');
  assert.equal(view.hasWindows('conversation-a'), false);
  await view.dispose();
});

test('a screenshot enumeration cannot return pixels after access has been suspended', async () => {
  const enumeration = deferred();
  const { view } = captureView(() => enumeration.promise);
  const snapshot = view.snapshot('conversation-a', 10, 77);
  const frame = view.frame('conversation-a', 10, 77);
  view.revokeCapture('conversation-a', 10, 77);
  enumeration.resolve([{ id: 'window:77:0', thumbnail: { isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }),
    toJPEG: () => Buffer.from('pixel'), toBitmap: () => Buffer.alloc(4) } }]);
  assert.equal((await snapshot).error, 'window_not_viewable');
  assert.equal((await frame).error, 'window_not_viewable');
  await view.dispose();
});

test('macOS forget waits for native view input completion before unparking its window', async t => {
  const started = deferred(), requests = [];
  let finishKeys;
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough() });
  let buffer = '';
  child.stdin.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1); requests.push(request.op);
      const reply = () => child.stdout.write(`${JSON.stringify({ type: 'reply', id: request.id, ok: true })}\n`);
      if (request.op === 'keys') { finishKeys = reply; started.resolve(); } else reply();
    }
  });
  child.stdin.on('finish', () => child.emit('exit', 0));
  const view = createComputerWindowView({ platform: 'darwin', helperPath: fileURLToPath(import.meta.url),
    spawn: () => { setImmediate(() => child.stdout.write('{"type":"ready"}\n')); return child; } });
  t.after(async () => { finishKeys?.(); await view.dispose(); });
  await view.openInTab('conversation-a', 10, 77);
  const keys = view.keys('conversation-a', 10, 77, { key: 'enter' }); await started.promise;
  const forgotten = view.forget('conversation-a', 10, 77);
  await turn();
  assert.equal(view.canView('conversation-a', 10, 77), false);
  assert.equal(view.hasWindows('conversation-a'), true);
  assert.equal(requests.includes('unpark'), false, 'do not change placement while the key release is pending');
  finishKeys(); finishKeys = undefined;
  await keys; await forgotten;
  assert.equal(requests.includes('unpark'), true);
  assert.equal(view.hasWindows('conversation-a'), false);
});
