import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { AgentToolRegistry } from '../lib/registry.js';
import { WorkspaceToolRuntime } from '../lib/workspace-tools.js';
import { MultiWorkspaceToolRuntime } from '../lib/multi-workspace-tools.js';
import { workspaceDirectoryIdentity } from '../lib/workspace-identity.js';

async function fixture(t: TestContext, multi = false) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'nm-root-identity-')));
  const root = join(base, 'project'), other = join(base, 'other'), checkpoints = join(base, 'checkpoints');
  await Promise.all([mkdir(root), mkdir(other)]);
  await writeFile(join(root, 'source.txt'), 'original');
  const runtime = multi ? await MultiWorkspaceToolRuntime.create({
    permissionMode: 'full_access', primaryBindingId: 'primary',
    bindings: [{ id: 'primary', path: other, permissionMode: 'full_access' }, { id: 'target', path: root, permissionMode: 'full_access' }],
    checkpointRootForWorkspace: path => path === root ? checkpoints : join(base, 'other-checkpoints'),
  }) : await WorkspaceToolRuntime.create({ workspaceRoot: root, checkpointRoot: checkpoints, permissionMode: 'full_access' });
  const registry = new AgentToolRegistry(); runtime.registerTools(registry);
  let call = 0;
  const execute = (name: string, args: Record<string, unknown>) => registry.execute(
    { id: `identity-${++call}`, name, arguments: { ...(multi ? { workspaceBindingId: 'target' } : {}), ...args } },
    'full_access', { runId: 'identity-test' });
  t.after(async () => { try { await runtime.dispose(); } finally { await rm(base, { recursive: true, force: true }); } });
  return { base, root, other, checkpoints, runtime, execute };
}

for (const multi of [false, true]) test(`${multi ? 'multi' : 'single'} workspace rejects moved/replaced roots but accepts the restored original and ordinary edits`, async t => {
  const f = await fixture(t, multi);
  const originalIdentity = await workspaceDirectoryIdentity(f.root);
  await mkdir(join(f.root, 'new-folder'));
  assert.equal((await f.execute('workspace.read_file', { path: 'source.txt' })).ok, true, 'normal directory mtime changes are allowed');
  await rename(f.root, join(f.base, 'moved'));
  assert.equal((await f.execute('workspace.read_file', { path: 'source.txt' })).error?.code, 'STALE_WORKSPACE_BINDING');
  await mkdir(f.root);
  await writeFile(join(f.root, 'source.txt'), 'replacement');
  assert.notEqual(await workspaceDirectoryIdentity(f.root), originalIdentity);
  for (const [name, args] of [
    ['workspace.read_file', { path: 'source.txt' }],
    ['workspace.write_file', { path: 'new.txt', content: 'must not write' }],
    ['process.run', { command: 'pwd' }],
    ['process.start', { command: process.execPath, args: ['-e', 'console.log(1)'], tty: false }],
  ] as const) assert.equal((await f.execute(name, args)).error?.code, 'STALE_WORKSPACE_BINDING', name);
  assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'replacement');
  assert.deepEqual(await readdir(f.root), ['source.txt']);
  if (multi) assert.equal((await f.execute('workspace.list_files', { workspaceBindingId: 'primary', path: '.' })).ok, true);
  await rename(f.root, join(f.base, 'replacement'));
  await rename(join(f.base, 'moved'), f.root);
  assert.equal((await f.execute('workspace.read_file', { path: 'source.txt' })).output && ((await f.execute('workspace.read_file', { path: 'source.txt' })).output as any).content, 'original');
  assert.equal((await f.execute('workspace.write_file', { path: 'restored.txt', content: 'safe' })).ok, true);
});

test('multi workspace verifies the identity captured before host checkpoint-store resolution', async t => {
  const f = await fixture(t);
  await assert.rejects(MultiWorkspaceToolRuntime.create({
    permissionMode: 'full_access', primaryBindingId: 'target',
    bindings: [{ id: 'target', path: f.root, permissionMode: 'full_access' }],
    checkpointRootForWorkspace: async () => {
      await rename(f.root, join(f.base, 'moved'));
      await mkdir(f.root);
      return join(f.base, 'new-checkpoints');
    },
  }), { code: 'STALE_WORKSPACE_BINDING' });
});

async function startCommand(f: Awaited<ReturnType<typeof fixture>>) {
  const started = await f.execute('process.start', { command: process.execPath, tty: false, pipeStdin: true,
    args: ['-e', "require('node:fs').writeFileSync('source.txt','command edit');console.log('ready');setInterval(()=>{},1000)"] });
  assert.equal(started.ok, true);
  const processId = (started.output as any).processId;
  let text = '', afterSequence = 0;
  for (let attempt = 0; attempt < 10 && !text.includes('ready'); attempt++) {
    const result = await f.execute('process.read', { processId, afterSequence, waitMs: 500 });
    assert.equal(result.ok, true);
    text += (result.output as any).chunks.map((chunk: any) => chunk.text).join('');
    afterSequence = (result.output as any).nextSequence;
  }
  assert.match(text, /ready/);
  return processId;
}

test('an owned process still stops after replacement; preserved snapshot only resumes against the original root', { timeout: 15000 }, async t => {
  const f = await fixture(t, true);
  const processId = await startCommand(f);
  await rename(f.root, join(f.base, 'moved'));
  await mkdir(f.root);
  await writeFile(join(f.root, 'source.txt'), 'unrelated replacement');
  assert.equal((await f.execute('process.write', { processId, data: 'test' })).error?.code, 'STALE_WORKSPACE_BINDING');
  const began = Date.now();
  const stopped = await f.execute('process.terminate', { processId });
  assert.equal(stopped.ok, true);
  assert.equal((stopped.output as any).running, false);
  assert.ok(Date.now() - began < 5000, 'directory failure must not prevent termination');
  assert.equal((stopped.output as any).checkpointCoverage.complete, false);
  assert.match(JSON.stringify((stopped.output as any).checkpointCoverage.warnings), /moved or replaced/);
  assert.deepEqual(f.runtime.getCreatedCheckpointIds(), []);
  const pending = await readdir(join(f.checkpoints, '.pending-commands'));
  assert.equal(pending.length, 1, 'the original durable snapshot must be retained');
  const manifest = JSON.parse(await readFile(join(f.checkpoints, '.pending-commands', pending[0], 'snapshot.json'), 'utf8'));
  assert.equal(manifest.directoryIdentity, await workspaceDirectoryIdentity(join(f.base, 'moved')));
  assert.equal(await readFile(join(f.checkpoints, '.pending-commands', pending[0], `${manifest.files[0].sha256}.bin`), 'utf8'), 'original');
  await rename(f.root, join(f.base, 'replacement'));
  await rename(join(f.base, 'moved'), f.root);
  const collected = await f.execute('process.read', { processId, waitMs: 0 });
  assert.equal(collected.ok, true);
  assert.equal((collected.output as any).checkpointCoverage.complete, true);
  assert.equal(f.runtime.getCreatedCheckpointIds().length, 1);
  const diff = await f.runtime.getCheckpointDiff(f.runtime.getCreatedCheckpointIds()[0], true);
  assert.equal(diff.beforeContent, 'original');
  assert.equal(diff.afterContent, 'command edit');
  assert.equal(await readFile(join(f.base, 'replacement', 'source.txt'), 'utf8'), 'unrelated replacement');
});

test('finalization stops a process without recording replacement files; restart preserves an unverified directory snapshot', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const processId = await startCommand(f);
  await rename(f.root, join(f.base, 'moved'));
  await mkdir(f.root);
  await writeFile(join(f.root, 'source.txt'), 'replacement');
  await f.runtime.finalizeProcessCheckpoints();
  assert.equal((await f.execute('process.read', { processId, waitMs: 0 })).output && ((await f.execute('process.read', { processId, waitMs: 0 })).output as any).running, false);
  assert.deepEqual(f.runtime.getCreatedCheckpointIds(), []);
  const pending = await readdir(join(f.checkpoints, '.pending-commands'));
  assert.equal(pending.length, 1);
  const manifestPath = join(f.checkpoints, '.pending-commands', pending[0], 'snapshot.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.ownerPid = 2147483647;
  await writeFile(manifestPath, JSON.stringify(manifest));
  const reopened = await WorkspaceToolRuntime.create({ workspaceRoot: f.root, checkpointRoot: f.checkpoints, permissionMode: 'full_access' });
  try {
    assert.deepEqual(reopened.getCreatedCheckpointIds(), []);
    assert.match(reopened.getCheckpointWarnings().join('\n'), /manual review/);
    assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'replacement');
    assert.deepEqual(await readdir(join(f.checkpoints, '.pending-commands')), pending);
  } finally { await reopened.dispose(); }
});

test('reopening a recreated same-path directory permits a new task and an explicit CAS-checked historical file restore', async t => {
  const f = await fixture(t);
  const initial = await f.execute('workspace.read_file', { path: 'source.txt' });
  const edited = await f.execute('workspace.write_file', { path: 'source.txt', content: 'saved edit', expectedSha256: (initial.output as any).sha256 });
  assert.equal(edited.ok, true);
  const checkpointId = edited.summary.checkpointId!;
  await rm(f.root, { recursive: true });
  await mkdir(f.root);
  assert.equal((await f.execute('workspace.read_file', { path: 'source.txt' })).error?.code, 'STALE_WORKSPACE_BINDING');
  const reopened = await WorkspaceToolRuntime.create({ workspaceRoot: f.root, checkpointRoot: f.checkpoints, permissionMode: 'full_access' });
  try {
    const registry = new AgentToolRegistry(); reopened.registerTools(registry);
    const read = await registry.execute({ id: 'reopened-list', name: 'workspace.list_files', arguments: { path: '.' } }, 'full_access', { runId: 'new-task' });
    assert.equal(read.ok, true, 'new runtime binds the newly opened directory instead of permanently banning its path');
    assert.deepEqual(await readdir(f.root), [], 'reopening alone must not restore old files');
    assert.ok((await reopened.listFileVersions({ checkpointId })).versions.some(version => version.checkpointId === checkpointId));
    assert.equal((await reopened.getCheckpointDiff(checkpointId, true)).afterContent, 'saved edit');
    const conversationId = randomUUID();
    const restored = await reopened.restoreFileVersion({ checkpointId, side: 'after', expectedSha256: null, conversationId });
    assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'saved edit');
    await writeFile(join(f.root, 'source.txt'), 'manual edit after preview');
    await assert.rejects(reopened.restoreFileVersion({ checkpointId, side: 'before', expectedSha256: restored.sha256, conversationId }), { code: 'ROLLBACK_CONFLICT' });
    assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'manual edit after preview');
    const current = await reopened.getFileState({ checkpointId });
    await reopened.restoreFileVersion({ checkpointId, side: 'before', expectedSha256: current.sha256, conversationId });
    assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'original');
  } finally { await reopened.dispose(); }
});
