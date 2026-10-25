import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentToolRegistry, WorkspaceToolRuntime } from '../lib/index.js';

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'nm-restore-preview-'));
  await mkdir(join(directory, 'workspace'));
  const root = await realpath(join(directory, 'workspace')), store = join(directory, 'checkpoints');
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: root, checkpointRoot: store, permissionMode: 'full_access' });
  const registry = new AgentToolRegistry(); runtime.registerTools(registry);
  const hash = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');
  const write = async (path: string, content: string) => {
    const existing = await readFile(join(root, path)).catch(error => { if (error.code !== 'ENOENT') throw error; return undefined; });
    const result = await registry.execute({ id: randomUUID(), name: 'workspace.write_file',
      arguments: { path, content, expectedSha256: existing ? hash(existing) : null } }, 'full_access', { runId: randomUUID() });
    assert.equal(result.ok, true, JSON.stringify(result.error)); return result.summary.checkpointId!;
  };
  t.after(async () => { await runtime.dispose(); await rm(directory, { recursive: true, force: true }); });
  return { directory, root, store, runtime, hash, write };
}

test('restore preview compares the final live file to its chosen version after timeline back and forth', async t => {
  const f = await fixture(t), path = join(f.root, 'baseline.txt');
  await writeFile(path, 'before\n');
  const id = await f.write('baseline.txt', 'after-one\nafter-two\n');
  const conversationId = randomUUID(), ids = [id];
  for (const side of ['before', 'after'] as const) {
    const result = await f.runtime.restoreFileVersion({ checkpointId: id, side,
      expectedSha256: (await f.runtime.getFileState({ checkpointId: id })).sha256, conversationId });
    ids.push(result.checkpointId);
  }
  const history = await f.runtime.getCheckpointDiff(id, true);
  assert.equal(history.additions, 2); assert.equal(history.deletions, 1);
  const preview = await f.runtime.getCheckpointDiff(id, true, 'before');
  assert.equal(preview.beforeContent, 'after-one\nafter-two\n');
  assert.equal(preview.afterContent, 'before\n');
  assert.equal(preview.additions, 1); assert.equal(preview.deletions, 2);
  assert.equal(preview.unchanged, false);
  assert.equal(await readFile(path, 'utf8'), preview.beforeContent, 'preview is read-only');
  await WorkspaceToolRuntime.restoreCheckpointGroups([{ runtime: f.runtime, checkpointIds: ids,
    targets: [{ checkpointId: id, side: 'before' }] }], { conversationId, recordVersions: true });
  assert.equal(await readFile(path, 'utf8'), preview.afterContent);
  assert.equal((await f.runtime.getCheckpointDiff(id, false, 'before')).unchanged, true);
});

test('after-side prompt baselines use current bytes rather than reversing the historical diff', async t => {
  const f = await fixture(t), path = join(f.root, 'same.txt');
  await writeFile(path, 'old\n');
  const baseline = await f.write('same.txt', 'prompt-start\n');
  await f.write('same.txt', 'latest\nsecond line\nthird line\n');
  const preview = await f.runtime.getCheckpointDiff(baseline, true, 'after');
  assert.equal(preview.additions, 1); assert.equal(preview.deletions, 3);
  assert.equal(preview.afterContent, 'prompt-start\n');
  assert.equal(preview.beforeContent, 'latest\nsecond line\nthird line\n');
});

test('created, deleted and binary restore targets retain actual direction and unchanged state', async t => {
  const f = await fixture(t);
  const created = await f.write('new.txt', 'new\n');
  assert.equal((await f.runtime.getCheckpointDiff(created, false, 'before')).kind, 'deleted');
  await rm(join(f.root, 'new.txt'));
  assert.equal((await f.runtime.getCheckpointDiff(created, false, 'before')).unchanged, true);
  assert.equal((await f.runtime.getCheckpointDiff(created, false, 'after')).kind, 'created');
  const before = Buffer.from([0, 1, 2]), after = Buffer.from([0, 3, 4]);
  await writeFile(join(f.root, 'binary.bin'), before);
  const [binary] = await f.runtime.applyReviewedChanges([{ path: 'binary.bin', beforeSha256: f.hash(before), content: after }],
    { runId: randomUUID() });
  const preview = await f.runtime.getCheckpointDiff(binary, false, 'before');
  assert.equal(preview.binary, true); assert.equal(preview.unchanged, false);
  assert.deepEqual(await readFile(join(f.root, 'binary.bin')), after);
});

test('large file previews stay bounded without inventing line counts or preventing restoration', async t => {
  const f = await fixture(t), before = Buffer.alloc(700_000, 65), after = Buffer.alloc(700_000, 66);
  await writeFile(join(f.root, 'large.txt'), before);
  const [id] = await f.runtime.applyReviewedChanges([{ path: 'large.txt', beforeSha256: f.hash(before), content: after }],
    { runId: randomUUID() });
  const preview = await f.runtime.getCheckpointDiff(id, false, 'before');
  assert.equal(preview.truncated, true); assert.equal(preview.unchanged, false);
  assert.equal(preview.beforeContent, undefined); assert.equal(preview.patch, '');
  await f.runtime.restoreCheckpoint(id);
  assert.deepEqual(await readFile(join(f.root, 'large.txt')), before);
});

test('restore previews reject corrupt objects and replaced symlinks without writing live files', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'a.txt'), 'before');
  const id = await f.write('a.txt', 'after');
  await writeFile(join(f.store, id, 'before.bin'), 'corrupt');
  await assert.rejects(f.runtime.getCheckpointDiff(id, false, 'before'), { code: 'INVALID_CHECKPOINT' });
  assert.equal(await readFile(join(f.root, 'a.txt'), 'utf8'), 'after');
  await rm(join(f.root, 'a.txt'));
  const outside = join(f.directory, 'outside.txt'); await writeFile(outside, 'private');
  await symlink(outside, join(f.root, 'a.txt'));
  await assert.rejects(f.runtime.getCheckpointDiff(id, false, 'after'));
  assert.equal(await readFile(outside, 'utf8'), 'private');
});
