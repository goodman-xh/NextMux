import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createComputerWindowView: nativeCreateComputerWindowView } = require('../computer-window-view.cjs');
const windowViewFile = require.resolve('../computer-window-view.cjs');
/** A Darwin scenario must not inherit the Windows/Linux host kernel's version. */
function loadDarwinWindowView(kernelRelease) {
  const localRequire = createRequire(windowViewFile), module = { exports: {} };
  const testRequire = id => id === 'node:os' ? { ...localRequire(id), release: () => kernelRelease } : localRequire(id);
  new Function('require', 'module', 'exports', '__filename', '__dirname', readFileSync(windowViewFile, 'utf8'))(
    testRequire, module, module.exports, windowViewFile, dirname(windowViewFile));
  return module.exports.createComputerWindowView;
}
const darwinCreateComputerWindowView = loadDarwinWindowView('23.2.0');
const createComputerWindowView = options => options?.platform === 'darwin'
  ? darwinCreateComputerWindowView(options) : nativeCreateComputerWindowView(options);
const helperPath = fileURLToPath(import.meta.url); // any existing file stands in for the built helper

/** A fake NextMuxDisplayHelper speaking the same line protocol. */
function fakeHelper({ onRequest } = {}) {
  const spawned = [];
  const spawn = (file, args) => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), requests: [] });
    child.file = file; child.args = args;
    spawned.push(child);
    let buffer = '';
    child.stdin.on('data', chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);
        child.requests.push(request);
        const reply = (value = {}) => child.stdout.write(`${JSON.stringify({ type: 'reply', id: request.id, ok: true, frame: { x: 0, y: 0, width: 800, height: 600 }, ...value })}\n`);
        if (onRequest) onRequest(request, reply, child, spawned);
        else reply();
      }
    });
    child.stdin.on('finish', () => setImmediate(() => child.emit('exit', 0)));
    setImmediate(() => child.stdout.write('{"type":"ready","accessibility":true}\n'));
    return child;
  };
  return { spawn, spawned };
}

const capturer = (ids = ['window:77:0', 'window:78:0', 'screen:1:0']) => ({
  calls: [],
  async getSources(options) { this.calls.push(options); return ids.map(id => ({ id, name: id })); }
});

test('Darwin sound fixtures retain the actual 23.2 capability boundary without changing the host os module', async () => {
  const hostRelease = require('node:os').release();
  for (const [kernelRelease, expected] of [['23.1.0', false], ['23.2.0', true], ['24.0.0', true]]) {
    const view = loadDarwinWindowView(kernelRelease)({ platform: 'darwin', desktopCapturer: capturer(), helperPath, spawn: fakeHelper().spawn });
    assert.equal(view.capability().sound, expected, kernelRelease);
    await view.dispose();
  }
  assert.equal(require('node:os').release(), hostRelease, 'only the isolated module sees the simulated Darwin release');
});

test('only a window the conversation observed can be viewed, and only that window is captured', async () => {
  const desktopCapturer = capturer();
  const view = createComputerWindowView({ platform: 'darwin', desktopCapturer, helperPath, spawn: fakeHelper().spawn,
    webContentsFromFrame: frame => frame && { id: frame.owner } });
  assert.deepEqual(await view.arm(1, 'conversation-a', 10, 77), { ok: false, error: 'window_not_viewable' }, 'nothing observed yet');
  view.grant('conversation-a', 10, 77);
  assert.deepEqual(await view.arm(1, 'conversation-b', 10, 77), { ok: false, error: 'window_not_viewable' }, 'another conversation cannot watch it');
  assert.deepEqual(await view.arm(1, 'conversation-a', 10, 77), { ok: true, placement: 'desktop', sound: false }, 'the app is quiet until the sound switch is on');
  assert.deepEqual(desktopCapturer.calls[0].types, ['window'], 'windows only, never screens');

  const answers = [];
  view.handleDisplayMediaRequest({ frame: { owner: 2 }, videoRequested: true }, value => answers.push(value));
  assert.deepEqual(answers.pop(), {}, 'a page that did not arm gets nothing');
  view.handleDisplayMediaRequest({ frame: { owner: 1 }, videoRequested: true }, value => answers.push(value));
  assert.equal(answers.pop().video.id, 'window:77:0');
  view.handleDisplayMediaRequest({ frame: { owner: 1 }, videoRequested: true }, value => answers.push(value));
  assert.deepEqual(answers.pop(), {}, 'one arm is one capture');

  view.grant('conversation-a', 10, 99);
  assert.deepEqual(await view.arm(1, 'conversation-a', 10, 99), { ok: false, error: 'window_not_capturable' });

  view.grant('conversation-a', 11, 78);
  const [firstArm, secondArm] = await Promise.all([
    view.arm(1, 'conversation-a', 10, 77),
    view.arm(1, 'conversation-a', 11, 78)
  ]);
  assert.deepEqual(firstArm, { ok: false, error: 'capture_superseded' });
  assert.deepEqual(secondArm, { ok: true, placement: 'desktop', sound: false });
  assert.equal(view.canView('conversation-a', 10, 77), true);
  assert.equal(view.canView('conversation-a', 11, 78), true);
});

test('an app opened in a tab goes off the desktop ("tab only"), stays where the user puts it, and comes back when the tab closes', async () => {
  const helper = fakeHelper();
  const view = createComputerWindowView({ platform: 'darwin', desktopCapturer: capturer(), helperPath, spawn: helper.spawn, idleMs: 20 });
  assert.equal(view.capability().preference, 'tab', 'macOS default');
  assert.deepEqual(await view.openInTab('conversation-a', 10, 77), { placement: 'tab' });
  const ops = () => helper.spawned[0].requests.filter(request => request.op !== 'watch').map(request => [request.op, request.pid, request.windowId ?? request.muted]);
  assert.deepEqual(ops(), [['mute', 10, true], ['park', 10, 77]], 'quiet (sound switch off) and off the screens');
  assert.equal(view.isParked(10, 77), true);

  assert.deepEqual(await view.place('conversation-a', 10, 77, 'desktop', { activate: true }), { ok: true, placement: 'desktop' });
  const { id: _unparkId, ...unpark } = helper.spawned[0].requests.findLast(request => request.op === 'unpark');
  assert.deepEqual(unpark, { op: 'unpark', pid: 10, windowId: 77, activate: true });
  assert.equal(helper.spawned[0].requests.some(request => request.op === 'shield' && request.windows?.length > 0), false, 'on the desktop, the user can always operate the window directly');
  assert.deepEqual(await view.openInTab('conversation-a', 10, 77), { placement: 'desktop' }, 'the user\'s choice wins over the default');

  assert.deepEqual(await view.place('conversation-a', 10, 77, 'tab'), { ok: true, placement: 'tab' });
  await view.forget('conversation-a');
  assert.deepEqual(ops().slice(-2).sort(), [['mute', 10, false], ['unpark', 10, 77]].sort(), 'closing the tab gives the sound and the window back');
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(helper.spawned[0].stdin.writableEnded, true, 'the virtual display goes away once nothing needs it');
});

test('the 键鼠 switch gates whether the user may click and type inside the tab while never locking the window on the desktop', async () => {
  const helper = fakeHelper();
  const events = [];
  const view = createComputerWindowView({ platform: 'darwin', desktopCapturer: capturer(), helperPath, spawn: helper.spawn, onWindowEvent: event => events.push(event) });
  view.setPreference('desktop');
  await view.openInTab('conversation-a', 10, 77);
  const shields = () => helper.spawned[0].requests.filter(request => request.op === 'shield').map(({ windows, pids }) => ({ windows, pids }));
  assert.deepEqual(shields(), [], 'desktop windows are never locked');
  assert.deepEqual(view.setUserInput('conversation-a', 10, 77, true), { ok: true, on: true, locks: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.userInput(10, 77), true);
  assert.deepEqual(view.setUserInput('conversation-b', 10, 77, false), { ok: false, error: 'window_not_viewable' });
  view.setUserInput('conversation-a', 10, 77, false);
  assert.equal(view.userInput(10, 77), false);
  await view.place('conversation-a', 10, 77, 'tab');
  await view.place('conversation-a', 10, 77, 'desktop');
  assert.deepEqual(shields(), [], 'moving between tab and desktop never locks desktop windows');
  await view.pointer('conversation-a', 10, 77, { kind: 'click', x: 0.5, y: 0.5 });
  helper.spawned[0].stdout.write('{"type":"input-blocked","windowId":77,"pid":10}\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events.filter(event => event.type === 'input-blocked'), [{ type: 'input-blocked', conversationId: 'conversation-a', pid: 10, windowId: 77 }]);
  await view.forget('conversation-a');
});

test('a crashed helper is replaced and its mutes and parked windows are put back', async () => {
  const helper = fakeHelper();
  const view = createComputerWindowView({ platform: 'darwin', desktopCapturer: capturer(), helperPath, spawn: helper.spawn });
  await view.openInTab('conversation-a', 10, 77);
  await view.openInTab('conversation-a', 11, 88);
  await view.place('conversation-a', 11, 88, 'desktop');
  helper.spawned[0].emit('exit', 1);
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.equal(helper.spawned.length, 2, 'a new helper');
  const again = helper.spawned[1].requests.filter(request => request.op !== 'watch').map(request => [request.op, request.pid ?? request.windows, request.windowId ?? request.muted ?? request.pids]);
  assert.deepEqual(again, [['mute', 10, true], ['mute', 11, true], ['park', 10, 77]]);
  assert.equal(view.isParked(10, 77), true);
});

test('the sound switch: off mutes the app, on gives its sound back; an app stays muted while another tab keeps it so', async () => {
  const helper = fakeHelper();
  const view = createComputerWindowView({ platform: 'darwin', desktopCapturer: capturer(), helperPath, spawn: helper.spawn });
  view.setPreference('desktop');
  await view.openInTab('conversation-a', 10, 77);
  await view.openInTab('conversation-a', 10, 78);
  const mutes = () => helper.spawned[0].requests.filter(request => request.op === 'mute').map(request => request.muted);
  assert.deepEqual(mutes(), [true], 'one app, muted once');
  assert.deepEqual(await view.arm(1, 'conversation-a', 10, 77), { ok: true, placement: 'desktop', sound: false });
  assert.deepEqual(await view.setSound('conversation-a', 10, 77, true), { ok: true, sound: true });
  assert.deepEqual(mutes(), [true], 'the other window still keeps the app quiet');
  assert.deepEqual(await view.setSound('conversation-a', 10, 78, true), { ok: true, sound: true });
  assert.deepEqual(mutes(), [true, false]);
  assert.deepEqual(await view.setSound('conversation-a', 10, 77, false), { ok: true, sound: false });
  assert.deepEqual(mutes(), [true, false, true]);
  assert.deepEqual(await view.setSound('conversation-b', 10, 77, true), { ok: false, error: 'window_not_viewable' });
});

test('the mouse switch: only fractions of the tab\'s own window reach the helper', async () => {
  const helper = fakeHelper();
  const view = createComputerWindowView({ platform: 'darwin', desktopCapturer: capturer(), helperPath, spawn: helper.spawn });
  view.setPreference('desktop');
  await view.openInTab('conversation-a', 10, 77);
  assert.deepEqual(await view.pointer('conversation-a', 10, 77, { kind: 'click', x: 0.5, y: 0.25 }), { ok: true });
  assert.deepEqual(await view.pointer('conversation-a', 10, 77, { kind: 'scroll', x: 0.5, y: 0.5, direction: 'down', amount: 40 }), { ok: true });
  const pointers = helper.spawned[0].requests.filter(request => request.op === 'pointer');
  assert.ok(pointers.every(request => request.deadlineMs > Date.now()));
  assert.deepEqual(pointers.map(({ id: _id, deadlineMs: _deadline, ...request }) => request), [
    { op: 'pointer', delivery: 'semantic', scope: 'conversation-a', pid: 10, windowId: 77, kind: 'click', x: 0.5, y: 0.25 },
    { op: 'pointer', delivery: 'semantic', scope: 'conversation-a', pid: 10, windowId: 77, kind: 'scroll', x: 0.5, y: 0.5, direction: 'down', amount: 10 }]);
  assert.deepEqual(await view.pointer('conversation-a', 10, 77, { kind: 'click', x: 1.5, y: 0 }), { ok: false, error: 'computer_input_invalid' });
  assert.deepEqual(await view.pointer('conversation-a', 10, 77, { kind: 'rightClick', x: 0.5, y: 0.5 }), { ok: false, error: 'computer_input_invalid' });
  assert.deepEqual(await view.pointer('conversation-b', 10, 77, { kind: 'click', x: 0.5, y: 0.5 }), { ok: false, error: 'window_not_viewable' });
});

test('"also on desktop" never moves windows; Windows mirrors them, mutes in the mixer and brings one forward on request', async () => {
  const helper = fakeHelper();
  const mac = createComputerWindowView({ platform: 'darwin', desktopCapturer: capturer(), helperPath, spawn: helper.spawn });
  mac.setPreference('desktop');
  await mac.openInTab('conversation-a', 10, 77);
  assert.equal(helper.spawned[0].requests.some(request => request.op === 'park'), false);
  assert.equal(mac.setPreference('sideways').preference, 'desktop', 'unknown values are ignored');

  const calls = [];
  const execFile = (file, args, options, callback) => { calls.push({ file, args, options }); callback(null, '', ''); };
  const nativeCalls = [];
  const windowsServices = {
    ready: async () => ({}), capability: () => ({ lock: true, sound: true, ocr: true, ocrLanguages: ['en-US'] }),
    mute: async (...args) => { nativeCalls.push(args); return { ok: true }; }, shield: async () => ({ ok: true }),
    windowCapability: async () => ({ canPark: false, parkReason: 'foreground_input_required' }), dispose: async () => {}
  };
  const windows = createComputerWindowView({ platform: 'win32', desktopCapturer: capturer(), helperPath, spawn: helper.spawn, execFile, windowsServices });
  assert.deepEqual(windows.capability(), { live: true, park: false, pointer: true, sound: true, preference: 'desktop',
    lock: true, keyHold: true, chords: true, modifierKeys: true, pointerMove: true, ocr: true, ocrLanguages: ['en-US'], parkReason: 'foreground_input_required' });
  assert.deepEqual(await windows.openInTab('conversation-a', 10, 77), { placement: 'desktop', canPark: false, parkReason: 'foreground_input_required' });
  assert.deepEqual(nativeCalls, [[10, true]], 'persistent helper records the original mixer state');
  assert.deepEqual(await windows.place('conversation-a', 10, 77, 'tab'), { ok: false, error: 'park_unsupported', placement: 'desktop', canPark: false, parkReason: 'foreground_input_required' });
  assert.deepEqual(await windows.place('conversation-a', 10, 77, 'desktop', { activate: true }), { ok: true, placement: 'desktop' });
  assert.equal(helper.spawned.length, 1, 'no macOS display helper on Windows');
  assert.match(calls.at(-1).args.at(-1), /\[System\.IntPtr\]::new\(\[long\]77\)/);
  assert.equal(calls.at(-1).options.windowsHide, true);
  assert.deepEqual(await windows.place('conversation-a', 10, 1.5, 'desktop'), { ok: false, error: 'window_not_viewable' });
  await windows.dispose();
  assert.deepEqual(nativeCalls.at(-1), [10, false], 'quitting restores the original mute state');
  await mac.dispose();
});

for (const cleanup of ['forget', 'dispose']) {
  test(`macOS defaults to returning launched and existing apps to the desktop on ${cleanup}`, async t => {
    const helper = fakeHelper();
    const view = createComputerWindowView({ platform: 'darwin', desktopCapturer: capturer(), helperPath, spawn: helper.spawn });
    t.after(() => view.dispose());
    assert.equal(view.setCloseBehavior('invalid'), 'desktop', 'invalid values preserve the default desktop choice');
    await view.openInTab('conversation-a', 10, 77, { launched: true });
    await view.openInTab('conversation-a', 11, 78, { launched: false });
    await view[cleanup]('conversation-a');
    const requests = helper.spawned.flatMap(child => child.requests);
    assert.deepEqual(requests.filter(request => request.op === 'unpark').map(request => request.windowId).sort(), [77, 78]);
    assert.equal(requests.some(request => request.op === 'quit'), false, 'the default keeps even NextMux-launched apps running');
    if (cleanup === 'dispose') assert.equal(helper.spawned[0].stdin.writableEnded, true);
  });
}

test('macOS explicit quit waits for the last tab, returns the window before asking to quit, and preserves existing apps', async t => {
  const helper = fakeHelper();
  const view = createComputerWindowView({ platform: 'darwin', desktopCapturer: capturer(), helperPath, spawn: helper.spawn });
  t.after(() => view.dispose());
  assert.equal(view.setCloseBehavior('quit'), 'quit');
  const requests = () => helper.spawned.flatMap(child => child.requests);
  const quits = () => requests().filter(request => request.op === 'quit').map(request => request.pid).sort();
  await view.openInTab('conversation-a', 10, 77, { launched: true });
  await view.openInTab('conversation-a', 11, 78, { launched: false });
  await view.openInTab('conversation-b', 10, 79, { launched: true });
  await view.forget('conversation-a', 11, 78);
  assert.ok(requests().some(request => request.op === 'unpark' && request.pid === 11));
  await view.forget('conversation-a', 10, 77);
  assert.deepEqual(quits(), [], 'the user\'s own app and an app another tab still shows keep running');
  const before = requests().length;
  await view.forget('conversation-b', 10, 79);
  assert.deepEqual(quits(), [10], 'its last tab closed: the app receives normal quit');
  assert.deepEqual(requests().slice(before).filter(request => ['unpark', 'quit'].includes(request.op)).map(request => request.op),
    ['unpark', 'quit'], 'back on the desktop first, so a save question is visible');
});

test('macOS explicit quit on disposal returns every window before quitting only NextMux-launched apps', async () => {
  const helper = fakeHelper();
  const view = createComputerWindowView({ platform: 'darwin', desktopCapturer: capturer(), helperPath, spawn: helper.spawn });
  view.setCloseBehavior('quit');
  await view.openInTab('conversation-a', 20, 90, { launched: true });
  await view.openInTab('conversation-a', 21, 91, { launched: false });
  await view.dispose();
  const requests = helper.spawned.flatMap(child => child.requests);
  assert.deepEqual(requests.filter(request => request.op === 'quit').map(request => request.pid), [20]);
  assert.deepEqual(requests.filter(request => request.op === 'unpark').map(request => request.windowId).sort(), [90, 91]);
  assert.ok(requests.findLastIndex(request => request.op === 'unpark') < requests.findIndex(request => request.op === 'quit'),
    'all save dialogs can appear on the desktop before the helper exits');
  assert.equal(helper.spawned[0].stdin.writableEnded, true);
});

test('tabs.open_app finds the app\'s window and claims it; observing a desktop window no longer opens or parks anything', async () => {
  const { ComputerAutomation } = require('../computer-automation.cjs');
  const view = { calls: [], grant(...args) { this.calls.push(['grant', ...args]); }, dispose: async () => undefined };
  const client = {
    getApp: async name => ({ name: 'WeChat', getState: async () => ({ app: 'WeChat', window: '微信' }) }),
    listApps: async () => [{ name: 'Finder', pid: 5, running: true }, { name: 'WeChat', pid: 10, running: true, bundle_id: 'com.tencent.xinWeChat' }],
    listWindows: async ({ pid }) => pid === 10 ? [{ window_id: 90, layer: 3, bounds: { width: 20, height: 20 } }, { window_id: 77, title: '微信', is_app_target: true, layer: 0, bounds: { width: 900, height: 600 } }] : [],
    observeWindow: async () => ({ elements: [], text: '' }), close: async () => undefined };
  const engine = new ComputerAutomation({ platform: 'darwin', architecture: 'arm64', sdkLoader: async () => ({ create: async () => client }), view });
  engine.capability = () => ({ available: true });
  assert.deepEqual(await engine.openAppInTab('conversation-a', 1, 'WeChat'), { ok: true, pid: 10, windowId: 77, app: 'WeChat', title: '微信', appId: 'com.tencent.xinWeChat', launched: false });
  assert.deepEqual(await engine.openAppInTab('conversation-b', 2, 'WeChat'), { ok: false, error: 'computer_window_owned' }, 'one conversation\'s tab window');
  const result = await engine.run({ id: 'r1', conversationId: 'conversation-a', action: 'observeWindow', input: { pid: 5, windowId: 3 }, expiresAt: Date.now() + 60_000 }, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(view.calls, [], 'desktop control and tabs stay apart');
  await engine.dispose();
});

test('the AI\'s own tab control: a window picture from the system capture, and real keys for the tab\'s app only', async () => {
  const helper = fakeHelper();
  const image = { isEmpty: () => false, getSize: () => ({ width: 640, height: 400 }), toJPEG: quality => Buffer.from(`jpeg-${quality}`) };
  const desktopCapturer = { calls: [], async getSources(options) { this.calls.push(options); return [{ id: 'window:77:0', thumbnail: image }]; } };
  const view = createComputerWindowView({ platform: 'darwin', desktopCapturer, helperPath, spawn: helper.spawn });
  view.setPreference('desktop');
  assert.deepEqual(await view.snapshot('conversation-a', 10, 77), { ok: false, error: 'window_not_viewable' }, 'only a tab\'s own window');
  await view.openInTab('conversation-a', 10, 77);
  assert.deepEqual(await view.snapshot('conversation-a', 10, 77, 9999), { ok: true, mimeType: 'image/jpeg', data: Buffer.from('jpeg-82').toString('base64'), width: 640, height: 400 });
  assert.deepEqual(desktopCapturer.calls.at(-1).thumbnailSize, { width: 2048, height: 2048 }, 'size is bounded');
  assert.deepEqual(await view.keys('conversation-a', 10, 77, { key: 'w', modifiers: ['shift', 3], holdMs: 99_999 }), { ok: true });
  assert.deepEqual(await view.keys('conversation-a', 10, 77, { text: '你好 12*3' }), { ok: true });
  assert.deepEqual(await view.keys('conversation-a', 10, 77, {}), { ok: false, error: 'computer_input_invalid' });
  const keys = helper.spawned[0].requests.filter(request => request.op === 'keys').map(({ id: _id, deadlineMs: _deadline, ...request }) => request);
  assert.deepEqual(keys, [{ op: 'keys', delivery: 'semantic', scope: 'conversation-a', pid: 10, windowId: 77, key: 'w', modifiers: ['shift'], holdMs: 3000 }, { op: 'keys', delivery: 'semantic', scope: 'conversation-a', pid: 10, windowId: 77, text: '你好 12*3' }]);
});

test('windows an app in a tab opens later (a popped-out chat, a game its launcher starts) join the tabs, placed and muted like it', async () => {
  const helper = fakeHelper();
  const events = [];
  const view = createComputerWindowView({ platform: 'darwin', desktopCapturer: capturer(), helperPath, spawn: helper.spawn, onWindowEvent: event => events.push(event) });
  await view.openInTab('conversation-a', 10, 77);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(helper.spawned[0].requests.find(request => request.op === 'watch').roots, [10], 'the tab app is followed');
  // The launcher's game (pid 20) opens a window.
  helper.spawned[0].stdout.write(`${JSON.stringify({ type: 'window', root: 10, pid: 20, windowId: 88, title: 'Game', app: 'Game' })}\n`);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(events.at(-1), { type: 'window-added', conversationId: 'conversation-a', root: 10, pid: 20, windowId: 88, title: 'Game', app: 'Game', placement: 'tab' });
  assert.equal(view.isParked(20, 88), true, 'off the desktop like its launcher');
  assert.ok(helper.spawned[0].requests.some(request => request.op === 'mute' && request.pid === 20), 'quiet until its sound switch is on');
  assert.equal(view.canView('conversation-a', 20, 88), true);
  assert.equal(view.canView('conversation-b', 20, 88), false);
  helper.spawned[0].stdout.write(`${JSON.stringify({ type: 'window-closed', pid: 20, windowId: 88 })}\n`);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(events.at(-1), { type: 'window-closed', conversationId: 'conversation-a', pid: 20, windowId: 88 });
  await view.forget('conversation-a', 10, 77);
  assert.deepEqual(helper.spawned[0].requests.filter(request => request.op === 'watch').at(-1).roots, [], 'no longer followed once its tab is gone');
});

test('tab input retains validated fields but forces the semantic adapter (native rejects unsupported actions)', async t => {
  const helper = fakeHelper();
  const view = createComputerWindowView({ platform: 'darwin', helperPath, spawn: helper.spawn });
  t.after(() => view.dispose());
  view.grant('conversation-a', 10, 77);
  const drag = { kind: 'drag', from: { x: 0.1, y: 0.2 }, to: { x: 0.9, y: 0.8 }, durationMs: 2000 };
  assert.equal((await view.pointer('conversation-a', 10, 77, { kind: 'click', button: 'right', x: 0.3, y: 0.4 })).ok, true);
  assert.equal((await view.pointer('conversation-a', 10, 77, drag)).ok, true);
  for (const key of ['ctrl', 'alt', 'shift', 'cmd']) assert.equal((await view.keys('conversation-a', 10, 77, { key, holdMs: 0 })).ok, true);
  assert.equal((await view.keys('conversation-a', 10, 77, { keys: ['left', 'alt'], holdMs: 300 })).ok, true);
  assert.equal((await view.keys('conversation-a', 10, 77, { key: 'a' })).ok, true);
  const requests = helper.spawned[0].requests.filter(request => ['keys', 'pointer'].includes(request.op));
  assert.equal(requests[0].button, 'right');
  assert.deepEqual(requests[1].from, drag.from);
  assert.deepEqual(requests[1].to, drag.to);
  assert.equal(requests[1].durationMs, 2000);
  assert.ok(requests.slice(2, 6).every(request => request.holdMs === 0));
  assert.deepEqual(requests[6].keys, ['left', 'alt']);
  assert.equal(requests[6].holdMs, 300);
  assert.equal(requests[7].holdMs, 0);
  assert.ok(requests.every(request => request.delivery === 'semantic' && request.scope === 'conversation-a'));
  assert.ok(requests.every(request => Number.isSafeInteger(request.deadlineMs) && request.deadlineMs > Date.now()));
  for (const input of [{ keys: [] }, { keys: Array(5).fill('a') }, { keys: ['a', 1] }, { key: 'a', keys: ['b'] }, { text: 'x', keys: ['b'] }, { key: 'a', holdMs: NaN }]) {
    assert.equal((await view.keys('conversation-a', 10, 77, input)).error, 'computer_input_invalid');
  }
  for (const input of [{ ...drag, durationMs: 49 }, { ...drag, durationMs: 2001 }, { ...drag, to: { x: NaN, y: 0 } }, { ...drag, from: { x: -0.1, y: 0 } }, { kind: 'click', button: 'middle', x: 0, y: 0 }]) {
    assert.equal((await view.pointer('conversation-a', 10, 77, input)).error, 'computer_input_invalid');
  }
  assert.equal(helper.spawned[0].requests.filter(request => ['keys', 'pointer'].includes(request.op)).length, 8, 'invalid input never reaches the native helper');
});

test('partial key and mouse failures release the exact operation before another input can start', async t => {
  for (const op of ['keys', 'pointer']) await t.test(op, async t => {
    const held = new Map(), released = [], order = []; let calls = 0;
    const helper = fakeHelper({ onRequest(request, reply) {
      if (['keys', 'pointer', 'releaseInputs'].includes(request.op)) order.push(request.op);
      if (request.op === op && calls++ === 0) {
        held.set(request.id, op === 'keys' ? ['ctrl', 'left'] : ['mouse:left']);
        reply({ ok: false, error: 'injected_partial_input_failure' });
      } else if (request.op === 'releaseInputs') {
        released.push(...(held.get(request.targetId) || []).reverse()); held.delete(request.targetId);
        setTimeout(() => reply(), 10);
      } else reply();
    } });
    const view = createComputerWindowView({ platform: 'darwin', helperPath, spawn: helper.spawn });
    t.after(() => view.dispose());
    view.grant('conversation-a', 10, 77);
    const first = op === 'keys' ? view.keys('conversation-a', 10, 77, { keys: ['ctrl', 'left'] })
      : view.pointer('conversation-a', 10, 77, { kind: 'drag', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } });
    const next = view.keys('conversation-a', 10, 77, { key: 'a' });
    assert.equal((await first).error, 'injected_partial_input_failure');
    assert.equal((await next).ok, true);
    assert.equal(held.size, 0);
    assert.deepEqual(released, op === 'keys' ? ['left', 'ctrl'] : ['mouse:left']);
    assert.deepEqual(order.slice(0, 3), [op, 'releaseInputs', 'keys']);
  });
});

test('a timed-out helper releases held input and a late original reply cannot authorize another press', async t => {
  const held = new Map(), keepAlive = setTimeout(() => {}, 2000); let lateReply, count = 0;
  t.after(() => clearTimeout(keepAlive));
  const helper = fakeHelper({ onRequest(request, reply) {
    if (request.op === 'keys' && count++ === 0) { held.set(request.id, ['alt']); lateReply = reply; }
    else if (request.op === 'releaseInputs') { held.delete(request.targetId); reply(); }
    else reply();
  } });
  const view = createComputerWindowView({ platform: 'darwin', helperPath, spawn: helper.spawn, helperReplyMs: 25 });
  t.after(() => view.dispose()); view.grant('conversation-a', 10, 77);
  assert.equal((await view.keys('conversation-a', 10, 77, { key: 'alt', holdMs: 100 })).error, 'display_helper_timeout');
  assert.equal(held.size, 0);
  lateReply();
  assert.equal((await view.keys('conversation-a', 10, 77, { key: 'a' })).ok, true);
  assert.deepEqual(helper.spawned[0].requests.filter(request => ['keys', 'pointer', 'releaseInputs'].includes(request.op)).map(request => request.op), ['keys', 'releaseInputs', 'keys']);
});

test('an exited helper is replaced only to release the interrupted request before new input', async t => {
  const held = new Set(), order = [];
  const helper = fakeHelper({ onRequest(request, reply, child, spawned) {
    if (['keys', 'pointer', 'releaseInputs'].includes(request.op)) order.push(request.op);
    if (request.op === 'keys' && spawned.length === 1) { held.add('ctrl'); held.add('left'); child.emit('exit', 1); }
    else if (request.op === 'releaseInputs') {
      assert.equal(request.recovery, true);
      assert.deepEqual(request.input.keys, ['ctrl', 'left']);
      assert.equal(request.input.op, 'keys');
      held.clear(); reply();
    } else { assert.equal(held.size, 0); reply(); }
  } });
  const view = createComputerWindowView({ platform: 'darwin', helperPath, spawn: helper.spawn });
  t.after(() => view.dispose()); view.grant('conversation-a', 10, 77);
  const failed = view.keys('conversation-a', 10, 77, { keys: ['ctrl', 'left'] });
  const next = view.keys('conversation-a', 10, 77, { key: 'a' });
  assert.equal((await failed).error, 'display_helper_exited');
  assert.equal((await next).ok, true);
  assert.equal(held.size, 0);
  assert.equal(helper.spawned.length, 2);
  assert.deepEqual(order, ['keys', 'releaseInputs', 'keys']);
});

test('unconfirmed release blocks later input and closes stdin so native shutdown also cancels its input loop', async t => {
  const keepAlive = setTimeout(() => {}, 2000); t.after(() => clearTimeout(keepAlive));
  const helper = fakeHelper({ onRequest(request, reply) {
    if (request.op === 'keys') reply({ ok: false, error: 'injected_partial_input_failure' });
    else if (request.op !== 'releaseInputs') reply();
  } });
  const view = createComputerWindowView({ platform: 'darwin', helperPath, spawn: helper.spawn, helperReplyMs: 25 });
  t.after(() => view.dispose()); view.grant('conversation-a', 10, 77);
  assert.equal((await view.keys('conversation-a', 10, 77, { key: 'ctrl' })).error, 'input_cleanup_failed');
  assert.equal((await view.keys('conversation-a', 10, 77, { key: 'a' })).error, 'input_cleanup_failed');
  assert.deepEqual(helper.spawned[0].requests.filter(request => ['keys', 'pointer', 'releaseInputs'].includes(request.op)).map(request => request.op), ['keys', 'releaseInputs']);
  assert.equal(helper.spawned[0].stdin.writableEnded, true);
});

test('write throws and callback errors after a partial send still release the interrupted keys', async t => {
  for (const mode of ['throw', 'callback']) await t.test(mode, async t => {
    const held = new Set(); let failed = false;
    const helper = fakeHelper({ onRequest(request, reply) {
      if (request.op === 'keys' && !failed) held.add('shift');
      else if (request.op === 'releaseInputs') { held.clear(); reply(); }
      else reply();
    } });
    const spawn = (...args) => {
      const child = helper.spawn(...args), write = child.stdin.write.bind(child.stdin);
      child.stdin.write = (chunk, callback) => {
        const request = JSON.parse(chunk);
        if (request.op !== 'keys' || failed) return write(chunk, callback);
        write(chunk, () => {}); failed = true;
        if (mode === 'throw') throw new Error('injected_write_failure');
        queueMicrotask(() => callback(new Error('injected_write_failure')));
        return true;
      };
      return child;
    };
    const view = createComputerWindowView({ platform: 'darwin', helperPath, spawn });
    t.after(() => view.dispose()); view.grant('conversation-a', 10, 77);
    assert.equal((await view.keys('conversation-a', 10, 77, { key: 'shift' })).error, 'display_helper_write_failed');
    assert.equal(held.size, 0);
    assert.equal((await view.keys('conversation-a', 10, 77, { key: 'a' })).ok, true);
    assert.equal(helper.spawned[0].requests.filter(request => request.op === 'releaseInputs').length, 1);
  });
});

test('an earlier idle timer cannot interrupt a newly held key', async t => {
  const helper = fakeHelper({ onRequest(request, reply, child) {
    if (request.op === 'keys' && request.key === 'left') setTimeout(() => {
      assert.equal(child.stdin.writableEnded, false, 'helper stays alive through held input'); reply();
    }, 40);
    else reply();
  } });
  const view = createComputerWindowView({ platform: 'darwin', helperPath, spawn: helper.spawn, idleMs: 10 });
  t.after(() => view.dispose()); view.grant('conversation-a', 10, 77);
  await view.keys('conversation-a', 10, 77, { key: 'a' });
  await view.setSound('conversation-a', 10, 77, true);
  assert.equal((await view.keys('conversation-a', 10, 77, { key: 'left', holdMs: 40 })).ok, true);
  assert.equal(helper.spawned.length, 1);
});

test('closing a tab while its helper starts prevents the queued press', async t => {
  let releaseReady;
  const helper = fakeHelper();
  const spawn = (...args) => {
    const child = helper.spawn(...args), write = child.stdout.write.bind(child.stdout);
    child.stdout.write = chunk => {
      if (JSON.parse(chunk).type === 'ready') { releaseReady = () => write(chunk); return true; }
      return write(chunk);
    };
    return child;
  };
  const view = createComputerWindowView({ platform: 'darwin', helperPath, spawn });
  t.after(() => view.dispose()); view.grant('conversation-a', 10, 77);
  const pending = view.keys('conversation-a', 10, 77, { key: 'ctrl' });
  for (let attempts = 0; !releaseReady && attempts < 10; attempts++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof releaseReady, 'function');
  const forgetting = view.forget('conversation-a', 10, 77);
  releaseReady();
  assert.equal((await pending).error, 'window_not_viewable');
  await forgetting;
  assert.equal(helper.spawned[0].requests.some(request => request.op === 'keys'), false);
});

test('plugin cancellation releases a held key and suppresses already queued input', async t => {
  const controller = new AbortController();
  const held = new Set(); let started;
  const pressed = new Promise(resolve => { started = resolve; });
  const helper = fakeHelper({ onRequest(request, reply) {
    if (request.op === 'keys') { held.add(request.id); started(); }
    else if (request.op === 'releaseInputs') { held.delete(request.targetId); reply(); }
    else reply();
  } });
  const view = createComputerWindowView({ platform: 'darwin', helperPath, spawn: helper.spawn });
  t.after(() => view.dispose()); view.grant('conversation-a', 10, 77);
  const first = view.keys('conversation-a', 10, 77, { key: 'left', holdMs: 3000, signal: controller.signal });
  const next = view.keys('conversation-a', 10, 77, { key: 'right', signal: controller.signal });
  await pressed; controller.abort();
  assert.equal((await first).error, 'computer_input_cancelled');
  assert.equal((await next).error, 'computer_input_cancelled');
  assert.equal(held.size, 0);
  assert.deepEqual(helper.spawned[0].requests.filter(request => ['keys', 'releaseInputs'].includes(request.op)).map(request => request.op), ['keys', 'releaseInputs']);
});

test('every switch change is reported to the conversation showing the window, whoever made it', async () => {
  const helper = fakeHelper();
  const events = [];
  const view = createComputerWindowView({ platform: 'darwin', desktopCapturer: capturer(), helperPath, spawn: helper.spawn, onWindowEvent: event => events.push(event) });
  view.setPreference('desktop');
  await view.openInTab('conversation-a', 10, 77);
  const states = () => events.filter(event => event.type === 'state').map(({ sound, keyboardMouse, placement }) => ({ sound, keyboardMouse, placement }));
  await view.setSound('conversation-a', 10, 77, true);
  view.setUserInput('conversation-a', 10, 77, true);
  await view.place('conversation-a', 10, 77, 'desktop');
  assert.deepEqual(states(), [
    { sound: true, keyboardMouse: false, placement: 'desktop' },
    { sound: true, keyboardMouse: true, placement: 'desktop' },
    { sound: true, keyboardMouse: true, placement: 'desktop' }
  ]);
  assert.ok(events.filter(event => event.type === 'state').every(event => event.conversationId === 'conversation-a' && event.pid === 10 && event.windowId === 77));
  // The state a page reads when its tab view starts is the same record.
  assert.deepEqual((({ sound, keyboardMouse, placement }) => ({ sound, keyboardMouse, placement }))(view.windowState('conversation-a', 10, 77)), { sound: true, keyboardMouse: true, placement: 'desktop' });
});


test('private native frame and OCR stay inside the owned session and finish drains captures before cleanup', async t => {
  const { createIncognitoNativeRegistry } = require('../incognito-native.cjs');
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'nextmux-private-frame-test-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const id = randomUUID(), nonce = randomUUID(), owner = join(base, 'incognito-sessions-v1', `owner-${process.pid}-${nonce}`);
  const container = join(owner, id), workspaceRoot = join(container, 'workspace');
  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(join(owner, '.nextmux-incognito-owner.json'), JSON.stringify({ version: 1, kind: 'nextmux-incognito', pid: process.pid, nonce }));
  const incognito = createIncognitoNativeRegistry();
  assert.equal(incognito.register({ id, workspaceRoot }, 7), true);
  let frameReply, capturePath, ocrPath;
  const helper = fakeHelper({ onRequest(request, reply) {
    if (request.op === 'frame') {
      // The production macOS helper rejects paths outside this capture prefix.
      assert.ok(request.path.startsWith('/') && request.path.endsWith('.bgra')
        && request.path.includes('/nextmux-frames-') && !request.path.includes('..'));
      capturePath = request.path;
      frameReply = () => { writeFileSync(request.path, Buffer.alloc(16)); reply({ width: 2, height: 2, stride: 8 }); };
    }
    else if (request.op === 'ocr') { ocrPath = request.path; reply({ texts: ['secret'] }); }
    else reply();
  } });
  const view = createComputerWindowView({ platform: 'darwin', desktopCapturer: capturer(), helperPath, spawn: helper.spawn, incognito });
  t.after(() => view.dispose());
  view.grant(id, 10, 77);
  const pending = view.frame(id, 10, 77);
  while (!frameReply) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(capturePath, join(container, 'state', 'native', 'nextmux-frames-private', '77.bgra'));
  frameReply(); const frame = await pending;
  assert.equal(frame.ok, true);
  assert.deepEqual(await view.recognizeText(frame, [[0, 0, 1, 1]], ['en']), { ok: true, texts: ['secret'] });
  assert.equal(ocrPath, capturePath);
  frameReply = undefined;
  const lastCapture = view.frame(id, 10, 77);
  while (!frameReply) await new Promise(resolve => setTimeout(resolve, 5));
  let finished = false;
  const finish = incognito.finish([id], 7, async () => {}).then(value => { finished = value; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(finished, false);
  frameReply(); await lastCapture; await finish; assert.equal(finished, true);
  rmSync(container, { recursive: true });
  assert.equal((await view.frame(id, 10, 77)).error, 'incognito_session_closed');
  assert.equal((await view.recognizeText(frame, [[0, 0, 1, 1]])).error, 'incognito_session_closed');
  assert.equal(existsSync(container), false);
});

test('hiding NextMux windows returns sound immediately and dispose drains in-flight unmute before shutdown', async () => {
  const nativeCalls = [];
  let resolveUnmute;
  const windowsServices = {
    ready: async () => ({}),
    capability: () => ({ lock: true, sound: true, ocr: true, ocrLanguages: ['en-US'] }),
    mute: async (pid, muted) => {
      nativeCalls.push([pid, muted]);
      if (!muted && resolveUnmute === 'block') {
        await new Promise(resolve => { resolveUnmute = resolve; });
      }
      return { ok: true };
    },
    shield: async () => ({ ok: true }),
    windowCapability: async () => ({ canPark: false, parkReason: 'foreground_input_required' }),
    dispose: async () => { nativeCalls.push(['dispose']); }
  };
  const windows = createComputerWindowView({ platform: 'win32', desktopCapturer: capturer(), helperPath, windowsServices });
  await windows.openInTab('conversation-a', 10, 77);
  assert.deepEqual(nativeCalls, [[10, true]]);
  await windows.setWorkbenchVisible(false);
  assert.deepEqual(nativeCalls, [[10, true], [10, false]], 'hiding NextMux to tray immediately unmutes the app');
  await windows.setWorkbenchVisible(true);
  assert.deepEqual(nativeCalls, [[10, true], [10, false], [10, true]], 'showing NextMux again re-mutes tabs whose sound switch is still off');

  resolveUnmute = 'block';
  const forgetting = windows.forget('conversation-a');
  await new Promise(resolve => setImmediate(resolve));
  let disposed = false;
  const disposing = windows.dispose().then(() => { disposed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, false, 'dispose waits for in-flight unmute before tearing down services');
  resolveUnmute();
  await Promise.all([forgetting, disposing]);
  assert.equal(disposed, true);
  assert.deepEqual(nativeCalls.slice(-2), [[10, false], ['dispose']]);
});

test('Windows workbench hide restores parked windows and virtual desktops, reparks on show, and terminate ends the process', async () => {
  const ops = [];
  const windowsServices = {
    ready: async () => ({}),
    capability: () => ({ lock: true, sound: true, ocr: true, ocrLanguages: ['en-US'], canPark: true, parkReason: '' }),
    mute: async () => ({ ok: true }),
    shield: async () => ({ ok: true }),
    windowCapability: async () => ({ ok: true, canPark: true, parkReason: '' }),
    park: async (pid, windowId, group) => { ops.push(['park', pid, windowId, group]); return { ok: true, placement: 'tab' }; },
    unpark: async (pid, windowId, hostWindow, activate) => { ops.push(['unpark', pid, windowId, hostWindow, activate]); return { ok: true, placement: 'desktop' }; },
    restoreDesktops: async () => { ops.push(['restoreDesktops']); return { ok: true }; },
    terminateProcess: async (pid, windowId, audioPid) => { ops.push(['terminateProcess', pid, windowId, audioPid]); return { ok: true }; },
    call: async (op, payload) => { ops.push(['call', op, payload]); return { ok: true }; },
    dispose: async () => { ops.push(['dispose']); }
  };
  const view = createComputerWindowView({ platform: 'win32', desktopCapturer: capturer(), helperPath, windowsServices });
  await view.openInTab('conversation-a', 10, 77, { appPid: 2020 });
  assert.deepEqual(ops.filter(item => item[0] === 'park'), [['park', 10, 77, 'conversation-a:pid:10']]);

  ops.length = 0;
  await view.setWorkbenchVisible(false);
  assert.deepEqual(ops, [
    ['unpark', 10, 77, 0, false],
    ['restoreDesktops']
  ], 'hiding NextMux unparks parked windows to their original desktop and cleans up NextMux virtual desktops');

  ops.length = 0;
  await view.setWorkbenchVisible(true);
  assert.deepEqual(ops, [
    ['park', 10, 77, 'conversation-a:pid:10']
  ], 'showing NextMux again reparks windows whose tab placement is still tab-only');

  ops.length = 0;
  view.revokeCapture('conversation-a', 10, 77);
  const terminated = await view.terminate('conversation-a', 10, 77);
  assert.deepEqual(terminated, { ok: true });
  assert.deepEqual(ops, [
    ['terminateProcess', 10, 77, 2020],
    ['restoreDesktops']
  ], 'terminate succeeds after revokeCapture, terminates the process without flashing unpark to the user desktop, and cleans up virtual desktops');
  assert.equal(view.canView('conversation-a', 10, 77), false);
  await view.dispose();
});


for (const platform of ['darwin', 'win32']) {
  test(`${platform} workbench hide returns all parked windows and show restores only owned tab placements`, async t => {
    const helper = fakeHelper(), nativeOps = [], events = [];
    const view = createComputerWindowView({ platform, desktopCapturer: capturer(), helperPath, spawn: helper.spawn,
      onWindowEvent: event => events.push(event),
      windowsServices: platform === 'win32' ? {
        ready: async () => ({}), capability: () => ({ sound: false, lock: false, canPark: true }),
        windowCapability: async () => ({ canPark: true }), shield: async () => ({ ok: true }),
        park: async (pid, windowId) => { nativeOps.push({ op: 'park', pid, windowId }); return { ok: true }; },
        unpark: async (pid, windowId, _host, activate) => { nativeOps.push({ op: 'unpark', pid, windowId, activate }); return { ok: true }; },
        restoreDesktops: async () => { nativeOps.push({ op: 'restoreDesktops' }); return { ok: true }; },
        dispose: async () => undefined
      } : undefined
    });
    t.after(() => view.dispose());
    const operations = () => platform === 'darwin' ? helper.spawned.flatMap(child => child.requests) : nativeOps;
    for (const [pid, windowId] of [[10, 77], [11, 78], [12, 79], [13, 80]]) await view.openInTab('conversation-a', pid, windowId);
    const beforeHide = operations().length;
    await view.setWorkbenchVisible(false);
    const hiddenOps = operations().slice(beforeHide);
    assert.deepEqual(hiddenOps.filter(item => item.op === 'unpark').map(item => item.windowId).sort(), [77, 78, 79, 80]);
    assert.ok(hiddenOps.filter(item => item.op === 'unpark').every(item => item.activate === false));
    for (const [pid, windowId] of [[10, 77], [11, 78], [12, 79], [13, 80]]) assert.equal(view.isParked(pid, windowId), false);
    if (platform === 'win32') assert.equal(hiddenOps.at(-1).op, 'restoreDesktops');
    await view.place('conversation-a', 11, 78, 'desktop');
    view.revokeCapture('conversation-a', 12, 79);
    await view.forget('conversation-a', 13, 80);
    events.length = 0;
    const beforeShow = operations().length;
    await view.setWorkbenchVisible(true);
    assert.deepEqual(operations().slice(beforeShow).filter(item => item.op === 'park').map(item => item.windowId), [77],
      'desktop choice, revoked ownership and a forgotten tab cannot be re-parked');
    assert.equal(view.isParked(10, 77), true);
    assert.deepEqual(events.filter(event => event.type === 'state').map(event => [event.windowId, event.placement]), [[77, 'tab']],
      'the restored tab receives its updated placement');
    const afterShow = operations().length;
    await view.setWorkbenchVisible(true);
    assert.equal(operations().length, afterShow, 'repeating the same visibility leaves windows alone');
  });
}
