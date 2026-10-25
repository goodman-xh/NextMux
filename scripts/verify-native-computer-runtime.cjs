'use strict';
// Run with Electron (not ELECTRON_RUN_AS_NODE). This creates and touches only its
// own fixture window; existing applications and logged-in browsers are untouched.
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { createRequire } = require('node:module');
const desktop = createRequire(join(__dirname, '../apps/desktop/package.json'));
const { app, BrowserWindow, systemPreferences } = desktop('electron');
const { ComputerAutomation } = require('../apps/desktop/computer-automation.cjs');
const report = { platform: process.platform, architecture: process.arch, electron: process.versions.electron, sdk: '0.20.9', checks: {} };
const watchdog = setTimeout(() => { console.error('Native verification timed out'); app.exit(1); }, 60000);
app.setName('NextMux Native Verification');
app.whenReady().then(async () => {
  app.setAccessibilitySupportEnabled(true);
  const engine = new ComputerAutomation({ app, systemPreferences });
  let window;
  try {
    report.capability = engine.capability();
    if (!report.capability.available) { report.status = 'blocked'; report.reason = report.capability.reason; process.exitCode = 2; return; }
    window = new BrowserWindow({ title: 'NextMux native verification fixture', width: 720, height: 420, show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false } });
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><title>NextMux native verification fixture</title><button aria-label="NM Native Verify Increment" onclick="document.querySelector(\'output\').textContent=\'clicked\'">NM Native Verify Increment</button><output>waiting</output>'));
    window.showInactive();
    const run = async (action, input, conversationId = 'native-verifier-a') => {
      const result = await engine.run({ id: require('node:crypto').randomUUID(), conversationId, action, input, expiresAt: Date.now() + 30000 }, 77);
      assert.equal(result.ok, true, result.error); return result;
    };
    const listed = await run('listWindows', { pid: process.pid });
    const target = listed.output.find(item => String(item.title || item.window_title || item.name || '').includes('NextMux native verification fixture')) || (listed.output.length === 1 ? listed.output[0] : undefined);
    assert.ok(target, 'Native driver did not find its own fixture window');
    const ref = { pid: process.pid, windowId: Number(target.window_id ?? target.windowId) };
    report.checks.nativeWindowDiscovery = true;
    const observed = await run('observeWindow', { ...ref, includeScreenshot: true });
    assert.ok(observed.output.text.includes('NM Native Verify Increment')); assert.ok(observed.images?.length);
    const button = observed.output.elements.find(element => String(element.label || element.name || '').includes('NM Native Verify Increment'));
    assert.ok(button?.element_token, 'Fixture button does not have a current native element token');
    report.checks.nativeAXObservationAndScreenshot = true;
    const denied = await engine.run({ id: 'other-window', conversationId: 'native-verifier-b', action: 'observeWindow', input: ref, expiresAt: Date.now() + 30000 }, 77);
    assert.equal(denied.error, 'computer_window_owned'); report.checks.conversationIsolation = true;
    const clicked = await run('click', { ...ref, elementToken: button.element_token, snapshotId: observed.output.snapshotId });
    report.nativeClickEffect = clicked.output.effect;
    assert.notEqual(clicked.output.effect, 'refused', 'Upstream refused native click');
    assert.equal(await window.webContents.executeJavaScript("document.querySelector('output').textContent"), 'clicked');
    report.checks.nativeButtonEffect = true;
    const refreshed = await run('observeWindow', ref);
    const pendingId = 'native-verifier-cancellation';
    const pending = engine.run({ id: pendingId, conversationId: 'native-verifier-a', action: 'verifyState', expiresAt: Date.now() + 15000,
      input: { ...ref, snapshotId: refreshed.output.snapshotId, timeoutMs: 4000, stableSamples: 2,
        expect: [{ element: { selector: { label_contains: 'NM Native Verify Increment' }, enabled: false } }] } }, 77);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(engine.cancel('native-verifier-a', pendingId, 77), true);
    assert.equal((await pending).error, 'cancelled');
    assert.ok((await run('observeWindow', ref)).output.snapshotId);
    report.checks.nativeCancellationAndSessionReuse = true;
    await engine.release('native-verifier-a', 77);
    const recovered = await run('observeWindow', ref, 'native-verifier-b'); assert.ok(recovered.output.snapshotId);
    report.checks.releaseAndNewConversation = true;
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.error = String(error?.message || error); process.exitCode = 1; }
  finally {
    await engine.dispose(); if (window && !window.isDestroyed()) window.destroy(); clearTimeout(watchdog);
    console.log(JSON.stringify(report, null, 2)); app.exit(process.exitCode || 0);
  }
}).catch(error => { console.error(error.message); app.exit(1); });
