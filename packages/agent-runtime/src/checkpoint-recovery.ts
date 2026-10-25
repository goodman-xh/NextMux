import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AgentToolError } from './errors.js';
import { inspectSnapshotFile, writeSnapshotFile, SNAPSHOT_MAX_BYTES, type WorkspaceSnapshotFile } from './workspace-snapshot.js';

export const activeCheckpointRestores = new Set<string>();
export const activeCheckpointGroups = new Set<string>();
const recoveryJobs = new Map<string, Promise<void>>();
export async function writeRecoveryRecord(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
  try { await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}
interface RecoveryFile {
  path: string; externalTarget?: string; sha256: string | null; mode: number | null;
  restoreSha256: string | null; restoreMode?: number | null; attempted: boolean; size?: number;
}
interface RecoveryRecord {
  version: number; workspaceRoot: string; phase: string; files: RecoveryFile[];
  groupJournal?: string; ownerPid?: number; rootIdentity?: string;
  versionDirectories?: string[];
}
interface GroupRecord { version: number; phase: 'prepared' | 'committed'; ownerPid: number; participants: { workspaceRoot: string; directory: string }[]; versionDirectories?: string[] }
const inside = (root: string, path: string) => { const delta = relative(root, path); return !delta || delta !== '..' && !delta.startsWith(`..${sep}`) && !isAbsolute(delta); };
const hashValid = (hash: unknown) => hash === null || typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);
async function state(path: string): Promise<WorkspaceSnapshotFile | undefined> {
  try { return await inspectSnapshotFile(path, { memory: false }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
const matches = (value: WorkspaceSnapshotFile | undefined, hash: string | null, mode?: number | null) => (value?.sha256 ?? null) === hash && (mode == null || value && (value.mode & 0o7777) === (mode & 0o7777));
function processAlive(pid: number | undefined): boolean {
  if (!pid || pid === process.pid) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
async function readRecord(directory: string, workspaceRoot?: string): Promise<RecoveryRecord> {
  if (!/^\.restore-[a-f0-9-]{36}$/.test(basename(directory)) || (await lstat(directory)).isSymbolicLink()) throw new AgentToolError('INVALID_CHECKPOINT', 'Invalid restore recovery directory');
  const data = JSON.parse(await readFile(join(directory, 'recovery.json'), 'utf8')) as RecoveryRecord;
  if (data.version !== 2 || !Array.isArray(data.files) || data.files.length > 100_000 || !isAbsolute(data.workspaceRoot)
    || workspaceRoot && data.workspaceRoot !== workspaceRoot || await realpath(data.workspaceRoot) !== data.workspaceRoot) throw new AgentToolError('INVALID_CHECKPOINT', 'Restore recovery workspace does not match');
  for (const file of data.files) {
    // `size` was added after version 2 was introduced, so old journals remain
    // readable.  New values are bounded by the same aggregate object-store
    // budget and are checked again against the immutable backup below.
    if (file.size !== undefined && (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > SNAPSHOT_MAX_BYTES)) {
      throw new AgentToolError('INVALID_CHECKPOINT', 'Invalid restore recovery file size');
    }
  }
  const info = await lstat(data.workspaceRoot);
  if (data.rootIdentity && data.rootIdentity !== `${info.dev}:${info.ino}`) throw new AgentToolError('ROLLBACK_CONFLICT', 'Restore workspace was replaced after interruption');
  if (processAlive(data.ownerPid)) throw new AgentToolError('PROJECT_BUSY', 'Another process owns an active restore');
  return data;
}
async function checkedTarget(root: string, file: RecoveryFile, checkpointRoot: string): Promise<string> {
  if (!hashValid(file.sha256) || !hashValid(file.restoreSha256) || typeof file.path !== 'string' || file.path.includes('\0')) throw new AgentToolError('INVALID_CHECKPOINT', 'Invalid recovery file metadata');
  const target = file.externalTarget ?? resolve(root, file.path);
  if (!isAbsolute(target) || target.includes('\0') || target !== resolve(target) || !file.externalTarget && !inside(root, target)
    || inside(checkpointRoot, target)) throw new AgentToolError('INVALID_CHECKPOINT', 'Invalid recovery target');
  let ancestor = dirname(target); const missing: string[] = [basename(target)];
  while (true) {
    try { await lstat(ancestor); break; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(ancestor) === ancestor) throw error;
      missing.unshift(basename(ancestor)); ancestor = dirname(ancestor);
    }
  }
  if (join(await realpath(ancestor), ...missing) !== target) throw new AgentToolError('ROLLBACK_CONFLICT', 'Recovery target now points through a different directory');
  return target;
}
export async function finalizeRecordedVersions(directories: readonly string[], committed: boolean): Promise<void> {
  for (const directory of directories) {
    let metadata;
    try { metadata = await lstat(directory); }
    catch (error) { if (!committed && (error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (!/^restore-[a-f0-9-]{36}$/.test(basename(directory)) || !metadata.isDirectory() || metadata.isSymbolicLink()) throw new AgentToolError('INVALID_CHECKPOINT', 'Invalid recorded file version');
    const path = join(directory, 'manifest.json'), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) throw new AgentToolError('INVALID_CHECKPOINT', 'Invalid recorded file version manifest');
    const value = JSON.parse(await readFile(path, 'utf8')) as { id: string; status?: string; inverseCheckpointId?: string };
    if (value.id !== basename(directory) || !['prepared', 'committed'].includes(value.status || '')) throw new AgentToolError('INVALID_CHECKPOINT', 'Recorded file version state is invalid');
    if (committed) await writeRecoveryRecord(path, { ...value, status: 'committed' });
    else if (value.status === 'prepared') await rm(directory, { recursive: true, force: true });
    else throw new AgentToolError('INVALID_CHECKPOINT', 'Cannot discard a committed file version');
    if (value.inverseCheckpointId) {
      if (!/^inverse-[a-f0-9-]{36}$/.test(value.inverseCheckpointId)) throw new AgentToolError('INVALID_CHECKPOINT', 'Invalid inverse file version');
      await rm(join(dirname(directory), value.inverseCheckpointId), { recursive: true, force: true });
    }
  }
}

async function recoverRecords(records: { directory: string; record: RecoveryRecord }[], committed: boolean, beforeCleanup?: () => Promise<void>): Promise<void> {
  if (committed) { await beforeCleanup?.(); for (const item of records) await rm(item.directory, { recursive: true, force: true }); return; }
  const plans: { target: string; file: RecoveryFile; before?: WorkspaceSnapshotFile; directory: string; root: string }[] = [];
  const paths = new Set<string>();
  // Verify every participant before compensating any. Unexpected user edits stay untouched.
  for (const { directory, record } of records) for (const file of record.files) {
    if (!file.attempted) continue;
    const target = await checkedTarget(record.workspaceRoot, file, dirname(directory));
    if (paths.has(target)) throw new AgentToolError('INVALID_CHECKPOINT', 'Recovery participants overlap');
    paths.add(target);
    const current = await state(target);
    if (matches(current, file.sha256, file.mode)) continue;
    if (!matches(current, file.restoreSha256, file.restoreMode)) throw new AgentToolError('ROLLBACK_CONFLICT', `Recovery preserves an external edit: ${target}`);
    const before = file.sha256 ? await inspectSnapshotFile(join(directory, `${file.sha256}.bin`), {
      memory: false, maxBytes: file.size ?? SNAPSHOT_MAX_BYTES,
    }) : undefined;
    if (before && before.sha256 !== file.sha256) throw new AgentToolError('INVALID_CHECKPOINT', 'Recovery original is corrupt');
    if (before && file.size !== undefined && before.size !== file.size) throw new AgentToolError('INVALID_CHECKPOINT', 'Recovery original size is invalid');
    plans.push({ target, file, before, directory, root: record.workspaceRoot });
  }
  for (const plan of plans.reverse()) {
    const verify = async () => {
      await checkedTarget(plan.root, plan.file, dirname(plan.directory));
      if (!matches(await state(plan.target), plan.file.restoreSha256, plan.file.restoreMode)) throw new AgentToolError('ROLLBACK_CONFLICT', 'File changed during crash recovery');
    };
    await verify();
    if (plan.before) await writeSnapshotFile(plan.before, plan.target, plan.file.mode ?? plan.before.mode, { beforeCommit: verify });
    else await unlink(plan.target).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  await beforeCleanup?.();
  for (const item of records) await rm(item.directory, { recursive: true, force: true });
}
async function recoverGroup(journalPath: string, directory: string): Promise<void> {
  if (!/^\.restore-group-[a-f0-9-]{36}\.json$/.test(basename(journalPath)) || !isAbsolute(journalPath)) throw new AgentToolError('INVALID_CHECKPOINT', 'Invalid recovery group journal');
  if (activeCheckpointGroups.has(journalPath)) return;
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as GroupRecord;
  if (journal.version !== 1 || !['prepared', 'committed'].includes(journal.phase) || !Array.isArray(journal.participants)
    || !journal.participants.length || journal.participants.length > 32 || !journal.participants.some(item => item.directory === directory)
    || !journal.participants.some(item => dirname(item.directory) === dirname(journalPath))) throw new AgentToolError('INVALID_CHECKPOINT', 'Invalid recovery group participants');
  if (journal.versionDirectories && (!Array.isArray(journal.versionDirectories) || journal.versionDirectories.length > 100_000
    || journal.versionDirectories.some(path => typeof path !== 'string' || !isAbsolute(path)
      || !journal.participants.some(item => dirname(item.directory) === dirname(path)) || !/^restore-[a-f0-9-]{36}$/.test(basename(path))))) throw new AgentToolError('INVALID_CHECKPOINT', 'Invalid recovery file version membership');
  if (processAlive(journal.ownerPid)) throw new AgentToolError('PROJECT_BUSY', 'Another process owns this restore group');
  const lock = `${journalPath}.lock`;
  try { await mkdir(lock); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const owner = await readFile(join(lock, 'owner.json'), 'utf8').then(raw => JSON.parse(raw) as { pid: number }, () => undefined);
    const stale = owner ? !processAlive(owner.pid) && owner.pid !== process.pid : Date.now() - (await lstat(lock)).mtimeMs > 5_000;
    if (!stale) throw new AgentToolError('PROJECT_BUSY', 'Interrupted restore recovery is already running');
    await rm(lock, { recursive: true, force: true });
    await mkdir(lock);
  }
  await writeRecoveryRecord(join(lock, 'owner.json'), { pid: process.pid });
  try {
    const records = [];
    // A participant whose project folder is unreachable (an unmounted drive) keeps its record, and the group keeps
    // its journal, so it is recovered the same way when the folder returns; the others are recovered now (audit B05-03).
    let waiting = false;
    for (const item of journal.participants) {
      try {
        const record = await readRecord(item.directory, item.workspaceRoot);
        if (record.groupJournal !== journalPath && !(record.groupJournal === undefined && record.phase === 'prepared' && journal.phase === 'prepared')) throw new AgentToolError('INVALID_CHECKPOINT', 'Recovery group membership does not match');
        records.push({ directory: item.directory, record });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (await lstat(item.directory).then(() => true, () => false)) waiting = true;
      }
    }
    await recoverRecords(records, journal.phase === 'committed', waiting ? async () => undefined
      : () => finalizeRecordedVersions(journal.versionDirectories || [], journal.phase === 'committed'));
    if (!waiting) await rm(journalPath, { force: true });
  } finally { await rm(lock, { recursive: true, force: true }); }
}
/** Called before a reopened workspace can execute tools. No cloud data or second version store. */
export async function recoverInterruptedCheckpointRestores(checkpointRoot: string, workspaceRoot: string): Promise<void> {
  for (const entry of await readdir(checkpointRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^\.restore-[a-f0-9-]{36}$/.test(entry.name)) continue;
    const directory = join(checkpointRoot, entry.name);
    if (activeCheckpointRestores.has(directory)) continue;
    let record: RecoveryRecord;
    try { record = await readRecord(directory, workspaceRoot); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const key = record.groupJournal ?? directory;
    let job = recoveryJobs.get(key);
    if (!job) {
      if (record.versionDirectories && (!Array.isArray(record.versionDirectories) || record.versionDirectories.some(path => typeof path !== 'string'
        || dirname(path) !== checkpointRoot || !/^restore-[a-f0-9-]{36}$/.test(basename(path))))) throw new AgentToolError('INVALID_CHECKPOINT', 'Invalid recovery version membership');
      job = (record.groupJournal ? recoverGroup(record.groupJournal, directory) : recoverRecords([{ directory, record }], false,
        () => finalizeRecordedVersions(record.versionDirectories || [], false))).finally(() => recoveryJobs.delete(key));
      recoveryJobs.set(key, job);
    }
    await job;
  }
}
