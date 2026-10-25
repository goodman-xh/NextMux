import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createWindowsApps } = require('../windows-apps.cjs');
const record = { name: 'Editor', appId: 'editor', executable: 'C:\\Tools\\editor.exe' };
const window = { pid: 7, windowId: 11, processes: [{ pid: 7, executable: record.executable }] };

function fixture(records = [record]) {
  const calls = [];
  return { calls, apps: createWindowsApps({ sleep: async () => {}, execFile: (_file, _args, options, callback) => {
    const request = JSON.parse(options.env.NEXTMUX_WINDOWS_APPS_REQUEST); calls.push(request);
    callback(null, JSON.stringify(request.action === 'discover' ? records : request.action === 'windows' ? [window] : { ok: true }));
  } }) };
}

test('an extension-only selector never becomes an empty fuzzy match for an installed app', async () => {
  const { apps, calls } = fixture();
  for (const selector of ['.exe', ' .EXE ']) await assert.rejects(apps.open(selector), { code: 'computer_app_required' });
  assert.equal(calls.some(call => call.action === 'windows' || call.action === 'launch'), false);
});

test('an aborted catalog read rejects even when the installed-app catalog is cached', async () => {
  const { apps, calls } = fixture();
  await apps.list();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(apps.list({ signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls.length, 1);
});

test('uppercase executable extensions still resolve a program without an extension', async () => {
  const { apps } = fixture([{ ...record, executable: 'C:\\Tools\\EDITOR.EXE' }]);
  assert.equal((await apps.open('EDITOR')).windowId, 11);
});

test('unregistered executables cannot claim windows through matching empty application IDs', async () => {
  const { apps } = fixture([]);
  await assert.rejects(apps.open('C:\\Tools\\different.exe'), { code: 'app_window_unavailable' });
});

test('a window another conversation owns is never reused: a second conversation gets a new instance', async () => {
  const second = { pid: 9, windowId: 21, width: 800, height: 600, processes: [{ pid: 9, executable: record.executable }] };
  let launched = false; const calls = [];
  const apps = createWindowsApps({ sleep: async () => {}, execFile: (_file, _args, options, callback) => {
    const request = JSON.parse(options.env.NEXTMUX_WINDOWS_APPS_REQUEST); calls.push(request.action);
    if (request.action === 'launch') launched = true;
    callback(null, JSON.stringify(request.action === 'discover' ? [record] : request.action === 'windows' ? (launched ? [window, second] : [window]) : { ok: true }));
  } });
  const opened = await apps.open('Editor', { taken: (pid, windowId) => pid === 7 && windowId === 11 });
  assert.equal(opened.windowId, 21); assert.equal(opened.launched, true); assert.ok(calls.includes('launch'));
  // Without an owner the existing window is still reused (no extra instance).
  assert.equal((await apps.open('Editor')).windowId, 11);
});

test('a single-instance app whose only window another conversation owns reports computer_window_owned', async () => {
  const { apps } = fixture();
  await assert.rejects(apps.open('Editor', { taken: () => true }), { code: 'computer_window_owned' });
});

test('concurrent catalog readers share discovery and receive independent record copies', async () => {
  let calls = 0, complete;
  const apps = createWindowsApps({ execFile: (_file, _args, _options, callback) => { calls++; complete = callback; } });
  const first = apps.list(), second = apps.list();
  complete(null, JSON.stringify([record]));
  const [one, two] = await Promise.all([first, second]);
  assert.equal(calls, 1); one[0].name = 'Mutated';
  assert.equal(two[0].name, 'Editor'); assert.equal((await apps.list())[0].name, 'Editor');
});

test('failed catalog discovery clears its in-flight promise for later retries', async () => {
  let calls = 0;
  const apps = createWindowsApps({ execFile: (_file, _args, _options, callback) => {
    if (++calls === 1) callback(new Error('failed discovery'));
    else callback(null, JSON.stringify([record]));
  } });
  await assert.rejects(apps.list(), { code: 'windows_app_query_failed' });
  assert.equal((await apps.list()).length, 1); assert.equal(calls, 2);
});

test('packaged applications sharing an executable match the exact child AUMID', async () => {
  const app = { ...record, packaged: true, appId: 'Example.Family!Selected' };
  const wrong = { pid: 41, windowId: 51, processes: [{ pid: 41, executable: 'C:\\Windows\\ApplicationFrameHost.exe' },
    { pid: 61, executable: record.executable, appId: 'Example.Family!Other' }] };
  const right = { pid: 42, windowId: 52, processes: [{ pid: 42, executable: 'C:\\Windows\\ApplicationFrameHost.exe' },
    { pid: 62, executable: record.executable, appId: app.appId }] };
  const apps = createWindowsApps({ execFile: (_file, _args, options, callback) => {
    const request = JSON.parse(options.env.NEXTMUX_WINDOWS_APPS_REQUEST);
    callback(null, JSON.stringify(request.action === 'discover' ? [app] : [wrong, right]));
  } });
  const result = await apps.open(app.appId);
  assert.deepEqual([result.pid, result.appPid, result.windowId, result.sharedHost, result.launched], [42, 62, 52, true, false]);
});

test('opening an app retains the first native window identity instead of selecting another implicitly', async () => {
  const calls = [];
  const apps = createWindowsApps({ execFile: (_file, _args, options, callback) => {
    const request = JSON.parse(options.env.NEXTMUX_WINDOWS_APPS_REQUEST); calls.push(request);
    callback(null, JSON.stringify(request.action === 'discover' ? [record] : [window, { ...window, windowId: 12 }]));
  } });
  assert.equal((await apps.open(record.appId)).windowId, 11);
  assert.equal(calls.some(call => call.action === 'launch'), false);
});

test('uncertain shell launch failure is not retried or converted to a second activation', async () => {
  const calls = [];
  const apps = createWindowsApps({ execFile: (_file, _args, options, callback) => {
    const request = JSON.parse(options.env.NEXTMUX_WINDOWS_APPS_REQUEST); calls.push(request);
    if (request.action === 'launch') callback(new Error('completion unknown'));
    else callback(null, JSON.stringify(request.action === 'discover' ? [record] : []));
  } });
  await assert.rejects(apps.open(record.appId), { code: 'windows_app_query_failed' });
  assert.deepEqual(calls.map(call => call.action), ['discover', 'windows', 'launch']);
});

test('a successful activation with no matching window only polls and never launches twice', async () => {
  const calls = []; let polls = 0;
  const apps = createWindowsApps({ sleep: async () => { polls++; }, execFile: (_file, _args, options, callback) => {
    const request = JSON.parse(options.env.NEXTMUX_WINDOWS_APPS_REQUEST); calls.push(request);
    callback(null, JSON.stringify(request.action === 'discover' ? [record] : request.action === 'windows' ? [] : { ok: true }));
  } });
  await assert.rejects(apps.open(record.appId), { code: 'app_window_unavailable' });
  assert.equal(calls.filter(call => call.action === 'launch').length, 1);
  assert.equal(polls, 40);
});

test('resolving an absolute shortcut preserves the shortcut activation and leaves catalog records unchanged', async () => {
  const shortcut = { name: 'Shortcut', appId: 'shortcut-id', executable: '', shortcut: 'C:\\Links\\Editor.lnk' };
  const calls = []; let snapshots = 0;
  const apps = createWindowsApps({ execFile: (_file, _args, options, callback) => {
    const request = JSON.parse(options.env.NEXTMUX_WINDOWS_APPS_REQUEST); calls.push(request);
    callback(null, JSON.stringify(request.action === 'discover' ? [shortcut]
      : request.action === 'resolveShortcut' ? { executable: record.executable }
        : request.action === 'windows' ? snapshots++ ? [window] : [] : { ok: true }));
  } });
  assert.equal((await apps.open(shortcut.shortcut)).pid, 7);
  assert.equal(calls.find(call => call.action === 'launch').path, shortcut.shortcut);
  assert.equal((await apps.list())[0].executable, '');
});

test('absolute program paths fail closed when discovery fails instead of bypassing catalog checks', async () => {
  const actions = [];
  const apps = createWindowsApps({ execFile: (_file, _args, options, callback) => {
    actions.push(JSON.parse(options.env.NEXTMUX_WINDOWS_APPS_REQUEST).action); callback(new Error('discovery unavailable'));
  } });
  for (const path of ['C:\\Tools\\editor.exe', 'C:\\Links\\Editor.lnk']) await assert.rejects(apps.open(path), { code: 'windows_app_query_failed' });
  assert.deepEqual(actions, ['discover', 'discover']);
});

test('Program Files apps and WeGameLauncher companions resolve to child UI processes like WeGame browser.exe', async () => {
  const wegame = { name: 'WeGame', appId: '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}\\WeGame\\wegame.exe', executable: 'C:\\Program Files (x86)\\WeGame\\wegame.exe' };
  const lolLauncher = { name: '英雄联盟WeGame版', appId: 'C:\\WeGameApps\\英雄联盟\\WeGameLauncher\\launcher.exe', executable: 'C:\\WeGameApps\\英雄联盟\\WeGameLauncher\\launcher.exe' };
  const wegameUiWindow = {
    pid: 22800,
    windowId: 1116698,
    title: 'WeGame',
    processes: [{ pid: 22800, executable: 'C:\\Program Files (x86)\\WeGame\\qbblinktrial\\browser.exe', appId: '' }]
  };
  const cuaDriverWindow = {
    pid: 9999,
    windowId: 8888,
    title: 'qwen-cua-driver',
    processes: [{ pid: 9999, executable: 'C:\\Users\\49674\\AppData\\Local\\Programs\\NextMux\\resources\\computer-runtime\\win32-x64\\qwen-cua-driver.exe', appId: '' }]
  };
  const apps = createWindowsApps({
    sleep: async () => {},
    execFile: (_file, _args, options, callback) => {
      const request = JSON.parse(options.env.NEXTMUX_WINDOWS_APPS_REQUEST);
      callback(null, JSON.stringify(request.action === 'discover' ? [wegame, lolLauncher]
        : request.action === 'windows' ? [wegameUiWindow, cuaDriverWindow] : { ok: true }));
    }
  });
  const openedWeGame = await apps.open('WeGame');
  assert.equal(openedWeGame.pid, 22800);
  assert.equal(openedWeGame.windowId, 1116698);
  assert.equal(openedWeGame.launched, false);
  const openedLol = await apps.open('英雄联盟WeGame版');
  assert.equal(openedLol.pid, 22800);
  assert.equal(openedLol.windowId, 1116698);
  const catalog = await apps.listApps();
  assert.equal(catalog.some(item => /qwen-cua-driver/i.test(item.name)), false);
});

test('a freshly launched app binds its settled main window, not a splash that closes within seconds', async () => {
  const app = { name: 'WeGame', appId: 'wegame-id', executable: 'C:\\Program Files (x86)\\WeGame\\wegame.exe' };
  const ui = 'C:\\Program Files (x86)\\WeGame\\qbblinktrial\\browser.exe';
  const splash = { pid: 2068, windowId: 854782, title: 'WeGame', width: 480, height: 300, processes: [{ pid: 2068, executable: ui }] };
  const main = { pid: 11204, windowId: 4784364, title: 'WeGame', width: 1600, height: 899, processes: [{ pid: 11204, executable: ui }] };
  // Nothing before launch, the splash alone for a few polls, then splash + main, then main only.
  const frames = [[], [splash], [splash], [splash], [splash, main], [main]];
  let index = 0;
  const apps = createWindowsApps({ sleep: async () => {}, execFile: (_file, _args, options, callback) => {
    const request = JSON.parse(options.env.NEXTMUX_WINDOWS_APPS_REQUEST);
    callback(null, JSON.stringify(request.action === 'discover' ? [app]
      : request.action === 'windows' ? frames[Math.min(index++, frames.length - 1)] : { ok: true }));
  } });
  const opened = await apps.open('WeGame');
  assert.deepEqual([opened.pid, opened.windowId, opened.launched], [11204, 4784364, true]);
});

