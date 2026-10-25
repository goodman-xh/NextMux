import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { devNull } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { resolveForkGitRuntime } from './git-runtime.js';
import { AgentToolError, AgentToolRegistry } from './registry.js';
import { WorkspaceToolRuntime, type AgentCheckpointDiff, type WorkspaceTerminalProfile } from './workspace-tools.js';
import { captureWorkspaceSnapshot, loadCommandSnapshot, persistCommandSnapshot, snapshotPathExcluded, inspectSnapshotFile, writeSnapshotFile, snapshotFileSize, SNAPSHOT_MAX_FILES, SNAPSHOT_MAX_FILE_BYTES, SNAPSHOT_MAX_BYTES, type WorkspaceSnapshot } from './workspace-snapshot.js';
import type { AgentPermissionMode } from './types.js';

const execFileAsync = promisify(execFile);
const sourceLocks = new Map<string, Promise<void>>();
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
function inside(root: string, path: string): boolean {
  const delta = relative(root, path);
  return delta === '' || delta !== '..' && !delta.startsWith(`..${sep}`) && !isAbsolute(delta);
}
function safeId(id: string): string {
  if (!/^child-[a-f0-9-]{36}$/.test(id)) throw new AgentToolError('INVALID_CHILD_WORKSPACE', 'Invalid child workspace identifier');
  return id;
}
async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(value), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
async function lockSource<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = sourceLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>(done => { release = done; });
  sourceLocks.set(key, next);
  await previous;
  try { return await action(); } finally { release(); if (sourceLocks.get(key) === next) sourceLocks.delete(key); }
}
async function gitRaw(cwd: string, args: string[], maxBuffer = 1024 * 1024): Promise<string> {
  const runtime = await resolveForkGitRuntime().catch(() => {
    const cleanEnv: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
    return { binary: 'git', env: cleanEnv, bundled: false };
  });
  const result = await execFileAsync(runtime.binary, ['-c', `core.hooksPath=${devNull}`, '-c', 'core.fsmonitor=false', ...args], {
    cwd, windowsHide: true, timeout: 30_000, maxBuffer,
    env: { ...runtime.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
  return result.stdout;
}
async function git(cwd: string, args: string[]): Promise<string> {
  return (await gitRaw(cwd, args)).trim();
}

export interface DelegatedWorkspacePrepareInput {
  readonly childRunId: string;
  readonly parentRunId: string;
  readonly workspaceRoot: string;
  readonly permissionMode: AgentPermissionMode;
  readonly conversationId?: string;
  readonly rootRunId?: string;
  readonly signal?: AbortSignal;
  /** Reopen the host-verified original child checkout, retaining its baseline and edits. */
  readonly resume?: true;
  /** Called after the final child root is known, before opening its checkpoint runtime. */
  readonly beforeRuntimeCreate?: (workspaceRoot: string) => Promise<void>;
}
export interface DelegatedWorkspaceReview {
  readonly childRunId: string;
  readonly workspaceRoot: string;
  readonly sourceWorkspaceRoot: string;
  readonly kind: 'git_worktree' | 'snapshot';
  readonly reviewId: string;
  readonly changes: readonly AgentCheckpointDiff[];
  readonly conflicts: readonly string[];
  readonly excludedPaths: readonly string[];
  readonly checkpointCoverage?: { readonly complete: boolean; readonly warnings: readonly string[] };
  readonly requiresMerge: boolean;
  readonly merged?: true;
  readonly interruptedMerge?: { readonly reviewId: string };
}
export interface PreparedDelegatedWorkspace {
  readonly workspaceRoot: string;
  readonly tools: AgentToolRegistry;
  readonly review: () => Promise<DelegatedWorkspaceReview>;
  readonly dispose: () => Promise<void>;
  readonly snapshotWarning?: string;
}
export interface DelegatedWorkspaceMergeResult {
  readonly childRunId: string;
  readonly merged: true;
  readonly changedPaths: readonly string[];
  readonly checkpointIds: readonly string[];
  readonly verificationInvalidated: true;
}
export interface DelegatedWorkspaceRecoveryResult {
  readonly childRunId: string;
  readonly recovered: true;
  readonly changedPaths: readonly string[];
  readonly restoredCheckpointIds: readonly string[];
  readonly verificationInvalidated: true;
}
export interface DelegatedWorkspaceManagerOptions {
  /** Host-owned directory outside project sources. Never supplied by the model. */
  readonly storageRoot: string;
  readonly checkpointRootForWorkspace: (workspaceRoot: string) => string;
  readonly terminalProfile?: WorkspaceTerminalProfile;
}
interface WorkspaceRecord {
  version: 1;
  childRunId: string;
  parentRunId: string;
  sourceWorkspaceRoot: string;
  workspaceRoot: string;
  repositoryRoot?: string;
  checkoutRoot: string;
  kind: 'git_worktree' | 'snapshot';
  state: 'running' | 'reviewable' | 'merging' | 'merged';
  ownerPid: number;
  conversationId?: string;
  rootRunId?: string;
  trackedPaths?: readonly string[];
  createdAt: string;
  mergedReviewId?: string;
  mergeResult?: DelegatedWorkspaceMergeResult;
  mergeRunId?: string;
  pendingReviewId?: string;
}

/** Git-backed isolated edits, with snapshot fallback when Git is absent/uninitialized.
 * This is change isolation, not an OS process or network sandbox. */
export class DelegatedWorkspaceManager {
  readonly #options: DelegatedWorkspaceManagerOptions;
  constructor(options: DelegatedWorkspaceManagerOptions) { this.#options = options; }
  #directory(id: string): string { return join(resolve(this.#options.storageRoot), safeId(id)); }

  async #tracked(root: string): Promise<string[]> {
    try {
      await git(root, ['rev-parse', '--show-toplevel']);
      const stdout = await gitRaw(root, ['ls-files', '-z', '--cached'], 8 * 1024 * 1024);
      return [...new Set(stdout.split('\0').filter(Boolean))];
    } catch {
      return [];
    }
  }

  async #capture(root: string, signal?: AbortSignal, inheritedTracked: readonly string[] = [], objectDirectory?: string): Promise<WorkspaceSnapshot> {
    root = await realpath(root);
    const snapshot = await captureWorkspaceSnapshot(root, resolve(this.#options.storageRoot), undefined, { objectDirectory }, signal);
    // A worktree uses a .git FILE; the generic command snapshot only skips .git directories.
    snapshot.files.delete('.git');
    snapshot.excludedPaths.add('.git');
    const warnings = new Set(snapshot.warnings);
    // Tracked source takes precedence over generated-directory/ignore rules.
    // Otherwise a dirty tracked dist/foo.js could silently retain its old HEAD.
    const tracked = new Set([...inheritedTracked, ...await this.#tracked(root)]);
    let bytes = [...snapshot.files.values()].reduce((sum, file) => sum + snapshotFileSize(file), 0);
    for (const path of tracked) {
      if (signal?.aborted) throw new AgentToolError('CANCELLED', 'Delegation cancelled');
      let target: string;
      try {
        target = await this.#safeTarget(root, path, true);
      } catch (error) {
        if (error instanceof AgentToolError && error.code === 'MERGE_CONFLICT') {
          snapshot.excludedPaths.add(path);
          warnings.add('Some tracked files were not captured within snapshot coverage');
          continue;
        }
        throw error;
      }
      const parts = path.split('/');
      if (snapshot.files.has(path)) continue;
      let metadata;
      try { metadata = await lstat(target); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      if (!metadata.isFile() || metadata.isSymbolicLink() || snapshot.files.size >= SNAPSHOT_MAX_FILES
        || metadata.size > SNAPSHOT_MAX_FILE_BYTES || bytes + metadata.size > SNAPSHOT_MAX_BYTES) {
        snapshot.excludedPaths.add(path);
        warnings.add('Some tracked files were not captured within snapshot coverage');
        continue;
      }
      const file = await inspectSnapshotFile(target, { memory: false, objectDirectory, expectedParent: dirname(target), signal });
      bytes += snapshotFileSize(file);
      snapshot.files.set(path, file);
      snapshot.excludedPaths.delete(path);
      for (let i = 1; i < parts.length; i++) snapshot.excludedPaths.delete(`${parts.slice(0, i).join('/')}/`);
    }
    return { ...snapshot, complete: warnings.size === 0, warnings: [...warnings] };
  }

  async prepare(input: DelegatedWorkspacePrepareInput): Promise<PreparedDelegatedWorkspace> {
    if (input.signal?.aborted) throw new AgentToolError('CANCELLED', 'Delegation cancelled');
    const source = await realpath(resolve(input.workspaceRoot));
    const directory = this.#directory(input.childRunId);
    if (input.resume) {
      const record = await this.#load(input.childRunId);
      if (record.sourceWorkspaceRoot !== source || record.parentRunId !== input.parentRunId
        || record.conversationId !== input.conversationId || record.rootRunId !== input.rootRunId) {
        throw new AgentToolError('CHILD_WORKSPACE_OWNER_MISMATCH', 'The original child checkout belongs to another task');
      }
      await input.beforeRuntimeCreate?.(record.workspaceRoot);
      if (input.signal?.aborted) throw new AgentToolError('CANCELLED', 'Delegation cancelled');
      await this.setRunning(input.childRunId);
      try {
        const baseline = (await loadCommandSnapshot(join(directory, 'baseline'), source)).snapshot;
        return await this.#openRuntime(record, input, baseline);
      } catch (error) { await this.setStopped(input.childRunId); throw error; }
    }
    if (inside(source, directory)) throw new AgentToolError('INVALID_CHILD_STORAGE', 'Child workspaces must be stored outside the source project');
    await mkdir(dirname(directory), { recursive: true });
    if (inside(source, await realpath(dirname(directory)))) throw new AgentToolError('INVALID_CHILD_STORAGE', 'Child workspaces must be outside the project');
    await mkdir(directory, { recursive: false });
    let repositoryRoot: string | undefined;
    const checkoutRoot = join(directory, 'workspace');
    let worktreeAdded = false;
    try {
      const objectDirectory = join(directory, 'objects');
      const baseline = await this.#capture(source, input.signal, [], objectDirectory);
      const trackedPaths = await this.#tracked(source);
      try { repositoryRoot = await git(source, ['rev-parse', '--show-toplevel']); await git(source, ['rev-parse', '--verify', 'HEAD']); }
      catch { repositoryRoot = undefined; }
      // A partial copy must not silently substitute stale HEAD content for
      // uncaptured dirty source files. Isolate only the verified captured set.
      if (!baseline.complete) repositoryRoot = undefined;
      const workspaceRoot = repositoryRoot ? join(checkoutRoot, relative(repositoryRoot, source)) : checkoutRoot;
      if (repositoryRoot) {
        await git(repositoryRoot, ['worktree', 'add', '--detach', checkoutRoot, 'HEAD']);
        worktreeAdded = true;
        await mkdir(workspaceRoot, { recursive: true });
        const checkedOut = await this.#capture(workspaceRoot, input.signal, trackedPaths, objectDirectory);
        // Reflect source deletions as well as edits; never touch the source index/branch.
        for (const path of checkedOut.files.keys()) if (!baseline.files.has(path) && !snapshotPathExcluded(baseline, path)) {
          await rm(join(workspaceRoot, path));
        }
      } else await mkdir(workspaceRoot, { recursive: true });
      for (const [path, file] of baseline.files) {
        if (input.signal?.aborted) throw new AgentToolError('CANCELLED', 'Delegation cancelled');
        const target = await this.#safeTarget(workspaceRoot, path);
        await mkdir(dirname(target), { recursive: true });
        await writeSnapshotFile(file, target, file.mode, { beforeCommit: async () => {
          if (input.signal?.aborted) throw new AgentToolError('CANCELLED', 'Delegation cancelled');
        } });
      }
      await persistCommandSnapshot(join(directory, 'baseline'), baseline, { workspaceRoot: source, runId: input.childRunId, generation: randomUUID() });
      const record: WorkspaceRecord = {
        version: 1, childRunId: input.childRunId, parentRunId: input.parentRunId,
        sourceWorkspaceRoot: source, workspaceRoot: await realpath(workspaceRoot), checkoutRoot,
        ...(repositoryRoot ? { repositoryRoot } : {}), kind: repositoryRoot ? 'git_worktree' : 'snapshot',
        state: 'running', ownerPid: process.pid, conversationId: input.conversationId, rootRunId: input.rootRunId, createdAt: new Date().toISOString(),
        trackedPaths,
      };
      await atomicJson(join(directory, 'workspace.json'), record);
      await input.beforeRuntimeCreate?.(record.workspaceRoot);
      return await this.#openRuntime(record, input, baseline);
    } catch (error) {
      if (worktreeAdded && repositoryRoot) await git(repositoryRoot, ['worktree', 'remove', '--force', checkoutRoot]).catch(() => undefined);
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async #openRuntime(record: WorkspaceRecord, input: DelegatedWorkspacePrepareInput, baseline: WorkspaceSnapshot): Promise<PreparedDelegatedWorkspace> {
    if (input.signal?.aborted) throw new AgentToolError('CANCELLED', 'Delegation cancelled');
    const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: record.workspaceRoot,
      checkpointRoot: this.#options.checkpointRootForWorkspace(record.workspaceRoot),
      permissionMode: input.permissionMode, terminalProfile: this.#options.terminalProfile });
    if (input.signal?.aborted) {
      await runtime.dispose();
      throw new AgentToolError('CANCELLED', 'Delegation cancelled');
    }
    const tools = new AgentToolRegistry();
    runtime.registerTools(tools);
    let disposed = false;
    const dispose = async (): Promise<void> => { if (!disposed) { await runtime.dispose(); disposed = true; } };
    return { workspaceRoot: record.workspaceRoot, tools, dispose,
      ...(!baseline.complete ? { snapshotWarning: `Partial workspace snapshot: ${baseline.warnings.join('; ')}. Uncaptured paths are unavailable and cannot be merged: ${[...baseline.excludedPaths].slice(0, 40).join(', ')}` } : {}),
      review: async () => {
        try { await dispose(); } finally { await this.setStopped(input.childRunId); }
        return this.review(input.childRunId);
    } };
  }

  async #load(id: string): Promise<WorkspaceRecord> {
    const directory = await realpath(this.#directory(id));
    const value = JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8')) as WorkspaceRecord;
    if (value.version !== 1 || value.childRunId !== id || !['running', 'reviewable', 'merging', 'merged'].includes(value.state)
      || !['git_worktree', 'snapshot'].includes(value.kind) || !Number.isSafeInteger(value.ownerPid) || value.ownerPid <= 0
      || !inside(directory, value.workspaceRoot)
      || await realpath(value.workspaceRoot) !== value.workspaceRoot || !isAbsolute(value.sourceWorkspaceRoot)) {
      throw new AgentToolError('INVALID_CHILD_WORKSPACE', 'Child workspace metadata is invalid');
    }
    if (value.state === 'running' && value.ownerPid !== process.pid) {
      let alive = true;
      try { process.kill(value.ownerPid, 0); } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
      if (!alive) { value.state = 'reviewable'; await atomicJson(join(directory, 'workspace.json'), value); }
    }
    return value;
  }

  /** Resolve only host-bound ownership, before exposing a child path or result. */
  async ownedWorkspace(id: string, owner: { conversationId: string; workspaceRoot?: string; parentRunId?: string; rootRunId?: string }): Promise<{ workspaceRoot: string; sourceWorkspaceRoot: string; state: WorkspaceRecord['state'] }> {
    const record = await this.#load(id);
    if (!owner.conversationId || record.conversationId !== owner.conversationId
      || owner.workspaceRoot && ![record.workspaceRoot, record.sourceWorkspaceRoot].includes(await realpath(owner.workspaceRoot))
      || owner.parentRunId && record.parentRunId !== owner.parentRunId
      || owner.rootRunId && record.rootRunId !== owner.rootRunId) {
      throw new AgentToolError('CHILD_WORKSPACE_OWNER_MISMATCH', 'Child workspace belongs to another task or conversation');
    }
    return { workspaceRoot: record.workspaceRoot, sourceWorkspaceRoot: record.sourceWorkspaceRoot, state: record.state };
  }

  async setRunning(id: string): Promise<void> {
    const initial = await this.#load(id);
    await lockSource(initial.sourceWorkspaceRoot, async () => {
      const record = await this.#load(id);
      if (record.state !== 'reviewable') throw new AgentToolError('CHILD_WORKSPACE_NOT_RESUMABLE', 'Child workspace is running, merged, or requires merge recovery');
      record.state = 'running'; record.ownerPid = process.pid;
      await atomicJson(join(this.#directory(id), 'workspace.json'), record);
    });
  }

  async setStopped(id: string): Promise<void> {
    const initial = await this.#load(id);
    await lockSource(initial.sourceWorkspaceRoot, async () => {
      const record = await this.#load(id);
      if (record.state === 'running') { record.state = 'reviewable'; await atomicJson(join(this.#directory(id), 'workspace.json'), record); }
    });
  }

  async #safeTarget(root: string, path: string, allowLeafSymlink = false): Promise<string> {
    const parts = path.replaceAll('\\', '/').split('/');
    if (!parts.length || parts.some(part => !part || part === '..' || part === '.' || part === '.git' || part === '.nextmux' || part.includes(':') || /[\0\r\n]/.test(part))) {
      throw new AgentToolError('INVALID_PATH', 'Unsafe child result path');
    }
    let target = root;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!;
      target = join(target, part);
      if (allowLeafSymlink && index === parts.length - 1) continue;
      try { if ((await lstat(target)).isSymbolicLink()) throw new AgentToolError('MERGE_CONFLICT', `Symbolic link blocks merge: ${path}`); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    if (!inside(root, target)) throw new AgentToolError('INVALID_PATH', 'Child result is outside its project');
    return target;
  }

  async review(id: string): Promise<DelegatedWorkspaceReview> {
    const record = await this.#load(id);
    if (record.state === 'running') throw new AgentToolError('CHILD_STILL_RUNNING', 'Wait for the child to stop before reviewing its changes');
    const directory = this.#directory(id);
    const { snapshot: baseline } = await loadCommandSnapshot(join(directory, 'baseline'), record.sourceWorkspaceRoot);
    const after = await this.#capture(record.workspaceRoot, undefined, record.trackedPaths, join(directory, "objects"));
    const paths = [...new Set([...baseline.files.keys(), ...after.files.keys()])].sort();
    const changed = paths.filter(path => !snapshotPathExcluded(baseline, path) && !snapshotPathExcluded(after, path)
      && (baseline.files.get(path)?.sha256 !== after.files.get(path)?.sha256
        || (baseline.files.get(path)?.mode ?? 0) % 512 !== (after.files.get(path)?.mode ?? 0) % 512));
    const reviewId = hash(JSON.stringify(changed.map(path => [path, baseline.files.get(path)?.sha256 ?? null, after.files.get(path)?.sha256 ?? null, after.files.get(path)?.mode ?? null])));
    const checkpointRoot = this.#options.checkpointRootForWorkspace(record.workspaceRoot);
    const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: record.workspaceRoot, checkpointRoot, permissionMode: 'read_only' });
    const changes: AgentCheckpointDiff[] = [];
    const conflicts: string[] = [];
    try {
      for (const path of changed) {
        const before = baseline.files.get(path);
        const output = after.files.get(path);
        const checkpointId = `review-${hash(`${reviewId}:${path}`).slice(0, 48)}`;
        const entry = join(checkpointRoot, checkpointId);
        try {
          await mkdir(entry, { recursive: true });
          if (before) await writeSnapshotFile(before, join(entry, 'before.bin'));
          if (output) await writeSnapshotFile(output, join(entry, 'after.bin'));
          await atomicJson(join(entry, 'manifest.json'), {
            version: 1, id: checkpointId, workspaceRoot: record.workspaceRoot, relativePath: path,
            existed: Boolean(before), beforeSha256: before?.sha256 ?? null, afterSha256: output?.sha256 ?? null,
            beforeMode: before?.mode ?? null, afterMode: output?.mode ?? null, createdAt: record.createdAt,
          });
          changes.push(await runtime.getCheckpointDiff(checkpointId));
        } finally {
          await rm(entry, { recursive: true, force: true }).catch(() => undefined);
        }
        try {
          const target = await this.#safeTarget(record.sourceWorkspaceRoot, path);
          let current;
          try { current = await inspectSnapshotFile(target, { memory: false }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          if ((current?.sha256 ?? null) !== (before?.sha256 ?? null)
            || current && before && (current.mode & 0o777) !== (before.mode & 0o777)) conflicts.push(path);
        } catch { conflicts.push(path); }
      }
    } finally { await runtime.dispose(); }
    return {
      childRunId: id, workspaceRoot: record.workspaceRoot, sourceWorkspaceRoot: record.sourceWorkspaceRoot,
      kind: record.kind, reviewId, changes, conflicts: record.state === 'merged' ? [] : conflicts,
      excludedPaths: [...new Set([...baseline.excludedPaths, ...after.excludedPaths])],
      checkpointCoverage: { complete: baseline.complete && after.complete, warnings: [...new Set([...baseline.warnings, ...after.warnings])] },
      requiresMerge: record.state !== 'merged' && changes.length > 0,
      ...(record.state === 'merged' ? { merged: true } : {}),
      ...(record.state === 'merging' && record.pendingReviewId ? { interruptedMerge: { reviewId: record.pendingReviewId } } : {}),
    };
  }

  /** Explicit integration boundary. Never called automatically by delegation. */
  async merge(id: string, reviewId: string): Promise<DelegatedWorkspaceMergeResult> {
    const initial = await this.#load(id);
    return lockSource(initial.sourceWorkspaceRoot, async () => {
      const record = await this.#load(id);
      if (record.state === 'merged') {
        if (record.mergedReviewId !== reviewId || !record.mergeResult) throw new AgentToolError('STALE_CHILD_REVIEW', 'Child review no longer matches the merged result');
        return record.mergeResult;
      }
      if (record.state === 'merging') throw new AgentToolError('MERGE_RECOVERY_REQUIRED', 'An interrupted merge requires checkpoint review before continuing');
      const review = await this.review(id);
      if (review.reviewId !== reviewId) throw new AgentToolError('STALE_CHILD_REVIEW', 'Child files changed after review; review the latest changes first');
      if (review.conflicts.length) throw new AgentToolError('MERGE_CONFLICT', `Parent files changed: ${review.conflicts.join(', ').slice(0, 1500)}`);
      const directory = this.#directory(id);
      const { snapshot: baseline } = await loadCommandSnapshot(join(directory, 'baseline'), record.sourceWorkspaceRoot);
      const after = await this.#capture(record.workspaceRoot, undefined, record.trackedPaths, join(directory, "objects"));
      const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: record.sourceWorkspaceRoot,
        checkpointRoot: this.#options.checkpointRootForWorkspace(record.sourceWorkspaceRoot), permissionMode: 'workspace_write' });
      try {
        const changes = review.changes.map(change => ({ path: change.path,
          beforeSha256: baseline.files.get(change.path)?.sha256 ?? null,
          beforeMode: baseline.files.get(change.path)?.mode,
          content: after.files.get(change.path) ?? null,
          mode: after.files.get(change.path)?.mode,
        }));
        // Lock the reviewed output bytes: a reopened child cannot swap in unreviewed content.
        const currentReviewId = hash(JSON.stringify(review.changes.map(change => [change.path,
          baseline.files.get(change.path)?.sha256 ?? null, after.files.get(change.path)?.sha256 ?? null,
          after.files.get(change.path)?.mode ?? null])));
        if (currentReviewId !== reviewId) throw new AgentToolError('STALE_CHILD_REVIEW', 'Child result changed during merge preparation');
        record.state = 'merging'; record.mergeRunId = `merge-${randomUUID()}`; record.pendingReviewId = reviewId;
        await atomicJson(join(directory, 'workspace.json'), record);
        let checkpointIds: readonly string[];
        try {
          checkpointIds = await runtime.applyReviewedChanges(changes, { runId: record.mergeRunId, workspaceRoot: record.sourceWorkspaceRoot });
        } catch (error) {
          // The executor compensates ordinary failures before throwing. Only a
          // partial compensation (or process death) needs explicit recovery.
          if (!(error instanceof AgentToolError) || error.code !== 'MERGE_PARTIAL') {
            record.state = 'reviewable'; delete record.mergeRunId; delete record.pendingReviewId;
            await atomicJson(join(directory, 'workspace.json'), record);
          }
          throw error;
        }
        const result: DelegatedWorkspaceMergeResult = { childRunId: id, merged: true,
          changedPaths: changes.map(change => change.path), checkpointIds, verificationInvalidated: true };
        record.state = 'merged'; record.mergedReviewId = reviewId; record.mergeResult = result;
        delete record.mergeRunId; delete record.pendingReviewId;
        await atomicJson(join(directory, 'workspace.json'), record);
        return result;
      } finally { await runtime.dispose(); }
    });
  }

  /** Explicit crash recovery; never overwrite edits made after the interrupted merge. */
  async recoverInterruptedMerge(id: string, reviewId: string): Promise<DelegatedWorkspaceRecoveryResult> {
    const initial = await this.#load(id);
    return lockSource(initial.sourceWorkspaceRoot, async () => {
      const record = await this.#load(id);
      if (record.state !== 'merging' || record.pendingReviewId !== reviewId || !/^merge-[a-f0-9-]{36}$/.test(record.mergeRunId ?? '')) {
        throw new AgentToolError('INVALID_MERGE_RECOVERY', 'Review the interrupted merge before recovering it');
      }
      const checkpointRoot = this.#options.checkpointRootForWorkspace(record.sourceWorkspaceRoot);
      const entries = await readdir(checkpointRoot).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: record.sourceWorkspaceRoot, checkpointRoot, permissionMode: 'workspace_write' });
      const restore: { id: string; path: string }[] = [];
      try {
        for (const checkpointId of entries.filter(entry => entry.startsWith(`${record.mergeRunId}-`)).sort()) {
          const manifestPath = join(checkpointRoot, checkpointId, 'manifest.json');
          let manifest: { workspaceRoot: string; relativePath: string; beforeSha256: string | null; afterSha256: string | null; beforeMode?: number; afterMode?: number };
          try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
          await runtime.getCheckpointDiff(checkpointId); // validates checkpoint ownership
          for (const [file, expected] of [['before.bin', manifest.beforeSha256], ['after.bin', manifest.afterSha256]] as const) {
            if (expected !== null && (await inspectSnapshotFile(join(checkpointRoot, checkpointId, file), { memory: false })).sha256 !== expected) {
              throw new AgentToolError('INVALID_CHECKPOINT', 'Interrupted merge backup is invalid');
            }
          }
          const target = await this.#safeTarget(record.sourceWorkspaceRoot, manifest.relativePath);
          let current: string | null = null;
          try { current = (await inspectSnapshotFile(target, { memory: false })).sha256; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          const mode = current === null ? undefined : (await stat(target)).mode;
          if (current === manifest.beforeSha256 && (current === null || manifest.beforeMode === undefined || (mode! & 0o777) === (manifest.beforeMode & 0o777))) continue;
          if (current !== manifest.afterSha256 || current !== null && manifest.afterMode !== undefined && (mode! & 0o777) !== (manifest.afterMode & 0o777)) {
            throw new AgentToolError('MERGE_RECOVERY_CONFLICT', `File changed after interrupted merge: ${manifest.relativePath}`);
          }
          restore.push({ id: checkpointId, path: manifest.relativePath });
        }
        // Preflight every checkpoint before the existing transactional restore.
        const checkpointIds = restore.map(entry => entry.id).reverse();
        await runtime.restoreCheckpointChain(checkpointIds);
        record.state = 'reviewable'; delete record.mergeRunId; delete record.pendingReviewId;
        await atomicJson(join(this.#directory(id), 'workspace.json'), record);
        return { childRunId: id, recovered: true, changedPaths: restore.map(entry => entry.path), restoredCheckpointIds: checkpointIds, verificationInvalidated: true };
      } finally { await runtime.dispose(); }
    });
  }
}
