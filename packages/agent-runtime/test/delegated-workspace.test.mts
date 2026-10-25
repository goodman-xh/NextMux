import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm, symlink, chmod, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { AgentDelegationRuntime, AgentToolError, AgentToolRegistry, DelegatedWorkspaceManager, WorkspaceToolRuntime, type AgentDelegateOutput } from '../lib/index.js';

async function fixture(t: test.TestContext, gitRepo = false) {
  const home = await mkdtemp(join(tmpdir(), 'nm-child-workspace-'));
  let root = join(home, 'source'); await mkdir(root); root = await realpath(root);
  await writeFile(join(root, 'file.txt'), 'original\n');
  if (gitRepo) {
    for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'initial']]) execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  }
  const checkpointRootForWorkspace = (path: string) => join(home, 'checkpoints', createHash('sha256').update(path).digest('hex'));
  const options = { storageRoot: join(home, 'children'), checkpointRootForWorkspace };
  const manager = new DelegatedWorkspaceManager(options);
  t.after(async () => { await rm(home, { recursive: true, force: true }); });
  const prepare = () => manager.prepare({ childRunId: `child-${randomUUID()}`, parentRunId: 'parent-test-run', workspaceRoot: root, permissionMode: 'full_access', conversationId: 'conversation-a', rootRunId: 'root-test-run' });
  return { root, home, manager, options, prepare, checkpointRootForWorkspace };
}

test('Git worktree includes dirty source and leaves index, branch and parent contents untouched', async t => {
  const f = await fixture(t, true);
  await writeFile(join(f.root, 'file.txt'), 'unsaved to git\n');
  await writeFile(join(f.root, 'new.txt'), 'untracked\n');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.root }).toString();
  const index = execFileSync('git', ['diff', '--cached'], { cwd: f.root }).toString();
  const child = await f.prepare();
  assert.equal(await readFile(join(child.workspaceRoot, 'file.txt'), 'utf8'), 'unsaved to git\n');
  assert.equal(await readFile(join(child.workspaceRoot, 'new.txt'), 'utf8'), 'untracked\n');
  await writeFile(join(child.workspaceRoot, 'file.txt'), 'child change\n');
  const review = await child.review();
  assert.equal(review.kind, 'git_worktree'); assert.equal(review.changes.length, 1);
  assert.match(review.changes[0].patch, /unsaved to git/);
  assert.equal(await readFile(join(f.root, 'file.txt'), 'utf8'), 'unsaved to git\n');
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.root }).toString(), head);
  assert.equal(execFileSync('git', ['diff', '--cached'], { cwd: f.root }).toString(), index);
});

test('non-Git snapshot merges explicit reviewed creations, binary and deletions with restorable checkpoints', async t => {
  const f = await fixture(t); const child = await f.prepare();
  await rm(join(child.workspaceRoot, 'file.txt'));
  await writeFile(join(child.workspaceRoot, 'binary.bin'), Buffer.from([0, 1, 2]));
  await writeFile(join(child.workspaceRoot, 'new.txt'), 'new content');
  const review = await child.review(); assert.equal(review.kind, 'snapshot'); assert.equal(review.changes.length, 3);
  const result = await f.manager.merge(review.childRunId, review.reviewId);
  assert.equal(result.verificationInvalidated, true); assert.equal(result.checkpointIds.length, 3);
  assert.deepEqual(await readFile(join(f.root, 'binary.bin')), Buffer.from([0, 1, 2]));
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: f.root, checkpointRoot: f.checkpointRootForWorkspace(f.root), permissionMode: 'workspace_write' });
  await runtime.restoreCheckpointChain([...result.checkpointIds].reverse()); await runtime.dispose();
  assert.equal(await readFile(join(f.root, 'file.txt'), 'utf8'), 'original\n');
  await assert.rejects(readFile(join(f.root, 'new.txt')), { code: 'ENOENT' });
});

test('parallel children never overwrite each other and a merge conflict rejects the entire batch', async t => {
  const f = await fixture(t); const [a, b] = await Promise.all([f.prepare(), f.prepare()]);
  await writeFile(join(a.workspaceRoot, 'file.txt'), 'a\n'); await writeFile(join(b.workspaceRoot, 'file.txt'), 'b\n');
  await writeFile(join(b.workspaceRoot, 'new.txt'), 'must not merge');
  const ar = await a.review(); const br = await b.review();
  await f.manager.merge(ar.childRunId, ar.reviewId);
  await assert.rejects(f.manager.merge(br.childRunId, br.reviewId), { code: 'MERGE_CONFLICT' });
  assert.equal(await readFile(join(f.root, 'file.txt'), 'utf8'), 'a\n');
  await assert.rejects(readFile(join(f.root, 'new.txt')), { code: 'ENOENT' });
  assert.equal(await readFile(join(b.workspaceRoot, 'file.txt'), 'utf8'), 'b\n');
});

test('stale review, parent user edits and foreign ownership are rejected; persisted review survives restart', async t => {
  const f = await fixture(t); const child = await f.prepare();
  await writeFile(join(child.workspaceRoot, 'file.txt'), 'first result');
  const old = await child.review();
  await writeFile(join(child.workspaceRoot, 'file.txt'), 'second result');
  await assert.rejects(f.manager.merge(old.childRunId, old.reviewId), { code: 'STALE_CHILD_REVIEW' });
  const restarted = new DelegatedWorkspaceManager(f.options);
  const review = await restarted.review(old.childRunId);
  await assert.rejects(restarted.ownedWorkspace(old.childRunId, { conversationId: 'conversation-b' }), { code: 'CHILD_WORKSPACE_OWNER_MISMATCH' });
  const owned = await restarted.ownedWorkspace(old.childRunId, { conversationId: 'conversation-a', workspaceRoot: f.root, parentRunId: 'parent-test-run' });
  assert.equal(owned.workspaceRoot, child.workspaceRoot);
  await writeFile(join(f.root, 'file.txt'), 'user intervened');
  await assert.rejects(restarted.merge(review.childRunId, review.reviewId), { code: 'MERGE_CONFLICT' });
  assert.equal(await readFile(join(f.root, 'file.txt'), 'utf8'), 'user intervened');
});

test('symlink destination cannot escape source and a completed merge is idempotent', async t => {
  const f = await fixture(t); const child = await f.prepare();
  await mkdir(join(child.workspaceRoot, 'sub')); await writeFile(join(child.workspaceRoot, 'sub', 'new.txt'), 'safe');
  await mkdir(join(f.home, 'outside')); await symlink(join(f.home, 'outside'), join(f.root, 'sub'), process.platform === 'win32' ? 'junction' : 'dir');
  const blocked = await child.review(); assert.deepEqual(blocked.conflicts, ['sub/new.txt']);
  await assert.rejects(f.manager.merge(blocked.childRunId, blocked.reviewId), { code: 'MERGE_CONFLICT' });
  await rm(join(f.root, 'sub'));
  const first = await f.manager.merge(blocked.childRunId, blocked.reviewId);
  assert.deepEqual(await f.manager.merge(blocked.childRunId, blocked.reviewId), first);
});

test('write-capable delegation rebinds workspace tools and returns review without auto-merging', async t => {
  const f = await fixture(t);
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: f.root, checkpointRoot: f.checkpointRootForWorkspace(f.root), permissionMode: 'full_access' });
  const tools = new AgentToolRegistry(); runtime.registerTools(tools);
  let count = 0;
  new AgentDelegationRuntime({
    tools, maxPermissionMode: 'full_access', allowedToolNames: ['workspace.write_file'],
    prepareWorkspace: input => f.manager.prepare({ ...input, conversationId: 'conversation-a' }),
    model: { async complete() { return ++count === 1 ? { toolCalls: [{ id: 'write-child', name: 'workspace.write_file', arguments: { path: 'child-only.txt', content: 'child result' } }] } : { content: 'done' }; } },
  }).register();
  const result = await tools.execute({ id: 'delegate-one', name: 'agent.delegate', arguments: { task: 'write child file' } }, 'full_access', { runId: 'parent-delegation-test', workspaceRoot: f.root });
  assert.equal(result.ok, true); const output = result.output as AgentDelegateOutput;
  assert.equal(output.workspaceReview?.requiresMerge, true);
  assert.equal(output.workspaceReview?.changes[0].path, 'child-only.txt');
  await assert.rejects(readFile(join(f.root, 'child-only.txt')), { code: 'ENOENT' });
  assert.equal(await readFile(join(output.workspaceReview!.workspaceRoot, 'child-only.txt'), 'utf8'), 'child result');
  await runtime.dispose();
});

test('an ordinary merge executor failure stays reviewable and can be retried', async t => {
  const f = await fixture(t); const child = await f.prepare();
  await writeFile(join(child.workspaceRoot, 'file.txt'), 'result');
  const review = await child.review();
  const original = WorkspaceToolRuntime.prototype.applyReviewedChanges;
  try {
    WorkspaceToolRuntime.prototype.applyReviewedChanges = async () => { throw new AgentToolError('MERGE_CONFLICT', 'concurrent editor during preflight'); };
    await assert.rejects(f.manager.merge(review.childRunId, review.reviewId), { code: 'MERGE_CONFLICT' });
  } finally { WorkspaceToolRuntime.prototype.applyReviewedChanges = original; }
  assert.equal((await f.manager.ownedWorkspace(review.childRunId, { conversationId: 'conversation-a' })).state, 'reviewable');
  assert.equal(await readFile(join(f.root, 'file.txt'), 'utf8'), 'original\n');
  await f.manager.merge(review.childRunId, review.reviewId);
  assert.equal(await readFile(join(f.root, 'file.txt'), 'utf8'), 'result');
});

test('interrupted merge has explicit persisted rollback and preserves later user edits', async t => {
  const f = await fixture(t); const child = await f.prepare();
  await writeFile(join(child.workspaceRoot, 'file.txt'), 'child result');
  await writeFile(join(child.workspaceRoot, 'new.txt'), 'new child result');
  const review = await child.review();
  const original = WorkspaceToolRuntime.prototype.applyReviewedChanges;
  try {
    WorkspaceToolRuntime.prototype.applyReviewedChanges = async function(changes, context) {
      await original.call(this, changes, context);
      throw new AgentToolError('MERGE_PARTIAL', 'simulate process interruption after checkpointed write');
    };
    await assert.rejects(f.manager.merge(review.childRunId, review.reviewId), { code: 'MERGE_PARTIAL' });
  } finally { WorkspaceToolRuntime.prototype.applyReviewedChanges = original; }
  const restarted = new DelegatedWorkspaceManager(f.options);
  assert.deepEqual((await restarted.review(review.childRunId)).interruptedMerge, { reviewId: review.reviewId });
  await assert.rejects(restarted.recoverInterruptedMerge(review.childRunId, 'b'.repeat(64)), { code: 'INVALID_MERGE_RECOVERY' });
  await writeFile(join(f.root, 'file.txt'), 'user newer edit');
  await assert.rejects(restarted.recoverInterruptedMerge(review.childRunId, review.reviewId), { code: 'MERGE_RECOVERY_CONFLICT' });
  assert.equal(await readFile(join(f.root, 'file.txt'), 'utf8'), 'user newer edit');
  assert.equal(await readFile(join(f.root, 'new.txt'), 'utf8'), 'new child result');
  await writeFile(join(f.root, 'file.txt'), 'child result');
  const recovered = await restarted.recoverInterruptedMerge(review.childRunId, review.reviewId);
  assert.equal(recovered.restoredCheckpointIds.length, 2);
  assert.equal(await readFile(join(f.root, 'file.txt'), 'utf8'), 'original\n');
  await assert.rejects(readFile(join(f.root, 'new.txt')), { code: 'ENOENT' });
  assert.equal((await restarted.ownedWorkspace(review.childRunId, { conversationId: 'conversation-a' })).state, 'reviewable');
  await restarted.merge(review.childRunId, review.reviewId);
  assert.equal(await readFile(join(f.root, 'file.txt'), 'utf8'), 'child result');
});

test('trusted delegation catalog over 128 tools stays discoverable without widening model-selected tools', async () => {
  const tools = new AgentToolRegistry();
  const names = Array.from({ length: 256 }, (_, index) => `fixture.tool_${index}`);
  for (const name of names) tools.register({ name, description: name, requiredPermission: 'read_only', source: 'builtin', inputSchema: { type: 'object' } }, async () => ({ modelOutput: { ok: true }, summary: { title: 'read' } }));
  let available: string[] = [];
  new AgentDelegationRuntime({ tools, maxPermissionMode: 'read_only', allowedToolNames: names,
    model: { async complete(request) { available = request.tools.map(tool => tool.name); return { content: 'Read-only audit complete' }; } },
  }).register();
  const result = await tools.execute({ id: 'large-catalog', name: 'agent.delegate', arguments: { task: 'inspect late tool', tools: [names[255]] } }, 'read_only', { runId: 'large-catalog-parent' });
  assert.equal(result.ok, true); assert.ok(available.includes(names[255]));
  const oversized = await tools.execute({ id: 'oversized-selection', name: 'agent.delegate', arguments: { task: 'inspect', tools: names.slice(0, 65) } }, 'read_only', { runId: 'large-catalog-parent' });
  assert.equal(oversized.ok, false); assert.equal(oversized.error?.code, 'INVALID_DELEGATION_INPUT');
});

test('tracked generated and ignored files inherit dirty content and participate in review and merge', async t => {
  const f = await fixture(t, true);
  await mkdir(join(f.root, 'dist')); await writeFile(join(f.root, '.gitignore'), 'ignored.txt\n');
  await writeFile(join(f.root, 'ignored.txt'), 'old ignored');
  await writeFile(join(f.root, 'dist', 'source.js'), 'old generated');
  await writeFile(join(f.root, 'dist', 'deleted.js'), 'deleted in source');
  execFileSync('git', ['add', '-f', '.gitignore', 'ignored.txt', 'dist'], { cwd: f.root });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'tracked excluded paths'], { cwd: f.root });
  await writeFile(join(f.root, 'ignored.txt'), 'dirty ignored');
  await writeFile(join(f.root, 'dist', 'source.js'), 'dirty generated');
  await rm(join(f.root, 'dist', 'deleted.js'));
  const child = await f.prepare();
  assert.equal(await readFile(join(child.workspaceRoot, 'ignored.txt'), 'utf8'), 'dirty ignored');
  assert.equal(await readFile(join(child.workspaceRoot, 'dist', 'source.js'), 'utf8'), 'dirty generated');
  await assert.rejects(readFile(join(child.workspaceRoot, 'dist', 'deleted.js')), { code: 'ENOENT' });
  await writeFile(join(child.workspaceRoot, 'dist', 'source.js'), 'child generated');
  await rm(join(child.workspaceRoot, 'ignored.txt'));
  const review = await child.review(); assert.deepEqual(review.changes.map(change => change.path), ['dist/source.js', 'ignored.txt']);
  await f.manager.merge(review.childRunId, review.reviewId);
  assert.equal(await readFile(join(f.root, 'dist', 'source.js'), 'utf8'), 'child generated');
  await assert.rejects(readFile(join(f.root, 'ignored.txt')), { code: 'ENOENT' });
});

test('mode-only merge and checkpoint restore preserve requested permissions despite process umask', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t); await chmod(join(f.root, 'file.txt'), 0o644);
  const child = await f.prepare(); await chmod(join(child.workspaceRoot, 'file.txt'), 0o664);
  const review = await child.review(); assert.equal(review.changes.length, 1);
  const result = await f.manager.merge(review.childRunId, review.reviewId);
  assert.equal((await stat(join(f.root, 'file.txt'))).mode & 0o777, 0o664);
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: f.root, checkpointRoot: f.checkpointRootForWorkspace(f.root), permissionMode: 'workspace_write' });
  try { await runtime.restoreCheckpointChain(result.checkpointIds); }
  finally { await runtime.dispose(); }
  assert.equal((await stat(join(f.root, 'file.txt'))).mode & 0o777, 0o644);
});

test('hard process termination after live writes leaves durable checkpoints recoverable by a new manager', async t => {
  const f = await fixture(t); const child = await f.prepare();
  await writeFile(join(child.workspaceRoot, 'file.txt'), 'persisted before hard kill');
  if (process.platform !== 'win32') await chmod(join(child.workspaceRoot, 'file.txt'), 0o664);
  const review = await child.review();
  const script = `
    import { createHash } from 'node:crypto';
    import { join } from 'node:path';
    import { DelegatedWorkspaceManager, WorkspaceToolRuntime } from ${JSON.stringify(new URL('../lib/index.js', import.meta.url).href)};
    const original = WorkspaceToolRuntime.prototype.applyReviewedChanges;
    WorkspaceToolRuntime.prototype.applyReviewedChanges = async function(changes, context) {
      await original.call(this, changes, context);
      process.kill(process.pid, 'SIGKILL');
      await new Promise(() => {});
    };
    const manager = new DelegatedWorkspaceManager({ storageRoot: ${JSON.stringify(f.options.storageRoot)}, checkpointRootForWorkspace: path => join(${JSON.stringify(f.home)}, 'checkpoints', createHash('sha256').update(path).digest('hex')) });
    await manager.merge(${JSON.stringify(review.childRunId)}, ${JSON.stringify(review.reviewId)});
  `;
  assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: fileURLToPath(new URL('../', import.meta.url)), timeout: 10_000, stdio: 'pipe' }));
  assert.equal(await readFile(join(f.root, 'file.txt'), 'utf8'), 'persisted before hard kill');
  const restarted = new DelegatedWorkspaceManager(f.options);
  assert.deepEqual((await restarted.review(review.childRunId)).interruptedMerge, { reviewId: review.reviewId });
  const result = await restarted.recoverInterruptedMerge(review.childRunId, review.reviewId);
  assert.equal(result.restoredCheckpointIds.length, 1);
  assert.equal(await readFile(join(f.root, 'file.txt'), 'utf8'), 'original\n');
  if (process.platform !== 'win32') assert.equal((await stat(join(f.root, 'file.txt'))).mode & 0o777, 0o644);
});

test('only one continuation can acquire a child and repeated review cannot reopen a merged result', async t => {
  const f = await fixture(t); const child = await f.prepare();
  await writeFile(join(child.workspaceRoot, 'file.txt'), 'reviewable');
  const review = await child.review();
  const outcomes = await Promise.allSettled([f.manager.setRunning(review.childRunId), f.manager.setRunning(review.childRunId)]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await f.manager.ownedWorkspace(review.childRunId, { conversationId: 'conversation-a' })).state, 'running');
  await assert.rejects(f.manager.merge(review.childRunId, review.reviewId), { code: 'CHILD_STILL_RUNNING' });
  await f.manager.setStopped(review.childRunId);
  await f.manager.merge(review.childRunId, review.reviewId);
  assert.equal((await child.review()).merged, true);
  await assert.rejects(f.manager.setRunning(review.childRunId), { code: 'CHILD_WORKSPACE_NOT_RESUMABLE' });
});


test('write-capable child isolates, reviews, merges and restores files larger than the former snapshot budget', async t => {
  const f = await fixture(t, true);
  const original = Buffer.alloc(5 * 1024 * 1024, 65);
  await writeFile(join(f.root, 'large.bin'), original);
  const child = await f.prepare();
  assert.deepEqual(await readFile(join(child.workspaceRoot, 'large.bin')), original);
  const replacement = Buffer.alloc(5 * 1024 * 1024, 66);
  await writeFile(join(child.workspaceRoot, 'large.bin'), replacement);
  const review = await child.review(); assert.equal(review.changes.length, 1);
  assert.equal(review.changes[0].truncated, true); assert.equal(review.changes[0].patch, '');
  const merged = await f.manager.merge(review.childRunId, review.reviewId);
  assert.deepEqual(await readFile(join(f.root, 'large.bin')), replacement);
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: f.root, checkpointRoot: f.checkpointRootForWorkspace(f.root), permissionMode: 'full_access' });
  try { await runtime.restoreCheckpointChain([...merged.checkpointIds].reverse()); }
  finally { await runtime.dispose(); }
  assert.deepEqual(await readFile(join(f.root, 'large.bin')), original);
});

test('non-Git snapshot skips source symlinks without failing prepare, cleans up review-* checkpoints, and orders multi-file merge checkpoints (D1-20, D1-21, D1-22)', async t => {
  const f = await fixture(t, false);
  await symlink(join(f.root, 'file.txt'), join(f.root, 'alias-link.txt'));
  const child = await f.prepare();
  await writeFile(join(child.workspaceRoot, 'file.txt'), 'updated-1\n');
  await writeFile(join(child.workspaceRoot, 'extra.txt'), 'created-2\n');
  const review = await child.review();
  assert.equal(review.changes.length, 2);

  const childCheckpointDir = f.checkpointRootForWorkspace(child.workspaceRoot);
  const childCheckpointEntries = await readdir(childCheckpointDir).catch(() => [] as string[]);
  assert.equal(childCheckpointEntries.some(name => name.startsWith('review-')), false, 'review-* directories are cleaned up after review()');

  const merged = await f.manager.merge(review.childRunId, review.reviewId);
  assert.equal(merged.checkpointIds.length, 2);
  const sortedIds = [...merged.checkpointIds].sort();
  assert.deepEqual(merged.checkpointIds, sortedIds, 'checkpoint IDs sort lexicographically in creation order');

  const runtime = await WorkspaceToolRuntime.create({
    workspaceRoot: f.root,
    checkpointRoot: f.checkpointRootForWorkspace(f.root),
    permissionMode: 'full_access',
  });
  try {
    const { versions } = await runtime.listFileVersions({ path: 'file.txt' });
    assert.equal(versions.some(v => v.checkpointId.startsWith('review-')), false);
  } finally {
    await runtime.dispose();
  }
});
