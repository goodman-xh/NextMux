import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

class ClearingFixture extends NextMuxPlatformServiceImpl {
  constructor(profile) { super(); this.profile = profile; }
  nextmuxDataRoot() { return this.profile; }
}

class PausedClearingFixture extends ClearingFixture {
  constructor(profile) {
    super(profile);
    this.entered = new Promise(resolve => { this.signalEntered = resolve; });
    this.released = new Promise(resolve => { this.release = resolve; });
  }
  async removeLocalDataTree(target, verifyOwnership) {
    this.signalEntered();
    await this.released;
    return super.removeLocalDataTree(target, verifyOwnership);
  }
}

const workerPath = fileURLToPath(new URL('./fixtures/agent-checkpoint-process.mjs', import.meta.url));

function startRunningProcess(profile, workspaceRoot, derivedWorkspaceRoot) {
  const child = spawn(process.execPath, [workerPath, profile, workspaceRoot, ...(derivedWorkspaceRoot ? [derivedWorkspaceRoot] : [])], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env },
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  const ready = new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`worker did not become ready: ${stderr}`)), 30_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      const newline = output.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      try { resolve(JSON.parse(output.slice(0, newline))); }
      catch (error) { reject(error); }
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`worker exited ${code}: ${stderr}`));
    });
  });
  return { child, ready };
}

async function stopRunningProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit');
  child.stdin.end('stop\n');
  const timeout = setTimeout(() => child.kill(), 5_000);
  try { await exit; } finally { clearTimeout(timeout); }
}

test('another process cannot clear a live run checkpoint', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-agent-checkpoint-process-'));
  let child;
  t.after(async () => { await stopRunningProcess(child); await rm(sandbox, { recursive: true, force: true }); });
  const workspaceRoot = join(sandbox, 'workspace');
  const profile = join(sandbox, 'profile');
  await mkdir(workspaceRoot);
  const running = startRunningProcess(profile, workspaceRoot);
  child = running.child;
  const { ready } = running;
  const record = await ready;
  assert.equal(record.type, 'ready');
  assert.match(await readFile(record.path, 'utf8'), /cross-process-checkpoint-sentinel/);

  const service = new ClearingFixture(profile);
  await assert.rejects(
    service.clearDesktopLocalData({ workspaceRoot, categories: ['agent_checkpoints'] }),
    { code: 'LOCAL_DATA_BUSY' },
  );
  assert.match(await readFile(record.path, 'utf8'), /cross-process-checkpoint-sentinel/);
});

test('another process cannot start a run during checkpoint clearing', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-agent-checkpoint-clear-process-'));
  let child;
  t.after(async () => { await stopRunningProcess(child); await rm(sandbox, { recursive: true, force: true }); });
  const workspaceRoot = join(sandbox, 'workspace');
  const profile = join(sandbox, 'profile');
  await mkdir(workspaceRoot);
  const service = new PausedClearingFixture(profile);
  const checkpointRoot = service.agentCheckpointRoot(workspaceRoot);
  await mkdir(checkpointRoot, { recursive: true });
  const marker = join(checkpointRoot, 'old');
  await writeFile(marker, 'old');

  const clearing = service.clearDesktopLocalData({ workspaceRoot, categories: ['agent_checkpoints'] });
  await service.entered;
  const running = startRunningProcess(profile, workspaceRoot);
  child = running.child;
  const { ready } = running;
  try {
    const record = await ready;
    assert.deepEqual({ type: record.type, code: record.code }, { type: 'rejected', code: 'PROJECT_BUSY' });
  } finally {
    service.release();
    await clearing;
  }
});

test('a killed run no longer blocks checkpoint clearing', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-agent-checkpoint-crash-'));
  let child;
  t.after(async () => { await stopRunningProcess(child); await rm(sandbox, { recursive: true, force: true }); });
  const workspaceRoot = join(sandbox, 'workspace');
  const profile = join(sandbox, 'profile');
  await mkdir(workspaceRoot);
  const running = startRunningProcess(profile, workspaceRoot);
  child = running.child;
  const record = await running.ready;
  assert.equal(record.type, 'ready');
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;

  const state = await new ClearingFixture(profile).clearDesktopLocalData({
    workspaceRoot, categories: ['agent_checkpoints'],
  });
  assert.equal(state.entries.find(entry => entry.category === 'agent_checkpoints')?.files, 0);
});

test('a dynamically added child workspace lease blocks clear in another process', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-agent-child-checkpoint-process-'));
  let child;
  t.after(async () => { await stopRunningProcess(child); await rm(sandbox, { recursive: true, force: true }); });
  const workspaceRoot = join(sandbox, 'workspace');
  const childWorkspaceRoot = join(sandbox, 'child-workspace');
  const profile = join(sandbox, 'profile');
  await Promise.all([mkdir(workspaceRoot), mkdir(childWorkspaceRoot)]);
  const running = startRunningProcess(profile, workspaceRoot, childWorkspaceRoot);
  child = running.child;
  const record = await running.ready;
  assert.equal(record.type, 'ready');
  assert.match(await readFile(record.path, 'utf8'), /cross-process-checkpoint-sentinel/);

  await assert.rejects(
    new ClearingFixture(profile).clearDesktopLocalData({ workspaceRoot: childWorkspaceRoot, categories: ['agent_checkpoints'] }),
    { code: 'LOCAL_DATA_BUSY' },
  );
  assert.match(await readFile(record.path, 'utf8'), /cross-process-checkpoint-sentinel/);
});

test('a symlinked lease directory blocks clear without removing its target files', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-agent-checkpoint-lease-symlink-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const workspaceRoot = join(sandbox, 'workspace');
  const profile = join(sandbox, 'profile');
  const outside = join(sandbox, 'outside');
  await Promise.all([mkdir(workspaceRoot), mkdir(outside)]);
  const service = new ClearingFixture(profile);
  const checkpointRoot = service.agentCheckpointRoot(workspaceRoot);
  const leaseBase = join(dirname(checkpointRoot), '.locks', basename(checkpointRoot));
  await mkdir(leaseBase, { recursive: true });
  const outsideMarker = join(outside, 'run-00000000-0000-4000-8000-000000000001.json');
  await writeFile(outsideMarker, JSON.stringify({ pid: 99999999, host: hostname(), kind: 'run' }));
  try { await symlink(outside, join(leaseBase, 'runs'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (error.code === 'EPERM') { t.skip('Symlinks are unavailable to this test user'); return; }
    throw error;
  }

  const outcome = await service.clearDesktopLocalData({ workspaceRoot, categories: ['agent_checkpoints'] })
    .then(() => ({ code: 'CLEARED' }), error => error);
  const outsideMarkerSurvived = await readFile(outsideMarker, 'utf8').then(() => true, () => false);
  assert.equal(outsideMarkerSurvived, true, 'a symlink target file must not be removed');
  assert.equal(outcome.code, 'LOCAL_DATA_BUSY');
});

test('a symlinked lock base blocks clear before creating files in its target', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-agent-checkpoint-lock-base-symlink-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const workspaceRoot = join(sandbox, 'workspace');
  const profile = join(sandbox, 'profile');
  const outside = join(sandbox, 'outside');
  await Promise.all([mkdir(workspaceRoot), mkdir(outside)]);
  const service = new ClearingFixture(profile);
  const checkpointRoot = service.agentCheckpointRoot(workspaceRoot);
  await mkdir(dirname(checkpointRoot), { recursive: true });
  try { await symlink(outside, join(dirname(checkpointRoot), '.locks'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (error.code === 'EPERM') { t.skip('Symlinks are unavailable to this test user'); return; }
    throw error;
  }

  await assert.rejects(
    service.clearDesktopLocalData({ workspaceRoot, categories: ['agent_checkpoints'] }),
    { code: 'LOCAL_DATA_BUSY' },
  );
  assert.deepEqual(await (await import('node:fs/promises')).readdir(outside), []);
});
