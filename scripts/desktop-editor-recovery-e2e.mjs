#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { attachCloseObserver, bounded, closeLaunchPlan, createEmptyLocalPlatformFixture, requestQuit } from './desktop-close-persistence-e2e.mjs';
import { desktopEditorShortcutPlan } from './desktop-editor-shortcuts.mjs';
import { freePort, launchOwnedE2eProcess, terminateTree, waitForPort } from './desktop-attachment-file-e2e-harness.mjs';
import { assertDisposableDesktopE2E } from './desktop-e2e-state.mjs';
import { finishE2eRun, installE2eSignalCleanup, readE2eProcessSnapshot } from './desktop-terminal-ci-e2e.mjs';
import { fixtureHash, verifiedFixtureAttachment } from './desktop-attachment-owner-files.mjs';
import { readOwnedEditorRecovery, replaceOwnedEditorFixture } from './desktop-editor-recovery-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pause = ms => new Promise(done => setTimeout(done, ms));
function recoveryText() {
  // Test only: compile the shared fixed labels in memory, never another app build.
  const require = createRequire(join(root, 'apps/desktop/package.json'));
  const output = require('esbuild').buildSync({ entryPoints: [join(root, 'packages/theia-nextmux-extension/src/browser/nextmux-editor-recovery-locale.ts')],
    bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const module = { exports: {} };
  Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports);
  return module.exports.editorRecoveryText;
}
async function waitFor(read, predicate, label, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await bounded(Promise.resolve().then(read), 5000, label);
    if (predicate(value)) return value;
    await pause(100);
  }
  throw new Error(`EDITOR_RECOVERY_QA_TIMEOUT: ${label}`);
}
async function click(client, selector) {
  assert.equal(await client.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node || node.disabled || document.body.inert) return false;
    node.scrollIntoView({ block: 'center' }); node.click(); return true;
  })()`), true, `RECOVERY_QA_CONTROL_UNAVAILABLE: ${selector}`);
}
async function view(client) {
  return client.evaluate(`(() => ({
    locale: localStorage.getItem('nextmux.locale') || 'en',
    name: document.querySelector('.nmx-file-editor-tab strong')?.textContent || '',
    text: document.querySelector('.nmx-monaco-file-editor .view-lines')?.innerText || '',
    dirty: Boolean(document.querySelector('.nmx-file-editor-tab em')),
    status: document.querySelector('.nmx-editor-recovery-status > span')?.textContent || '',
    keys: [...document.querySelectorAll('.nmx-editor-recovery [data-recovery-key]')].map(node => node.getAttribute('data-recovery-key')),
    savePrompt: Boolean(document.querySelector('.nmx-file-save-confirm'))
  }))()`);
}
async function keys(client, operation) {
  for (const event of desktopEditorShortcutPlan(operation, process.platform)) await client.call('Input.dispatchKeyEvent', event);
}
async function focusEditor(client) {
  await click(client, '.nmx-monaco-file-editor .monaco-editor');
  await client.evaluate(`document.querySelector('.nmx-monaco-file-editor .native-edit-context, .nmx-monaco-file-editor textarea')?.focus()`);
}

const appleString = value => {
  assert.ok(typeof value === 'string' && value.length <= 4096 && !/[\u0000-\u001f\u007f]/u.test(value), 'RECOVERY_QA_NATIVE_ARGUMENT');
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
};

/** Native save-sheet UI only. Never supplies a synthetic picker result or invokes a product RPC. */
export function nativeRecoverySaveDialog(child, executable, { defaultName, outputName, directory, sourceName, saveLabel }, {
  snapshot = readE2eProcessSnapshot,
  run = source => {
    const result = spawnSync('/usr/bin/osascript', ['-e', source], { encoding: 'utf8', timeout: 15000, maxBuffer: 4096 });
    if (result.error || result.status !== 0) {
      const code = result.error?.code === 'ETIMEDOUT' ? 'timeout' : /\((-?\d+)\)\s*$/u.exec(result.stderr || '')?.[1] || 'unknown';
      const step = [...(result.stderr || '').matchAll(/QA_NATIVE_STEP_(FIELDS|BUTTONS|DISCLOSURE|BROWSER|COLUMNS|FILES|NAME|TAB)/gu)].at(-1)?.[1] || 'unknown';
      throw new Error(`RECOVERY_QA_NATIVE_DIALOG_FAILED_OR_NOT_AUTHORIZED: ${code}/${step}`);
    }
    return result.stdout.trim();
  }
} = {}) {
  assert.ok(Number.isSafeInteger(child?.pid) && child.pid > 1 && child.pid !== process.pid && isAbsolute(executable), 'RECOVERY_QA_NATIVE_TARGET');
  const original = snapshot().find(row => row.pid === child.pid);
  assert.ok(original && !original.zombie && original.identity.split('\0').at(-1) === executable, 'RECOVERY_QA_NATIVE_TARGET_UNVERIFIED');
  assert.ok(isAbsolute(directory) && basename(defaultName) === defaultName && basename(outputName) === outputName
    && basename(sourceName) === sourceName && defaultName !== outputName && outputName !== sourceName, 'RECOVERY_QA_NATIVE_DESTINATION');
  const quoted = { defaultName: appleString(defaultName), outputName: appleString(outputName), directory: appleString(directory),
    sourceName: appleString(sourceName), saveLabel: appleString(saveLabel) };
  const verify = () => {
    const current = snapshot().find(row => row.pid === child.pid);
    assert.ok(child.exitCode === null && child.signalCode === null && current && !current.zombie
      && current.identity === original.identity, 'RECOVERY_QA_NATIVE_TARGET_CHANGED');
  };
  const perform = body => {
    verify();
    run(`tell application "System Events"
      set qaProcess to first application process whose unix id is ${child.pid}
      set frontmost of qaProcess to true
    end tell`);
    verify(); // Same PID/start/UID/executable again after focus or permission handling.
    return run(`tell application "System Events"
      set qaProcess to first application process whose unix id is ${child.pid}
      if not (frontmost of qaProcess) then error "QA_TARGET_NOT_FRONTMOST"
      tell qaProcess
        ${body}
      end tell
    end tell`);
  };
  const sheet = `if not (exists sheet 1 of window 1) then return "absent"
    set qaSheet to sheet 1 of window 1
    if not (exists splitter group 1 of qaSheet) then return "structure-unmatched"
    set qaControls to splitter group 1 of qaSheet`;
  const exactField = name => `set qaFields to {}
    set qaElements to UI elements of qaControls
    if (count of qaElements) > 100 then error "QA_NATIVE_CONTROLS_TOO_LARGE"
    repeat with qaElement in qaElements
      if role of qaElement is "AXTextField" then
        if value of qaElement is ${name} then set end of qaFields to qaElement
      end if
    end repeat
    if (count of qaFields) is not 1 then return "field-unmatched"`;
  const exactSaveButton = `set qaSaveButtons to {}
    repeat with qaElement in qaElements
      if role of qaElement is "AXButton" then
        if name of qaElement is ${quoted.saveLabel} then
          try
            if value of attribute "AXIdentifier" of qaElement is "OKButton" then set end of qaSaveButtons to qaElement
          end try
        end if
      end if
    end repeat
    if (count of qaSaveButtons) is not 1 then return "button-unmatched"`;
  const ownedDirectory = `set qaOwnedSourceVisible to false
    set qaBrowserChildren to UI elements of splitter group 1 of qaControls
    if (count of qaBrowserChildren) is not 1 then return "structure-unmatched"
    set qaBrowser to item 1 of qaBrowserChildren
    if role of qaBrowser is not "AXBrowser" then return "structure-unmatched"
    log "QA_NATIVE_STEP_BROWSER"
    set qaColumns to {}
    repeat with qaChild in UI elements of qaBrowser
      if role of qaChild is "AXScrollArea" then set end of qaColumns to qaChild
    end repeat
    if (count of qaColumns) < 1 or (count of qaColumns) > 32 then return "structure-unmatched"
    set qaNestedColumns to {}
    repeat with qaChild in UI elements of (last item of qaColumns)
      if role of qaChild is "AXScrollArea" then set end of qaNestedColumns to qaChild
    end repeat
    if (count of qaNestedColumns) > 32 then return "structure-unmatched"
    if (count of qaNestedColumns) > 0 then set qaColumns to qaNestedColumns
    log "QA_NATIVE_STEP_COLUMNS"
    set qaFileElements to {}
    repeat with qaChild in UI elements of (last item of qaColumns)
      if role of qaChild is "AXList" or role of qaChild is "AXTable" or role of qaChild is "AXOutline" then
        set qaFileElements to UI elements of qaChild
      end if
    end repeat
    if (count of qaFileElements) > 100 then error "QA_NATIVE_FILE_COLUMN_TOO_LARGE"
    log "QA_NATIVE_STEP_FILES"
    set qaFileLabels to qaFileElements
    repeat with qaElement in qaFileElements
      if role of qaElement is "AXGroup" then
        set qaLabelChildren to UI elements of qaElement
        if (count of qaLabelChildren) > 8 then error "QA_NATIVE_FILE_ROW_TOO_LARGE"
        set qaFileLabels to qaFileLabels & qaLabelChildren
      end if
    end repeat
    repeat with qaElement in qaFileLabels
      try
        if name of qaElement is ${quoted.sourceName} or value of qaElement is ${quoted.sourceName} then set qaOwnedSourceVisible to true
      end try
    end repeat
    if not qaOwnedSourceVisible then return "unverified-directory"`;
  const destinationSheet = `${sheet}
    if exists sheet 1 of qaSheet then return "navigating"
    ${exactField(quoted.outputName)}
    ${ownedDirectory}
    ${exactSaveButton}`;
  return {
    describeWindows: () => perform(`set qaRows to ""
      if (count of windows) > 5 then error "QA_NATIVE_WINDOWS_TOO_LARGE"
      repeat with qaWindow in windows
        set qaRows to qaRows & (role of qaWindow) & ":sheets=" & (count of sheets of qaWindow) & linefeed
      end repeat
      return qaRows`),
    // Diagnose only this owned sheet. Arbitrary folder names and field values are never emitted.
    describe: () => perform(`${sheet}
      set qaRows to ""
      set qaElements to UI elements of qaControls
      if (count of qaElements) > 100 then error "QA_NATIVE_CONTROLS_TOO_LARGE"
      repeat with qaElement in qaElements
        set qaRole to role of qaElement
        if qaRole is "AXTextField" or qaRole is "AXComboBox" then
          set qaValue to ""
          try
            set qaValue to value of qaElement as text
          end try
          set qaSafeValue to "redacted-length:" & (length of qaValue)
          if qaValue starts with "NextMux-Recovered-recovery-" or qaValue starts with "exported-recovery-" then set qaSafeValue to qaValue
          set qaRows to qaRows & qaRole & ":" & qaSafeValue & linefeed
        else if qaRole is "AXButton" then
          set qaName to ""
          try
            set qaName to name of qaElement as text
          end try
          set qaSafeName to "redacted-length:" & (length of qaName)
          if qaName is ${quoted.saveLabel} or qaName is "Save" or qaName is "Cancel" or qaName is "保存" or qaName is "取消" or qaName is "存储" then set qaSafeName to qaName
          set qaRows to qaRows & qaRole & ":" & qaSafeName & linefeed
        else
          set qaRows to qaRows & qaRole & linefeed
          if qaRole is "AXSplitGroup" or qaRole is "AXGroup" then
            set qaChildren to UI elements of qaElement
            if (count of qaChildren) > 32 then error "QA_NATIVE_CHILDREN_TOO_LARGE"
            repeat with qaChild in qaChildren
              set qaRows to qaRows & "  " & (role of qaChild) & linefeed
            end repeat
          end if
        end if
      end repeat
      return qaRows`),
    inspect: () => perform(`${sheet}
      ${exactField(quoted.defaultName)}
      ${exactSaveButton}
      return "ready"`),
    cancel: () => perform(`${sheet}
      ${exactField(quoted.defaultName)}
      key code 53
      return "cancelled"`),
    prepareName: () => perform(`${sheet}
      ${exactField(quoted.defaultName)}
      log "QA_NATIVE_STEP_FIELDS"
      ${exactSaveButton}
      log "QA_NATIVE_STEP_BUTTONS"
      set qaDisclosures to {}
      repeat with qaElement in qaElements
        if role of qaElement is "AXDisclosureTriangle" then set end of qaDisclosures to qaElement
      end repeat
      if (count of qaDisclosures) is not 1 then return "unmatched"
      if value of (item 1 of qaDisclosures) is 0 then
        click (item 1 of qaDisclosures)
        return "expanding"
      end if
      if value of (item 1 of qaDisclosures) is not 1 then return "unmatched"
      log "QA_NATIVE_STEP_DISCLOSURE"
      ${ownedDirectory}
      set value of (item 1 of qaFields) to ${quoted.outputName}
      log "QA_NATIVE_STEP_NAME"
      return "named"`),
    inspectDestination: () => perform(`${destinationSheet}\n return "ready"`),
    save: () => perform(`${destinationSheet}
      click (item 1 of qaSaveButtons)
      return "saved"`)
  };
}

export async function assertNewRecoveryDestination(profile, workspace, destination) {
  assert.ok([profile, workspace, destination].every(isAbsolute), 'RECOVERY_QA_SAVE_ABSOLUTE_PATH_REQUIRED');
  assert.equal(resolve(workspace), join(resolve(profile), 'workspace'), 'RECOVERY_QA_SAVE_EXACT_WORKSPACE');
  const owned = await realpath(profile), directory = await realpath(workspace);
  const delta = relative(owned, directory);
  assert.ok(delta && !delta.startsWith('..') && !isAbsolute(delta), 'RECOVERY_QA_SAVE_OUTSIDE_PROFILE');
  assert.equal((await lstat(workspace)).isSymbolicLink(), false, 'RECOVERY_QA_SAVE_DIRECTORY_SYMLINK');
  assert.equal(dirname(destination), workspace, 'RECOVERY_QA_SAVE_OUTSIDE_WORKSPACE');
  assert.equal(await lstat(destination).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }), false,
    'RECOVERY_QA_SAVE_DESTINATION_EXISTS');
}

async function verifyRecoverySaveAs(app, { profile, workspace, expected, external, stored, text }) {
  const client = app.client, locale = (await view(client)).locale, label = text(locale, 'saveAs');
  assert.equal(process.platform, 'darwin', 'RECOVERY_QA_NATIVE_SAVE_DRIVER_UNSUPPORTED');
  assert.equal(await client.evaluate('window.electronTheiaCore?.useNativeElements === true'), true,
    'RECOVERY_QA_EXPECTS_REAL_NATIVE_SAVE_DIALOG');
  const outputName = `exported-recovery-${randomUUID()}.txt`, destination = join(workspace, outputName);
  await assertNewRecoveryDestination(profile, workspace, destination);
  const controls = nativeRecoverySaveDialog(app.child, app.executable, { defaultName: `NextMux-Recovered-${expected.name}`,
    outputName, directory: await realpath(workspace), sourceName: expected.name, saveLabel: label });
  const selector = `.nmx-editor-recovery-status button[aria-label=${JSON.stringify(label)}]`;
  const waitNative = (read, expectedState, phase) => {
    let last;
    return waitFor(async () => {
      let state;
      try { state = read(); }
      catch (error) {
        try { console.log(JSON.stringify({ event: 'editor_recovery_native_controls', phase, controls: controls.describe() })); }
        catch { /* The verified owned process or sheet may already be unavailable. */ }
        throw error;
      }
      assert.ok(['ready', 'absent', 'unmatched', 'structure-unmatched', 'field-unmatched', 'button-unmatched', 'expanding', 'navigating', 'named', 'unverified-directory'].includes(state), 'RECOVERY_QA_NATIVE_STATE');
      if (state !== last) {
        console.log(JSON.stringify({ event: 'editor_recovery_native_save', phase, state }));
        if (state === 'absent' && phase === 'verify-destination') {
          const labels = Object.fromEntries(['savedAs', 'saveAsExists', 'saveAsSource', 'saveAsTooLarge', 'saveAsChanged', 'saveAsUnsupported', 'saveAsFailed'].map(key => [key, text(locale, key)]));
          const notices = await client.evaluate(`(() => {
            const records = JSON.parse(localStorage.getItem('nextmux.desktop.notifications.v1') || '[]');
            return Object.entries(${JSON.stringify(labels)}).filter(([, value]) => records.some(item => item.body === value)).map(([key]) => key);
          })()`);
          console.log(JSON.stringify({ event: 'editor_recovery_native_absent', windows: controls.describeWindows(), notices }));
          const capture = await client.call('Page.captureScreenshot', { format: 'png' });
          await writeFile(join(profile, 'logs', 'native-picker-unexpected-absent.png'), Buffer.from(capture.data, 'base64'), { flag: 'wx' });
        }
        if (state.includes('unmatched') || state === 'unverified-directory' || (state === 'navigating' && phase === 'verify-destination')) {
          console.log(JSON.stringify({ event: 'editor_recovery_native_controls', phase, controls: controls.describe() }));
        }
      }
      last = state; return state;
    }, value => value === expectedState, `native Save As ${phase}`);
  };
  const before = (await readdir(workspace)).sort();
  await click(client, selector); await waitNative(() => controls.inspect(), 'ready', 'initial');
  assert.equal(controls.cancel(), 'cancelled');
  await waitFor(() => client.evaluate(`!document.querySelector(${JSON.stringify(selector)})?.disabled`), Boolean, 'cancelled export settled');
  await assertNewRecoveryDestination(profile, workspace, destination);
  assert.deepEqual((await readdir(workspace)).sort(), before, 'Cancel must not create an exported file');
  assert.equal(await readFile(expected.file, 'utf8'), external);
  assert.equal((await readOwnedEditorRecovery(profile, expected)).snapshotSha256, stored.snapshotSha256);
  await click(client, selector); await waitNative(() => controls.inspect(), 'ready', 'reopened');
  await waitNative(() => controls.prepareName(), 'named', 'name-in-owned-folder');
  await waitNative(() => controls.inspectDestination(), 'ready', 'verify-destination');
  await assertNewRecoveryDestination(profile, workspace, destination);
  assert.equal(controls.save(), 'saved');
  await waitFor(() => lstat(destination).catch(error => { if (error.code === 'ENOENT') return; throw error; }), Boolean, 'new exported file');
  const output = await verifiedFixtureAttachment(profile, { uri: pathToFileURL(destination).href, size: Buffer.byteLength(expected.draft) }, Buffer.from(expected.draft));
  await waitFor(() => client.evaluate(`!document.querySelector(${JSON.stringify(selector)})?.disabled`), Boolean, 'export settled');
  const after = await view(client), recovery = await readOwnedEditorRecovery(profile, expected);
  assert.equal(after.dirty, true); assert.equal(after.status, text(locale, 'readonly')); assert.ok(after.text.includes(expected.draft));
  assert.equal(await readFile(expected.file, 'utf8'), external);
  assert.equal(recovery.id, stored.id); assert.equal(recovery.snapshotSha256, stored.snapshotSha256);
  return { cancelledWithoutFile: true, nativeUi: true, path: output.path, bytes: output.size, sha256: output.sha256,
    originalUntouched: true, recoveryIdUnchanged: true, recoveryHashUnchanged: true, remainsReadonlyAndDirty: true };
}

async function inspectRecoveryLayout(client, logs, label, width, height) {
  await client.evaluate(`window.resizeTo(${width}, ${height})`);
  await waitFor(() => client.evaluate('({width:innerWidth,height:innerHeight})'),
    value => Math.abs(value.width - width) <= 2 && Math.abs(value.height - height) <= 2, 'actual package window dimensions');
  await pause(300);
  const result = await client.evaluate(`(() => {
    const panel = document.querySelector('.nmx-editor-recovery'), rect = panel?.getBoundingClientRect();
    if (!panel || !rect) return { missing: true };
    const buttons = [...panel.querySelectorAll('button'), ...document.querySelectorAll('.nmx-editor-recovery-status button')];
    const visible = node => {
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth + 1
        && box.top >= 0 && box.bottom <= innerHeight + 1 && Boolean(hit && node.contains(hit));
    };
    return { width: innerWidth, height: innerHeight, pageWidth: document.documentElement.scrollWidth,
      panel: { left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom, width:rect.width, height:rect.height,
        scrollWidth:panel.scrollWidth, clientWidth:panel.clientWidth }, buttons:buttons.length,
      visibleButtons:buttons.filter(visible).length };
  })()`);
  const capture = await client.call('Page.captureScreenshot', { format: 'png' });
  const screenshot = join(logs, `recovery-${label}.png`);
  await writeFile(screenshot, Buffer.from(capture.data, 'base64'), { flag: 'wx' });
  console.log(JSON.stringify({ event: 'editor_recovery_layout', label, ...result, screenshot }));
  assert.equal(result.missing, undefined); assert.ok(result.buttons >= 4);
  assert.equal(result.visibleButtons, result.buttons, 'Recovery and copy controls must remain visible and unobscured');
  assert.ok(result.pageWidth <= result.width + 1 && result.panel.scrollWidth <= result.panel.clientWidth + 1, 'Recovery layout must not overflow horizontally');
  assert.ok(result.panel.left >= 0 && result.panel.right <= result.width + 1 && result.panel.bottom <= result.height + 1);
  return { label, ...result, screenshot };
}

export async function runEditorRecoveryE2E(environment = process.env) {
  closeLaunchPlan(environment, resolve(tmpdir(), 'editor-recovery-check'), resolve(tmpdir(), 'editor-recovery-check/workspace'), 1);
  const text = recoveryText();
  const profile = await mkdtemp(join(tmpdir(), 'nextmux-editor-recovery-e2e-'));
  const workspace = join(profile, 'workspace'), state = join(profile, 'nextmux-state'), logs = join(profile, 'logs');
  await Promise.all([workspace, state, logs, join(profile, 'electron-user-data'), join(profile, 'theia-config')].map(path => mkdir(path, { recursive: true })));
  const filename = `recovery-${randomUUID()}.txt`, file = join(workspace, filename);
  const original = `ORIGINAL_${randomUUID()}`, draft = `UNSAVED_RECOVERY_${randomUUID()}`, external = `EXTERNAL_${randomUUID()}`;
  await writeFile(file, original, { flag: 'wx' });
  const expected = { name: filename, file, original, draft }, server = createEmptyLocalPlatformFixture();
  const children = [], clients = []; let cleanupPromise, primaryError, stopping = false;
  const cleanup = () => {
    stopping = true;
    return cleanupPromise ||= (async () => {
      for (const client of clients) try { client.socket.close(); } catch { /* owned target already closed */ }
      const outcomes = await Promise.allSettled([...children].reverse().map(terminateTree).concat((async () => {
        server.closeAllConnections(); if (server.listening) await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
      })()));
      const failed = outcomes.filter(item => item.status === 'rejected');
      if (failed.length) throw new AggregateError(failed.map(item => item.reason), 'RECOVERY_QA_OWNED_CLEANUP_FAILED');
    })();
  };
  const disposeSignals = installE2eSignalCleanup(cleanup);
  const report = { profile, executable: environment.NEXTMUX_PACKAGED_EXECUTABLE, platform: process.platform, arch: process.arch,
    syntheticOnly: true, nativeExits: [], originalSha256: fixtureHash(Buffer.from(original)), draftSha256: fixtureHash(Buffer.from(draft)) };
  process.stdout.write(`${JSON.stringify({ event: 'editor_recovery_profile', profile, logs })}\n`);
  try {
    await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const env = { ...environment, NEXTMUX_PLATFORM_API_URL: endpoint, NEXTMUX_PUBLIC_APP_URL: endpoint,
      NEXTMUX_DESKTOP_STATE_DIR: state, NEXTMUX_AGENT_STATE_DIR: state, THEIA_CONFIG_DIR: join(profile, 'theia-config'),
      NEXTMUX_DESKTOP_E2E_ISOLATED: '1', NEXTMUX_DESKTOP_E2E_PROFILE_DIR: profile, NEXTMUX_E2E_WORKSPACE: workspace,
      ...(process.platform === 'win32' ? { LOCALAPPDATA: join(profile, 'local-app-data'), APPDATA: join(profile, 'roaming-app-data') }
        : { XDG_DATA_HOME: join(profile, 'xdg-data'), XDG_CONFIG_HOME: join(profile, 'xdg-config') }) };
    assertDisposableDesktopE2E(env);
    async function launch(round) {
      if (stopping) throw new Error('RECOVERY_QA_STOPPING');
      const port = await freePort(), plan = closeLaunchPlan(env, profile, workspace, port);
      const child = launchOwnedE2eProcess(plan.command, plan.args, { env, stdout: join(logs, `app-${round}.stdout.log`), stderr: join(logs, `app-${round}.stderr.log`) });
      children.push(child); await waitForPort(port, 90000, child);
      const client = await attachCloseObserver(port, { child, executable: plan.command }); clients.push(client);
      return { child, client, executable: plan.command };
    }
    async function quit(app, round) {
      const cancelled = app.client.events.filter(event => event.kind === 'cancelled').length;
      await requestQuit(app.client, process.platform);
      await waitFor(() => ({ code: app.child.exitCode, signal: app.child.signalCode }), value => value.code !== null || value.signal !== null, 'natural exit');
      assert.equal(app.child.exitCode, 0); assert.equal(app.child.signalCode, null);
      assert.equal(app.client.events.filter(event => event.kind === 'cancelled').length, cancelled);
      assert.equal(app.client.dialogs.length, 0);
      report.nativeExits.push({ round, code: 0, signal: null });
      await terminateTree(app.child);
    }
    const first = await launch(1), client = first.client;
    await click(client, '[data-desktop-section="coding"]');
    await waitFor(() => client.evaluate(`Boolean(document.querySelector('.nmx-composer textarea:not(:disabled)'))`), Boolean, 'composer mounted');
    await client.evaluate(`document.querySelector('.nmx-composer textarea')?.focus()`);
    await client.call('Input.insertText', { text: `UNSENT_FILE_RECOVERY_OWNER_${randomUUID()}` });
    await waitFor(() => client.evaluate(`Boolean(document.querySelector('.nmx-thread-files header button:not(:disabled)'))`), Boolean, 'file rail');
    await click(client, '.nmx-thread-files header button:not(:disabled)');
    const selector = `.nmx-thread-file-row[aria-label="${filename}"]`;
    await waitFor(() => client.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), Boolean, 'exact synthetic file');
    await click(client, selector);
    await waitFor(() => view(client), value => value.name === filename && value.text.includes(original), 'original Monaco content');
    await focusEditor(client); await keys(client, 'selectAll'); await client.call('Input.insertText', { text: draft });
    await waitFor(() => view(client), value => value.dirty && value.text.includes(draft) && value.status === text(value.locale, 'saved'), 'actual local backup acknowledgement');
    const stored = await waitFor(() => readOwnedEditorRecovery(profile, expected), Boolean, 'actual recovery bytes on disk');
    assert.equal(await readFile(file, 'utf8'), original);
    report.backup = { id: stored.id, revision: stored.revision, snapshotSha256: stored.snapshotSha256, originalUntouched: true };
    await quit(first, 1);
    const second = await launch(2);
    await waitFor(() => view(second.client), value => value.name === filename && value.dirty && value.text.includes(draft), 'unsaved editor restored after whole-process restart');
    assert.equal(await readFile(file, 'utf8'), original);
    const restarted = await readOwnedEditorRecovery(profile, expected);
    assert.equal(restarted.id, stored.id); assert.equal(restarted.snapshotSha256, stored.snapshotSha256);
    report.restart = { unsavedDraftRestored: true, originalUntouched: true, sameRecoveryId: true };
    await quit(second, 2);
    report.externalChange = await replaceOwnedEditorFixture(profile, file, original, external);
    const third = await launch(3), restored = third.client;
    await waitFor(() => view(restored), value => value.name === filename && value.dirty && value.text.includes(draft)
      && value.status === text(value.locale, 'readonly'), 'changed-source recovery is read only');
    await focusEditor(restored); await keys(restored, 'selectAll');
    await restored.call('Input.insertText', { text: 'MUST_NOT_WRITE_READONLY_RECOVERY' }); await keys(restored, 'save');
    await pause(500);
    const readOnly = await view(restored);
    assert.ok(readOnly.text.includes(draft)); assert.equal(readOnly.text.includes('MUST_NOT_WRITE_READONLY_RECOVERY'), false);
    assert.equal(readOnly.savePrompt, false); assert.equal(await readFile(file, 'utf8'), external);
    report.readOnly = { draftPreserved: true, sourceNotOverwritten: true, noOverwriteDialog: true };
    report.saveAs = await verifyRecoverySaveAs(third, { profile, workspace, expected, external, stored, text });
    // Copy is present but the real system clipboard is shared with the user.
    // Do not read or replace it as part of this isolated-profile test.
    report.clipboard = { verified: false, reason: 'shared_system_clipboard_not_modified' };
    await click(restored, '.nmx-editor-recovery-status button[aria-expanded]');
    const panel = await waitFor(() => view(restored), value => value.keys.length === 1, 'single exact recovery copy');
    assert.equal(panel.keys[0], stored.id, 'Fresh-process panel must identify the exact durable record');
    const originalWindow = await restored.evaluate('({width:innerWidth,height:innerHeight})');
    report.layouts = [];
    try {
      report.layouts.push(await inspectRecoveryLayout(restored, logs, 'normal', 1180, 760));
      report.layouts.push(await inspectRecoveryLayout(restored, logs, 'small', 980, 680));
    } finally { await restored.evaluate(`window.resizeTo(${originalWindow.width}, ${originalWindow.height})`); }
    await click(restored, '.nmx-editor-recovery [data-recovery-key] > nav button:last-child');
    await waitFor(() => restored.evaluate(`Boolean(document.querySelector('.nmx-editor-recovery-confirm'))`), Boolean, 'inline delete confirmation');
    assert.ok(await readOwnedEditorRecovery(profile, expected), 'First click must not delete the copy');
    assert.equal(await readFile(file, 'utf8'), external);
    await click(restored, '.nmx-editor-recovery-confirm .is-danger');
    await waitFor(() => readOwnedEditorRecovery(profile, expected), value => value === undefined, 'explicitly confirmed copy discarded');
    await waitFor(() => view(restored), value => !value.keys.length && !value.dirty, 'discard acknowledged by UI');
    assert.equal(await readFile(file, 'utf8'), external);
    report.discard = { secondConfirmationRequired: true, onlyCopyDeleted: true, originalStillExists: true };
    await quit(third, 3);
    assert.equal(server.nonGetRequests, 0); report.localPlatformNonGetRequests = 0; report.pass = true;
    await writeFile(join(logs, 'editor-recovery-result.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { primaryError = error; }
  finally { try { await finishE2eRun(cleanup, primaryError); } finally { disposeSignals(); } }
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runEditorRecoveryE2E();
