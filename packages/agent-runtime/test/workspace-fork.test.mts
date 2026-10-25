import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, realpath, readFile, writeFile, rm, readdir, stat, open, symlink } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentToolRegistry, WorkspaceToolRuntime, forkWorkspaceGroups, copyIsolatedWorkspaceFile, readWorkspaceForkLayout } from '../lib/index.js';

async function fixture(t: TestContext) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'nm-fork-')));
  const rootA = join(base, 'source', 'a'), rootB = join(base, 'source', 'b');
  const runtimes: WorkspaceToolRuntime[] = [];
  const runtimeRoots = new Map<WorkspaceToolRuntime, string>();
  await mkdir(rootA, { recursive: true }); await mkdir(rootB, { recursive: true });
  const store = (root: string) => join(base, 'stores', createHash('sha256').update(root).digest('hex'));
  const runtime = async (root: string) => {
    const rt = await WorkspaceToolRuntime.create({ workspaceRoot: root, checkpointRoot: store(root), permissionMode: 'full_access' });
    runtimes.push(rt); runtimeRoots.set(rt, root); return rt;
  };
  const write = async (rt: WorkspaceToolRuntime, path: string, content: string) => {
    const registry = new AgentToolRegistry(); rt.registerTools(registry);
    const current = await readFile(resolve(runtimeRoots.get(rt)!, path)).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    const expectedSha256 = current ? createHash('sha256').update(current).digest('hex') : null;
    const result = await registry.execute({ id: randomUUID(), name: 'workspace.write_file', arguments: { path, content, expectedSha256 } }, 'full_access', { runId: randomUUID() });
    assert.equal(result.ok, true, JSON.stringify(result.error)); return result.summary.checkpointId!;
  };
  t.after(async () => { await Promise.allSettled(runtimes.map(rt => rt.dispose())); await rm(base, { recursive: true, force: true }); });
  return { base, rootA, rootB, store, runtime, write };
}

test('multi-root fork restores only independent copies and excludes unrelated external history', async t => {
  const f = await fixture(t), a = await f.runtime(f.rootA), b = await f.runtime(f.rootB);
  await writeFile(join(f.rootA, 'same.txt'), 'a0'); await writeFile(join(f.rootB, 'same.txt'), 'b0');
  const external = join(f.base, 'outside.txt'); await writeFile(external, 'e0');
  const unrelated = join(f.base, 'unrelated.txt'); await writeFile(unrelated, 'secret0');
  const ca = await f.write(a, 'same.txt', 'a1'), cb = await f.write(b, 'same.txt', 'b1');
  const ce = await f.write(a, external, 'e1'); await f.write(a, unrelated, 'secret1');
  const result = await forkWorkspaceGroups({ targetDirectory: join(f.base, 'child'), primaryWorkspaceRoot: f.rootA,
    checkpointRootForWorkspace: f.store, groups: [
      { workspaceRoot: f.rootA, inheritedCheckpointIds: [ca, ce], checkpointIds: [ce, ca] },
      { workspaceRoot: f.rootB, inheritedCheckpointIds: [cb], checkpointIds: [cb] },
    ] });
  const branchB = result.workspaces.find(item => item.sourceWorkspaceRoot === f.rootB)!.workspaceRoot;
  assert.equal(relative(result.workspaceRoot, branchB), relative(f.rootA, f.rootB));
  assert.equal(await readFile(join(result.workspaceRoot, 'same.txt'), 'utf8'), 'a0');
  assert.equal(await readFile(join(branchB, 'same.txt'), 'utf8'), 'b0');
  assert.equal(await readFile(result.resourceMappings.find(item => item.sourcePath === external)!.targetPath, 'utf8'), 'e0');
  assert.equal(result.resourceMappings.some(item => item.sourcePath === unrelated), false);
  assert.equal(await readFile(join(f.rootA, 'same.txt'), 'utf8'), 'a1');
  assert.equal(await readFile(join(f.rootB, 'same.txt'), 'utf8'), 'b1');
  assert.equal(await readFile(external, 'utf8'), 'e1');
  assert.deepEqual((await readdir(f.store(result.workspaceRoot))).filter(id => id === ca || id === ce || id.startsWith('restore-')).sort(), [ca, ce].sort());
});

test('forking a fork maps external files to the immediate parent, never back to original files', async t => {
  const f = await fixture(t), a = await f.runtime(f.rootA);
  const external = join(f.base, 'outside.txt'); await writeFile(external, 'original');
  const ce = await f.write(a, external, 'parent');
  const first = await forkWorkspaceGroups({ targetDirectory: join(f.base, 'child'), primaryWorkspaceRoot: f.rootA,
    checkpointRootForWorkspace: f.store, groups: [{ workspaceRoot: f.rootA, inheritedCheckpointIds: [ce], checkpointIds: [] }] });
  const firstExternal = first.resourceMappings[0].targetPath;
  const childRuntime = await f.runtime(first.workspaceRoot);
  const cc = await f.write(childRuntime, firstExternal, 'child');
  const second = await forkWorkspaceGroups({ targetDirectory: join(f.base, 'grandchild'), primaryWorkspaceRoot: first.workspaceRoot,
    checkpointRootForWorkspace: f.store, groups: first.workspaces.map(root => ({ workspaceRoot: root.workspaceRoot,
      inheritedCheckpointIds: root.sourceWorkspaceRoot === f.rootA ? [ce, cc] : [], checkpointIds: root.sourceWorkspaceRoot === f.rootA ? [cc] : [] })) });
  const grandchildExternal = second.resourceMappings.find(item => item.sourcePath === firstExternal)!.targetPath;
  assert.equal(await readFile(grandchildExternal, 'utf8'), 'parent');
  assert.equal(await readFile(firstExternal, 'utf8'), 'child');
  assert.equal(await readFile(external, 'utf8'), 'parent');
});

test('a file above the old 256 MiB fork limit is copied without a size-sized buffer', async t => {
  const f = await fixture(t), source = join(f.rootA, 'large.bin'), target = join(f.rootB, 'copy.bin');
  const file = await open(source, 'w'); const size = 257 * 1024 * 1024;
  await file.truncate(size); await file.write(Buffer.from('tail'), 0, 4, size - 4); await file.close();
  await copyIsolatedWorkspaceFile(source, target);
  assert.equal((await stat(target)).size, size);
  const copy = await open(target, 'r'); const tail = Buffer.alloc(4);
  await copy.read(tail, 0, 4, size - 4); await copy.close(); assert.equal(tail.toString(), 'tail');
  assert.notEqual((await stat(source)).ino, (await stat(target)).ino);
});

test('a linked Git worktree forks with independent metadata and keeps staged and working bytes', async t => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const git = promisify(execFile), f = await fixture(t);
  await git('git', ['init', f.rootA]);
  await git('git', ['-C', f.rootA, 'config', 'user.name', 'NextMux Test']);
  await git('git', ['-C', f.rootA, 'config', 'user.email', 'test@example.invalid']);
  await writeFile(join(f.rootA, 'file.txt'), 'base');
  await git('git', ['-C', f.rootA, 'add', '.']); await git('git', ['-C', f.rootA, 'commit', '-m', 'base']);
  const linked = join(f.base, 'linked'); await git('git', ['-C', f.rootA, 'worktree', 'add', '-b', 'test-linked', linked]);
  await writeFile(join(linked, 'file.txt'), 'staged'); await git('git', ['-C', linked, 'add', '.']);
  await writeFile(join(linked, 'file.txt'), 'working');
  const result = await forkWorkspaceGroups({ targetDirectory: join(f.base, 'child'), primaryWorkspaceRoot: linked,
    checkpointRootForWorkspace: f.store, groups: [{ workspaceRoot: linked, inheritedCheckpointIds: [], checkpointIds: [] }] });
  assert.equal((await stat(join(result.workspaceRoot, '.git'))).isDirectory(), true);
  assert.equal(await readFile(join(result.workspaceRoot, 'file.txt'), 'utf8'), 'working');
  assert.equal((await git('git', ['-C', result.workspaceRoot, 'show', ':file.txt'])).stdout, 'staged');
  assert.equal((await git('git', ['-C', result.workspaceRoot, 'remote'])).stdout.trim(), '');
  await git('git', ['-C', result.workspaceRoot, 'reset', '--hard', 'HEAD']);
  assert.equal(await readFile(join(linked, 'file.txt'), 'utf8'), 'working');
  assert.equal((await git('git', ['-C', linked, 'show', ':file.txt'])).stdout, 'staged');
});


test('private multi-root layout survives reopen and rejects forged or redirected roots', async t => {
  const f = await fixture(t), container = join(f.base, 'child');
  const result = await forkWorkspaceGroups({ targetDirectory: container, primaryWorkspaceRoot: f.rootA,
    checkpointRootForWorkspace: f.store, groups: [f.rootA, f.rootB].map(workspaceRoot => ({ workspaceRoot, inheritedCheckpointIds: [], checkpointIds: [] })) });
  const reopened = await readWorkspaceForkLayout(container);
  assert.deepEqual(reopened, { workspaceRoot: result.workspaceRoot, workspaces: result.workspaces });
  const manifestPath = join(container, '.nextmux-fork-layout.json');
  const original = JSON.parse(await readFile(manifestPath, 'utf8'));
  await writeFile(manifestPath, JSON.stringify({ ...original, primary: '../source/a' }));
  await assert.rejects(readWorkspaceForkLayout(container), { code: 'INVALID_FORK_LAYOUT' });
  await writeFile(manifestPath, JSON.stringify(original));
  await rm(result.workspaceRoot, { recursive: true });
  await symlink(f.rootA, result.workspaceRoot, 'dir');
  await assert.rejects(readWorkspaceForkLayout(container), { code: 'INVALID_FORK_LAYOUT' });
  assert.equal(await readWorkspaceForkLayout(f.rootA), undefined);
});

test('an initialized Git repository with no commit preserves its staged first files', async t => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const git = promisify(execFile), f = await fixture(t);
  await git('git', ['init', f.rootA]); await writeFile(join(f.rootA, 'first.txt'), 'staged first');
  await git('git', ['-C', f.rootA, 'add', '.']); await writeFile(join(f.rootA, 'first.txt'), 'working first');
  const result = await forkWorkspaceGroups({ targetDirectory: join(f.base, 'child'), primaryWorkspaceRoot: f.rootA,
    checkpointRootForWorkspace: f.store, groups: [{ workspaceRoot: f.rootA, inheritedCheckpointIds: [], checkpointIds: [] }] });
  assert.equal(await readFile(join(result.workspaceRoot, 'first.txt'), 'utf8'), 'working first');
  assert.equal((await git('git', ['-C', result.workspaceRoot, 'show', ':first.txt'])).stdout, 'staged first');
  assert.equal((await git('git', ['-C', f.rootA, 'show', ':first.txt'])).stdout, 'staged first');
});

test('a branch of a branch restores explicit prompt targets across two roots and an external file without rewinding its parent', async t => {
  const f = await fixture(t), a = await f.runtime(f.rootA), b = await f.runtime(f.rootB);
  const external = join(f.base, 'outside.txt');
  await writeFile(join(f.rootA, 'same.txt'), 'a0'); await writeFile(join(f.rootB, 'same.txt'), 'b0'); await writeFile(external, 'e0');
  const ca = await f.write(a, 'same.txt', 'a1'), cb = await f.write(b, 'same.txt', 'b1'), ce = await f.write(a, external, 'e1');
  const laterA = await f.write(a, 'same.txt', 'a2'), laterE = await f.write(a, external, 'e2');
  const child = await forkWorkspaceGroups({ targetDirectory: join(f.base, 'child-targets'), primaryWorkspaceRoot: f.rootA,
    checkpointRootForWorkspace: f.store, groups: [
      { workspaceRoot: f.rootA, inheritedCheckpointIds: [], checkpointIds: [laterA, laterE, ca, ce], targets: [{ checkpointId: ca, side: 'after' }, { checkpointId: ce, side: 'after' }] },
      { workspaceRoot: f.rootB, inheritedCheckpointIds: [], checkpointIds: [cb], targets: [{ checkpointId: cb, side: 'before' }] }
    ] });
  const childB = child.workspaces.find(item => item.sourceWorkspaceRoot === f.rootB)!.workspaceRoot;
  const childExternal = child.resourceMappings.find(item => item.sourcePath === external)!.targetPath;
  assert.equal(await readFile(join(child.workspaceRoot, 'same.txt'), 'utf8'), 'a1');
  assert.equal(await readFile(join(childB, 'same.txt'), 'utf8'), 'b0');
  assert.equal(await readFile(childExternal, 'utf8'), 'e1');
  const childRuntime = await f.runtime(child.workspaceRoot);
  const nextA = await f.write(childRuntime, 'same.txt', 'a3'), nextE = await f.write(childRuntime, childExternal, 'e3');
  const grandchild = await forkWorkspaceGroups({ targetDirectory: join(f.base, 'grandchild-targets'), primaryWorkspaceRoot: child.workspaceRoot,
    checkpointRootForWorkspace: f.store, groups: child.workspaces.map(root => ({ workspaceRoot: root.workspaceRoot,
      inheritedCheckpointIds: [], checkpointIds: root.workspaceRoot === child.workspaceRoot ? [ca, ce, nextA, nextE] : [],
      targets: root.workspaceRoot === child.workspaceRoot ? [{ checkpointId: ca, side: 'after' as const }, { checkpointId: ce, side: 'after' as const }] : [] })) });
  const grandchildExternal = grandchild.resourceMappings.find(item => item.sourcePath === childExternal)!.targetPath;
  assert.equal(await readFile(join(grandchild.workspaceRoot, 'same.txt'), 'utf8'), 'a1');
  assert.equal(await readFile(grandchildExternal, 'utf8'), 'e1');
  assert.equal(await readFile(join(child.workspaceRoot, 'same.txt'), 'utf8'), 'a3');
  assert.equal(await readFile(childExternal, 'utf8'), 'e3');
  assert.equal(await readFile(join(f.rootA, 'same.txt'), 'utf8'), 'a2');
  assert.equal(await readFile(external, 'utf8'), 'e2');
});
