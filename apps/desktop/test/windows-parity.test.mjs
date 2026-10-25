import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { createWindowsInput, commandFor, MARKER } = require('../computer-input-windows.cjs');
const { createWindowsServices } = require('../computer-services-windows.cjs');
const { createWindowsApps } = require('../windows-apps.cjs');
const { createComputerWindowView } = require('../computer-window-view.cjs');
const { ComputerAutomation } = require('../computer-automation.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const target = { pid: 10, windowId: 77 };

function processFixture(handler, bootstrap = false) {
  const children = [], requests = [], files = [];
  function spawn(file, args, options) {
    files.push({ file, args, options });
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
    children.push(child); let buffer = '', booted = !bootstrap, exited = false;
    child.kill = () => { if (!exited) { exited = true; child.emit('exit', 1); child.emit('close', 1); } };
    child.stdin.on('finish', () => setImmediate(() => { if (!exited) { exited = true; child.emit('exit', 0); child.emit('close', 0); } }));
    child.stdin.on('data', chunk => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        if (!booted) { booted = true; setImmediate(() => child.stdout.write('{"ready":true}\n')); continue; }
        const request = JSON.parse(line); requests.push(request);
        const reply = value => child.stdout.write(`${JSON.stringify({ id: request.id, ok: true, ...value })}\n`);
        handler(request, reply, child, children);
      }
    });
    return child;
  }
  return { spawn, children, requests, files };
}

const nativeCaps = { lock: true, sound: true, ocr: true, ocrLanguages: ['en-US', 'zh-Hans-CN'] };
function serviceFixture(extra = () => undefined) {
  return processFixture((request, reply, child) => {
    if (extra(request, reply, child)) return;
    if (request.op === 'capability') reply({ capability: nativeCaps });
    else if (request.op === 'windowCapability') reply({ canPark: false, parkReason: 'foreground_input_required' });
    else reply();
  });
}

test('legacy command serialization (not an executable input route) preserves holds/chords/modifiers, Unicode, right click, scroll and drag', () => {
  assert.equal(MARKER, 0x4e4d5558);
  assert.deepEqual(commandFor('pressKey', { ...target, key: 'shift', holdMs: 200 }).keys, ['shift']);
  assert.deepEqual(commandFor('hotkey', { ...target, keys: ['left', 'a'], modifiers: ['ctrl'], holdMs: 300 }).keys, ['ctrl', 'left', 'a']);
  assert.equal(commandFor('pressKey', { ...target, key: 'a' }).holdMs, 0);
  assert.equal(commandFor('typeText', { ...target, text: '你好 😀\n' }).text, '你好 😀\n');
  assert.equal(commandFor('rightClick', { ...target, x: 4, y: 5 }).button, 'right');
  assert.equal(commandFor('doubleClick', { ...target, x: 4, y: 5 }).count, 2);
  for (const direction of ['up', 'down', 'left', 'right']) assert.equal(commandFor('scroll', { ...target, x: 0, y: 0, direction }).direction, direction);
  assert.equal(commandFor('drag', { ...target, fromX: 0, fromY: 0, toX: 15, toY: 20, button: 'right' }).button, 'right');
  for (const input of [{ ...target, key: 'a', holdMs: -1 }, { ...target, key: 'a', holdMs: 3001 }, { ...target, key: 'a', modifiers: ['bogus'] }, { pid: 0, windowId: 77, key: 'a' }]) assert.throws(() => commandFor('pressKey', input));
});

test('all legacy execute actions reject permanently without spawning or dispatching', async () => {
  const fake = processFixture(() => { throw Error('no legacy dispatch'); }, true);
  const input = createWindowsInput({ spawn: fake.spawn });
  for (const action of ['pressKey', 'hotkey', 'typeText', 'click', 'drag', 'scroll', 'release', 'unknown']) {
    await assert.rejects(input.execute(action, { ...target, key: 'a', text: 'xx', x: .5, y: .5 }), { code: 'background_unsupported' });
  }
  assert.equal(fake.children.length, 0); assert.equal(fake.requests.length, 0);
  await input.dispose();
});

test('posted input retains exact HWND and never emits global or release commands on helper failure', async () => {
  const fake = processFixture((request, reply, child, children) => {
    if (children.length === 1) setImmediate(() => child.kill()); else reply();
  }, true);
  const input = createWindowsInput({ spawn: fake.spawn });
  await assert.rejects(input.post({ ...target, kind: 'text', text: 'xx' }), { code: 'computer_input_helper_exited' });
  assert.equal(fake.requests.length, 1, 'an unconfirmed input is not automatically replayed');
  await input.post({ ...target, kind: 'key', key: 'Enter' });
  assert.deepEqual(fake.requests.map(x => [x.action, x.pid, x.windowId]), [['post',10,77],['post',10,77]]);
  await input.dispose();
});

test('aborted background request never starts helper or queues input', async () => {
  const fake = processFixture(() => {}, true); const input = createWindowsInput({ spawn: fake.spawn });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(input.post({ ...target, kind: 'text', text: 'xx', signal: controller.signal }), { name: 'AbortError' });
  assert.equal(fake.children.length, 0); await input.dispose();
});

test('Windows services report actual OCR languages, validate shields and forward blocked-input events', async () => {
  const events = [], fake = serviceFixture();
  const services = createWindowsServices({ spawn: fake.spawn, onEvent: item => events.push(item) });
  assert.equal(services.capability().lock, false);
  await services.ready(); assert.deepEqual(services.capability().ocrLanguages, nativeCaps.ocrLanguages);
  assert.equal((await services.shield({ windows: [target] })).ok, true);
  fake.children[0].stdout.write(`${JSON.stringify({ type: 'input-blocked', ...target })}\n`);
  assert.equal(events.length, 1);
  assert.equal((await services.shield({ windows: [{ pid: 0, windowId: 77 }] })).error, 'shield_request_invalid');
  assert.equal((await services.windowCapability(10, 77)).canPark, false);
  assert.equal((await services.mute(10, true)).ok, true);
  assert.equal((await services.mute(10, false)).ok, true);
  assert.equal((await services.mute(NaN, true)).error, 'sound_request_invalid');
  await services.dispose();
  assert.equal(fake.requests.at(-1).op, 'restore');
  assert.equal(existsSync(fake.files[0].args.at(-1)), false, 'helper sources cleaned after native restore/EOF');
});

test('Windows OCR uses private BGRA files, validates regions, and cleans them on success and failure', async () => {
  let framePath;
  const fake = serviceFixture((request, reply) => {
    if (request.op !== 'ocr') return;
    framePath = request.path; assert.deepEqual(readFileSync(framePath), Buffer.alloc(32, 127));
    reply({ texts: ['你好'], ocrLanguages: ['zh-Hans-CN'] }); return true;
  });
  const services = createWindowsServices({ spawn: fake.spawn });
  await services.ready();
  const frame = { width: 4, height: 2, stride: 16, data: Buffer.alloc(32, 127) };
  const reply = await services.recognizeText(frame, [[0, 0, 1, 1]], ['zh-Hans-CN']);
  assert.deepEqual(reply.texts, ['你好']); assert.equal(existsSync(framePath), false);
  assert.equal((await services.recognizeText(frame, [[0.8, 0, 0.5, 1]])).error, 'ocr_request_invalid');
  assert.equal((await services.recognizeText({ ...frame, data: Buffer.alloc(1) }, [[0, 0, 1, 1]])).error, 'ocr_request_invalid');
  await services.dispose();
});

test('service failure and timeout fail closed, kill hung helper, reject pending requests, and respawn cleanly', async () => {
  let killed = 0;
  const fake = processFixture((request, reply, child, children) => {
    const origKill = child.kill.bind(child);
    if (!child._wrappedKill) {
      child._wrappedKill = true;
      child.kill = () => { killed += 1; origKill(); };
    }
    if (children.length === 1) {
      if (request.op === 'capability') reply({ capability: nativeCaps });
      // Hang on subsequent requests in the first helper process
      return;
    }
    if (request.op === 'capability') reply({ capability: nativeCaps });
    else reply();
  });
  const services = createWindowsServices({ spawn: fake.spawn, callTimeoutMs: 15 });
  await services.ready();
  assert.equal(services.capability().lock, true);

  const [first, second] = await Promise.all([
    services.mute(10, true),
    services.windowCapability(10, 77),
  ]);
  assert.equal(first.error, 'windows_services_timeout');
  assert.equal(second.error, 'windows_services_timeout');
  assert.equal(fake.children[0].stdin.writableEnded, true);
  // This helper exits when its stdin closes, so its finally (hooks, audio) runs and nothing is killed.
  assert.equal(killed, 0, 'a helper that exits on stdin EOF is never killed');
  assert.equal(services.capability().lock, false, 'capabilities must reset when helper times out');

  // Next request respawns a fresh helper process and succeeds
  assert.equal((await services.mute(10, false)).ok, true);
  assert.equal(fake.children.length, 2);
  await services.dispose();
});

test('a helper stuck in a native call is killed after the grace period, and the next call uses a new helper', async () => {
  let killed = 0;
  const fake = processFixture((request, reply, child, children) => {
    if (children.length === 1 && !child._stuck) {
      child._stuck = true;
      // Stuck in a native call: it never reads stdin again, so EOF does not end it.
      child.stdin.removeAllListeners('finish');
      Object.assign(child, { exitCode: null, signalCode: null });
      const origKill = child.kill.bind(child);
      child.kill = () => { killed += 1; child.signalCode = 'SIGTERM'; origKill(); };
    }
    if (request.op === 'capability') reply({ capability: nativeCaps });
    else if (children.length > 1) reply();
  });
  const services = createWindowsServices({ spawn: fake.spawn, callTimeoutMs: 15, killGraceMs: 20 });
  await services.ready();
  assert.equal((await services.mute(10, true)).error, 'windows_services_timeout');
  assert.equal(killed, 0, 'the helper first gets the grace period to clean up');
  assert.equal((await services.mute(10, false)).ok, true, 'a new helper answers at once');
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(killed, 1);
  await services.dispose();
});

function appsFixture(records, snapshots) {
  const calls = []; let index = 0;
  const execFile = (_file, args, options, callback) => {
    const request = JSON.parse(options.env.NEXTMUX_WINDOWS_APPS_REQUEST); calls.push({ request, args });
    assert.ok(existsSync(args.at(-1))); // Copied out of asar; user data is never code.
    let result;
    if (request.action === 'discover') result = records;
    else if (request.action === 'windows') result = snapshots[Math.min(index++, snapshots.length - 1)];
    else result = { ok: true };
    callback(null, JSON.stringify(result));
  };
  return { execFile, calls };
}
const packaged = { name: '计算器', appId: 'Microsoft.Calculator_abc!App', packaged: true, executable: 'C:\\Apps\\Calculator.exe', logo: 'C:\\Apps\\logo.png' };
const desktop = { name: '记事本', appId: 'notepad', executable: 'C:\\Windows\\notepad.exe' };
const uwpWindow = { pid: 42, windowId: 77, title: '计算器', processes: [{ pid: 42, executable: 'C:\\Windows\\ApplicationFrameHost.exe' }, { pid: 52, executable: packaged.executable, appId: packaged.appId }] };

test('localized Start apps and AUMIDs open UWP content behind the correct top-level frame', async () => {
  const fake = appsFixture([packaged, desktop], [[], [uwpWindow]]);
  const apps = createWindowsApps({ execFile: fake.execFile, sleep: async () => {} });
  assert.equal((await apps.list())[0].name, '计算器');
  const opened = await apps.open('计算器');
  assert.equal(opened.pid, 42); assert.equal(opened.appPid, 52); assert.equal(opened.windowId, 77);
  assert.equal(opened.launched, true); assert.equal(opened.sharedHost, true);
  assert.deepEqual(fake.calls.find(item => item.request.action === 'launch').request, { action: 'launch', appId: packaged.appId, path: packaged.executable });
  assert.deepEqual(await apps.identify(42, 77), { program: 'Calculator', appId: packaged.appId });
  assert.ok(fake.calls.every(item => !existsSync(item.args.at(-1))), 'discovery temp files cleaned');
});

test('desktop apps reuse existing windows, ambiguous names never launch an arbitrary match', async () => {
  const row = { pid: 7, windowId: 8, processes: [{ pid: 7, executable: desktop.executable }] };
  const fake = appsFixture([desktop, { ...desktop, name: '记事本预览', appId: 'preview' }], [[row]]);
  const apps = createWindowsApps({ execFile: fake.execFile });
  assert.equal((await apps.open('notepad')).launched, false);
  await assert.rejects(apps.open('记事'), { code: 'computer_app_ambiguous' });
  assert.equal(fake.calls.some(item => item.request.action === 'launch'), false);
});

test('picker uses desktop exe icons and packaged manifest logos and returns the full AUMID', async () => {
  const fake = appsFixture([desktop, packaged], [[]]); const images = [], icon = { isEmpty: () => false, resize() { return this; }, toDataURL: () => 'data:icon' };
  const apps = createWindowsApps({ execFile: fake.execFile, app: { getFileIcon: async path => { images.push(path); return icon; } }, nativeImage: { createFromPath: path => { images.push(path); return icon; } } });
  const result = await apps.pick({ Menu: { buildFromTemplate: entries => ({ popup: options => { entries.find(entry => entry.label === '计算器').click(); options.callback(); } }) }, owner: {} });
  assert.equal(result.id, packaged.appId); assert.ok(images.includes(packaged.logo)); assert.ok(images.includes(desktop.executable));
});

test('Windows view connects captured plugin frames to OCR and never locks desktop windows', async () => {
  const events = []; const fake = serviceFixture((request, reply) => { if (request.op === 'ocr') { reply({ texts: ['text'] }); return true; } });
  const bytes = Buffer.alloc(16); const image = { isEmpty: () => false, getSize: () => ({ width: 2, height: 2 }), toBitmap: () => bytes };
  const view = createComputerWindowView({ platform: 'win32', spawn: fake.spawn, onWindowEvent: item => events.push(item), desktopCapturer: { getSources: async () => [{ id: 'window:77:0', thumbnail: image }] } });
  assert.equal((await view.ready()).lock, true);
  assert.equal((await view.openInTab('a', 10, 77)).canPark, false);
  assert.equal(fake.requests.some(item => item.op === 'shield' && item.windows?.length > 0), false);
  fake.children[0].stdout.write(`${JSON.stringify({ type: 'input-blocked', ...target })}\n`);
  assert.equal(events[0].conversationId, 'a');
  assert.equal((await view.frame('b', 10, 77)).error, 'window_not_viewable');
  const frame = await view.frame('a', 10, 77);
  assert.equal(frame.data, bytes); assert.deepEqual((await view.recognizeText(frame, [[0, 0, 1, 1]])).texts, ['text']);
  assert.equal((await view.setUserInput('a', 10, 77, true)).locks, false);
  await view.dispose();
});

test('multi-tab sound stays muted until its last holder, UWP uses content PID and closes only its frame', async () => {
  const fake = serviceFixture(); const view = createComputerWindowView({ platform: 'win32', spawn: fake.spawn });
  view.setCloseBehavior('desktop');
  await view.openInTab('a', 10, 77); await view.openInTab('b', 10, 78);
  assert.equal((await view.setSound('a', 10, 77, true)).sound, false, 'process still has another muted tab');
  assert.equal(fake.requests.filter(item => item.op === 'mute' && !item.muted).length, 0);
  await view.forget('b'); assert.equal(fake.requests.filter(item => item.op === 'mute' && !item.muted).length, 1);
  await view.openInTab('a', 42, 90, { appPid: 52, launched: true, sharedHost: true });
  assert.equal(fake.requests.filter(item => item.op === 'mute').at(-1).pid, 52);
  view.setCloseBehavior('quit'); await view.forget('a', 42, 90);
  assert.deepEqual(fake.requests.find(item => item.op === 'closeWindow').windowId, 90);
  assert.equal(fake.requests.some(item => item.op === 'mute' && item.pid === 42), false);
  await view.openInTab('c', 11, 80); // Restarted app has a new process/session lease.
  await view.dispose();
  assert.ok(fake.requests.some(item => item.op === 'mute' && item.pid === 11 && item.muted === false));
});

for (const family of ['app-root', 'WeGame']) {
  for (const launched of [false, true]) {
    for (const cleanup of ['forget', 'dispose']) {
      test(`Windows ${family} followed windows retain launched=${launched} on ${cleanup}`, async t => {
        t.mock.timers.enable({ apis: ['setInterval'] });
        const calls = [], events = [];
        const executable = family === 'WeGame' ? String.raw`C:\Program Files\WeGame\WeGame.exe` : String.raw`C:\Program Files\Editor\Editor.exe`;
        const childExecutable = family === 'WeGame' ? String.raw`D:\WeGameApps\League\Game.exe` : String.raw`D:\ChildTools\Editor\Child.exe`;
        // The unrelated existing app shares the conversation but never the launch ownership.
        const existingExecutable = String.raw`C:\Program Files\Viewer\Viewer.exe`;
        let rows = [
          { pid: 10, windowId: 77, executable },
          { pid: 30, windowId: 90, executable: existingExecutable }
        ];
        const view = createComputerWindowView({ platform: 'win32', onWindowEvent: event => events.push(event),
          execFile: () => { throw Error('window cleanup must never terminate the process'); },
          windowsServices: {
            ready: async () => ({}), capability: () => ({ sound: false, lock: false, canPark: true }),
            windowCapability: async () => ({ canPark: true }), shield: async () => ({ ok: true }),
            topWindows: async () => ({ ok: true, windows: rows }),
            park: async () => ({ ok: true }),
            unpark: async (pid, windowId) => { calls.push(['unpark', pid, windowId]); return { ok: true }; },
            call: async (op, { pid, windowId }) => { calls.push([op, pid, windowId]); return { ok: true }; },
            restoreDesktops: async () => { calls.push(['restoreDesktops']); return { ok: true }; },
            dispose: async () => undefined
          }
        });
        t.after(() => view.dispose());
        view.setCloseBehavior('quit');
        await view.openInTab('conversation-a', 10, 77, { launched, executables: [executable] });
        await tick();
        await view.openInTab('conversation-a', 30, 90, { launched: false, executables: [existingExecutable] });
        await tick();
        rows = [...rows,
          { pid: 20, windowId: 88, executable: childExecutable, ancestors: family === 'WeGame' ? [] : [executable] },
          { pid: 31, windowId: 91, executable: String.raw`C:\Program Files\Viewer\Child.exe` }
        ];
        t.mock.timers.tick(1000);
        await tick();
        for (const [pid, windowId] of [[20, 88], [31, 91]]) {
          assert.equal(view.canView('conversation-a', pid, windowId), true, `polling attaches matching newly appeared window ${windowId}`);
          assert.equal(view.isParked(pid, windowId), true);
          assert.ok(events.some(event => event.type === 'window-added' && event.windowId === windowId));
        }
        await view[cleanup]('conversation-a');
        assert.deepEqual(calls.filter(([op]) => op === 'unpark').map(([, , windowId]) => windowId).sort(), [77, 88, 90, 91]);
        const closes = calls.filter(([op]) => op === 'closeWindow');
        assert.deepEqual(closes.map(([, , windowId]) => windowId).sort(), launched ? [77, 88] : [],
          'only this launched root and its followed window close; existing roots and their followed windows stay running');
        for (const [, pid, windowId] of closes) {
          assert.ok(calls.findIndex(([op, p, w]) => op === 'unpark' && p === pid && w === windowId)
            < calls.findIndex(([op, p, w]) => op === 'closeWindow' && p === pid && w === windowId), 'unpark precedes normal close');
        }
      });
    }
  }
}

test('a second conversation cannot steal the first conversation window or mute lease', async () => {
  const fake = serviceFixture(); const view = createComputerWindowView({ platform: 'win32', spawn: fake.spawn });
  await view.openInTab('a', 10, 77); assert.equal((await view.openInTab('b', 10, 77)).error, 'computer_window_owned');
  await view.forget('b'); assert.equal(fake.requests.some(item => item.op === 'mute' && !item.muted), false);
  await view.forget('a'); assert.equal(fake.requests.some(item => item.op === 'mute' && !item.muted), true);
  await view.dispose();
});

test('conversation release aborts and drains the admitted background request before releasing ownership', async () => {
  let started, released = false;
  const windowsInput = { post: input => new Promise((resolve, reject) => {
    started = true; input.signal.addEventListener('abort', () => setImmediate(() => { released = true; reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })); }));
  }), execute: () => { throw Error('global input must not run'); }, dispose: async () => {} };
  const engine = new ComputerAutomation({ platform: 'win32', architecture: 'x64', windowsInput, sdkLoader: async () => ({ create: async () => ({ close: async () => {} }) }) });
  const action = engine.userKeys('a', 1, { ...target, key: 'a' });
  while (!started) await tick(); await engine.release('a', 1);
  assert.equal(released, true); assert.equal((await action).error, 'cancelled'); await engine.dispose();
});

test('installed app catalog retains running PIDs and adds unregistered running desktop apps', async () => {
  const extra = { pid: 70, windowId: 80, processes: [{ pid: 70, executable: 'C:\\Tools\\portable.exe' }] };
  const fake = appsFixture([packaged], [[uwpWindow, extra]]);
  const rows = await createWindowsApps({ execFile: fake.execFile }).listApps();
  assert.equal(rows[0].running, true); assert.equal(rows[0].pid, 42);
  assert.equal(rows[1].name, 'portable'); assert.equal(rows[1].pid, 70);
});

test('PowerShell discovery errors and malformed replies never become an empty successful catalog', async () => {
  const broken = createWindowsApps({ execFile: (_file, _args, _options, callback) => callback(new Error('failed')) });
  await assert.rejects(broken.list(), { code: 'windows_app_query_failed' });
  const malformed = createWindowsApps({ execFile: (_file, _args, _options, callback) => callback(null, 'bad json') });
  await assert.rejects(malformed.list(), { code: 'windows_app_reply_invalid' });
});

test('shortcut opening resolves its target identity and preserves shortcut arguments during launch', async () => {
  const calls = [];
  const shortcut = 'C:\\Users\\Test\\桌面\\Editor.lnk';
  const executable = 'C:\\Tools\\editor.exe';
  let windows = 0;
  const apps = createWindowsApps({ sleep: async () => {}, execFile: (_file, _args, options, callback) => {
    const request = JSON.parse(options.env.NEXTMUX_WINDOWS_APPS_REQUEST); calls.push(request);
    callback(null, JSON.stringify(request.action === 'discover' ? [] : request.action === 'resolveShortcut' ? { executable }
      : request.action === 'windows' ? windows++ ? [{ pid: 7, windowId: 8, processes: [{ pid: 7, executable }] }] : [] : { ok: true }));
  } });
  const opened = await apps.open(shortcut);
  assert.equal(opened.pid, 7); assert.equal(calls.find(item => item.action === 'launch').path, shortcut);
});

test('OCR native errors retain installed languages and remove the failed frame', async () => {
  let path;
  const fake = serviceFixture((request, reply) => {
    if (request.op !== 'ocr') return;
    path = request.path; reply({ ok: false, error: 'ocr_language_unavailable', ocrLanguages: ['en-US'] }); return true;
  });
  const services = createWindowsServices({ spawn: fake.spawn });
  const result = await services.recognizeText({ width: 1, height: 1, data: Buffer.alloc(4) }, [[0, 0, 1, 1]], ['zh-Hans-CN']);
  assert.equal(result.error, 'ocr_language_unavailable'); assert.deepEqual(result.ocrLanguages, ['en-US']); assert.equal(existsSync(path), false);
  await services.dispose();
});

test('Windows helpers are included in the production app and never depend on asar-visible paths in PowerShell', () => {
  const pkg = require('../package.json');
  for (const file of ['computer-input-windows.cjs', 'computer-input-windows.cs', 'computer-services-windows.cjs', 'computer-services-windows.cs',
    'computer-services-windows.ps1', 'computer-audio-windows.cs', 'windows-apps.cjs', 'windows-apps.ps1', 'windows-apps-native.cs']) assert.ok(pkg.build.files.includes(file), file);
});

test('post timeout is bounded and late acknowledgements cannot replay an unknown action', async () => {
  let acknowledge;
  const fake = processFixture((_request, reply) => { acknowledge = reply; }, true);
  const input = createWindowsInput({ spawn: fake.spawn, timeoutMs: 20 });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(input.post({ ...target, kind: 'text', text: 'xx' }), { code: 'computer_input_timeout' });
    acknowledge(); await tick();
    assert.deepEqual(fake.requests.map(item => item.action), ['post', 'cancel']);
  } finally { clearTimeout(keepAlive); await input.dispose(); }
});

test('helper input errors stay stable and never trigger foreground fallback', async () => {
  const fake = processFixture((_request, reply) => reply({ ok: false, error: 'background_target_unavailable' }), true);
  const input = createWindowsInput({ spawn: fake.spawn });
  await assert.rejects(input.post({ ...target, kind: 'text', text: 'xx' }), { code: 'background_target_unavailable' });
  assert.equal(fake.requests.length, 1); assert.equal(fake.requests[0].action, 'post');
  await input.dispose();
});
