import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, mkdir, realpath, readFile, writeFile, rm, readdir, open, stat, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { AgentToolRegistry, WorkspaceToolRuntime } from '../lib/index.js';
import { runCheckpointRestoreTransactions } from '../lib/checkpoint-transaction.js';
import { inspectSnapshotFile, writeSnapshotFile } from '../lib/workspace-snapshot.js';

async function fixture(t: TestContext) {
  const base = await mkdtemp(join(tmpdir(), 'nm-restore-transaction-'));
  const root = join(base, 'workspace');
  const checkpoints = join(base, 'checkpoints');
  await mkdir(root);
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: root, checkpointRoot: checkpoints, permissionMode: 'full_access' });
  const registry = new AgentToolRegistry(); runtime.registerTools(registry);
  let calls = 0;
  const write = async (path: string, content: string) => {
    const file = join(root, path);
    let hash: string | null = null;
    try { hash = createHash('sha256').update(await readFile(file)).digest('hex'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const result = await registry.execute({ id: `write-${++calls}`, name: 'workspace.write_file', arguments: { path, content, expectedSha256: hash } }, 'full_access', { runId: 'restore-transaction' });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    return result.summary.checkpointId!;
  };
  t.after(async () => { await runtime.dispose(); await rm(base, { recursive: true, force: true }); });
  return { root: await realpath(root), checkpoints, runtime, write };
}

test('multi-root restore prepares every root before mutating any file', async t => {
  const a = await fixture(t), b = await fixture(t);
  await writeFile(join(a.root, 'a.txt'), 'a before');
  await writeFile(join(b.root, 'b.txt'), 'b before');
  const ca = await a.write('a.txt', 'a after'), cb = await b.write('b.txt', 'b after');
  await writeFile(join(b.root, 'b.txt'), 'external edit');
  await assert.rejects(WorkspaceToolRuntime.restoreCheckpointGroups([
    { runtime: a.runtime, checkpointIds: [ca] }, { runtime: b.runtime, checkpointIds: [cb] },
  ]), { code: 'ROLLBACK_CONFLICT' });
  assert.equal(await readFile(join(a.root, 'a.txt'), 'utf8'), 'a after');
  assert.equal(await readFile(join(b.root, 'b.txt'), 'utf8'), 'external edit');
  assert.equal((await readdir(a.checkpoints)).filter(name => name.startsWith('.restore-')).length, 0);
});

test('a later root I/O failure compensates an already restored root using exact disk originals', async t => {
  const a = await fixture(t), b = await fixture(t);
  const large = await open(join(a.root, 'a.bin'), 'w');
  const chunk = Buffer.alloc(256 * 1024, 72);
  try { for (let index = 0; index < 48; index++) await large.writeFile(chunk); } finally { await large.close(); }
  const oldA = await inspectSnapshotFile(join(a.root, 'a.bin'), { memory: false });
  // Use an explicitly reviewed binary change to create a real checkpoint.
  const context = { runId: 'binary-restore' };
  const [ca] = await a.runtime.applyReviewedChanges([{ path: 'a.bin', beforeSha256: oldA.sha256, content: Buffer.alloc(6 * 1024 * 1024, 24) }], context);
  const originalA = await inspectSnapshotFile(join(a.root, 'a.bin'), { memory: false });
  await writeFile(join(b.root, 'b.txt'), 'b before'); const cb = await b.write('b.txt', 'b after');
  await assert.rejects(runCheckpointRestoreTransactions([
    () => a.runtime.prepareCheckpointRestore([ca]),
    async () => {
      const prepared = await b.runtime.prepareCheckpointRestore([cb]);
      return { ...prepared, apply: async () => {
        // Simulates a disk object corrupted after all preflight checks.
        await writeFile(join(b.checkpoints, cb, 'before.bin'), 'corrupted disk object');
        return prepared.apply();
      } };
    },
  ]), /Invalid snapshot object content/);
  assert.equal((await inspectSnapshotFile(join(a.root, 'a.bin'), { memory: false })).sha256, originalA.sha256);
  assert.equal(await readFile(join(b.root, 'b.txt'), 'utf8'), 'b after');
  assert.equal((await readdir(a.checkpoints)).filter(name => name.startsWith('.restore-')).length, 0);
});

test('compensation never overwrites an outside edit and retains its durable recovery evidence', async t => {
  const a = await fixture(t), b = await fixture(t);
  await writeFile(join(a.root, 'a.txt'), 'a before');
  const ca = await a.write('a.txt', 'a after');
  let directory = '';
  await assert.rejects(runCheckpointRestoreTransactions([
    async () => { const prepared = await a.runtime.prepareCheckpointRestore([ca]); directory = prepared.recoveryDirectory; return prepared; },
    async () => {
      const prepared = await b.runtime.prepareCheckpointRestore([]);
      return { ...prepared, apply: async () => {
        await writeFile(join(a.root, 'a.txt'), 'outside edit during restore');
        throw new Error('other workspace failed');
      } };
    },
  ]), { code: 'ROLLBACK_PARTIAL' });
  assert.equal(await readFile(join(a.root, 'a.txt'), 'utf8'), 'outside edit during restore');
  const metadata = JSON.parse(await readFile(join(directory, 'recovery.json'), 'utf8'));
  assert.equal(metadata.phase, 'review');
  assert.equal(metadata.files[0].attempted, true);
  assert.equal(await readFile(join(directory, `${metadata.files[0].sha256}.bin`), 'utf8'), 'a after');
});

test('a timeline force restore uses the same prepared transaction and preserves original permissions', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'script.sh'), '#!/bin/sh\necho before\n');
  await chmod(join(f.root, 'script.sh'), 0o755);
  const id = await f.write('script.sh', '#!/bin/sh\necho after\n');
  await writeFile(join(f.root, 'script.sh'), 'outside edit');
  await assert.rejects(f.runtime.restoreCheckpoint(id), { code: 'ROLLBACK_CONFLICT' });
  await f.runtime.restoreCheckpoint(id, true);
  assert.equal(await readFile(join(f.root, 'script.sh'), 'utf8'), '#!/bin/sh\necho before\n');
  if (process.platform !== 'win32') assert.equal((await stat(join(f.root, 'script.sh'))).mode & 0o777, 0o755);
  assert.equal((await readdir(f.checkpoints)).filter(name => name.startsWith('.restore-')).length, 0);
});

test('multi-root successful chain retains all summaries, removes created files, and does not touch git metadata', async t => {
  const a = await fixture(t), b = await fixture(t);
  await mkdir(join(a.root, '.git')); await writeFile(join(a.root, '.git', 'index'), 'user git index sentinel');
  await writeFile(join(a.root, 'a.txt'), 'zero');
  const c1 = await a.write('a.txt', 'one'), c2 = await a.write('a.txt', 'two');
  const c3 = await b.write('new.txt', 'new');
  const summaries = await WorkspaceToolRuntime.restoreCheckpointGroups([
    { runtime: a.runtime, checkpointIds: [c2, c1] }, { runtime: b.runtime, checkpointIds: [c3] },
  ]);
  assert.deepEqual(summaries.map(item => item.checkpointId), [c2, c1, c3]);
  assert.equal(await readFile(join(a.root, 'a.txt'), 'utf8'), 'zero');
  await assert.rejects(readFile(join(b.root, 'new.txt')), { code: 'ENOENT' });
  assert.equal(await readFile(join(a.root, '.git', 'index'), 'utf8'), 'user git index sentinel');
});

test('duplicate cross-root target plans abort before applying either group', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'file.txt'), 'before'); const id = await f.write('file.txt', 'after');
  await assert.rejects(WorkspaceToolRuntime.restoreCheckpointGroups([
    { runtime: f.runtime, checkpointIds: [id] }, { runtime: f.runtime, checkpointIds: [id] },
  ]), /overlap/);
  assert.equal(await readFile(join(f.root, 'file.txt'), 'utf8'), 'after');
});

test('snapshot before-commit conflict discards copied bytes and never replaces the live file', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'original.bin'), Buffer.alloc(8 * 1024 * 1024, 17));
  const snapshot = await inspectSnapshotFile(join(f.root, 'original.bin'), { memory: false });
  await writeFile(join(f.root, 'target.bin'), 'live');
  await assert.rejects(writeSnapshotFile(snapshot, join(f.root, 'target.bin'), 0o600, { beforeCommit: async () => {
    await writeFile(join(f.root, 'target.bin'), 'new outside edit');
    throw new Error('conflict');
  } }), /conflict/);
  assert.equal(await readFile(join(f.root, 'target.bin'), 'utf8'), 'new outside edit');
  assert.equal((await readdir(f.root)).filter(name => name.endsWith('.snapshot.tmp')).length, 0);
});

test('preparing a deleted nested file does not recreate directories before the group commits', async t => {
  const f = await fixture(t);
  await mkdir(join(f.root, 'nested'));
  await writeFile(join(f.root, 'nested', 'file.txt'), 'original nested');
  const hash = createHash('sha256').update('original nested').digest('hex');
  const [id] = await f.runtime.applyReviewedChanges([{ path: 'nested/file.txt', beforeSha256: hash, content: null }], { runId: 'nested-prepare' });
  await rm(join(f.root, 'nested'), { recursive: true });
  const transaction = await f.runtime.prepareCheckpointRestore([id]);
  await assert.rejects(stat(join(f.root, 'nested')), { code: 'ENOENT' });
  await transaction.apply();
  assert.equal(await readFile(join(f.root, 'nested', 'file.txt'), 'utf8'), 'original nested');
  await transaction.finalize();
});

test('same physical file changed through two workspace owners is restored once in hash-chain order', async t => {
  const a = await fixture(t), b = await fixture(t);
  const target = join(b.root, 'shared.txt'); await writeFile(target, 'zero');
  const registry = new AgentToolRegistry(); a.runtime.registerTools(registry);
  const first = await registry.execute({ id: 'cross-owner-external', name: 'workspace.write_file', arguments: {
    path: target, content: 'one', expectedSha256: createHash('sha256').update('zero').digest('hex')
  } }, 'full_access', { runId: 'cross-owner-restore' });
  assert.equal(first.ok, true); const ca = first.summary.checkpointId!;
  const cb = await b.write('shared.txt', 'two');
  const restored = await WorkspaceToolRuntime.restoreCheckpointGroups([
    { runtime: a.runtime, checkpointIds: [ca] }, { runtime: b.runtime, checkpointIds: [cb] },
  ]);
  assert.deepEqual(restored.map(item => item.checkpointId), [cb, ca]);
  assert.equal(await readFile(target, 'utf8'), 'zero');
});

test('timeline restore creates an undoable version and joins the same message rollback chain', async t => {
  const f = await fixture(t); await writeFile(join(f.root, 'a.txt'), 'zero');
  const one = await f.write('a.txt', 'one'), two = await f.write('a.txt', 'two');
  const restored = await f.runtime.restoreFileVersion({ checkpointId: one, side: 'before',
    expectedSha256: createHash('sha256').update('two').digest('hex'), conversationId: '10000000-0000-0000-0000-000000000001', turnId: 'turn-three' });
  assert.equal(await readFile(join(f.root, 'a.txt'), 'utf8'), 'zero');
  const metadata = JSON.parse(await readFile(join(f.checkpoints, restored.checkpointId, 'manifest.json'), 'utf8'));
  assert.equal(metadata.operation, 'timeline_restore'); assert.equal(metadata.turnId, 'turn-three');
  await f.runtime.restoreCheckpointChain([restored.checkpointId, two, one]);
  assert.equal(await readFile(join(f.root, 'a.txt'), 'utf8'), 'zero');
  await writeFile(join(f.root, 'a.txt'), 'external edit');
  await assert.rejects(f.runtime.restoreFileVersion({ checkpointId: one, side: 'after',
    expectedSha256: createHash('sha256').update('zero').digest('hex'), conversationId: '10000000-0000-0000-0000-000000000001' }), { code: 'ROLLBACK_CONFLICT' });
  assert.equal(await readFile(join(f.root, 'a.txt'), 'utf8'), 'external edit');
});

test('an explicit binary file version above 256 MiB restores with disk objects, not a full-size buffer', async t => {
  const f = await fixture(t), target = join(f.root, 'large.bin');
  const large = await open(target, 'w'); const size = 257 * 1024 * 1024;
  await large.truncate(size); await large.write(Buffer.from('tail'), 0, 4, size - 4); await large.close();
  const original = await inspectSnapshotFile(target, { memory: false });
  const [checkpointId] = await f.runtime.applyReviewedChanges([{ path: 'large.bin', beforeSha256: original.sha256, content: Buffer.from('small') }], { runId: 'large-history' });
  await f.runtime.restoreCheckpoint(checkpointId);
  assert.equal((await inspectSnapshotFile(target, { memory: false })).sha256, original.sha256);
  assert.equal((await stat(target)).size, size);
});


test('manual editor saves record an undoable version and refuse stale disk state', async t => {
  const f = await fixture(t), target = join(f.root, 'manual.txt');
  await writeFile(target, 'zero');
  const state = await f.runtime.getFileState({ path: 'manual.txt' });
  assert.equal(state.exists, true); assert.equal(state.size, 4);
  const saved = await f.runtime.saveFileVersion({ path: target, content: 'manual edit', expectedSha256: state.sha256,
    conversationId: '10000000-0000-0000-0000-000000000001', turnId: 'manual-turn' });
  assert.equal(await readFile(target, 'utf8'), 'manual edit');
  assert.equal((await f.runtime.getFileState({ checkpointId: saved.checkpointId })).sha256, saved.sha256);
  const manifest = JSON.parse(await readFile(join(f.checkpoints, saved.checkpointId, 'manifest.json'), 'utf8'));
  assert.equal(manifest.operation, 'editor_save'); assert.equal(manifest.turnId, 'manual-turn');
  await f.runtime.restoreCheckpointChain([saved.checkpointId]);
  assert.equal(await readFile(target, 'utf8'), 'zero');
  await writeFile(target, 'external edit');
  await assert.rejects(f.runtime.saveFileVersion({ path: target, content: 'must not replace', expectedSha256: state.sha256,
    conversationId: '10000000-0000-0000-0000-000000000001' }), { code: 'ROLLBACK_CONFLICT' });
  assert.equal(await readFile(target, 'utf8'), 'external edit');
  await assert.rejects(f.runtime.saveFileVersion({ path: '../outside.txt', content: 'no', expectedSha256: null,
    conversationId: '10000000-0000-0000-0000-000000000001' }));
});


test('POSIX literal backslash file identity survives read, editor save, history and restore', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t), literal = join(f.root, 'a\\b.txt'), nested = join(f.root, 'a', 'b.txt');
  const conversationId = '10000000-0000-0000-0000-000000000001';
  await mkdir(join(f.root, 'a')); await writeFile(literal, 'literal before'); await writeFile(nested, 'nested before');
  const initial = await f.runtime.getFileState({ path: 'a\\b.txt' });
  assert.equal(initial.path, literal);
  const saved = await f.runtime.saveFileVersion({ path: 'a\\b.txt', content: 'literal after', expectedSha256: initial.sha256, conversationId });
  assert.equal(await readFile(literal, 'utf8'), 'literal after');
  assert.equal(await readFile(nested, 'utf8'), 'nested before');
  assert.equal((await f.runtime.getFileState({ checkpointId: saved.checkpointId })).path, literal);
  assert.equal(JSON.parse(await readFile(join(f.checkpoints, saved.checkpointId, 'manifest.json'), 'utf8')).relativePath, 'a\\b.txt');
  const registry = new AgentToolRegistry(); f.runtime.registerTools(registry);
  const read = await registry.execute({ id: 'literal-read', name: 'workspace.read_file', arguments: { path: 'a\\b.txt' } }, 'full_access', { runId: 'literal-read-run' });
  assert.equal(read.ok, true); assert.equal((read.output as { content: string }).content, 'literal after');
  assert.equal(read.summary.resource?.kind === 'file' && read.summary.resource.path, literal);
  assert.equal((await f.runtime.listFileVersions({ path: 'a\\b.txt' })).versions.some(version => version.checkpointId === saved.checkpointId), true);
  await f.runtime.restoreCheckpoint(saved.checkpointId);
  assert.equal(await readFile(literal, 'utf8'), 'literal before');
  await f.runtime.restoreFileVersion({ checkpointId: saved.checkpointId, side: 'after', expectedSha256: initial.sha256, conversationId });
  assert.equal(await readFile(literal, 'utf8'), 'literal after');
  const nestedCheckpoint = await f.write('a/b.txt', 'nested after');
  await f.runtime.restoreCheckpoint(nestedCheckpoint);
  assert.equal(await readFile(nested, 'utf8'), 'nested before');
  assert.equal(await readFile(literal, 'utf8'), 'literal after');
});

test('exact file path parsing retains traversal, foreign-root and internal-path guards', async t => {
  const f = await fixture(t), conversationId = '10000000-0000-0000-0000-000000000001';
  for (const path of ['../outside.txt', 'a/../../outside.txt', 'C:\\outside.txt', 'C:outside.txt', '\\\\server\\share\\outside.txt', '.nextmux/state.json',
    ...(process.platform === 'win32' ? ['..\\outside.txt', 'a\\..\\..\\outside.txt', '.nextmux\\state.json'] : [])]) {
    await assert.rejects(f.runtime.getFileState({ path }), error => ['PATH_OUTSIDE_WORKSPACE', 'INTERNAL_PATH'].includes((error as { code: string }).code), path);
    await assert.rejects(f.runtime.saveFileVersion({ path, content: 'must not write', expectedSha256: null, conversationId }),
      error => ['PATH_OUTSIDE_WORKSPACE', 'INTERNAL_PATH'].includes((error as { code: string }).code), path);
  }
  assert.deepEqual(await readdir(f.root), []);
});

test('POSIX patches preserve exact backslash identities and existing fallback header checks', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t), literal = join(f.root, 'a\\b.txt'), nested = join(f.root, 'a', 'b.txt');
  await mkdir(join(f.root, 'a')); await writeFile(literal, 'before\n'); await writeFile(nested, 'before\n');
  const registry = new AgentToolRegistry(); f.runtime.registerTools(registry);
  let calls = 0;
  const apply = async (path: string, patch: string) => registry.execute({ id: `identity-patch-${++calls}`, name: 'workspace.apply_patch',
    arguments: { path, patch, expectedSha256: (await f.runtime.getFileState({ path })).sha256 } }, 'full_access', { runId: `identity-patch-run-${calls}` });
  const unified = (name: string) => `--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-before\n+after\n`;
  const envelope = (name: string) => `*** Begin Patch\n*** Update File: ${name}\n@@ -1,99 +1,88 @@\n-before\n+after\n*** End Patch`;
  assert.equal((await apply('a/b.txt', envelope('a\\b.txt'))).error?.code, 'PATCH_INVALID');
  for (const patch of [unified('a\\b.txt'), envelope('a\\b.txt')]) {
    assert.equal(await readFile(nested, 'utf8'), 'before\n');
    const applied = await apply('a\\b.txt', patch);
    assert.equal(applied.ok, true, JSON.stringify(applied.error));
    assert.equal(await readFile(literal, 'utf8'), 'after\n');
    assert.equal(await readFile(nested, 'utf8'), 'before\n');
    await f.runtime.restoreCheckpoint(applied.summary.checkpointId!);
  }
  const quoted = envelope('"a\\\\b.txt"');
  assert.equal((await apply('a\\b.txt', quoted)).error?.code, 'PATCH_INVALID');
  assert.equal(await readFile(literal, 'utf8'), 'before\n');
  assert.equal(await readFile(nested, 'utf8'), 'before\n');
});

test('Windows relative backslash and slash paths keep one manifest target', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t), target = join(f.root, 'a', 'b.txt');
  await mkdir(join(f.root, 'a')); await writeFile(target, 'before');
  const before = await f.runtime.getFileState({ path: 'a\\b.txt' });
  assert.equal(before.path, target);
  const saved = await f.runtime.saveFileVersion({ path: 'a/b.txt', content: 'after', expectedSha256: before.sha256,
    conversationId: '10000000-0000-0000-0000-000000000001' });
  assert.equal((await f.runtime.getFileState({ path: 'a\\b.txt' })).sha256, saved.sha256);
  assert.equal((await f.runtime.getFileState({ checkpointId: saved.checkpointId })).path, target);
  await f.runtime.restoreCheckpoint(saved.checkpointId);
  assert.equal(await readFile(target, 'utf8'), 'before');
});

test('timeline and message restore switch between committed versions without accepting unknown external edits', async t => {
  const f = await fixture(t), target = join(f.root, 'story.txt');
  await writeFile(target, 'v0');
  const c1 = await f.write('story.txt', 'v1'), c2 = await f.write('story.txt', 'v2'), c3 = await f.write('story.txt', 'v3');
  const conversationId = '10000000-0000-0000-0000-000000000001';
  await f.runtime.restoreFileVersion({ checkpointId: c1, side: 'after', expectedSha256: (await f.runtime.getFileState({path:'story.txt'})).sha256, conversationId });
  assert.equal(await readFile(target, 'utf8'), 'v1');
  await WorkspaceToolRuntime.restoreCheckpointGroups([{runtime:f.runtime,checkpointIds:[c3]}], {recordVersions:true});
  assert.equal(await readFile(target, 'utf8'), 'v2');
  const versions = await f.runtime.listFileVersions({path:'story.txt',limit:2});
  assert.equal(versions.versions.some(item => item.operation === 'message_restore'), true);
  assert.ok(versions.nextCursor);
  const older = await f.runtime.listFileVersions({path:'story.txt',cursor:versions.nextCursor,limit:500});
  assert.equal(older.versions.some(item => item.checkpointId === c2), true);
  await f.runtime.restoreFileVersion({checkpointId:c1,side:'before',expectedSha256:(await f.runtime.getFileState({path:'story.txt'})).sha256,conversationId});
  assert.equal(await readFile(target,'utf8'),'v0');
  await writeFile(target,'unknown external edit');
  await assert.rejects(WorkspaceToolRuntime.restoreCheckpointGroups([{runtime:f.runtime,checkpointIds:[c3]}],{recordVersions:true}), {code:'ROLLBACK_CONFLICT'});
  assert.equal(await readFile(target,'utf8'),'unknown external edit');
});

test('editor versions preserve BOM, UTF16 byte order and CRLF while rejecting unknown encodings', async t => {
  const f = await fixture(t), conversationId = '10000000-0000-0000-0000-000000000001';
  for (const encoding of ['utf8bom','utf16le','utf16be']) {
    const target = join(f.root, encoding+'.txt');
    const oldText = 'first\r\nsecond\r\n', newText = 'edited\nsecond\n';
    const bom = encoding === 'utf8bom' ? Buffer.from([0xef,0xbb,0xbf]) : encoding === 'utf16le' ? Buffer.from([0xff,0xfe]) : Buffer.from([0xfe,0xff]);
    const body = Buffer.from(oldText, encoding === 'utf8bom' ? 'utf8' : 'utf16le');
    if (encoding === 'utf16be') body.swap16();
    await writeFile(target,Buffer.concat([bom,body]));
    const state = await f.runtime.getFileState({path:target});
    await f.runtime.saveFileVersion({path:target,content:newText,expectedSha256:state.sha256,conversationId});
    const expected = Buffer.from('edited\r\nsecond\r\n', encoding === 'utf8bom' ? 'utf8' : 'utf16le');
    if (encoding === 'utf16be') expected.swap16();
    assert.deepEqual(await readFile(target),Buffer.concat([bom,expected]));
  }
  const target = join(f.root,'invalid.txt'); await writeFile(target,Buffer.from([0xff,0x01,0x02]));
  await assert.rejects(f.runtime.saveFileVersion({path:target,content:'no',expectedSha256:(await f.runtime.getFileState({path:target})).sha256,conversationId}),{code:'EDITOR_ENCODING_UNSUPPORTED'});
  assert.deepEqual(await readFile(target),Buffer.from([0xff,0x01,0x02]));
});

test('replacement prompt targets its immutable starting version across timeline backwards and forwards', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'a.txt'), 'a0');
  const first = await f.write('a.txt', 'a1');
  const second = await f.write('a.txt', 'a2');
  const restored = await WorkspaceToolRuntime.restoreCheckpointGroups([{ runtime: f.runtime, checkpointIds: [second],
    targets: [{ checkpointId: second, side: 'before' }] }], { recordVersions: true, conversationId: 'conversation', turnId: 'replacement' });
  const baseline = (restored[0] as any).restoration.checkpointId;
  assert.equal(await readFile(join(f.root, 'a.txt'), 'utf8'), 'a1');
  const edited = await f.write('a.txt', 'a3');
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const earlier = await f.runtime.restoreFileVersion({ checkpointId: first, side: 'before', expectedSha256: hash('a3'), conversationId: '10000000-0000-4000-8000-000000000001' });
  assert.equal(await readFile(join(f.root, 'a.txt'), 'utf8'), 'a0');
  await WorkspaceToolRuntime.restoreCheckpointGroups([{ runtime: f.runtime, checkpointIds: [earlier.checkpointId, edited, baseline],
    targets: [{ checkpointId: baseline, side: 'after' }] }], { recordVersions: true });
  assert.equal(await readFile(join(f.root, 'a.txt'), 'utf8'), 'a1', 'second message edit restores the prompt baseline, never restoration.before=a2');
  await f.runtime.restoreFileVersion({ checkpointId: edited, side: 'after', expectedSha256: hash('a1'), conversationId: '10000000-0000-4000-8000-000000000001' });
  assert.equal(await readFile(join(f.root, 'a.txt'), 'utf8'), 'a3');
  const metadata = JSON.parse(await readFile(join(f.checkpoints, baseline, 'manifest.json'), 'utf8'));
  assert.equal(metadata.conversationId, 'conversation'); assert.equal(metadata.turnId, 'replacement');
  assert.equal(await readFile(join(f.checkpoints, baseline, 'before.bin'), 'utf8'), 'a2', 'target selection must not mutate immutable audit objects');
  assert.equal(await readFile(join(f.checkpoints, baseline, 'after.bin'), 'utf8'), 'a1');
});

test('direct multi-root version restore validates corruption and external edits before writing any target', async t => {
  const a = await fixture(t), b = await fixture(t);
  await writeFile(join(a.root, 'same.txt'), 'a0'); await writeFile(join(b.root, 'same.txt'), 'b0');
  const ca = await a.write('same.txt', 'a1'), cb = await b.write('same.txt', 'b1');
  const groups = [{ runtime: a.runtime, checkpointIds: [ca], targets: [{ checkpointId: ca, side: 'before' as const }] },
    { runtime: b.runtime, checkpointIds: [cb], targets: [{ checkpointId: cb, side: 'before' as const }] }];
  await writeFile(join(b.checkpoints, cb, 'before.bin'), 'corrupt');
  await assert.rejects(WorkspaceToolRuntime.restoreCheckpointGroups(groups, { recordVersions: true }), { code: 'INVALID_CHECKPOINT' });
  assert.equal(await readFile(join(a.root, 'same.txt'), 'utf8'), 'a1');
  await writeFile(join(b.checkpoints, cb, 'before.bin'), 'b0');
  await writeFile(join(b.root, 'same.txt'), 'manual');
  await assert.rejects(WorkspaceToolRuntime.restoreCheckpointGroups(groups, { recordVersions: true }), { code: 'ROLLBACK_CONFLICT' });
  assert.equal(await readFile(join(a.root, 'same.txt'), 'utf8'), 'a1');
  assert.equal(await readFile(join(b.root, 'same.txt'), 'utf8'), 'manual');
});

test('real command create delete and rename participate in one multi-root target transaction and compensate together', async t => {
  const a = await fixture(t), b = await fixture(t);
  await writeFile(join(a.root, 'old-name.txt'), 'rename bytes');
  await writeFile(join(a.root, 'deleted.txt'), 'deleted bytes');
  await writeFile(join(a.root, 'unchanged.txt'), 'untouched bytes');
  await writeFile(join(b.root, 'other.txt'), 'b0');
  const registry = new AgentToolRegistry(); a.runtime.registerTools(registry);
  const result = await registry.execute({ id: 'rename-create-delete', name: 'process.run', arguments: {
    command: process.execPath, args: ['-e', "const fs=require('node:fs');fs.renameSync('old-name.txt','new-name.txt');fs.unlinkSync('deleted.txt');fs.writeFileSync('created.txt','created bytes')"]
  } }, 'full_access', { runId: 'rename-transaction' });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const ids = result.summary.checkpointIds!;
  const diffs = await Promise.all(ids.map(id => a.runtime.getCheckpointDiff(id)));
  assert.deepEqual(diffs.map(diff => [diff.path, diff.kind]).sort((a, b) => a[0].localeCompare(b[0])), [
    ['created.txt', 'created'], ['deleted.txt', 'deleted'], ['new-name.txt', 'created'], ['old-name.txt', 'deleted']
  ]);
  const other = await b.write('other.txt', 'b1');
  const groups = [{ runtime: a.runtime, checkpointIds: ids, targets: ids.map(checkpointId => ({ checkpointId, side: 'before' as const })) },
    { runtime: b.runtime, checkpointIds: [other], targets: [{ checkpointId: other, side: 'before' as const }] }];
  const originalPrepare = b.runtime.prepareCheckpointRestore.bind(b.runtime);
  b.runtime.prepareCheckpointRestore = async (...args) => {
    const prepared = await originalPrepare(...args);
    return { ...prepared, apply: async () => { await prepared.apply(); throw new Error('injected second-root failure after write'); } };
  };
  await assert.rejects(WorkspaceToolRuntime.restoreCheckpointGroups(groups, { recordVersions: true }), /injected second-root failure/);
  assert.equal(await readFile(join(a.root, 'new-name.txt'), 'utf8'), 'rename bytes');
  assert.equal(await readFile(join(a.root, 'created.txt'), 'utf8'), 'created bytes');
  await assert.rejects(readFile(join(a.root, 'old-name.txt')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(a.root, 'deleted.txt')), { code: 'ENOENT' });
  assert.equal(await readFile(join(b.root, 'other.txt'), 'utf8'), 'b1');
  b.runtime.prepareCheckpointRestore = originalPrepare;
  await WorkspaceToolRuntime.restoreCheckpointGroups(groups, { recordVersions: true });
  assert.equal(await readFile(join(a.root, 'old-name.txt'), 'utf8'), 'rename bytes');
  assert.equal(await readFile(join(a.root, 'deleted.txt'), 'utf8'), 'deleted bytes');
  await assert.rejects(readFile(join(a.root, 'new-name.txt')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(a.root, 'created.txt')), { code: 'ENOENT' });
  assert.equal(await readFile(join(a.root, 'unchanged.txt'), 'utf8'), 'untouched bytes');
  assert.equal(await readFile(join(b.root, 'other.txt'), 'utf8'), 'b0');
});
