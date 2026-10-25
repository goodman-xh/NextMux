import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, open, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { AgentToolRegistry, WorkspaceToolRuntime, DelegatedWorkspaceManager } from '../lib/index.js';
import { captureWorkspaceSnapshot, loadCommandSnapshot, persistCommandSnapshot, readCommandSnapshotMetadata, snapshotPathExcluded } from '../lib/workspace-snapshot.js';

async function fixture(t: TestContext) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'nm-enumeration-')));
  const workspace = join(base, 'workspace'), store = join(base, 'store');
  await mkdir(workspace); await mkdir(store);
  t.after(() => rm(base, { recursive: true, force: true }));
  return { workspace, store };
}

async function sparse(path: string) {
  const handle = await open(path, 'wx');
  try { await handle.truncate(2 * 1024 * 1024 * 1024 + 1); } finally { await handle.close(); }
}

async function command(t: TestContext, f: Awaited<ReturnType<typeof fixture>>, code: string) {
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: f.workspace, checkpointRoot: f.store, permissionMode: 'full_access' });
  t.after(() => runtime.dispose());
  const registry = new AgentToolRegistry(); runtime.registerTools(registry);
  const result = await registry.execute({ id: 'command', name: 'process.run', arguments: {
    command: process.execPath, args: ['-e', code],
  } }, 'full_access', { runId: 'enumeration' });
  assert.equal(result.ok, true, JSON.stringify(result));
  return { runtime, result };
}

test('an unrelated oversized file does not suppress checkpoint and undo for a proven new small file', async t => {
  const f = await fixture(t); await sparse(join(f.workspace, 'oversized.bin'));
  const { runtime, result } = await command(t, f, "require('node:fs').writeFileSync('new-code.js','module.exports = 42;')");
  assert.equal(result.summary?.checkpointIds?.length, 1);
  assert.equal((result.output as { checkpointCoverage: { complete: boolean } }).checkpointCoverage.complete, false);
  const id = result.summary!.checkpointIds![0]!;
  const diff = await runtime.getCheckpointDiff(id);
  assert.equal(diff.path, 'new-code.js'); assert.equal(diff.kind, 'created');
  await runtime.restoreCheckpoint(id);
  await assert.rejects(stat(join(f.workspace, 'new-code.js')), { code: 'ENOENT' });
  assert.equal((await stat(join(f.workspace, 'oversized.bin'))).size, 2 * 1024 * 1024 * 1024 + 1);
});

test('shrinking an excluded existing file never fabricates a creation checkpoint', async t => {
  const f = await fixture(t); await sparse(join(f.workspace, 'was-large.txt'));
  const { result } = await command(t, f, "require('node:fs').writeFileSync('was-large.txt','small now')");
  assert.equal(result.summary?.checkpointIds?.length, 0);
  assert.equal(await readFile(join(f.workspace, 'was-large.txt'), 'utf8'), 'small now');
});

test('content limits can retain enumeration proof while entry traversal exhaustion cannot', async t => {
  const f = await fixture(t);
  await writeFile(join(f.workspace, 'a'), '12345678'); await writeFile(join(f.workspace, 'z'), 'old!');
  const content = await captureWorkspaceSnapshot(f.workspace, f.store, undefined, { maxBytes: 10, maxFiles: 1 });
  assert.equal(content.complete, false); assert.equal(content.enumerationComplete, true);
  assert.equal(snapshotPathExcluded(content, 'z'), true);
  await mkdir(join(f.workspace, 'third'));
  const traversal = await captureWorkspaceSnapshot(f.workspace, f.store, undefined, { maxFiles: 1 });
  assert.equal(traversal.enumerationComplete, false);
  assert.ok(traversal.warnings.includes('Directory entry budget reached'));
  assert.equal(snapshotPathExcluded(traversal, 'third/not-enumerated.txt'), true);
  assert.equal(snapshotPathExcluded(traversal, 'z'), true);
  assert.ok(traversal.excludedPaths.has('z'));
  assert.ok(traversal.excludedPaths.has('third/'));
});

test('partial delegated snapshots permit captured edits and report uncaptured paths without deleting source data', async t => {
  const f = await fixture(t);
  await writeFile(join(f.workspace, 'small.txt'), 'original');
  await sparse(join(f.workspace, 'oversized.bin'));
  const manager = new DelegatedWorkspaceManager({ storageRoot: join(f.store, 'children'),
    checkpointRootForWorkspace: root => join(f.store, root === f.workspace ? 'parent-checkpoints' : 'child-checkpoints') });
  const childRunId = `child-${randomUUID()}`;
  const child = await manager.prepare({ childRunId, parentRunId: 'partial-snapshot-parent', workspaceRoot: f.workspace, permissionMode: 'workspace_write' });
  t.after(() => child.dispose());
  assert.match(child.snapshotWarning!, /Partial workspace snapshot/);
  assert.equal(await readFile(join(child.workspaceRoot, 'small.txt'), 'utf8'), 'original');
  await assert.rejects(stat(join(child.workspaceRoot, 'oversized.bin')), { code: 'ENOENT' });
  await writeFile(join(child.workspaceRoot, 'small.txt'), 'reviewed edit');
  await writeFile(join(child.workspaceRoot, 'oversized.bin'), 'must not overwrite uncaptured original');
  const review = await child.review();
  assert.equal(review.checkpointCoverage?.complete, false);
  assert.ok(review.excludedPaths.includes('oversized.bin'));
  assert.deepEqual(review.changes.map(change => change.path), ['small.txt']);
  await manager.merge(childRunId, review.reviewId);
  assert.equal(await readFile(join(f.workspace, 'small.txt'), 'utf8'), 'reviewed edit');
  assert.equal((await stat(join(f.workspace, 'oversized.bin'))).size, 2 * 1024 * 1024 * 1024 + 1);
});

test('persist and load preserve explicit false and legacy complete semantics', async t => {
  const f = await fixture(t); await writeFile(join(f.workspace, 'a'), 'a');
  const snapshot = await captureWorkspaceSnapshot(f.workspace, f.store);
  for (const complete of [true, false]) {
    const { enumerationComplete: _proof, ...legacy } = snapshot;
    await persistCommandSnapshot(f.store, { ...legacy, complete }, { workspaceRoot: f.workspace, runId: 'metadata', generation: randomUUID() });
    assert.equal((await loadCommandSnapshot(f.store, f.workspace)).snapshot.enumerationComplete, complete);
  }
  await persistCommandSnapshot(f.store, { ...snapshot, complete: true, enumerationComplete: false }, {
    workspaceRoot: f.workspace, runId: 'metadata', generation: randomUUID(),
  });
  assert.equal((await loadCommandSnapshot(f.store, f.workspace)).snapshot.enumerationComplete, false);
  const path = join(f.store, 'snapshot.json'), record = JSON.parse(await readFile(path, 'utf8'));
  record.enumerationComplete = 'true'; await writeFile(path, JSON.stringify(record));
  await assert.rejects(readCommandSnapshotMetadata(f.store, f.workspace), /Invalid command recovery snapshot/);
});

for (const input of [
  { label: 'legacy complete', complete: true, proof: undefined, expected: 1 },
  { label: 'legacy partial', complete: false, proof: undefined, expected: 0 },
  { label: 'explicit incomplete enumeration', complete: true, proof: false, expected: 0 },
] as const) test(`${input.label} keeps its creation attribution during actual interrupted-command recovery`, async t => {
  const f = await fixture(t), pending = join(f.store, '.pending-commands', randomUUID());
  await mkdir(pending, { recursive: true }); await writeFile(join(f.workspace, 'original.txt'), 'original');
  const snapshot = await captureWorkspaceSnapshot(f.workspace, f.store);
  await persistCommandSnapshot(pending, snapshot, { workspaceRoot: f.workspace, runId: 'legacy', generation: randomUUID() });
  const path = join(pending, 'snapshot.json'), record = JSON.parse(await readFile(path, 'utf8'));
  if (input.proof === undefined) delete record.enumerationComplete;
  else record.enumerationComplete = input.proof;
  record.complete = input.complete; record.ownerPid = 2_147_483_647;
  assert.throws(() => process.kill(record.ownerPid, 0), { code: 'ESRCH' }, 'fixture owner must not be alive');
  await writeFile(path, JSON.stringify(record)); await writeFile(join(f.workspace, 'created-after.txt'), 'later');
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: f.workspace, checkpointRoot: f.store, permissionMode: 'full_access' });
  try {
    const ids = runtime.getCreatedCheckpointIds(); assert.equal(ids.length, input.expected);
    if (input.expected) {
      assert.equal((await runtime.getCheckpointDiff(ids[0]!)).kind, 'created');
      await runtime.restoreCheckpoint(ids[0]!);
      await assert.rejects(stat(join(f.workspace, 'created-after.txt')), { code: 'ENOENT' });
    } else assert.equal(await readFile(join(f.workspace, 'created-after.txt'), 'utf8'), 'later');
    assert.equal(await readFile(join(f.workspace, 'original.txt'), 'utf8'), 'original');
  } finally { await runtime.dispose(); }
});
