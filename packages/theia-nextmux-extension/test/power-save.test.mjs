import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { startPowerSaveHost } from '../lib/electron-main/nextmux-power-save-host.js';
import { acquireDesktopPowerSaveBlocker, withDesktopPowerSaveBlocker } from '../lib/node/nextmux-power-save.js';

function fakeBlocker() {
  const starts = [], stops = [];
  let onStop;
  return {
    starts, stops,
    start(type) { starts.push(type); return starts.length - 1; },
    stop(id) { stops.push(id); onStop?.(id); },
    nextStop() { return new Promise(resolve => { onStop = resolve; }); }
  };
}

function environment(host) {
  return { NEXTMUX_POWER_SAVE_PATH: host.path, NEXTMUX_POWER_SAVE_TOKEN: host.token };
}

test('one application-suspension assertion covers nested and concurrent backend leases', async t => {
  const blocker = fakeBlocker();
  const host = await startPowerSaveHost(blocker);
  t.after(() => host.close());
  const releaseFirst = await acquireDesktopPowerSaveBlocker(environment(host));
  const releaseSecond = await acquireDesktopPowerSaveBlocker(environment(host));
  assert.deepEqual(blocker.starts, ['prevent-app-suspension'], 'the display may still sleep');
  await releaseFirst();
  await releaseFirst();
  assert.deepEqual(blocker.stops, [], 'a sibling still owns the assertion');
  await releaseSecond();
  assert.deepEqual(blocker.stops, [0], 'zero is a valid blocker id');
  const releaseThird = await acquireDesktopPowerSaveBlocker(environment(host));
  assert.deepEqual(blocker.starts, ['prevent-app-suspension', 'prevent-app-suspension']);
  await releaseThird();
  assert.deepEqual(blocker.stops, [0, 1]);
});

test('the lease spans asynchronous work and releases on success, rejection and nested operations', async t => {
  const blocker = fakeBlocker();
  const host = await startPowerSaveHost(blocker);
  t.after(() => host.close());
  const env = environment(host);
  assert.equal(await withDesktopPowerSaveBlocker(async () => {
    assert.deepEqual(blocker.starts, ['prevent-app-suspension']);
    assert.equal(await withDesktopPowerSaveBlocker(async () => 'nested result', env), 'nested result');
    assert.deepEqual(blocker.stops, [], 'the parent continues after its child finishes');
    return 'done';
  }, env), 'done');
  assert.deepEqual(blocker.stops, [0]);
  await assert.rejects(withDesktopPowerSaveBlocker(async () => { throw new Error('user stopped'); }, env), /user stopped/);
  assert.deepEqual(blocker.stops, [0, 1]);
});

test('a backend crash releases its assertion and launch credentials never reach child tools', async t => {
  const blocker = fakeBlocker();
  const host = await startPowerSaveHost(blocker);
  t.after(() => host.close());
  const modulePath = fileURLToPath(new URL('../lib/node/nextmux-power-save.js', import.meta.url));
  const child = spawn(process.execPath, ['-e', `
    const { acquireDesktopPowerSaveBlocker } = require(${JSON.stringify(modulePath)});
    acquireDesktopPowerSaveBlocker().then(() => process.send({
      ready: true,
      leaked: Boolean(process.env.NEXTMUX_POWER_SAVE_PATH || process.env.NEXTMUX_POWER_SAVE_TOKEN)
    }));
  `], { env: { ...process.env, ...environment(host) }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const [message] = await once(child, 'message');
  assert.deepEqual(message, { ready: true, leaked: false });
  assert.deepEqual(blocker.starts, ['prevent-app-suspension']);
  const stopped = blocker.nextStop();
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  assert.equal(await stopped, 0);
  await exited;
  assert.deepEqual(blocker.stops, [0]);
});

test('the direct agent RPC holds the assertion until checkpoint cleanup finishes', async t => {
  const blocker = fakeBlocker();
  const host = await startPowerSaveHost(blocker);
  t.after(() => host.close());
  const modulePath = fileURLToPath(new URL('../lib/node/nextmux-platform-service.js', import.meta.url));
  const child = spawn(process.execPath, ['-e', `
    const { NextMuxPlatformServiceImpl } = require(${JSON.stringify(modulePath)});
    const service = new NextMuxPlatformServiceImpl();
    let finishModel, finishCleanup;
    process.on('message', message => {
      if (message === 'finish-model') finishModel();
      if (message === 'finish-cleanup') finishCleanup();
    });
    service.holdAgentWorkspaces = () => () => {};
    service.assertConversationNotDeleted = async () => {};
    service.getConversationWorkspace = async () => '/synthetic-owned-workspace';
    service.resolveConversationForkRequest = undefined;
    service.acquireAgentCheckpointRunLeases = async () => ({ release: async () => {
      const wait = new Promise(resolve => { finishCleanup = resolve; });
      process.send('cleanup');
      await wait;
    } });
    service.executeAgentRun = async () => {
      const wait = new Promise(resolve => { finishModel = resolve; });
      process.send('executing');
      await wait;
      return { status: 'completed' };
    };
    service.runAgent({ toolScope: 'comic-json', conversationId: 'synthetic-conversation' }).then(() => { process.send('done'); process.disconnect(); });
  `], { env: { ...process.env, ...environment(host) }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const nextMessage = () => Promise.race([
    once(child, 'message').then(([message]) => message),
    once(child, 'exit').then(([code]) => { throw new Error(`Agent fixture exited early (${code}): ${stderr}`); })
  ]);
  assert.equal(await nextMessage(), 'executing');
  assert.deepEqual(blocker.starts, ['prevent-app-suspension']);
  const cleaning = nextMessage();
  child.send('finish-model');
  assert.equal(await cleaning, 'cleanup');
  assert.deepEqual(blocker.stops, [], 'the completed model still has durable work to finish');
  const done = nextMessage();
  child.send('finish-cleanup');
  assert.equal(await done, 'done');
  assert.deepEqual(blocker.stops, [0]);
});

test('host shutdown disposes active references once and release remains idempotent', async () => {
  const blocker = fakeBlocker();
  const host = await startPowerSaveHost(blocker);
  const first = await acquireDesktopPowerSaveBlocker(environment(host));
  const second = await acquireDesktopPowerSaveBlocker(environment(host));
  host.close();
  host.close();
  await Promise.all([first(), second()]);
  assert.deepEqual(blocker.stops, [0]);
});

test('unauthorized, absent and disconnected main-process channels preserve backend work', async t => {
  const blocker = fakeBlocker();
  const host = await startPowerSaveHost(blocker);
  t.after(() => host.close());
  await (await acquireDesktopPowerSaveBlocker({ ...environment(host), NEXTMUX_POWER_SAVE_TOKEN: 'wrong' }))();
  await (await acquireDesktopPowerSaveBlocker({}))();
  assert.deepEqual(blocker.starts, []);
  host.close();
  assert.equal(await withDesktopPowerSaveBlocker(async () => 7, environment(host)), 7);
});

test('all desktop task owners hold power-save leases through their execution and cleanup', () => {
  const source = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/electron-main/nextmux-electron-main-module.ts', import.meta.url), 'utf8');
  assert.match(source, /job\.completion = withDesktopPowerSaveBlocker\(\(\) => this\.executeAgentRun/);
  assert.match(source, /return await withDesktopPowerSaveBlocker\(async \(\) => \{[\s\S]*?await this\.executeAgentRun\(request\)[\s\S]*?await checkpointLease\.release\(\)/);
  assert.match(source, /async planComicText[\s\S]*?await this\.runAgent\(/, 'comic text generation uses the protected direct runner');
  const exportBody = source.slice(source.indexOf('protected async executeComicExport('), source.indexOf('protected async ensureMediaRecovery('));
  assert.match(exportBody, /await holdDesktopPowerSave\(\)/);
  assert.match(exportBody, /finally \{[\s\S]*?await releasePowerSave\(\)/);
  assert.match(source, /running\.completion = withDesktopPowerSaveBlocker\(\(\) => this\.executeComicExport[\s\S]*?await lifecycleLease\?\.release\(/);
  const laneBody = source.slice(source.indexOf('protected async runMediaLane('), source.indexOf('protected async retryOnComicRevision'));
  assert.match(laneBody, /await holdDesktopPowerSave\(\)/);
  assert.match(laneBody, /await store\.complete[\s\S]*?finally \{[\s\S]*?await releasePowerSave\(\)/);
  const jobBody = source.slice(source.indexOf('protected async executeMediaJob('), source.indexOf('protected async requestManagedMedia('));
  assert.match(jobBody, /return withDesktopPowerSaveBlocker\(async \(\) => \{/);
  const transcriptionBody = source.slice(source.indexOf('async transcribeComicShot('), source.indexOf('async cancelComicShotTranscription('));
  assert.match(transcriptionBody, /await holdDesktopPowerSave\(\)/);
  assert.match(transcriptionBody, /finally \{[\s\S]*?await releasePowerSave\(\)/);
  assert.match(main, /startPowerSaveHost\(powerSaveBlocker\)/);
  assert.match(main, /NEXTMUX_POWER_SAVE_PATH_ENV\]: power\.path/);
  assert.match(main, /app\.once\('quit', \(\) => host\.close\(\)\)/);
});

test('a main process that never answers the handshake never holds up the work or its release', async t => {
  const { createServer } = await import('node:net');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const path = process.platform === 'win32' ? `\\\\.\\pipe\\nextmux-silent-${process.pid}` : join(mkdtempSync(join(tmpdir(), 'nextmux-silent-')), 'power.sock');
  const sockets = new Set();
  const silent = createServer(socket => { sockets.add(socket); socket.on('error', () => undefined); });
  await new Promise(resolve => silent.listen(path, resolve));
  t.after(() => { for (const socket of sockets) socket.destroy(); silent.close(); });
  const started = Date.now();
  const result = await withDesktopPowerSaveBlocker(async () => Date.now() - started, { NEXTMUX_POWER_SAVE_PATH: path, NEXTMUX_POWER_SAVE_TOKEN: 'token' });
  assert.ok(result < 5_000, `work started after ${result} ms`);
  assert.ok(Date.now() - started < 6_000, 'release did not wait on the silent host');
});
