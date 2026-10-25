import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { lock as acquireFileLock } from "proper-lockfile";

import { applyComicCommand, createComicProject } from "./core.js";
import { parseComicProject, serializeComicProject } from "./codec.js";
import type {
  ApplyComicCommandOptions,
  ComicCommand,
  ComicProject,
  CreateComicProjectOptions,
} from "./types.js";
import { COMIC_PROJECT_FILE } from "./types.js";
import { assertCurrentRevision, ComicCoreError } from "./validation.js";

const MAX_PROJECT_FILE_BYTES = 10 * 1024 * 1024;
const LOCK_WAIT_MS = 5_000;
const LOCK_STALE_MS = 40_000;
const LOCK_UPDATE_MS = 5_000;
const MAX_HISTORY_FILES = 30;
const MAX_HISTORY_ARCHIVE_MANIFEST_BYTES = 64 * 1024;
const HISTORY_ARCHIVE_FORMAT = "nextmux.comic-history";
const HISTORY_ARCHIVE_VERSION = 1;
const HISTORY_ARCHIVE_SUFFIX = ".nmxcomic";
const SNAPSHOT_FILE = /^revision-(\d{12})-[A-Za-z0-9-]+\.json$/;

interface ComicHistoryArchiveEntry {
  readonly name: string;
  readonly revision: number;
  readonly bytes: number;
  readonly sha256: string;
}

interface ComicHistoryArchiveManifest {
  readonly format: typeof HISTORY_ARCHIVE_FORMAT;
  readonly version: typeof HISTORY_ARCHIVE_VERSION;
  readonly createdAt: string;
  readonly projectId: string;
  readonly projectRevision: number;
  readonly files: readonly ComicHistoryArchiveEntry[];
  readonly contentSha256: string;
}

export interface ComicHistoryArchiveExportResult {
  readonly directory: string;
  readonly files: number;
  readonly bytes: number;
}

export interface ComicHistoryArchiveImportResult {
  readonly files: number;
  readonly bytes: number;
}

export interface ComicProjectStoreOptions {
  readonly workspaceRoot: string;
  readonly historyRoot: string;
}

export interface ComicProjectFileState {
  readonly exists: boolean;
  readonly fileName: typeof COMIC_PROJECT_FILE;
  readonly project?: ComicProject;
  readonly sha256?: string;
  readonly migratedFrom?: number;
}

function isInside(root: string, candidate: string): boolean {
  const delta = relative(root, candidate);
  return delta === "" || (!delta.startsWith(`..${sep}`) && delta !== ".." && !isAbsolute(delta));
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function exists(pathname: string): Promise<boolean> {
  try {
    await lstat(pathname);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function atomicWrite(pathname: string, content: string | Uint8Array, verifyOwnership?: () => void | Promise<void>): Promise<void> {
  const temporary = join(dirname(pathname), `.${randomUUID()}.nextmux-comic.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    // A writer that lost the project lock must not replace what the new owner wrote (as in media-core).
    await verifyOwnership?.();
    await rename(temporary, pathname);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch {
      // Keep the rename failure; cleanup is best effort.
    }
    throw error;
  }
}

function snapshotRevision(name: string): number {
  const match = SNAPSHOT_FILE.exec(name);
  if (!match) throw new ComicCoreError("COMIC_HISTORY_ARCHIVE_INVALID", "Invalid comic history snapshot name", "comic.comic_history_archive_invalid.invalid_comic_history_snapshot_name", {});
  return Number(match[1]);
}

async function readSnapshot(pathname: string, name: string, projectId: string,
  maximumRevision: number): Promise<{ readonly content: Buffer; readonly entry: ComicHistoryArchiveEntry }> {
  const revision = snapshotRevision(name);
  let content: Buffer;
  try {
    const metadata = await lstat(pathname);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_PROJECT_FILE_BYTES) throw new Error("invalid file");
    content = await readFile(pathname);
    if (content.byteLength !== metadata.size || content.byteLength > MAX_PROJECT_FILE_BYTES) throw new Error("file changed");
    const project = parseComicProject(content.toString("utf8")).project;
    if (project.id !== projectId || project.revision !== revision || revision >= maximumRevision) throw new Error("wrong project or revision");
  } catch {
    throw new ComicCoreError("COMIC_HISTORY_ARCHIVE_INVALID", "Comic history snapshot is invalid or changed", "comic.comic_history_archive_invalid.comic_history_snapshot_is_invalid_or_changed", {});
  }
  return { content, entry: { name, revision, bytes: content.byteLength, sha256: sha256(content) } };
}

async function readHistoryArchive(directory: string): Promise<ComicHistoryArchiveManifest> {
  try {
    const root = resolve(directory);
    const metadata = await lstat(root);
    if (!root.endsWith(HISTORY_ARCHIVE_SUFFIX) || !metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("invalid root");
    const top = await readdir(root);
    if (top.length !== 2 || !top.includes("manifest.json") || !top.includes("files")) throw new Error("unexpected archive entry");
    const manifestMeta = await lstat(join(root, "manifest.json"));
    if (!manifestMeta.isFile() || manifestMeta.isSymbolicLink() || manifestMeta.size > MAX_HISTORY_ARCHIVE_MANIFEST_BYTES) throw new Error("invalid manifest");
    const raw = await readFile(join(root, "manifest.json"), "utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_HISTORY_ARCHIVE_MANIFEST_BYTES) throw new Error("oversized manifest");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid manifest");
    const manifest = parsed as ComicHistoryArchiveManifest;
    if (manifest.format !== HISTORY_ARCHIVE_FORMAT || manifest.version !== HISTORY_ARCHIVE_VERSION
      || typeof manifest.createdAt !== "string" || !Number.isFinite(Date.parse(manifest.createdAt))
      || typeof manifest.projectId !== "string" || !manifest.projectId
      || !Number.isSafeInteger(manifest.projectRevision) || manifest.projectRevision < 0
      || !Array.isArray(manifest.files) || manifest.files.length > MAX_HISTORY_FILES
      || typeof manifest.contentSha256 !== "string") throw new Error("invalid manifest fields");
    const { contentSha256, ...unsigned } = manifest;
    if (sha256(JSON.stringify(unsigned)) !== contentSha256) throw new Error("manifest hash mismatch");
    const filesRoot = join(root, "files");
    const filesMeta = await lstat(filesRoot);
    if (!filesMeta.isDirectory() || filesMeta.isSymbolicLink()) throw new Error("invalid files directory");
    const actual = (await readdir(filesRoot)).sort();
    const declared = manifest.files.map(entry => entry.name).sort();
    if (actual.length !== declared.length || actual.some((name, index) => name !== declared[index])) throw new Error("archive files differ");
    let total = 0;
    for (const entry of manifest.files) {
      if (!entry || typeof entry !== "object" || typeof entry.name !== "string"
        || !Number.isSafeInteger(entry.revision) || entry.revision < 0
        || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > MAX_PROJECT_FILE_BYTES
        || typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error("invalid file entry");
      total += entry.bytes;
      if (total > MAX_HISTORY_FILES * MAX_PROJECT_FILE_BYTES) throw new Error("archive too large");
      const snapshot = await readSnapshot(join(filesRoot, entry.name), entry.name, manifest.projectId, manifest.projectRevision);
      if (snapshot.entry.revision !== entry.revision || snapshot.entry.bytes !== entry.bytes
        || snapshot.entry.sha256 !== entry.sha256) throw new Error("snapshot hash mismatch");
    }
    return manifest;
  } catch {
    throw new ComicCoreError("COMIC_HISTORY_ARCHIVE_INVALID", "Comic history archive failed validation", "comic.comic_history_archive_invalid.comic_history_archive_failed_validation", {});
  }
}

export class ComicProjectStore {
  readonly #workspaceRoot: string;
  readonly #historyRoot: string;
  readonly #projectPath: string;
  readonly #lockPath: string;
  readonly #legacyLockPath: string;

  private constructor(workspaceRoot: string, historyRoot: string) {
    this.#workspaceRoot = workspaceRoot;
    this.#historyRoot = historyRoot;
    this.#projectPath = join(workspaceRoot, COMIC_PROJECT_FILE);
    // The history directory can be cleared. Keep the lock outside that tree so
    // cleanup cannot remove a writer's mutex while the writer still owns it.
    this.#lockPath = join(dirname(historyRoot), ".locks", `${basename(historyRoot)}.lock`);
    this.#legacyLockPath = join(historyRoot, "write.lock");
  }

  static async create(options: ComicProjectStoreOptions): Promise<ComicProjectStore> {
    let workspaceRoot: string;
    try {
      workspaceRoot = await realpath(resolve(options.workspaceRoot));
    } catch {
      throw new ComicCoreError("INVALID_WORKSPACE", "Comic workspace does not exist", "comic.invalid_workspace.comic_workspace_does_not_exist", {});
    }
    if (!(await stat(workspaceRoot)).isDirectory()) {
      throw new ComicCoreError("INVALID_WORKSPACE", "Comic workspace is not a directory", "comic.invalid_workspace.comic_workspace_is_not_a_directory", {});
    }
    await mkdir(resolve(options.historyRoot), { recursive: true, mode: 0o700 });
    const historyRoot = await realpath(resolve(options.historyRoot));
    if (isInside(workspaceRoot, historyRoot)) {
      throw new ComicCoreError("INVALID_HISTORY_ROOT", "Comic recovery history must stay outside the workspace", "comic.invalid_history_root.comic_recovery_history_must_stay_outside_the_workspace", {});
    }
    return new ComicProjectStore(workspaceRoot, historyRoot);
  }

  get workspaceRoot(): string {
    return this.#workspaceRoot;
  }

  get projectPath(): string {
    return this.#projectPath;
  }

  /** Serialize history-wide operations with project writes in every process. */
  async withHistoryLock<T>(operation: (verifyOwnership: () => void) => Promise<T>): Promise<T> {
    return this.#withLock(operation);
  }

  /** Export revision snapshots only; the live project and media assets are outside this archive. */
  async exportHistory(destinationParent: string): Promise<ComicHistoryArchiveExportResult> {
    let parent: string;
    try {
      const requested = resolve(destinationParent);
      const metadata = await lstat(requested);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("invalid destination");
      parent = await realpath(requested);
      if (isInside(this.#historyRoot, parent)) throw new Error("history cannot contain its backup");
    } catch {
      throw new ComicCoreError("COMIC_HISTORY_DESTINATION_INVALID", "Choose an existing local backup folder outside comic history", "comic.comic_history_destination_invalid.choose_an_existing_local_backup_folder_outside_comic_history", {});
    }
    return this.#withLock(async verifyOwnership => {
      const current = await this.read();
      if (!current.project) throw new ComicCoreError("PROJECT_NOT_FOUND", "Create a comic project before exporting its history", "comic.project_not_found.create_a_comic_project_before_exporting_its_history", {});
      const rawNames = await readdir(this.#historyRoot);
      const names = rawNames.filter(name => name !== ".DS_Store" && !/^\.[0-9a-f-]+\.nextmux-comic\.tmp$/i.test(name));
      if (names.length > MAX_HISTORY_FILES || names.some(name => !SNAPSHOT_FILE.test(name))) {
        throw new ComicCoreError("COMIC_HISTORY_ARCHIVE_INVALID", "Comic history contains unexpected files", "comic.comic_history_archive_invalid.comic_history_contains_unexpected_files", {});
      }
      const label = new Date().toISOString().replace(/[:.]/g, "-");
      const destination = join(parent, `NextMux-comic-history-${label}-${randomUUID()}${HISTORY_ARCHIVE_SUFFIX}`);
      const staging = join(parent, `.nextmux-comic-export-${randomUUID()}${HISTORY_ARCHIVE_SUFFIX}`);
      await mkdir(staging, { recursive: false, mode: 0o700 });
      try {
        await mkdir(join(staging, "files"), { recursive: false, mode: 0o700 });
        const entries: ComicHistoryArchiveEntry[] = [];
        let totalBytes = 0;
        for (const name of names.sort()) {
          verifyOwnership();
          const snapshot = await readSnapshot(join(this.#historyRoot, name), name, current.project.id, current.project.revision);
          totalBytes += snapshot.entry.bytes;
          if (totalBytes > MAX_HISTORY_FILES * MAX_PROJECT_FILE_BYTES) {
            throw new ComicCoreError("COMIC_HISTORY_ARCHIVE_INVALID", "Comic history exceeds the archive limit", "comic.comic_history_archive_invalid.comic_history_exceeds_the_archive_limit", { maximum: MAX_HISTORY_FILES * MAX_PROJECT_FILE_BYTES });
          }
          await atomicWrite(join(staging, "files", snapshot.entry.name), snapshot.content);
          entries.push(snapshot.entry);
        }
        const unsigned = {
          format: HISTORY_ARCHIVE_FORMAT, version: HISTORY_ARCHIVE_VERSION,
          createdAt: new Date().toISOString(), projectId: current.project.id,
          projectRevision: current.project.revision, files: entries,
        };
        await atomicWrite(join(staging, "manifest.json"), `${JSON.stringify({ ...unsigned,
          contentSha256: sha256(JSON.stringify(unsigned)) }, undefined, 2)}\n`);
        // Read back every staged byte before exposing a complete archive.
        await readHistoryArchive(staging);
        verifyOwnership();
        await rename(staging, destination);
        return { directory: destination, files: entries.length, bytes: totalBytes };
      } finally {
        await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      }
    });
  }

  /** Restore only into empty history for the exact unchanged live project. */
  async importHistory(archiveDirectory: string): Promise<ComicHistoryArchiveImportResult> {
    const source = resolve(archiveDirectory);
    if (isInside(this.#historyRoot, source)) {
      throw new ComicCoreError("COMIC_HISTORY_ARCHIVE_INVALID", "Archive cannot be inside comic history", "comic.comic_history_archive_invalid.archive_cannot_be_inside_comic_history", {});
    }
    const manifest = await readHistoryArchive(source);
    const staging = join(dirname(this.#historyRoot), `.nextmux-comic-import-${randomUUID()}`);
    await mkdir(staging, { recursive: false, mode: 0o700 });
    try {
      for (const entry of manifest.files) {
        const snapshot = await readSnapshot(join(source, "files", entry.name), entry.name,
          manifest.projectId, manifest.projectRevision);
        if (snapshot.entry.sha256 !== entry.sha256 || snapshot.entry.bytes !== entry.bytes) {
          throw new ComicCoreError("COMIC_HISTORY_ARCHIVE_INVALID", "Archive changed while staging the import", "comic.comic_history_archive_invalid.archive_changed_while_staging_the_import", {});
        }
        await atomicWrite(join(staging, entry.name), snapshot.content);
      }
      const result = await this.#withLock(async verifyOwnership => {
        const current = await this.read();
        if (!current.project || current.project.id !== manifest.projectId
          || current.project.revision !== manifest.projectRevision) {
          throw new ComicCoreError("COMIC_HISTORY_CONFLICT", "Comic project changed since this history archive was exported", "comic.comic_history_conflict.comic_project_changed_since_this_history_archive_was_exported", {});
        }
        if ((await readdir(this.#historyRoot)).length !== 0) {
          throw new ComicCoreError("COMIC_HISTORY_NOT_EMPTY", "Clear this project's current revision history before restoring", "comic.comic_history_not_empty.clear_this_project_s_current_revision_history_before_restoring", {});
        }
        // The private staging tree must still match the bytes validated from
        // the selected archive before it can replace the empty destination.
        for (const entry of manifest.files) {
          const staged = await readSnapshot(join(staging, entry.name), entry.name,
            manifest.projectId, manifest.projectRevision);
          if (staged.entry.sha256 !== entry.sha256 || staged.entry.bytes !== entry.bytes) {
            throw new ComicCoreError("COMIC_HISTORY_ARCHIVE_INVALID", "Staged snapshot changed before import", "comic.comic_history_archive_invalid.staged_snapshot_changed_before_import", {});
          }
        }
        const backup = join(dirname(this.#historyRoot), `.nextmux-comic-empty-${randomUUID()}`);
        verifyOwnership();
        await rename(this.#historyRoot, backup);
        try {
          await rename(staging, this.#historyRoot);
        } catch {
          await rename(backup, this.#historyRoot);
          throw new ComicCoreError("COMIC_HISTORY_IMPORT_FAILED", "Unable to install comic history; original history was restored", "comic.comic_history_import_failed.unable_to_install_comic_history_original_history_was_restored", {});
        }
        await rm(backup, { recursive: true, force: true }).catch(() => undefined);
        return { files: manifest.files.length, bytes: manifest.files.reduce((sum, item) => sum + item.bytes, 0) };
      });
      return result;
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async read(): Promise<ComicProjectFileState> {
    let metadata;
    try {
      metadata = await lstat(this.#projectPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { exists: false, fileName: COMIC_PROJECT_FILE };
      }
      throw new ComicCoreError("PROJECT_READ_FAILED", "Unable to inspect the comic project file", "comic.project_read_failed.unable_to_inspect_the_comic_project_file", {});
    }
    if (metadata.isSymbolicLink()) {
      throw new ComicCoreError("SYMLINK_BLOCKED", "Comic project file cannot be a symbolic link", "comic.symlink_blocked.comic_project_file_cannot_be_a_symbolic_link", {});
    }
    if (!metadata.isFile()) {
      throw new ComicCoreError("INVALID_PROJECT_FILE", "Comic project path is not a file", "comic.invalid_project_file.comic_project_path_is_not_a_file", {});
    }
    const resolved = await realpath(this.#projectPath);
    if (!isInside(this.#workspaceRoot, resolved)) {
      throw new ComicCoreError("PATH_OUTSIDE_WORKSPACE", "Comic project file resolves outside the workspace", "comic.path_outside_workspace.comic_project_file_resolves_outside_the_workspace", {});
    }
    if (metadata.size > MAX_PROJECT_FILE_BYTES) {
      throw new ComicCoreError("PROJECT_TOO_LARGE", "Comic project file exceeds the 10 MB disk limit", "comic.project_too_large.comic_project_file_exceeds_the_10_mb_disk_limit", { maximum: 10 * 1024 * 1024 });
    }
    let raw: string;
    try {
      raw = await readFile(resolved, "utf8");
    } catch {
      throw new ComicCoreError("PROJECT_READ_FAILED", "Unable to read the comic project file", "comic.project_read_failed.unable_to_read_the_comic_project_file", {});
    }
    const parsed = parseComicProject(raw);
    return {
      exists: true,
      fileName: COMIC_PROJECT_FILE,
      project: parsed.project,
      sha256: sha256(raw),
      ...(parsed.migratedFrom === undefined ? {} : { migratedFrom: parsed.migratedFrom }),
    };
  }

  async initialize(options: CreateComicProjectOptions = {}, overwrite = false): Promise<ComicProjectFileState> {
    return this.#withLock(async verifyOwnership => {
      const current = await this.read();
      if (current.exists && !overwrite) {
        throw new ComicCoreError("PROJECT_EXISTS", `${COMIC_PROJECT_FILE} already exists in this workspace`, "comic.project_exists.already_exists_in_this_workspace", { filename: COMIC_PROJECT_FILE });
      }
      const project = createComicProject(options);
      await this.#writeProject(project, current.exists ? serializeComicProject(current.project!) : undefined, verifyOwnership);
      return {
        exists: true,
        fileName: COMIC_PROJECT_FILE,
        project,
        sha256: sha256(serializeComicProject(project)),
      };
    });
  }

  async apply(
    command: ComicCommand,
    options: ApplyComicCommandOptions = {},
  ): Promise<ComicProjectFileState> {
    return this.#withLock(async verifyOwnership => {
      const current = await this.read();
      if (!current.exists || !current.project) {
        throw new ComicCoreError("PROJECT_NOT_FOUND", `Create ${COMIC_PROJECT_FILE} before editing the storyboard`, "comic.project_not_found.create_before_editing_the_storyboard", { filename: COMIC_PROJECT_FILE });
      }
      const project = applyComicCommand(current.project, command, options);
      const serialized = serializeComicProject(project);
      await this.#writeProject(project, serializeComicProject(current.project), verifyOwnership);
      return {
        exists: true,
        fileName: COMIC_PROJECT_FILE,
        project,
        sha256: sha256(serialized),
      };
    });
  }

  /** Commit a trusted in-memory command sequence in one project-file write. */
  async commitPrepared(expectedRevision: number, prepared: ComicProject): Promise<ComicProjectFileState> {
    return this.#withLock(async verifyOwnership => {
      const current = await this.read();
      if (!current.project) throw new ComicCoreError("PROJECT_NOT_FOUND", `Create ${COMIC_PROJECT_FILE} before editing the storyboard`, "comic.project_not_found.create_before_editing_the_storyboard", { filename: COMIC_PROJECT_FILE });
      assertCurrentRevision(current.project.revision, expectedRevision);
      if (prepared.id !== current.project.id || prepared.revision < current.project.revision) {
        throw new ComicCoreError("INVALID_PROJECT", "Prepared storyboard does not extend the current project", "comic.invalid_project.prepared_storyboard_does_not_extend_the_current_project", {});
      }
      const serialized = serializeComicProject(prepared);
      if (serialized === serializeComicProject(current.project)) return current;
      if (prepared.revision === current.project.revision) {
        throw new ComicCoreError("INVALID_PROJECT", "Prepared storyboard changed without a new revision", "comic.invalid_project.prepared_storyboard_changed_without_a_new_revision", {});
      }
      await this.#writeProject(prepared, serializeComicProject(current.project), verifyOwnership);
      return { exists: true, fileName: COMIC_PROJECT_FILE, project: prepared, sha256: sha256(serialized) };
    });
  }

  async #writeProject(project: ComicProject, previous?: string, verifyOwnership?: () => void): Promise<void> {
    const serialized = serializeComicProject(project);
    // Refused before anything is written, by the same byte limit that reading applies: a save never leaves a project
    // that cannot be opened again (Chinese text takes three bytes a character; audit B15-002).
    if (Buffer.byteLength(serialized, "utf8") > MAX_PROJECT_FILE_BYTES) {
      throw new ComicCoreError("PROJECT_TOO_LARGE", "Comic project file exceeds the 10 MB disk limit", "comic.project_too_large.comic_project_file_exceeds_the_10_mb_disk_limit", { maximum: MAX_PROJECT_FILE_BYTES });
    }
    if (previous !== undefined) await this.#snapshot(previous, verifyOwnership);
    try {
      await atomicWrite(this.#projectPath, serialized, verifyOwnership);
    } catch (error) {
      if (error instanceof ComicCoreError) throw error;
      throw new ComicCoreError("PROJECT_WRITE_FAILED", "Unable to save the comic project atomically", "comic.project_write_failed.unable_to_save_the_comic_project_atomically", {});
    }
  }

  async #snapshot(content: string, verifyOwnership?: () => void): Promise<void> {
    const parsed = parseComicProject(content).project;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `revision-${String(parsed.revision).padStart(12, "0")}-${stamp}-${randomUUID()}.json`;
    await atomicWrite(join(this.#historyRoot, fileName), content, verifyOwnership);
    const entries = await readdir(this.#historyRoot, { withFileTypes: true });
    const files = entries
      .filter(entry => entry.isFile() && /^revision-\d{12}-[A-Za-z0-9-]+\.json$/.test(entry.name))
      .map(entry => entry.name)
      .sort()
      .reverse();
    const staleTmp = entries
      .filter(entry => entry.isFile() && /^\.[0-9a-f-]+\.nextmux-comic\.tmp$/i.test(entry.name))
      .map(entry => entry.name);
    await Promise.all([...files.slice(MAX_HISTORY_FILES), ...staleTmp].map(async file => {
      try {
        await unlink(join(this.#historyRoot, file));
      } catch {
        // Recovery pruning must never fail the foreground save.
      }
    }));
  }

  async #withLock<T>(operation: (verifyOwnership: () => void) => Promise<T>): Promise<T> {
    let compromised: Error | undefined;
    let release: () => Promise<void>;
    try {
      await mkdir(dirname(this.#lockPath), { recursive: true, mode: 0o700 });
      release = await acquireFileLock(this.#projectPath, {
        realpath: false,
        lockfilePath: this.#lockPath,
        stale: LOCK_STALE_MS,
        update: LOCK_UPDATE_MS,
        retries: { retries: Math.ceil(LOCK_WAIT_MS / 50), factor: 1, minTimeout: 50, maxTimeout: 50 },
        onCompromised: error => { compromised = error; },
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ELOCKED") {
        throw new ComicCoreError("PROJECT_BUSY", "Another NextMux window is saving this comic project", "comic.project_busy.another_nextmux_window_is_saving_this_comic_project", {});
      }
      throw new ComicCoreError("LOCK_FAILED", "Unable to lock the comic project", "comic.lock_failed.unable_to_lock_the_comic_project", {});
    }
    const verifyOwnership = () => {
      if (compromised) throw new ComicCoreError("LOCK_FAILED", "Comic project lock was lost while saving", "comic.lock_failed.comic_project_lock_was_lost_while_saving", {});
    };
    let failed = false;
    try {
      // Older builds locked inside history. Do not mutate or clear the tree
      // while their lock is present: the two locations cannot coordinate.
      if (await exists(this.#legacyLockPath)) {
        throw new ComicCoreError("PROJECT_BUSY", "An older NextMux comic project lock remains in history", "comic.project_busy.an_older_nextmux_comic_project_lock_remains_in_history", {});
      }
      // A store instance may have been created before a concurrent clear.
      await mkdir(this.#historyRoot, { recursive: true, mode: 0o700 });
      if (await realpath(this.#historyRoot) !== this.#historyRoot) {
        throw new ComicCoreError("INVALID_HISTORY_ROOT", "Comic history root changed while locking", "comic.invalid_history_root.comic_history_root_changed_while_locking", {});
      }
      verifyOwnership();
      const result = await operation(verifyOwnership);
      verifyOwnership();
      return result;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try { await release(); }
      catch { if (!failed) throw new ComicCoreError("LOCK_FAILED", "Unable to release the comic project lock", "comic.lock_failed.unable_to_release_the_comic_project_lock", {}); }
    }
  }
}
