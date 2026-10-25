import { execFile as execFileCallback, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { devNull } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, readlink, realpath, rename, rm, statfs, symlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { AgentToolError } from './errors.js';
import { rebaseWorkspaceCheckpointStore, WorkspaceToolRuntime } from './workspace-tools.js';
import { resolveForkGitRuntime } from './git-runtime.js';

const execFile = promisify(execFileCallback);
const gitArgs = ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${devNull}`];

/** A linked worktree .git file must never survive in an independent copy. */
async function isolateGitMetadata(source: string, destination: string): Promise<void> {
  const seed = `${destination}.git-seed-${randomUUID()}`;
  try {
    const git = await resolveForkGitRuntime();
    const gitOptions = () => ({ env: git.env, windowsHide: true, maxBuffer: 1024 * 1024 });
    const hasHead = await execFile(git.binary, [...gitArgs, '-C', source, 'rev-parse', '--verify', 'HEAD'], gitOptions()).then(() => true, () => false);
    await execFile(git.binary, [...gitArgs, 'clone', '--no-local', '--no-checkout', '--quiet', '--', source, seed], gitOptions());
    await execFile(git.binary, [...gitArgs, '-C', seed, 'remote', 'remove', 'origin'], gitOptions());
    if (hasHead) await execFile(git.binary, [...gitArgs, '-C', seed, 'reset', '--mixed', 'HEAD'], gitOptions());
    // Preserve the staged/unstaged split without copying an index that refers
    // to objects outside the new repository. Binary patches are streamed.
    await new Promise<void>((resolvePromise, reject) => {
      const reader = spawn(git.binary, [...gitArgs, '-C', source, 'diff', '--cached', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', ...(hasHead ? ['HEAD'] : [])],
        { ...gitOptions(), stdio: ['ignore', 'pipe', 'pipe'] });
      const writer = spawn(git.binary, [...gitArgs, '-C', seed, 'apply', '--cached', '--binary', '--allow-empty', '-'],
        { ...gitOptions(), stdio: ['pipe', 'ignore', 'pipe'] });
      let readDone = false, writeDone = false, failed = false;
      const fail = () => { if (failed) return; failed = true; reader.kill(); writer.kill(); reject(new AgentToolError('FORK_GIT_FAILED', 'Could not preserve the branch Git index')); };
      reader.once('error', fail); writer.once('error', fail);
      reader.stdout.on('error', fail); writer.stdin.on('error', fail);
      reader.stderr.resume(); writer.stderr.resume(); reader.stdout.pipe(writer.stdin);
      reader.once('close', code => { if (code !== 0) return fail(); readDone = true; if (writeDone && !failed) resolvePromise(); });
      writer.once('close', code => { if (code !== 0) return fail(); writeDone = true; if (readDone && !failed) resolvePromise(); });
    });
    await rename(join(seed, '.git'), join(destination, '.git'));
  } catch (error) {
    throw new AgentToolError('FORK_GIT_FAILED', `Cannot create independent Git metadata: ${error instanceof Error ? error.message : 'Git unavailable'}`);
  } finally { await rm(seed, { recursive: true, force: true }); }
}

const inside = (root: string, path: string) => { const delta = relative(root, path); return !delta || delta !== '..' && !delta.startsWith(`..${sep}`) && !isAbsolute(delta); };
const fingerprint = (s: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number; mode: number }) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.mode}`;

/** Independent bytes, bounded buffers and CAS against edits while copying. No hard links. */
export async function copyIsolatedWorkspaceFile(source: string, target: string, reserveBytes = 128 * 1024 * 1024): Promise<void> {
  const before = await lstat(source);
  if (!before.isFile() || before.isSymbolicLink()) throw new AgentToolError('INVALID_PATH', 'Fork source must be an ordinary file');
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const parent = await realpath(dirname(source));
  const space = await statfs(dirname(target));
  if (space.bavail * space.bsize < before.size + reserveBytes) throw new AgentToolError('FORK_NO_SPACE', 'Not enough disk space for an independent branch');
  const input = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let output: Awaited<ReturnType<typeof open>>;
  try { output = await open(target, 'wx', before.mode & 0o777); } catch (error) { await input.close(); throw error; }
  let complete = false;
  try {
    if (fingerprint(await input.stat()) !== fingerprint(before)) throw new AgentToolError('FORK_CONFLICT', 'File changed before copying');
    const chunk = Buffer.allocUnsafe(256 * 1024); let size = 0;
    while (true) {
      const { bytesRead } = await input.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > before.size) throw new AgentToolError('FORK_CONFLICT', 'File grew while copying');
      await output.writeFile(chunk.subarray(0, bytesRead));
    }
    if (size !== before.size || fingerprint(await input.stat()) !== fingerprint(before)
      || fingerprint(await lstat(source)) !== fingerprint(before) || await realpath(dirname(source)) !== parent) throw new AgentToolError('FORK_CONFLICT', 'File changed while copying');
    await output.chmod(before.mode & 0o777); await output.sync(); complete = true;
  } finally { await input.close(); await output.close(); if (!complete) await rm(target, { force: true }); }
}

export interface ForkWorkspaceGroup { readonly workspaceRoot: string; readonly inheritedCheckpointIds: readonly string[]; readonly checkpointIds: readonly string[]; readonly targets?: readonly { checkpointId: string; side: "before" | "after" }[] }
export interface ForkWorkspaceResult {
  readonly workspaceRoot: string;
  readonly filesCopied: number;
  readonly workspaces: readonly { readonly sourceWorkspaceRoot: string; readonly workspaceRoot: string }[];
  readonly resourceMappings: readonly { readonly sourcePath: string; readonly targetPath: string }[];
}

const FORK_LAYOUT = '.nextmux-fork-layout.json';
export type WorkspaceForkLayout = Pick<ForkWorkspaceResult, 'workspaceRoot' | 'workspaces'>;

/** Only host-owned, relative paths in a completed private branch confer access. */
export async function readWorkspaceForkLayout(container: string): Promise<WorkspaceForkLayout | undefined> {
  const root = await realpath(container);
  const path = join(root, FORK_LAYOUT);
  let metadata;
  try { metadata = await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 256 * 1024) throw new AgentToolError('INVALID_FORK_LAYOUT', 'Private branch layout is invalid');
  const value = JSON.parse(await readFile(path, 'utf8')) as { version?: unknown; phase?: unknown; primary?: unknown; workspaces?: unknown };
  if (value.version !== 1 || value.phase !== 'complete' || !Array.isArray(value.workspaces) || !value.workspaces.length || value.workspaces.length > 33) {
    throw new AgentToolError('INVALID_FORK_LAYOUT', 'Private branch is incomplete or its layout is invalid');
  }
  const resolveRoot = async (candidate: unknown): Promise<string> => {
    if (typeof candidate !== 'string' || !candidate || isAbsolute(candidate) || /[\0\r\n]/.test(candidate)) throw new AgentToolError('INVALID_FORK_LAYOUT', 'Invalid private workspace path');
    const lexical = resolve(root, candidate), actual = await realpath(lexical);
    if (lexical === root || !inside(root, lexical) || actual !== lexical || !inside(root, actual) || !(await lstat(actual)).isDirectory()) throw new AgentToolError('INVALID_FORK_LAYOUT', 'Private workspace escapes its container');
    return actual;
  };
  const workspaces: Array<{ sourceWorkspaceRoot: string; workspaceRoot: string }> = [];
  for (const raw of value.workspaces) {
    if (!raw || typeof raw !== 'object' || typeof raw.sourceWorkspaceRoot !== 'string'
      || raw.sourceWorkspaceRoot && (!isAbsolute(raw.sourceWorkspaceRoot) || /[\0\r\n]/.test(raw.sourceWorkspaceRoot))) throw new AgentToolError('INVALID_FORK_LAYOUT', 'Invalid private workspace source');
    workspaces.push({ sourceWorkspaceRoot: raw.sourceWorkspaceRoot, workspaceRoot: await resolveRoot(raw.path) });
  }
  const workspaceRoot = await resolveRoot(value.primary);
  if (new Set(workspaces.map(item => item.workspaceRoot)).size !== workspaces.length || !workspaces.some(item => item.workspaceRoot === workspaceRoot)) throw new AgentToolError('INVALID_FORK_LAYOUT', 'Private primary workspace is missing');
  return { workspaceRoot, workspaces };
}

async function writeForkLayout(container: string, value: unknown): Promise<void> {
  const temporary = join(container, `${FORK_LAYOUT}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
  try { await rename(temporary, join(container, FORK_LAYOUT)); }
  finally { await rm(temporary, { force: true }); }
}

/** Host authorizes all source roots first. Only private copied stores are ever rebased/restored. */
export async function forkWorkspaceGroups(options: {
  readonly groups: readonly ForkWorkspaceGroup[];
  readonly primaryWorkspaceRoot: string;
  readonly targetDirectory: string;
  readonly checkpointRootForWorkspace: (root: string) => string;
}): Promise<ForkWorkspaceResult> {
  if (!options.groups.length || options.groups.length > 32) throw new AgentToolError('INVALID_WORKSPACE', 'Branch requires one to 32 workspace roots');
  const roots = await Promise.all(options.groups.map(async group => ({ ...group, workspaceRoot: await realpath(group.workspaceRoot) })));
  if (new Set(roots.map(g => g.workspaceRoot)).size !== roots.length) throw new AgentToolError('INVALID_WORKSPACE', 'Duplicate branch workspace');
  const primary = await realpath(options.primaryWorkspaceRoot);
  if (!roots.some(g => g.workspaceRoot === primary)) throw new AgentToolError('INVALID_WORKSPACE', 'Primary workspace is not bound to this branch');
  const target = resolve(options.targetDirectory), temporary = `${target}.fork-${randomUUID()}`;
  if (roots.some(g => inside(g.workspaceRoot, target))) throw new AgentToolError('INVALID_WORKSPACE', 'Branch cannot be placed inside its source');
  try { await lstat(target); throw new AgentToolError('FORK_CONFLICT', 'Target branch already exists'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const sorted = [...roots].sort((a, b) => a.workspaceRoot.length - b.workspaceRoot.length);
  const mappings = new Map<string, string>();
  const volumes = new Map<string, string[]>();
  for (const group of sorted) {
    const volume = parse(group.workspaceRoot).root;
    volumes.set(volume, [...(volumes.get(volume) ?? []), group.workspaceRoot]);
  }
  let volumeIndex = 0;
  for (const paths of volumes.values()) {
    // Keep relative references between bound roots valid. On different drives
    // there is no portable relative path; retain separate volume namespaces.
    let common = dirname(paths[0]);
    while (!paths.every(path => inside(common, path))) common = dirname(common);
    const base = join(target, 'roots', `${volumeIndex++}`);
    for (const path of paths) mappings.set(path, join(base, relative(common, path)));
  }
  const locate = (source: string): string | undefined => {
    const root = [...mappings.keys()].sort((a, b) => b.length - a.length).find(root => inside(root, source));
    return root ? join(mappings.get(root)!, relative(root, source)) : undefined;
  };
  const staged = (destination: string) => join(temporary, relative(target, destination));
  const resourceMappings = new Map<string, string>();
  const stores: Array<{ source: string; target: string; temporary: string; ids: readonly string[]; targets?: ForkWorkspaceGroup["targets"] }> = [];
  const committedStores: string[] = [];
  let committed = false, filesCopied = 0, visited = 0;
  const links: Array<{ source: string; destination: string }> = [];
  const copyTree = async (source: string, destination: string): Promise<void> => {
    await mkdir(destination, { recursive: true, mode: 0o700 });
    const queue = [{ source, destination }];
    while (queue.length) {
      const current = queue.pop()!;
      const before = await lstat(current.source);
      if (!before.isDirectory() || before.isSymbolicLink()) throw new AgentToolError('INVALID_PATH', 'Workspace folder changed during branch creation');
      for (const entry of await readdir(current.source, { withFileTypes: true })) {
        if (++visited > 100_000) throw new AgentToolError('FORK_TOO_LARGE', 'Workspace contains too many files to branch safely');
        const from = join(current.source, entry.name), to = join(current.destination, entry.name);
        if (entry.name === '.git') {
          if (current.source === source || entry.isDirectory()) {
            await isolateGitMetadata(current.source, current.destination);
          } else {
            await isolateGitMetadata(current.source, current.destination).catch(() => undefined);
          }
          continue;
        }
        if (entry.isDirectory()) { await mkdir(to, { mode: 0o700 }); queue.push({ source: from, destination: to }); }
        else if (entry.isFile()) { await copyIsolatedWorkspaceFile(from, to); filesCopied++; }
        else if (entry.isSymbolicLink()) links.push({ source: from, destination: to });
        else throw new AgentToolError('INVALID_PATH', 'Workspace includes a non-file resource that cannot be isolated');
      }
      if (fingerprint(await lstat(current.source)) !== fingerprint(before)) throw new AgentToolError('FORK_CONFLICT', 'Workspace folder changed while copying');
    }
  };
  try {
    await mkdir(temporary, { recursive: true, mode: 0o700 });
    for (const group of sorted) {
      const destination = mappings.get(group.workspaceRoot)!;
      if (!sorted.some(other => other.workspaceRoot !== group.workspaceRoot && inside(other.workspaceRoot, group.workspaceRoot))) await copyTree(group.workspaceRoot, staged(destination));
      const targetStore = options.checkpointRootForWorkspace(destination), tempStore = `${targetStore}.fork-${randomUUID()}`;
      try { await lstat(targetStore); throw new AgentToolError('FORK_CONFLICT', 'Branch checkpoint store already exists'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      stores.push({ source: group.workspaceRoot, target: targetStore, temporary: tempStore, ids: group.checkpointIds, targets: group.targets });
      await mkdir(tempStore, { recursive: true, mode: 0o700 });
      const sourceStore = options.checkpointRootForWorkspace(group.workspaceRoot);
      // The store is shared by conversations using this root. Copy only
      // versions reachable from this branch, plus the chain being undone.
      const reachable = new Set([...group.inheritedCheckpointIds, ...group.checkpointIds]);
      if (reachable.size > 100_000) throw new AgentToolError('INVALID_CHECKPOINT', 'Too many inherited checkpoints');
      for (const checkpointId of reachable) {
        if (!/^[A-Za-z0-9-]{16,200}$/.test(checkpointId)) throw new AgentToolError('INVALID_CHECKPOINT', 'Invalid inherited checkpoint');
        const sourceDir = join(sourceStore, checkpointId);
        const metadata = await lstat(sourceDir);
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new AgentToolError('INVALID_CHECKPOINT', 'Checkpoint must be an ordinary directory');
        const manifest = JSON.parse(await readFile(join(sourceDir, 'manifest.json'), 'utf8')) as {
          id: string; version: number; workspaceRoot: string; externalTarget?: string;
        };
        if (manifest.id !== checkpointId || manifest.version !== 1 || manifest.workspaceRoot !== group.workspaceRoot) throw new AgentToolError('INVALID_CHECKPOINT', 'Checkpoint does not belong to this source workspace');
        await copyTree(sourceDir, join(tempStore, checkpointId));
        if (manifest.externalTarget && !resourceMappings.has(manifest.externalTarget)) {
          const path = manifest.externalTarget;
          if (!isAbsolute(path) || path.includes('\0')) throw new AgentToolError('INVALID_CHECKPOINT', 'Invalid external checkpoint target');
          const destination = locate(path) ?? join(target, 'external', createHash('sha256').update(path).digest('hex').slice(0, 24), basename(path));
          resourceMappings.set(path, destination);
          if (!locate(path)) {
            try { await copyIsolatedWorkspaceFile(path, staged(destination)); filesCopied++; }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await mkdir(dirname(staged(destination)), { recursive: true, mode: 0o700 }); }
          }
        }
      }
    }
    for (const link of links) {
      const sourceTarget = resolve(dirname(link.source), await readlink(link.source));
      const mapped = locate(sourceTarget) ?? resourceMappings.get(sourceTarget);
      if (!mapped) throw new AgentToolError('FORK_EXTERNAL_LINK', 'A symbolic link points outside the captured branch; bind its target directory first');
      const targetInfo = await lstat(sourceTarget).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
      await symlink(relative(dirname(link.destination), staged(mapped)), link.destination, targetInfo?.isDirectory() ? 'dir' : 'file');
    }
    await writeForkLayout(temporary, { version: 1, phase: 'preparing' });
    await rename(temporary, target); committed = true;
    for (const store of stores) { await rename(store.temporary, store.target); committedStores.push(store.target); }
    for (const store of stores) await rebaseWorkspaceCheckpointStore({ checkpointRoot: store.target, sourceWorkspaceRoot: store.source,
      targetWorkspaceRoot: mappings.get(store.source)!, mapExternalTarget: async path => {
        const mapped = resourceMappings.get(path); if (!mapped) throw new AgentToolError('INVALID_CHECKPOINT', 'Missing external branch mapping'); return mapped;
      } });
    const runtimes: Array<{ runtime: WorkspaceToolRuntime; checkpointIds: readonly string[]; targets?: ForkWorkspaceGroup["targets"] }> = [];
    try {
      for (const store of stores) if (store.ids.length) runtimes.push({ checkpointIds: store.ids, targets: store.targets, runtime: await WorkspaceToolRuntime.create({
        workspaceRoot: mappings.get(store.source)!, checkpointRoot: store.target, permissionMode: 'full_access' }) });
      await WorkspaceToolRuntime.restoreCheckpointGroups(runtimes);
    } finally { await Promise.allSettled(runtimes.map(item => item.runtime.dispose())); }
    const workspaces = [...mappings].map(([sourceWorkspaceRoot, workspaceRoot]) => ({ sourceWorkspaceRoot, workspaceRoot }));
    if ([...resourceMappings.values()].some(path => inside(join(target, 'external'), path))) workspaces.push({ sourceWorkspaceRoot: '', workspaceRoot: join(target, 'external') });
    await writeForkLayout(target, { version: 1, phase: 'complete', primary: relative(target, mappings.get(primary)!),
      workspaces: workspaces.map(item => ({ sourceWorkspaceRoot: item.sourceWorkspaceRoot, path: relative(target, item.workspaceRoot) })) });
    return { workspaceRoot: mappings.get(primary)!, filesCopied, workspaces,
      resourceMappings: [...resourceMappings].map(([sourcePath, targetPath]) => ({ sourcePath, targetPath })) };
  } catch (error) {
    await Promise.allSettled([rm(temporary, { recursive: true, force: true }), ...(committed ? [rm(target, { recursive: true, force: true })] : []),
      ...stores.map(store => rm(store.temporary, { recursive: true, force: true })), ...committedStores.map(path => rm(path, { recursive: true, force: true }))]);
    throw error;
  }
}
