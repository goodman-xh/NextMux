import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { bounded, closeLaunchPlan, closeObservation, closeShortcutPlan, nativeQuitForOwnedProcess, readDurableDraft, recoveryPrivacyUi, requestQuit } from './desktop-close-persistence-e2e.mjs';

test('close regression requires an exact package and only changes the workspace to its own profile child', () => {
  const profile = join(tmpdir(), 'nextmux-close-plan'), workspace = join(profile, 'workspace');
  const plan = closeLaunchPlan({ NEXTMUX_PACKAGED_EXECUTABLE: process.execPath }, profile, workspace, 13579);
  assert.equal(plan.kind, 'packaged'); assert.equal(plan.command, process.execPath);
  assert.deepEqual(plan.args, [workspace, '--remote-debugging-port=13579',
    `--user-data-dir=${join(profile, 'electron-user-data')}`, `--electronUserData=${join(profile, 'electron-user-data')}`]);
  for (const value of [undefined, '', './NextMux']) assert.throws(() => closeLaunchPlan({ NEXTMUX_PACKAGED_EXECUTABLE: value },
    profile, workspace, 13579), /REQUIRES_ABSOLUTE_PACKAGED_EXECUTABLE/);
  for (const value of [profile, tmpdir()]) assert.throws(() => closeLaunchPlan({ NEXTMUX_PACKAGED_EXECUTABLE: process.execPath },
    profile, value, 13579), /WORKSPACE_NOT_ISOLATED/);
  assert.throws(() => closeLaunchPlan({ NEXTMUX_PACKAGED_EXECUTABLE: join(profile, 'missing-executable') }, profile, workspace, 13579),
    /refusing development fallback/);
});

test('native quit shortcut uses Command on macOS and Control on Windows/Linux with balanced key release', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    const plan = closeShortcutPlan(platform), modifier = platform === 'darwin' ? 4 : 2;
    assert.equal(plan.length, 4); assert.equal(plan[0].modifiers, modifier);
    assert.deepEqual(plan.slice(1, 3).map(({ type, key, code, windowsVirtualKeyCode, modifiers }) =>
      ({ type, key, code, windowsVirtualKeyCode, modifiers })), ['rawKeyDown', 'keyUp'].map(type =>
      ({ type, key: 'q', code: 'KeyQ', windowsVirtualKeyCode: 81, modifiers: modifier })));
    assert.equal(plan.at(-1).modifiers, 0); assert.equal(plan.at(-1).type, 'keyUp');
  }
  assert.throws(() => closeShortcutPlan('unknown'), /Unsupported/);
});

test('CDP wrappers are bounded and preserve the actual failure rather than a fake success', async () => {
  assert.equal(await bounded(Promise.resolve(42), 1000, 'success'), 42);
  const error = new Error('synthetic failure');
  await assert.rejects(bounded(Promise.reject(error), 1000, 'failure'), value => value === error);
  await assert.rejects(bounded(new Promise(() => {}), 10, 'fixture wait'), /CLOSE_E2E_TIMEOUT: fixture wait/);
});

test('close observation uses only the test clock, not a renderer timestamp or private event fields', () => {
  const message = { method: 'Runtime.consoleAPICalled', params: { args: [
    { value: '__NEXTMUX_CLOSE_E2E__' }, { value: JSON.stringify({ kind: 'offered', observedAt: -1, token: 'private-ignored' }) }
  ] } };
  assert.deepEqual(closeObservation(message, 12345), { kind: 'offered', observedAt: 12345 });
  message.params.args[1].value = JSON.stringify({ kind: 'offered', attempt: 2, token: 'private-ignored' });
  assert.deepEqual(closeObservation(message, 12346), { kind: 'offered', attempt: 2, observedAt: 12346 });
  for (const attempt of [-1, 0, 1.5, 65, '2']) {
    message.params.args[1].value = JSON.stringify({ kind: 'offered', attempt });
    assert.deepEqual(closeObservation(message, 12347), { kind: 'offered', observedAt: 12347 });
  }
  assert.equal(closeObservation({ method: 'Runtime.consoleAPICalled', params: { args: [{ value: 'other' }] } }, 12345), undefined);
  message.params.args[1].value = JSON.stringify({ kind: 'cancelled', reason: 'unknown' });
  assert.equal(closeObservation(message, 12345), undefined);
});

test('observed offer time survives pending key-up followed by CDP disconnection', async () => {
  let release, finished = false;
  const keyUp = new Promise((_, reject) => { release = () => reject(new Error('synthetic key-up disconnected')); });
  const offer = { kind: 'offered', observedAt: 1000 };
  const client = { events: [], call: async (_method, event) => {
    if (event.type === 'rawKeyDown' && event.code === 'KeyQ') client.events.push(offer);
    if (event.type === 'keyUp' && event.code === 'KeyQ') return keyUp;
  } };
  const operation = requestQuit(client, 'win32').then(value => { finished = true; return value; });
  await new Promise(done => setImmediate(done));
  assert.equal(finished, false, 'The key-up call is still pending after the offer was observed');
  release();
  const result = await operation;
  assert.equal(result, offer);
  assert.equal(result.observedAt - 900, 100, 'Timing is the offer observation, not the later key-up failure');
});

test('passive CDP binding sees close even when Theia replaces console, and ignores unrelated/oversized payloads', () => {
  const message = { method: 'Runtime.bindingCalled', params: { name: '__nextmuxCloseE2eObserve', payload: JSON.stringify({ kind: 'offered' }) } };
  assert.deepEqual(closeObservation(message, 23), { kind: 'offered', observedAt: 23 });
  message.params.payload = JSON.stringify({ kind: 'cancelled', reason: 'failed', token: 'ignored' });
  assert.deepEqual(closeObservation(message, 24), { kind: 'cancelled', reason: 'failed', observedAt: 24 });
  message.params.name = 'other'; assert.equal(closeObservation(message), undefined);
  message.params.name = '__nextmuxCloseE2eObserve'; message.params.payload = 'x'.repeat(257);
  assert.equal(closeObservation(message), undefined);
});

test('mac native Cmd+Q revalidates the exact launched PID identity after focus and never falls back', async () => {
  const child = { pid: 424242, exitCode: null, signalCode: null }, executable = '/synthetic/NextMux.app/Contents/MacOS/NextMux';
  let row = { pid: child.pid, identity: `uid\0start\0${executable}`, zombie: false }; const calls = [];
  const driver = nativeQuitForOwnedProcess(child, executable, { snapshot: () => [row], run: source => calls.push(source) });
  driver(); assert.equal(calls.length, 2); assert.ok(calls.every(source => source.includes('unix id is 424242')));
  assert.match(calls[1], /frontmost/); assert.match(calls[1], /key code 12 using \{command down\}/);
  const changed = nativeQuitForOwnedProcess(child, executable, { snapshot: () => [row], run: () => { row = { ...row, identity: `uid\0other-start\0${executable}` }; } });
  assert.throws(changed, /TARGET_CHANGED/);
  assert.throws(() => nativeQuitForOwnedProcess(child, '/different', { snapshot: () => [row] }), /TARGET_UNVERIFIED/);
  const denied = nativeQuitForOwnedProcess(child, executable, { snapshot: () => [row], run: () => { throw new Error('not authorized'); } });
  await assert.rejects(requestQuit({ events: [], nativeQuit: denied }, 'darwin'), /not authorized/);
  await assert.rejects(requestQuit({ events: [], call() { assert.fail('no CDP fallback'); } }, 'darwin'), /DRIVER_REQUIRED/);
});

test('durable draft assertion reads the real backend file and rejects traversal and oversized fixture manifests', async t => {
  const state = await mkdtemp(join(tmpdir(), 'nextmux-close-durable-test-'));
  t.after(() => rm(state, { recursive: true, force: true }));
  assert.equal(await readDurableDraft(state, 'sentinel'), undefined);
  const directory = join(state, 'conversation-history-v1'); await mkdir(directory);
  const manifest = join(directory, 'manifest-v1.json');
  await writeFile(join(directory, 'session.json'), JSON.stringify({ id: 'fixture', draftPrompt: 'sentinel', turns: [] }));
  await writeFile(manifest, JSON.stringify({ sessions: [{ file: 'session.json' }] }));
  assert.deepEqual(await readDurableDraft(state, 'sentinel'), { id: 'fixture', draftMatches: true, turns: 0 });
  assert.equal(await readDurableDraft(state, 'different'), undefined);
  await writeFile(manifest, JSON.stringify({ sessions: [{ file: '../../not-a-fixture.json' }] }));
  await assert.rejects(readDurableDraft(state, 'sentinel'), /must remain inside QA state/);
  await writeFile(manifest, JSON.stringify({ sessions: Array.from({ length: 33 }, () => ({ file: 'session.json' })) }));
  await assert.rejects(readDurableDraft(state, 'sentinel'), /Bounded isolated session manifest/);
});

test('CLI without a package fails before allocating a profile or launching Electron', async () => {
  await assert.rejects(promisify(execFile)(process.execPath, [fileURLToPath(new URL('./desktop-close-persistence-e2e.mjs', import.meta.url))], {
    env: { PATH: process.env.PATH, TMPDIR: tmpdir(), TEMP: tmpdir(), TMP: tmpdir() }, timeout: 5000,
  }), error => {
    assert.equal(error.code, 1); assert.match(error.stderr, /REQUIRES_ABSOLUTE_PACKAGED_EXECUTABLE/);
    assert.doesNotMatch(error.stdout, /close_e2e_profile|qa_desktop_launch/); return true;
  });
});

test('privacy opt-out clicks only the uniquely labelled real checkbox and preserves every other setting', () => {
  const clicks = [], save = { disabled: true }, labels = ['Recovery copies for unsaved files'];
  const row = (label, checked) => {
    const input = { checked, disabled: false, click() { clicks.push(label); this.checked = !this.checked; save.disabled = false; } };
    return { input, querySelector: selector => selector === 'strong' ? { textContent: label } : selector === 'input[type="checkbox"]' ? input : null };
  };
  const rows = [row('Zero retention', false), row('Deny collection', true), row('Save history', true), row(labels[0], true)];
  const panel = { querySelectorAll: () => rows, querySelector: selector => selector === '.nmx-settings-actions button.is-primary' ? save : null };
  const document = { body: { inert: false }, querySelector: () => panel };
  assert.deepEqual(recoveryPrivacyUi(document, labels), { checked: true, disabled: false, saveDisabled: true, failed: false, otherChecks: [false, true, true] });
  assert.deepEqual(recoveryPrivacyUi(document, labels, 'disable'), { checked: false, disabled: false, saveDisabled: false, failed: false, otherChecks: [false, true, true] });
  assert.deepEqual(clicks, labels);
  assert.throws(() => recoveryPrivacyUi(document, labels, 'disable'), /NOT_ENABLED/);
  rows[3].input.checked = true; rows[3].input.disabled = true;
  assert.throws(() => recoveryPrivacyUi(document, labels, 'disable'), /NOT_ENABLED/);
  assert.throws(() => recoveryPrivacyUi(document, ['unknown label']), /NOT_UNIQUE/);
  rows.push(row(labels[0], true)); assert.throws(() => recoveryPrivacyUi(document, labels), /NOT_UNIQUE/);
  document.body.inert = true; assert.equal(recoveryPrivacyUi(document, labels, 'disable'), undefined);
  assert.deepEqual(clicks, labels, 'No forced toggle on disabled, ambiguous or inert controls');
});

test('real flow retains safe cleanup, explicit save and observer-only close instrumentation', async () => {
  const source = await readFile(new URL('./desktop-close-persistence-e2e.mjs', import.meta.url), 'utf8');
  assert.match(source, /launchOwnedE2eProcess\(plan\.command, plan\.args/);
  assert.match(source, /installE2eSignalCleanup\(cleanup\)/);
  assert.match(source, /finishE2eRun\(cleanup, primaryError\)/);
  assert.match(source, /finally \{ disposeSignals\(\); \}/);
  assert.match(source, /await terminateTree\(first\.child\)/);
  assert.match(source, /desktopEditorShortcutPlan\('save', process\.platform\)/);
  assert.match(source, /assert\.equal\(child\.signalCode, null/);
  assert.match(source, /assert\.equal\(child\.exitCode, 0/);
  assert.doesNotMatch(source, /completePrepareClose\(|beginPrepareClose\(|window\.close\(|taskkill|process\.kill|SIGKILL|keytar/);
  assert.match(source, /window\.nextmuxDesktop\.onPrepareClose\(token => log/);
  assert.match(source, /readDurableDraft\(state, draft\)/);
  assert.match(source, /exact restored unsent draft/);
  assert.match(source, /Cancelled exit must not overwrite the project file/);
  assert.match(source, /evidence\.file\.recoveryOptOut = await disableFileRecoveryThroughPrivacyUi\(second\.client, state\)/);
  assert.ok(source.indexOf('evidence.file.recoveryOptOut =') < source.indexOf("text: changed"), 'Opt-out is acknowledged before the first file edit');
  assert.match(source, /recovery-only change enables Save/);
  assert.match(source, /No other privacy option was changed to force a Save/);
  assert.match(source, /saveFileEditorRecovery === false/);
  assert.match(source, /privacy-settings-v1\.json/);
  assert.doesNotMatch(source, /platformService\.savePrivacySettings|\.setPrivacyDraft\(|\.privacyDraft\s*=|localStorage\.setItem/);
});
