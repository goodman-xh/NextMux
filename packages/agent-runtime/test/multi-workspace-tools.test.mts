import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, symlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, type TestContext } from 'node:test';
import { AgentToolRegistry } from '../lib/registry.js';
import { MultiWorkspaceToolRuntime } from '../lib/multi-workspace-tools.js';
import { WorkspaceToolRuntime } from '../lib/workspace-tools.js';
import type { AgentPermissionMode, ToolExecutionContext } from '../lib/types.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t: TestContext, options: { secondPermission?: AgentPermissionMode; permissionMode?: AgentPermissionMode } = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'nm-multi-root-')));
  const a = join(base, 'project-a'); const b = join(base, 'project-b');
  await Promise.all([mkdir(a), mkdir(b)]);
  await Promise.all([writeFile(join(a, 'same.txt'), 'from a'), writeFile(join(b, 'same.txt'), 'from b')]);
  const permissionMode = options.permissionMode ?? 'full_access';
  const runtime = await MultiWorkspaceToolRuntime.create({
    bindings: [{ id: 'a', path: a, permissionMode: 'full_access' }, { id: 'b', path: b, permissionMode: options.secondPermission ?? 'full_access' }],
    primaryBindingId: 'a', permissionMode,
    checkpointRootForWorkspace: path => join(base, path === a ? 'checkpoints-a' : 'checkpoints-b'),
  });
  const registry = new AgentToolRegistry(); runtime.registerTools(registry);
  let call = 0;
  const execute = (name: string, args: unknown, context: Partial<ToolExecutionContext> = {}) => registry.execute(
    { id: `multi-call-${++call}`, name, arguments: args }, permissionMode, { runId: 'multi-root-test', ...context });
  t.after(async () => { await runtime.dispose(); await rm(base, { recursive: true, force: true }); });
  return { a, b, base, runtime, registry, execute };
}

test('verified binding IDs route reads and writes to independent real directories; omission retains primary behavior', async t => {
  const f = await fixture(t);
  const listed = await f.execute('workspace.list_bindings', {});
  assert.equal(listed.ok, true);
  assert.deepEqual((listed.output as any).bindings.map((b: any) => b.id), ['a', 'b']);
  const primary = await f.execute('workspace.read_file', { path: 'same.txt' });
  const second = await f.execute('workspace.read_file', { workspaceBindingId: 'b', path: 'same.txt' });
  assert.equal((primary.output as any).content, 'from a');
  assert.equal((second.output as any).content, 'from b');
  assert.equal(primary.summary.resource?.kind === 'file' && primary.summary.resource.path, await realpath(join(f.a, 'same.txt')));
  assert.equal(second.summary.resource?.kind === 'file' && second.summary.resource.path, await realpath(join(f.b, 'same.txt')));
  assert.equal((primary.output as any).path, 'same.txt');
  assert.equal((second.output as any).path, 'same.txt');
  assert.equal((second.output as any).workspaceBindingId, 'b');
  assert.equal((second.output as any).workspaceRoot, f.b);
  const resultA = await f.execute('workspace.write_file', { path: 'same.txt', content: 'edited a', expectedSha256: (primary.output as any).sha256 });
  const resultB = await f.execute('workspace.write_file', { workspaceBindingId: 'b', path: 'same.txt', content: 'edited b', expectedSha256: (second.output as any).sha256 });
  assert.equal(resultA.ok, true); assert.equal(resultB.ok, true);
  assert.equal(await readFile(join(f.a, 'same.txt'), 'utf8'), 'edited a');
  assert.equal(await readFile(join(f.b, 'same.txt'), 'utf8'), 'edited b');
  const groups = f.runtime.getWorkspaceCheckpointGroups();
  assert.equal(groups[0].workspaceRoot, f.a); assert.equal(groups[1].workspaceRoot, f.b);
  assert.equal(groups[0].checkpointIds.length, 1); assert.equal(groups[1].checkpointIds.length, 1);
  const diff = await f.runtime.getCheckpointDiff(groups[1].checkpointIds[0]);
  assert.equal(diff.workspaceBindingId, 'b'); assert.equal(diff.workspaceRoot, f.b);
  assert.match(diff.patch, /edited b/);
  assert.equal(f.runtime.getCreatedCheckpointIds().length, 2);
});

test('schemas expose the same optional binding selector on every workspace/process tool', async t => {
  const f = await fixture(t);
  for (const descriptor of f.registry.descriptors('full_access')) {
    if (descriptor.name === 'workspace.list_bindings') continue;
    const schema = descriptor.inputSchema as any;
    assert.deepEqual(schema.properties.workspaceBindingId.enum, ['a', 'b']);
    assert.equal(schema.required?.includes('workspaceBindingId') ?? false, false);
    assert.match(descriptor.description, /primary \(a\)/);
  }
});

test('unknown IDs and explicit/implicit crossing into another bound directory fail closed', async t => {
  const f = await fixture(t);
  for (const value of ['missing', '', null, 2, {}]) {
    const result = await f.execute('workspace.write_file', { workspaceBindingId: value, path: 'bad.txt', content: 'bad' });
    assert.equal(result.ok, false); assert.equal(result.error?.code, 'INVALID_WORKSPACE_BINDING');
  }
  const crossing = await f.execute('workspace.read_file', { path: join(f.b, 'same.txt') });
  assert.equal(crossing.error?.code, 'WORKSPACE_BINDING_MISMATCH');
  const parentCrossing = await f.execute('workspace.read_file', { path: '../project-b/same.txt' });
  assert.equal(parentCrossing.error?.code, 'WORKSPACE_BINDING_MISMATCH');
  if (process.platform !== 'win32') {
    await symlink(f.b, join(f.a, 'other-root'));
    const linked = await f.execute('workspace.write_file', { path: 'other-root/new.txt', content: 'bad' });
    assert.equal(linked.error?.code, 'WORKSPACE_BINDING_MISMATCH');
  }
  assert.equal(await readFile(join(f.b, 'same.txt'), 'utf8'), 'from b');
});

test('binding permissions and the run permission only narrow access', async t => {
  const f = await fixture(t, { secondPermission: 'read_only' });
  assert.equal((await f.execute('workspace.read_file', { workspaceBindingId: 'b', path: 'same.txt' })).ok, true);
  assert.equal((await f.execute('workspace.write_file', { workspaceBindingId: 'b', path: 'new.txt', content: 'bad' })).error?.code, 'PERMISSION_DENIED');
  assert.equal((await f.execute('process.run', { workspaceBindingId: 'b', command: process.execPath, args: ['-e', 'console.log(1)'] })).error?.code, 'PERMISSION_DENIED');
  const narrow = await fixture(t, { permissionMode: 'read_only' });
  assert.deepEqual((await narrow.execute('workspace.list_bindings', {})).output && ((await narrow.execute('workspace.list_bindings', {})).output as any).bindings.map((b: any) => b.permissionMode), ['read_only', 'read_only']);
  assert.equal((await narrow.execute('workspace.write_file', { path: 'new.txt', content: 'bad' })).error?.code, 'PERMISSION_DENIED');
  assert.equal(narrow.registry.descriptors('read_only').some(d => d.name === 'process.run'), false);
});

test('real commands run in each selected directory and collect correctly owned checkpoints', async t => {
  const f = await fixture(t);
  const args = ['-e', "require('node:fs').writeFileSync('command.txt',process.cwd());console.log(process.cwd())"];
  const first = await f.execute('process.run', { command: process.execPath, args });
  const second = await f.execute('process.run', { workspaceBindingId: 'b', command: process.execPath, args });
  assert.equal(first.ok, true); assert.equal(second.ok, true);
  assert.equal(await readFile(join(f.a, 'command.txt'), 'utf8'), f.a);
  assert.equal(await readFile(join(f.b, 'command.txt'), 'utf8'), f.b);
  assert.equal(first.summary.checkpointIds?.length, 1); assert.equal(second.summary.checkpointIds?.length, 1);
  assert.equal((await f.runtime.getCheckpointDiff(second.summary.checkpointIds![0])).workspaceRoot, f.b);
  const replayed = await f.execute('process.run', { workspaceBindingId: 'b', command: process.execPath, args });
  assert.equal(replayed.ledger?.replayed, true);
  assert.equal(f.runtime.getWorkspaceCheckpointGroups()[1].checkpointIds.length, 1);
});

test('process polling and termination follow process ownership; a wrong binding cannot control another root', async t => {
  const f = await fixture(t);
  const args = ['-e', "console.log(process.cwd());setInterval(()=>{},1000)"];
  const first = await f.execute('process.start', { command: process.execPath, args, tty: false });
  const second = await f.execute('process.start', { workspaceBindingId: 'b', command: process.execPath, args, tty: false });
  assert.equal(first.ok, true); assert.equal(second.ok, true);
  const a = (first.output as any).processId; const b = (second.output as any).processId;
  assert.notEqual(a, b);
  const wrong = await f.execute('process.terminate', { workspaceBindingId: 'a', processId: b });
  assert.equal(wrong.error?.code, 'WORKSPACE_BINDING_MISMATCH');
  const polled = await f.execute('process.read', { processId: b, waitMs: 1000 });
  assert.equal(polled.ok, true); assert.equal((polled.output as any).running, true);
  assert.equal((polled.output as any).workspaceBindingId, 'b');
  assert.match(JSON.stringify(polled.output), new RegExp(f.b));
  assert.equal((await f.execute('process.terminate', { processId: b })).ok, true);
  assert.equal((await f.execute('process.read', { processId: a, waitMs: 0 })).output && ((await f.execute('process.read', { processId: a, waitMs: 0 })).output as any).running, true);
  await f.runtime.finalizeProcessCheckpoints();
  assert.equal((await f.execute('process.read', { processId: a, waitMs: 0 })).error?.code, 'CANCELLED');
});

test('cancellation stops a real secondary-root command and checkpoints its completed edit', async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const running = f.execute('process.run', { workspaceBindingId: 'b', command: process.execPath,
    args: ['-e', "require('node:fs').writeFileSync('cancelled.txt','saved');console.log('ready');setInterval(()=>{},1000)"] },
  { signal: controller.signal, onOutput: output => { if (output.text.includes('ready')) ready(); } });
  await started;
  const began = Date.now(); controller.abort();
  const result = await running;
  assert.ok(Date.now() - began < 2000, 'cancellation must return promptly');
  assert.equal(result.ok, true); assert.equal(result.summary.outcome, 'failed');
  assert.equal(result.summary.terminationReason, 'cancelled');
  await f.runtime.finalizeProcessCheckpoints();
  assert.equal(await readFile(join(f.b, 'cancelled.txt'), 'utf8'), 'saved');
  const group = f.runtime.getWorkspaceCheckpointGroups().find(g => g.workspaceBindingId === 'b')!;
  assert.equal(group.checkpointIds.length, 1);
  assert.equal((await f.runtime.getCheckpointDiff(group.checkpointIds[0])).kind, 'created');
  assert.equal((await f.execute('workspace.write_file', { path: 'after-stop.txt', content: 'bad' })).error?.code, 'CANCELLED');
});

test('duplicate roots, duplicate checkpoint stores and missing primary fail before creating runtimes', async t => {
  const f = await fixture(t);
  const base = { permissionMode: 'full_access' as const, primaryBindingId: 'a', checkpointRootForWorkspace: (path: string) => join(f.base, path === f.a ? 'extra-a' : 'extra-b') };
  await assert.rejects(MultiWorkspaceToolRuntime.create({ ...base, bindings: [
    { id: 'a', path: f.a, permissionMode: 'full_access' }, { id: 'b', path: f.a, permissionMode: 'full_access' },
  ] }), /distinct directories/);
  await assert.rejects(MultiWorkspaceToolRuntime.create({ ...base, primaryBindingId: 'missing', bindings: [
    { id: 'a', path: f.a, permissionMode: 'full_access' },
  ] }), /Primary workspace binding is missing/);
  await assert.rejects(MultiWorkspaceToolRuntime.create({ ...base, checkpointRootForWorkspace: () => join(f.base, 'one-store'), bindings: [
    { id: 'a', path: f.a, permissionMode: 'full_access' }, { id: 'b', path: f.b, permissionMode: 'full_access' },
  ] }), /distinct checkpoint store/);
});

test('a command launched in A captures edits in bound B under B ownership and can restore them', async t => {
  const f = await fixture(t);
  const result = await f.execute('process.run', { command: process.execPath,
    args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(join(f.b, 'same.txt'))},'from command A')`] });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const groups = f.runtime.getWorkspaceCheckpointGroups();
  assert.equal(groups[0].checkpointIds.length, 0);
  assert.equal(groups[1].checkpointIds.length, 1);
  const id = groups[1].checkpointIds[0];
  assert.ok(result.summary.checkpointIds?.includes(id));
  const diff = await f.runtime.getCheckpointDiff(id, true);
  assert.equal(diff.workspaceBindingId, 'b'); assert.equal(diff.workspaceRoot, f.b);
  assert.equal(diff.beforeContent, 'from b'); assert.equal(diff.afterContent, 'from command A');
  const restored = await WorkspaceToolRuntime.create({ workspaceRoot: f.b, checkpointRoot: join(f.base, 'checkpoints-b'), permissionMode: 'full_access' });
  try { await restored.restoreCheckpointChain([id]); } finally { await restored.dispose(); }
  assert.equal(await readFile(join(f.b, 'same.txt'), 'utf8'), 'from b');
});

test('nested bound directories have exactly one command checkpoint owner even when launched from the parent', async t => {
  const f = await fixture(t), nested = join(f.a, 'child'); await mkdir(nested);
  await writeFile(join(nested, 'source.txt'), 'nested before');
  const runtime = await MultiWorkspaceToolRuntime.create({ primaryBindingId: 'parent', permissionMode: 'full_access',
    bindings: [{ id: 'parent', path: f.a, permissionMode: 'full_access' }, { id: 'nested', path: nested, permissionMode: 'full_access' }],
    checkpointRootForWorkspace: root => join(f.base, root === f.a ? 'nested-parent-store' : 'nested-child-store') });
  t.after(() => runtime.dispose());
  const registry = new AgentToolRegistry(); runtime.registerTools(registry);
  const result = await registry.execute({ id: 'nested-command', name: 'process.run', arguments: { command: process.execPath,
    args: ['-e', "require('node:fs').writeFileSync('child/source.txt','nested after')"] } }, 'full_access', { runId: 'nested-test' });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const groups = runtime.getWorkspaceCheckpointGroups();
  assert.deepEqual(groups.map(group => group.checkpointIds.length), [0, 1]);
  assert.equal((await runtime.getCheckpointDiff(groups[1].checkpointIds[0], true)).beforeContent, 'nested before');
});

test('incomplete snapshot in one binding permits commands and reports only recorded recovery', async t => {
  const f = await fixture(t), oversized = join(f.b, 'too-large.bin');
  const handle = await open(oversized, 'w');
  try { await handle.truncate(2 * 1024 * 1024 * 1024 + 1); } finally { await handle.close(); }
  let started = 0;
  const result = await f.execute('process.run', { command: process.execPath,
    args: ['-e', `const fs=require('node:fs');fs.writeFileSync('same.txt','edited a');fs.writeFileSync(${JSON.stringify(join(f.b, 'same.txt'))},'edited b')`] },
  { onProcessStarted: () => { started++; } });
  assert.equal(result.ok, true, JSON.stringify(result.error)); assert.equal(started, 1);
  assert.equal(await readFile(join(f.a, 'same.txt'), 'utf8'), 'edited a');
  assert.equal(await readFile(join(f.b, 'same.txt'), 'utf8'), 'edited b');
  assert.equal((result.output as any).checkpointCoverage.complete, false);
  assert.match((result.output as any).checkpointCoverage.warnings.join('\n'), /project-b.*budget/);
  const groups = f.runtime.getWorkspaceCheckpointGroups();
  assert.deepEqual(groups.map(group => group.checkpointIds.length), [1, 1]);
  for (const group of groups) {
    const diff = await f.runtime.getCheckpointDiff(group.checkpointIds[0], true);
    assert.equal(diff.beforeContent, group.workspaceBindingId === 'a' ? 'from a' : 'from b');
  }
  await rm(oversized);
  const retry = await f.execute('process.run', { command: process.execPath, args: ['-e', "console.log('clean retry')"] });
  assert.equal(retry.ok, true, JSON.stringify(retry.error));
  assert.equal((retry.output as any).checkpointCoverage.complete, true);
  assert.match(f.runtime.getCheckpointWarnings().join('\n'), /project-b.*budget/);
});

test('cancelling A captures its completed cross-root writes in B before finalization', { timeout: 6000 }, async t => {
  const f = await fixture(t), controller = new AbortController();
  let ready!: () => void; const began = new Promise<void>(resolve => { ready = resolve; });
  const running = f.execute('process.run', { command: process.execPath, args: ['-e',
    `require('node:fs').writeFileSync(${JSON.stringify(join(f.b, 'same.txt'))},'cross-root before stop');console.log('ready');setInterval(()=>{},1000)`] },
  { signal: controller.signal, onOutput: output => { if (output.text.includes('ready')) ready(); } });
  await began; controller.abort(); await running;
  await f.runtime.finalizeProcessCheckpoints();
  const group = f.runtime.getWorkspaceCheckpointGroups().find(group => group.workspaceBindingId === 'b')!;
  assert.equal(group.checkpointIds.length, 1);
  const diff = await f.runtime.getCheckpointDiff(group.checkpointIds[0], true);
  assert.equal(diff.beforeContent, 'from b'); assert.equal(diff.afterContent, 'cross-root before stop');
});

test('finalization stops every writer before collecting B including A shutdown-handler writes', { timeout: 6000, skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t);
  let ready!: () => void; const began = new Promise<void>(resolve => { ready = resolve; });
  const result = await f.execute('process.start', { command: process.execPath, tty: false, args: ['-e',
    `process.on('SIGTERM',()=>{setTimeout(()=>{require('node:fs').writeFileSync(${JSON.stringify(join(f.b, 'same.txt'))},'shutdown edit');process.exit(0)},80)});console.log('ready');setInterval(()=>{},1000)`] },
  { onOutput: output => { if (output.text.includes('ready')) ready(); } });
  assert.equal(result.ok, true, JSON.stringify(result.error)); await began;
  await f.runtime.finalizeProcessCheckpoints();
  const group = f.runtime.getWorkspaceCheckpointGroups().find(group => group.workspaceBindingId === 'b')!;
  assert.equal(group.checkpointIds.length, 1);
  const diff = await f.runtime.getCheckpointDiff(group.checkpointIds[0], true);
  assert.equal(diff.beforeContent, 'from b'); assert.equal(diff.afterContent, 'shutdown edit');
});

test('reading a finished async A command returns B checkpoints without requiring whole-run finalization', async t => {
  const f = await fixture(t);
  const started = await f.execute('process.start', { command: process.execPath, tty: false, args: ['-e',
    `require('node:fs').writeFileSync(${JSON.stringify(join(f.b, 'same.txt'))},'async edit')`] });
  assert.equal(started.ok, true, JSON.stringify(started.error));
  const read = await f.execute('process.read', { processId: (started.output as any).processId, waitMs: 5000 });
  assert.equal(read.ok, true, JSON.stringify(read.error)); assert.equal((read.output as any).running, false);
  const group = f.runtime.getWorkspaceCheckpointGroups().find(group => group.workspaceBindingId === 'b')!;
  assert.equal(group.checkpointIds.length, 1);
  assert.ok(read.summary.checkpointIds?.includes(group.checkpointIds[0]));
  assert.equal((read.output as any).workspaceCheckpointGroups.find((group: any) => group.workspaceBindingId === 'b').checkpointIds.length, 1);
  assert.equal((await f.runtime.getCheckpointDiff(group.checkpointIds[0], true)).beforeContent, 'from b');
});

test('a parent command cannot write a nested read-only binding, including with one-call approval', async t => {
  const f = await fixture(t);
  const nested = join(f.a, 'readonly'); await mkdir(nested);
  const target = join(nested, 'source.txt'); await writeFile(target, 'original');
  const runtime = await MultiWorkspaceToolRuntime.create({ primaryBindingId: 'parent', permissionMode: 'full_access',
    bindings: [{ id: 'parent', path: f.a, permissionMode: 'full_access' }, { id: 'nested', path: nested, permissionMode: 'read_only' }],
    checkpointRootForWorkspace: path => join(f.base, path === f.a ? 'readonly-parent' : 'readonly-child') });
  t.after(() => runtime.dispose());
  const registry = new AgentToolRegistry(); runtime.registerTools(registry);
  let approvals = 0;
  for (const name of ['process.run', 'process.start']) {
    const result = await registry.execute({ id: name, name, arguments: { command: process.execPath, tty: false,
      allowOutsideWorkspace: true, args: ['-e', "require('node:fs').writeFileSync('readonly/source.txt','changed')"] } }, 'full_access',
      { runId: 'mixed-readonly', requestPermissionApproval: async () => { approvals++; return true; } });
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, 'WORKSPACE_COMMAND_PERMISSION_CONFLICT');
    assert.equal(await readFile(target, 'utf8'), 'original');
  }
  assert.equal(approvals, 0, 'one-call approval cannot override a binding permission');
  assert.deepEqual(runtime.getCreatedCheckpointIds(), [], 'rejected commands do not claim successful coverage');
  const read = await registry.execute({ id: 'read-child', name: 'workspace.read_file', arguments: { workspaceBindingId: 'nested', path: 'source.txt' } }, 'full_access', { runId: 'mixed-readonly' });
  assert.equal(read.ok, true); assert.equal((read.output as any).content, 'original');
});

test('disjoint read-only bindings also block unsandboxed absolute-path writes without disabling file tools', async t => {
  const f = await fixture(t, { secondPermission: 'read_only' });
  const result = await f.execute('process.run', { command: process.execPath, args: ['-e',
    `require('node:fs').writeFileSync(${JSON.stringify(join(f.b, 'same.txt'))},'changed')`] });
  assert.equal(result.ok, false); assert.equal(result.error?.code, 'WORKSPACE_COMMAND_PERMISSION_CONFLICT');
  assert.equal(await readFile(join(f.b, 'same.txt'), 'utf8'), 'from b');
  const edited = await f.execute('workspace.write_file', { path: 'allowed.txt', content: 'allowed' });
  assert.equal(edited.ok, true); assert.equal(await readFile(join(f.a, 'allowed.txt'), 'utf8'), 'allowed');
});

test('finalizing while an observed preparation is suspended seals all later command admission', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const ready = deferred(); const held = deferred();
  const original = WorkspaceToolRuntime.prototype.prepareObservedCommand;
  WorkspaceToolRuntime.prototype.prepareObservedCommand = async function(...args) {
    await original.apply(this, args); ready.resolve(); await held.promise;
  };
  try {
    const execution = f.execute('process.run', { command: process.execPath, args: ['-e', "require('node:fs').writeFileSync('after-stop.txt','late')"] });
    await ready.promise;
    await f.runtime.finalizeProcessCheckpoints();
    held.resolve();
    const result = await execution;
    assert.equal(result.ok, false); assert.equal(result.error?.code, 'CANCELLED');
    await assert.rejects(readFile(join(f.a, 'after-stop.txt')), { code: 'ENOENT' });
    assert.deepEqual(f.runtime.getCreatedCheckpointIds(), []);
    const retry = await f.execute('process.run', { command: process.execPath, args: ['-e', 'process.exit(0)'] });
    assert.equal(retry.error?.code, 'CANCELLED');
  } finally {
    held.resolve(); WorkspaceToolRuntime.prototype.prepareObservedCommand = original;
  }
});
