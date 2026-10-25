'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createOwnedBrowserRegistry } = require('../owned-browser-registry.cjs');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
function fixture(engineOptions = {}) {
  const app = new EventEmitter(); app.isReady = () => true;
  const persistent = {}, session = { fromPartition: () => persistent }, contentsList = [], windows = [], views = [];
  const engineStats = { inputs: [], cancellations: [], disposals: 0, creates: 0 };
  class Contents extends EventEmitter {
    constructor(preferences = {}) { super(); this.id = contentsList.length + 1; contentsList.push(this); this.session = preferences.session; this.preferences = preferences; this.mainFrame = { detached: false }; this.location = ''; this.title = ''; this.zoom = 1; this.destroyed = false; this.loading = false; this.captureCalls = 0; this.stops = 0; this.debugger = { isAttached: () => false }; this.navigationHistory = { canGoBack: () => false, canGoForward: () => false }; }
    getLastWebPreferences() { return this.preferences; } isDestroyed() { return this.destroyed; }
    getURL() { return this.location; } getTitle() { return this.title; } isLoading() { return this.loading; } getZoomFactor() { return this.zoom; }
    getUserAgent() { return this.userAgent || 'Fixture Desktop'; } setUserAgent(value) { this.userAgent = value; }
    reload() { this.reloads = (this.reloads || 0) + 1; queueMicrotask(() => this.emit('did-stop-loading')); }
    setWindowOpenHandler(handler) { this.popupHandler = handler; }
    loadURL(location) { this.location = location; this.emit('did-navigate'); return Promise.resolve(); }
    stop() { this.stops++; this.emit('did-stop-loading'); }
    close() { if (!this.destroyed) { this.destroyed = true; this.emit('destroyed'); } }
    capturePage() { this.captureCalls++; return this.captureDeferred ? this.captureDeferred.promise : Promise.resolve(image()); }
    enableDeviceEmulation() {} disableDeviceEmulation() {}
  }
  class Window extends EventEmitter {
    constructor(options = {}) { super(); this.options = options; this.visible = Boolean(options.show); this.minimized = false; this.destroyed = false; this.bounds = { width: options.width || 1400, height: options.height || 900 }; this.children = new Set(); this.contentView = { addChildView: view => this.children.add(view), removeChildView: view => this.children.delete(view) }; windows.push(this); }
    getContentBounds() { return this.bounds; } isDestroyed() { return this.destroyed; } isVisible() { return this.visible; } isMinimized() { return this.minimized; } isFocused() { return this.focused !== false; }
    setContentSize(width, height) { this.bounds = { width, height }; } destroy() { this.destroyed = true; this.emit('closed'); }
    focus() { throw Error('No automatic focus is permitted'); }
  }
  class View { constructor({ webPreferences }) { this.webContents = new Contents(webPreferences); this.bounds = {}; views.push(this); app.emit('web-contents-created', {}, this.webContents); if (engineOptions.viewConstructorThrows) throw Error('Injected native creation failure'); } setBounds(bounds) { this.bounds = bounds; } getBounds() { return this.bounds; } }
  const hostWindow = new Window({ show: true, width: 1400, height: 900 }), host = new Contents(); hostWindow.webContents = host;
  const event = { sender: host, senderFrame: host.mainFrame }, owner = { conversationId: 'c', browserId: 'b', workspaceRoot: '/workspace' };
  const GuestAutomation = { async create(contents) {
    engineStats.creates++;
    if (engineOptions.createWait) await engineOptions.createWait.promise;
    return { async run(request) { engineStats.inputs.push(request); if (engineOptions.runWait) await engineOptions.runWait.promise; return { requestId: request.id, ok: true }; },
      cancel(id) { engineStats.cancellations.push(id); }, async dispose() { engineStats.disposals++; if (engineOptions.disposeWait) await engineOptions.disposeWait.promise; } };
  } };
  const registry = createOwnedBrowserRegistry({ app, BrowserWindow: { fromWebContents: target => target === host ? hostWindow : undefined }, BaseWindow: Window,
    WebContentsView: View, session, GuestAutomation, trustedMainFrame: candidate => candidate.sender === host && candidate.senderFrame === host.mainFrame });
  const image = () => ({ isEmpty: () => false, getSize: () => ({ width: 500, height: 300 }), toPNG: () => Buffer.from('fixture png'), resize() { return this; } });
  const create = async (id = 'b') => { const own = { ...owner, browserId: id }; await registry.create(event, own, 'https://example.test/'); return { owner: own, contents: views.at(-1).webContents, view: views.at(-1), holder: windows.at(-1) }; };
  const request = (id, extra = {}) => ({ id, action: 'click', selector: '#a', expiresAt: Date.now() + 15_000, ...extra });
  return { registry, create, event, owner, app, host, hostWindow, windows, views, request, engineStats, image };
}

test('factory works before ready, but create does not allocate native windows before ready', async () => {
  const f = fixture(); f.app.isReady = () => false;
  await assert.rejects(f.create(), { code: 'BROWSER_NOT_READY' }); assert.equal(f.windows.length, 1); await f.registry.dispose();
});
test('human editing shortcuts stay in the exact focused manual page and never route in background', async () => {
  const f = fixture(), tab = await f.create(), edits = [];
  tab.contents.isFocused = () => true;
  for (const action of ['selectAll', 'copy', 'cut', 'paste', 'pasteAndMatchStyle', 'undo', 'redo']) tab.contents[action] = () => edits.push(action);
  const input = { type: 'keyDown', key: 'v', meta: process.platform === 'darwin', control: process.platform !== 'darwin' };
  const send = changes => { const event = { prevented: false, preventDefault() { this.prevented = true; } }; tab.contents.emit('before-input-event', event, { ...input, ...changes }); return event.prevented; };
  assert.equal(send(), false); assert.deepEqual(edits, []);
  await f.registry.takeover(f.event, f.owner, { x: 20, y: 20, width: 600, height: 500 });
  for (const [key, action] of [['a', 'selectAll'], ['c', 'copy'], ['x', 'cut'], ['v', 'paste'], ['z', 'undo']]) { assert.equal(send({ key }), true); assert.equal(edits.at(-1), action); }
  assert.equal(send({ shift: true }), true); assert.equal(edits.at(-1), 'pasteAndMatchStyle');
  assert.equal(send({ key: 'z', shift: true }), true); assert.equal(edits.at(-1), 'redo');
  const count = edits.length;
  for (const changes of [{ type: 'keyUp' }, { isComposing: true }, { key: 'w' }, { alt: true }, { meta: false, control: false }]) assert.equal(send(changes), false);
  tab.contents.isFocused = () => false; assert.equal(send(), false);
  tab.contents.isFocused = () => true; f.hostWindow.focused = false; assert.equal(send(), false);
  f.hostWindow.focused = true; await f.registry.release(f.event, f.owner); assert.equal(send(), false);
  assert.equal(edits.length, count); await f.registry.dispose();
});
test('registration is synchronous before later listeners, exact ownership cannot be reassigned', async () => {
  const f = fixture(), seen = []; f.app.on('web-contents-created', (_event, contents) => seen.push(f.registry.isRegisteredOwnedContents(contents)));
  const tab = await f.create(); assert.deepEqual(seen, [true]);
  for (const changes of [{ conversationId: 'other' }, { workspaceRoot: '/other' }]) assert.throws(() => f.registry.state(f.event, { ...f.owner, ...changes }), { code: 'BROWSER_REQUEST_DENIED' });
  f.host.mainFrame = { detached: false }; assert.throws(() => f.registry.state({ sender: f.host, senderFrame: f.host.mainFrame }, f.owner), { code: 'BROWSER_REQUEST_DENIED' });
  await f.registry.dispose(); assert.equal(tab.contents.isDestroyed(), true); assert.equal(tab.holder.isDestroyed(), true);
});
test('native constructor failure after synchronous creation leaves no exempt orphan or holder', async () => {
  const f = fixture({ viewConstructorThrows: true }); await assert.rejects(f.create(), /Injected native creation failure/);
  assert.equal(f.views[0].webContents.isDestroyed(), true); assert.equal(f.registry.isRegisteredOwnedContents(f.views[0].webContents), false);
  assert.equal(f.windows[1].isDestroyed(), true); await f.registry.dispose();
});
test('takeover cancels active and invalidates queued actions before moving the same view', async () => {
  const runWait = deferred(), f = fixture({ runWait }), tab = await f.create();
  const active = f.registry.action(f.event, f.owner, f.request('active')); await flush();
  const queued = f.registry.action(f.event, f.owner, f.request('queued'));
  const moving = f.registry.takeover(f.event, f.owner, { x: 200, y: 100, width: 600, height: 500 }); await flush();
  assert.equal(f.registry.state(f.event, f.owner).mode, 'transitioning'); assert.equal(f.hostWindow.children.has(tab.view), false);
  assert.deepEqual(f.engineStats.cancellations, ['active', 'active', 'queued']);
  runWait.resolve(); await moving;
  assert.equal((await active).code, 'BROWSER_ACTION_EXPIRED'); assert.equal((await queued).code, 'BROWSER_ACTION_EXPIRED');
  assert.equal(f.engineStats.inputs.length, 1); assert.equal(f.engineStats.disposals, 1); assert.equal(f.hostWindow.children.has(tab.view), true);
  assert.equal((await f.registry.action(f.event, f.owner, f.request('manual-click'))).code, 'BROWSER_MANUAL_CONTROL');
  await f.registry.release(f.event, f.owner); assert.equal(tab.holder.children.has(tab.view), true); await f.registry.dispose();
});
test('a disposal timeout cannot let a retry move the view before old transport settles', async () => {
  const disposeWait = deferred(), f = fixture({ disposeWait }), tab = await f.create();
  await f.registry.action(f.event, f.owner, f.request('done'));
  await assert.rejects(f.registry.takeover(f.event, f.owner, { x: 20, y: 20, width: 600, height: 500 }), { code: 'BROWSER_TRANSITION_UNSETTLED' });
  assert.equal(f.registry.state(f.event, f.owner).mode, 'transitioning'); assert.equal(f.hostWindow.children.has(tab.view), false);
  const retry = f.registry.takeover(f.event, f.owner, { x: 20, y: 20, width: 600, height: 500 }); await flush();
  assert.equal(f.hostWindow.children.has(tab.view), false); assert.equal(f.engineStats.disposals, 1);
  disposeWait.resolve(); assert.equal((await retry).mode, 'manual'); await f.registry.dispose();
});
test('hide while takeover is waiting prevents a late visible handoff', async () => {
  const runWait = deferred(), f = fixture({ runWait }), tab = await f.create();
  const active = f.registry.action(f.event, f.owner, f.request('active')); await flush();
  const takeover = f.registry.takeover(f.event, f.owner, { x: 20, y: 20, width: 600, height: 500 });
  f.hostWindow.visible = false; f.hostWindow.emit('hide'); runWait.resolve(); await active;
  assert.equal((await takeover).mode, 'background'); assert.equal(f.hostWindow.children.has(tab.view), false); await f.registry.dispose();
});
test('release during takeover suppresses late manual attach; loss of foreground also suppresses it', async () => {
  for (const releaseInstead of [true, false]) {
    const runWait = deferred(), f = fixture({ runWait }), tab = await f.create();
    const action = f.registry.action(f.event, f.owner, f.request('active')); await flush();
    const takeover = f.registry.takeover(f.event, f.owner, { x: 20, y: 20, width: 600, height: 500 });
    const release = releaseInstead ? f.registry.release(f.event, f.owner) : undefined;
    if (!releaseInstead) f.hostWindow.focused = false;
    runWait.resolve(); await action; await release;
    assert.equal((await takeover).mode, 'background'); assert.equal(f.hostWindow.children.has(tab.view), false); await f.registry.dispose();
  }
});
test('release hides native view synchronously even while toolbar navigation is still pending', async () => {
  const f = fixture(), tab = await f.create(); await f.registry.takeover(f.event, f.owner, { x: 20, y: 20, width: 600, height: 500 });
  const load = deferred(); tab.contents.loadURL = () => load.promise;
  const navigation = f.registry.navigate(f.event, f.owner, { action: 'navigate', url: 'https://slow.test/' }); await flush();
  const stopCount = tab.contents.stops;
  const releasing = f.registry.release(f.event, f.owner);
  assert.equal(f.hostWindow.children.has(tab.view), false); assert.equal(tab.holder.children.has(tab.view), true);
  assert.equal(tab.contents.stops, stopCount, 'Releasing manual control must not cancel a user navigation');
  assert.equal(f.registry.state(f.event, f.owner).mode, 'transitioning'); load.resolve(); await navigation; await releasing; await f.registry.dispose();
});
test('same request ID is exactly once, different payload conflicts, expired request cannot execute', async () => {
  const f = fixture(); await f.create(); const request = f.request('once');
  const [a, b] = await Promise.all([f.registry.action(f.event, f.owner, request), f.registry.action(f.event, f.owner, request)]);
  assert.equal(a.ok, true); assert.deepEqual(a, b); assert.equal(f.engineStats.inputs.length, 1);
  assert.equal((await f.registry.action(f.event, f.owner, { ...request, selector: '#b' })).code, 'BROWSER_REQUEST_CONFLICT');
  assert.equal((await f.registry.action(f.event, f.owner, f.request('expired', { expiresAt: Date.now() - 1 }))).code, 'BROWSER_ACTION_EXPIRED');
  await f.registry.dispose();
});
test('request scope cannot be silently overwritten by the registered owner', async () => {
  const f = fixture(); await f.create();
  for (const field of ['conversationId', 'browserId', 'workspaceRoot']) {
    const result = await f.registry.action(f.event, f.owner, f.request(field, { [field]: 'foreign' }));
    assert.equal(result.ok, false); assert.equal(result.code, 'BROWSER_REQUEST_DENIED');
  }
  assert.equal(f.engineStats.inputs.length, 0); assert.equal(f.engineStats.creates, 0); await f.registry.dispose();
});
test('preview timeout retains native inflight budget until real completion; captures are per-page singleflight', async () => {
  const f = fixture(), a = await f.create('a'), b = await f.create('b'), c = await f.create('c');
  a.contents.captureDeferred = deferred(); b.contents.captureDeferred = deferred();
  const first = f.registry.preview(f.event, a.owner), duplicate = f.registry.preview(f.event, a.owner), second = f.registry.preview(f.event, b.owner);
  const caught = Promise.allSettled([first, duplicate, second]);
  await assert.rejects(f.registry.preview(f.event, c.owner), { code: 'BROWSER_PREVIEW_BUSY' }); assert.equal(a.contents.captureCalls, 1);
  assert.ok((await caught).every(result => result.status === 'rejected' && result.reason.code === 'BROWSER_PREVIEW_TIMEOUT'));
  await assert.rejects(f.registry.preview(f.event, c.owner), { code: 'BROWSER_PREVIEW_BUSY' });
  a.contents.captureDeferred.resolve(f.image()); b.contents.captureDeferred.resolve(f.image()); await flush();
  assert.ok((await f.registry.preview(f.event, c.owner)).dataURL.startsWith('data:image/png;')); await f.registry.dispose();
});
test('navigation during capture invalidates preview, zoom uses CSS-to-DIP only and hidden resize never attaches', async () => {
  const f = fixture(), tab = await f.create(); tab.contents.captureDeferred = deferred();
  const preview = f.registry.preview(f.event, f.owner); tab.contents.emit('did-navigate'); tab.contents.captureDeferred.resolve(f.image());
  await assert.rejects(preview, { code: 'BROWSER_PREVIEW_STALE' });
  f.host.zoom = 1.5; f.registry.resize(f.event, f.owner, { x: 33, y: 44, width: 400, height: 300 });
  assert.deepEqual(tab.view.getBounds(), { x: 0, y: 0, width: 600, height: 450 }); assert.equal(f.hostWindow.children.has(tab.view), false);
  await f.registry.takeover(f.event, f.owner, { x: 20, y: 30, width: 400, height: 300 });
  assert.deepEqual(tab.view.getBounds(), { x: 30, y: 45, width: 600, height: 450 });
  await f.registry.dispose();
});
test('host main-frame navigation closes all owned views and holders, and never leaves popup permission', async () => {
  const f = fixture(), a = await f.create('a'), b = await f.create('b');
  assert.deepEqual(a.contents.popupHandler({ url: 'https://other.test' }), { action: 'deny' });
  const event = { prevented: false, preventDefault() { this.prevented = true; } }; a.contents.emit('will-redirect', event, 'file:///no'); assert.equal(event.prevented, true);
  f.host.emit('did-start-navigation', {}, 'https://new-host.test', false, true); await flush();
  assert.ok(a.contents.isDestroyed() && b.contents.isDestroyed() && a.holder.isDestroyed() && b.holder.isDestroyed()); await f.registry.dispose();
});
test('model navigation observes same page using original request ID; mobile preserves UA and reloads', async () => {
  const f = fixture(), tab = await f.create();
  const result = await f.registry.action(f.event, f.owner, f.request('navigation', { action: 'navigate', url: 'https://next.test/' }));
  assert.equal(result.ok, true); assert.equal(f.engineStats.inputs[0].id, 'navigation'); assert.equal(f.engineStats.inputs[0].action, 'snapshot');
  await f.registry.navigate(f.event, f.owner, { action: 'mobile', mobile: true }); assert.match(tab.contents.getUserAgent(), /iPhone/);
  await f.registry.navigate(f.event, f.owner, { action: 'mobile', mobile: false }); assert.equal(tab.contents.getUserAgent(), 'Fixture Desktop'); assert.equal(tab.contents.reloads, 2);
  await f.registry.dispose();
});
test('run-end automation lease waits active action, detaches transport without moving or closing view', async () => {
  const runWait = deferred(), f = fixture({ runWait }), tab = await f.create();
  const active = f.registry.action(f.event, f.owner, f.request('live')); await flush();
  assert.equal(f.registry.keepaliveAutomation(f.event, ['c']), 1);
  assert.equal(f.registry.releaseAutomation(f.event, 'other'), false);
  assert.equal(f.registry.releaseAutomation(f.event, 'c'), true); assert.equal(f.engineStats.disposals, 0);
  runWait.resolve(); assert.equal((await active).ok, true); await flush();
  assert.equal(f.engineStats.disposals, 1); assert.equal(tab.contents.isDestroyed(), false); assert.equal(tab.holder.children.has(tab.view), true);
  assert.equal(f.registry.state(f.event, f.owner).mode, 'background'); assert.equal(f.registry.keepaliveAutomation(f.event, ['c']), 0);
  await f.registry.dispose();
});

test('model close is denied while manual control owns the same live view', async () => {
  const f = fixture(), tab = await f.create();
  await f.registry.takeover(f.event, f.owner, { x: 20, y: 20, width: 600, height: 500 });
  const result = await f.registry.action(f.event, f.owner, f.request('close-manual', { action: 'close' }));
  assert.equal(result.ok, false); assert.equal(result.code, 'BROWSER_MANUAL_CONTROL');
  assert.equal(tab.contents.isDestroyed(), false); assert.equal(f.hostWindow.children.has(tab.view), true);
  assert.equal(f.engineStats.creates, 0); await f.registry.dispose();
});

test('model close is denied throughout a pending takeover before its native attach', async () => {
  const runWait = deferred(), f = fixture({ runWait }), tab = await f.create();
  const active = f.registry.action(f.event, f.owner, f.request('active')); await flush();
  const handoff = f.registry.takeover(f.event, f.owner, { x: 20, y: 20, width: 600, height: 500 });
  assert.equal(f.registry.state(f.event, f.owner).mode, 'transitioning');
  const closing = await f.registry.action(f.event, f.owner, f.request('close-transition', { action: 'close' }));
  assert.equal(closing.ok, false); assert.equal(closing.code, 'BROWSER_MANUAL_CONTROL');
  assert.equal(tab.contents.isDestroyed(), false); runWait.resolve(); await active; await handoff;
  assert.equal(f.hostWindow.children.has(tab.view), true); await f.registry.dispose();
});

test('a queued model close is invalidated by takeover before it reaches the queue head', async () => {
  const runWait = deferred(), f = fixture({ runWait }), tab = await f.create();
  const active = f.registry.action(f.event, f.owner, f.request('active')); await flush();
  const closing = f.registry.action(f.event, f.owner, f.request('queued-close', { action: 'close' }));
  const handoff = f.registry.takeover(f.event, f.owner, { x: 20, y: 20, width: 600, height: 500 });
  runWait.resolve(); await active;
  assert.equal((await closing).code, 'BROWSER_ACTION_EXPIRED'); await handoff;
  assert.equal(tab.contents.isDestroyed(), false); assert.equal(f.hostWindow.children.has(tab.view), true);
  assert.equal(f.engineStats.inputs.length, 1); await f.registry.dispose();
});

test('authorized background model close returns without waiting on its own queue tail', { timeout: 1000 }, async () => {
  const f = fixture(), tab = await f.create();
  await f.registry.action(f.event, f.owner, f.request('read', { action: 'snapshot' }));
  const request = f.request('close-background', { action: 'close' });
  const [first, duplicate] = await Promise.all([f.registry.action(f.event, f.owner, request), f.registry.action(f.event, f.owner, request)]);
  assert.equal(first.ok, true); assert.deepEqual(first, duplicate);
  assert.equal(tab.contents.isDestroyed(), true); assert.equal(tab.holder.isDestroyed(), true);
  assert.equal(f.hostWindow.children.has(tab.view), false); assert.equal(f.engineStats.inputs.length, 1);
  assert.throws(() => f.registry.state(f.event, f.owner), { code: 'BROWSER_REQUEST_DENIED' });
  await flush(); assert.equal(f.engineStats.disposals, 1); await f.registry.dispose();
});

test('shrinking the host during takeover cannot attach an out-of-bounds native view', async () => {
  const runWait = deferred(), f = fixture({ runWait }), tab = await f.create();
  const active = f.registry.action(f.event, f.owner, f.request('active')); await flush();
  const handoff = f.registry.takeover(f.event, f.owner, { x: 200, y: 100, width: 600, height: 500 });
  const rejected = assert.rejects(handoff, { code: 'BROWSER_BOUNDS_INVALID' });
  f.hostWindow.bounds = { width: 500, height: 400 }; f.hostWindow.emit('resize');
  runWait.resolve(); await active; await rejected;
  try {
    assert.equal(f.hostWindow.children.has(tab.view), false, 'Bounds must be revalidated before adding the native view above host DOM');
    assert.equal(tab.holder.children.has(tab.view), true);
  } finally { await f.registry.dispose(); }
});

test('native bounds failure after attach removes the view before returning a failed takeover', async () => {
  const f = fixture(), tab = await f.create(), setBounds = tab.view.setBounds.bind(tab.view);
  tab.view.setBounds = bounds => { if (bounds.x > 0) throw Error('Injected native bounds failure'); setBounds(bounds); };
  await assert.rejects(f.registry.takeover(f.event, f.owner, { x: 20, y: 20, width: 600, height: 500 }), /Injected native bounds failure/);
  assert.equal(f.hostWindow.children.has(tab.view), false); assert.equal(tab.holder.children.has(tab.view), true);
  assert.equal(f.registry.state(f.event, f.owner).mode, 'background'); await f.registry.dispose();
});

test('a stalled input transition fails without overlaying DOM or admitting concurrent input', async () => {
  const runWait = deferred(), f = fixture({ runWait }), tab = await f.create();
  const first = f.registry.action(f.event, f.owner, f.request('stalled')); await flush();
  await assert.rejects(f.registry.takeover(f.event, f.owner, { x: 20, y: 20, width: 600, height: 500 }), { code: 'BROWSER_TRANSITION_UNSETTLED' });
  assert.equal(f.hostWindow.children.has(tab.view), false); assert.equal(tab.holder.children.has(tab.view), true);
  const next = f.registry.action(f.event, f.owner, f.request('next')); await flush();
  assert.equal(f.engineStats.inputs.length, 1, 'Failed takeover must not permit new input while the old action is physically unsettled');
  assert.equal((await next).code, 'BROWSER_MANUAL_CONTROL');
  runWait.resolve(); assert.equal((await first).code, 'BROWSER_ACTION_EXPIRED');
  await f.registry.release(f.event, f.owner);
  assert.equal((await f.registry.action(f.event, f.owner, f.request('after-release'))).ok, true);
  await f.registry.dispose();
});

test('hostWindow blur keeps manual takeover active while hide and minimize return the view to background', async () => {
  const f = fixture(), tab = await f.create();
  await f.registry.takeover(f.event, f.owner, { x: 20, y: 20, width: 600, height: 500 });
  assert.equal(f.registry.state(f.event, f.owner).mode, 'manual');
  assert.equal(f.hostWindow.children.has(tab.view), true);

  f.hostWindow.emit('blur');
  assert.equal(f.registry.state(f.event, f.owner).mode, 'manual', 'blur must not kick the owned browser out of manual mode');
  assert.equal(f.hostWindow.children.has(tab.view), true);

  f.hostWindow.emit('minimize');
  assert.equal(f.hostWindow.children.has(tab.view), false);
  assert.equal(tab.holder.children.has(tab.view), true);
  await flush();
  assert.equal(f.registry.state(f.event, f.owner).mode, 'background');
  await f.registry.dispose();
});
