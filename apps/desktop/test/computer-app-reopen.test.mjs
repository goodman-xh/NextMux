import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const { ComputerAutomation, registerComputerAutomation } = require('../computer-automation.cjs');
const { createWindowsApps } = require('../windows-apps.cjs');

function macFixture(t, options = {}) {
  let alive = options.running !== false, pid = 101;
  const calls = [], app = { name: 'Editor', bundle_id: 'test.editor', launch_path: '/Applications/Editor.app' };
  const engine = new ComputerAutomation({ platform: 'darwin', killProcess: (target, signal) => {
    calls.push(['kill', target, signal]);
    if (!alive || target !== pid) throw Object.assign(Error('exited'), { code: 'ESRCH' });
    if (signal === 'SIGTERM') {
      if (options.killDenied) throw Object.assign(Error('denied'), { code: 'EPERM' });
      alive = false;
    }
    return true;
  }, sdkLoader: async () => ({ create: async () => ({
    listApps: async () => [{ ...app, running: alive, ...(alive ? { pid } : {}) }],
    getApp: async selector => ({ name: app.name, getState: async () => {
      calls.push(['open', selector]); if (!alive) { pid++; alive = true; } return {};
    } }),
    listWindows: async () => [{ window_id: 202, title: 'Editor', is_app_target: true, bounds: { width: 900, height: 700 } }],
    close: async () => {}
  }) }), view: options.view });
  t.after(() => engine.dispose());
  return { engine, calls };
}

test('macOS probe and check-or-open detect a running app without launching, claiming, or killing it', async t => {
  const { engine, calls } = macFixture(t);
  for (const options of [{ probeOnly: true }, { checkOrOpen: true }]) {
    const result = await engine.openAppInTab('a', 1, 'Editor', options);
    assert.equal(result.ok, true); assert.equal(result.running, true);
    assert.equal(result.requiresRestart, options.checkOrOpen ? true : undefined);
  }
  assert.deepEqual(calls, []); assert.equal(engine.windows.size, 0);
});

test('macOS a stopped app opens directly only in check-or-open mode; probe stays read-only', async t => {
  const { engine, calls } = macFixture(t, { running: false });
  assert.equal((await engine.openAppInTab('a', 1, 'Editor', { probeOnly: true })).running, false);
  assert.deepEqual(calls, []);
  const result = await engine.openAppInTab('a', 1, 'Editor', { checkOrOpen: true });
  assert.equal(result.ok, true); assert.equal(result.pid, 102); assert.equal(result.launched, true);
  assert.equal(calls.filter(([kind]) => kind === 'kill').length, 0);
  assert.equal(engine.windows.get('102:202'), 'a');
});

test('macOS confirmed restart verifies process exit before launching and uses the new process', async t => {
  const { engine, calls } = macFixture(t);
  const result = await engine.openAppInTab('a', 1, 'Editor', { restartIfRunning: true });
  assert.equal(result.ok, true); assert.equal(result.pid, 102); assert.equal(result.launched, true);
  assert.deepEqual(calls, [['kill', 101, 'SIGTERM'], ['kill', 101, 0], ['open', '/Applications/Editor.app']]);
});

test('restart denial never launches another copy or claims a window', async t => {
  const { engine, calls } = macFixture(t, { killDenied: true });
  assert.equal((await engine.openAppInTab('a', 1, 'Editor', { restartIfRunning: true })).error, 'computer_app_restart_failed');
  assert.equal(calls.some(([kind]) => kind === 'open'), false);
  assert.equal(engine.windows.size, 0);
});

test('restart refuses a process retained by another conversation even after its native session was released', async t => {
  const { engine, calls } = macFixture(t, { view: { windowsForProcess: () => [{ conversationId: 'b', pid: 101, windowId: 999 }] } });
  assert.equal((await engine.openAppInTab('a', 1, 'Editor', { restartIfRunning: true })).error, 'computer_window_owned');
  assert.deepEqual(calls, []);
});

test('restart refuses another engine owner or a NextMux process before termination', async t => {
  const { engine, calls } = macFixture(t);
  engine.windows.set('101:999', 'b');
  assert.equal((await engine.openAppInTab('a', 1, 'Editor', { restartIfRunning: true })).error, 'computer_window_owned');
  engine.windows.clear(); engine.isBuiltinProcess = () => true;
  assert.equal((await engine.openAppInTab('a', 1, 'Editor', { restartIfRunning: true })).error, 'computer_builtin_surface_requires_browser');
  assert.deepEqual(calls, []);
});

const record = { name: 'Editor', appId: 'editor', executable: 'C:\\Tools\\editor.exe' };
const row = { pid: 301, windowId: 401, width: 900, height: 700, processes: [{ pid: 301, executable: record.executable }] };
function windowsFixture({ running = true, packaged = false, trayOnly = false, unrelatedProcess = false } = {}) {
  const calls = [];
  const app = packaged ? { ...record, packaged: true, appId: 'Editor.Family!App' } : record;
  const target = packaged ? { ...row, processes: [{ pid: 301, executable: 'C:\\Windows\\ApplicationFrameHost.exe' }, { pid: 302, executable: record.executable, appId: app.appId }] } : row;
  const apps = createWindowsApps({ sleep: async () => {}, execFile: (_file, _args, options, callback) => {
    const request = JSON.parse(options.env.NEXTMUX_WINDOWS_APPS_REQUEST); calls.push(request.action);
    if (request.action === 'launch') { running = true; trayOnly = false; }
    const processRows = unrelatedProcess ? [{ pid: 999, executable: 'C:\\Tools\\other.exe' }] : running ? [target.processes.at(-1)] : [];
    callback(null, JSON.stringify(request.action === 'discover' ? [app] : request.action === 'windows' ? (running && !trayOnly ? [target] : [])
      : request.action === 'processes' ? processRows : { ok: true }));
  } });
  return { apps, calls, stop: () => { running = false; } };
}

test('Windows probes and running checks never activate, launch, or call restart', async () => {
  const { apps, calls } = windowsFixture(); let restarted = 0;
  assert.equal((await apps.open('Editor', { probeOnly: true })).running, true);
  assert.equal((await apps.open('Editor', { checkOrOpen: true, restart: async () => restarted++ })).requiresRestart, true);
  assert.equal(restarted, 0); assert.equal(calls.includes('launch'), false);
});

test('Windows stopped app opens directly after a read-only negative probe', async () => {
  const { apps, calls } = windowsFixture({ running: false });
  assert.equal((await apps.open('Editor', { probeOnly: true })).running, false);
  assert.equal(calls.includes('launch'), false);
  assert.equal((await apps.open('Editor', { checkOrOpen: true })).launched, true);
  assert.equal(calls.filter(action => action === 'launch').length, 1);
});

test('Windows confirmed restart targets the packaged app child, preserving its shared host', async t => {
  const { apps, calls, stop } = windowsFixture({ packaged: true });
  const killed = [];
  const engine = new ComputerAutomation({ platform: 'win32', windowsApps: apps, killProcess: (pid, signal) => {
    killed.push([pid, signal]);
    if (signal === 'SIGTERM') { stop(); return true; }
    throw Object.assign(Error('exited'), { code: 'ESRCH' });
  } });
  t.after(() => engine.dispose());
  const result = await engine.openAppInTab('a', 1, 'Editor', { restartIfRunning: true });
  assert.equal(result.ok, true); assert.equal(result.launched, true);
  assert.deepEqual(killed, [[302, 'SIGTERM'], [302, 0]]);
  assert.equal(calls.filter(action => action === 'launch').length, 1);
});

test('Windows confirmation cannot close an app with any window owned by another conversation', async () => {
  const { apps, calls } = windowsFixture(); let restarted = false;
  await assert.rejects(apps.open('Editor', { restartIfRunning: true, taken: () => true, restart: async () => { restarted = true; } }), { code: 'computer_window_owned' });
  assert.equal(restarted, false); assert.equal(calls.includes('launch'), false);
});

test('Windows does not relaunch if a requested termination leaves an existing window alive', async () => {
  const { apps, calls } = windowsFixture();
  await assert.rejects(apps.open('Editor', { restartIfRunning: true, restart: async () => {} }), { code: 'computer_app_restart_failed' });
  assert.equal(calls.includes('launch'), false);
});

test('IPC probe and running confirmation responses never mount a window', async t => {
  const { engine } = macFixture(t);
  const module = require('../computer-window-view.cjs'), original = module.createComputerWindowView;
  const handlers = new Map(), mounts = [];
  module.createComputerWindowView = () => ({ openInTab: async (...args) => { mounts.push(args); return { ok: true }; } });
  try { registerComputerAutomation({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, automation: engine, desktopCapturer: {}, trustedMainFrame: () => true }); }
  finally { module.createComputerWindowView = original; }
  const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send() {} });
  const open = options => handlers.get('nextmux:computer:view:open-app')({ sender }, 'a', 'Editor', options);
  assert.equal((await open({ probeOnly: true })).running, true);
  assert.equal((await open({ checkOrOpen: true })).requiresRestart, true);
  assert.deepEqual(mounts, []);
  assert.equal((await open({ restartIfRunning: true })).ok, true);
  assert.equal(mounts.length, 1); assert.deepEqual(mounts[0].slice(0, 3), ['a', 102, 202]);
});


test('Windows tray-only app requires confirmation and restarts its exact process before opening a window', async () => {
  const { apps, calls, stop } = windowsFixture({ trayOnly: true });
  assert.equal((await apps.open('Editor', { probeOnly: true })).running, true);
  assert.equal((await apps.open('Editor', { checkOrOpen: true })).requiresRestart, true);
  assert.equal(calls.includes('launch'), false);
  const targets = [];
  assert.equal((await apps.open('Editor', { restartIfRunning: true, restart: async values => { targets.push(...values); stop(); } })).launched, true);
  assert.deepEqual(targets, [{ pid: 301, appPid: 301 }]);
  assert.equal(calls.filter(action => action === 'launch').length, 1);
});

test('Windows process-only matching never treats another executable in the same directory as this app', async () => {
  const { apps } = windowsFixture({ running: false, unrelatedProcess: true });
  assert.equal((await apps.open('Editor', { probeOnly: true })).running, false);
  assert.equal((await apps.open('Editor', { checkOrOpen: true })).launched, true);
});
