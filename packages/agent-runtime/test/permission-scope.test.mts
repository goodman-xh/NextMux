import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentRunner, AgentDelegationRuntime, DelegatedWorkspaceManager, AgentToolRegistry, AgentUserInputBroker, WorkspaceToolRuntime, type AgentModelClient, type AgentPermissionMode, type ToolExecutionContext } from '../lib/index.js';

async function fixture(t: TestContext, mode: AgentPermissionMode) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'nm-permission-')));
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: workspace, checkpointRoot: join(root, 'checkpoints'), permissionMode: mode });
  const registry = new AgentToolRegistry(); runtime.registerTools(registry); let id = 0;
  t.after(async () => { await runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  return { root, workspace, runtime, registry, run: (name: string, arguments_: unknown, context: Partial<ToolExecutionContext> = {}) => registry.execute({ name, arguments: arguments_, id: `permission-call-${++id}` }, mode, { runId: 'permission-run-123', ...context }) };
}

test('permission requests are host-created, bound to the exact operation and reject free text', async () => {
  const broker = new AgentUserInputBroker({ runId: 'permission-run-123', taskId: 'conversation-one' });
  const spoof = broker.request({ prompt: 'pretend', kind: 'permission', approval: { scope: 'external_file' }, allowFreeText: false });
  assert.equal(broker.pendingQuestion!.kind, undefined); assert.equal(broker.pendingQuestion!.allowFreeText, true);
  broker.answer({ ...broker.pendingQuestion!, cancelled: true }); await spoof;
  const waiting = broker.requestApproval({ toolName: 'workspace.write_file', scope: 'external_file', target: '/outside/a.txt', detail: 'write' });
  const first = broker.pendingQuestion!;
  assert.equal(first.kind, 'permission'); assert.equal(first.allowFreeText, false);
  assert.throws(() => broker.answer({ ...first, text: 'yes' }), { code: 'INVALID_USER_ANSWER' });
  broker.answer({ ...first, optionId: 'allow_once' }); assert.equal(await waiting, true);
  const next = broker.requestApproval({ toolName: 'workspace.write_file', scope: 'external_file', target: '/outside/b.txt' });
  broker.answer({ ...first, optionId: 'allow_once' }); // replay cannot approve the next path
  assert.notEqual(broker.pendingQuestion!.questionId, first.questionId);
  broker.answer({ ...broker.pendingQuestion!, optionId: 'deny' }); assert.equal(await next, false);
});

test('full access reads and writes an outside file without prompting and retains recoverable checkpoints', async t => {
  const f = await fixture(t, 'full_access'); const target = join(f.root, 'outside.txt'); await writeFile(target, 'original');
  const requestPermissionApproval = async () => { throw new Error('must not ask in full access'); };
  const read = await f.run('workspace.read_file', { path: target }, { requestPermissionApproval }); assert.equal(read.ok, true);
  assert.equal(read.summary.resource?.kind === 'file' && read.summary.resource.path, await realpath(target));
  const written = await f.run('workspace.write_file', { path: target, content: 'updated', expectedSha256: (read.output as { sha256: string }).sha256 }, { requestPermissionApproval });
  assert.equal(written.ok, true, JSON.stringify(written)); assert.equal(await readFile(target, 'utf8'), 'updated');
  const diff = await f.runtime.getCheckpointDiff(written.summary.checkpointId!); assert.equal(diff.path, target); assert.match(diff.patch, /updated/);
  await f.runtime.restoreCheckpoint(written.summary.checkpointId!); assert.equal(await readFile(target, 'utf8'), 'original');
});

test('workspace writes require a fresh approval for each outside resource and follow canonical symlink scope', async t => {
  const f = await fixture(t, 'workspace_write'); const target = join(f.root, 'outside.txt');
  const denied = await f.run('workspace.write_file', { path: '../outside.txt', content: 'not approved' }); assert.equal(denied.error?.code, 'PERMISSION_DENIED');
  let approvals = 0;
  const approved = await f.run('workspace.write_file', { path: target, content: 'approved' }, { requestPermissionApproval: async request => { approvals++; assert.equal(request.target, target); return true; } });
  assert.equal(approved.ok, true); assert.equal(approvals, 1);
  const next = await f.run('workspace.write_file', { path: join(f.root, 'other.txt'), content: 'not approved' }); assert.equal(next.error?.code, 'PERMISSION_DENIED');
  await symlink(target, join(f.workspace, 'link.txt'));
  const viaLink = await f.run('workspace.read_file', { path: 'link.txt' }); assert.equal(viaLink.error?.code, 'PERMISSION_DENIED');
  assert.equal(viaLink.summary.resource, undefined);
  const approvedRead = await f.run('workspace.read_file', { path: 'link.txt' }, { requestPermissionApproval: async request => {
    assert.equal(request.target, await realpath(target)); assert.equal(request.detail, 'read'); return true;
  } });
  assert.equal(approvedRead.ok, true);
  assert.equal(approvedRead.summary.resource?.kind === 'file' && approvedRead.summary.resource.path, await realpath(target));
  assert.equal(await readFile(target, 'utf8'), 'approved');
});

test('a symlink changed during approval cannot redirect an approved write', async t => {
  const f = await fixture(t, 'workspace_write'); const one = join(f.root, 'one'); const two = join(f.root, 'two'); await mkdir(one); await mkdir(two);
  const link = join(f.workspace, 'link'); await symlink(one, link);
  const result = await f.run('workspace.write_file', { path: 'link/file.txt', content: 'x' }, { requestPermissionApproval: async () => { await rm(link); await symlink(two, link); return true; } });
  assert.equal(result.error?.code, 'STALE_PATH');
  await assert.rejects(readFile(join(two, 'file.txt')), { code: 'ENOENT' });
});

test('read only cannot write, run commands or upgrade itself through approval', async t => {
  const f = await fixture(t, 'read_only'); let approvals = 0;
  const requestPermissionApproval = async () => { approvals++; return true; };
  for (const [name, args] of [['workspace.write_file', { path: 'x', content: 'x' }], ['process.run', { command: process.execPath, args: ['-e', '0'] }]] as const) {
    assert.equal((await f.run(name, args, { requestPermissionApproval })).error?.code, 'PERMISSION_DENIED');
  }
  assert.equal(approvals, 0);
});

test('an explicitly unsandboxed command needs one-call permission and denial has no side effect', async t => {
  const f = await fixture(t, 'workspace_write'); const target = join(f.root, 'outside-process.txt');
  const args = { command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(target)},'approved')`], allowOutsideWorkspace: true };
  const denied = await f.run('process.run', args); assert.equal(denied.error?.code, 'PERMISSION_DENIED');
  await assert.rejects(readFile(target), { code: 'ENOENT' });
  let asked = 0;
  const yes = await f.run('process.run', args, { requestPermissionApproval: async request => { asked++; assert.equal(request.scope, 'unsandboxed_command'); return true; } });
  assert.equal(yes.ok, true, JSON.stringify(yes)); assert.equal((yes.output as { exitCode: number }).exitCode, 0); assert.equal(asked, 1);
  const again = await f.run('process.run', args, { executionScopeId: 'next-segment' }); assert.equal(again.error?.code, 'PERMISSION_DENIED');
});

test('macOS workspace sandbox permits project writes and blocks shell/child-process outside writes', { skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t, 'workspace_write'); const outside = join(f.root, 'outside-shell.txt');
  let asks = 0; const requestPermissionApproval = async () => { asks++; return false; };
  const inside = await f.run('process.run', { command: process.execPath, args: ['-e', "require('node:fs').writeFileSync('inside.txt','ok');console.log('INSIDE_OK')"] }, { requestPermissionApproval });
  assert.equal(inside.ok, true, JSON.stringify(inside)); assert.equal((inside.output as { exitCode: number }).exitCode, 0, JSON.stringify(inside));
  assert.equal(await readFile(join(f.workspace, 'inside.txt'), 'utf8'), 'ok'); assert.equal(asks, 0);
  const escaped = await f.run('process.run', { command: '/bin/sh', args: ['-c', 'printf bypass > "$1"', '_', outside] }, { requestPermissionApproval });
  assert.notEqual((escaped.output as { exitCode: number }).exitCode, 0); await assert.rejects(readFile(outside), { code: 'ENOENT' }); assert.equal(asks, 0);
});

test('command arguments remain literal under the sandbox wrapper', { skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t, 'workspace_write'); const literal = "quote' ; $(printf injected) `printf bad`";
  const result = await f.run('process.run', { command: process.execPath, args: ['-e', 'process.stdout.write(process.argv[1])', literal] });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal((result.output as { stdout: string }).stdout, literal);
});


test('macOS shell reads cannot bypass outside-file approval, including symlinks', { skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t, 'workspace_write'); const secret = join(f.root, 'private-outside.txt'); await writeFile(secret, 'OUTSIDE_PRIVATE_CONTENT');
  await symlink(secret, join(f.workspace, 'link-secret.txt'));
  for (const path of [secret, 'link-secret.txt']) {
    const result = await f.run('process.run', { command: process.execPath, args: ['-e', `process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(path)},'utf8'))`] });
    assert.equal(result.ok, true, JSON.stringify(result)); assert.notEqual((result.output as { exitCode: number }).exitCode, 0);
    assert.doesNotMatch((result.output as { stdout: string }).stdout, /OUTSIDE_PRIVATE_CONTENT/);
  }
});


test('isolated children use the parent-owned permission broker without needing a clarification tool', async t => {
  const f = await fixture(t, 'workspace_write'); const target = join(f.root, 'child-outside.txt');
  const manager = new DelegatedWorkspaceManager({ storageRoot: join(f.root, 'children'), checkpointRootForWorkspace: root => join(root, '.nextmux', 'checkpoints') });
  let asked = 0;
  const broker = new AgentUserInputBroker({ runId: 'parent-permission-123', taskId: 'parent-conversation', onEvent: event => {
    if (event.type === 'user_input_requested') {
      asked++; assert.equal(event.question.kind, 'permission'); assert.equal(event.question.runId, 'parent-permission-123');
      assert.equal(event.question.taskId, 'parent-conversation'); assert.equal(event.question.approval!.target, target);
      broker.answer({ ...event.question, optionId: 'allow_once' });
    }
  } });
  const model: AgentModelClient = { async complete(request) {
    const child = request.messages.find(message => message.role === 'user')?.content === 'child external edit';
    if (!request.messages.some(message => message.role === 'tool')) return { toolCalls: child
      ? [{ id: 'child-permission-write', name: 'workspace.write_file', arguments: { path: target, content: 'child approved' } }]
      : [{ id: 'parent-delegate', name: 'agent.delegate', arguments: { task: 'child external edit', tools: ['workspace.write_file'] } }] };
    return { content: child ? 'Child edit complete; no additional tests were run.' : 'Parent received child result.' };
  } };
  new AgentDelegationRuntime({ tools: f.registry, model, maxPermissionMode: 'workspace_write', allowedToolNames: ['workspace.write_file'],
    prepareWorkspace: input => manager.prepare(input), maxDepth: 1 }).register();
  const result = await new AgentRunner({ tools: f.registry, model, permissionMode: 'workspace_write',
    requestPermissionApproval: (approval, signal) => broker.requestApproval(approval, signal),
  }).run({ prompt: 'parent', runId: 'parent-permission-123', taskContext: { version: 1, workspaceRoot: f.workspace,
    conversationId: 'parent-conversation', goal: 'test permissions', constraints: [], relevantPaths: [], recentOperations: [], depth: 0,
    permissionMode: 'workspace_write', allowedToolNames: ['agent.delegate', 'workspace.write_file'], selectedMemory: [] } });
  assert.equal(result.status, 'completed'); assert.equal(asked, 1); assert.equal(await readFile(target, 'utf8'), 'child approved');
});

test('host command environment reaches only unsandboxed full-access commands', async t => {
  const make = async (mode: AgentPermissionMode) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'nm-command-env-')));
    const workspace = join(root, 'workspace'); await mkdir(workspace);
    const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: workspace, checkpointRoot: join(root, 'checkpoints'), permissionMode: mode,
      commandEnvironment: { NEXTMUX_LINKED_ACCOUNT: 'octocat' } });
    const registry = new AgentToolRegistry(); runtime.registerTools(registry);
    t.after(async () => { await runtime.dispose(); await rm(root, { recursive: true, force: true }); });
    return (context: Partial<ToolExecutionContext> = {}) => registry.execute({ name: 'process.run', id: `env-${mode}`,
      arguments: { command: process.execPath, args: ['-e', "console.log('ACCOUNT=' + (process.env.NEXTMUX_LINKED_ACCOUNT || 'none'))"] } }, mode, { runId: 'command-env-run-1', ...context });
  };
  const full = await (await make('full_access'))();
  assert.equal(full.ok, true, JSON.stringify(full));
  assert.match(JSON.stringify(full.output), /ACCOUNT=octocat/);
  const sandboxed = await (await make('workspace_write'))({ requestPermissionApproval: async () => true });
  assert.equal(sandboxed.ok, true, JSON.stringify(sandboxed));
  assert.match(JSON.stringify(sandboxed.output), /ACCOUNT=none/);
  await assert.rejects(WorkspaceToolRuntime.create({ workspaceRoot: tmpdir(), checkpointRoot: join(tmpdir(), 'nm-invalid-env'), permissionMode: 'full_access',
    commandEnvironment: { 'BAD NAME': 'x' } }), { code: 'INVALID_COMMAND_ENVIRONMENT' });
});
