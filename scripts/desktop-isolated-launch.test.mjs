import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { desktopLaunchCommand, freePort, launchOwnedE2eProcess, runForeground, terminateTree, waitForPort } from './desktop-attachment-file-e2e-harness.mjs';
import { readE2eProcessSnapshot } from './desktop-terminal-ci-e2e.mjs';

const fixtureEnvironment = () => ({ PATH: process.env.PATH, TMPDIR: tmpdir(), TEMP: tmpdir(), TMP: tmpdir(),
  ...(process.env.SystemRoot || process.env.SYSTEMROOT ? { SystemRoot: process.env.SystemRoot || process.env.SYSTEMROOT } : {}) });

test('isolated attachment, file, restart and queue launch use the exact requested package without development fallback', () => {
  const plan = desktopLaunchCommand({ cdpPort: 12345, electronProfile: '/qa profile/isolated',
    environment: { NEXTMUX_PACKAGED_EXECUTABLE: process.execPath } });
  assert.equal(plan.kind, 'packaged');
  assert.equal(plan.command, process.execPath);
  assert.equal(plan.args.length, 4);
  assert.equal(plan.args[0], fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, ''));
  assert.deepEqual(plan.args.slice(1), ['--remote-debugging-port=12345',
    '--user-data-dir=/qa profile/isolated', '--electronUserData=/qa profile/isolated']);
  assert.ok(!plan.args.includes('start'));
  assert.throws(() => desktopLaunchCommand({ cdpPort: 12345, electronProfile: '/qa',
    environment: { NEXTMUX_PACKAGED_EXECUTABLE: join(tmpdir(), 'nextmux-nonexistent-package-28df3214') } }), /refusing development fallback/);
});

test('development launches remain explicit and preserve both Chromium and Theia profile boundaries', () => {
  const plan = desktopLaunchCommand({ cdpPort: 12346, electronProfile: '/qa', environment: {} });
  assert.equal(plan.kind, 'development');
  assert.match(plan.command, /[\\/]electron[\\/]dist[\\/]/);
  assert.equal(plan.args[0], fileURLToPath(new URL('../apps/desktop', import.meta.url)));
  assert.equal(plan.args[1], fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, ''));
  assert.equal(plan.args.includes('start'), false, 'package-manager argument forwarding cannot drop the NextMux application path');
  assert.ok(plan.args.includes('--user-data-dir=/qa'));
  assert.ok(plan.args.includes('--electronUserData=/qa'));
});

test('source restarts keep a requested synthetic workspace, including spaces, as one argument', () => {
  const workspace = join(tmpdir(), 'NextMux synthetic workspace');
  const plan = desktopLaunchCommand({ cdpPort: 12346, electronProfile: '/qa profile', environment: { NEXTMUX_E2E_WORKSPACE: workspace } });
  assert.equal(plan.args[1], workspace);
  assert.ok(plan.args.includes('--user-data-dir=/qa profile'));
});

test('queue and restart reuse the same package-aware launch helper instead of shadowing it', async () => {
  const queue = await readFile(new URL('./desktop-agent-queue-fixture.mjs', import.meta.url), 'utf8');
  const restart = await readFile(new URL('./desktop-restart-persistence-e2e.mjs', import.meta.url), 'utf8');
  assert.match(queue, /import \{[^}]*desktopLaunchCommand[^}]*\} from '\.\/desktop-attachment-file-e2e-harness\.mjs'/);
  assert.doesNotMatch(queue, /function desktopLaunchCommand|spawn\(|taskkill|process\.kill/);
  assert.match(queue, /desktopLaunchCommand\(\{ cdpPort, electronProfile: electronUserDataDirectory, environment \}\)/);
  assert.doesNotMatch(queue, /function waitForPort/);
  assert.match(queue, /waitForPort\(qaPort, 15_000, qa\)/);
  assert.match(queue, /waitForPort\(cdpPort, 90_000, app\)/);
  assert.match(queue, /installE2eSignalCleanup\(\(\) => \{ interrupted = true; return cleanup\(\); \}\)/);
  assert.match(queue, /finally \{ disposeSignals\(\); \}/);
  assert.match(restart, /secondProcess = launchNextMuxDesktop\(/);
  assert.match(restart, /await finishE2eRun\(async \(\) =>/);
  assert.match(restart, /Promise\.allSettled\(\[\s*terminateTree\(secondProcess\),/);
  assert.match(restart, /\}, primaryError\)/);
});

test('standalone spawn errors are retained before a late waiter and reject normally instead of crashing outside cleanup', { timeout: 10000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'nextmux-isolated-spawn-error-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const port = await freePort();
  const child = launchOwnedE2eProcess(join(directory, 'missing-executable'), [], { env: {},
    stdout: join(directory, 'stdout.log'), stderr: join(directory, 'stderr.log') });
  // The production launcher itself owns this listener; no global uncaughtException handler is installed.
  assert.equal(child.listenerCount('error'), 1);
  const original = await new Promise(resolveError => child.once('error', resolveError));
  await new Promise(done => setImmediate(done));
  const started = Date.now();
  await assert.rejects(waitForPort(port, 5000, child), error => error === original && error.code === 'ENOENT');
  assert.ok(Date.now() - started < 1000);
  await terminateTree(child);
  assert.equal(await readFile(join(directory, 'stdout.log'), 'utf8'), '');
});

test('actual standalone attachment failure preserves its profile and original spawn diagnostic', { skip: process.platform === 'win32', timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'nextmux-isolated-failure-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const helperUrl = new URL('./desktop-attachment-file-e2e-harness.mjs', import.meta.url).href;
  // A directory exists but cannot be executed. No Electron or other application is started.
  const script = `import { runInDisposableAttachmentFileDesktop } from ${JSON.stringify(helperUrl)};
    try { await runInDisposableAttachmentFileDesktop(new URL('file:///not-invoked.mjs')); }
    catch (error) { console.log(JSON.stringify({ testError: true, code: error.code, message: error.message })); }`;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...fixtureEnvironment(), NEXTMUX_PACKAGED_EXECUTABLE: directory }, timeout: 12000,
  });
  const profile = /isolated profile: (.+); CDP:/.exec(stdout)?.[1];
  assert.ok(profile?.startsWith(join(tmpdir(), 'nextmux-attachment-file-e2e-')));
  t.after(() => rm(profile, { recursive: true, force: true }));
  assert.equal((await stat(profile)).isDirectory(), true);
  assert.match(stdout, /Preserved isolated E2E profile:/);
  const result = stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)).find(value => value.testError);
  assert.ok(['EACCES', 'EPERM', 'ENOEXEC'].includes(result?.code));
  assert.doesNotMatch(result.message, /Disposable process logs/);
  assert.match(stdout, /"kind":"packaged"/); assert.doesNotMatch(stdout, /"kind":"development"/);
});

test('actual terminal runner failure retains the disposable profile after owned QA cleanup', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'nextmux-runner-failure-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('./desktop-terminal-ci-e2e.mjs', import.meta.url));
  let failure;
  try {
    await promisify(execFile)(process.execPath, [script], { env: { ...fixtureEnvironment(),
      npm_execpath: process.execPath, NEXTMUX_PACKAGED_EXECUTABLE: join(directory, 'missing-package'),
      NEXTMUX_DESKTOP_E2E_ARTIFACTS: join(directory, 'logs') }, timeout: 12000 });
  } catch (error) { failure = error; }
  assert.equal(failure?.code, 1); assert.match(failure.stderr, /Packaged NextMux executable not found/);
  const profile = /NextMux desktop E2E profile: (.+); CDP:/.exec(failure.stdout)?.[1];
  assert.ok(profile?.startsWith(join(tmpdir(), 'nextmux-desktop-e2e-')));
  t.after(() => rm(profile, { recursive: true, force: true }));
  assert.equal((await stat(profile)).isDirectory(), true);
  assert.match(failure.stdout, /Preserved NextMux desktop E2E profile:/);
});

test('foreground regression driver is part of the same owned cleanup, not left behind on interruption', { timeout: 10000 }, async () => {
  let driver;
  const result = runForeground(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {}, child => { driver = child; }).catch(error => error);
  assert.ok(driver?.pid); await terminateTree(driver);
  assert.ok(await result instanceof Error);
  assert.equal(readE2eProcessSnapshot().some(row => row.pid === driver.pid && !row.zombie), false);
});

test('owned isolated launches preserve exclusive logs and clean the exact live process', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'nextmux-isolated-launch-test-'));
  const stdout = join(directory, 'stdout.log'), stderr = join(directory, 'stderr.log');
  let child;
  t.after(async () => { if (child) await terminateTree(child); await rm(directory, { recursive: true, force: true }); });
  child = launchOwnedE2eProcess(process.execPath, ['-e', "process.stdout.write('owned-only');setInterval(()=>{},1000)"],
    { env: process.env, stdout, stderr });
  for (let attempt = 0; attempt < 60 && (await readFile(stdout, 'utf8')) !== 'owned-only'; attempt++) {
    await new Promise(done => setTimeout(done, 25));
  }
  assert.equal(await readFile(stdout, 'utf8'), 'owned-only');
  assert.throws(() => launchOwnedE2eProcess(process.execPath, ['-e', 'process.exit(0)'],
    { env: process.env, stdout, stderr }), { code: 'EEXIST' });
  await terminateTree(child);
  assert.equal(readE2eProcessSnapshot().some(row => row.pid === child.pid && !row.zombie), false);
  assert.equal(await readFile(stdout, 'utf8'), 'owned-only');
  await assert.rejects(terminateTree({ pid: process.pid }), /E2E_PROCESS_NOT_OWNED/);
});
