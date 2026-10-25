import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, chmod, stat, open, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { AgentToolRegistry, WorkspaceToolRuntime } from '../lib/index.js';
import { captureWorkspaceSnapshot, persistCommandSnapshot, loadCommandSnapshot, inspectSnapshotFile, SNAPSHOT_MAX_FILE_BYTES } from '../lib/workspace-snapshot.js';

async function fixture(t: TestContext, limits?: Record<string, number>) {
  const base = await mkdtemp(join(tmpdir(), 'nm-recovery-search-'));
  let root = join(base, 'workspace');
  const checkpoints = join(base, 'checkpoints');
  await mkdir(root);
  root = await realpath(root);
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: root, checkpointRoot: checkpoints, permissionMode: 'full_access', limits });
  const registry = new AgentToolRegistry(); runtime.registerTools(registry);
  let call = 0;
  const execute = (name: string, args: unknown, signal?: AbortSignal) => registry.execute({ id: `call-${++call}`, name, arguments: args }, 'full_access', { runId: 'run-command-checkpoint', signal });
  t.after(async () => { await runtime.dispose(); await rm(base, { recursive: true, force: true }); });
  return { root, checkpoints, runtime, registry, execute };
}

test('native commands capture edits, creations, deletions and conflict-safe grouped restoration', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'before.txt'), 'original\n');
  await writeFile(join(f.root, 'removed.txt'), 'retain me\n');
  const result = await f.execute('process.run', { command: process.execPath, args: ['-e', "const fs=require('node:fs');fs.writeFileSync('before.txt','changed\\n');fs.writeFileSync('created.txt','new\\n');fs.unlinkSync('removed.txt')"] });
  assert.equal(result.ok, true);
  assert.deepEqual([...result.summary.changedPaths!].sort(), ['before.txt', 'created.txt', 'removed.txt']);
  assert.equal(result.summary.checkpointIds!.length, 3);
  const diffs = await Promise.all(result.summary.checkpointIds!.map(id => f.runtime.getCheckpointDiff(id)));
  assert.equal(diffs.find(d => d.path === 'removed.txt')?.kind, 'deleted');
  await writeFile(join(f.root, 'before.txt'), 'user edit after command\n');
  await assert.rejects(f.runtime.restoreCheckpointChain([...result.summary.checkpointIds!].reverse()), /changed after checkpoint/i);
  assert.equal(await readFile(join(f.root, 'created.txt'), 'utf8'), 'new\n');
  await writeFile(join(f.root, 'before.txt'), 'changed\n');
  await f.runtime.restoreCheckpointChain([...result.summary.checkpointIds!].reverse());
  assert.equal(await readFile(join(f.root, 'before.txt'), 'utf8'), 'original\n');
  assert.equal(await readFile(join(f.root, 'removed.txt'), 'utf8'), 'retain me\n');
  await assert.rejects(readFile(join(f.root, 'created.txt')), /ENOENT/);
});

test('async exit returns command changes on read and does not create duplicate checkpoints', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'async.txt'), 'before');
  const started = await f.execute('process.start', { command: process.execPath, tty: false, args: ['-e', "require('node:fs').writeFileSync('async.txt','after')"] });
  const processId = (started.output as any).processId;
  let result;
  for (let i = 0; i < 10; i++) {
    result = await f.execute('process.read', { processId, waitMs: 500 });
    if (!(result.output as any).running) break;
  }
  assert.equal((result!.output as any).running, false);
  assert.deepEqual(result!.summary.changedPaths, ['async.txt']);
  const ids = f.runtime.getCreatedCheckpointIds();
  await f.execute('process.read', { processId, waitMs: 0 });
  assert.deepEqual(f.runtime.getCreatedCheckpointIds(), ids);
  await f.runtime.restoreCheckpointChain([...ids].reverse());
  assert.equal(await readFile(join(f.root, 'async.txt'), 'utf8'), 'before');
});

test('terminating an async command preserves its prior file edits for recovery', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'cancel.txt'), 'original');
  const started = await f.execute('process.start', { command: process.execPath, tty: false, args: ['-e', "require('node:fs').writeFileSync('cancel.txt','partial');console.log('written');setInterval(()=>{},1000)"] });
  const processId = (started.output as any).processId;
  const output = await f.execute('process.read', { processId, waitMs: 1000 });
  assert.match(JSON.stringify(output.output), /written/);
  const stopped = await f.execute('process.terminate', { processId });
  assert.deepEqual(stopped.summary.changedPaths, ['cancel.txt']);
  await f.runtime.restoreCheckpointChain([...f.runtime.getCreatedCheckpointIds()].reverse());
  assert.equal(await readFile(join(f.root, 'cancel.txt'), 'utf8'), 'original');
});

test('runtime finalization captures unpolled commands and edit tools share the restoration chain', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'chain.txt'), 'zero');
  await f.execute('process.run', { command: process.execPath, args: ['-e', "require('node:fs').writeFileSync('chain.txt','one')"] });
  const read = await f.execute('workspace.read_file', { path: 'chain.txt' });
  await f.execute('workspace.write_file', { path: 'chain.txt', content: 'two', expectedSha256: (read.output as any).sha256 });
  const started = await f.execute('process.start', { command: process.execPath, tty: false, args: ['-e', "require('node:fs').writeFileSync('chain.txt','three');console.log('written');setInterval(()=>{},1000)"] });
  await f.execute('process.read', { processId: (started.output as any).processId, waitMs: 1000 });
  await f.runtime.finalizeProcessCheckpoints();
  assert.equal(f.runtime.getCreatedCheckpointIds().length, 3);
  await f.runtime.restoreCheckpointChain([...f.runtime.getCreatedCheckpointIds()].reverse());
  assert.equal(await readFile(join(f.root, 'chain.txt'), 'utf8'), 'zero');
});

test('source snapshots reuse unchanged bytes and expose budget exclusions', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'a.txt'), 'a');
  await writeFile(join(f.root, 'b.txt'), 'bbbbbbbbbb');
  const first = await captureWorkspaceSnapshot(f.root, f.checkpoints, undefined, { maxFileBytes: 4 });
  const second = await captureWorkspaceSnapshot(f.root, f.checkpoints, first, { maxFileBytes: 4 });
  assert.equal(second.files.get('a.txt'), first.files.get('a.txt'));
  assert.equal(first.complete, false);
  assert.ok(first.excludedPaths.has('b.txt'));
  assert.ok(first.warnings.length);
});

test('persisted pre-command snapshots recover after a dead owner without changing live files', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'crash.txt'), 'before crash');
  const snapshot = await captureWorkspaceSnapshot(f.root, f.checkpoints);
  const directory = join(f.checkpoints, '.pending-commands', randomUUID());
  await persistCommandSnapshot(directory, snapshot, { workspaceRoot: f.root, runId: 'run-crashed', generation: randomUUID() });
  const metadata = JSON.parse(await readFile(join(directory, 'snapshot.json'), 'utf8'));
  metadata.ownerPid = 2147483647;
  await writeFile(join(directory, 'snapshot.json'), JSON.stringify(metadata));
  await writeFile(join(f.root, 'crash.txt'), 'after crash');
  const recovered = await WorkspaceToolRuntime.create({ workspaceRoot: f.root, checkpointRoot: f.checkpoints, permissionMode: 'full_access' });
  t.after(() => recovered.dispose());
  assert.equal(await readFile(join(f.root, 'crash.txt'), 'utf8'), 'after crash');
  assert.equal(recovered.getCreatedCheckpointIds().length, 1);
  await recovered.restoreCheckpointChain([...recovered.getCreatedCheckpointIds()].reverse());
  assert.equal(await readFile(join(f.root, 'crash.txt'), 'utf8'), 'before crash');
});

test('search streams beyond the normal file read limit and preserves line numbers', async t => {
  const f = await fixture(t, { maxFileBytes: 1024 });
  await writeFile(join(f.root, 'large.txt'), 'prefix\n' + 'a'.repeat(130_000) + 'BoundaryTarget\nlast\n');
  const result = await f.execute('workspace.search_text', { path: 'large.txt', query: 'BoundaryTarget' });
  assert.equal(result.ok, true);
  assert.equal((result.output as any).matches[0].line, 2);
  assert.equal((result.output as any).complete, true);
});

test('search explicitly reports binary and traversal exclusions', async t => {
  const f = await fixture(t, { maxSearchFiles: 2 });
  await writeFile(join(f.root, 'a.bin'), Buffer.from([0, 1, 2]));
  await writeFile(join(f.root, 'b.txt'), 'target');
  await writeFile(join(f.root, 'c.txt'), 'target');
  const result = await f.execute('workspace.search_text', { query: 'target' });
  assert.equal((result.output as any).complete, false);
  assert.ok((result.output as any).incompleteReasons.includes('entry_limit'));
  assert.ok((result.output as any).skipped.some((entry: any) => entry.reason === 'BINARY_FILE'));
});

test('project map locates parsed symbols and dependencies, with unsupported languages explicit', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'sample.ts'), 'import { useThing } from "./helper";\nexport class Engine {\n run(value: string) { return useThing(value); }\n}\nexport const launch = () => new Engine();\n');
  await writeFile(join(f.root, 'main.swift'), 'func swiftEntry() -> Int { return 1 }\n');
  const result = await f.execute('workspace.project_map', { query: 'Engine' });
  assert.equal(result.ok, true);
  const output = result.output as any;
  assert.equal(output.files[0].path, 'sample.ts');
  assert.ok(output.files[0].symbols.some((symbol: any) => symbol.name === 'Engine' && symbol.line === 2));
  assert.deepEqual(output.files[0].imports, ['./helper']);
  assert.equal(output.files.find((file: any) => file.path === 'main.swift').syntaxIndexed, false);
  assert.equal(output.otherLanguages, 'file_index_only');
});

test('running commands and direct edits advance one restoration baseline', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'mixed.txt'), 'zero');
  const started = await f.execute('process.start', { command: process.execPath, tty: false, pipeStdin: true, args: ['-e', "const fs=require('node:fs');fs.writeFileSync('mixed.txt','one');console.log('ready');process.stdin.once('data',()=>{fs.writeFileSync('mixed.txt','three');process.exit(0)})"] });
  const processId = (started.output as any).processId;
  await f.execute('process.read', { processId, waitMs: 1000 });
  const read = await f.execute('workspace.read_file', { path: 'mixed.txt' });
  await f.execute('workspace.write_file', { path: 'mixed.txt', content: 'two', expectedSha256: (read.output as any).sha256 });
  await f.execute('process.write', { processId, data: 'finish\n' });
  for (let i = 0; i < 10; i++) {
    const result = await f.execute('process.read', { processId, waitMs: 500 });
    if (!(result.output as any).running) break;
  }
  assert.equal(f.runtime.getCreatedCheckpointIds().length, 3);
  await f.runtime.restoreCheckpointChain([...f.runtime.getCreatedCheckpointIds()].reverse());
  assert.equal(await readFile(join(f.root, 'mixed.txt'), 'utf8'), 'zero');
});

test('a command growing a protected file beyond the snapshot budget retains its original', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'grown.txt'), 'original source');
  const result = await f.execute('process.run', { command: process.execPath, args: ['-e', `const fs=require('node:fs');const fd=fs.openSync('grown.txt','w');fs.ftruncateSync(fd,${SNAPSHOT_MAX_FILE_BYTES + 1});fs.closeSync(fd)`] });
  assert.equal((result.output as any).checkpointCoverage.complete, false);
  assert.match(f.runtime.getCheckpointWarnings().join('\n'), /retained for manual recovery/);
  const { readdir } = await import('node:fs/promises');
  const allDirs = await readdir(join(f.checkpoints, '.pending-commands'));
  const dirs: string[] = [];
  for (const dir of allDirs) {
    const manifest = JSON.parse(await readFile(join(f.checkpoints, '.pending-commands', dir, 'snapshot.json'), 'utf8'));
    if (manifest.phase !== 'idle') dirs.push(dir);
  }
  assert.equal(dirs.length, 1);
  const metadata = JSON.parse(await readFile(join(f.checkpoints, '.pending-commands', dirs[0], 'snapshot.json'), 'utf8'));
  assert.equal(metadata.files[0].path, 'grown.txt');
  const original = await readFile(join(f.checkpoints, '.pending-commands', dirs[0], `${metadata.files[0].sha256}.bin`), 'utf8');
  assert.equal(original, 'original source');
});

test('partial content coverage keeps its warning while proven creations remain recoverable', async t => {
  const f = await fixture(t), oversized = join(f.root, 'too-large.bin');
  const handle = await open(oversized, 'w');
  try { await handle.truncate(SNAPSHOT_MAX_FILE_BYTES + 1); } finally { await handle.close(); }
  await writeFile(join(f.root, 'known.txt'), 'original');
  const result = await f.execute('process.run', { command: process.execPath, args: ['-e',
    "const fs=require('node:fs');fs.writeFileSync('known.txt','edited');fs.writeFileSync('too-large.bin','small now');fs.writeFileSync('uncertain.txt','retained')"] });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal((result.output as any).checkpointCoverage.complete, false);
  assert.deepEqual(result.summary.changedPaths, ['known.txt', 'uncertain.txt']);
  const next = await f.execute('process.run', { command: process.execPath, args: ['-e', "console.log('complete capture')"] });
  assert.equal(next.ok, true, JSON.stringify(next.error));
  assert.equal((next.output as any).checkpointCoverage.complete, true);
  assert.match(f.runtime.getCheckpointWarnings().join('\n'), /budget/);
  await f.runtime.restoreCheckpointChain([...result.summary.checkpointIds!].reverse());
  assert.equal(await readFile(join(f.root, 'known.txt'), 'utf8'), 'original');
  assert.equal(await readFile(oversized, 'utf8'), 'small now');
  await assert.rejects(readFile(join(f.root, 'uncertain.txt'), 'utf8'), { code: 'ENOENT' });
});

test('source discovery reuses Git ignore rules and does not restore newly unignored files as creations', async t => {
  const f = await fixture(t);
  await mkdir(join(f.root, 'cached'));
  await mkdir(join(f.root, 'src'));
  await writeFile(join(f.root, '.gitignore'), 'cached/\n*.tmp\n');
  await writeFile(join(f.root, 'cached', 'existing.txt'), 'must remain');
  await writeFile(join(f.root, 'src', '.gitignore'), '*.ts\n!keep.ts\n');
  await writeFile(join(f.root, 'src', 'keep.ts'), 'export function important() {}');
  await writeFile(join(f.root, 'src', 'skip.ts'), 'export function ignored() {}');
  const map = await f.execute('workspace.project_map', {});
  const paths = (map.output as any).files.map((file: any) => file.path);
  assert.ok(paths.includes('src/keep.ts'));
  assert.ok(!paths.includes('src/skip.ts'));
  assert.ok(!paths.includes('cached/existing.txt'));
  const edited = await f.execute('process.run', { command: process.execPath, args: ['-e', "require('node:fs').writeFileSync('.gitignore','')"] });
  assert.ok(!edited.summary.changedPaths!.includes('cached/existing.txt'));
  await f.runtime.restoreCheckpointChain([...f.runtime.getCreatedCheckpointIds()].reverse());
  assert.equal(await readFile(join(f.root, 'cached', 'existing.txt'), 'utf8'), 'must remain');
});

test('the repository .git/info/exclude hides files like .gitignore, which may re-include them', async t => {
  const f = await fixture(t);
  await mkdir(join(f.root, '.git', 'info'), { recursive: true });
  await writeFile(join(f.root, '.git', 'info', 'exclude'), 'local-notes.md\n*.log\n');
  await writeFile(join(f.root, '.gitignore'), '!keep.log\n');
  await mkdir(join(f.root, 'pkg'));
  await writeFile(join(f.root, 'pkg', '.git'), 'gitdir: ../.git/worktrees/pkg\n');
  for (const name of ['local-notes.md', 'debug.log', 'keep.log', 'main.ts', 'pkg/index.ts', 'pkg/trace.log']) await writeFile(join(f.root, name), 'needle');
  const map = await f.execute('workspace.project_map', {});
  const paths = (map.output as any).files.map((file: any) => file.path);
  for (const path of ['keep.log', 'main.ts', 'pkg/index.ts']) assert.ok(paths.includes(path), path);
  for (const path of ['local-notes.md', 'debug.log', 'pkg/trace.log']) assert.ok(!paths.includes(path), path);
  const found = await f.execute('workspace.search_text', { query: 'needle' });
  assert.deepEqual([...new Set((found.output as any).matches.map((match: any) => match.path))].sort(), ['keep.log', 'main.ts', 'pkg/index.ts']);
  assert.match((found.output as any).ignoreRules, /info\/exclude/);
});


test('permission-only command edits are recorded and grouped restore rejects later chmod conflicts', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'run.sh'), 'echo hello\n'); await chmod(join(f.root, 'run.sh'), 0o644);
  await writeFile(join(f.root, 'text.txt'), 'original');
  const result = await f.execute('process.run', { command: process.execPath, args: ['-e', "const fs=require('node:fs');fs.chmodSync('run.sh',0o755);fs.writeFileSync('text.txt','changed')"] });
  assert.equal(result.ok, true); assert.deepEqual([...result.summary.changedPaths!].sort(), ['run.sh', 'text.txt']);
  const ids = [...result.summary.checkpointIds!].reverse();
  const diff = (await Promise.all(ids.map(id => f.runtime.getCheckpointDiff(id)))).find(item => item.path === 'run.sh')!;
  assert.equal(diff.beforeMode! & 0o777, 0o644); assert.equal(diff.afterMode! & 0o777, 0o755);
  await chmod(join(f.root, 'run.sh'), 0o700);
  await assert.rejects(f.runtime.restoreCheckpointChain(ids), /permissions changed after checkpoint/i);
  assert.equal(await readFile(join(f.root, 'text.txt'), 'utf8'), 'changed');
  assert.equal((await stat(join(f.root, 'run.sh'))).mode & 0o777, 0o700);
  await chmod(join(f.root, 'run.sh'), 0o755);
  await f.runtime.restoreCheckpointChain(ids);
  assert.equal((await stat(join(f.root, 'run.sh'))).mode & 0o777, 0o644);
  assert.equal(await readFile(join(f.root, 'text.txt'), 'utf8'), 'original');
});

test('large originals use reusable disk objects and restore beyond the old total memory budget', async t => {
  const f = await fixture(t);
  const file = await open(join(f.root, 'large.txt'), 'w');
  const chunk = Buffer.alloc(256 * 1024, 'a');
  try { for (let i = 0; i < 160; i++) await file.writeFile(chunk); } finally { await file.close(); }
  const initial = await inspectSnapshotFile(join(f.root, 'large.txt'), { memory: false });
  const first = await captureWorkspaceSnapshot(f.root, f.checkpoints);
  assert.equal(first.complete, true); assert.equal(first.files.get('large.txt')!.content, undefined);
  assert.ok(first.files.get('large.txt')!.contentPath);
  assert.equal((await captureWorkspaceSnapshot(f.root, f.checkpoints, first)).files.get('large.txt'), first.files.get('large.txt'));
  assert.ok([...first.files.values()].reduce((sum, item) => sum + (item.content?.length || 0), 0) <= 4 * 1024 * 1024);
  const result = await f.execute('process.run', { command: process.execPath, args: ['-e', "const fs=require('node:fs');let fd=fs.openSync('large.txt','r+');fs.writeSync(fd,'changed');fs.closeSync(fd)"] });
  assert.equal(result.ok, true); assert.equal((result.output as any).checkpointCoverage.complete, true);
  assert.equal(result.summary.checkpointIds!.length, 1);
  const id = result.summary.checkpointIds![0]; const diff = await f.runtime.getCheckpointDiff(id);
  assert.equal(diff.truncated, true); assert.equal(diff.patch, '');
  await assert.rejects(f.runtime.getCheckpointDiff(id, true), { code: 'CHECKPOINT_PREVIEW_TOO_LARGE' });
  await f.runtime.restoreCheckpointChain([id]);
  assert.equal((await inspectSnapshotFile(join(f.root, 'large.txt'), { memory: false })).sha256, initial.sha256);
});

test('disk snapshots round-trip legacy metadata and corrupted objects never overwrite live files', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'file.bin'), Buffer.alloc(5 * 1024 * 1024, 42));
  const snapshot = await captureWorkspaceSnapshot(f.root, f.checkpoints);
  const directory = join(f.checkpoints, 'persisted');
  await persistCommandSnapshot(directory, snapshot, { workspaceRoot: f.root, runId: 'snapshot-test', generation: randomUUID() });
  const manifest = JSON.parse(await readFile(join(directory, 'snapshot.json'), 'utf8'));
  delete manifest.files[0].size; await writeFile(join(directory, 'snapshot.json'), JSON.stringify(manifest));
  const loaded = await loadCommandSnapshot(directory, f.root);
  assert.equal(loaded.snapshot.files.get('file.bin')!.size, 5 * 1024 * 1024);
  assert.equal(loaded.snapshot.files.get('file.bin')!.content, undefined);
  const edited = await f.execute('process.run', { command: process.execPath, args: ['-e', "require('node:fs').writeFileSync('file.bin','changed')"] });
  const id = edited.summary.checkpointIds![0]; await writeFile(join(f.checkpoints, id, 'before.bin'), 'tampered');
  await assert.rejects(f.runtime.restoreCheckpointChain([id]), /backup is invalid/);
  assert.equal(await readFile(join(f.root, 'file.bin'), 'utf8'), 'changed');
});

test('snapshot boundaries report omitted files and do not traverse directory links', async t => {
  const f = await fixture(t);
  const huge = await open(join(f.root, 'huge.bin'), 'w'); try { await huge.truncate(SNAPSHOT_MAX_FILE_BYTES + 1); } finally { await huge.close(); }
  const outside = join(f.checkpoints, 'outside'); await mkdir(outside, { recursive: true }); await writeFile(join(outside, 'secret.txt'), 'outside');
  await symlink(outside, join(f.root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const captured = await captureWorkspaceSnapshot(f.root, f.checkpoints);
  assert.equal(captured.complete, false); assert.ok(captured.excludedPaths.has('huge.bin'));
  assert.ok(captured.excludedPaths.has('link')); assert.ok(!captured.files.has('link/secret.txt'));
});
