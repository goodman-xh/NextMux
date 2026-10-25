#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectToNextMuxWorkbench, desktopLaunchCommand, freePort, launchOwnedE2eProcess, terminateTree,
  waitForPort } from './desktop-attachment-file-e2e-harness.mjs';
import { desktopEditorShortcutPlan } from './desktop-editor-shortcuts.mjs';
import { finishE2eRun, installE2eSignalCleanup, readE2eProcessSnapshot } from './desktop-terminal-ci-e2e.mjs';

const pause = ms => new Promise(done => setTimeout(done, ms));
const markerPrefix = '__NEXTMUX_CLOSE_E2E__';
const closeBinding = '__nextmuxCloseE2eObserve';

export function bounded(promise, milliseconds, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`CLOSE_E2E_TIMEOUT: ${label}`)), milliseconds);
  })]).finally(() => clearTimeout(timer));
}

export function closeShortcutPlan(platform) {
  // Reuse the production-regression CtrlCmd event sequence, substituting Q.
  return desktopEditorShortcutPlan('save', platform).map(event => event.code === 'KeyS'
    ? { ...event, key: 'q', code: 'KeyQ', windowsVirtualKeyCode: 81 } : event);
}

export function closeLaunchPlan(environment, profile, workspace, cdpPort) {
  if (!environment.NEXTMUX_PACKAGED_EXECUTABLE || !isAbsolute(environment.NEXTMUX_PACKAGED_EXECUTABLE)) {
    throw new Error('CLOSE_E2E_REQUIRES_ABSOLUTE_PACKAGED_EXECUTABLE');
  }
  const inside = relative(profile, workspace);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('CLOSE_E2E_WORKSPACE_NOT_ISOLATED');
  const plan = desktopLaunchCommand({ environment, cdpPort, electronProfile: join(profile, 'electron-user-data') });
  assert.equal(plan.kind, 'packaged');
  // Only the positional workspace changes; the shared helper still owns exact
  // executable selection and both Electron profile flags. Never open the repo.
  return { ...plan, args: [workspace, ...plan.args.slice(1)] };
}

export async function readDurableDraft(state, expected) {
  const directory = join(state, 'conversation-history-v1');
  let manifest;
  try { manifest = JSON.parse(await readFile(join(directory, 'manifest-v1.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  assert.ok(Array.isArray(manifest.sessions) && manifest.sessions.length <= 32, 'Bounded isolated session manifest');
  for (const entry of manifest.sessions) {
    assert.equal(typeof entry.file, 'string');
    const filename = resolve(directory, entry.file), pathWithin = relative(directory, filename);
    assert.ok(pathWithin && !pathWithin.startsWith('..') && !isAbsolute(pathWithin), 'Session file must remain inside QA state');
    assert.ok((await stat(filename)).size <= 1024 * 1024, 'Synthetic session must remain small');
    const session = JSON.parse(await readFile(filename, 'utf8'));
    if (session.draftPrompt === expected) return { id: session.id, draftMatches: true, turns: session.turns?.length || 0 };
  }
  return undefined;
}

async function waitFor(read, predicate, timeout, label) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await bounded(Promise.resolve().then(read), Math.min(5000, Math.max(1, end - Date.now())), label);
    if (predicate(value)) return value;
    await pause(80);
  }
  throw new Error(`CLOSE_E2E_TIMEOUT: ${label}`);
}

// Executes only normal DOM control interactions. It cannot read component state,
// call a platform RPC, or change any other privacy preference.
export function recoveryPrivacyUi(document, labels, action = 'read') {
  const panel = document.querySelector('.nmx-privacy-settings');
  if (!panel || document.body.inert) return undefined;
  const rows = [...panel.querySelectorAll('.nmx-setting-row')];
  const matches = rows.filter(row => labels.includes(row.querySelector('strong')?.textContent?.trim()));
  if (matches.length !== 1) throw new Error('CLOSE_E2E_RECOVERY_CONTROL_NOT_UNIQUE');
  const input = matches[0].querySelector('input[type="checkbox"]');
  const save = panel.querySelector('.nmx-settings-actions button.is-primary');
  if (!input || !save) throw new Error('CLOSE_E2E_RECOVERY_CONTROL_UNAVAILABLE');
  if (action === 'disable') {
    if (!input.checked || input.disabled) throw new Error('CLOSE_E2E_RECOVERY_CONTROL_NOT_ENABLED');
    input.click();
  } else if (action !== 'read') throw new Error('CLOSE_E2E_UNKNOWN_PRIVACY_ACTION');
  return { checked: input.checked, disabled: input.disabled, saveDisabled: save.disabled,
    failed: Boolean(panel.querySelector('.nmx-network-message.is-error')),
    otherChecks: rows.filter(row => row !== matches[0]).map(row => row.querySelector('input[type="checkbox"]')?.checked) };
}

export async function disableFileRecoveryThroughPrivacyUi(client, state) {
  // Node 24 strips this dependency-free locale module in memory; no lib or app build.
  const { editorRecoveryText } = await import('../packages/theia-nextmux-extension/src/browser/nextmux-editor-recovery-locale.ts');
  const labels = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']
    .map(locale => editorRecoveryText(locale, 'setting'));
  const ui = action => client.evaluate(`(${recoveryPrivacyUi.toString()})(document, ${JSON.stringify(labels)}, ${JSON.stringify(action)})`);
  await click(client, '.nmx-context-account-dock .nmx-account-trigger');
  await waitFor(() => client.evaluate(`Boolean(document.querySelector('[data-settings-panel="privacy"]'))`), Boolean, 10000, 'settings navigation');
  await click(client, '[data-settings-panel="privacy"]');
  const before = await waitFor(() => ui('read'), value => value && !value.disabled, 10000, 'loaded recovery privacy control');
  assert.equal(before.checked, true, 'Fresh QA profile starts with recovery enabled');
  assert.equal(before.otherChecks.length, 3, 'Only the three existing privacy fields accompany recovery');
  await ui('disable');
  await waitFor(() => ui('read'), value => value && !value.checked && !value.disabled && !value.saveDisabled,
    5000, 'recovery-only change enables Save');
  await click(client, '.nmx-privacy-settings .nmx-settings-actions button.is-primary');
  const after = await waitFor(() => ui('read'), value => value && !value.checked && !value.disabled && value.saveDisabled && !value.failed,
    10000, 'privacy change acknowledged by UI');
  assert.deepEqual(after.otherChecks, before.otherChecks, 'No other privacy option was changed to force a Save');
  const settingsPath = join(state, 'privacy-settings-v1.json');
  const saved = await waitFor(async () => {
    try {
      assert.ok((await stat(settingsPath)).size <= 16 * 1024, 'Bounded synthetic privacy settings');
      return JSON.parse(await readFile(settingsPath, 'utf8'));
    } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  }, value => value?.saveFileEditorRecovery === false, 5000, 'recovery opt-out durably saved');
  assert.deepEqual([saved.requireZeroDataRetention, saved.denyDataCollection, saved.saveConversationHistory], before.otherChecks);
  assert.ok(Number.isSafeInteger(saved.fileEditorRecoveryRevision) && saved.fileEditorRecoveryRevision > 0);
  await click(client, '[data-desktop-section="coding"]');
  return { changedThroughPrivacyUi: true, saveFileEditorRecovery: false, revision: saved.fileEditorRecoveryRevision };
}

export function createEmptyLocalPlatformFixture() {
  // There are no accounts/keys/models to configure and no upstream forwarding.
  // The real app only reads its empty, local platform views in this regression.
  const server = http.createServer((request, response) => {
    if (request.method !== 'GET') server.nonGetRequests++;
    const path = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    const values = {
      '/api/catalog': { offerings: [], measuredAt: new Date().toISOString() },
      '/api/models/registry': { models: [], nextOffset: null },
      '/api/devices/session': { ok: true, linked: false },
      '/api/wallet': { ok: true, wallets: [], usage: [], conversations: [] },
    };
    const payload = request.method === 'GET' && Object.hasOwn(values, path) ? values[path] : undefined;
    response.writeHead(payload ? 200 : 404, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload || { error: { code: 'QA_NOT_FOUND' } }));
  });
  server.nonGetRequests = 0;
  return server;
}

export function closeObservation(message, observedAt = Date.now()) {
  const payload = message.method === 'Runtime.bindingCalled' && message.params?.name === closeBinding
    ? message.params.payload : message.method === 'Runtime.consoleAPICalled' && message.params?.args?.[0]?.value === markerPrefix
      ? message.params.args[1]?.value : undefined;
  if (typeof payload !== 'string' || payload.length > 256) return undefined;
  try {
    const event = JSON.parse(payload);
    if (event.kind === 'offered' || event.kind === 'cancelled' && ['failed', 'timeout', 'navigated'].includes(event.reason)) {
      // Test observer clock, not a renderer-supplied timestamp or exact IPC latency.
      return { kind: event.kind, ...(event.reason ? { reason: event.reason } : {}),
        ...(Number.isSafeInteger(event.attempt) && event.attempt > 0 && event.attempt <= 64 ? { attempt: event.attempt } : {}), observedAt };
    }
  } catch { /* Ignore non-fixture console records; no application log scraping. */ }
  return undefined;
}

export function nativeQuitForOwnedProcess(child, executable, { snapshot = readE2eProcessSnapshot, run = source => {
  const result = spawnSync('/usr/bin/osascript', ['-e', source], { encoding: 'utf8', timeout: 5000, maxBuffer: 4096 });
  if (result.error || result.status !== 0) throw new Error('CLOSE_E2E_NATIVE_KEY_FAILED_OR_NOT_AUTHORIZED');
} } = {}) {
  if (!Number.isSafeInteger(child?.pid) || child.pid <= 1 || child.pid === process.pid || !isAbsolute(executable)) {
    throw new Error('CLOSE_E2E_NATIVE_TARGET_INVALID');
  }
  const original = snapshot().find(row => row.pid === child.pid);
  if (!original || original.zombie || original.identity.split('\0').at(-1) !== executable) {
    throw new Error('CLOSE_E2E_NATIVE_TARGET_UNVERIFIED');
  }
  const verify = () => {
    const current = snapshot().find(row => row.pid === child.pid);
    if (child.exitCode !== null || child.signalCode !== null || !current || current.zombie || current.identity !== original.identity) {
      throw new Error('CLOSE_E2E_NATIVE_TARGET_CHANGED');
    }
  };
  return () => {
    verify();
    run(`tell application "System Events"
      set qaProcess to first application process whose unix id is ${child.pid}
      set frontmost of qaProcess to true
    end tell`);
    // Focus/permission prompts may take time. Recheck exact executable/start identity before the key.
    verify();
    run(`tell application "System Events"
      set qaProcess to first application process whose unix id is ${child.pid}
      if not (frontmost of qaProcess) then error "QA_TARGET_NOT_FRONTMOST"
      tell qaProcess to key code 12 using {command down}
    end tell`);
  };
}

export async function attachCloseObserver(port, nativeTarget) {
  const client = await bounded(connectToNextMuxWorkbench(port, 45000), 50000, 'workbench mount');
  const originalCall = client.call, originalEvaluate = client.evaluate;
  client.call = (method, params) => bounded(originalCall(method, params), 10000, method);
  client.evaluate = expression => bounded(originalEvaluate(expression), 10000, 'renderer read');
  const events = [], dialogs = [];
  client.onEvent(message => {
    if (message.method === 'Page.javascriptDialogOpening') dialogs.push(message.params.type);
    const observation = closeObservation(message);
    if (observation) events.push(observation);
  });
  await Promise.all([client.call('Runtime.enable'), client.call('Page.enable')]);
  // Theia forwards console.* to its backend logger. A CDP binding remains an
  // observer even when console events are replaced; it never acknowledges IPC.
  await client.call('Runtime.addBinding', { name: closeBinding });
  await client.call('Page.bringToFront');
  await client.call('Emulation.setFocusEmulationEnabled', { enabled: true });
  await client.evaluate(`(() => {
    if (!window.nextmuxDesktop?.onPrepareCloseCancelled) throw new Error('CLOSE_E2E_PACKAGE_MISSING_HANDSHAKE');
    const log = value => window[${JSON.stringify(closeBinding)}](JSON.stringify(value));
    // Observers only: never begin, approve, or alter the app's persistence work.
    const attempts = new Map();
    const attemptFor = token => {
      if (!attempts.has(token)) {
        if (attempts.size >= 64) throw new Error('CLOSE_E2E_TOO_MANY_ATTEMPTS');
        attempts.set(token, attempts.size + 1);
      }
      return attempts.get(token);
    };
    // Only a profile-local ordinal leaves the observer, never the IPC nonce.
    window.nextmuxDesktop.onPrepareClose(token => log({ kind: 'offered', attempt: attemptFor(token) }));
    window.nextmuxDesktop.onPrepareCloseCancelled((token, reason) => log({ kind: 'cancelled', reason, attempt: attemptFor(token) }));
    return true;
  })()`);
  return { ...client, events, dialogs, ...(process.platform === 'darwin' && nativeTarget
    ? { nativeQuit: nativeQuitForOwnedProcess(nativeTarget.child, nativeTarget.executable) } : {}) };
}

async function click(client, selector) {
  const clicked = await client.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!(node instanceof HTMLElement) || node.matches(':disabled') || document.body.inert) return false;
    node.scrollIntoView({ block: 'center' }); node.click(); return true;
  })()`);
  assert.equal(clicked, true, `Expected available control: ${selector}`);
}

async function keys(client, events) {
  for (const event of events) await client.call('Input.dispatchKeyEvent', event);
}

export async function requestQuit(client, platform) {
  const before = client.events.filter(event => event.kind === 'offered').length;
  if (platform === 'darwin') {
    if (typeof client.nativeQuit !== 'function') throw new Error('CLOSE_E2E_NATIVE_QUIT_DRIVER_REQUIRED');
    // CDP keyboard events do not traverse macOS's native application menu.
    // This is the real Cmd+Q accelerator, scoped to the verified QA PID.
    client.nativeQuit();
    return waitFor(() => client.events.filter(event => event.kind === 'offered')[before], Boolean,
      10000, 'native Cmd+Q offered a close');
  }
  // Electron may close the CDP target during key-up. Only an observed offered
  // event counts as delivery; there is deliberately no window.close fallback.
  await keys(client, closeShortcutPlan(platform)).catch(() => undefined);
  return waitFor(() => client.events.filter(event => event.kind === 'offered')[before], Boolean,
    10000, 'real Cmd/Ctrl+Q offered a close');
}

function exited(child) { return child.exitCode !== null || child.signalCode !== null; }

async function expectNaturalExit(child, label) {
  await waitFor(() => exited(child), Boolean, 20000, label);
  assert.equal(child.signalCode, null, 'Exit was not caused by cleanup or a signal');
  assert.equal(child.exitCode, 0, 'Packaged application exited without a crash');
}

export async function runClosePersistenceE2E(environment = process.env) {
  // Fail before allocating resources or launching a process if no package was supplied.
  closeLaunchPlan(environment, resolve(tmpdir(), 'nextmux-close-validation'), resolve(tmpdir(), 'nextmux-close-validation/workspace'), 1);
  const profile = await mkdtemp(join(tmpdir(), 'nextmux-close-persistence-e2e-'));
  const workspace = join(profile, 'workspace'), state = join(profile, 'nextmux-state'), logs = join(profile, 'logs');
  await Promise.all([workspace, state, logs, join(profile, 'electron-user-data'), join(profile, 'theia-config')]
    .map(directory => mkdir(directory, { recursive: true })));
  const filename = `close-fixture-${randomUUID()}.txt`, file = join(workspace, filename);
  const original = 'Isolated close persistence fixture.\n', changed = `explicit-save-${randomUUID()}`;
  const draft = `unsent-close-draft-${randomUUID()} 最后的草稿`;
  await writeFile(file, original, { flag: 'wx' });
  const server = createEmptyLocalPlatformFixture(), children = [], clients = [];
  let primaryError, stopping = false, cleanupPromise;
  const ensureRunning = () => { if (stopping) throw new Error('CLOSE_E2E_STOPPING'); };
  const cleanup = () => {
    stopping = true;
    return cleanupPromise ||= (async () => {
      for (const client of clients) try { client.socket.close(); } catch { /* already closed */ }
      const results = await Promise.allSettled([...children].reverse().map(terminateTree).concat((async () => {
        server.closeAllConnections();
        if (server.listening) await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
      })()));
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, 'Close persistence owned cleanup failed');
      // Keep bounded evidence and logs on success as well as failure. No user
      // folder deletion, global process matching, or reused output descriptors.
    })();
  };
  const disposeSignals = installE2eSignalCleanup(cleanup);
  const evidence = { profile, executable: environment.NEXTMUX_PACKAGED_EXECUTABLE, platform: process.platform, arch: process.arch,
    composer: {}, file: {}, injectedBackendFailure: false };
  process.stdout.write(`${JSON.stringify({ event: 'close_e2e_profile', profile, logs })}\n`);
  try {
    await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const appEnvironment = { ...environment, NEXTMUX_PLATFORM_API_URL: endpoint, NEXTMUX_PUBLIC_APP_URL: endpoint,
      NEXTMUX_DESKTOP_STATE_DIR: state, NEXTMUX_AGENT_STATE_DIR: state, THEIA_CONFIG_DIR: join(profile, 'theia-config'),
      NEXTMUX_DESKTOP_E2E_ISOLATED: '1', NEXTMUX_DESKTOP_E2E_PROFILE_DIR: profile, NEXTMUX_E2E_WORKSPACE: workspace,
      ...(process.platform === 'win32' ? { LOCALAPPDATA: join(profile, 'local-app-data'), APPDATA: join(profile, 'roaming-app-data') }
        : { XDG_DATA_HOME: join(profile, 'xdg-data'), XDG_CONFIG_HOME: join(profile, 'xdg-config') }) };
    async function launch(round) {
      ensureRunning(); const port = await freePort(); ensureRunning();
      const plan = closeLaunchPlan(appEnvironment, profile, workspace, port);
      process.stdout.write(`${JSON.stringify({ event: 'qa_desktop_launch', kind: plan.kind, executable: plan.command, round })}\n`);
      const child = launchOwnedE2eProcess(plan.command, plan.args, { env: appEnvironment,
        stdout: join(logs, `app-${round}.stdout.log`), stderr: join(logs, `app-${round}.stderr.log`) });
      children.push(child);
      await waitForPort(port, 90000, child);
      const client = await attachCloseObserver(port, { child, executable: plan.command }); clients.push(client);
      return { child, client };
    }
    const first = await launch(1);
    await click(first.client, '[data-desktop-section="coding"]');
    await waitFor(() => first.client.evaluate(`Boolean(document.querySelector('.nmx-composer textarea:not(:disabled)'))`), Boolean, 15000, 'composer');
    await first.client.evaluate(`document.querySelector('.nmx-composer textarea:not(:disabled)')?.focus()`);
    await first.client.call('Input.insertText', { text: draft });
    const typedAt = Date.now();
    const observedOffer = await requestQuit(first.client, process.platform);
    evidence.composer.shortcutOfferObservedAfterInputMs = observedOffer.observedAt - typedAt;
    evidence.composer.timingClock = 'test-observer-Date.now';
    await expectNaturalExit(first.child, 'first packaged process exited naturally');
    assert.equal(first.client.events.some(event => event.kind === 'cancelled'), false, 'Dirty composer close must save successfully');
    assert.equal(first.client.dialogs.length, 0);
    const durable = await readDurableDraft(state, draft);
    assert.ok(durable?.draftMatches, 'Exact unsent draft must reach the backend, not just localStorage');
    assert.equal(durable.turns, 0, 'Draft was never submitted to a model');
    evidence.composer.durableAfterExit = true;
    await terminateTree(first.child); // Reap only this launch's observed detached backend before same-profile restart.
    const second = await launch(2);
    await click(second.client, '[data-desktop-section="coding"]');
    await waitFor(() => second.client.evaluate(`document.querySelector('.nmx-composer textarea')?.value === ${JSON.stringify(draft)}`), Boolean, 15000, 'exact restored unsent draft');
    evidence.composer.restoredAfterProcessRestart = true;
    // Default-on recovery makes dirty files safe to close. Exercise the distinct
    // opt-out refusal contract through the real settings UI before editing.
    evidence.file.recoveryOptOut = await disableFileRecoveryThroughPrivacyUi(second.client, state);
    await waitFor(() => second.client.evaluate(`document.querySelector('.nmx-composer textarea')?.value === ${JSON.stringify(draft)}`), Boolean,
      15000, 'composer unchanged after privacy settings');
    await waitFor(() => second.client.evaluate(`Boolean(document.querySelector('.nmx-thread-files header button:not(:disabled)'))`), Boolean, 15000, 'file rail');
    await click(second.client, '.nmx-thread-files header button:not(:disabled)');
    const selector = `.nmx-thread-file-row[aria-label="${filename}"]`;
    await waitFor(() => second.client.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), Boolean, 20000, 'isolated fixture in workspace');
    await click(second.client, selector);
    await waitFor(() => second.client.evaluate(`Boolean(document.querySelector('.nmx-monaco-file-editor .monaco-editor'))`), Boolean, 15000, 'real Monaco editor');
    await click(second.client, '.nmx-monaco-file-editor .monaco-editor');
    await second.client.evaluate(`document.querySelector('.nmx-monaco-file-editor .native-edit-context, .nmx-monaco-file-editor textarea')?.focus()`);
    await keys(second.client, desktopEditorShortcutPlan('selectAll', process.platform));
    await second.client.call('Input.insertText', { text: changed });
    await waitFor(() => second.client.evaluate(`Boolean(document.querySelector('.nmx-file-editor-tab em'))`), Boolean, 5000, 'unsaved file dirty');
    const cancellations = second.client.events.filter(event => event.kind === 'cancelled').length;
    await requestQuit(second.client, process.platform);
    await waitFor(() => second.client.events.filter(event => event.kind === 'cancelled').length, count => count > cancellations, 10000, 'dirty file cancels close');
    assert.equal(exited(second.child), false);
    assert.equal(second.client.events.at(-1)?.reason, 'failed', 'Dirty file is a known refusal, not a success or silent timeout');
    assert.equal(await readFile(file, 'utf8'), original, 'Cancelled exit must not overwrite the project file');
    await waitFor(() => second.client.evaluate(`!document.body.inert && Boolean(document.querySelector('.nmx-file-editor-tab em'))`), Boolean, 5000, 'UI unlocked with dirty editor intact');
    evidence.file.cancelledWithoutOverwrite = true;
    // Prove actual keyboard input still works after cancellation, not just a DOM flag.
    await click(second.client, '.nmx-monaco-file-editor .monaco-editor');
    await second.client.evaluate(`document.querySelector('.nmx-monaco-file-editor .native-edit-context, .nmx-monaco-file-editor textarea')?.focus()`);
    await keys(second.client, desktopEditorShortcutPlan('selectAll', process.platform));
    const finalText = `${changed}-after-cancel`;
    await second.client.call('Input.insertText', { text: finalText });
    await keys(second.client, desktopEditorShortcutPlan('save', process.platform));
    await waitFor(() => readFile(file, 'utf8'), value => value === finalText, 10000, 'explicit save after cancelled exit');
    await waitFor(() => second.client.evaluate(`!document.querySelector('.nmx-file-editor-tab em') && !document.querySelector('.nmx-file-save-confirm')`), Boolean, 5000, 'clean saved editor with no overwrite prompt');
    evidence.file.editableAndExplicitlySaved = true;
    const beforeFinal = second.client.events.filter(event => event.kind === 'cancelled').length;
    await requestQuit(second.client, process.platform);
    await expectNaturalExit(second.child, 'saved file permits natural exit');
    assert.equal(second.client.events.filter(event => event.kind === 'cancelled').length, beforeFinal);
    assert.equal(second.client.dialogs.length, 0);
    assert.equal(await readFile(file, 'utf8'), finalText);
    evidence.file.exitedOnlyAfterExplicitSave = true;
    assert.equal(server.nonGetRequests, 0, 'The local platform fixture received no mutation or inference request');
    evidence.localPlatformNonGetRequests = server.nonGetRequests;
    evidence.rounds = clients.map(client => ({ events: client.events.slice(0, 128), dialogs: client.dialogs.slice(0, 32) }));
    evidence.passed = true;
    await writeFile(join(logs, 'close-persistence-result.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' });
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
  } catch (error) {
    primaryError = error;
    await writeFile(join(logs, 'close-persistence-failure-observations.json'), JSON.stringify({
      ...evidence, passed: false, rounds: clients.map(client => ({ events: client.events.slice(0, 128), dialogs: client.dialogs.slice(0, 32) }))
    }, null, 2), { flag: 'wx', mode: 0o600 });
  }
  finally { try { await finishE2eRun(cleanup, primaryError); } finally { disposeSignals(); } }
  return evidence;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runClosePersistenceE2E().catch(error => {
    // Errors contain fixed labels/paths or synthetic assertion text, no response bodies or keys.
    console.error(error); process.exitCode = 1;
  });
}
