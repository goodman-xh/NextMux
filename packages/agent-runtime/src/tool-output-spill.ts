import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Where long tool and command output is saved so the model can read the parts it needs (audit OpenCode #2/#4):
 * one private folder per workspace under the OS temporary directory. It is outside the user's project (no stray
 * files in the repository) and outside `.nextmux`, which stays hidden from the model; the file tools read it in
 * every permission mode and never write it.
 */
export const TOOL_OUTPUT_SPILL_KEEP = 64;

const real = (path: string): string => { try { return realpathSync(path); } catch { return path; } };
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Real paths on both sides (macOS's temporary directory sits behind /var → /private/var), so paths compare as written. */
export function toolOutputSpillDirectory(workspaceRoot: string): string {
  return join(real(tmpdir()), "nextmux-tool-output", digest(real(workspaceRoot)).slice(0, 16));
}

/**
 * Large documents attached to a conversation, saved as Markdown that the model reads in parts with the file tools
 * instead of receiving the whole text with every request (Cherry Studio #12). One private folder per conversation:
 * runs of that conversation (and their delegated children, which inherit its id) read it in every permission mode;
 * no run writes it, and no other conversation's run reads it this way.
 */
export const ATTACHMENT_DOCUMENT_KEEP = 32;

export function attachmentDocumentDirectory(conversationId: string): string {
  return join(real(tmpdir()), "nextmux-tool-output", "documents", digest(conversationId).slice(0, 16));
}

export interface SavedAttachmentDocument {
  readonly path: string;
  readonly lines: number;
  readonly characters: number;
}

/** Saves the text under a name made from the file name and the content hash; the same text keeps the same path. */
export function saveAttachmentDocument(conversationId: string, name: string, content: string): SavedAttachmentDocument | undefined {
  if (!conversationId.trim() || !content) return undefined;
  const directory = privateSpillDirectory(attachmentDocumentDirectory(conversationId), true);
  if (!directory) return undefined;
  const stem = name.normalize("NFKC").replace(/\.[\p{L}\p{N}]{1,8}$/u, "").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^[-.]+|-+$/g, "").slice(0, 60) || "document";
  const path = join(directory, `${stem}-${digest(content).slice(0, 12)}.md`);
  try {
    writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
  } catch {
    return undefined;
  }
  pruneSpillDirectory(directory, ATTACHMENT_DOCUMENT_KEEP);
  return { path, lines: content.split(/\r?\n/).length, characters: content.length };
}

/** The folder's real path when it is a private (0700) directory owned by this user; created first when asked. */
export function privateSpillDirectory(directory: string, create: boolean): string | undefined {
  try {
    if (create) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (process.platform !== "win32") chmodSync(directory, 0o700);
    }
    const stats = lstatSync(directory);
    const ownUid = typeof process.getuid === "function" ? process.getuid() : stats.uid;
    if (!stats.isDirectory() || stats.uid !== ownUid || process.platform !== "win32" && (stats.mode & 0o077) !== 0) return undefined;
    return realpathSync(directory);
  } catch {
    return undefined;
  }
}

/** Keeps the newest files only; folders are left alone and one file that cannot be removed does not stop the rest. */
export function pruneSpillDirectory(directory: string, keep = TOOL_OUTPUT_SPILL_KEEP): void {
  let entries: { readonly name: string; readonly at: number }[];
  try {
    entries = readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
      try { return { name: entry.name, at: statSync(join(directory, entry.name)).mtimeMs }; } catch { return { name: entry.name, at: 0 }; }
    });
  } catch {
    return;
  }
  for (const old of entries.sort((left, right) => right.at - left.at).slice(keep)) {
    try { rmSync(join(directory, old.name), { force: true }); } catch { /* pruning is best effort */ }
  }
}
