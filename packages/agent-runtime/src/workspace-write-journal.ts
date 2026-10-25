import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Writes this process knows a running command did not make: another runtime's
 * tool edit or restore, and host editor saves, renames and deletes. Command
 * checkpoints diff the whole workspace, so without this record a concurrent
 * writer's file became the command's change and restoring the command reverted
 * or deleted it.
 *
 * `sha256` is the content the writer left (`null` = removed); `"*"` means any
 * content the writer left, for a copied/renamed tree or a write still in flight.
 * A `tree` entry covers every file under that directory.
 */
type WorkspaceWrite = { readonly sha256: string | null | "*"; readonly tree: boolean; readonly at: number };

const writes = new Map<string, WorkspaceWrite>();
const WRITE_LIMIT = 20_000;
const HASH_LIMIT_BYTES = 64 * 1024 * 1024;

type WorkspaceWriteListener = (absolutePath: string, sha256: string | null) => void;
const listeners = new Set<WorkspaceWriteListener>();

/**
 * Called with every settled write (not the "*" of one still in flight). A runtime with a command running moves that
 * command's baseline for the file to what the other writer left, so the command's checkpoint starts from the
 * user's save instead of the state before the command (audit B05-02).
 */
export function watchWorkspaceWrites(listener: WorkspaceWriteListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function recordWorkspaceWrite(absolutePath: string, sha256: string | null | "*", options: { tree?: boolean } = {}): void {
  writes.delete(absolutePath);
  writes.set(absolutePath, { sha256, tree: !!options.tree, at: Date.now() });
  if (writes.size > WRITE_LIMIT) writes.delete(writes.keys().next().value!);
  if (sha256 !== "*") for (const listener of [...listeners]) {
    try { listener(absolutePath, sha256); } catch { /* one runtime never blocks another writer */ }
  }
}

/**
 * How a file's state since `since` relates to another writer: `exact` when it is exactly what that writer left,
 * `unknown` when a writer's result could not be hashed (a copied tree, a very large file) so the command's share
 * cannot be told apart, or undefined when no other writer touched it.
 */
export function outsideWriteOf(absolutePath: string, root: string, sha256: string | null, since: number): "exact" | "unknown" | undefined {
  const own = writes.get(absolutePath);
  if (own && own.at >= since && own.sha256 === sha256) return "exact";
  if (own && own.at >= since && own.sha256 === "*") return "unknown";
  for (let directory = absolutePath; directory !== root && dirname(directory) !== directory;) {
    directory = dirname(directory);
    const tree = writes.get(directory);
    if (tree?.tree && tree.at >= since && tree.sha256 === sha256) return "exact";
    if (tree?.tree && tree.at >= since && tree.sha256 === "*" && sha256 !== null) return "unknown";
    if (directory === root) break;
  }
  return undefined;
}

/** True when a file's state since `since` is another writer's, so a command snapshot must not claim it. */
export function writtenOutsideCommand(absolutePath: string, root: string, sha256: string | null, since: number): boolean {
  return outsideWriteOf(absolutePath, root, sha256, since) !== undefined;
}

async function canonicalPath(path: string): Promise<string> {
  const absolute = resolve(path);
  try { return await realpath(absolute); }
  catch {
    // A removed file: resolve the nearest existing ancestor so the key matches
    // the runtime's real workspace root (for example /tmp vs /private/tmp).
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(await canonicalPath(parent), basename(absolute));
  }
}

async function fileSha256(path: string): Promise<string | null | "*"> {
  let metadata;
  try { metadata = await lstat(path); }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : "*"; }
  if (!metadata.isFile() || metadata.size > HASH_LIMIT_BYTES) return "*";
  try {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    return hash.digest("hex");
  } catch { return "*"; }
}

/**
 * For hosts (the desktop editor and file explorer). Call `begin` before the
 * operation so a command snapshot taken mid-write cannot claim it, and the
 * returned `end` once it settles to record the exact result.
 */
export async function beginHostWorkspaceWrite(paths: readonly string[], options: { tree?: boolean } = {}): Promise<() => Promise<void>> {
  const targets = await Promise.all(paths.map(canonicalPath));
  for (const target of targets) recordWorkspaceWrite(target, "*", { tree: options.tree });
  return async () => {
    for (const target of targets) {
      const state = await fileSha256(target);
      if (state === "*") {
        // A directory (rename/copy target) or an unreadable file keeps its wildcard.
        let directory = false;
        try { directory = (await lstat(target)).isDirectory(); } catch { /* removed meanwhile */ }
        recordWorkspaceWrite(target, "*", { tree: directory || options.tree });
      } else recordWorkspaceWrite(target, state, { tree: state === null || options.tree });
    }
  };
}
