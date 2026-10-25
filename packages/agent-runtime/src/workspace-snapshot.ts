import { createHash, randomUUID } from "node:crypto";
import { workspaceDirectoryIdentity } from "./workspace-identity.js";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, readlink, realpath, rename, rm, statfs, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { withDirectoryIgnore, workspacePathIgnored, type WorkspaceIgnoreRule } from "./workspace-ignore.js";

export interface WorkspaceSnapshotFile {
  readonly content?: Buffer;
  readonly contentPath?: string;
  readonly size?: number;
  readonly sha256: string;
  readonly mode: number;
  readonly fingerprint: string;
}

// Content limits constrain disk work; buffers stay bounded independently of file size.
export const SNAPSHOT_MAX_FILES = 100_000;
/**
 * The aggregate snapshot budget is the actual safety boundary.  A previous
 * implementation imposed a smaller per-file ceiling, which meant a single
 * large source file could not participate in command checkpoints even though
 * the object store and restore path already stream bytes.  Keep the aggregate
 * bound (2 GiB) while allowing one file to consume it; every read/write still
 * uses fixed-size chunks and the live file is protected by hash/CAS checks.
 */
export const SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const SNAPSHOT_MAX_FILE_BYTES = SNAPSHOT_MAX_BYTES;
const MEMORY_BYTES = 4 * 1024 * 1024;
const SMALL_FILE_BYTES = 64 * 1024;
const CHUNK_BYTES = 256 * 1024;
export const snapshotFileSize = (file: WorkspaceSnapshotFile): number => file.size ?? file.content?.length ?? 0;
const fingerprint = (info: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number; mode: number }): string =>
  `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.mode}`;

/** Hash a stable ordinary file; large originals are copied to immutable disk objects. */
export async function inspectSnapshotFile(path: string, options: { objectDirectory?: string; memory?: boolean; expectedParent?: string; signal?: AbortSignal; maxBytes?: number } = {}): Promise<WorkspaceSnapshotFile> {
  const maximumBytes = options.maxBytes ?? Number.MAX_SAFE_INTEGER;
  const parent = options.expectedParent ?? await realpath(dirname(path));
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximumBytes
    || await realpath(dirname(path)) !== parent) throw new Error("Unsafe or oversized snapshot file");
  const input = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let output: Awaited<ReturnType<typeof open>> | undefined;
  let temporary: string | undefined;
  try {
    if (fingerprint(await input.stat()) !== fingerprint(before)) throw new Error("Snapshot file changed before reading");
    const inMemory = options.memory !== false && before.size <= SMALL_FILE_BYTES;
    if (!inMemory && options.objectDirectory) {
      await mkdir(options.objectDirectory, { recursive: true, mode: 0o700 });
      const space = await statfs(options.objectDirectory);
      if (space.bavail * space.bsize < before.size + 128 * 1024 * 1024) throw new Error("Snapshot disk reserve reached");
      temporary = join(options.objectDirectory, `${randomUUID()}.tmp`);
      output = await open(temporary, "wx", 0o600);
    }
    const digest = createHash("sha256"), chunks: Buffer[] = [];
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    let size = 0;
    while (true) {
      if (options.signal?.aborted) throw Object.assign(new Error("Task was cancelled"), { name: "AbortError" });
      const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > before.size || size > maximumBytes) throw new Error("Snapshot file grew beyond its verified size");
      const bytes = buffer.subarray(0, bytesRead);
      digest.update(bytes);
      if (inMemory) chunks.push(Buffer.from(bytes));
      if (output) await output.writeFile(bytes);
    }
    if (size !== before.size || fingerprint(await input.stat()) !== fingerprint(before)
      || fingerprint(await lstat(path)) !== fingerprint(before) || await realpath(dirname(path)) !== parent) throw new Error("Snapshot file changed while reading");
    const sha256 = digest.digest("hex");
    let contentPath = path;
    if (output && temporary) {
      await output.sync(); await output.close(); output = undefined;
      contentPath = join(options.objectDirectory!, `${sha256}.bin`);
      await rename(temporary, contentPath); temporary = undefined;
    }
    return { ...(inMemory ? { content: Buffer.concat(chunks) } : { contentPath }), size,
      sha256, mode: before.mode, fingerprint: fingerprint(before) };
  } finally {
    await input.close(); if (output) await output.close();
    if (temporary) await rm(temporary, { force: true });
  }
}

/** Atomic, hash-checked disk-to-disk copy; never buffers a large file. */
export async function writeSnapshotFile(file: WorkspaceSnapshotFile, target: string, mode = 0o600,
  options: { beforeCommit?: () => Promise<void> } = {}): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const parent = await realpath(dirname(target));
  const expectedSize = snapshotFileSize(file);
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) throw new Error("Invalid snapshot object size");
  const space = await statfs(dirname(target));
  if (space.bavail * space.bsize < expectedSize + 128 * 1024 * 1024) throw new Error("Snapshot destination disk reserve reached");
  const temporary = join(dirname(target), `.${randomUUID()}.snapshot.tmp`);
  const output = await open(temporary, "wx", mode & 0o7777);
  let input: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const digest = createHash("sha256"); let size = 0;
    if (file.content) { digest.update(file.content); size = file.content.length; await output.writeFile(file.content); }
    else {
      if (!file.contentPath || (await lstat(file.contentPath)).isSymbolicLink()) throw new Error("Invalid snapshot object");
      input = await open(file.contentPath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      if (!(await input.stat()).isFile()) throw new Error("Invalid snapshot object");
      const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
      while (true) {
        const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        size += bytesRead;
        if (size > expectedSize) throw new Error("Invalid snapshot object content: exceeds its verified size");
        const bytes = buffer.subarray(0, bytesRead); digest.update(bytes); await output.writeFile(bytes);
      }
    }
    if (size !== snapshotFileSize(file) || digest.digest("hex") !== file.sha256) throw new Error("Invalid snapshot object content");
    await output.chmod(mode & 0o7777); await output.sync(); await output.close();
    if (input) { await input.close(); input = undefined; }
    if (await realpath(dirname(target)) !== parent) throw new Error("Snapshot destination changed while writing");
    // A large copy can take seconds. Restore callers recheck the live target
    // after copying, so an edit made during that work is not overwritten.
    await options.beforeCommit?.();
    if (await realpath(dirname(target)) !== parent) throw new Error("Snapshot destination changed before commit");
    await rename(temporary, target);
  } catch (error) { await output.close().catch(() => undefined); throw error; }
  finally { if (input) await input.close(); await rm(temporary, { force: true }); }
}

export interface WorkspaceSnapshot {
  readonly files: Map<string, WorkspaceSnapshotFile>;
  /** Paths seen but not captured must never be treated as newly created/deleted. */
  readonly excludedPaths: Set<string>;
  readonly complete: boolean;
  /** All in-scope entries were enumerated. Legacy absence inherits the complete flag. */
  readonly enumerationComplete?: boolean;
  readonly warnings: readonly string[];
  /**
   * What is not a regular file: folders (`dir:<mode>`) and symbolic links (`link:<target>`). They are not restorable
   * like file contents, so a command that changes them is reported as outside checkpoint coverage (audit B05-04).
   */
  readonly structure?: Map<string, string>;
}

export function snapshotPathExcluded(snapshot: WorkspaceSnapshot, path: string): boolean {
  // An unenumerated path has no absence proof, including legacy partial snapshots.
  if (!snapshot.files.has(path) && !(snapshot.enumerationComplete ?? snapshot.complete)) return true;
  if (snapshot.excludedPaths.has(path)) return true;
  const pieces = path.split("/");
  for (let index = 1; index < pieces.length; index += 1) {
    if (snapshot.excludedPaths.has(`${pieces.slice(0, index).join("/")}/`)) return true;
  }
  return false;
}

// Generated dependencies/artifacts are excluded explicitly, not silently claimed
// as protected source. No Git executable or user's Git index is involved.
export const COMMAND_CHECKPOINT_EXCLUDES = [
  ".git", ".nextmux", ".nextmux-run", "node_modules", "dist", "build", "out", ".next", ".cache", "coverage", ".venv", "__pycache__",
] as const;

export interface PersistedCommandSnapshot {
  readonly version: 1;
  /** Missing on older snapshots, which represent an interrupted active command. */
  readonly phase?: "active" | "idle";
  readonly workspaceRoot: string;
  /** Absent on legacy snapshots, which require review before automatic recovery. */
  readonly directoryIdentity?: string;
  readonly ownerPid: number;
  readonly runId: string;
  readonly generation: string;
  readonly files: readonly { path: string; sha256: string; mode: number; fingerprint: string; size?: number }[];
  readonly excludedPaths: readonly string[];
  readonly complete: boolean;
  /** All in-scope entries were enumerated. Legacy absence inherits the complete flag. */
  readonly enumerationComplete?: boolean;
  readonly warnings: readonly string[];
}

export async function persistCommandSnapshot(directory: string, snapshot: WorkspaceSnapshot, metadata: Pick<PersistedCommandSnapshot, "workspaceRoot" | "runId" | "generation" | "directoryIdentity" | "phase">): Promise<void> {
  await mkdir(directory, { recursive: true });
  const existing = new Set(await readdir(directory));
  const keep = new Set<string>();
  for (const file of snapshot.files.values()) {
    const name = `${file.sha256}.bin`;
    keep.add(name);
    if (!existing.has(name)) await writeSnapshotFile(file, join(directory, name));
  }
  const manifest: PersistedCommandSnapshot = {
    version: 1, ...metadata, phase: metadata.phase ?? "active", directoryIdentity: metadata.directoryIdentity ?? await workspaceDirectoryIdentity(metadata.workspaceRoot), ownerPid: process.pid,
    files: [...snapshot.files].map(([path, file]) => ({ path, sha256: file.sha256, mode: file.mode, fingerprint: file.fingerprint, size: snapshotFileSize(file) })),
    excludedPaths: [...snapshot.excludedPaths], complete: snapshot.complete, enumerationComplete: (snapshot.enumerationComplete ?? snapshot.complete) === true, warnings: snapshot.warnings,
  };
  const manifestFile = await open(join(directory, "snapshot.tmp"), "w", 0o600);
  try { await manifestFile.writeFile(JSON.stringify(manifest), "utf8"); await manifestFile.sync(); }
  finally { await manifestFile.close(); }
  await rename(join(directory, "snapshot.tmp"), join(directory, "snapshot.json"));
  if (process.platform !== "win32") {
    const directoryFile = await open(directory, "r");
    try { await directoryFile.sync(); } finally { await directoryFile.close(); }
  }
  // Only remove unreferenced objects after the new manifest is durable.
  for (const name of existing) if (/^[a-f0-9]{64}\.bin$/.test(name) && !keep.has(name)) await rm(join(directory, name));
}

export async function readCommandSnapshotMetadata(directory: string, workspaceRoot: string): Promise<PersistedCommandSnapshot> {
  const metadata = JSON.parse(await readFile(join(directory, "snapshot.json"), "utf8")) as PersistedCommandSnapshot;
  if (metadata.version !== 1 || metadata.workspaceRoot !== workspaceRoot || !/^[a-f0-9-]{36}$/.test(metadata.generation)
    || !/^[A-Za-z0-9-]{1,100}$/.test(metadata.runId) || !Array.isArray(metadata.files) || metadata.files.length > SNAPSHOT_MAX_FILES
    || metadata.phase !== undefined && metadata.phase !== "active" && metadata.phase !== "idle"
    || metadata.enumerationComplete !== undefined && typeof metadata.enumerationComplete !== "boolean") throw new Error("Invalid command recovery snapshot");
  return metadata;
}

export async function loadCommandSnapshot(directory: string, workspaceRoot: string): Promise<{ metadata: PersistedCommandSnapshot; snapshot: WorkspaceSnapshot }> {
  const metadata = await readCommandSnapshotMetadata(directory, workspaceRoot);
  const files = new Map<string, WorkspaceSnapshotFile>();
  let bytes = 0, memory = 0;
  for (const file of metadata.files) {
    const path = relative(workspaceRoot, resolve(workspaceRoot, file.path));
    if (!path || isAbsolute(path) || path.startsWith(`..${sep}`) || path === ".." || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Invalid recovery file path");
    const content = await inspectSnapshotFile(join(directory, `${file.sha256}.bin`), { memory: memory <= MEMORY_BYTES - SMALL_FILE_BYTES });
    bytes += snapshotFileSize(content); memory += content.content?.length ?? 0;
    if (bytes > SNAPSHOT_MAX_BYTES || content.sha256 !== file.sha256) throw new Error("Invalid recovery file content");
    files.set(file.path, { ...content, mode: file.mode, fingerprint: file.fingerprint });
  }
  return { metadata, snapshot: { files, excludedPaths: new Set(metadata.excludedPaths), complete: metadata.complete, enumerationComplete: (metadata.enumerationComplete ?? metadata.complete) === true, warnings: metadata.warnings } };
}

export async function captureWorkspaceSnapshot(
  root: string,
  checkpointRoot: string,
  previous?: WorkspaceSnapshot,
  limits: { maxFiles?: number; maxFileBytes?: number; maxBytes?: number; objectDirectory?: string; excludedRoots?: readonly string[] } = {},
  signal?: AbortSignal,
): Promise<WorkspaceSnapshot> {
  // Canonicalize the trusted root once (macOS /var is /private/var). Descendant
  // checks still reject links introduced while traversing the workspace.
  root = await realpath(root);
  checkpointRoot = await realpath(checkpointRoot).catch(() => resolve(checkpointRoot));
  const maxFiles = limits.maxFiles ?? SNAPSHOT_MAX_FILES;
  const maxFileBytes = limits.maxFileBytes ?? SNAPSHOT_MAX_FILE_BYTES;
  const maxBytes = limits.maxBytes ?? SNAPSHOT_MAX_BYTES;
  const files = new Map<string, WorkspaceSnapshotFile>();
  const excludedPaths = new Set<string>();
  const warnings = new Set<string>();
  const structure = new Map<string, string>();
  const queue: { directory: string; rules: readonly WorkspaceIgnoreRule[] }[] = [{ directory: root, rules: [] }];
  const excludedNames = new Set<string>(COMMAND_CHECKPOINT_EXCLUDES);
  let bytes = 0, memory = 0;
  const objectDirectory = limits.objectDirectory ?? join(checkpointRoot, ".snapshot-objects");
  let visited = 0;
  let enumerationComplete = true;
  while (queue.length) {
    if (signal?.aborted) throw Object.assign(new Error("Task was cancelled"), { name: "AbortError" });
    const current = queue.shift()!;
    const directory = current.directory;
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || await realpath(directory) !== directory) { excludedPaths.add(`${relative(root, directory)}/`); warnings.add("Symbolic link or changed directory excluded"); enumerationComplete = false; continue; }
      if (directory !== root) structure.set(`${relative(root, directory).split(sep).join("/")}/`, `dir:${info.mode & 0o7777}`);
    }
    catch { excludedPaths.add(`${relative(root, directory).split(sep).join('/')}/`); warnings.add("Some directories could not be read"); enumerationComplete = false; continue; }
    let rules = current.rules;
    try { rules = await withDirectoryIgnore(directory, rules); }
    catch { warnings.add("Some ignore rules could not be read"); enumerationComplete = false; }
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch { excludedPaths.add(`${relative(root, directory).split(sep).join('/')}/`); warnings.add("Some directories could not be read"); enumerationComplete = false; continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const [entryIndex, entry] of entries.entries()) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split(sep).join("/");
      if (resolve(absolute) === checkpointRoot || limits.excludedRoots?.includes(absolute) || entry.name === ".git" || entry.isDirectory() && excludedNames.has(entry.name)
        || workspacePathIgnored(absolute, entry.isDirectory(), rules)) {
        excludedPaths.add(entry.isDirectory() ? `${path}/` : path);
        continue;
      }
      if (++visited > maxFiles * 2) {
        warnings.add("Directory entry budget reached"); enumerationComplete = false;
        for (const omitted of entries.slice(entryIndex)) {
          const omittedPath = relative(root, join(directory, omitted.name)).split(sep).join('/');
          excludedPaths.add(omitted.isDirectory() ? `${omittedPath}/` : omittedPath);
        }
        for (const pending of queue) excludedPaths.add(`${relative(root, pending.directory).split(sep).join('/')}/`);
        queue.length = 0; break;
      }
      if (entry.isDirectory()) { queue.push({ directory: absolute, rules }); continue; }
      if (!entry.isFile()) {
        excludedPaths.add(path);
        if (entry.isSymbolicLink()) structure.set(path, `link:${await readlink(absolute).catch(() => "?")}`);
        continue;
      }
      try {
        const before = await lstat(absolute);
        if (!before.isFile() || before.isSymbolicLink()) { excludedPaths.add(path); continue; }
        if (files.size >= maxFiles || before.size > maxFileBytes || bytes + before.size > maxBytes) {
          excludedPaths.add(path); warnings.add("Source snapshot file/byte budget reached"); continue;
        }
        const cached = previous?.files.get(path);
        const cacheAvailable = cached?.content || cached?.contentPath && await lstat(cached.contentPath).then(info => info.isFile() && !info.isSymbolicLink(), () => false);
        const file = cached?.fingerprint === fingerprint(before) && cacheAvailable ? cached
          : await inspectSnapshotFile(absolute, { objectDirectory, memory: memory <= MEMORY_BYTES - SMALL_FILE_BYTES, expectedParent: dirname(absolute), signal, maxBytes: maxFileBytes });
        bytes += snapshotFileSize(file); memory += file.content?.length ?? 0;
        files.set(path, file);
      } catch (error) {
        if (signal?.aborted) throw error;
        excludedPaths.add(path); warnings.add("Some files could not be read consistently");
      }
    }
  }
  return { files, excludedPaths, complete: warnings.size === 0, enumerationComplete, warnings: [...warnings], structure };
}
