import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ManagedProcessRegistry } from '../lib/process-session.js';
import { AgentToolRegistry } from '../lib/registry.js';
import { WorkspaceToolRuntime } from '../lib/workspace-tools.js';

test('single-root finalization cancels an injected adapter waiting to admit a real process', { timeout: 10000 }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'nm-pending-adapter-'));
  const root = join(base, 'root'); await mkdir(root);
  let ready!: () => void; let release!: () => void;
  const preparing = new Promise<void>(done => { ready = done; });
  const held = new Promise<void>(done => { release = done; });
  const native = new ManagedProcessRegistry();
  let pendingSignal: AbortSignal | undefined;
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: root, checkpointRoot: join(base, 'checkpoints'), permissionMode: 'full_access',
    processRegistry: {
      async start(options) { pendingSignal = options.signal; ready(); await held; return native.start(options); },
      get: id => native.get(id), release: id => native.release(id),
      // Deliberately does not close the native registry: cancellation must be
      // forwarded by WorkspaceToolRuntime even to an injected adapter.
      async dispose() { return undefined; },
    } });
  const tools = new AgentToolRegistry(); runtime.registerTools(tools);
  try {
    const execution = tools.execute({ id: 'late-start', name: 'process.run', arguments: {
      command: process.execPath, args: ['-e', "require('node:fs').writeFileSync('late.txt','late')"] } }, 'full_access', { runId: 'pending-adapter' });
    await preparing;
    await runtime.finalizeProcessCheckpoints();
    assert.equal(pendingSignal?.aborted, true);
    release();
    const result = await execution;
    assert.equal(result.ok, false); assert.equal(result.error?.code, 'CANCELLED');
    await assert.rejects(readFile(join(root, 'late.txt')), { code: 'ENOENT' });
    assert.deepEqual(runtime.getCreatedCheckpointIds(), []);
  } finally { release(); await runtime.dispose(); await native.dispose(); await rm(base, { recursive: true, force: true }); }
});

test('a failed spawn releases its baseline so the next command cannot absorb an intervening user edit', async () => {
  const base = await mkdtemp(join(tmpdir(), 'nm-failed-start-baseline-'));
  const root = join(base, 'root'); await mkdir(root);
  const file = join(root, 'source.txt'); await writeFile(file, 'initial');
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: root, checkpointRoot: join(base, 'checkpoints'), permissionMode: 'full_access' });
  const tools = new AgentToolRegistry(); runtime.registerTools(tools);
  try {
    const failed = await tools.execute({ id: 'failed-spawn', name: 'process.run', arguments: { command: join(base, 'missing-executable') } }, 'full_access', { runId: 'failed-start' });
    assert.equal(failed.ok, false); assert.equal(failed.error?.code, 'PROCESS_START_FAILED');
    await writeFile(file, 'user edit');
    const success = await tools.execute({ id: 'next-command', name: 'process.run', arguments: {
      command: process.execPath, args: ['-e', "require('node:fs').writeFileSync('source.txt','command edit')"] } }, 'full_access', { runId: 'next-start' });
    assert.equal(success.ok, true, JSON.stringify(success.error));
    assert.equal(runtime.getCreatedCheckpointIds().length, 1);
    const diff = await runtime.getCheckpointDiff(runtime.getCreatedCheckpointIds()[0], true);
    assert.equal(diff.beforeContent, 'user edit'); assert.equal(diff.afterContent, 'command edit');
    await runtime.restoreCheckpoint(runtime.getCreatedCheckpointIds()[0]);
    assert.equal(await readFile(file, 'utf8'), 'user edit');
  } finally { await runtime.dispose(); await rm(base, { recursive: true, force: true }); }
});

test('finalization closes stdin admission while one-call permission is pending', { timeout: 10000 }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'nm-stop-pending-stdin-'));
  const root = join(base, 'root'); await mkdir(root);
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: root, checkpointRoot: join(base, 'checkpoints'), permissionMode: 'full_access' });
  const tools = new AgentToolRegistry(); runtime.registerTools(tools);
  let ready!: () => void; let release!: () => void;
  const permissionRequested = new Promise<void>(done => { ready = done; });
  const held = new Promise<void>(done => { release = done; });
  try {
    const started = await tools.execute({ id: 'stdin-start', name: 'process.start', arguments: {
      command: process.execPath, tty: false, pipeStdin: true,
      args: ['-e', "process.stdin.on('data', data=>require('node:fs').writeFileSync('from-input.txt',data));setInterval(()=>{},1000)"] } }, 'full_access', { runId: 'stdin-stop' });
    assert.equal(started.ok, true, JSON.stringify(started.error));
    const input = tools.execute({ id: 'stdin-write', name: 'process.write', arguments: {
      processId: (started.output as any).processId, data: 'late input' } }, 'workspace_write', { runId: 'stdin-stop',
      requestPermissionApproval: async () => { ready(); await held; return true; } });
    await permissionRequested;
    await runtime.finalizeProcessCheckpoints();
    release();
    const result = await input;
    assert.equal(result.ok, false); assert.equal(result.error?.code, 'CANCELLED');
    await assert.rejects(readFile(join(root, 'from-input.txt')), { code: 'ENOENT' });
  } finally { release(); await runtime.dispose(); await rm(base, { recursive: true, force: true }); }
});
