import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { fixtureHash } from './desktop-attachment-owner-files.mjs';
import { readOwnedEditorRecovery, replaceOwnedEditorFixture } from './desktop-editor-recovery-files.mjs';
import { assertNewRecoveryDestination, nativeRecoverySaveDialog } from './desktop-editor-recovery-e2e.mjs';

async function fixture() {
  const profile = await mkdtemp(join(tmpdir(), 'nextmux-editor-recovery-contract-'));
  const workspace = join(profile, 'workspace'), records = join(profile, 'nextmux-state', 'file-editor-recovery-v1');
  await Promise.all([mkdir(workspace), mkdir(records, { recursive: true })]);
  const file = join(workspace, 'synthetic.txt'), expected = { name: 'synthetic.txt', file, original: 'ORIGINAL_SYNTHETIC', draft: 'DRAFT_SYNTHETIC' };
  await writeFile(file, expected.original, { flag: 'wx' });
  const snapshot = { sourceUri: pathToFileURL(file).href, name: expected.name, baseline: { current: expected.original }, drafts: { current: expected.draft } };
  const record = { id: randomUUID(), version: 1, revision: 1, snapshot, snapshotSha256: fixtureHash(Buffer.from(JSON.stringify(snapshot))) };
  return { profile, file, expected, record, recordFile: join(records, `${record.id}.json`) };
}

test('actual recovery record reader checks bytes/hash and returns metadata only from the owned synthetic directory', async () => {
  const f = await fixture();
  try {
    assert.equal(await readOwnedEditorRecovery(f.profile, f.expected), undefined);
    await writeFile(f.recordFile, JSON.stringify(f.record), { flag: 'wx' });
    const actual = await readOwnedEditorRecovery(f.profile, f.expected);
    assert.equal(actual.id, f.record.id); assert.equal(actual.snapshotSha256, f.record.snapshotSha256);
    assert.doesNotMatch(JSON.stringify(actual), /ORIGINAL_SYNTHETIC|DRAFT_SYNTHETIC/);
    await assert.rejects(readOwnedEditorRecovery(f.profile, { ...f.expected, draft: 'OTHER_SYNTHETIC' }));
    const wrong = { ...f.record.snapshot, sourceUri: 'file:///never-read-another-owner.txt' };
    await writeFile(f.recordFile, JSON.stringify({ ...f.record, snapshot: wrong, snapshotSha256: fixtureHash(Buffer.from(JSON.stringify(wrong))) }));
    await assert.rejects(readOwnedEditorRecovery(f.profile, f.expected), /WRONG_SOURCE/);
    await writeFile(f.recordFile, JSON.stringify({ ...f.record, snapshotSha256: 'f'.repeat(64) }));
    await assert.rejects(readOwnedEditorRecovery(f.profile, f.expected));
  } finally { await rm(f.profile, { recursive: true }); }
});

test('package layout checks use actual resized windows and screenshots without touching the shared clipboard', async () => {
  const source = await readFile(new URL('./desktop-editor-recovery-e2e.mjs', import.meta.url), 'utf8');
  assert.match(source, /window\.resizeTo/); assert.match(source, /'normal', 1180, 760/); assert.match(source, /'small', 980, 680/);
  assert.match(source, /visibleButtons, result\.buttons/); assert.match(source, /Page\.captureScreenshot/);
  assert.match(source, /button\[aria-expanded\]/, 'Do not accidentally click the new Copy button');
  assert.doesNotMatch(source, /clipboard\.(?:read|write)|clipboardService\.(?:read|write)/);
  assert.match(source, /shared_system_clipboard_not_modified/);
});

test('record reader refuses a symlink instead of treating external data as a local backup', async () => {
  const f = await fixture();
  try {
    await symlink(f.file, f.recordFile);
    await assert.rejects(readOwnedEditorRecovery(f.profile, f.expected), /RECOVERY_QA_UNSAFE_RECORD/);
    assert.equal(await readFile(f.file, 'utf8'), f.expected.original);
  } finally { await rm(f.profile, { recursive: true }); }
});

test('external source-change fixture alters only verified original bytes and records before/after hashes', async () => {
  const f = await fixture();
  try {
    const evidence = await replaceOwnedEditorFixture(f.profile, f.file, f.expected.original, 'EXTERNAL_SYNTHETIC');
    assert.equal(evidence.beforeSha256, fixtureHash(Buffer.from(f.expected.original)));
    assert.equal(evidence.afterSha256, fixtureHash(Buffer.from('EXTERNAL_SYNTHETIC')));
    assert.equal(await readFile(f.file, 'utf8'), 'EXTERNAL_SYNTHETIC');
    await assert.rejects(replaceOwnedEditorFixture(f.profile, f.file, f.expected.original, 'UNEXPECTED'));
    assert.equal(await readFile(f.file, 'utf8'), 'EXTERNAL_SYNTHETIC');
    const link = join(f.profile, 'shortcut'); await symlink(f.file, link);
    await assert.rejects(replaceOwnedEditorFixture(f.profile, link, 'EXTERNAL_SYNTHETIC', 'NO_SYMLINK_WRITE'), /SYMLINK/);
  } finally { await rm(f.profile, { recursive: true }); }
});

test('package-only E2E keeps native exits, normal unsaved input and read-only/no-overwrite/delete-confirmation assertions', async () => {
  const script = fileURLToPath(new URL('./desktop-editor-recovery-e2e.mjs', import.meta.url));
  const failed = await promisify(execFile)(process.execPath, [script], { env: { PATH: process.env.PATH }, timeout: 10000 })
    .then(() => assert.fail('must not launch development fallback'), error => error);
  assert.match(failed.stderr, /REQUIRES_ABSOLUTE_PACKAGED_EXECUTABLE/);
  assert.doesNotMatch(failed.stdout, /editor_recovery_profile/);
  const source = await readFile(script, 'utf8');
  assert.match(source, /assertDisposableDesktopE2E\(env\)/);
  assert.match(source, /attachCloseObserver\(port, \{ child, executable: plan\.command \}\)/);
  assert.match(source, /await requestQuit\(app\.client, process\.platform\)/);
  assert.match(source, /app\.child\.exitCode, 0/); assert.match(source, /app\.child\.signalCode, null/);
  assert.ok(source.indexOf('await quit(second, 2)') < source.indexOf('await replaceOwnedEditorFixture('));
  assert.ok(source.indexOf('const second = await launch(2)') < source.indexOf("await keys(restored, 'save')"), 'No explicit source Save before backup/restart proof');
  assert.match(source, /readOnly\.savePrompt, false/);
  assert.match(source, /First click must not delete the copy/);
  assert.match(source, /server\.nonGetRequests, 0/);
  assert.doesNotMatch(source, /window\.close\(|beginPrepareClose|completePrepareClose|\.setValue\(|\.undo\(/);
});

test('native Save As driver checks exact process identity before and after focus and refuses changed ownership', () => {
  const child = { pid: 812345, exitCode: null, signalCode: null }, executable = '/synthetic/NextMux.app/Contents/MacOS/NextMux';
  const original = { pid: child.pid, zombie: false, identity: `501\0start-time\0${executable}` };
  const target = { defaultName: 'NextMux-Recovered-synthetic.txt', outputName: 'new-synthetic.txt',
    directory: '/synthetic/profile/workspace', sourceName: 'synthetic.txt', saveLabel: 'Save as new file' };
  const commands = [];
  const driver = nativeRecoverySaveDialog(child, executable, target, { snapshot: () => [original], run: source => { commands.push(source); return 'ready'; } });
  assert.equal(driver.inspect(), 'ready'); assert.equal(commands.length, 2);
  assert.match(commands[0], /unix id is 812345/); assert.match(commands[1], /QA_TARGET_NOT_FRONTMOST/);
  assert.match(commands[1], /NextMux-Recovered-synthetic\.txt/); assert.match(commands[1], /count of qaFields\) is not 1/);
  assert.doesNotMatch(commands.join('\n'), /tell application "NextMux"|clipboard|do shell script/);
  child.exitCode = 0; assert.throws(() => driver.save(), /TARGET_CHANGED/); assert.equal(commands.length, 2);
  child.exitCode = null; let reads = 0, effects = 0;
  const changed = nativeRecoverySaveDialog(child, executable, target, {
    snapshot: () => [++reads < 3 ? original : { ...original, identity: `501\0reused-time\0${executable}` }], run: () => { effects++; }
  });
  assert.throws(() => changed.cancel(), /TARGET_CHANGED/); assert.equal(effects, 1, 'no key after PID/start identity changed during focus');
  assert.throws(() => nativeRecoverySaveDialog(child, executable, target, { snapshot: () => [{ ...original, zombie: true }] }), /TARGET_UNVERIFIED/);
  assert.throws(() => nativeRecoverySaveDialog(child, executable, { ...target, outputName: '../escape.txt' }, { snapshot: () => [original] }), /DESTINATION/);
});

test('native Save As plan selects the owned folder, verifies its unique source file and never fabricates a picker response', () => {
  const executable = '/synthetic/NextMux.app/Contents/MacOS/NextMux', commands = [];
  const driver = nativeRecoverySaveDialog({ pid: 812346, exitCode: null, signalCode: null }, executable,
    { defaultName: 'NextMux-Recovered-fixture.txt', outputName: 'recovered-new.txt', directory: '/synthetic/profile/workspace',
      sourceName: 'fixture.txt', saveLabel: '另存为新文件' },
    { snapshot: () => [{ pid: 812346, zombie: false, identity: `501\0start\0${executable}` }], run: source => { commands.push(source); return 'ready'; } });
  driver.cancel(); driver.prepareName(); driver.inspectDestination(); driver.save();
  const text = commands.join('\n');
  assert.match(text, /key code 53/); assert.doesNotMatch(text, /keystroke "g"|key code 36/);
  assert.match(text, /set value of \(item 1 of qaFields\) to "recovered-new.txt"/);
  assert.match(text, /UI elements of \(last item of qaColumns\)/);
  assert.doesNotMatch(text, /entire contents/);
  assert.match(text, /count of qaFileElements\) > 100/);
  assert.doesNotMatch(text, /AXFocusedUIElement/);
  assert.match(text, /qaOwnedSourceVisible/); assert.match(text, /unverified-directory/);
  assert.match(text, /name of qaElement is "另存为新文件"/);
  assert.match(text, /attribute "AXIdentifier" of qaElement is "OKButton"/);
  assert.match(text, /click \(item 1 of qaSaveButtons\)/);
  assert.match(text, /AXDisclosureTriangle/); assert.match(text, /count of qaDisclosures\) is not 1/);
  assert.doesNotMatch(text, /NSAppleScript|saveEditorDraftAsNewFile|fileDialogService|clipboard|writeFile/);
});

test('mac native save-sheet scripts compile without executing any UI action', { skip: process.platform !== 'darwin' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nextmux-save-dialog-compile-')), programs = [];
  const executable = '/synthetic/NextMux.app/Contents/MacOS/NextMux';
  const driver = nativeRecoverySaveDialog({ pid: 812347, exitCode: null, signalCode: null }, executable,
    { defaultName: 'NextMux-Recovered-fixture.txt', outputName: 'new-fixture.txt', directory: '/synthetic/profile/workspace',
      sourceName: 'fixture.txt', saveLabel: 'Save as new file' },
    { snapshot: () => [{ pid: 812347, zombie: false, identity: `501\0start\0${executable}` }], run: source => { programs.push(source); return 'ready'; } });
  driver.describeWindows(); driver.describe(); driver.inspect(); driver.cancel(); driver.prepareName(); driver.inspectDestination(); driver.save();
  try {
    for (const [index, program] of [...new Set(programs)].entries()) {
      await promisify(execFile)('/usr/bin/osacompile', ['-o', join(directory, `program-${index}.scpt`), '-e', program], { timeout: 10000 });
    }
  } finally { await rm(directory, { recursive: true }); }
});

test('new export destination must be absent inside the exact owned workspace, never an existing file or symlink', async () => {
  const f = await fixture();
  try {
    const workspace = join(f.profile, 'workspace'), destination = join(workspace, 'new-recovery.txt');
    await assertNewRecoveryDestination(f.profile, workspace, destination);
    await writeFile(destination, 'KEEP_SYNTHETIC', { flag: 'wx' });
    await assert.rejects(assertNewRecoveryDestination(f.profile, workspace, destination), /DESTINATION_EXISTS/);
    assert.equal(await readFile(destination, 'utf8'), 'KEEP_SYNTHETIC');
    await assert.rejects(assertNewRecoveryDestination(f.profile, workspace, join(f.profile, 'outside.txt')), /OUTSIDE_WORKSPACE/);
    await symlink(workspace, join(f.profile, 'linked-workspace'));
    await assert.rejects(assertNewRecoveryDestination(f.profile, join(f.profile, 'linked-workspace'), join(f.profile, 'linked-workspace', 'new.txt')), /EXACT_WORKSPACE/);
  } finally { await rm(f.profile, { recursive: true }); }
});

test('package Save As sequence uses the visible button and native picker, proves cancellation and preserves source/recovery/read-only state', async () => {
  const source = await readFile(new URL('./desktop-editor-recovery-e2e.mjs', import.meta.url), 'utf8');
  assert.match(source, /report\.saveAs = await verifyRecoverySaveAs\(third/);
  assert.match(source, /window\.electronTheiaCore\?\.useNativeElements === true/);
  assert.doesNotMatch(source, /THEIA_ELECTRON_DISABLE_NATIVE_ELEMENTS/);
  assert.match(source, /controls\.cancel\(\), 'cancelled'/);
  assert.match(source, /Cancel must not create an exported file/);
  assert.match(source, /verifiedFixtureAttachment\(profile, \{ uri: pathToFileURL\(destination\)/);
  assert.match(source, /after\.dirty, true/); assert.match(source, /after\.status, text\(locale, 'readonly'\)/);
  assert.match(source, /recovery\.id, stored\.id/); assert.match(source, /recovery\.snapshotSha256, stored\.snapshotSha256/);
  assert.doesNotMatch(source, /platformService\.|\.showSaveDialog\(|\.saveEditorDraftAsNewFile\(|\.saveContextEditorRecoveryAsNewFile\(/);
});
