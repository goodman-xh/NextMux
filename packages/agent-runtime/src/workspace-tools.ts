import { activeCheckpointRestores, recoverInterruptedCheckpointRestores } from "./checkpoint-recovery.js";
import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { narrowAgentPermission } from "./permission.js";
import { assertWorkspaceDirectoryIdentity, workspaceDirectoryIdentity } from "./workspace-identity.js";
import { wrapWorkspaceProcess } from "./workspace-process-sandbox.js";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { applyPatch as applyUnifiedPatch, createTwoFilesPatch, diffArrays, parsePatch, structuredPatch } from "diff";
import { AgentToolError, AgentToolRegistry } from "./registry.js";
import { formatProcessCommandLine } from "./process-command-line.js";
import {
  ManagedProcessRegistry,
  normalizeProcessOutputEncoding,
  type ManagedProcessRegistryLike,
  type ManagedProcessSessionLike,
  type ManagedProcessSnapshot,
} from "./process-session.js";
import { ToolExecutionLedger } from "./tool-execution-ledger.js";
import { runCheckpointRestoreTransactions, type PreparedCheckpointRestore } from "./checkpoint-transaction.js";
import { COMMAND_CHECKPOINT_EXCLUDES, captureWorkspaceSnapshot, persistCommandSnapshot, readCommandSnapshotMetadata, loadCommandSnapshot, snapshotPathExcluded, inspectSnapshotFile, writeSnapshotFile, snapshotFileSize, SNAPSHOT_MAX_BYTES, type WorkspaceSnapshotFile, type WorkspaceSnapshot } from "./workspace-snapshot.js";
import { withDirectoryIgnore, workspacePathIgnored, type WorkspaceIgnoreRule } from "./workspace-ignore.js";
import { outsideWriteOf, recordWorkspaceWrite, watchWorkspaceWrites } from "./workspace-write-journal.js";
import { DefaultWorkspaceDiagnostics, captureWorkspaceDiagnostics, workspaceDiagnosticDelta, type WorkspaceDiagnosticProvider } from "./workspace-diagnostics.js";
import { tryExtractBinaryDocumentMarkdown } from "./document-markdown.js";
import { attachmentDocumentDirectory, privateSpillDirectory, pruneSpillDirectory, toolOutputSpillDirectory } from "./tool-output-spill.js";
import type {
  AgentPermissionMode,
  ToolExecutionContext,
  ToolExecutionSummary,
  ToolHandlerResult,
} from "./types.js";

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_MAX_OUTPUT_CHARS = 80_000;
const DEFAULT_MAX_LIST_ENTRIES = 2_000;
const DEFAULT_MAX_SEARCH_FILES = 5_000;
const DEFAULT_MAX_SEARCH_RESULTS = 200;
const CHECKPOINT_MANIFEST = "manifest.json";
const fileVersionLists = new Map<string, { fingerprint: string; versions: readonly AgentFileVersion[] }>();
const ignoredDirectoryNames = new Set([".git", ".nextmux", "node_modules"]);

/** Nested instruction files surfaced when a tool touches their subdirectory (audit OpenCode #10). */
const NESTED_INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"] as const;
const NESTED_INSTRUCTION_FILE_BYTES = 256 * 1_024;
const NESTED_INSTRUCTION_FILE_CHARS = 8_192;
const NESTED_INSTRUCTION_TOTAL_CHARS = 32_768;

function encodePreservingFileFormat(original: Buffer, content: string): Buffer {
  let encoding: 'utf8' | 'utf16le' | 'utf16be' = 'utf8', text: string;
  let bom: Buffer = Buffer.alloc(0);
  try {
    if (original[0] === 0xff && original[1] === 0xfe) { encoding = 'utf16le'; bom = original.subarray(0, 2); }
    else if (original[0] === 0xfe && original[1] === 0xff) { encoding = 'utf16be'; bom = original.subarray(0, 2); }
    else if (original.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) bom = original.subarray(0, 3);
    const bytes = original.subarray(bom.length);
    text = new TextDecoder(encoding === 'utf8' ? 'utf-8' : encoding === 'utf16le' ? 'utf-16le' : 'utf-16be', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.includes('\0')) throw new Error('binary file');
  } catch { throw new AgentToolError('EDITOR_ENCODING_UNSUPPORTED', 'File encoding cannot be preserved safely; no bytes were changed'); }
  if (bom.length > 0 && content.startsWith('\uFEFF')) content = content.slice(1);
  // Only a consistently CRLF file gets CRLF everywhere. A mixed file edited through LF-normalized text
  // (apply_patch, or a whole-file write) gets each unchanged line's own ending back, so one edit never turns
  // into a whole-file line-ending diff in either direction; text that already carries CRLF is written as given.
  const hasCrlf = text.includes('\r\n');
  const hasLfOnly = /(^|[^\r])\n/.test(text);
  if (hasCrlf && !hasLfOnly) content = content.replace(/\r?\n/g, '\r\n');
  else if (hasCrlf && hasLfOnly && !content.includes('\r\n')) content = restoreMixedLineEndings(text, content);
  const encoded = Buffer.from(content, encoding === 'utf8' ? 'utf8' : 'utf16le');
  if (encoding === 'utf16be') encoded.swap16();
  return Buffer.concat([bom, encoded]);
}

/**
 * Maps the original line endings onto LF-normalized edited text: an unchanged line keeps its own ending, a line
 * that replaces another takes the replaced line's ending, and a newly inserted line the ending of the line before.
 */
function restoreMixedLineEndings(original: string, content: string): string {
  const originalLines = original.split('\n');
  const endings = originalLines.slice(0, -1).map(line => line.endsWith('\r') ? '\r\n' : '\n');
  const before = originalLines.map((line, index) => index < endings.length && line.endsWith('\r') ? line.slice(0, -1) : line);
  const after = content.split('\n');
  let previous = endings.filter(ending => ending === '\r\n').length * 2 >= endings.length ? '\r\n' : '\n';
  const afterEndings: string[] = [];
  let originalIndex = 0;
  let replaced: string[] = [];
  for (const part of diffArrays(before, after)) {
    const count = part.count ?? part.value.length;
    if (part.removed) {
      replaced = endings.slice(originalIndex, originalIndex + count);
      originalIndex += count;
      continue;
    }
    for (let offset = 0; offset < count; offset += 1) {
      if (!part.added) { previous = endings[originalIndex] ?? previous; originalIndex += 1; }
      else if (replaced[offset] !== undefined) previous = replaced[offset];
      afterEndings.push(previous);
    }
    replaced = [];
  }
  return after.map((line, index) => index < after.length - 1 ? `${line}${afterEndings[index] ?? previous}` : line).join('');
}

interface RuntimeLimits {
  readonly maxFileBytes: number;
  readonly maxOutputChars: number;
  readonly maxListEntries: number;
  readonly maxSearchFiles: number;
  readonly maxSearchResults: number;
}

export interface WorkspaceToolRuntimeOptions {
  readonly workspaceRoot: string;
  /** Identity captured by the host when verifying a multi-directory binding. */
  readonly expectedWorkspaceIdentity?: string;
  /** Nested host bindings own their own command history, not their parent's. */
  readonly commandSnapshotExcludedRoots?: readonly string[];
  readonly checkpointRoot: string;
  readonly permissionMode: AgentPermissionMode;
  readonly limits?: Partial<RuntimeLimits>;
  /** Backend-resolved profile; renderer-controlled executable paths are never accepted. */
  readonly terminalProfile?: WorkspaceTerminalProfile;
  /** Optional host-native process adapter (for example an attached Theia PTY). */
  readonly processRegistry?: ManagedProcessRegistryLike;
  /** Optional host language service; diagnostics never decide whether an edit commits. */
  readonly diagnostics?: WorkspaceDiagnosticProvider;
  /**
   * Host-provided variables for unsandboxed full-access commands, such as the
   * GitHub account the user linked for `git push` and `gh`. Sandboxed and
   * read-only runs never see them.
   */
  readonly commandEnvironment?: Readonly<Record<string, string>>;
  /**
   * Optional post-write formatter invoked after a committed workspace write,
   * apply_patch or replace_in_file. It receives the absolute file path; a
   * failure or a no-op never fails the already-committed edit, and the
   * model-visible SHA-256 is refreshed from the formatted bytes.
   */
  readonly formatFile?: (filePath: string) => Promise<void>;
}

export interface WorkspaceTerminalProfile {
  readonly id: string;
  readonly label: string;
  readonly shellPath: string;
  readonly shellArgs?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export interface AgentCheckpointDiff {
  readonly checkpointId: string;
  /** Canonical root that owns this checkpoint; needed for multi-root conversations. */
  readonly workspaceRoot?: string;
  /** Absolute external target when the edit was approved outside the root. */
  readonly externalTarget?: string;
  readonly path: string;
  readonly kind: "created" | "modified" | "deleted";
  readonly binary: boolean;
  readonly additions: number;
  readonly deletions: number;
  readonly patch: string;
  readonly truncated: boolean;
  readonly createdAt: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly beforeMode?: number | null;
  readonly afterMode?: number | null;
  readonly beforeContent?: string;
  readonly afterContent?: string;
  /** A restore preview may already match its selected immutable version. */
  readonly unchanged?: boolean;
}

export interface AgentFileVersion {
  readonly checkpointId: string;
  readonly workspaceRoot: string;
  readonly path: string;
  readonly createdAt: string;
  readonly beforeSha256: string | null;
  readonly afterSha256: string | null;
  readonly beforeMode: number | null;
  readonly afterMode: number | null;
  readonly operation?: string;
  readonly conversationId?: string;
  readonly turnId?: string;
}

interface CheckpointManifest {
  readonly version: 1;
  readonly id: string;
  readonly workspaceRoot: string;
  readonly relativePath: string;
  /** Canonical exact outside file; only host-scoped tools can create this. */
  readonly externalTarget?: string;
  readonly existed: boolean;
  readonly beforeSha256: string | null;
  readonly afterSha256: string | null;
  readonly beforeMode: number | null;
  readonly afterMode?: number | null;
  readonly createdAt: string;
}

export interface RebaseWorkspaceCheckpointStoreOptions {
  /** The already-copied checkpoint store whose manifests should be rebound. */
  readonly checkpointRoot: string;
  /** The canonical workspace root recorded when the checkpoints were created. */
  readonly sourceWorkspaceRoot: string;
  /** The independent workspace that now owns the copied checkpoints. */
  readonly targetWorkspaceRoot: string;
  /** Fork hosts must explicitly relocate approved files outside the source root. */
  readonly mapExternalTarget?: (sourcePath: string) => Promise<string>;
}

export interface RebaseWorkspaceCheckpointStoreResult {
  readonly manifestsRebased: number;
}

interface WalkEntry {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly type: "file" | "directory" | "symlink";
  readonly size?: number;
}

function record(value: unknown, label = "arguments"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentToolError("INVALID_ARGUMENTS", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(
  value: unknown,
  label: string,
  minimum = 1,
  maximum = 20_000,
): string {
  if (typeof value !== "string") {
    throw new AgentToolError("INVALID_ARGUMENTS", `${label} must be a string`);
  }
  if (value.length < minimum || value.length > maximum || value.includes("\0")) {
    throw new AgentToolError("INVALID_ARGUMENTS", `${label} has an invalid length or null byte`);
  }
  return value;
}

function integerValue(
  value: unknown,
  label: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  const coerced = typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  if (!Number.isSafeInteger(coerced) || (coerced as number) < minimum || (coerced as number) > maximum) {
    throw new AgentToolError("INVALID_ARGUMENTS", `${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return coerced as number;
}

function upperBoundedIntegerValue(
  value: unknown,
  label: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  const coerced = typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  if (!Number.isSafeInteger(coerced) || (coerced as number) < minimum) {
    throw new AgentToolError("INVALID_ARGUMENTS", `${label} must be an integer greater than or equal to ${minimum}`);
  }
  return Math.min(coerced as number, maximum);
}

function booleanValue(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }
  if (typeof value !== "boolean") {
    throw new AgentToolError("INVALID_ARGUMENTS", `${label} must be a boolean`);
  }
  return value;
}

function expandBraces(pattern: string): string[] {
  const match = /\{([^{}]+)\}/.exec(pattern);
  if (!match) return [pattern];
  const prefix = pattern.slice(0, match.index);
  const suffix = pattern.slice(match.index + match[0].length);
  return match[1]!.split(",").flatMap(part => expandBraces(`${prefix}${part.trim()}${suffix}`));
}

function globToRegExp(glob: string): RegExp {
  let regex = "^";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i]!;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          regex += "(?:.*/)?";
          i += 2;
        } else {
          regex += ".*";
          i += 1;
        }
      } else {
        regex += "[^/]*";
      }
    } else if (ch === "?") {
      regex += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      regex += `\\${ch}`;
    } else {
      regex += ch;
    }
  }
  regex += "$";
  return new RegExp(regex, "i");
}

function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (ch === "{") depth += 1;
    else if (ch === "}" && depth > 0) depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts;
}

function matchesFilePattern(relPath: string, rawPattern: string): boolean {
  const normalizedPath = portableRelative(relPath).replace(/^\.\//, "");
  const fileBase = basename(normalizedPath);
  const patterns = splitTopLevelCommas(rawPattern)
    .map(item => item.trim())
    .filter(Boolean)
    .flatMap(expandBraces);
  if (!patterns.length) return true;
  return patterns.some(pat => {
    const clean = pat.replace(/\\/g, "/").replace(/^\.\//, "");
    const target = clean.includes("/") ? normalizedPath : fileBase;
    return globToRegExp(clean).test(target);
  });
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function decodeText(buffer: Buffer, pathname: string): string {
  if (buffer.includes(0)) {
    throw new AgentToolError("BINARY_FILE", `${pathname} is not a text file`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new AgentToolError("INVALID_UTF8", `${pathname} is not valid UTF-8 text`);
  }
}

function sourceOffsetForFoldedMatch(original: string, foldedOffset: number): number {
  // Locale lowercasing may expand a source character (İ → i + combining
  // dot). Locate the source boundary instead of treating the folded UTF-16
  // position as an index into the original text. Only matched excerpts need
  // this mapping; a binary search keeps it bounded for large stream chunks.
  let lower = 0;
  let upper = original.length;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (original.slice(0, middle).toLocaleLowerCase().length <= foldedOffset) lower = middle;
    else upper = middle - 1;
  }
  return lower;
}

async function searchTextStream(path: string, needle: string, matchCase: boolean, limit: number, maxBytes: number, signal?: AbortSignal, regex?: RegExp): Promise<{ matches: { line: number; preview: string }[]; bytes: number; limited: boolean }> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const matches: { line: number; preview: string }[] = [];
  let line = 1;
  let preview = "";
  let tail = "";
  let found = false;
  let bytes = 0;
  let limited = false;
  const finishLine = (): void => {
    if (found) matches.push({ line, preview: preview.trim().slice(0, 500) });
    line += 1; preview = ""; tail = ""; found = false;
  };
  const consume = (text: string): void => {
    const pieces = text.split("\n");
    for (let index = 0; index < pieces.length; index += 1) {
      const rawPart = pieces[index]!;
      const part = index < pieces.length - 1 && rawPart.endsWith("\r") ? rawPart.slice(0, -1) : rawPart;
      preview += part.slice(0, Math.max(0, 500 - preview.length));
      const original = (tail + part).replace(/\r$/, "");
      if (!found) {
        if (regex) {
          regex.lastIndex = 0;
          const regMatch = regex.exec(original);
          if (regMatch && regMatch.index >= 0) {
            found = true;
            const start = Math.max(0, regMatch.index - 160);
            preview = original.slice(start, start + 500);
          }
        } else {
          const haystack = matchCase ? original : original.toLocaleLowerCase();
          const match = haystack.indexOf(needle);
          if (match >= 0) {
            found = true;
            // A bounded excerpt must show the match, even on a minified line or
            // when the needle spans stream chunks. Keeping only the line's head
            // made successful searches look unrelated to the requested symbol.
            const sourceMatch = matchCase || haystack.length === original.length ? match : sourceOffsetForFoldedMatch(original, match);
            const start = Math.max(0, sourceMatch - 160);
            preview = original.slice(start, start + 500);
          }
        }
      }
      tail = original.slice(-Math.max(1, (regex ? 256 : needle.length) + 160));
      if (index < pieces.length - 1) finishLine();
      if (matches.length >= limit) { limited = true; return; }
    }
  };
  for await (const raw of createReadStream(path, { highWaterMark: 64 * 1024, signal })) {
    const buffer = raw as Buffer;
    if (bytes + buffer.length > maxBytes) { limited = true; break; }
    bytes += buffer.length;
    if (buffer.includes(0)) throw new AgentToolError("BINARY_FILE", "Search target is binary");
    try { consume(decoder.decode(buffer, { stream: true })); }
    catch { throw new AgentToolError("INVALID_UTF8", "Search target is not UTF-8"); }
    if (limited) break;
  }
  if (!limited) {
    try { consume(decoder.decode()); }
    catch { throw new AgentToolError("INVALID_UTF8", "Search target is not UTF-8"); }
  }
  if (matches.length < limit && found) finishLine();
  return { matches, bytes, limited };
}

async function readLargeTextRange(
  absolutePath: string,
  pathname: string,
  startLine: number,
  requestedEndLine: number,
  maxOutputChars: number,
  signal?: AbortSignal,
): Promise<{ content: string; startLine: number; endLine: number; totalLines: number; sha256: string; truncated: boolean }> {
  const hash = createHash("sha256");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let retained = 0;
  let selectedLength = 0;
  let line = 1;
  let pendingCR = "";
  const append = (text: string): void => {
    selectedLength += text.length;
    const part = text.slice(0, Math.max(0, maxOutputChars - retained));
    if (part) { parts.push(part); retained += part.length; }
  };
  const consume = (text: string, final = false): void => {
    text = pendingCR + text;
    pendingCR = !final && text.endsWith("\r") ? "\r" : "";
    if (pendingCR) text = text.slice(0, -1);
    let offset = 0;
    for (;;) {
      const newline = text.indexOf("\n", offset);
      const end = newline < 0 ? text.length : newline;
      if (line >= startLine && line <= requestedEndLine) {
        const segment = text.slice(offset, end);
        append(newline >= 0 && segment.endsWith("\r") ? segment.slice(0, -1) : segment);
        if (newline >= 0 && line < requestedEndLine) append("\n");
      }
      if (newline < 0) break;
      line += 1;
      offset = newline + 1;
    }
  };
  try {
    for await (const chunk of createReadStream(absolutePath, { highWaterMark: 64 * 1024, signal })) {
      const buffer = chunk as Buffer;
      if (buffer.includes(0)) throw new AgentToolError("BINARY_FILE", `${pathname} is not a text file`);
      hash.update(buffer);
      consume(decoder.decode(buffer, { stream: true }));
    }
    consume(decoder.decode(), true);
  } catch (error) {
    if (signal?.aborted) throw new AgentToolError("CANCELLED", "Task was cancelled");
    if (error instanceof TypeError && (error as NodeJS.ErrnoException).code === "ERR_ENCODING_INVALID_ENCODED_DATA") {
      throw new AgentToolError("INVALID_UTF8", `${pathname} is not valid UTF-8 text`);
    }
    throw error;
  }
  if (startLine > line) throw new AgentToolError("INVALID_ARGUMENTS", `startLine must be at most ${line}`);
  return {
    content: parts.join(""), startLine, endLine: Math.min(requestedEndLine, line), totalLines: line,
    sha256: hash.digest("hex"), truncated: selectedLength > retained,
  };
}

/**
 * Secret values the host put into a command's environment (for example the GitHub token for `gh` and git) must not
 * reach the model, live tool events or logs, even when a command prints them (`env`, `echo $GH_TOKEN`). Output comes
 * in chunks of any size, so masking works on character ranges of the stream around a chunk rather than on the chunk
 * alone: a whole occurrence is masked wherever it falls, and an edge of the text that may be the start (still being
 * written) or the end (head already dropped) of a secret is masked from SECRET_EDGE characters on.
 */
const SECRET_EDGE = 3;
const SECRET_MASK = "•••";

export function secretMaskRanges(text: string, secrets: readonly string[], openStart = true, openEnd = true): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  for (const secret of secrets) {
    if (!secret) continue;
    for (let index = text.indexOf(secret); index >= 0; index = text.indexOf(secret, index + 1)) ranges.push([index, index + secret.length]);
    if (openStart && openEnd && text.length >= SECRET_EDGE && text.length < secret.length && secret.includes(text)) ranges.push([0, text.length]);
    if (openEnd) {
      for (let size = Math.min(secret.length - 1, text.length); size >= SECRET_EDGE; size -= 1) {
        if (text.endsWith(secret.slice(0, size))) { ranges.push([text.length - size, text.length]); break; }
      }
    }
    if (openStart) {
      for (let size = Math.min(secret.length - 1, text.length); size >= SECRET_EDGE; size -= 1) {
        if (text.startsWith(secret.slice(secret.length - size))) { ranges.push([0, size]); break; }
      }
    }
  }
  ranges.sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [];
  for (const [from, to] of ranges) {
    const last = merged.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

/** `text[from, to)` with every masked character run replaced by one mask. */
function maskedSlice(text: string, ranges: ReadonlyArray<readonly [number, number]>, from = 0, to = text.length): string {
  let out = "";
  let cursor = from;
  for (const [start, end] of ranges) {
    if (end <= cursor || start >= to) continue;
    out += text.slice(cursor, Math.max(cursor, start));
    out += SECRET_MASK;
    cursor = Math.min(to, end);
  }
  return out + text.slice(cursor, to);
}

export function scrubSecretValues(text: string, secrets: readonly string[]): string {
  if (!text || !secrets.length) return text;
  return maskedSlice(text, secretMaskRanges(text, secrets));
}

/**
 * Masks a run of process output chunks using the whole retained output of each stream as context, so a secret
 * printed a few characters at a time is masked in every chunk that holds part of it (audit B01-01, B06-01).
 */
export function scrubProcessChunks<T extends { readonly sequence: number; readonly stream: string; readonly text: string }>(
  wanted: readonly T[],
  retained: readonly { readonly sequence: number; readonly stream: string; readonly text: string }[],
  secrets: readonly string[],
  context: { readonly headDropped: boolean; readonly running: boolean },
): T[] {
  if (!secrets.length || !wanted.length) return [...wanted];
  const streams = new Map<string, { text: string; offsets: Map<number, readonly [number, number]> }>();
  for (const chunk of [...retained].sort((left, right) => left.sequence - right.sequence)) {
    const entry = streams.get(chunk.stream) || { text: "", offsets: new Map() };
    entry.offsets.set(chunk.sequence, [entry.text.length, entry.text.length + chunk.text.length]);
    entry.text += chunk.text;
    streams.set(chunk.stream, entry);
  }
  const ranges = new Map([...streams].map(([stream, entry]) => [stream, secretMaskRanges(entry.text, secrets, context.headDropped, context.running)]));
  return wanted.map(chunk => {
    const entry = streams.get(chunk.stream);
    const offset = entry?.offsets.get(chunk.sequence);
    if (!entry || !offset || entry.text.slice(offset[0], offset[1]) !== chunk.text) return { ...chunk, text: scrubSecretValues(chunk.text, secrets) };
    return { ...chunk, text: maskedSlice(entry.text, ranges.get(chunk.stream) || [], offset[0], offset[1]) };
  });
}

/** Live output: each chunk is masked with the preceding output of its stream as context. */
export class SecretOutputMasker {
  readonly #tails = new Map<string, string>();
  readonly #secrets: readonly string[];
  readonly #window: number;

  constructor(secrets: readonly string[]) {
    this.#secrets = secrets;
    this.#window = Math.max(0, ...secrets.map(secret => secret.length - 1));
  }

  mask(stream: string, text: string): string {
    if (!this.#secrets.length || !text) return text;
    const tail = this.#tails.get(stream) || "";
    const combined = tail + text;
    this.#tails.set(stream, combined.slice(Math.max(0, combined.length - this.#window)));
    return maskedSlice(combined, secretMaskRanges(combined, this.#secrets, false, true), tail.length);
  }
}

function redacted(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer •••")
    .replace(/\b(?:sk|key|token)[-_][A-Za-z0-9_-]{12,}\b/gi, match => `${match.slice(0, 5)}•••`);
}

function isInside(root: string, candidate: string): boolean {
  const delta = relative(root, candidate);
  return delta === "" || (!delta.startsWith(`..${sep}`) && delta !== ".." && !isAbsolute(delta));
}

function portableRelative(pathname: string): string {
  return pathname.split(sep).join("/");
}

function changedLineRange(beforeText: string, afterText: string): { readonly startLine: number; readonly endLine: number } {
  const patch = structuredPatch("before", "after", beforeText, afterText, "", "", { context: 3 });
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  for (const hunk of patch.hunks) {
    let newLine = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.startsWith("+")) {
        first = Math.min(first, newLine);
        last = Math.max(last, newLine);
        newLine += 1;
      } else if (line.startsWith("-")) {
        // A pure deletion has no new line of its own. Reveal the insertion
        // point in the modified document instead of the surrounding hunk.
        first = Math.min(first, newLine);
        last = Math.max(last, newLine);
      } else if (!line.startsWith("\\")) {
        newLine += 1;
      }
    }
  }
  const lineCount = Math.max(1, afterText.split(/\r?\n/).length);
  if (!Number.isFinite(first)) return { startLine: 1, endLine: 1 };
  const startLine = Math.max(1, Math.min(lineCount, first));
  const endLine = Math.max(startLine, Math.min(lineCount, last || first));
  return { startLine, endLine };
}

function normalizedRelativePath(value: unknown, allowRoot: boolean, workspaceRoot?: string): string {
  const candidate = allowRoot && typeof value === "string" && value.trim() === "" ? "." : value ?? ".";
  let raw = stringValue(candidate, "path", 1, 2_048).trim();
  if (workspaceRoot && isAbsolute(raw) && isInside(workspaceRoot, resolve(raw))) {
    raw = relative(workspaceRoot, resolve(raw)) || ".";
  }
  if (!raw || raw.includes("\0") || isAbsolute(raw) || /^[A-Za-z]:/.test(raw) || /^[/\\]{2}/.test(raw)) {
    throw new AgentToolError("PATH_OUTSIDE_WORKSPACE", "Path must be relative to the workspace");
  }
  // Backslash is a filename character on POSIX; interpreting it as a separator
  // would redirect an exact file read/save/restore to a different file.
  const segments = raw.split(sep === "\\" ? /[\\/]+/ : /\/+/).filter(segment => segment !== "" && segment !== ".");
  if (segments.some(segment =>
    segment === ".."
    || segment.includes(":")
    || /[. ]$/.test(segment)
    || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(segment)
  )) {
    throw new AgentToolError("PATH_OUTSIDE_WORKSPACE", "Path contains an unsafe segment");
  }
  if (segments[0]?.toLowerCase() === ".nextmux") {
    throw new AgentToolError("INTERNAL_PATH", "NextMux internal state is not exposed as a model tool");
  }
  if (!segments.length) {
    if (allowRoot) return ".";
    throw new AgentToolError("INVALID_PATH", "A file path is required");
  }
  return segments.join(sep);
}

interface ExactPatchHunk {
  readonly oldStart?: number;
  readonly lines: readonly string[];
}

const PATCH_FORMAT_HINT = 'Each change is a hunk: an "@@" line, then lines starting with " " (unchanged context), "-" (removed) or "+" (added), e.g. "@@\n export function add(a, b) {\n+export function multiply(a, b) { return a * b; }". To replace a small file whole, use workspace.write_file instead.';

function normalizedPatchPath(value: string): string {
  let pathname = value.trim().split("\t", 1)[0]?.trim() ?? "";
  if (pathname.startsWith('"') && pathname.endsWith('"')) {
    if (sep !== "\\" && pathname.includes("\\")) throw new AgentToolError("PATCH_INVALID", "Quoted escaped patch paths are ambiguous; use an unquoted exact path");
    pathname = pathname.slice(1, -1);
  }
  pathname = (sep === "\\" ? pathname.replace(/\\/g, "/") : pathname).replace(/^\.\//, "");
  if (/^[ab]\//.test(pathname)) pathname = pathname.slice(2);
  return pathname;
}

function extractAddFilePatchContent(patch: string, relativePath: string, allowBasename = false): string | false {
  const targetPath = portableRelative(relativePath);
  const matchesTarget = (pathname: string): boolean =>
    pathname === targetPath || (allowBasename && basename(pathname) === targetPath);
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const declaredPaths: string[] = [];
  const addedLines: string[] = [];
  let inAddition = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    if (line === "*** Begin Patch" || line === "*** End Patch" || line === "*** End of File") continue;
    const addHeader = /^\*\*\* (?:Add|Update) File\b:?\s*(.*)$/.exec(line);
    if (addHeader) {
      inAddition = true;
      if (addHeader[1]!.trim()) declaredPaths.push(normalizedPatchPath(addHeader[1]!));
      continue;
    }
    if (line.startsWith("--- ")) {
      const p = normalizedPatchPath(line.slice(4));
      if (p && p !== "/dev/null") {
        if (matchesTarget(p)) declaredPaths.push(p);
        else return false;
      }
      inAddition = true;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const p = normalizedPatchPath(line.slice(4));
      if (p && p !== "/dev/null") declaredPaths.push(p);
      inAddition = true;
      continue;
    }
    if (line.startsWith("@@")) {
      inAddition = true;
      continue;
    }
    if (!inAddition) {
      if (!line || line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("new file mode")) continue;
      return false;
    }
    if (line.startsWith("\\ No newline at end of file")) continue;
    if (line.startsWith("+")) {
      addedLines.push(line.slice(1));
      continue;
    }
    if (!line && lineIndex === lines.length - 1) continue;
    return false;
  }

  const uniquePaths = [...new Set(declaredPaths.filter(Boolean))];
  if (uniquePaths.some(pathname => !matchesTarget(pathname))) return false;
  if (!inAddition || !addedLines.length) return false;
  return `${addedLines.join("\n")}\n`;
}

function describeClosestPatchContext(beforeText: string, patch: string): { line: number; snippet: string } | undefined {
  const targetLines = patch
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter(line => (line.startsWith("-") || line.startsWith(" ")) && !line.startsWith("--- "))
    .map(line => line.slice(1).trim())
    .filter(Boolean);
  return describeClosestContext(beforeText, targetLines);
}

/** Closest context for a replace_in_file oldText, reported when no stage matches. */
function describeClosestReplacementContext(beforeText: string, oldText: string): { line: number; snippet: string } | undefined {
  const targetLines = oldText.replace(/\r\n/g, "\n").split("\n").map(line => line.trim()).filter(Boolean);
  return describeClosestContext(beforeText, targetLines);
}

function describeClosestContext(beforeText: string, targetLines: readonly string[]): { line: number; snippet: string } | undefined {
  const sourceLines = beforeText.replace(/\r\n/g, "\n").split("\n");
  if (!sourceLines.length || !targetLines.length) return undefined;
  const firstTarget = targetLines[0]!;
  let bestLine = 0;
  let bestScore = -1;
  for (let i = 0; i < sourceLines.length; i += 1) {
    const candidate = sourceLines[i]!.trim();
    if (!candidate) continue;
    let score = 0;
    if (candidate === firstTarget) score += 100;
    else if (candidate.includes(firstTarget) || firstTarget.includes(candidate)) score += 50;
    else {
      const tokens = firstTarget.split(/\W+/).filter(t => t.length >= 2);
      for (const tok of tokens) {
        if (candidate.includes(tok)) score += 10;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestLine = i;
    }
  }
  // A bounded +/- 25 line window with 1-based line numbers: wide enough for the
  // model to re-anchor its context, narrow enough to stay inside one message.
  const start = Math.max(0, bestLine - 25);
  const end = Math.min(sourceLines.length, bestLine + 26);
  const snippet = sourceLines
    .slice(start, end)
    .map((text, idx) => `${start + idx + 1}: ${text}`)
    .join("\n");
  return { line: bestLine + 1, snippet };
}

/** Bounded edit distance; returns `limit + 1` as soon as the bound is exceeded. */
function levenshteinWithin(left: string, right: string, limit: number): number {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > limit) return limit + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > limit) return limit + 1;
    previous = current;
  }
  return previous[right.length]!;
}

/** 0..1 similarity between a requested name and an existing sibling name. */
function nameSimilarity(requested: string, candidate: string): number {
  const left = requested.toLowerCase();
  const right = candidate.toLowerCase();
  const span = Math.max(left.length, right.length, 1);
  const distance = levenshteinWithin(left, right, span);
  let score = 1 - distance / span;
  if (left.includes(right) || right.includes(left)) score += 0.25;
  return score;
}

/**
 * Up to five existing sibling names closest to a missing path segment, so an
 * ENOENT names the likely intended file instead of a bare "does not exist".
 */
function suggestSiblingNames(missingSegment: string, siblings: readonly string[], limit = 5): string[] {
  const needle = missingSegment.toLowerCase();
  if (!needle || !siblings.length) return [];
  return siblings
    .map(candidate => ({ candidate, score: nameSimilarity(needle, candidate) }))
    .filter(entry => entry.score >= 0.45)
    .sort((left, right) => right.score - left.score || left.candidate.localeCompare(right.candidate))
    .slice(0, limit)
    .map(entry => entry.candidate);
}

/** Maps every character of a transformed string back to its original index. */
function transformWithMap(text: string, transform: (value: string) => string): { text: string; map: readonly number[] } {
  let out = "";
  const map: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const piece = transform(text[index]!);
    out += piece;
    for (let offset = 0; offset < piece.length; offset += 1) map.push(index);
  }
  return { text: out, map };
}

/** LF view of a possibly CRLF text, with each LF character's original index. */
function toLineFeedSpace(text: string): { text: string; map: readonly number[] } {
  let out = "";
  const map: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === "\r") {
      // CRLF collapses onto its LF; a lone CR is itself the line ending.
      if (text[index + 1] === "\n") continue;
      out += "\n";
      map.push(index);
      continue;
    }
    out += char;
    map.push(index);
  }
  return { text: out, map };
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Replaces in a transformed view of `text`, splicing original text between matches. */
function replaceInTransformedView(
  text: string,
  view: { text: string; map: readonly number[] },
  needle: string,
  newText: string,
): { text: string; occurrences: number } | undefined {
  if (!needle || !view.text.includes(needle)) return undefined;
  let occurrences = 0;
  let result = "";
  let cursor = 0;
  let index = view.text.indexOf(needle);
  while (index !== -1) {
    occurrences += 1;
    const start = view.map[index]!;
    const end = index + needle.length < view.map.length ? view.map[index + needle.length]! : text.length;
    result += text.slice(cursor, start) + newText;
    cursor = end;
    index = view.text.indexOf(needle, index + needle.length);
  }
  result += text.slice(cursor);
  return { text: result, occurrences };
}

/** Line-ending tolerant replacement: a CRLF file edited with LF snippets (and vice versa). */
function replaceLineEndingsTolerant(text: string, oldText: string, newText: string): { text: string; occurrences: number } | undefined {
  const view = toLineFeedSpace(text);
  const needle = toLineFeedSpace(oldText).text;
  const fileEol = text.includes("\r\n") ? "\r\n" : "\n";
  return replaceInTransformedView(text, view, needle, toLineFeedSpace(newText).text.replace(/\n/g, fileEol));
}

/** Curly-quote and non-breaking-space tolerant replacement. */
function replaceUnicodePunctuationTolerant(text: string, oldText: string, newText: string): { text: string; occurrences: number } | undefined {
  const view = transformWithMap(text, value => normalizeUnicodePunctuation(value));
  return replaceInTransformedView(text, view, normalizeUnicodePunctuation(oldText), newText);
}

/**
 * Moves one replacement line from the snippet's indentation to the file's: the snippet's base indentation becomes
 * the file's and deeper lines keep their extra depth. A line indented less than the base moves out by the same
 * amount when both use one kind of indentation (spaces or tabs); otherwise it sits under the file's indentation.
 */
function reindentLine(line: string, needleIndent: string, fileIndent: string): string {
  const lineIndent = /^[ \t]*/.exec(line)![0];
  const body = line.slice(lineIndent.length);
  if (needleIndent && lineIndent.startsWith(needleIndent)) return fileIndent + lineIndent.slice(needleIndent.length) + body;
  const uniform = (value: string): boolean => [...value].every(char => char === value[0]);
  if (needleIndent && lineIndent.length < needleIndent.length && uniform(needleIndent + lineIndent) && uniform(fileIndent)
    && (!fileIndent || fileIndent[0] === needleIndent[0])) {
    return fileIndent.slice(0, Math.max(0, fileIndent.length - (needleIndent.length - lineIndent.length))) + body;
  }
  const extra = fileIndent.startsWith(needleIndent) ? fileIndent.slice(needleIndent.length) : fileIndent;
  return extra + line;
}

/**
 * Per-line whitespace tolerant replacement: lines match after trimming, and the
 * inserted block is re-indented from the snippet's indentation to the file's
 * (reindentLine). Blank replacement lines stay blank; matches never overlap.
 */
function replaceTrimmedLines(text: string, oldText: string, newText: string): { text: string; occurrences: number } | undefined {
  const fileLines = text.split("\n");
  const needleLines = oldText.replace(/\r\n/g, "\n").split("\n");
  const trimmedNeedle = needleLines.map(line => line.trim());
  const base = trimmedNeedle.findIndex(line => line);
  if (base < 0) return undefined;
  const matches: number[] = [];
  for (let start = 0; start + trimmedNeedle.length <= fileLines.length;) {
    let matched = true;
    for (let offset = 0; offset < trimmedNeedle.length; offset += 1) {
      if (fileLines[start + offset]!.trim() !== trimmedNeedle[offset]) { matched = false; break; }
    }
    if (matched) { matches.push(start); start += trimmedNeedle.length; } else start += 1;
  }
  if (!matches.length) return undefined;
  const fileEol = text.includes("\r\n") ? "\r\n" : "\n";
  const newLines = newText.replace(/\r\n/g, "\n").split("\n");
  const needleIndent = /^[ \t]*/.exec(needleLines[base]!)![0];
  const lines = [...fileLines];
  // Replace from the last match so earlier indices stay valid.
  for (const start of [...matches].reverse()) {
    const fileIndent = /^[ \t]*/.exec(fileLines[start + base]!)![0];
    const block = newLines.map(line => (line.trim() ? reindentLine(line, needleIndent, fileIndent) : "")).join(fileEol);
    // A replaced region that ended with the file's CR keeps it, so the join below
    // still reproduces CRLF around the inserted block.
    const trailing = fileEol === "\r\n" && fileLines[start + trimmedNeedle.length - 1]!.endsWith("\r") ? "\r" : "";
    lines.splice(start, trimmedNeedle.length, block + trailing);
  }
  return { text: lines.join("\n"), occurrences: matches.length };
}

type SmartReplacementOutcome =
  | { readonly ok: true; readonly text: string; readonly occurrences: number }
  | { readonly ok: false; readonly ambiguous: boolean };
/**
 * Applies one oldText -> newText replacement with bounded smart fallbacks,
 * tried in order: exact, line endings, unicode punctuation, per-line
 * whitespace. The first stage with any match decides; more than one match
 * without replaceAll is reported as ambiguous instead of guessed at.
 */
function applySmartTextReplacement(text: string, oldText: string, newText: string, replaceAll: boolean): SmartReplacementOutcome {
  const stages: ((text: string, oldText: string, newText: string) => { text: string; occurrences: number } | undefined)[] = [
    (source, needle, replacement) => {
      const occurrences = countOccurrences(source, needle);
      return occurrences ? { text: source.split(needle).join(replacement), occurrences } : undefined;
    },
    replaceLineEndingsTolerant,
    replaceUnicodePunctuationTolerant,
    replaceTrimmedLines,
  ];
  for (const stage of stages) {
    const outcome = stage(text, oldText, newText);
    if (!outcome) continue;
    if (!replaceAll && outcome.occurrences > 1) return { ok: false, ambiguous: true };
    return { ok: true, text: outcome.text, occurrences: outcome.occurrences };
  }
  return { ok: false, ambiguous: false };
}

/** Longest single model-visible output line; one line must not consume the whole budget (audit Cline #3). */
const PROCESS_OUTPUT_LINE_CAP = 2_000;
const PROCESS_OUTPUT_LINE_TRUNCATED_MARKER = "...[line truncated]";

/** Caps every over-long line of a formatted process output at its head. */
function capProcessOutputLines(text: string, limit = PROCESS_OUTPUT_LINE_CAP): string {
  if (!text || text.length <= limit) return text;
  let capped = false;
  const lines = text.split("\n").map(line => {
    if (line.length <= limit) return line;
    capped = true;
    return `${line.slice(0, limit)}${PROCESS_OUTPUT_LINE_TRUNCATED_MARKER}`;
  });
  return capped ? lines.join("\n") : text;
}

/**
 * Bounded auto-ignore window for an approval that would let a non-full-access
 * run write outside the workspace: an unanswered dialog closes itself as
 * "not approved" instead of hanging the task (audit OpenCode #12).
 */
export const OUTSIDE_WRITE_APPROVAL_TIMEOUT_MS = 10_000;
const OUTSIDE_WRITE_PATH_LIMIT = 16;

interface CommandWriteAnalysis {
  readonly compound: boolean;
  readonly outOfWorkspaceWrite: boolean;
  readonly outOfWorkspacePaths: readonly string[];
}

/** Splits a command line on compound shell operators, skipping quoted spans. */
function splitCompoundCommand(line: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quote) {
      current += char;
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; current += char; continue; }
    if ((char === "&" || char === "|") && line[index + 1] === char) { segments.push(current); current = ""; index += 1; continue; }
    if (char === "|" || char === ";" || char === "`") { segments.push(current); current = ""; continue; }
    if (char === "$" && (line[index + 1] === "(" || line[index + 1] === "{")) { segments.push(current); current = ""; index += 1; continue; }
    current += char;
  }
  segments.push(current);
  return segments;
}

function unquoteToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Commands whose final non-flag argument is the write destination. */
const DESTINATION_WRITE_COMMANDS = new Set(["cp", "mv", "rsync", "install", "ln", "dd"]);
/** Write commands whose every non-flag argument is a write target. */
const TARGET_WRITE_COMMANDS = new Set(["rm", "rmdir", "touch", "mkdir", "tee", "truncate", "chmod", "chown", "chgrp", "setfacl"]);
/** Shells and interpreters whose `-c` body carries the real commands. */
const INTERPRETER_COMMAND_NAMES = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "python", "python3", "node", "ruby", "perl"]);

/** Path tokens a command segment could write to (relative ones resolve against the command's cwd). */
function writeTargetTokens(segment: string): string[] {
  const tokens: string[] = [];
  // Redirect targets are always writes; a ">" inside quoted text is not a redirect (its target may still be quoted).
  const unquotedText = segment.replace(/(?<!>>?\s*)(?:"[^"\n]*"|'[^'\n]*')/g, '""');
  for (const match of unquotedText.matchAll(/\d?>>?\s*("[^"\n]*"|'[^'\n]*'|[^\s|;&]+)/g)) tokens.push(unquoteToken(match[1]!));
  const words = segment.split(/\s+/).filter(Boolean);
  const commandName = basename((words[0] ?? "").replace(/^["']|["']$/g, ""));
  if (INTERPRETER_COMMAND_NAMES.has(commandName) && words.includes("-c")) {
    // A shell/interpreter body: an absolute path after a write command is a target. Operators
    // already split segments, so one segment carries one scripted command.
    let afterWriteCommand = false;
    for (const word of words.slice(1)) {
      const bare = basename(word.replace(/^["']|["']$/g, ""));
      if (TARGET_WRITE_COMMANDS.has(bare) || DESTINATION_WRITE_COMMANDS.has(bare)) { afterWriteCommand = true; continue; }
      if (!afterWriteCommand || word.startsWith("-")) continue;
      tokens.push(unquoteToken(word));
    }
  } else if (TARGET_WRITE_COMMANDS.has(commandName)) {
    for (const word of words.slice(1)) if (!word.startsWith("-")) tokens.push(unquoteToken(word));
  } else if (DESTINATION_WRITE_COMMANDS.has(commandName)) {
    const destination = words.slice(1).filter(word => !word.startsWith("-")).at(-1);
    if (destination) tokens.push(unquoteToken(destination));
  }
  return tokens.filter(token => token && !token.startsWith("-"));
}

/** Redirect and device targets that are not files: discarding or duplicating output writes nothing outside. */
function isNonFileTarget(token: string): boolean {
  return /^&\d*-?$/.test(token) || /^\/dev\/(?:null|zero|full|random|urandom|stdout|stderr|stdin|tty|fd\/\d+)$/.test(token)
    || /^(?:nul|con|prn|aux|com\d|lpt\d)(?:\.[^\\/]*)?$/i.test(token);
}

/**
 * Splits a compound command line and reports whether any of its parts could
 * write outside the workspace, so the permission request can show it (audit
 * OpenCode #12). Advisory only: this runtime still spawns one executable.
 */
function analyzeCommandForOutsideWrites(command: string, args: readonly string[], workspaceRoot: string, cwd: string): CommandWriteAnalysis {
  const line = [command, ...args].join(" ");
  const segments = splitCompoundCommand(line);
  const outside: string[] = [];
  for (const segment of segments) {
    for (const token of writeTargetTokens(segment)) {
      // A variable or glob cannot be resolved here; a device or descriptor is not a file.
      if (isNonFileTarget(token) || /[$*?`]/.test(token)) continue;
      const absolute = token === "~" ? homedir() : token.startsWith("~/") ? join(homedir(), token.slice(2)) : resolve(cwd, token);
      if (isInside(workspaceRoot, absolute) || outside.includes(absolute)) continue;
      outside.push(absolute);
      if (outside.length >= OUTSIDE_WRITE_PATH_LIMIT) break;
    }
    if (outside.length >= OUTSIDE_WRITE_PATH_LIMIT) break;
  }
  return { compound: segments.length > 1, outOfWorkspaceWrite: outside.length > 0, outOfWorkspacePaths: outside };
}

/** Bounds an out-of-workspace write approval; an unanswered request auto-ignores. */
async function boundedOutsideWriteApproval(request: (() => Promise<boolean> | undefined) | undefined, timeoutMs: number): Promise<boolean> {
  if (!request) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request(),
      new Promise<boolean>(resolveIgnore => { timer = setTimeout(() => resolveIgnore(false), timeoutMs); }),
    ]) ?? false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeUnicodePunctuation(text: string): string {
  return text
    .replace(/[\u2018-\u201B]/g, "'")
    .replace(/[\u201C-\u201F]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u00A0/g, " ");
}

/**
 * Applies one-file model-generated patches without fuzzy matching. Besides a
 * standard unified diff, models commonly emit the `*** Begin Patch` /
 * `*** Update File` envelope and occasionally miscount hunk lengths. The
 * `diff` parser correctly rejects those inputs, so this fallback derives each
 * change from its exact context instead. Ambiguous or mismatched context still
 * fails rather than guessing where to write.
 */
function applyExactPatchFallback(beforeText: string, patch: string, relativePath: string, allowBasename = false): string | false {
  const targetPath = portableRelative(relativePath);
  const matchesTarget = (pathname: string): boolean =>
    pathname === targetPath || (allowBasename && basename(pathname) === targetPath);
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const declaredPaths: string[] = [];
  const hunks: ExactPatchHunk[] = [];
  let current: { oldStart?: number; lines: string[] } | undefined;
  let sawEnvelope = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    if (line === "*** Begin Patch" || line === "*** End Patch") {
      sawEnvelope = true;
      continue;
    }
    // Models also write the header without its colon ("*** Update File README.md"), or without a path at all
    // (DeepSeek V3.2, round 33): the tool's own path argument names the file then.
    const update = /^\*\*\* Update File\b:?\s*(.*)$/.exec(line);
    if (update) {
      sawEnvelope = true;
      if (update[1]!.trim()) declaredPaths.push(normalizedPatchPath(update[1]!));
      current = undefined;
      continue;
    }
    if (/^\*\*\* (?:Add File|Delete File|Move to)\b/.test(line)) {
      throw new AgentToolError("PATCH_INVALID", "apply_patch can update only its declared existing target file");
    }
    if (line === "*** End of File") continue;
    // The envelope format lets the first hunk of a file start without an "@@" line.
    if (!current && sawEnvelope && /^[ +-]/.test(line) && !line.startsWith("--- ") && !line.startsWith("+++ ")) {
      current = { lines: [] };
      hunks.push(current);
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const pathname = normalizedPatchPath(line.slice(4));
      if (pathname && pathname !== "/dev/null") declaredPaths.push(pathname);
      continue;
    }
    if (line.startsWith("@@")) {
      const match = /^@@\s+-(\d+)(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/.exec(line);
      current = { ...(match ? { oldStart: Number.parseInt(match[1]!, 10) } : {}), lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) {
      if (!line || line.startsWith("diff ") || line.startsWith("index ")) continue;
      throw new AgentToolError("PATCH_INVALID", `Unexpected patch line before any "@@" hunk header: ${line.slice(0, 80)}. ${PATCH_FORMAT_HINT}`);
    }
    if (line.startsWith("\\ No newline at end of file")) continue;
    if (line.startsWith(" ") || line.startsWith("-") || line.startsWith("+")) {
      current.lines.push(line);
      continue;
    }
    // A final empty line is the patch transport's trailing newline; an interior empty line inside a hunk is a blank context line.
    if (!line) {
      if (lineIndex === lines.length - 1) continue;
      current.lines.push(" ");
      continue;
    }
    throw new AgentToolError("PATCH_INVALID", `Invalid patch hunk line (no " ", "-" or "+" prefix): ${line.slice(0, 80)}. ${PATCH_FORMAT_HINT}`);
  }

  const uniquePaths = [...new Set(declaredPaths.filter(Boolean))];
  if (uniquePaths.some(pathname => !matchesTarget(pathname)) || uniquePaths.length > (sawEnvelope ? 1 : 2)) {
    throw new AgentToolError("PATCH_INVALID", "Patch headers do not match the declared target path");
  }
  if (!hunks.length || hunks.some(hunk => hunk.lines.length === 0)) {
    throw new AgentToolError("PATCH_INVALID", "Patch does not contain a complete update hunk");
  }

  const newline = beforeText.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalNewline = /\r?\n$/.test(beforeText);
  const source = beforeText.replace(/\r\n/g, "\n").split("\n");
  if (hadFinalNewline) source.pop();
  let searchStart = 0;
  let lineDelta = 0;

  const selectMatch = (matches: readonly number[], hintedIndex: number): number => {
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1 && hintedIndex >= 0) {
      if (matches.includes(hintedIndex)) return hintedIndex;
      const sorted = [...matches].sort((a, b) => Math.abs(a - hintedIndex) - Math.abs(b - hintedIndex));
      if (Math.abs(sorted[0]! - hintedIndex) < Math.abs(sorted[1]! - hintedIndex)) {
        return sorted[0]!;
      }
    }
    return -1;
  };

  const matchesAt = (index: number, expected: readonly string[]): boolean =>
    index >= 0
    && index + expected.length <= source.length
    && expected.every((line, offset) => source[index + offset] === line);

  const findMatches = (expected: readonly string[], start: number): number[] => {
    const matches: number[] = [];
    for (let index = Math.max(0, start); index + expected.length <= source.length; index += 1) {
      if (matchesAt(index, expected)) matches.push(index);
      if (matches.length >= 50) break;
    }
    return matches;
  };

  const matchesTrimmedEndAt = (index: number, expected: readonly string[]): boolean =>
    index >= 0
    && index + expected.length <= source.length
    && expected.every((line, offset) => source[index + offset]!.trimEnd() === line.trimEnd());

  const findTrimmedEndMatches = (expected: readonly string[], start: number): number[] => {
    const matches: number[] = [];
    for (let index = Math.max(0, start); index + expected.length <= source.length; index += 1) {
      if (matchesTrimmedEndAt(index, expected)) matches.push(index);
      if (matches.length >= 50) break;
    }
    return matches;
  };

  const matchesTrimmedAt = (index: number, expected: readonly string[]): boolean =>
    index >= 0
    && index + expected.length <= source.length
    && expected.every((line, offset) => source[index + offset]!.trim() === line.trim());

  const findTrimmedMatches = (expected: readonly string[], start: number): number[] => {
    if (!expected.some(line => line.trim().length > 0)) return [];
    const matches: number[] = [];
    for (let index = Math.max(0, start); index + expected.length <= source.length; index += 1) {
      if (matchesTrimmedAt(index, expected)) matches.push(index);
      if (matches.length >= 50) break;
    }
    return matches;
  };

  const matchesUnicodeAt = (index: number, expected: readonly string[]): boolean =>
    index >= 0
    && index + expected.length <= source.length
    && expected.every((line, offset) =>
      normalizeUnicodePunctuation(source[index + offset]!.trim()) === normalizeUnicodePunctuation(line.trim())
    );

  const findUnicodeMatches = (expected: readonly string[], start: number): number[] => {
    if (!expected.some(line => line.trim().length > 0)) return [];
    const matches: number[] = [];
    for (let index = Math.max(0, start); index + expected.length <= source.length; index += 1) {
      if (matchesUnicodeAt(index, expected)) matches.push(index);
      if (matches.length >= 50) break;
    }
    return matches;
  };

  const reindentHunkNewLines = (hunkLines: readonly string[], matchedIndex: number): string[] => {
    let shift: { addPrefix: string; removeLen: number } | undefined;
    let oldOffset = 0;
    for (const rawLine of hunkLines) {
      if (rawLine.startsWith("+")) continue;
      const expLine = rawLine.slice(1);
      const srcLine = source[matchedIndex + oldOffset]!;
      oldOffset += 1;
      if (!expLine.trim() || !rawLine.startsWith("-")) continue;
      const srcIndent = /^[ \t]*/.exec(srcLine)?.[0] ?? "";
      const expIndent = /^[ \t]*/.exec(expLine)?.[0] ?? "";
      if (srcIndent.startsWith(expIndent)) {
        shift = { addPrefix: srcIndent.slice(expIndent.length), removeLen: 0 };
      } else if (expIndent.startsWith(srcIndent)) {
        shift = { addPrefix: "", removeLen: expIndent.length - srcIndent.length };
      }
      break;
    }
    if (!shift) {
      oldOffset = 0;
      for (const rawLine of hunkLines) {
        if (rawLine.startsWith("+")) continue;
        const expLine = rawLine.slice(1);
        const srcLine = source[matchedIndex + oldOffset]!;
        oldOffset += 1;
        if (!expLine.trim()) continue;
        const srcIndent = /^[ \t]*/.exec(srcLine)?.[0] ?? "";
        const expIndent = /^[ \t]*/.exec(expLine)?.[0] ?? "";
        if (srcIndent.startsWith(expIndent)) {
          shift = { addPrefix: srcIndent.slice(expIndent.length), removeLen: 0 };
        } else if (expIndent.startsWith(srcIndent)) {
          shift = { addPrefix: "", removeLen: expIndent.length - srcIndent.length };
        }
        break;
      }
    }
    const rebuilt: string[] = [];
    let cursor = 0;
    for (const rawLine of hunkLines) {
      if (rawLine.startsWith(" ")) {
        rebuilt.push(source[matchedIndex + cursor]!);
        cursor += 1;
      } else if (rawLine.startsWith("-")) {
        cursor += 1;
      } else if (rawLine.startsWith("+")) {
        const added = rawLine.slice(1);
        if (!added.trim() || !shift) {
          rebuilt.push(added);
        } else if (shift.addPrefix) {
          rebuilt.push(`${shift.addPrefix}${added}`);
        } else if (shift.removeLen > 0 && added.slice(0, shift.removeLen).trim() === "") {
          rebuilt.push(added.slice(shift.removeLen));
        } else {
          rebuilt.push(added);
        }
      }
    }
    return rebuilt;
  };

  const resolveHunkMatch = (
    oldLines: readonly string[],
    hunkLines: readonly string[],
    hintedIndex: number,
    start: number,
  ): { index: number; newLines?: string[] } => {
    if (!oldLines.length) return { index: -1 };
    if (hintedIndex >= start && matchesAt(hintedIndex, oldLines)) return { index: hintedIndex };
    const exact = selectMatch(findMatches(oldLines, start), hintedIndex);
    if (exact >= 0) return { index: exact };
    // Stage 2: Trailing-whitespace tolerant deterministic match
    const ws = selectMatch(findTrimmedEndMatches(oldLines, start), hintedIndex);
    if (ws >= 0) return { index: ws };
    // Stage 3: Relative indentation-shifted deterministic match
    const indent = selectMatch(findTrimmedMatches(oldLines, start), hintedIndex);
    if (indent >= 0) return { index: indent, newLines: reindentHunkNewLines(hunkLines, indent) };
    // Stage 4: Unicode punctuation normalized deterministic match
    const unicode = selectMatch(findUnicodeMatches(oldLines, start), hintedIndex);
    if (unicode >= 0) return { index: unicode, newLines: reindentHunkNewLines(hunkLines, unicode) };
    return { index: -1 };
  };

  for (const hunk of hunks) {
    const oldLines = hunk.lines.filter(line => !line.startsWith("+")).map(line => line.slice(1));
    let newLines = hunk.lines.filter(line => !line.startsWith("-")).map(line => line.slice(1));
    const hintedIndex = hunk.oldStart === undefined ? -1 : hunk.oldStart - 1 + lineDelta;
    let matched = resolveHunkMatch(oldLines, hunk.lines, hintedIndex, searchStart);
    if (matched.index < 0 && searchStart > 0 && oldLines.length) {
      matched = resolveHunkMatch(oldLines, hunk.lines, hintedIndex, 0);
    }
    let index = matched.index;
    if (matched.newLines) newLines = matched.newLines;
    if (index < 0 && !oldLines.length && hintedIndex >= 0 && hintedIndex <= source.length) {
      index = hintedIndex;
    }
    if (index < 0) {
      // Treat an already-applied exact replacement as an auditable no-op.
      const appliedMatches = newLines.length ? findMatches(newLines, searchStart) : [];
      const appliedIndex = selectMatch(
        appliedMatches.length ? appliedMatches : (newLines.length && searchStart > 0 ? findMatches(newLines, 0) : []),
        hintedIndex,
      );
      if (appliedIndex >= 0) {
        searchStart = appliedIndex + newLines.length;
        continue;
      }
      return false;
    }
    source.splice(index, oldLines.length, ...newLines);
    searchStart = index + newLines.length;
    lineDelta += newLines.length - oldLines.length;
  }

  const result = source.join(newline);
  return hadFinalNewline ? `${result}${newline}` : result;
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

/**
 * One write at a time to the same file from every runtime in this process (two conversations may share a project).
 * Inside it the content an edit was prepared from is checked once more, so a writer that got there first is reported
 * as STALE_WRITE instead of being overwritten in the gap between that check and the write.
 */
const fileWriteTails = new Map<string, Promise<void>>();
async function withFileWriteLock<T>(pathname: string, action: () => Promise<T>): Promise<T> {
  const previous = fileWriteTails.get(pathname) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.then(() => gate);
  fileWriteTails.set(pathname, tail);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (fileWriteTails.get(pathname) === tail) fileWriteTails.delete(pathname);
  }
}

async function atomicWrite(pathname: string, content: Buffer, mode?: number, signal?: AbortSignal): Promise<void> {
  const temporary = join(dirname(pathname), `.${randomUUID()}.nextmux.tmp`);
  const handle = await open(temporary, "wx", mode);
  try {
    await handle.writeFile(content);
    if (mode !== undefined) await handle.chmod(mode & 0o7777);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (signal?.aborted) throw new AgentToolError("CANCELLED", "Task was cancelled before committing the file");
    await rename(temporary, pathname);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch {
      // Best effort cleanup; the original error is more useful.
    }
    throw error;
  }
}

/**
 * Rebind an independently copied checkpoint store to a new workspace.
 *
 * Checkpoint manifests deliberately contain the canonical workspace root so a
 * checkpoint copied by accident cannot mutate a different checkout. A
 * conversation fork is the one intentional exception: the workspace and its
 * checkpoint store are copied together, then every manifest is validated and
 * rebound before the fork can be restored. Callers must perform this operation
 * on a private/uncommitted copy of the store so a failed write can be discarded.
 */
export async function rebaseWorkspaceCheckpointStore(
  options: RebaseWorkspaceCheckpointStoreOptions,
): Promise<RebaseWorkspaceCheckpointStoreResult> {
  const checkpointRoot = await realpath(resolve(options.checkpointRoot));
  const sourceWorkspaceRoot = await realpath(resolve(options.sourceWorkspaceRoot));
  const targetWorkspaceRoot = await realpath(resolve(options.targetWorkspaceRoot));
  if (!(await stat(checkpointRoot)).isDirectory()
    || !(await stat(sourceWorkspaceRoot)).isDirectory()
    || !(await stat(targetWorkspaceRoot)).isDirectory()) {
    throw new AgentToolError("INVALID_CHECKPOINT", "Checkpoint rebase roots must be directories");
  }
  if (sourceWorkspaceRoot === targetWorkspaceRoot) return { manifestsRebased: 0 };

  const directories = await readdir(checkpointRoot, { withFileTypes: true });
  if (directories.length > 10_000) {
    throw new AgentToolError("INVALID_CHECKPOINT", "Checkpoint store is too large to rebase safely");
  }
  const rewrites: Array<{ readonly path: string; readonly manifest: CheckpointManifest }> = [];
  for (const entry of directories) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const directory = resolve(checkpointRoot, entry.name);
    if (!isInside(checkpointRoot, directory)) {
      throw new AgentToolError("INVALID_CHECKPOINT", "Checkpoint directory is outside the checkpoint store");
    }
    const manifestPath = join(directory, CHECKPOINT_MANIFEST);
    let raw: string;
    try {
      raw = await readFile(manifestPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    let manifest: CheckpointManifest;
    try {
      manifest = JSON.parse(raw) as CheckpointManifest;
    } catch {
      throw new AgentToolError("INVALID_CHECKPOINT", `Checkpoint manifest is not valid JSON: ${entry.name}`);
    }
    const target = typeof manifest.relativePath === "string"
      ? resolve(targetWorkspaceRoot, manifest.relativePath)
      : targetWorkspaceRoot;
    if (manifest.version !== 1 || manifest.id !== entry.name
      || typeof manifest.relativePath !== "string" || manifest.relativePath.includes("\0")
      || (!manifest.externalTarget && !isInside(targetWorkspaceRoot, target))
      || (manifest.externalTarget !== undefined && (!isAbsolute(manifest.externalTarget) || manifest.externalTarget !== manifest.relativePath))
      || manifest.workspaceRoot !== sourceWorkspaceRoot && manifest.workspaceRoot !== targetWorkspaceRoot) {
      throw new AgentToolError("INVALID_CHECKPOINT", `Checkpoint metadata cannot be rebound safely: ${entry.name}`);
    }
    if (manifest.workspaceRoot === sourceWorkspaceRoot) {
      let externalTarget: string | undefined;
      if (manifest.externalTarget) {
        externalTarget = await options.mapExternalTarget?.(manifest.externalTarget);
        if (!externalTarget || !isAbsolute(externalTarget) || externalTarget === manifest.externalTarget || externalTarget.includes("\0")) {
          throw new AgentToolError("INVALID_CHECKPOINT", "A branch must isolate external checkpoint files before restoring them");
        }
      }
      rewrites.push({ path: manifestPath, manifest: { ...manifest, workspaceRoot: targetWorkspaceRoot,
        ...(externalTarget ? { externalTarget, relativePath: externalTarget } : {}) } });
    }
  }

  for (const rewrite of rewrites) {
    await atomicWrite(rewrite.path, Buffer.from(JSON.stringify(rewrite.manifest, undefined, 2), "utf8"));
  }
  return { manifestsRebased: rewrites.length };
}

export class WorkspaceToolRuntime {
  readonly #workspaceRoot: string;
  readonly #workspaceIdentity: string;
  readonly #checkpointRoot: string;
  readonly #permissionMode: AgentPermissionMode;
  readonly #limits: RuntimeLimits;
  readonly #terminalProfile?: Required<WorkspaceTerminalProfile>;
  #commandEnvironment: Readonly<Record<string, string>> = {};

  /** Values of the injected environment that are credentials (see scrubSecretValues). */
  #secretValues(): string[] {
    return Object.entries(this.#commandEnvironment)
      .filter(([name, value]) => /TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|_KEY$/i.test(name) && typeof value === "string" && value.length >= 8)
      .map(([, value]) => value);
  }

  #scrubSnapshot(snapshot: ManagedProcessSnapshot, session: ManagedProcessSessionLike): ManagedProcessSnapshot {
    const secrets = this.#secretValues();
    if (!secrets.length) return snapshot;
    const retained = session.snapshot();
    return { ...snapshot, chunks: scrubProcessChunks(snapshot.chunks, retained.chunks, secrets,
      { headDropped: retained.truncated || retained.firstAvailableSequence > 1, running: retained.running }) };
  }
  readonly #processes: ManagedProcessRegistryLike;
  readonly #processStop = new AbortController();
  #stopProcessesPromise?: Promise<void>;
  readonly #executionLedger: ToolExecutionLedger;
  readonly #diagnostics: WorkspaceDiagnosticProvider;
  readonly #formatFile?: (filePath: string) => Promise<void>;
  readonly #createdCheckpointIds: string[] = [];
  #lastObservedSha256 = new Map<string, string>();
  #externalFilePath?: string;
  #checkpointOwnerRoot?: string;
  #sandboxDirectory?: string;
  /** App-owned folder of spilled command output (realpath), readable by the model in every mode and never writable. */
  #spillDirectory?: string;
  readonly #sandboxedProcesses = new Set<string>();
  readonly #commandSessions = new Map<string, ManagedProcessSessionLike>();
  readonly #observedCommands = new Set<string>();
  #commandSnapshotExcludedRoots: readonly string[] = [];
  #commandBaseline: WorkspaceSnapshot | undefined;
  #snapshotTail: Promise<void> = Promise.resolve();
  #commandSnapshotWarnings: string[] = [];
  #commandSnapshotDirectory: string;
  #commandSnapshotGeneration: string = randomUUID();
  /** When the current command baseline capture began; later writes by others are not the command's. */
  #commandBaselineAt = 0;
  /** Paths whose baseline was moved to another writer's result during the current command, with that result. */
  readonly #adoptedWrites = new Map<string, string | null>();
  #commandSnapshotRunId = "command-recovery";
  readonly #recoveryWarnings: string[] = [];
  readonly #commandResults = new Map<string, { checkpointIds: string[]; changedPaths: string[]; checkpointCoverage: { complete: boolean; excluded: readonly string[]; warnings: string[] } }>();
  /** Nested instruction files already surfaced to the model; each is injected once per runtime. */
  readonly #injectedInstructionFiles = new Set<string>();

  private constructor(
    workspaceRoot: string,
    workspaceIdentity: string,
    checkpointRoot: string,
    permissionMode: AgentPermissionMode,
    limits: RuntimeLimits,
    executionLedger: ToolExecutionLedger,
    terminalProfile?: Required<WorkspaceTerminalProfile>,
    processRegistry: ManagedProcessRegistryLike = new ManagedProcessRegistry(),
    diagnostics?: WorkspaceDiagnosticProvider,
    formatFile?: (filePath: string) => Promise<void>,
  ) {
    this.#workspaceRoot = workspaceRoot;
    this.#workspaceIdentity = workspaceIdentity;
    this.#checkpointRoot = checkpointRoot;
    this.#permissionMode = permissionMode;
    this.#limits = limits;
    this.#terminalProfile = terminalProfile;
    this.#processes = processRegistry;
    this.#executionLedger = executionLedger;
    this.#diagnostics = diagnostics ?? new DefaultWorkspaceDiagnostics(workspaceRoot);
    this.#formatFile = formatFile;
    this.#commandSnapshotDirectory = join(checkpointRoot, ".pending-commands", randomUUID());
    // Held weakly: a runtime nobody disposes still goes away, and its listener with it.
    const self = new WeakRef(this);
    const stop = watchWorkspaceWrites((path, sha256) => {
      const runtime = self.deref();
      if (!runtime) { stop(); return; }
      void runtime.#adoptOutsideWrite(path, sha256).catch(() => undefined);
    });
  }

  /** Another writer settled a file while a command runs here: the command's baseline for it becomes that result. */
  async #adoptOutsideWrite(absolutePath: string, sha256: string | null): Promise<void> {
    if (!this.#commandBaseline || !(this.#commandSessions.size || this.#observedCommands.size)) return;
    const relativePath = relative(this.#workspaceRoot, absolutePath);
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) return;
    const key = portableRelative(relativePath);
    await this.#withSnapshotLock(async () => {
      const baseline = this.#commandBaseline;
      if (!baseline || !(this.#commandSessions.size || this.#observedCommands.size) || snapshotPathExcluded(baseline, key)) return;
      if (sha256 === null) {
        let changed = false;
        for (const path of [...baseline.files.keys()]) if (path === key || path.startsWith(`${key}/`)) { baseline.files.delete(path); this.#adoptedWrites.set(path, null); changed = true; }
        if (!changed) return;
      } else {
        if (baseline.files.get(key)?.sha256 === sha256) { this.#adoptedWrites.set(key, sha256); return; }
        let file: WorkspaceSnapshotFile;
        try { file = await inspectSnapshotFile(absolutePath, { objectDirectory: join(this.#commandSnapshotDirectory, "objects"), memory: false, maxBytes: SNAPSHOT_MAX_BYTES }); }
        catch { return; }
        if (file.sha256 !== sha256) return;
        baseline.files.set(key, file);
        this.#adoptedWrites.set(key, sha256);
      }
      await this.#persistCommandBaseline();
    });
  }

  static async create(options: WorkspaceToolRuntimeOptions): Promise<WorkspaceToolRuntime> {
    const workspaceRoot = await realpath(resolve(options.workspaceRoot));
    if (options.expectedWorkspaceIdentity && workspaceRoot !== resolve(options.workspaceRoot)) {
      throw new AgentToolError("STALE_WORKSPACE_BINDING", `Workspace path changed while verifying its binding: ${options.workspaceRoot}`);
    }
    const workspaceIdentity = options.expectedWorkspaceIdentity ?? await workspaceDirectoryIdentity(workspaceRoot);
    await assertWorkspaceDirectoryIdentity(workspaceRoot, workspaceIdentity);
    await mkdir(resolve(options.checkpointRoot), { recursive: true });
    const checkpointRoot = await realpath(resolve(options.checkpointRoot));
    const positive = (value: number | undefined, fallback: number): number =>
      Number.isSafeInteger(value) && (value as number) > 0 ? value as number : fallback;
    const selectedProfile = options.terminalProfile;
    const terminalArgumentsValid = selectedProfile?.shellArgs === undefined
      || Array.isArray(selectedProfile.shellArgs) && selectedProfile.shellArgs.length <= 16
      && selectedProfile.shellArgs.every(value => typeof value === "string" && value.length <= 4_096 && !/\0/.test(value));
    const environmentValid = (env: Readonly<Record<string, string>> | undefined): boolean => env === undefined
      || Object.entries(env).length <= 32
      && Object.entries(env).every(([name, value]) => /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)
        && typeof value === "string" && value.length <= 8_192 && !/\0/.test(value));
    const terminalEnvironmentValid = environmentValid(selectedProfile?.env);
    if (!environmentValid(options.commandEnvironment)) {
      throw new AgentToolError("INVALID_COMMAND_ENVIRONMENT", "Host command environment is invalid");
    }
    if (selectedProfile && (!/^[A-Za-z0-9._:-]{1,80}$/.test(selectedProfile.id)
      || !selectedProfile.label.trim() || selectedProfile.label.length > 120 || /[\r\n\0]/.test(selectedProfile.label)
      || !selectedProfile.shellPath.trim() || selectedProfile.shellPath.length > 1_024 || /[\r\n\0]/.test(selectedProfile.shellPath)
      || !terminalArgumentsValid || !terminalEnvironmentValid)) {
      throw new AgentToolError("INVALID_TERMINAL_PROFILE", "Selected terminal profile is invalid");
    }
    const executionLedger = await ToolExecutionLedger.open({
      journalPath: join(checkpointRoot, "tool-executions.ndjson"),
    });
    const runtime = new WorkspaceToolRuntime(workspaceRoot, workspaceIdentity, checkpointRoot, options.permissionMode, {
      maxFileBytes: positive(options.limits?.maxFileBytes, DEFAULT_MAX_FILE_BYTES),
      maxOutputChars: positive(options.limits?.maxOutputChars, DEFAULT_MAX_OUTPUT_CHARS),
      maxListEntries: positive(options.limits?.maxListEntries, DEFAULT_MAX_LIST_ENTRIES),
      maxSearchFiles: positive(options.limits?.maxSearchFiles, DEFAULT_MAX_SEARCH_FILES),
      maxSearchResults: positive(options.limits?.maxSearchResults, DEFAULT_MAX_SEARCH_RESULTS),
    }, executionLedger, selectedProfile ? {
      id: selectedProfile.id,
      label: selectedProfile.label.trim(),
      shellPath: selectedProfile.shellPath,
      shellArgs: [...(selectedProfile.shellArgs || [])],
      env: { ...(selectedProfile.env || {}) },
    } : undefined, options.processRegistry, options.diagnostics, options.formatFile);
    runtime.#commandSnapshotExcludedRoots = options.commandSnapshotExcludedRoots || [];
    runtime.#commandEnvironment = { ...(options.commandEnvironment || {}) };
    await runtime.assertWorkspaceIdentity();
    await recoverInterruptedCheckpointRestores(checkpointRoot, workspaceRoot);
    await runtime.#recoverInterruptedCommands();
    await runtime.assertWorkspaceIdentity();
    return runtime;
  }

  async assertWorkspaceIdentity(): Promise<void> {
    await assertWorkspaceDirectoryIdentity(this.#workspaceRoot, this.#workspaceIdentity);
  }

  get permissionMode(): AgentPermissionMode {
    return this.#permissionMode;
  }

  registerTools(registry: AgentToolRegistry): void {
    registry.useExecutionLedger(this.#executionLedger);
    registry.register({
      name: "workspace.list_files",
      description: "List files and directories inside the current workspace without following symlinks.",
      requiredPermission: "read_only",
      source: "builtin",
      concurrencySafe: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          maxDepth: { type: "integer", minimum: 0, maximum: 8 },
          limit: { type: "integer", minimum: 1, maximum: this.#limits.maxListEntries },
          pattern: { type: "string" },
          include: { type: "string" },
        },
      },
    }, (input, context) => this.#withFileScope("workspace.list_files", input, context, (runtime, scopedInput) => runtime.#listFiles(scopedInput, context)));

    registry.register({
      name: "workspace.read_file",
      description: "Read UTF-8 text and return its SHA-256 for safe follow-up writes. Set startLine/endLine to inspect a bounded range in a large file.",
      requiredPermission: "read_only",
      source: "builtin",
      concurrencySafe: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["path"],
        properties: {
          path: { type: "string" },
          startLine: { type: "integer", minimum: 1 },
          endLine: { type: "integer", minimum: 1 },
        },
      },
    }, (input, context) => this.#withFileScope("workspace.read_file", input, context, (runtime, scopedInput) => runtime.#readFile(scopedInput, context)));

    registry.register({
      name: "workspace.search_text",
      description: "Search literal text or regular expressions across bounded UTF-8 files in the workspace.",
      requiredPermission: "read_only",
      source: "builtin",
      concurrencySafe: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1, maxLength: 256 },
          path: { type: "string" },
          matchCase: { type: "boolean" },
          regex: { type: "boolean" },
          include: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: this.#limits.maxSearchResults },
        },
      },
    }, (input, context) => this.#withFileScope("workspace.search_text", input, context, (runtime, scopedInput) => runtime.#searchText(scopedInput, context)));

    registry.register({
      name: "workspace.project_map",
      description: "Get a bounded, on-demand project structure map. JavaScript/TypeScript use the TypeScript parser; Python/Go/Rust use bundled Tree-sitter grammars. Returns syntax-tree definitions/imports, not resolved types or references. Other languages are listed as files only. Pass query to rank relevant paths/symbols. Partial coverage is explicit; narrow path when truncated.",
      requiredPermission: "read_only",
      source: "builtin",
      concurrencySafe: true,
      inputSchema: {
        type: "object", additionalProperties: false,
        properties: { path: { type: "string" }, query: { type: "string", maxLength: 256 }, limit: { type: "integer", minimum: 1, maximum: 100 } },
      },
    }, (input, context) => this.#withFileScope("workspace.project_map", input, context, (runtime, scopedInput) => runtime.#projectMap(scopedInput, context)));

    registry.register({
      name: "workspace.apply_patch",
      description: "Apply a unified diff or common *** Begin Patch / *** Update File envelope to one existing UTF-8 workspace file after exact SHA-256 validation. Hunk context is matched deterministically, never fuzzily. Prefer this for focused edits; do not run apply_patch as a process command. A patch whose desired content is already present succeeds as an unchanged no-op.",
      requiredPermission: "workspace_write",
      source: "builtin",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["path", "patch"],
        properties: {
          path: { type: "string" },
          patch: { type: "string", minLength: 1 },
          expectedSha256: { type: ["string", "null"] },
        },
      },
    }, (input, context) => this.#withFileScope("workspace.apply_patch", input, context, (runtime, scopedInput) => runtime.#applyPatch(scopedInput, context)));

    registry.register({
      name: "workspace.write_file",
      description: "Write a UTF-8 file after optimistic-concurrency validation and create a rollback checkpoint.",
      requiredPermission: "workspace_write",
      source: "builtin",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content"],
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          expectedSha256: { type: ["string", "null"] },
        },
      },
    }, (input, context) => this.#withFileScope("workspace.write_file", input, context, (runtime, scopedInput) => runtime.#writeFile(scopedInput, context)));

    registry.register({
      name: "workspace.replace_in_file",
      description: "Replace exact text snippets in one existing UTF-8 workspace file after optimistic-concurrency validation. Each replacement's oldText must match exactly once unless replaceAll=true. Smart fallbacks retry a failing match under line-ending, curly-quote and per-line whitespace tolerance; a still-failing or ambiguous match reports the closest context instead of guessing. Replacements apply in order, each on the result of the previous one. Prefer this over apply_patch for focused edits whose surrounding context you already know.",
      requiredPermission: "workspace_write",
      source: "builtin",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["path", "replacements"],
        properties: {
          path: { type: "string" },
          replacements: {
            type: "array",
            minItems: 1,
            maxItems: 64,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["oldText", "newText"],
              properties: {
                oldText: { type: "string", minLength: 1, description: "Exact text to find; must occur exactly once unless replaceAll is true." },
                newText: { type: "string", description: "Replacement text; use an empty string to delete the matched text." },
                replaceAll: { type: "boolean", description: "Replace every occurrence instead of requiring a unique match." },
              },
            },
          },
          expectedSha256: { type: ["string", "null"] },
        },
      },
    }, (input, context) => this.#withFileScope("workspace.replace_in_file", input, context, (runtime, scopedInput) => runtime.#replaceInFile(scopedInput, context)));

    registry.register({
      name: "process.run",
      description: `Workspace-write commands run with OS file restrictions when available; set allowOutsideWorkspace=true only to request permission for an operation that needs outside writes. A sandbox failure does not authorize retry. Run one bounded executable directly and stream stdout/stderr live while waiting for exit on ${process.platform}. The complete bounded output is returned to the model. Arguments are passed directly as argv, not interpreted as shell syntax (including heredocs). Pass at most 64 strings of at most 4096 UTF-16 code units each, without NUL. For longer scripts, first use workspace.write_file, then run the script file. Shell built-ins and pipelines are not executables; when shell syntax is required, start the user-selected terminal profile with process.start(useTerminalProfile=true), then use process.write and process.read. Invoke a concrete shell executable only when the user or project explicitly requires it. For servers, log tails, prompts, or other long-running commands use process.start followed by process.read.`,
      requiredPermission: "workspace_write",
      source: "builtin",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["command"],
        properties: {
          command: { type: "string", description: "Executable name or full path only, for example \"python3\". Do not append arguments or shell syntax, and do not wrap the executable in shell quotes. Pass parameters separately in args; a path containing spaces is one literal executable path." },
          args: { type: "array", description: "Separate argv strings, one per argument, without shell quoting. Example: command=\"python3\", args=[\"--version\"]. For example, run a Python script with command=\"python3\", args=[\"/path/script.py\"]. Spaces inside an argument stay literal; pipelines, redirects, and shell operators are not interpreted.", maxItems: 64, items: { type: "string", maxLength: 4096 } },
          cwd: { type: "string" },
          outputEncoding: { type: "string", minLength: 1, maxLength: 64, description: "One explicit known encoding shared by stdout and stderr for non-PTY pipes only; streams with different or mixed encodings are not supported. Defaults to UTF-8; use a supported WHATWG label (for example gbk only when the process is known to emit Windows code page 936). Do not infer encoding from language or retry/replay a command to change decoding. Windows PowerShell 5.1 pipe output may use a legacy code page. If unknown, obtain [Console]::OutputEncoding.CodePage with a separate read-only query of the same shell/profile flags before the real command: confirmed 936 uses gbk; 65001 uses utf-8. Never infer the code page from system language or apply it to arbitrary native programs. Does not alter the process, shell code page, profile, file encoding or stdin." },
          allowOutsideWorkspace: { type: "boolean", description: "Request explicit one-call user permission for an unsandboxed command. Never retries automatically." },
          timeoutMs: { type: "integer", minimum: 100, maximum: 120000 },
        },
      },
    }, (input, context) => this.#runProcess(input, context));

    registry.register({
      name: "process.start",
      description: `Start one long-lived real PTY session by default (ConPTY on Windows, PTY on macOS/Linux) without blocking the model. Omit timeoutMs to keep the session alive until it exits, is explicitly terminated, or the owning task stops; a supplied positive timeoutMs still sets a deadline. Arguments are passed directly as argv, not interpreted as shell syntax (including heredocs). Pass at most 64 strings of at most 4096 UTF-16 code units each, without NUL. For longer scripts, first use workspace.write_file, then run the script file. The visible terminal and process.read consume the same append-only sequence stream. Output callbacks are serialized with bounded flow-control backpressure, while a bounded whole-chunk ring remains readable by cursor; process.read reports truncation if a stale cursor fell behind that ring. Set tty=false only when separate stdout/stderr pipes are required. On Windows, if a PowerShell npm.ps1/npx.ps1 shim is explicitly rejected by execution policy before running, use the corresponding npm.cmd/npx.cmd executable for a new deliberate invocation; do not weaken execution policy or automatically replay the prior command. Call process.read until hasMore=false and running=false, use process.write for stdin, and process.terminate when finished.${this.#terminalProfile ? ` Set useTerminalProfile=true and omit command to open the user's selected ${this.#terminalProfile.label} profile.` : ''}`,
      requiredPermission: "workspace_write",
      source: "builtin",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          command: { type: "string", description: "Executable name or full path only, for example \"python3\". Do not append arguments or shell syntax, and do not wrap the executable in shell quotes. Pass parameters separately in args; a path containing spaces is one literal executable path." },
          useTerminalProfile: { type: "boolean" },
          args: { type: "array", description: "Separate argv strings, one per argument, without shell quoting. Example: command=\"python3\", args=[\"--version\"]. For example, run a Python script with command=\"python3\", args=[\"/path/script.py\"]. Spaces inside an argument stay literal; pipelines, redirects, and shell operators are not interpreted.", maxItems: 64, items: { type: "string", maxLength: 4096 } },
          cwd: { type: "string" },
          outputEncoding: { type: "string", minLength: 1, maxLength: 64, description: "One explicit known encoding shared by stdout and stderr for non-PTY pipes only; streams with different or mixed encodings are not supported. Defaults to UTF-8; use a supported WHATWG label (for example gbk only when the process is known to emit Windows code page 936). Do not infer encoding from language or retry/replay a command to change decoding. Windows PowerShell 5.1 pipe output may use a legacy code page. If unknown, obtain [Console]::OutputEncoding.CodePage with a separate read-only query of the same shell/profile flags before the real command: confirmed 936 uses gbk; 65001 uses utf-8. Never infer the code page from system language or apply it to arbitrary native programs. Does not alter the process, shell code page, profile, file encoding or stdin." },
          allowOutsideWorkspace: { type: "boolean", description: "Request explicit one-call user permission for an unsandboxed command. Never retries automatically." },
          timeoutMs: { type: "integer", minimum: 100, maximum: 1_800_000, description: "Optional deadline in milliseconds. Omit for no fixed deadline while the owning task is active." },
          pipeStdin: { type: "boolean" },
          tty: { type: "boolean" },
          columns: { type: "integer", minimum: 20, maximum: 500 },
          rows: { type: "integer", minimum: 5, maximum: 300 },
        },
      },
    }, (input, context) => this.#startProcess(input, context));

    registry.register({
      name: "process.read",
      description: "Read a bounded window of process output newer than afterSequence. nextSequence advances only through returned chunks, latestSequence is the current stream head, and hasMore means another immediate read is required. firstAvailableSequence/truncated explicitly report ring eviction. Long-polls for waitMs and aborts promptly without returning a post-cancel snapshot.",
      requiredPermission: "workspace_write",
      source: "builtin",
      // Reading a process stream is observational. It must never be treated
      // as a side effect by the execution ledger, otherwise repeated polls
      // can replay a stale `running` snapshot instead of consuming new
      // output (especially when a process is owned by another workspace
      // binding in the multi-root dispatcher).
      executionKind: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["processId"],
        properties: {
          processId: { type: "string" },
          afterSequence: { type: "integer", minimum: 0 },
          maxCharacters: { type: "integer", minimum: 4_096, maximum: 80_000 },
          waitMs: { type: "integer", minimum: 0, maximum: 30_000 },
        },
      },
    }, (input, context) => this.#readProcess(input, context));

    registry.register({
      name: "process.write",
      description: "Write one bounded text input to the same running PTY session (or an explicitly enabled pipe stdin); optionally close stdin. Input is sent unchanged. Acceptance by the adapter does not mean a shell command executed; use process.read to verify output. For an interactive Windows PowerShell/ConPTY session, submit a complete command with carriage return (CR, U+000D) as Enter; line feed (LF, U+000A) may only add a continuation line. An unclosed quote or bracket still needs completion. Do not replace every LF in a script, and do not resend prior input whose execution status is unknown. The call returns only after the input adapter accepts the complete ordered write.",
      requiredPermission: "workspace_write",
      source: "builtin",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["processId"],
        properties: {
          processId: { type: "string" },
          data: { type: "string", maxLength: 16_384, description: "Raw text input, preserved exactly. In a Windows interactive shell, use CR (U+000D) to submit a complete command; LF may only continue editing. Read output before deciding whether another action is needed." },
          closeStdin: { type: "boolean" },
        },
      },
    }, (input, context) => this.#writeProcess(input, context));

    registry.register({
      name: "process.terminate",
      description: "Idempotently terminate a managed process and its complete child process tree. No new output is accepted after termination begins; POSIX signals and Windows process-tree termination are normalized safely.",
      requiredPermission: "workspace_write",
      source: "builtin",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["processId"],
        properties: { processId: { type: "string" } },
      },
    }, (input, context) => this.#terminateProcess(input, context));
  }

  async dispose(): Promise<void> {
    try { await this.finalizeProcessCheckpoints(); }
    finally {
      try { await this.#diagnostics.dispose?.(); } catch { /* Auxiliary language services cannot invalidate completed edits. */ }
      if (this.#sandboxDirectory && ![...this.#commandSessions.values()].some(session => session.running)) await rm(this.#sandboxDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  getCreatedCheckpointIds(): readonly string[] { return [...this.#createdCheckpointIds]; }
  getCheckpointWarnings(): readonly string[] { return [...new Set([...this.#recoveryWarnings, ...this.#commandSnapshotWarnings,
    ...[...this.#commandResults.values()].flatMap(result => result.checkpointCoverage.warnings)])]; }

  /** Stop owned commands before collecting their final source changes, including cancellation. */
  async finalizeProcessCheckpoints(): Promise<void> {
    await this.stopOwnedProcesses();
    // Preparations already holding the snapshot lock must observe the stop
    // before final collection/removal; they must never publish a late launch.
    await this.#snapshotTail;
    for (const processId of this.#commandSessions.keys()) await this.#collectCommandChanges(processId);
    for (const token of this.#observedCommands) await this.#collectCommandChanges(token, true);
    await this.#snapshotTail;
    if (!this.#commandSessions.size && !this.#observedCommands.size) await rm(this.#commandSnapshotDirectory, { recursive: true, force: true });
  }

  /** Multi-root hosts stop every writer before collecting any participant. */
  stopOwnedProcesses(): Promise<void> {
    this.#processStop.abort("runtime_dispose");
    return this.#stopProcessesPromise ??= this.#processes.dispose();
  }

  #assertProcessOpen(signal?: AbortSignal): void {
    if (this.#processStop.signal.aborted || signal?.aborted) throw new AgentToolError("CANCELLED", "Workspace run has stopped");
  }

  async prepareObservedCommand(token: string, context: ToolExecutionContext): Promise<void> {
    this.#assertProcessOpen(context.signal);
    await this.#prepareCommandSnapshot({ ...context, signal: context.signal
      ? AbortSignal.any([context.signal, this.#processStop.signal]) : this.#processStop.signal }, token);
    this.#assertProcessOpen(context.signal);
  }

  async discardObservedCommand(token: string): Promise<void> {
    await this.#withSnapshotLock(async () => {
      this.#observedCommands.delete(token);
      if (!this.#observedCommands.size && !this.#commandSessions.size) {
        await this.#persistCommandBaseline("idle");
      }
    });
  }

  async collectObservedCommand(token: string, finished: boolean): Promise<{ checkpointIds: string[]; changedPaths: string[]; checkpointCoverage: { complete: boolean; excluded: readonly string[]; warnings: string[] } }> {
    return this.#collectCommandChanges(token, finished);
  }

  async writeManagedProcess(processId: string, data: string): Promise<{ readonly accepted: number }> {
    this.#assertProcessOpen();
    await this.assertWorkspaceIdentity();
    this.#assertProcessOpen();
    const normalized = this.#validatedProcessId(processId);
    const input = stringValue(data, "data", 1, 16_384);
    try {
      await this.#processSession(normalized).write(input);
    } catch (error) {
      throw new AgentToolError("PROCESS_INPUT_FAILED", error instanceof Error ? error.message : "Process input failed");
    }
    return { accepted: input.length };
  }

  resizeManagedProcess(processId: string, columns: number, rows: number): { readonly resized: boolean } {
    const normalized = this.#validatedProcessId(processId);
    const session = this.#processSession(normalized);
    if (!session.tty || !session.running) return { resized: false };
    session.resize(
      integerValue(columns, "columns", 120, 20, 500),
      integerValue(rows, "rows", 30, 5, 300),
    );
    return { resized: true };
  }

  async terminateManagedProcess(processId: string): Promise<{ readonly terminated: boolean }> {
    const normalized = this.#validatedProcessId(processId);
    return { terminated: await this.#processSession(normalized).terminate() };
  }

  /**
   * Removes a file a restore takes back to "did not exist" only if it is still the checkpointed version. The file is
   * first moved aside atomically and checked there, so an edit saved while the restore was preparing is never
   * deleted: it goes back in place, or, when something was written there meanwhile, stays next to it (audit B05-01).
   */
  async #deleteIfUnchanged(manifest: CheckpointManifest, target: string, expected: { readonly sha256: string | null; readonly mode?: number | null }): Promise<void> {
    await this.#resolveCheckpointTarget(manifest);
    const aside = `${target}.nextmux-restore-${randomUUID()}`;
    try { await rename(target, aside); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    if (this.#matchesCheckpoint(await this.#checkpointState(aside), expected.sha256, expected.mode)) {
      await unlink(aside);
      return;
    }
    try {
      await link(aside, target);
      await unlink(aside);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") await rename(aside, target).catch(() => undefined);
      throw new AgentToolError("ROLLBACK_CONFLICT", `File changed during restore: ${portableRelative(manifest.relativePath)}`);
    }
    throw new AgentToolError("ROLLBACK_CONFLICT", `File changed during restore: ${portableRelative(manifest.relativePath)}`);
  }

  async #checkpointState(target: string): Promise<WorkspaceSnapshotFile | undefined> {
    try { return await inspectSnapshotFile(target, { memory: false }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }

  #matchesCheckpoint(state: WorkspaceSnapshotFile | undefined, hash: string | null, mode?: number | null): boolean {
    return (state?.sha256 ?? null) === hash
      && (mode === undefined || mode === null || !!state && (state.mode & 0o7777) === (mode & 0o7777));
  }

  async restoreCheckpoint(checkpointId: string, force = false): Promise<ToolExecutionSummary> {
    return (await runCheckpointRestoreTransactions([() => this.prepareCheckpointRestore([checkpointId], { force })]))[0];
  }

  /** Shared by message rollback and individual file timelines. */
  async restoreCheckpointChain(checkpointIds: readonly string[]): Promise<readonly ToolExecutionSummary[]> {
    return runCheckpointRestoreTransactions([() => this.prepareCheckpointRestore(checkpointIds)]);
  }

  /** The host groups checkpoints by owner; all roots are preflighted before the first write. */
  static async restoreCheckpointGroups(groups: readonly {
    runtime: WorkspaceToolRuntime;
    checkpointIds: readonly string[];
    /** Restore an immutable version directly, instead of replaying inverse operations. */
    targets?: readonly { checkpointId: string; side: "before" | "after" }[];
  }[], options: { recordVersions?: boolean; conversationId?: string; turnId?: string } = {}): Promise<readonly ToolExecutionSummary[]> {
    if (new Set(groups.map(group => group.runtime.#workspaceRoot)).size !== groups.length) throw new AgentToolError("INVALID_CHECKPOINT", "Restore groups overlap on the same workspace");
    if (groups.some(group => group.targets !== undefined)) {
      const resources = new Set<string>();
      for (const group of groups) {
        if (!group.targets || group.targets.length > new Set(group.checkpointIds).size
          || group.targets.some(target => !group.checkpointIds.includes(target.checkpointId)
            || !["before", "after"].includes(target.side))
          || new Set(group.targets.map(target => target.checkpointId)).size !== group.targets.length) {
          throw new AgentToolError("INVALID_CHECKPOINT", "Restore target versions do not match their checkpoints");
        }
        for (const target of group.targets) {
          const path = await group.runtime.#fileVersionTarget({ checkpointId: target.checkpointId });
          if (resources.has(path)) throw new AgentToolError("INVALID_CHECKPOINT", `Multiple restore targets refer to the same file: ${path}`);
          resources.add(path);
        }
      }
      const sources = new Map<string, WorkspaceToolRuntime>();
      for (const group of groups) for (const id of group.checkpointIds) {
        if (sources.has(id) && sources.get(id) !== group.runtime) throw new AgentToolError("INVALID_CHECKPOINT", "Checkpoint identifier is ambiguous across owners");
        sources.set(id, group.runtime);
      }
      const result = await runCheckpointRestoreTransactions(groups.filter(group => group.targets!.length).map(group => () => group.runtime.prepareCheckpointRestore(group.targets!.map(target => target.checkpointId), {
        ...options, sources, targetSides: new Map(group.targets!.map(target => [target.checkpointId, target.side]))
      })));
      for (const { runtime } of groups) for (const key of fileVersionLists.keys()) if (key.startsWith(`${runtime.#checkpointRoot}\0`)) fileVersionLists.delete(key);
      return result;
    }
    type Owned = { runtime: WorkspaceToolRuntime; checkpointId: string; manifest: CheckpointManifest; order: number };
    const resources = new Map<string, Owned[]>();
    for (const group of groups) for (const [order, checkpointId] of [...new Set(group.checkpointIds)].entries()) {
      if (!/^[A-Za-z0-9-]{16,200}$/.test(checkpointId)) throw new AgentToolError("INVALID_CHECKPOINT", "Checkpoint identifier is invalid");
      const manifest = JSON.parse(await readFile(join(group.runtime.#checkpointRoot, checkpointId, CHECKPOINT_MANIFEST), "utf8")) as CheckpointManifest;
      if (manifest.version !== 1 || manifest.id !== checkpointId || manifest.workspaceRoot !== group.runtime.#workspaceRoot) throw new AgentToolError("INVALID_CHECKPOINT", "Checkpoint owner does not match");
      const target = await group.runtime.#resolveCheckpointTarget(manifest);
      const resource = resources.get(target) ?? [];
      resource.push({ runtime: group.runtime, checkpointId, manifest, order }); resources.set(target, resource);
    }
    const plans = new Map<WorkspaceToolRuntime, { ids: string[]; sources: Map<string, WorkspaceToolRuntime> }>();
    for (const [target, entries] of resources) {
      const owner = entries[0].runtime;
      let ordered = entries;
      if (new Set(entries.map(item => item.runtime)).size > 1) {
        const current = await owner.#checkpointState(target);
        const queues = new Map<WorkspaceToolRuntime, Owned[]>();
        for (const item of entries) { const queue = queues.get(item.runtime) || []; queue.push(item); queues.set(item.runtime, queue); }
        for (const queue of queues.values()) queue.sort((a, b) => a.order - b.order);
        const trace = (startHash: string | null, startMode: number | null | undefined): Owned[] | undefined => {
          const positions = new Map<WorkspaceToolRuntime, number>();
          let hash = startHash, mode = startMode; const result: Owned[] = [];
          while (result.length < entries.length) {
            const candidates = [...queues].map(([runtime, queue]) => queue[positions.get(runtime) || 0]).filter((item): item is Owned => !!item)
              .filter(item => item.manifest.afterSha256 === hash
                && (item.manifest.afterMode == null || mode != null && (item.manifest.afterMode & 0o7777) === (mode & 0o7777)));
            if (candidates.length !== 1) return undefined;
            const next = candidates[0]; result.push(next); positions.set(next.runtime, (positions.get(next.runtime) || 0) + 1);
            hash = next.manifest.beforeSha256; mode = next.manifest.beforeMode;
          }
          return result;
        };
        if (options.recordVersions) {
          const candidates = [...queues.values()].map(queue => trace(queue[0].manifest.afterSha256, queue[0].manifest.afterMode)).filter((items): items is Owned[] => !!items);
          const distinct = new Map(candidates.map(items => [items.map(item => `${item.runtime.#workspaceRoot}:${item.checkpointId}`).join('\0'), items]));
          if (distinct.size !== 1) throw new AgentToolError("ROLLBACK_CONFLICT", `Shared file history is ambiguous: ${target}`);
          ordered = [...distinct.values()][0];
        } else {
          const chain = trace(current?.sha256 ?? null, current?.mode ?? null);
          if (!chain) throw new AgentToolError("ROLLBACK_CONFLICT", `Shared file history is changed or ambiguous: ${target}`);
          ordered = chain;
        }
      }
      const plan = plans.get(owner) ?? { ids: [], sources: new Map<string, WorkspaceToolRuntime>() };
      for (const item of ordered) {
        if (plan.sources.has(item.checkpointId) && plan.sources.get(item.checkpointId) !== item.runtime) throw new AgentToolError("INVALID_CHECKPOINT", "Checkpoint identifier is ambiguous across owners");
        plan.ids.push(item.checkpointId); plan.sources.set(item.checkpointId, item.runtime);
      }
      plans.set(owner, plan);
    }
    const restored = await runCheckpointRestoreTransactions([...plans].map(([runtime, plan]) => () => runtime.prepareCheckpointRestore(plan.ids, { sources: plan.sources, recordVersions: options.recordVersions, conversationId: options.conversationId, turnId: options.turnId })));
    for (const { runtime } of groups) for (const key of fileVersionLists.keys()) if (key.startsWith(`${runtime.#checkpointRoot}\0`)) fileVersionLists.delete(key);
    return restored;
  }

  /**
   * Prepares immutable originals and verifies the entire chain without changing
   * live files. Keep this transaction alive until every workspace has applied.
   */
  async prepareCheckpointRestore(checkpointIds: readonly string[], options: { force?: boolean; sources?: ReadonlyMap<string, WorkspaceToolRuntime>; recordVersions?: boolean; targetSides?: ReadonlyMap<string, "before" | "after">; conversationId?: string; turnId?: string } = {}): Promise<PreparedCheckpointRestore> {
    if (checkpointIds.length > 100_000 || options.force && checkpointIds.length !== 1) throw new AgentToolError("INVALID_CHECKPOINT", "Checkpoint chain is invalid or too large");
    type State = { sha256: string | null; mode?: number | null };
    type Entry = { checkpointId: string; manifest: CheckpointManifest; target: string; before?: WorkspaceSnapshotFile };
    const entries: Entry[] = [];
    const initial = new Map<string, State>();
    const simulated = new Map<string, State>();
    const finalEntries = new Map<string, Entry>();
    const versionDirectories = new Set<string>();
    const generatedVersions = new Map<string, { checkpointId: string; workspaceRoot: string; path: string }>();
    const sourceCheckpointIds = new Map<string, string[]>();
    for (const checkpointId of new Set(checkpointIds)) {
      if (!/^[A-Za-z0-9-]{16,200}$/.test(checkpointId)) throw new AgentToolError("INVALID_CHECKPOINT", "Checkpoint identifier is invalid");
      const sourceRuntime = options.sources?.get(checkpointId) ?? this;
      const directory = resolve(sourceRuntime.#checkpointRoot, checkpointId);
      let manifest = JSON.parse(await readFile(join(directory, CHECKPOINT_MANIFEST), "utf8")) as CheckpointManifest;
      if (manifest.version !== 1 || manifest.id !== checkpointId || manifest.workspaceRoot !== sourceRuntime.#workspaceRoot) throw new AgentToolError("INVALID_CHECKPOINT", "Checkpoint metadata does not match this workspace");
      const validHash = (hash: unknown) => hash === null || typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash);
      if (!validHash(manifest.beforeSha256) || !validHash(manifest.afterSha256)
        || manifest.existed !== (manifest.beforeSha256 !== null)) throw new AgentToolError("INVALID_CHECKPOINT", "Checkpoint file metadata is invalid");
      const publicVersionId = (manifest as CheckpointManifest & { publicVersionId?: string }).publicVersionId;
      if (publicVersionId) {
        if (!/^restore-[a-f0-9-]{36}$/.test(publicVersionId)) throw new AgentToolError("INVALID_CHECKPOINT", "Invalid public file version");
        versionDirectories.add(join(sourceRuntime.#checkpointRoot, publicVersionId));
      }
      const target = await sourceRuntime.#resolveCheckpointTarget(manifest);
      if (sourceRuntime !== this) manifest = { ...manifest, workspaceRoot: this.#workspaceRoot,
        relativePath: isInside(this.#workspaceRoot, target) ? relative(this.#workspaceRoot, target) : target,
        externalTarget: isInside(this.#workspaceRoot, target) ? undefined : target };
      let state = simulated.get(target);
      if (!state) {
        const current = await this.#checkpointState(target);
        state = { sha256: current?.sha256 ?? null, mode: current?.mode ?? null };
        initial.set(target, state);
      }
      if (!options.force && (state.sha256 !== manifest.afterSha256 || manifest.afterMode !== undefined && manifest.afterMode !== null
        && (state.mode === null || state.mode === undefined || (state.mode & 0o7777) !== (manifest.afterMode & 0o7777)))) {
        let known = false;
        if ((options.recordVersions || options.targetSides) && !simulated.has(target)) {
          // A deliberate version switch may begin at another committed NM
          // version. Unknown external edits still fail the same exact CAS.
          const candidates = new Map<WorkspaceToolRuntime, string>();
          for (const [id, runtime] of options.sources || [[checkpointId, sourceRuntime] as const]) {
            try { if (await runtime.#fileVersionTarget({ checkpointId: id }) === target) candidates.set(runtime, id); }
            catch { /* A separately invalid entry will fail its own chain validation. */ }
          }
          for (const [runtime, id] of candidates) {
            let cursor: string | undefined;
            do {
              const page = await runtime.listFileVersions({ checkpointId: id, cursor, limit: 500 });
              known = page.versions.some(item => item.afterSha256 === state!.sha256 && (item.afterSha256 === null
                || item.afterMode != null && state!.mode != null && (item.afterMode & 0o7777) === (state!.mode & 0o7777)));
              cursor = page.nextCursor;
            } while (!known && cursor);
            if (known) break;
          }
        }
        if (!known) throw new AgentToolError("ROLLBACK_CONFLICT", `File content or permissions changed after checkpoint: ${portableRelative(manifest.relativePath)}`);
      }
      const targetSide = options.targetSides?.get(checkpointId) ?? "before";
      if (options.targetSides && simulated.has(target)) throw new AgentToolError("INVALID_CHECKPOINT", "A direct restore may specify only one version per file");
      // The public checkpoint stays immutable. Only this transaction's desired
      // state changes; validation above still checks the real current version.
      if (targetSide === "after") manifest = { ...manifest, existed: manifest.afterSha256 !== null,
        beforeSha256: manifest.afterSha256, beforeMode: manifest.afterMode ?? manifest.beforeMode };
      const before = manifest.existed ? await inspectSnapshotFile(join(directory, `${targetSide}.bin`), {
        memory: false, maxBytes: SNAPSHOT_MAX_BYTES,
      }) : undefined;
      if (before && before.sha256 !== manifest.beforeSha256) throw new AgentToolError("INVALID_CHECKPOINT", "Checkpoint backup is invalid");
      if (before && snapshotFileSize(before) > SNAPSHOT_MAX_BYTES) throw new AgentToolError("ROLLBACK_TOO_LARGE", "Checkpoint restore exceeds the disk budget; no files were changed");
      simulated.set(target, { sha256: manifest.beforeSha256, mode: manifest.beforeMode });
      const entry = { checkpointId, manifest, target, before };
      entries.push(entry);
      const sourceIds = sourceCheckpointIds.get(target) || []; sourceIds.push(checkpointId); sourceCheckpointIds.set(target, sourceIds);
      // Repeated changes to one file are validated as a chain but restored only
      // once. This avoids publishing intermediate versions and duplicate I/O.
      finalEntries.set(target, entry);
    }
    const recoveryDirectory = join(this.#checkpointRoot, `.restore-${randomUUID()}`);
    const originals = new Map<string, WorkspaceSnapshotFile | undefined>();
    const attempted = new Set<string>();
    let groupJournal: string | undefined;
    const rootMetadata = await stat(this.#workspaceRoot);
    let phase: "prepared" | "applying" | "applied" | "rolled_back" | "review" | "finalized" = "prepared";
    const persistRecovery = async () => {
      if (!entries.length) return;
      await atomicWrite(join(recoveryDirectory, "recovery.json"), Buffer.from(JSON.stringify({ version: 2, workspaceRoot: this.#workspaceRoot, phase, groupJournal, ownerPid: process.pid, rootIdentity: `${rootMetadata.dev}:${rootMetadata.ino}`, versionDirectories: [...versionDirectories],
        files: [...originals].map(([target, file]) => ({ path: portableRelative(relative(this.#workspaceRoot, target)),
          externalTarget: finalEntries.get(target)!.manifest.externalTarget,
          sha256: file?.sha256 ?? null, mode: file?.mode ?? null, size: file ? snapshotFileSize(file) : 0,
          restoreSha256: finalEntries.get(target)!.manifest.beforeSha256,
          restoreMode: finalEntries.get(target)!.manifest.beforeMode, attempted: attempted.has(target) })) })), 0o600);
    };
    try {
      let bytes = [...finalEntries.values()].reduce((sum, entry) => sum + (entry.before ? snapshotFileSize(entry.before) : 0), 0);
      if (!Number.isSafeInteger(bytes) || bytes > SNAPSHOT_MAX_BYTES) throw new AgentToolError("ROLLBACK_TOO_LARGE", "Restore size exceeds the disk budget; no files were changed");
      for (const [target] of finalEntries) {
        let original: WorkspaceSnapshotFile | undefined;
        try { original = await inspectSnapshotFile(target, { memory: false, objectDirectory: recoveryDirectory, maxBytes: SNAPSHOT_MAX_BYTES }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        const expected = initial.get(target)!;
        if (!this.#matchesCheckpoint(original, expected.sha256, expected.mode)) throw new AgentToolError("ROLLBACK_CONFLICT", "File changed while preparing restore");
        bytes += original ? snapshotFileSize(original) : 0;
        if (!Number.isSafeInteger(bytes) || bytes > SNAPSHOT_MAX_BYTES) throw new AgentToolError("ROLLBACK_TOO_LARGE", "Restore size exceeds the disk budget; no files were changed");
        originals.set(target, original);
      }
      if (options.recordVersions) for (const [target, entry] of finalEntries) {
        const original = originals.get(target), id = `restore-${randomUUID()}`, directory = join(this.#checkpointRoot, id);
        await mkdir(directory, { mode: 0o700 });
        versionDirectories.add(directory);
        generatedVersions.set(target, { checkpointId: id, workspaceRoot: this.#workspaceRoot, path: target });
        if (original) await writeSnapshotFile(original, join(directory, 'before.bin'));
        if (entry.before) await writeSnapshotFile(entry.before, join(directory, 'after.bin'));
        await atomicWrite(join(directory, CHECKPOINT_MANIFEST), Buffer.from(JSON.stringify({ version: 1, id, workspaceRoot: this.#workspaceRoot,
          relativePath: entry.manifest.relativePath, ...(entry.manifest.externalTarget ? { externalTarget: entry.manifest.externalTarget } : {}),
          existed: !!original, beforeSha256: original?.sha256 ?? null, beforeMode: original?.mode ?? null,
          afterSha256: entry.manifest.beforeSha256, afterMode: entry.manifest.beforeMode ?? null,
          createdAt: new Date().toISOString(), status: 'prepared', operation: 'message_restore',
          sourceCheckpointIds: sourceCheckpointIds.get(target),
          ...(options.conversationId ? { conversationId: options.conversationId } : {}),
          ...(options.turnId ? { turnId: options.turnId } : {}) })), 0o600);
      }
      if (entries.length) { await mkdir(recoveryDirectory, { recursive: true, mode: 0o700 }); await persistRecovery(); }
    } catch (error) {
      await rm(recoveryDirectory, { recursive: true, force: true });
      for (const item of generatedVersions.values()) await rm(join(this.#checkpointRoot, item.checkpointId), { recursive: true, force: true });
      throw error;
    }
    if (entries.length) activeCheckpointRestores.add(recoveryDirectory);
    return {
      joinGroup: async path => { groupJournal = path; await persistRecovery(); },
      workspaceRoot: this.#workspaceRoot, targetPaths: [...finalEntries.keys()], recoveryDirectory,
      versionDirectories: [...versionDirectories],
      apply: async () => {
        if (phase !== "prepared") throw new AgentToolError("INVALID_CHECKPOINT", "Restore transaction is no longer prepared");
        phase = "applying";
        for (const [target, entry] of finalEntries) {
          await this.#resolveCheckpointTarget(entry.manifest);
          const expected = initial.get(target)!;
          const current = await this.#checkpointState(target);
          if (!this.#matchesCheckpoint(current, expected.sha256, expected.mode)) throw new AgentToolError("ROLLBACK_CONFLICT", `File changed during restore: ${portableRelative(entry.manifest.relativePath)}`);
          // Persist intent before modifying live bytes. Compensation can then
          // distinguish an unchanged file from a completed atomic write.
          attempted.add(target); await persistRecovery();
          recordWorkspaceWrite(target, "*");
          if (entry.before) await writeSnapshotFile(entry.before, target, entry.manifest.beforeMode ?? 0o600, { beforeCommit: async () => {
            await this.#resolveCheckpointTarget(entry.manifest);
            if (!this.#matchesCheckpoint(await this.#checkpointState(target), expected.sha256, expected.mode)) throw new AgentToolError("ROLLBACK_CONFLICT", "File changed while copying restore bytes");
          } });
          else if (current) await this.#deleteIfUnchanged(entry.manifest, target, expected);
          recordWorkspaceWrite(target, entry.manifest.beforeSha256);
        }
        phase = "applied"; await persistRecovery();
        for (const key of fileVersionLists.keys()) if (key.startsWith(`${this.#checkpointRoot}\0`)) fileVersionLists.delete(key);
        return entries.map(entry => ({ kind: "workspace.restore", params: { path: portableRelative(entry.manifest.relativePath) }, title: `Restored ${portableRelative(entry.manifest.relativePath)}`, checkpointId: entry.checkpointId,
          ...(generatedVersions.has(entry.target) ? { restoration: generatedVersions.get(entry.target) } : {}) }));
      },
      rollback: async () => {
        if (phase === "finalized") throw new AgentToolError("INVALID_CHECKPOINT", "Restore transaction has already been finalized");
        let failed = false;
        for (const target of [...attempted].reverse()) {
          try {
            const entry = finalEntries.get(target)!;
            await this.#resolveCheckpointTarget(entry.manifest);
            const current = await this.#checkpointState(target);
            const original = originals.get(target);
            if (this.#matchesCheckpoint(current, original?.sha256 ?? null, original?.mode)) continue;
            if (!this.#matchesCheckpoint(current, entry.manifest.beforeSha256, entry.manifest.beforeMode)) throw new AgentToolError("ROLLBACK_CONFLICT", "File changed while compensating restore");
            recordWorkspaceWrite(target, "*");
            if (original) await writeSnapshotFile(original, target, original.mode, { beforeCommit: async () => {
              await this.#resolveCheckpointTarget(entry.manifest);
              if (!this.#matchesCheckpoint(await this.#checkpointState(target), entry.manifest.beforeSha256, entry.manifest.beforeMode)) throw new AgentToolError("ROLLBACK_CONFLICT", "File changed while copying compensation bytes");
            } });
            else if (current) await this.#deleteIfUnchanged(entry.manifest, target, { sha256: entry.manifest.beforeSha256, mode: entry.manifest.beforeMode });
            recordWorkspaceWrite(target, original?.sha256 ?? null);
          } catch { failed = true; }
        }
        phase = failed ? "review" : "rolled_back";
        await persistRecovery();
        if (failed) throw new AgentToolError("ROLLBACK_PARTIAL", `Restore needs review; originals remain in ${recoveryDirectory}`);
      },
      finalize: async () => {
        if (phase === "applying" || phase === "review") throw new AgentToolError("ROLLBACK_PARTIAL", "Cannot release recovery files before compensation completes");
        if (phase !== "finalized") { await rm(recoveryDirectory, { recursive: true, force: true }); activeCheckpointRestores.delete(recoveryDirectory); phase = "finalized"; }
      },
    };
  }

  /** Apply an explicitly reviewed child result through the existing checkpoint store. */
  async applyReviewedChanges(
    changes: readonly { path: string; beforeSha256: string | null; content: Buffer | WorkspaceSnapshotFile | null; beforeMode?: number; mode?: number }[],
    context: ToolExecutionContext,
  ): Promise<readonly string[]> {
    if (this.#permissionMode === "read_only") throw new AgentToolError("PERMISSION_DENIED", "Merging changes requires workspace write permission");
    if (changes.length > 10_000) throw new AgentToolError("MERGE_TOO_LARGE", "Too many reviewed changes");
    return this.#withSnapshotLock(async () => {
      const seen = new Set<string>();
      let bytes = 0;
      const entries = [];
      for (const change of changes) {
        const path = normalizedRelativePath(change.path, false, this.#workspaceRoot);
        if (seen.has(path) || path.split(sep).some(part => part === ".git")) throw new AgentToolError("INVALID_PATH", "Duplicate or internal merge path");
        seen.add(path);
        const target = await this.#resolveWriteTarget(path);
        const before = await this.#checkpointState(target);
        if (!this.#matchesCheckpoint(before, change.beforeSha256, change.beforeMode)) throw new AgentToolError("MERGE_CONFLICT", `File changed since delegation: ${portableRelative(path)}`);
        const content: WorkspaceSnapshotFile | null = change.content === null ? null : Buffer.isBuffer(change.content)
          ? { content: change.content, size: change.content.length, sha256: sha256(change.content), mode: change.mode ?? before?.mode ?? 0o600, fingerprint: "" } : change.content;
        bytes += (before ? snapshotFileSize(before) : 0) + (content ? snapshotFileSize(content) : 0);
        if (bytes > SNAPSHOT_MAX_BYTES) throw new AgentToolError("MERGE_TOO_LARGE", "Reviewed changes exceed the merge disk budget");
        entries.push({ ...change, content, path, target, before, beforeMode: before?.mode ?? null });
      }
      const checkpoints: string[] = [];
      try {
        for (const [index, entry] of entries.entries()) {
          if (context.signal?.aborted) throw new AgentToolError("CANCELLED", "Merge cancelled");
          await this.#resolveWriteTarget(entry.path);
          const current = await this.#checkpointState(entry.target);
          if (!this.#matchesCheckpoint(current, entry.beforeSha256, entry.beforeMode)) throw new AgentToolError("MERGE_CONFLICT", `File changed during merge: ${portableRelative(entry.path)}`);
          const id = `${context.runId}-${String(index).padStart(6, "0")}-${randomUUID()}`;
          const directory = join(this.#checkpointRoot, id);
          await mkdir(directory, { recursive: false });
          if (entry.before) await writeSnapshotFile(entry.before, join(directory, "before.bin"));
          if (entry.content) await writeSnapshotFile(entry.content, join(directory, "after.bin"));
          const manifest: CheckpointManifest = {
            version: 1, id, workspaceRoot: this.#workspaceRoot, relativePath: entry.path,
            existed: entry.before !== undefined, beforeSha256: entry.beforeSha256,
            afterSha256: entry.content?.sha256 ?? null,
            beforeMode: entry.beforeMode, createdAt: new Date().toISOString(),
          };
          await atomicWrite(join(directory, CHECKPOINT_MANIFEST), Buffer.from(JSON.stringify({ ...manifest,
            afterMode: entry.content === null ? null : entry.mode ?? entry.beforeMode ?? 0o600 })), 0o600);
          // Every original and output is durable before modifying the live project.
          recordWorkspaceWrite(entry.target, "*");
          if (entry.content !== null) await writeSnapshotFile(entry.content, entry.target, entry.mode ?? entry.beforeMode ?? 0o600);
          else if (entry.before !== undefined) await unlink(entry.target);
          recordWorkspaceWrite(entry.target, entry.content?.sha256 ?? null);
          checkpoints.push(id);
          this.#createdCheckpointIds.push(id);
        }
      } catch (error) {
        // Never force rollback over edits made concurrently by a user/editor.
        try { await this.restoreCheckpointChain([...checkpoints].reverse()); }
        catch { throw new AgentToolError("MERGE_PARTIAL", "Merge interrupted; checkpoints preserve the originals and require review"); }
        throw error;
      }
      return checkpoints;
    });
  }

  /** A timeline restoration is a new version, with the same originals and CAS as tool edits. */
  async restoreFileVersion(request: {
    checkpointId: string; side: "before" | "after"; expectedSha256: string | null;
    conversationId: string; turnId?: string;
  }): Promise<{ checkpointId: string; path: string; sha256: string | null }> {
    if (this.#permissionMode === "read_only") throw new AgentToolError("PERMISSION_DENIED", "Restoring a file requires write permission");
    if (!/^[A-Za-z0-9-]{16,200}$/.test(request.checkpointId) || !["before", "after"].includes(request.side)
      || request.expectedSha256 !== null && !/^[a-f0-9]{64}$/.test(request.expectedSha256)
      || !/^[0-9a-f-]{36}$/i.test(request.conversationId)) throw new AgentToolError("INVALID_CHECKPOINT", "File version restore request is invalid");
    return this.#withSnapshotLock(async () => {
      const sourceDirectory = join(this.#checkpointRoot, request.checkpointId);
      const source = JSON.parse(await readFile(join(sourceDirectory, CHECKPOINT_MANIFEST), "utf8")) as CheckpointManifest;
      if (source.version !== 1 || source.id !== request.checkpointId || source.workspaceRoot !== this.#workspaceRoot) throw new AgentToolError("INVALID_CHECKPOINT", "File version belongs to another workspace");
      const target = await this.#resolveCheckpointTarget(source);
      const current = await this.#checkpointState(target);
      if ((current?.sha256 ?? null) !== request.expectedSha256) throw new AgentToolError("ROLLBACK_CONFLICT", "File changed since the timeline was opened");
      const hash = request.side === "before" ? source.beforeSha256 : source.afterSha256;
      const mode = request.side === "before" ? source.beforeMode : source.afterMode;
      const version = hash === null ? undefined : await inspectSnapshotFile(join(sourceDirectory, `${request.side}.bin`), { memory: false });
      if (version && version.sha256 !== hash) throw new AgentToolError("INVALID_CHECKPOINT", "File version object is corrupt");
      return this.#applyRecordedFileVersion({ relativePath: source.relativePath, externalTarget: source.externalTarget }, target, current,
        version ? { ...version, mode: mode ?? version.mode } : undefined,
        { operation: "timeline_restore", sourceCheckpointId: request.checkpointId, conversationId: request.conversationId, turnId: request.turnId });
    });
  }

  /** Reads the actual stable file, including binary/large files; never hashes a preview. */
  async getFileState(request: { checkpointId?: string; path?: string }): Promise<{
    path: string; exists: boolean; sha256: string | null; mode: number | null; size: number;
  }> {
    const target = await this.#fileVersionTarget(request), state = await this.#checkpointState(target);
    return { path: target, exists: !!state, sha256: state?.sha256 ?? null, mode: state?.mode ?? null, size: state ? snapshotFileSize(state) : 0 };
  }

  async #fileVersionTarget(request: { checkpointId?: string; path?: string }): Promise<string> {
    if (Boolean(request.checkpointId) === Boolean(request.path)) throw new AgentToolError("INVALID_ARGUMENTS", "Choose a checkpoint or a path");
    let target: string;
    if (request.checkpointId) {
      if (!/^[A-Za-z0-9-]{16,200}$/.test(request.checkpointId)) throw new AgentToolError("INVALID_CHECKPOINT", "Invalid checkpoint");
      const manifest = JSON.parse(await readFile(join(this.#checkpointRoot, request.checkpointId, CHECKPOINT_MANIFEST), "utf8")) as CheckpointManifest;
      if (manifest.version !== 1 || manifest.id !== request.checkpointId || manifest.workspaceRoot !== this.#workspaceRoot) throw new AgentToolError("INVALID_CHECKPOINT", "Checkpoint belongs to another workspace");
      target = await this.#resolveCheckpointTarget(manifest);
    } else target = await this.#resolveWriteTarget(request.path, false);
    return target;
  }

  /** A bounded metadata view of existing objects, including saves outside an AI turn. */
  async listFileVersions(request: { checkpointId?: string; path?: string; limit?: number; cursor?: string }): Promise<{
    versions: readonly AgentFileVersion[]; nextCursor?: string;
  }> {
    const target = await this.#fileVersionTarget(request);
    const info = await stat(this.#checkpointRoot), stamp = `${info.dev}:${info.ino}:${info.mtimeMs}:${info.ctimeMs}`;
    const key = `${this.#checkpointRoot}\0${target}`;
    let versions = fileVersionLists.get(key)?.fingerprint === stamp ? fileVersionLists.get(key)!.versions : undefined;
    if (!versions) {
      const rows: AgentFileVersion[] = [];
      const names = (await readdir(this.#checkpointRoot, { withFileTypes: true })).filter(item => item.isDirectory() && !item.isSymbolicLink()
        && /^[A-Za-z0-9-]{16,200}$/.test(item.name) && !item.name.startsWith('inverse-') && !item.name.startsWith('review-'));
      if (names.length > 100_000) throw new AgentToolError('CHECKPOINT_INDEX_TOO_LARGE', 'Checkpoint index needs maintenance before it can be listed');
      for (let offset = 0; offset < names.length; offset += 16) await Promise.all(names.slice(offset, offset + 16).map(async item => {
        const path = join(this.#checkpointRoot, item.name, CHECKPOINT_MANIFEST);
        try {
          const metadata = await lstat(path);
          if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 64 * 1024) return;
          const value = JSON.parse(await readFile(path, 'utf8')) as CheckpointManifest & { operation?: string; conversationId?: string; turnId?: string; status?: string };
          if (value.version !== 1 || value.id !== item.name || value.workspaceRoot !== this.#workspaceRoot || value.status === 'prepared'
            || !Number.isFinite(Date.parse(value.createdAt)) || await this.#resolveCheckpointTarget(value) !== target) return;
          const validHash = (hash: unknown) => hash === null || typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);
          if (!validHash(value.beforeSha256) || !validHash(value.afterSha256)) return;
          rows.push({ checkpointId: value.id, workspaceRoot: this.#workspaceRoot, path: target, createdAt: value.createdAt,
            beforeSha256: value.beforeSha256, afterSha256: value.afterSha256, beforeMode: value.beforeMode ?? null, afterMode: value.afterMode ?? null,
            ...(typeof value.operation === 'string' ? { operation: value.operation } : {}),
            ...(typeof value.conversationId === 'string' ? { conversationId: value.conversationId } : {}),
            ...(typeof value.turnId === 'string' ? { turnId: value.turnId } : {}) });
        } catch (error) {
          // A corrupt/removed unrelated entry must not hide this file's healthy versions.
          if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof AgentToolError) return;
          throw error;
        }
      }));
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.checkpointId.localeCompare(a.checkpointId));
      versions = rows;
      const after = await stat(this.#checkpointRoot);
      if (`${after.dev}:${after.ino}:${after.mtimeMs}:${after.ctimeMs}` === stamp && rows.length <= 10_000) {
        fileVersionLists.delete(key); fileVersionLists.set(key, { fingerprint: stamp, versions });
        while (fileVersionLists.size > 4) fileVersionLists.delete(fileVersionLists.keys().next().value!);
      }
    }
    let offset = 0;
    if (request.cursor) {
      if (request.cursor.length > 512) throw new AgentToolError('INVALID_ARGUMENTS', 'Invalid file history cursor');
      const anchor = Buffer.from(request.cursor, 'base64url').toString('utf8');
      const index = versions.findIndex(item => `${item.createdAt}\0${item.checkpointId}` === anchor);
      if (index < 0) throw new AgentToolError('STALE_HISTORY_CURSOR', 'File history changed; refresh the timeline');
      offset = index + 1;
    }
    const limit = Math.max(1, Math.min(500, Math.floor(request.limit || 200)));
    const page = versions.slice(offset, offset + limit), last = page.at(-1);
    return { versions: page, ...(last && offset + page.length < versions.length
      ? { nextCursor: Buffer.from(`${last.createdAt}\0${last.checkpointId}`).toString('base64url') } : {}) };
  }

  /** Explicit editor saves join the very same checkpoint objects and recovery transaction. */
  async saveFileVersion(request: { path?: string; checkpointId?: string; content: string; expectedSha256: string | null; conversationId: string; turnId?: string; operation?: 'editor_save' | 'timeline_restore' }): Promise<{
    checkpointId: string; path: string; sha256: string | null;
  }> {
    if (this.#permissionMode === "read_only") throw new AgentToolError("PERMISSION_DENIED", "Saving a file requires write permission");
    if (typeof request.content !== "string" || Buffer.byteLength(request.content, "utf8") > 32 * 1024 * 1024
      || request.operation !== undefined && request.operation !== 'editor_save' && request.operation !== 'timeline_restore'
      || request.expectedSha256 !== null && !/^[a-f0-9]{64}$/.test(request.expectedSha256)
      || !/^[0-9a-f-]{36}$/i.test(request.conversationId)) throw new AgentToolError("INVALID_ARGUMENTS", "File save request is invalid");
    return this.#withSnapshotLock(async () => {
      const target = await this.#fileVersionTarget(request), current = await this.#checkpointState(target);
      if ((current?.sha256 ?? null) !== request.expectedSha256) throw new AgentToolError("ROLLBACK_CONFLICT", "File changed since the editor was opened");
      if (current && snapshotFileSize(current) > 32 * 1024 * 1024) throw new AgentToolError("EDITOR_FILE_TOO_LARGE", "Use a binary-aware editor for this file; its original is unchanged");
      const original = current ? await readFile(target) : Buffer.alloc(0);
      if (current && sha256(original) !== current.sha256) throw new AgentToolError("ROLLBACK_CONFLICT", "File changed while preparing the editor save");
      const content = encodePreservingFileFormat(original, request.content);
      const version: WorkspaceSnapshotFile = { content, size: content.length, sha256: sha256(content), mode: current?.mode ?? 0o600, fingerprint: "editor-save" };
      const external = !isInside(this.#workspaceRoot, target);
      return this.#applyRecordedFileVersion({ relativePath: external ? target : relative(this.#workspaceRoot, target), ...(external ? { externalTarget: target } : {}) }, target, current, version,
        { operation: request.operation ?? "editor_save", conversationId: request.conversationId, turnId: request.turnId });
    });
  }

  async #applyRecordedFileVersion(source: { relativePath: string; externalTarget?: string }, target: string,
    current: WorkspaceSnapshotFile | undefined, version: WorkspaceSnapshotFile | undefined,
    event: { operation: "timeline_restore" | "editor_save"; sourceCheckpointId?: string; conversationId: string; turnId?: string }
  ): Promise<{ checkpointId: string; path: string; sha256: string | null }> {
    const hash = version?.sha256 ?? null, id = `restore-${randomUUID()}`, directory = join(this.#checkpointRoot, id);
    const inverseId = `inverse-${randomUUID()}`, inverseDirectory = join(this.#checkpointRoot, inverseId);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    try {
      if (current) await writeSnapshotFile(current, join(directory, "before.bin"));
      if (version) await writeSnapshotFile(version, join(directory, "after.bin"));
      const manifest = { version: 1, id, workspaceRoot: this.#workspaceRoot, relativePath: source.relativePath,
        ...(source.externalTarget ? { externalTarget: source.externalTarget } : {}),
        existed: !!current, beforeSha256: current?.sha256 ?? null, afterSha256: hash,
        beforeMode: current?.mode ?? null, afterMode: version?.mode ?? null,
        createdAt: new Date().toISOString(), status: 'prepared', inverseCheckpointId: inverseId, ...event };
      await atomicWrite(join(directory, CHECKPOINT_MANIFEST), Buffer.from(JSON.stringify(manifest)), 0o600);
      // Inverse is private. The public version always records before -> after,
      // while all writes use the same prepare/apply/compensate restore engine.
      await mkdir(inverseDirectory, { mode: 0o700 });
      try {
        if (version) await writeSnapshotFile(version, join(inverseDirectory, "before.bin"));
        await atomicWrite(join(inverseDirectory, CHECKPOINT_MANIFEST), Buffer.from(JSON.stringify({ ...manifest,
          id: inverseId, publicVersionId: id, existed: !!version, beforeSha256: hash, beforeMode: version?.mode ?? null,
          afterSha256: current?.sha256 ?? null, afterMode: current?.mode ?? null })), 0o600);
        await this.restoreCheckpointChain([inverseId]);
      } finally { await rm(inverseDirectory, { recursive: true, force: true }); }
      this.#createdCheckpointIds.push(id);
      for (const key of fileVersionLists.keys()) if (key.startsWith(`${this.#checkpointRoot}\0`)) fileVersionLists.delete(key);
      return { checkpointId: id, path: target, sha256: hash };
    } catch (error) {
      // A partial restore keeps its transaction originals; never delete them.
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async getCheckpointDiff(checkpointId: string, includeContent = false, restoreSide?: "before" | "after"): Promise<AgentCheckpointDiff> {
    if (!/^[A-Za-z0-9-]{16,200}$/.test(checkpointId)) {
      throw new AgentToolError("INVALID_CHECKPOINT", "Checkpoint identifier is invalid");
    }
    const directory = resolve(this.#checkpointRoot, checkpointId);
    if (!isInside(this.#checkpointRoot, directory)) {
      throw new AgentToolError("INVALID_CHECKPOINT", "Checkpoint is outside the checkpoint store");
    }
    const manifest = JSON.parse(await readFile(join(directory, CHECKPOINT_MANIFEST), "utf8")) as CheckpointManifest;
    if (manifest.version !== 1 || manifest.id !== checkpointId || manifest.workspaceRoot !== this.#workspaceRoot) {
      throw new AgentToolError("INVALID_CHECKPOINT", "Checkpoint metadata does not match this workspace");
    }
    const location = {
      workspaceRoot: this.#workspaceRoot,
      ...(manifest.externalTarget ? { externalTarget: manifest.externalTarget } : {})
    };
    if (restoreSide !== undefined) {
      if (!["before", "after"].includes(restoreSide)) throw new AgentToolError("INVALID_CHECKPOINT", "Invalid restore preview version");
      const target = await this.#resolveCheckpointTarget(manifest);
      const current = await this.#checkpointState(target);
      const hash = restoreSide === "before" ? manifest.beforeSha256 : manifest.afterSha256;
      if (hash !== null && !/^[a-f0-9]{64}$/.test(hash)) throw new AgentToolError("INVALID_CHECKPOINT", "Invalid restore preview hash");
      const desired = hash === null ? undefined : await inspectSnapshotFile(join(directory, `${restoreSide}.bin`), { memory: false });
      if (desired && desired.sha256 !== hash) throw new AgentToolError("INVALID_CHECKPOINT", "Checkpoint backup is invalid");
      const mode = restoreSide === "before" ? manifest.beforeMode : manifest.afterMode;
      const unchanged = (current?.sha256 ?? null) === hash
        && (hash === null || mode == null || !!current && (current.mode & 0o7777) === (mode & 0o7777));
      const comparison = { ...manifest, existed: !!current, beforeSha256: current?.sha256 ?? null,
        afterSha256: hash, beforeMode: current?.mode ?? null, afterMode: mode ?? null };
      if ((current ? snapshotFileSize(current) : 0) + (desired ? snapshotFileSize(desired) : 0) > 1024 * 1024) {
        return { ...location, checkpointId, path: portableRelative(manifest.relativePath),
          kind: hash === null ? "deleted" : current ? "modified" : "created", binary: false,
          additions: 0, deletions: 0, patch: "", truncated: true, unchanged, createdAt: manifest.createdAt,
          beforeMode: comparison.beforeMode, afterMode: comparison.afterMode };
      }
      // Compare live bytes with the exact target used by restore. Never add up
      // historical operations: timeline restores can move a file both ways.
      const before = await this.#readCheckpointPreviewContent(current);
      const after = await this.#readCheckpointPreviewContent(desired);
      await this.#resolveCheckpointTarget(manifest);
      return { ...this.#describeCheckpointDiff(comparison, before, after, includeContent), unchanged };
    }
    const beforeSize = manifest.existed ? (await stat(join(directory, "before.bin"))).size : 0;
    let afterSize = 0;
    if (manifest.afterSha256 !== null) {
      try { afterSize = (await stat(join(directory, "after.bin"))).size; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; afterSize = (await stat(await this.#resolveCheckpointTarget(manifest))).size; }
    }
    if (beforeSize + afterSize > 1024 * 1024) {
      if (includeContent) throw new AgentToolError("CHECKPOINT_PREVIEW_TOO_LARGE", "Use checkpoint restore for this large file; inline content exceeds the preview budget");
      return { ...location, checkpointId, path: portableRelative(manifest.relativePath),
        kind: manifest.afterSha256 === null ? "deleted" : manifest.existed ? "modified" : "created",
        binary: false, additions: 0, deletions: 0, patch: "", truncated: true, createdAt: manifest.createdAt,
        beforeMode: manifest.beforeMode, afterMode: manifest.afterMode };
    }
    const before = manifest.existed ? await readFile(join(directory, "before.bin")) : Buffer.alloc(0);
    let after: Buffer;
    try {
      after = manifest.afterSha256 === null ? Buffer.alloc(0) : await readFile(join(directory, "after.bin"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const target = await this.#resolveCheckpointTarget(manifest);
      after = await readFile(target);
      if (sha256(after) !== manifest.afterSha256) {
        throw new AgentToolError("CHECKPOINT_CONTENT_UNAVAILABLE", "Checkpoint output is no longer available");
      }
    }
    return this.#describeCheckpointDiff(manifest, before, after, includeContent);
  }

  async #readCheckpointPreviewContent(file: WorkspaceSnapshotFile | undefined): Promise<Buffer> {
    if (!file) return Buffer.alloc(0);
    if (file.content) return file.content;
    const size = snapshotFileSize(file);
    if (!file.contentPath || size > 1024 * 1024) throw new AgentToolError("CHECKPOINT_PREVIEW_TOO_LARGE", "Checkpoint exceeds the inline preview budget");
    const handle = await open(file.contentPath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size !== size) throw new AgentToolError("CHECKPOINT_CONTENT_UNAVAILABLE", "File changed while reading restore preview");
      const buffer = Buffer.alloc(size + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      const content = buffer.subarray(0, length);
      if (length !== size || sha256(content) !== file.sha256) throw new AgentToolError("CHECKPOINT_CONTENT_UNAVAILABLE", "File changed while reading restore preview");
      return content;
    } finally { await handle.close(); }
  }

  #describeCheckpointDiff(manifest: CheckpointManifest, before: Buffer, after: Buffer, includeContent: boolean): AgentCheckpointDiff {
    const checkpointId = manifest.id;
    const location = { workspaceRoot: this.#workspaceRoot, ...(manifest.externalTarget ? { externalTarget: manifest.externalTarget } : {}) };
    const path = portableRelative(manifest.relativePath);
    try {
      const beforeText = decodeText(before, path);
      const afterText = decodeText(after, path);
      const structured = structuredPatch(manifest.existed ? `a/${path}` : "/dev/null", manifest.afterSha256 === null ? "/dev/null" : `b/${path}`, beforeText, afterText, "before", "after", { context: 3 });
      const additions = structured.hunks.reduce((total, hunk) => total + hunk.lines.filter(line => line.startsWith("+")).length, 0);
      const deletions = structured.hunks.reduce((total, hunk) => total + hunk.lines.filter(line => line.startsWith("-")).length, 0);
      const range = changedLineRange(beforeText, afterText);
      const completePatch = createTwoFilesPatch(manifest.existed ? `a/${path}` : "/dev/null", manifest.afterSha256 === null ? "/dev/null" : `b/${path}`, beforeText, afterText, "before", "after", { context: 3 });
      const maximumPatchCharacters = 500_000;
      return {
        ...location,
        checkpointId,
        path,
        kind: manifest.afterSha256 === null ? "deleted" : manifest.existed ? "modified" : "created",
        binary: false,
        additions,
        deletions,
        patch: completePatch.slice(0, maximumPatchCharacters),
        truncated: completePatch.length > maximumPatchCharacters,
        createdAt: manifest.createdAt,
        beforeMode: manifest.beforeMode, afterMode: manifest.afterMode,
        ...range,
        ...(includeContent ? {
          // History restoration needs exact bytes; only the display patch is truncated.
          beforeContent: beforeText,
          afterContent: afterText,
        } : {}),
      };
    } catch (error) {
      if (!(error instanceof AgentToolError) || !["BINARY_FILE", "INVALID_UTF8"].includes(error.code)) throw error;
      return {
        ...location,
        checkpointId,
        path,
        kind: manifest.afterSha256 === null ? "deleted" : manifest.existed ? "modified" : "created",
        binary: true,
        additions: 0,
        deletions: 0,
        patch: "",
        truncated: false,
        createdAt: manifest.createdAt,
      };
    }
  }

  #protectedTarget(target: string): boolean {
    return isInside(this.#checkpointRoot, target) || target.split(/[\\/]+/).some(segment => segment.toLowerCase() === ".nextmux");
  }

  async #canonicalTarget(candidate: string): Promise<string> {
    let ancestor = candidate;
    const missing: string[] = [];
    while (!(await exists(ancestor))) {
      const parent = dirname(ancestor);
      if (parent === ancestor) throw new AgentToolError("PATH_NOT_FOUND", "Path has no existing parent");
      missing.unshift(basename(ancestor)); ancestor = parent;
    }
    return join(await realpath(ancestor), ...missing);
  }

  async #withFileScope(toolName: string, input: unknown, context: ToolExecutionContext,
    action: (runtime: WorkspaceToolRuntime, input: unknown) => Promise<ToolHandlerResult>): Promise<ToolHandlerResult> {
    await this.assertWorkspaceIdentity();
    const values = record(input);
    const mode = narrowAgentPermission(this.#permissionMode, context.permissionMode ?? this.#permissionMode);
    const mutation = toolName === "workspace.write_file" || toolName === "workspace.apply_patch" || toolName === "workspace.replace_in_file";
    if (mutation && mode === "read_only") throw new AgentToolError("PERMISSION_DENIED", "Read-only tasks cannot write files");
    const candidatePath = values.path ?? values.file_path ?? values.filepath ?? values.filePath;
    const rawPath = stringValue(typeof candidatePath === "string" && !candidatePath.trim() ? "." : candidatePath ?? ".", "path", 1, 2048);
    if (rawPath.includes("\0")) throw new AgentToolError("INVALID_PATH", "Invalid file path");
    const canonical = await this.#canonicalTarget(resolve(this.#workspaceRoot, rawPath));
    if (this.#protectedTarget(canonical) || this.#protectedTarget(resolve(this.#workspaceRoot, rawPath))) throw new AgentToolError("INTERNAL_PATH", "NextMux internal state is not exposed as a model tool");
    if (isInside(this.#workspaceRoot, canonical)) {
      const result = await action(this, { ...values, path: relative(this.#workspaceRoot, canonical) || "." });
      return this.#attachNestedInstructions(canonical, result);
    }
    // Spilled command output was written by this runtime with secrets scrubbed, and a document the user attached to
    // this conversation was saved for reading in parts: reading either needs no approval in any mode, writing them is
    // never possible this way.
    const spillRoot = mutation ? undefined : await this.#spillRoot(false);
    const conversationId = mutation ? undefined : context.taskContext?.conversationId;
    const documentRoot = conversationId ? privateSpillDirectory(attachmentDocumentDirectory(conversationId), false) : undefined;
    const spilledOutput = spillRoot !== undefined && isInside(spillRoot, canonical) || documentRoot !== undefined && isInside(documentRoot, canonical);
    if (mode === "read_only" && !spilledOutput) throw new AgentToolError(isInside(this.#workspaceRoot, resolve(this.#workspaceRoot, rawPath)) ? "SYMLINK_ESCAPE" : "PATH_OUTSIDE_WORKSPACE", "Read-only tools are limited to the selected workspace");
    if (mode === "workspace_write" && !spilledOutput) {
      // A write outside the workspace is shown with its target and, like an outside-writing command, ignores itself
      // after a bounded window when nobody answers (audit OpenCode #12); reads keep the ordinary approval.
      const approved = mutation
        ? await boundedOutsideWriteApproval(() => context.requestPermissionApproval?.({ toolName, scope: "external_file", target: canonical,
          detail: "write", outOfWorkspaceWrite: true, outOfWorkspacePaths: [canonical], autoIgnoreAfterMs: OUTSIDE_WRITE_APPROVAL_TIMEOUT_MS }, context.signal),
          OUTSIDE_WRITE_APPROVAL_TIMEOUT_MS)
        : await context.requestPermissionApproval?.({ toolName, scope: "external_file", target: canonical, detail: "read" }, context.signal);
      if (context.signal?.aborted) throw new AgentToolError("CANCELLED", "Task was cancelled while waiting for file access");
      if (!approved) throw new AgentToolError("PERMISSION_DENIED", "External file access was not approved");
    }
    await this.assertWorkspaceIdentity();
    if (await this.#canonicalTarget(resolve(this.#workspaceRoot, rawPath)) !== canonical) throw new AgentToolError("STALE_PATH", "Path changed while awaiting permission");
    const directory = !mutation && (await stat(canonical).catch(() => undefined))?.isDirectory();
    const root = directory ? canonical : dirname(canonical);
    // Creating parent directories is part of the approved exact file write.
    if (mutation) await mkdir(root, { recursive: true });
    const scoped = new WorkspaceToolRuntime(root, await workspaceDirectoryIdentity(root), this.#checkpointRoot, mode, this.#limits, this.#executionLedger, undefined,
      new ManagedProcessRegistry(), { snapshot: async input => ({ status: "unavailable", source: "none", sha256: input.sha256, reason: "external_file_not_in_project" }) }, this.#formatFile);
    scoped.#checkpointOwnerRoot = this.#workspaceRoot;
    scoped.#externalFilePath = mutation ? canonical : undefined;
    scoped.#lastObservedSha256 = this.#lastObservedSha256;
    const result = await action(scoped, { ...values, path: directory ? "." : basename(canonical) });
    this.#createdCheckpointIds.push(...scoped.#createdCheckpointIds);
    // Preserve the exact absolute resource in activity and checkpoint review.
    return { ...result, modelOutput: { ...(result.modelOutput as Record<string, unknown>), path: canonical },
      summary: { ...result.summary, ...(result.summary.resource?.kind === "file" ? { resource: { ...result.summary.resource, path: canonical } } : {}) } };
  }

  /**
   * Surfaces AGENTS.md/CLAUDE.md files of the accessed subdirectory and its
   * ancestors up to (but excluding) the workspace root, whose instruction file
   * the host already appends. Each file is injected once per runtime and
   * bounded, so nested project rules reach the model without repeating
   * (audit OpenCode #10).
   */
  async #nestedInstructions(absolutePath: string): Promise<{ path: string; content: string }[] | undefined> {
    const metadata = await stat(absolutePath).catch(() => undefined);
    let directory = metadata?.isDirectory() ? absolutePath : dirname(absolutePath);
    const injected: { path: string; content: string }[] = [];
    let total = 0;
    while (isInside(this.#workspaceRoot, directory) && directory !== this.#workspaceRoot) {
      for (const name of NESTED_INSTRUCTION_FILES) {
        const candidate = join(directory, name);
        const relativePath = portableRelative(relative(this.#workspaceRoot, candidate));
        if (this.#injectedInstructionFiles.has(relativePath)) continue;
        let content: string;
        try {
          const fileMetadata = await stat(candidate);
          if (!fileMetadata.isFile() || fileMetadata.size > NESTED_INSTRUCTION_FILE_BYTES) continue;
          content = decodeText(await readFile(candidate), relativePath).slice(0, NESTED_INSTRUCTION_FILE_CHARS);
        } catch {
          continue; // Absent or unreadable: not an instruction file for this directory.
        }
        this.#injectedInstructionFiles.add(relativePath);
        total += content.length;
        injected.push({ path: relativePath, content });
        if (total >= NESTED_INSTRUCTION_TOTAL_CHARS) return injected;
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    return injected.length ? injected : undefined;
  }

  async #attachNestedInstructions(absolutePath: string, result: ToolHandlerResult): Promise<ToolHandlerResult> {
    const instructions = await this.#nestedInstructions(absolutePath);
    if (!instructions) return result;
    return { ...result, modelOutput: { ...(result.modelOutput as Record<string, unknown>), nestedInstructions: instructions } };
  }

  async #resolveCheckpointTarget(manifest: CheckpointManifest): Promise<string> {
    await this.assertWorkspaceIdentity();
    if (!manifest.externalTarget) return this.#resolveWriteTarget(manifest.relativePath, false);
    const target = manifest.externalTarget;
    if (!isAbsolute(target) || target !== manifest.relativePath || this.#protectedTarget(target)
      || await this.#canonicalTarget(target) !== target) throw new AgentToolError("INVALID_CHECKPOINT", "External checkpoint target changed");
    return target;
  }

  async #resolveExisting(inputPath: unknown, allowRoot: boolean): Promise<{ absolute: string; relative: string }> {
    await this.assertWorkspaceIdentity();
    const relativePath = normalizedRelativePath(inputPath, allowRoot, this.#workspaceRoot);
    const candidate = resolve(this.#workspaceRoot, relativePath);
    if (!isInside(this.#workspaceRoot, candidate)) {
      throw new AgentToolError("PATH_OUTSIDE_WORKSPACE", "Path escapes the workspace");
    }
    let resolved: string;
    try {
      resolved = await realpath(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // macOS stores file names in NFD while models usually emit NFC (and vice
        // versa elsewhere): retry each segment under the other normalization
        // before giving up, then name similar existing siblings.
        const recovered = await this.#recoverNormalizedPath(relativePath);
        if (recovered) {
          await this.assertWorkspaceIdentity();
          return recovered;
        }
        const suggestion = await this.#missingPathSuggestion(relativePath);
        throw new AgentToolError("PATH_NOT_FOUND",
          `${portableRelative(relativePath)} does not exist${suggestion ? `. Did you mean one of: ${suggestion}?` : ""}`,
          { params: { path: portableRelative(relativePath), ...(suggestion ? { suggestions: suggestion } : {}) } });
      }
      throw error;
    }
    if (!isInside(this.#workspaceRoot, resolved)) {
      throw new AgentToolError("SYMLINK_ESCAPE", "Resolved path is outside the workspace");
    }
    await this.assertWorkspaceIdentity();
    return { absolute: resolved, relative: relativePath };
  }

  /**
   * Walks the requested path segment by segment, accepting a stored name whose
   * NFC normalization equals the requested segment's. Returns the first
   * segment that could not be resolved under any normalization, or undefined
   * when the whole path now exists.
   */
  async #recoverNormalizedPath(relativePath: string): Promise<{ absolute: string; relative: string } | undefined> {
    const segments = relativePath.split(/[\\/]+/).filter(Boolean);
    if (!segments.length) return undefined;
    let current = this.#workspaceRoot;
    for (const segment of segments) {
      const next = join(current, segment);
      if (await exists(next)) {
        const resolvedSegment = await realpath(next).catch(() => next);
        if (!isInside(this.#workspaceRoot, resolvedSegment)) return undefined;
        current = resolvedSegment;
        continue;
      }
      const wanted = segment.normalize("NFC");
      const siblings = await readdir(current).catch(() => [] as string[]);
      const match = siblings.find(sibling => sibling.normalize("NFC") === wanted);
      if (!match) return undefined;
      current = join(current, match);
    }
    const resolved = await realpath(current).catch(() => current);
    if (!isInside(this.#workspaceRoot, resolved)) return undefined;
    const recoveredRelative = relative(this.#workspaceRoot, resolved);
    return { absolute: resolved, relative: recoveredRelative && !isAbsolute(recoveredRelative) ? recoveredRelative : join(...segments) };
  }

  /** Suggests existing names for the first missing segment of a path. */
  async #missingPathSuggestion(relativePath: string): Promise<string | undefined> {
    const segments = relativePath.split(/[\\/]+/).filter(Boolean);
    let current = this.#workspaceRoot;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]!;
      const next = join(current, segment);
      if (await exists(next)) { current = (await realpath(next).catch(() => next)); continue; }
      const siblings = await readdir(current).catch(() => [] as string[]);
      const suggestions = suggestSiblingNames(segment, siblings);
      return suggestions.length ? suggestions.join(", ") : undefined;
    }
    return undefined;
  }

  async #resolveWriteTarget(inputPath: unknown, createParent = true): Promise<string> {
    await this.assertWorkspaceIdentity();
    const relativePath = normalizedRelativePath(inputPath, false, this.#workspaceRoot);
    const candidate = resolve(this.#workspaceRoot, relativePath);
    if (!isInside(this.#workspaceRoot, candidate)) {
      throw new AgentToolError("PATH_OUTSIDE_WORKSPACE", "Path escapes the workspace");
    }
    if (await exists(candidate)) {
      const metadata = await lstat(candidate);
      if (metadata.isSymbolicLink()) {
        throw new AgentToolError("SYMLINK_WRITE_BLOCKED", "Writing through a symlink is not allowed");
      }
      const resolved = await realpath(candidate);
      if (!isInside(this.#workspaceRoot, resolved)) {
        throw new AgentToolError("SYMLINK_ESCAPE", "Resolved path is outside the workspace");
      }
      if (!metadata.isFile()) throw new AgentToolError("NOT_A_FILE", "Write target is not a file");
      await this.assertWorkspaceIdentity();
      return candidate;
    }

    let ancestor = dirname(candidate);
    while (!(await exists(ancestor))) {
      const parent = dirname(ancestor);
      if (parent === ancestor || !isInside(this.#workspaceRoot, parent)) {
        throw new AgentToolError("PATH_OUTSIDE_WORKSPACE", "Write parent escapes the workspace");
      }
      ancestor = parent;
    }
    const actualAncestor = await realpath(ancestor);
    if (!isInside(this.#workspaceRoot, actualAncestor)) {
      throw new AgentToolError("SYMLINK_ESCAPE", "Write parent resolves outside the workspace");
    }
    await this.assertWorkspaceIdentity();
    if (!createParent) return candidate;
    await mkdir(dirname(candidate), { recursive: true });
    const actualParent = await realpath(dirname(candidate));
    if (!isInside(this.#workspaceRoot, actualParent)) {
      throw new AgentToolError("SYMLINK_ESCAPE", "Write parent resolves outside the workspace");
    }
    await this.assertWorkspaceIdentity();
    return candidate;
  }

  async #walk(startAbsolute: string, maxDepth: number, limit: number, filePattern?: string): Promise<WalkEntry[]> {
    const output: WalkEntry[] = [];
    let visited = 0;
    const maxVisited = Math.max(limit * 4, this.#limits.maxSearchFiles * 4);
    let initialRules: readonly WorkspaceIgnoreRule[] = [];
    if (startAbsolute !== this.#workspaceRoot && isInside(this.#workspaceRoot, startAbsolute)) {
      const relParts = relative(this.#workspaceRoot, dirname(startAbsolute)).split(sep).filter(Boolean);
      let dir = this.#workspaceRoot;
      initialRules = await withDirectoryIgnore(dir, initialRules);
      for (const part of relParts) {
        dir = join(dir, part);
        initialRules = await withDirectoryIgnore(dir, initialRules);
      }
    }
    const queue: { absolutePath: string; relativePath: string; depth: number; rules: readonly WorkspaceIgnoreRule[] }[] = [{
      absolutePath: startAbsolute,
      relativePath: relative(this.#workspaceRoot, startAbsolute),
      depth: 0,
      rules: initialRules,
    }];
    while (queue.length && output.length < limit && visited < maxVisited) {
      const current = queue.shift()!;
      const rules = await withDirectoryIgnore(current.absolutePath, current.rules);
      const entries = (await readdir(current.absolutePath, { withFileTypes: true }))
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (output.length >= limit || visited >= maxVisited) break;
        if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) continue;
        const absolutePath = join(current.absolutePath, entry.name);
        if (workspacePathIgnored(absolutePath, entry.isDirectory(), rules)) continue;
        visited += 1;
        const relativePath = relative(this.#workspaceRoot, absolutePath);
        const matchesPattern = !filePattern
          || matchesFilePattern(relativePath, filePattern)
          || (startAbsolute !== this.#workspaceRoot && matchesFilePattern(relative(startAbsolute, absolutePath), filePattern));
        if (entry.isSymbolicLink()) {
          if (matchesPattern) {
            output.push({ absolutePath, relativePath, type: "symlink" });
          }
        } else if (entry.isDirectory()) {
          if (matchesPattern) {
            output.push({ absolutePath, relativePath, type: "directory" });
          }
          if (current.depth < maxDepth) queue.push({ absolutePath, relativePath, depth: current.depth + 1, rules });
        } else if (entry.isFile()) {
          if (matchesPattern) {
            const metadata = await stat(absolutePath);
            output.push({ absolutePath, relativePath, type: "file", size: metadata.size });
          }
        }
      }
    }
    return output;
  }

  async #listFiles(input: unknown, context: ToolExecutionContext): Promise<ToolHandlerResult> {
    if (context.signal?.aborted) throw new AgentToolError("CANCELLED", "Task was cancelled");
    const args = record(input);
    const target = await this.#resolveExisting(args.path ?? ".", true);
    if (!(await stat(target.absolute)).isDirectory()) {
      throw new AgentToolError("NOT_A_DIRECTORY", "List target is not a directory", { params: { path: portableRelative(target.relative), operation: "list" } });
    }
    const rawPattern = args.pattern ?? args.include;
    const filePattern = rawPattern === undefined ? undefined : stringValue(rawPattern, "pattern", 1, 256).trim();
    const defaultDepth = filePattern ? 8 : 2;
    const maxDepth = upperBoundedIntegerValue(args.maxDepth, "maxDepth", defaultDepth, 0, 8);
    const limit = upperBoundedIntegerValue(args.limit, "limit", 300, 1, this.#limits.maxListEntries);
    const entries = await this.#walk(target.absolute, maxDepth, limit, filePattern);
    const publicEntries = entries.map(entry => ({
      path: portableRelative(entry.relativePath),
      type: entry.type,
      ...(entry.size === undefined ? {} : { size: entry.size }),
    }));
    return {
      modelOutput: { entries: publicEntries, truncated: entries.length >= limit },
      summary: {
        kind: "workspace.list_files", params: { count: publicEntries.length },
        title: `Listed ${publicEntries.length} workspace entries`,
        details: publicEntries.slice(0, 12).map(entry => entry.path),
      },
    };
  }

  async #readFile(input: unknown, context: ToolExecutionContext): Promise<ToolHandlerResult> {
    if (context.signal?.aborted) throw new AgentToolError("CANCELLED", "Task was cancelled");
    const args = record(input);
    const target = await this.#resolveExisting(args.path, false);
    const metadata = await stat(target.absolute);
    const rawStartLine = args.startLine ?? args.start_line;
    const rawEndLine = args.endLine ?? args.end_line;
    if (!metadata.isFile()) throw new AgentToolError("NOT_A_FILE", "Read target is not a file", { params: { path: portableRelative(target.relative), operation: "read" } });
    if (metadata.size > this.#limits.maxFileBytes) {
      if (rawStartLine === undefined && rawEndLine === undefined || metadata.size > this.#limits.maxFileBytes * 64) {
        throw new AgentToolError("FILE_TOO_LARGE", `File exceeds ${this.#limits.maxFileBytes} bytes; request a startLine/endLine range for files up to ${this.#limits.maxFileBytes * 64} bytes`, { params: { maxBytes: this.#limits.maxFileBytes, maxRangeBytes: this.#limits.maxFileBytes * 64 } });
      }
      const startLine = integerValue(rawStartLine, "startLine", 1, 1, Number.MAX_SAFE_INTEGER);
      const endLine = integerValue(rawEndLine, "endLine", Number.MAX_SAFE_INTEGER, startLine, Number.MAX_SAFE_INTEGER);
      const path = portableRelative(target.relative);
      const result = await readLargeTextRange(target.absolute, path, startLine, endLine, this.#limits.maxOutputChars, context.signal);
      this.#lastObservedSha256.set(target.absolute, result.sha256);
      return {
        modelOutput: { path, ...result },
        summary: {
          kind: "workspace.read_file", params: { path, startLine: result.startLine, endLine: result.endLine, totalLines: result.totalLines },
          title: `Read ${path}`,
          details: [`SHA-256 ${result.sha256.slice(0, 12)}…`],
          resource: { kind: "file", path: target.absolute, action: "read", startLine: result.startLine, endLine: result.endLine },
        },
      };
    }
    const buffer = await readFile(target.absolute);
    const fileSha = sha256(buffer);
    this.#lastObservedSha256.set(target.absolute, fileSha);
    const publicPath = portableRelative(target.relative);
    const extracted = tryExtractBinaryDocumentMarkdown(publicPath, buffer);
    const text = extracted ? extracted.markdown : decodeText(buffer, publicPath);
    const lines = text.split(/\r?\n/);
    const startLine = integerValue(rawStartLine, "startLine", 1, 1, Math.max(1, lines.length));
    const endLine = upperBoundedIntegerValue(rawEndLine, "endLine", lines.length, startLine, lines.length);
    const selected = lines.slice(startLine - 1, endLine).join("\n");
    const content = selected.slice(0, this.#limits.maxOutputChars);
    return {
      modelOutput: {
        path: publicPath,
        content,
        startLine,
        endLine,
        totalLines: lines.length,
        sha256: fileSha,
        truncated: content.length < selected.length,
        ...(extracted ? { extractedMarkdown: true, extractionMethod: extracted.method } : {}),
      },
      summary: {
        kind: "workspace.read_file", params: { path: publicPath, startLine, endLine, totalLines: lines.length },
        title: `Read ${publicPath}`,
        details: [`SHA-256 ${fileSha.slice(0, 12)}…`],
        resource: {
          kind: "file",
          path: target.absolute,
          action: "read",
          startLine,
          endLine,
        },
      },
    };
  }

  async #searchText(input: unknown, context: ToolExecutionContext): Promise<ToolHandlerResult> {
    if (context.signal?.aborted) throw new AgentToolError("CANCELLED", "Task was cancelled");
    const args = record(input);
    const query = stringValue(args.query, "query", 1, 256);
    const matchCase = booleanValue(args.matchCase, "matchCase", false);
    const useRegex = booleanValue(args.regex, "regex", false);
    const includePattern = args.include === undefined ? undefined : stringValue(args.include, "include", 1, 256).trim();
    let compiledRegex: RegExp | undefined;
    if (useRegex) {
      try {
        compiledRegex = new RegExp(query, matchCase ? "" : "i");
      } catch (error) {
        throw new AgentToolError("INVALID_ARGUMENTS", `Invalid regular expression in query: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const limit = upperBoundedIntegerValue(args.limit, "limit", 100, 1, this.#limits.maxSearchResults);
    const target = await this.#resolveExisting(args.path ?? ".", true);
    const metadata = await stat(target.absolute);
    const entries = metadata.isFile()
      ? [{ absolutePath: target.absolute, relativePath: target.relative, type: "file" as const, size: metadata.size }]
      : await this.#walk(target.absolute, 32, this.#limits.maxSearchFiles + 1, includePattern);
    const files = entries.filter((entry): entry is WalkEntry & { type: "file" } => entry.type === "file");
    const needle = matchCase ? query : query.toLocaleLowerCase();
    const matches: { path: string; line: number; preview: string }[] = [];
    const skipped: { path: string; reason: string }[] = [];
    const reasons = new Set<string>();
    if (entries.length > this.#limits.maxSearchFiles) reasons.add("entry_limit");
    let filesScanned = 0;
    let bytesScanned = 0;
    let bytesBudgeted = 0;
    const byteBudget = Math.max(this.#limits.maxFileBytes, 128 * 1024 * 1024);
    for (const file of files) {
      if (context.signal?.aborted) throw new AgentToolError("CANCELLED", "Task was cancelled");
      if (matches.length >= limit) { reasons.add("result_limit"); break; }
      if (bytesBudgeted >= byteBudget) { reasons.add("byte_limit"); break; }
      const availableBytes = byteBudget - bytesBudgeted;
      bytesBudgeted += Math.min(file.size ?? availableBytes, availableBytes);
      try {
        const result = await searchTextStream(file.absolutePath, needle, matchCase, limit - matches.length, availableBytes, context.signal, compiledRegex);
        bytesScanned += result.bytes;
        filesScanned += 1;
        matches.push(...result.matches.map(match => ({ path: portableRelative(file.relativePath), ...match })));
        if (result.limited) reasons.add(matches.length >= limit ? "result_limit" : "byte_limit");
      } catch (error) {
        if (context.signal?.aborted) throw new AgentToolError("CANCELLED", "Task was cancelled");
        const code = error instanceof AgentToolError ? error.code : "read_failed";
        // A file that could not be searched is evidence of incomplete coverage,
        // never evidence that the requested symbol/text does not exist.
        if (skipped.length < 50) skipped.push({ path: portableRelative(file.relativePath), reason: code });
        reasons.add("skipped_files");
      }
    }
    return {
      modelOutput: {
        query, matches, filesScanned, bytesScanned, skipped, complete: reasons.size === 0,
        truncated: reasons.size > 0, incompleteReasons: [...reasons],
        excludedDirectories: [...ignoredDirectoryNames], ignoreRules: ".gitignore (root and traversed directories) and .git/info/exclude",
        ...(reasons.size ? { hint: "Search coverage is incomplete; narrow path or query before concluding that a symbol is absent." } : {}),
      },
      summary: {
        kind: "workspace.search_text", params: { count: matches.length, incomplete: reasons.size > 0 },
        title: `Found ${matches.length} matches`,
        details: matches.slice(0, 12).map(match => `${match.path}:${match.line}`),
      },
    };
  }

  async #projectMap(input: unknown, context: ToolExecutionContext): Promise<ToolHandlerResult> {
    const { parseProjectStructure, projectMapSupported } = await import("./workspace-project-map.js");
    const args = record(input);
    const target = await this.#resolveExisting(args.path ?? ".", true);
    const query = args.query === undefined ? "" : stringValue(args.query, "query", 0, 256).toLocaleLowerCase();
    const limit = integerValue(args.limit, "limit", 40, 1, 100);
    const metadata = await stat(target.absolute);
    const entries = metadata.isFile()
      ? [{ absolutePath: target.absolute, relativePath: target.relative, type: "file" as const, size: metadata.size }]
      : await this.#walk(target.absolute, 32, Math.min(2_001, this.#limits.maxSearchFiles + 1));
    const files = entries.filter(entry => entry.type === "file").sort((a, b) =>
      Number(b.relativePath.toLocaleLowerCase().includes(query)) - Number(a.relativePath.toLocaleLowerCase().includes(query)));
    const mapped: { path: string; symbols: readonly { name: string; kind: string; line: number; signature: string }[]; imports: readonly string[]; syntaxIndexed: boolean; score: number; truncated?: boolean }[] = [];
    const warnings = new Set<string>();
    let bytes = 0;
    let parsedFiles = 0;
    for (const entry of files) {
      if (context.signal?.aborted) throw new AgentToolError("CANCELLED", "Task was cancelled");
      const path = portableRelative(entry.relativePath);
      let detail = { symbols: [] as readonly { name: string; kind: string; line: number; signature: string }[], imports: [] as readonly string[], truncated: false };
      let syntaxIndexed = false;
      if (projectMapSupported(path)) {
        if ((entry.size || 0) <= this.#limits.maxFileBytes * 4 && bytes + (entry.size || 0) <= 12 * 1024 * 1024 && parsedFiles < 300) {
          try {
            const content = await readFile(entry.absolutePath);
            bytes += content.length; parsedFiles += 1;
            detail = await parseProjectStructure(path, decodeText(content, path), 120, context.signal);
            syntaxIndexed = true;
          } catch { warnings.add("Some source files could not be parsed"); }
        } else warnings.add("Syntax parsing byte/file budget reached; narrow path");
      }
      const score = (query && path.toLocaleLowerCase().includes(query) ? 20 : 0)
        + detail.symbols.filter(symbol => query && symbol.name.toLocaleLowerCase().includes(query)).length * 10
        + detail.imports.filter(name => query && name.toLocaleLowerCase().includes(query)).length;
      mapped.push({ path, ...detail, syntaxIndexed, score });
    }
    mapped.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    const selected: typeof mapped = [];
    let outputCharacters = 0;
    for (const item of mapped) {
      const size = JSON.stringify(item).length;
      if (selected.length >= limit || outputCharacters + size > 24_000) { warnings.add("Map output budget reached; narrow path or query"); break; }
      selected.push(item); outputCharacters += size;
    }
    if (entries.length >= Math.min(2_001, this.#limits.maxSearchFiles + 1)) warnings.add("Directory entry budget reached; narrow path");
    return {
      modelOutput: { files: selected, parsedFiles, filesConsidered: files.length, supportedSymbolLanguages: ["JavaScript", "TypeScript", "Python", "Go", "Rust"], analysis: "syntax_structure_not_type_or_reference_resolution", otherLanguages: "file_index_only", truncated: warnings.size > 0, warnings: [...warnings] },
      summary: { kind: "workspace.project_map", params: { count: selected.length, symbolCount: selected.reduce((total, item) => total + item.symbols.length, 0) },
        title: `Project map: ${selected.length} files`, details: selected.slice(0, 8).map(item => item.path) },
    };
  }

  async #writeFile(input: unknown, context: ToolExecutionContext): Promise<ToolHandlerResult> {
    if (context.signal?.aborted) throw new AgentToolError("CANCELLED", "Task was cancelled");
    await this.#collectActiveCommandChanges();
    const args = record(input);
    const relativePath = normalizedRelativePath(args.path, false, this.#workspaceRoot);
    const rawContent = stringValue(args.content, "content", 0, this.#limits.maxFileBytes);
    let content: Buffer = Buffer.from(rawContent, "utf8");
    if (content.byteLength > this.#limits.maxFileBytes) {
      throw new AgentToolError("FILE_TOO_LARGE", `Content exceeds ${this.#limits.maxFileBytes} bytes`, { params: { maxBytes: this.#limits.maxFileBytes } });
    }
    const target = await this.#resolveWriteTarget(relativePath);
    const existed = await exists(target);
    const rawExpectedSha = args.expectedSha256 ?? args.expected_sha256;
    const normalizedExpectedSha = typeof rawExpectedSha === "string" ? rawExpectedSha.trim().toLowerCase() : rawExpectedSha;
    let before: Buffer | undefined;
    let beforeMode: number | null = null;
    if (existed) {
      before = await readFile(target);
      beforeMode = (await stat(target)).mode;
      const actualSha = sha256(before);
      if (typeof normalizedExpectedSha !== "string" || normalizedExpectedSha !== actualSha) {
        throw new AgentToolError("STALE_WRITE", `Existing files require the exact SHA-256 returned by read_file (current sha256: ${actualSha})`);
      }
      if (!rawContent.includes("\r\n")) {
        try {
          content = encodePreservingFileFormat(before, rawContent);
        } catch {
          // Non-text or unsupported existing files fall back to exact UTF-8 bytes.
        }
      } else if (before.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) && !rawContent.startsWith("\uFEFF")) {
        content = Buffer.concat([before.subarray(0, 3), content]);
      }
      if (content.byteLength > this.#limits.maxFileBytes) {
        throw new AgentToolError("FILE_TOO_LARGE", `Content exceeds ${this.#limits.maxFileBytes} bytes`, { params: { maxBytes: this.#limits.maxFileBytes } });
      }
    } else if (normalizedExpectedSha !== undefined && normalizedExpectedSha !== null && normalizedExpectedSha !== "") {
      throw new AgentToolError("STALE_WRITE", "A new file must use a null or omitted expectedSha256");
    }

    const beforeText = before?.toString("utf8") ?? "";
    const baseline = before && !Buffer.from(beforeText).equals(before)
      ? { status: "unavailable" as const, source: "none", sha256: sha256(before), reason: "non_utf8_baseline" }
      : await captureWorkspaceDiagnostics(this.#diagnostics, { path: relativePath, content: beforeText, sha256: sha256(Buffer.from(beforeText)), signal: context.signal });
    // Diagnostic latency must not widen the optimistic-write race.
    if (existed && sha256(await readFile(target)) !== sha256(before!)) throw new AgentToolError("STALE_WRITE", "File changed while the edit was being prepared");
    if (!existed && await exists(target)) throw new AgentToolError("STALE_WRITE", "File was created while the edit was being prepared");
    const manifest = await this.#commitFile(relativePath, target, content, existed, before, beforeMode, context);
    const formatted = await this.#formatCommittedFile(target, manifest.afterSha256!);
    const finalContent = formatted.content ?? content;
    const diagnostics = await workspaceDiagnosticDelta(this.#diagnostics, target, { path: relativePath, content: finalContent.toString("utf8"), sha256: formatted.sha256, signal: context.signal }, baseline);
    const publicPath = portableRelative(relativePath);
    let decodedBefore = "";
    if (existed && before) {
      try { decodedBefore = decodeText(before, publicPath); } catch { decodedBefore = ""; }
    }
    const range = changedLineRange(decodedBefore, finalContent.toString("utf8"));
    return {
      modelOutput: {
        path: publicPath,
        sha256: formatted.sha256,
        bytes: finalContent.byteLength,
        checkpointId: manifest.id,
        diagnostics,
      },
      summary: {
        kind: "workspace.write_file", params: { path: publicPath, action: existed ? "updated" : "created", bytes: content.byteLength },
        title: `${existed ? "Updated" : "Created"} ${publicPath}`,
        checkpointId: manifest.id,
        resource: {
          kind: "file",
          path: publicPath,
          action: existed ? "updated" : "created",
          ...range,
        },
      },
    };
  }

  async #applyPatch(input: unknown, context: ToolExecutionContext): Promise<ToolHandlerResult> {
    if (context.signal?.aborted) throw new AgentToolError("CANCELLED", "Task was cancelled");
    await this.#collectActiveCommandChanges();
    const args = record(input);
    const relativePath = normalizedRelativePath(args.path, false, this.#workspaceRoot);
    const patch = stringValue(args.patch, "patch", 1, this.#limits.maxFileBytes);
    const rawExpected = args.expectedSha256 ?? args.expected_sha256;
    const providedSha = typeof rawExpected === "string" && rawExpected.trim() ? rawExpected.trim().toLowerCase() : undefined;

    let target: { absolute: string; relative: string };
    try {
      target = await this.#resolveExisting(relativePath, false);
    } catch (error) {
      if (error instanceof AgentToolError && error.code === "PATH_NOT_FOUND" && !providedSha) {
        const createdText = extractAddFilePatchContent(patch, relativePath, Boolean(this.#externalFilePath));
        if (createdText !== false) {
          return this.#writeFile({ path: relativePath, content: createdText, expectedSha256: null }, context);
        }
      }
      throw error;
    }

    const metadata = await stat(target.absolute);
    if (!metadata.isFile()) throw new AgentToolError("NOT_A_FILE", "Patch target is not a file");
    if (metadata.size > this.#limits.maxFileBytes) {
      throw new AgentToolError("FILE_TOO_LARGE", `File exceeds ${this.#limits.maxFileBytes} bytes`, { params: { maxBytes: this.#limits.maxFileBytes } });
    }
    const before = await readFile(target.absolute);
    const actualSha = sha256(before);
    const expectedSha256 = providedSha ?? this.#lastObservedSha256.get(target.absolute);
    if (expectedSha256 !== undefined) {
      if (!/^[a-f0-9]{64}$/i.test(expectedSha256) || expectedSha256.toLowerCase() !== actualSha) {
        throw new AgentToolError("STALE_WRITE", `Existing files require the exact SHA-256 returned by read_file (current sha256: ${actualSha})`);
      }
    }
    const beforeText = decodeText(before, portableRelative(relativePath));
    const normalizedBeforeText = beforeText.replace(/\r\n/g, "\n");
    const normalizedPatch = patch.replace(/\r\n/g, "\n");
    let afterText: string | false;
    try {
      // A patch without any "@@" hunk (e.g. an envelope whose first hunk has no header) is applied by
      // `diff` as an empty patch: the file comes back unchanged and the edit would be silently lost.
      afterText = parsePatch(normalizedPatch).some(file => file.hunks.length > 0)
        ? applyUnifiedPatch(normalizedBeforeText, normalizedPatch, { fuzzFactor: 0 })
        : false;
    } catch {
      afterText = false;
    }
    if (afterText === false) {
      afterText = applyExactPatchFallback(beforeText, patch, relativePath, Boolean(this.#externalFilePath));
    }
    if (afterText === false) {
      const closest = describeClosestPatchContext(beforeText, patch);
      const hint = closest ? ` Closest context around line ${closest.line} (sha256: ${actualSha}):\n${closest.snippet}` : ` (current sha256: ${actualSha})`;
      throw new AgentToolError("PATCH_FAILED", `Patch context does not match the current file.${hint}`);
    }
    let content: Buffer;
    try {
      content = encodePreservingFileFormat(before, afterText);
    } catch {
      content = Buffer.from(afterText, "utf8");
    }
    if (content.byteLength > this.#limits.maxFileBytes) {
      throw new AgentToolError("FILE_TOO_LARGE", `Patched content exceeds ${this.#limits.maxFileBytes} bytes`, { params: { maxBytes: this.#limits.maxFileBytes } });
    }
    if (content.equals(before)) {
      this.#lastObservedSha256.set(target.absolute, actualSha);
      const publicPath = portableRelative(relativePath);
      return {
        modelOutput: {
          path: publicPath,
          sha256: actualSha,
          bytes: before.byteLength,
          changed: false,
        },
        summary: {
          kind: "workspace.apply_patch", params: { path: publicPath, unchanged: true },
          title: `No changes needed for ${publicPath}`,
        },
      };
    }
    const baseline = await captureWorkspaceDiagnostics(this.#diagnostics, { path: relativePath, content: beforeText, sha256: actualSha, signal: context.signal });
    if (sha256(await readFile(target.absolute)) !== actualSha) throw new AgentToolError("STALE_WRITE", "File changed while the edit was being prepared");
    const manifest = await this.#commitFile(
      relativePath,
      target.absolute,
      content,
      true,
      before,
      metadata.mode,
      context,
    );
    if (manifest.afterSha256) this.#lastObservedSha256.set(target.absolute, manifest.afterSha256);
    const formatted = await this.#formatCommittedFile(target.absolute, manifest.afterSha256!);
    const diagnostics = await workspaceDiagnosticDelta(this.#diagnostics, target.absolute, { path: relativePath, content: (formatted.content ?? Buffer.from(afterText)).toString("utf8"), sha256: formatted.sha256, signal: context.signal }, baseline);
    const publicPath = portableRelative(relativePath);
    const range = changedLineRange(beforeText, formatted.content ? formatted.content.toString("utf8") : afterText);
    return {
      modelOutput: {
        path: publicPath,
        sha256: formatted.sha256,
        bytes: (formatted.content ?? content).byteLength,
        checkpointId: manifest.id,
        diagnostics,
      },
      summary: {
        kind: "workspace.apply_patch", params: { path: publicPath, bytes: content.byteLength },
        title: `Edited ${publicPath}`,
        checkpointId: manifest.id,
        resource: { kind: "file", path: publicPath, action: "updated", ...range },
      },
    };
  }

  async #replaceInFile(input: unknown, context: ToolExecutionContext): Promise<ToolHandlerResult> {
    if (context.signal?.aborted) throw new AgentToolError("CANCELLED", "Task was cancelled");
    await this.#collectActiveCommandChanges();
    const args = record(input);
    const relativePath = normalizedRelativePath(args.path, false, this.#workspaceRoot);
    const rawReplacements = args.replacements;
    if (!Array.isArray(rawReplacements) || rawReplacements.length === 0 || rawReplacements.length > 64) {
      throw new AgentToolError("INVALID_ARGUMENTS", "replacements must be an array of 1-64 { oldText, newText, replaceAll? } entries");
    }
    const replacements = rawReplacements.map((entry, index) => {
      const values = record(entry);
      return {
        oldText: stringValue(values.oldText, `replacements[${index}].oldText`, 1, this.#limits.maxFileBytes),
        newText: stringValue(values.newText ?? "", `replacements[${index}].newText`, 0, this.#limits.maxFileBytes),
        replaceAll: booleanValue(values.replaceAll, `replacements[${index}].replaceAll`, false),
      };
    });
    const rawExpected = args.expectedSha256 ?? args.expected_sha256;
    const providedSha = typeof rawExpected === "string" && rawExpected.trim() ? rawExpected.trim().toLowerCase() : undefined;

    const target = await this.#resolveExisting(relativePath, false);
    const metadata = await stat(target.absolute);
    if (!metadata.isFile()) throw new AgentToolError("NOT_A_FILE", "Replace target is not a file");
    if (metadata.size > this.#limits.maxFileBytes) {
      throw new AgentToolError("FILE_TOO_LARGE", `File exceeds ${this.#limits.maxFileBytes} bytes`, { params: { maxBytes: this.#limits.maxFileBytes } });
    }
    const before = await readFile(target.absolute);
    const actualSha = sha256(before);
    const expectedSha256 = providedSha ?? this.#lastObservedSha256.get(target.absolute);
    if (expectedSha256 !== undefined) {
      if (!/^[a-f0-9]{64}$/i.test(expectedSha256) || expectedSha256.toLowerCase() !== actualSha) {
        throw new AgentToolError("STALE_WRITE", `Existing files require the exact SHA-256 returned by read_file (current sha256: ${actualSha})`);
      }
    }
    const beforeText = decodeText(before, portableRelative(relativePath));
    let afterText = beforeText;
    let totalOccurrences = 0;
    for (const [index, replacement] of replacements.entries()) {
      const outcome = applySmartTextReplacement(afterText, replacement.oldText, replacement.newText, replacement.replaceAll);
      if (!outcome.ok) {
        const closest = describeClosestReplacementContext(afterText, replacement.oldText);
        const hint = closest ? ` Closest context around line ${closest.line} (sha256: ${actualSha}):\n${closest.snippet}` : ` (current sha256: ${actualSha})`;
        throw new AgentToolError(outcome.ambiguous ? "REPLACE_AMBIGUOUS" : "REPLACE_FAILED",
          outcome.ambiguous
            ? `Replacement ${index + 1} matches more than one location; set replaceAll=true or include more surrounding text.${hint}`
            : `Replacement ${index + 1} does not match the current file.${hint}`,
          { params: { index } });
      }
      afterText = outcome.text;
      totalOccurrences += outcome.occurrences;
    }
    let content: Buffer;
    try {
      content = encodePreservingFileFormat(before, afterText);
    } catch {
      content = Buffer.from(afterText, "utf8");
    }
    if (content.byteLength > this.#limits.maxFileBytes) {
      throw new AgentToolError("FILE_TOO_LARGE", `Replaced content exceeds ${this.#limits.maxFileBytes} bytes`, { params: { maxBytes: this.#limits.maxFileBytes } });
    }
    const publicPath = portableRelative(relativePath);
    if (content.equals(before)) {
      this.#lastObservedSha256.set(target.absolute, actualSha);
      return {
        modelOutput: { path: publicPath, sha256: actualSha, bytes: before.byteLength, changed: false, replacements: totalOccurrences },
        summary: {
          kind: "workspace.replace_in_file", params: { path: publicPath, unchanged: true },
          title: `No changes needed for ${publicPath}`,
        },
      };
    }
    const baseline = await captureWorkspaceDiagnostics(this.#diagnostics, { path: relativePath, content: beforeText, sha256: actualSha, signal: context.signal });
    if (sha256(await readFile(target.absolute)) !== actualSha) throw new AgentToolError("STALE_WRITE", "File changed while the edit was being prepared");
    const manifest = await this.#commitFile(relativePath, target.absolute, content, true, before, metadata.mode, context);
    if (manifest.afterSha256) this.#lastObservedSha256.set(target.absolute, manifest.afterSha256);
    const formatted = await this.#formatCommittedFile(target.absolute, manifest.afterSha256!);
    const finalText = formatted.content ? formatted.content.toString("utf8") : afterText;
    const diagnostics = await workspaceDiagnosticDelta(this.#diagnostics, target.absolute, { path: relativePath, content: finalText, sha256: formatted.sha256, signal: context.signal }, baseline);
    const range = changedLineRange(beforeText, finalText);
    return {
      modelOutput: {
        path: publicPath,
        sha256: formatted.sha256,
        bytes: (formatted.content ?? content).byteLength,
        checkpointId: manifest.id,
        replacements: totalOccurrences,
        diagnostics,
      },
      summary: {
        kind: "workspace.replace_in_file", params: { path: publicPath, replacements: totalOccurrences },
        title: `Replaced ${totalOccurrences} occurrence${totalOccurrences === 1 ? "" : "s"} in ${publicPath}`,
        checkpointId: manifest.id,
        resource: { kind: "file", path: publicPath, action: "updated", ...range },
      },
    };
  }

  /**
   * Optional host formatter for a committed edit. A formatter failure never
   * fails the edit; when it rewrites the file, the model-visible SHA-256 is
   * refreshed from the formatted bytes so follow-up writes validate.
   */
  async #formatCommittedFile(target: string, committedSha256: string): Promise<{ sha256: string; content: Buffer | undefined }> {
    const format = this.#formatFile;
    if (!format) return { sha256: committedSha256, content: undefined };
    try {
      await format(target);
      const formatted = await readFile(target);
      const formattedSha256 = sha256(formatted);
      if (formattedSha256 === committedSha256) return { sha256: committedSha256, content: undefined };
      this.#lastObservedSha256.set(target, formattedSha256);
      return { sha256: formattedSha256, content: formatted };
    } catch {
      // Formatting is auxiliary: a broken formatter never invalidates a committed edit.
      return { sha256: committedSha256, content: undefined };
    }
  }

  async #commitFile(
    relativePath: string,
    target: string,
    content: Buffer,
    existed: boolean,
    before: Buffer | undefined,
    beforeMode: number | null,
    context: ToolExecutionContext,
  ): Promise<CheckpointManifest> {
    if (context.signal?.aborted) throw new AgentToolError("CANCELLED", "Task was cancelled");
    const checkpointId = `${context.runId}-${randomUUID()}`;
    const checkpointDirectory = join(this.#checkpointRoot, checkpointId);
    await mkdir(checkpointDirectory, { recursive: false });
    if (before) await writeFile(join(checkpointDirectory, "before.bin"), before);
    const manifest: CheckpointManifest = {
      version: 1,
      id: checkpointId,
      workspaceRoot: this.#checkpointOwnerRoot ?? this.#workspaceRoot,
      relativePath: this.#externalFilePath ?? relativePath,
      ...(this.#externalFilePath ? { externalTarget: this.#externalFilePath } : {}),
      existed,
      beforeSha256: before ? sha256(before) : null,
      afterSha256: sha256(content),
      beforeMode,
      afterMode: beforeMode ?? 0o600,
      createdAt: new Date().toISOString(),
    };
    try {
      await writeFile(join(checkpointDirectory, CHECKPOINT_MANIFEST), JSON.stringify(manifest, undefined, 2), "utf8");
      await writeFile(join(checkpointDirectory, "after.bin"), content);
      await withFileWriteLock(target, async () => {
        const current = await readFile(target).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        });
        if (existed && before && (!current || sha256(current) !== manifest.beforeSha256)) {
          throw new AgentToolError("STALE_WRITE", "File changed while the edit was being prepared");
        }
        if (!existed && current) throw new AgentToolError("STALE_WRITE", "File was created while the edit was being prepared");
        await this.assertWorkspaceIdentity();
        recordWorkspaceWrite(target, "*");
        await atomicWrite(target, content, beforeMode ?? 0o600, context.signal);
        recordWorkspaceWrite(target, manifest.afterSha256);
      });
      this.#createdCheckpointIds.push(manifest.id);
      if (this.#commandBaseline) {
        // Failure updating auxiliary command state must never delete an already
        // committed edit checkpoint or report that the write did not happen.
        try {
          await this.#withSnapshotLock(async () => {
            if (!this.#commandBaseline) return;
            const metadata = await stat(target);
            this.#commandBaseline.files.set(portableRelative(relativePath), { content, sha256: manifest.afterSha256!, mode: metadata.mode, fingerprint: `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}:${metadata.mode}` });
            if (this.#commandSessions.size || this.#observedCommands.size) await this.#persistCommandBaseline();
          });
        } catch { this.#commandSnapshotWarnings.push("Command baseline could not be refreshed after an edit; its edit checkpoint remains available"); }
      }
      return manifest;
    } catch (error) {
      try {
        await rm(checkpointDirectory, { recursive: true, force: true });
      } catch {
        // Preserve the write failure; orphan cleanup is best effort.
      }
      throw error;
    }
  }

  async #withSnapshotLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#snapshotTail;
    let release!: () => void;
    this.#snapshotTail = new Promise<void>(resolveLock => { release = resolveLock; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  async #prepareCommandSnapshot(context: ToolExecutionContext, observedToken?: string): Promise<void> {
    await this.#withSnapshotLock(async () => {
      await this.assertWorkspaceIdentity();
      this.#assertProcessOpen(context.signal);
      if (this.#commandSessions.size || this.#observedCommands.size) {
        if (observedToken) this.#observedCommands.add(observedToken);
        return;
      }
      const capturedAt = Date.now();
      const baseline = await captureWorkspaceSnapshot(this.#workspaceRoot, this.#checkpointRoot, this.#commandBaseline, {
        objectDirectory: join(this.#commandSnapshotDirectory, "objects"), excludedRoots: this.#commandSnapshotExcludedRoots }, context.signal);
      await this.assertWorkspaceIdentity();
      this.#assertProcessOpen(context.signal);
      // Coverage limits degrade recovery for this command, not its permission
      // to run. Single- and multi-root commands retain the same warning trail.
      this.#commandBaseline = baseline;
      this.#commandBaselineAt = capturedAt;
      this.#commandSnapshotWarnings = [...this.#recoveryWarnings, ...this.#commandBaseline.warnings];
      this.#commandSnapshotRunId = context.runId;
      this.#commandSnapshotGeneration = randomUUID();
      await this.#persistCommandBaseline();
      this.#assertProcessOpen(context.signal);
      if (observedToken) this.#observedCommands.add(observedToken);
    });
  }

  async #persistCommandBaseline(phase: "active" | "idle" = "active"): Promise<void> {
    if (phase === "idle" && this.#processStop.signal.aborted) {
      await rm(this.#commandSnapshotDirectory, { recursive: true, force: true });
      return;
    }
    if (this.#commandBaseline) await persistCommandSnapshot(this.#commandSnapshotDirectory, this.#commandBaseline, {
      workspaceRoot: this.#workspaceRoot, directoryIdentity: this.#workspaceIdentity, runId: this.#commandSnapshotRunId, generation: this.#commandSnapshotGeneration, phase,
    });
  }

  async #recoverInterruptedCommands(): Promise<void> {
    const parent = join(this.#checkpointRoot, ".pending-commands");
    let entries;
    try { entries = await readdir(parent, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    const currentDirectory = this.#commandSnapshotDirectory;
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
      const directory = join(parent, entry.name);
      try {
        const metadata = await readCommandSnapshotMetadata(directory, this.#workspaceRoot);
        if (metadata.directoryIdentity !== this.#workspaceIdentity) throw new Error("Interrupted command directory identity cannot be verified");
        if (!Number.isSafeInteger(metadata.ownerPid) || metadata.ownerPid < 1) throw new Error("Invalid snapshot owner");
        let ownerAlive = true;
        try { process.kill(metadata.ownerPid, 0); }
        catch (error) { ownerAlive = (error as NodeJS.ErrnoException).code !== "ESRCH"; }
        if (ownerAlive) continue;
        // Completed commands retain only a run-local cache. Never attribute
        // later external edits to a command that already finished before a crash.
        if (metadata.phase === "idle") {
          await rm(directory, { recursive: true, force: true });
          continue;
        }
        // Retained uncertain-original backups already surfaced their warning and must not be re-collected on every startup.
        if (metadata.warnings?.includes("Original file retained; final command state needs review")) {
          this.#recoveryWarnings.push("An interrupted command snapshot needs manual review; its original backup was preserved");
          continue;
        }
        const { snapshot } = await loadCommandSnapshot(directory, this.#workspaceRoot);
        this.#commandBaseline = snapshot;
        this.#commandBaselineAt = 0;
        this.#commandSnapshotGeneration = metadata.generation;
        this.#commandSnapshotRunId = metadata.runId;
        this.#commandSnapshotDirectory = directory;
        await this.#collectCommandChanges(`recovered-${entry.name}`);
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      } catch {
        this.#recoveryWarnings.push("An interrupted command snapshot needs manual review; its original backup was preserved");
      }
    }
    this.#commandSnapshotDirectory = currentDirectory;
    this.#commandBaseline = undefined;
  }

  async #collectActiveCommandChanges(): Promise<void> {
    const first = (this.#commandSessions.keys().next().value || this.#observedCommands.values().next().value) as string | undefined;
    if (first) await this.#collectCommandChanges(first);
  }

  #checkpointSummary(processId: string): Pick<ToolExecutionSummary, "checkpointIds" | "changedPaths"> {
    const changes = this.#commandResults.get(processId);
    return changes ? { checkpointIds: changes.checkpointIds, changedPaths: changes.changedPaths } : {};
  }

  async #collectCommandChanges(processId: string, finishObserved = false): Promise<{ checkpointIds: string[]; changedPaths: string[]; checkpointCoverage: { complete: boolean; excluded: readonly string[]; warnings: string[] } }> {
    return this.#withSnapshotLock(async () => {
      const previousResult = this.#commandResults.get(processId);
      if (!this.#commandSessions.has(processId) && !this.#observedCommands.has(processId) && previousResult) return previousResult;
      const result = previousResult || { checkpointIds: [], changedPaths: [], checkpointCoverage: { complete: true, excluded: [...COMMAND_CHECKPOINT_EXCLUDES, "Git ignore rules (.gitignore, .git/info/exclude)"], warnings: [] } };
      const before = this.#commandBaseline;
      if (!before) return result;
      let after: WorkspaceSnapshot;
      const capturedAt = Date.now();
      try {
        await this.assertWorkspaceIdentity();
        after = await captureWorkspaceSnapshot(this.#workspaceRoot, this.#checkpointRoot, before, {
          objectDirectory: join(this.#commandSnapshotDirectory, "objects"), excludedRoots: this.#commandSnapshotExcludedRoots });
        await this.assertWorkspaceIdentity();
      } catch (error) {
        // Stop/read must still finish when a root disappears. Keep the original
        // durable baseline and session so restoring that same directory can
        // safely collect changes later; never publish a replacement's files.
        const warning = `Command changes could not be captured; original snapshot preserved: ${error instanceof Error ? error.message : String(error)}`;
        this.#commandSnapshotWarnings = [...new Set([...this.#commandSnapshotWarnings, warning])];
        result.checkpointCoverage = { complete: false, excluded: [...COMMAND_CHECKPOINT_EXCLUDES, "Git ignore rules (.gitignore, .git/info/exclude)"], warnings: [...this.#commandSnapshotWarnings] };
        this.#commandResults.set(processId, result);
        return result;
      }
      // A later successful collection of the same original directory resolves
      // transient capture failures; permanent coverage exclusions remain.
      const warnings = new Set([...this.#commandSnapshotWarnings.filter(warning => !warning.startsWith("Command changes could not be captured; original snapshot preserved:")), ...after.warnings]);
      const uncertainOriginals = new Map<string, NonNullable<ReturnType<typeof before.files.get>>>();
      const paths = new Set([...before.files.keys(), ...after.files.keys()]);
      for (const path of paths) {
        const oldFile = before.files.get(path);
        const newFile = after.files.get(path);
        if (oldFile?.sha256 === newFile?.sha256 && (oldFile?.mode ?? 0) % 4096 === (newFile?.mode ?? 0) % 4096 || snapshotPathExcluded(before, path)) continue;
        if (snapshotPathExcluded(after, path)) {
          if (oldFile) uncertainOriginals.set(path, oldFile);
          continue;
        }
        // Another window's tool edit/restore or an editor save during the
        // command is theirs: restoring the command must never revert it. When
        // that writer's result could not be hashed, what the command did to
        // the file afterwards is unknown, and the coverage says so.
        // A write already adopted into the baseline is not the command's either;
        // what differs from it now (content or mode) is.
        const adopted = this.#adoptedWrites.has(path) && this.#adoptedWrites.get(path) === (oldFile?.sha256 ?? null);
        const outside = adopted ? undefined : outsideWriteOf(resolve(this.#workspaceRoot, path), this.#workspaceRoot, newFile?.sha256 ?? null, this.#commandBaselineAt);
        if (outside === "unknown") warnings.add("Some files were also changed outside this command and could not be attributed");
        if (outside) continue;
        // Incomplete traversal cannot establish that an uncaptured file is new.
        if (!oldFile && before.enumerationComplete !== true) { warnings.add("Some new files could not be attributed to this command"); continue; }
        if (!newFile) {
          try { await lstat(resolve(this.#workspaceRoot, path)); if (oldFile) uncertainOriginals.set(path, oldFile); warnings.add("Some changed files exceeded snapshot coverage"); continue; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") { warnings.add("Some changed files could not be checked"); continue; } }
        }
        // A stable transition ID makes crash recovery between writing files and
        // advancing the baseline idempotent.
        const checkpointId = `${this.#commandSnapshotRunId}-${this.#commandSnapshotGeneration}-${sha256(path).slice(0, 12)}`;
        const directory = join(this.#checkpointRoot, checkpointId);
        const manifest: CheckpointManifest = {
          version: 1, id: checkpointId, workspaceRoot: this.#workspaceRoot, relativePath: path,
          existed: Boolean(oldFile), beforeSha256: oldFile?.sha256 ?? null, afterSha256: newFile?.sha256 ?? null,
          beforeMode: oldFile?.mode ?? null, afterMode: newFile?.mode ?? null, createdAt: new Date().toISOString(),
        };
        // Store both observed states; never rewrite a user's live file while capturing.
        await mkdir(directory, { recursive: true });
        if (oldFile) await writeSnapshotFile(oldFile, join(directory, "before.bin"));
        if (newFile) await writeSnapshotFile(newFile, join(directory, "after.bin"));
        await writeFile(join(directory, CHECKPOINT_MANIFEST), JSON.stringify(manifest), "utf8");
        if (!this.#createdCheckpointIds.includes(checkpointId)) this.#createdCheckpointIds.push(checkpointId);
        if (!result.checkpointIds.includes(checkpointId)) result.checkpointIds.push(checkpointId);
        if (!result.changedPaths.includes(path)) result.changedPaths.push(path);
      }
      // Folders, folder permissions and symbolic links are not restored with file contents: say which changed
      // instead of reporting full coverage (audit B05-04).
      const structuralChanges: string[] = [];
      if (before.structure && after.structure) {
        const occupied = new Set<string>();
        for (const file of [...before.files.keys(), ...after.files.keys()]) {
          for (let slash = file.indexOf("/"); slash >= 0; slash = file.indexOf("/", slash + 1)) occupied.add(file.slice(0, slash + 1));
        }
        const holdsFiles = (folder: string): boolean => occupied.has(folder);
        for (const path of new Set([...before.structure.keys(), ...after.structure.keys()])) {
          const was = before.structure.get(path), now = after.structure.get(path);
          if (was === now) continue;
          // A folder created or removed together with the files in it is undone with those files.
          if (path.endsWith("/") && (!was || !now) && holdsFiles(path)) continue;
          structuralChanges.push(path);
        }
      }
      if (structuralChanges.length) warnings.add("Folders, folder permissions or symbolic links changed; those changes cannot be restored from checkpoints");
      this.#commandBaseline = after;
      this.#commandBaselineAt = capturedAt;
      this.#adoptedWrites.clear();
      this.#commandSnapshotGeneration = randomUUID();
      if (uncertainOriginals.size) {
        warnings.add("Originals of files outside final snapshot coverage were retained for manual recovery");
        // A command may turn a small tracked file into a large/binary artifact.
        // Keep its original even when the final state cannot fit the budget.
        await persistCommandSnapshot(join(this.#checkpointRoot, ".pending-commands", randomUUID()), {
          files: uncertainOriginals, excludedPaths: new Set(), complete: false,
          warnings: ["Original file retained; final command state needs review"],
        }, { workspaceRoot: this.#workspaceRoot, directoryIdentity: this.#workspaceIdentity, runId: this.#commandSnapshotRunId, generation: randomUUID() });
      }
      this.#commandSnapshotWarnings = [...warnings];
      result.checkpointCoverage = { complete: before.complete && after.complete && warnings.size === 0,
        excluded: [...new Set([...COMMAND_CHECKPOINT_EXCLUDES, "Git ignore rules (.gitignore, .git/info/exclude)", ...before.excludedPaths, ...after.excludedPaths,
          ...structuralChanges.slice(0, 50)])], warnings: [...warnings] };
      this.#commandResults.set(processId, result);
      if (!this.#commandSessions.get(processId)?.running) {
        this.#commandSessions.delete(processId);
      }
      if (finishObserved) this.#observedCommands.delete(processId);
      if (this.#commandSessions.size || this.#observedCommands.size) await this.#persistCommandBaseline();
      // Keep immutable objects until dispose so the next command only reads
      // changed files. An atomic idle manifest separates this cache from an
      // interrupted command; each later launch publishes a fresh active one.
      else await this.#persistCommandBaseline("idle");
      return result;
    });
  }

  #processEnvironment(overlay?: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
    const allowedEnvironment = [
      "PATH", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "COMSPEC",
      "ALLUSERSPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)",
      "ProgramW6432", "PROCESSOR_ARCHITECTURE", "PROCESSOR_ARCHITEW6432", "PSModulePath", "WSLENV",
      "LANG", "LC_ALL", "SHELL", "TERM", "COLORTERM",
      // Login shells and developer tools on macOS/Linux rely on these values.
      // They are paths or account metadata rather than credentials; omitting
      // them makes an otherwise valid PTY lose the user's temp directory,
      // SSH agent, and XDG configuration after the packaged app launches it.
      "USER", "LOGNAME", "TMPDIR", "SSH_AUTH_SOCK", "SSH_AGENT_PID",
      "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR",
    ];
    return {
      CI: "true",
      GIT_TERMINAL_PROMPT: "0",
      GIT_PAGER: "cat",
      PAGER: "cat",
      MANPAGER: "cat",
      SSH_ASKPASS_REQUIRE: "never",
      GCM_INTERACTIVE: "never",
      NPM_CONFIG_YES: "true",
      DEBIAN_FRONTEND: "noninteractive",
      PIP_NO_INPUT: "1",
      ...Object.fromEntries(allowedEnvironment
      .map(name => [name, process.env[name]])
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")),
      ...(overlay || {}),
    };
  }

  async #processLaunch(
    input: unknown,
    context: ToolExecutionContext,
    options: {
      readonly defaultTimeoutMs: number;
      readonly maximumTimeoutMs: number;
      readonly allowStdin: boolean;
      readonly allowTty: boolean;
    },
  ): Promise<{ readonly command: string; readonly commandLine: string; readonly session: ManagedProcessSessionLike }> {
    this.#assertProcessOpen(context.signal);
    context = { ...context, signal: context.signal ? AbortSignal.any([context.signal, this.#processStop.signal]) : this.#processStop.signal };
    await this.assertWorkspaceIdentity();
    const values = record(input);
    const useTerminalProfile = options.allowTty && booleanValue(values.useTerminalProfile, "useTerminalProfile", false);
    if (useTerminalProfile && !this.#terminalProfile) {
      throw new AgentToolError("TERMINAL_PROFILE_UNAVAILABLE", "No terminal profile is configured for this task");
    }
    const command = useTerminalProfile
      ? this.#terminalProfile!.shellPath
      : stringValue(values.command, "command", 1, 512);
    if (/[\r\n\0]/.test(command)) throw new AgentToolError("INVALID_COMMAND", "Command contains control characters");
    const argsValue = values.args ?? [];
    if (!Array.isArray(argsValue) || argsValue.length > 64 || argsValue.some(value =>
      typeof value !== "string" || value.length > 4_096 || /[\0]/.test(value)
    )) {
      throw new AgentToolError("INVALID_ARGUMENTS", "args must contain at most 64 bounded strings");
    }
    const args = useTerminalProfile
      ? [...this.#terminalProfile!.shellArgs, ...(argsValue as string[])]
      : argsValue as string[];
    if (args.length > 64) throw new AgentToolError("INVALID_ARGUMENTS", "Combined terminal profile arguments exceed 64 items");
    const commandLine = formatProcessCommandLine(command, args);
    const cwd = await realpath(resolve(this.#workspaceRoot, stringValue(typeof values.cwd === "string" && !values.cwd.trim() ? "." : values.cwd ?? ".", "cwd", 1, 2048)));
    if (!(await stat(cwd)).isDirectory()) throw new AgentToolError("NOT_A_DIRECTORY", "Process cwd is not a directory");
    const timeoutMs = integerValue(values.timeoutMs, "timeoutMs", options.defaultTimeoutMs, 100, options.maximumTimeoutMs);
    const tty = options.allowTty && booleanValue(values.tty, "tty", true);
    const pipeStdin = tty || options.allowStdin && booleanValue(values.pipeStdin, "pipeStdin", false);
    let outputEncoding: string | undefined;
    try { outputEncoding = normalizeProcessOutputEncoding(values.outputEncoding, tty); }
    catch (error) { throw new AgentToolError("INVALID_OUTPUT_ENCODING", error instanceof Error ? error.message : "Invalid process output encoding"); }
    const columns = integerValue(values.columns, "columns", 120, 20, 500);
    const rows = integerValue(values.rows, "rows", 30, 5, 300);
    const mode = narrowAgentPermission(this.#permissionMode, context.permissionMode ?? this.#permissionMode);
    if (mode === "read_only") throw new AgentToolError("PERMISSION_DENIED", "Read-only tasks cannot run commands");
    let launch: { command: string; args: readonly string[] } = { command, args };
    let sandboxed = false;
    if (mode === "workspace_write") {
      const outside = booleanValue(values.allowOutsideWorkspace, "allowOutsideWorkspace", false) || !isInside(this.#workspaceRoot, cwd);
      if (!outside) {
        this.#sandboxDirectory ??= await realpath(await mkdtemp(join(tmpdir(), "nextmux-agent-")));
        const wrapped = await wrapWorkspaceProcess({ command, args, workspaceRoot: this.#workspaceRoot, temporaryRoot: this.#sandboxDirectory, checkpointRoot: this.#checkpointRoot, tty });
        if (wrapped) { launch = wrapped; sandboxed = true; }
      }
      if (!sandboxed) {
        // A compound command line whose parts would write outside the workspace is surfaced on the
        // approval request; a non-full-access run that leaves it unanswered auto-ignores it after a
        // bounded window instead of hanging the task (audit OpenCode #12).
        const writeAnalysis = useTerminalProfile
          ? undefined
          : analyzeCommandForOutsideWrites(command, args, this.#workspaceRoot, cwd);
        const approved = writeAnalysis?.outOfWorkspaceWrite
          ? await boundedOutsideWriteApproval(() => context.requestPermissionApproval?.({
            toolName: options.allowTty ? "process.start" : "process.run",
            scope: "unsandboxed_command", target: commandLine, detail: cwd,
            outOfWorkspaceWrite: true,
            outOfWorkspacePaths: writeAnalysis.outOfWorkspacePaths,
            compoundCommand: writeAnalysis.compound,
            autoIgnoreAfterMs: OUTSIDE_WRITE_APPROVAL_TIMEOUT_MS,
          }, context.signal), OUTSIDE_WRITE_APPROVAL_TIMEOUT_MS)
          : await context.requestPermissionApproval?.({
            toolName: options.allowTty ? "process.start" : "process.run",
            scope: "unsandboxed_command", target: commandLine, detail: cwd,
            ...(writeAnalysis?.compound ? { compoundCommand: true } : {}),
          }, context.signal);
        this.#assertProcessOpen(context.signal);
        if (!approved) throw new AgentToolError("PERMISSION_DENIED", "This command needs explicit one-call permission outside the workspace sandbox");
      }
    }
    await this.#prepareCommandSnapshot(context);
    await this.assertWorkspaceIdentity();
    this.#assertProcessOpen(context.signal);
    let session: ManagedProcessSessionLike;
    // An adapter may asynchronously resolve a terminal profile before it
    // returns the session. Keep the baseline owned during that admission gap.
    const launching = `launch-${randomUUID()}`;
    this.#observedCommands.add(launching);
    let processStarted = false;
    const liveMasker = new SecretOutputMasker(this.#secretValues());
    const runOverlay: Record<string, string> = {
      ...(mode === "full_access" && !sandboxed ? this.#commandEnvironment : {}),
      ...(sandboxed ? { TMPDIR: this.#sandboxDirectory!, TMP: this.#sandboxDirectory!, TEMP: this.#sandboxDirectory! } : {}),
    };
    try {
      session = await this.#processes.start({
        command: launch.command,
        args: [...launch.args],
        cwd,
        env: { ...this.#processEnvironment(useTerminalProfile ? this.#terminalProfile?.env : undefined), ...runOverlay },
        ...(Object.keys(runOverlay).length ? { envOverlay: runOverlay } : {}),
        timeoutMs,
        pipeStdin,
        tty,
        ...(outputEncoding ? { outputEncoding } : {}),
        columns,
        rows,
        signal: context.signal,
        outputCharacterLimit: this.#limits.maxOutputChars,
        callbacks: {
          onStarted: processId => {
            processStarted = true;
            return context.onProcessStarted?.({ processId, commandLine, interactive: pipeStdin || tty });
          },
          onOutput: (processId, chunk) => context.onOutput?.({ processId, stream: chunk.stream, text: liveMasker.mask(chunk.stream, chunk.text) }),
          onExited: (processId, exitCode, signal, failure, terminationReason) => context.onProcessExited?.({
            processId, exitCode, signal, ...(failure ? { failure } : {}),
            ...(terminationReason ? { terminationReason } : {}),
          }),
        },
      });
      if (context.signal?.aborted) {
        await session.terminate("runtime_dispose");
        throw new AgentToolError("CANCELLED", "Workspace run has stopped");
      }
    } catch (error) {
      if (processStarted) await this.#collectCommandChanges(launching, true);
      else await this.discardObservedCommand(launching);
      if (context.signal?.aborted || error instanceof Error && error.name === "AbortError") {
        throw new AgentToolError("CANCELLED", "Task was cancelled");
      }
      throw new AgentToolError("PROCESS_START_FAILED", `${error instanceof Error ? error.message : "Process failed to start"}\ncommand is one executable name or literal path; pass parameters separately in the args array. Shell operators, pipes, and redirects in command are not parsed. For shell syntax, explicitly open the selected terminal profile with useTerminalProfile=true, then send input with process.write.`);
    }
    this.#commandSessions.set(session.processId, session);
    this.#observedCommands.delete(launching);
    if (sandboxed) this.#sandboxedProcesses.add(session.processId);
    return { command, commandLine, session };
  }

  #validatedProcessId(value: unknown): string {
    const processId = stringValue(value, "processId", 8, 180);
    if (!/^proc-[A-Fa-f0-9-]{36}$/.test(processId)) throw new AgentToolError("INVALID_PROCESS_ID", "Process identifier is invalid");
    return processId;
  }

  #processSession(processId: string): ManagedProcessSessionLike {
    // Checkpoint collection retires the active command baseline, not the
    // registry's retained output. Completed process.start sessions remain
    // readable until release/prune/dispose, including after termination.
    const session = this.#commandSessions.get(processId) ?? this.#processes.get(processId);
    if (!session) throw new AgentToolError("PROCESS_NOT_FOUND", "Process session is unavailable or has expired");
    return session;
  }

  async #runProcess(input: unknown, context: ToolExecutionContext): Promise<ToolHandlerResult> {
    this.#assertProcessOpen(context.signal);
    await this.assertWorkspaceIdentity();
    const values = record(input);
    try { normalizeProcessOutputEncoding(values.outputEncoding, false); }
    catch (error) { throw new AgentToolError("INVALID_OUTPUT_ENCODING", error instanceof Error ? error.message : "Invalid process output encoding"); }
    const command = stringValue(values.command, "command", 1, 512);
    const argsValue = values.args ?? [];
    const cwd = await realpath(resolve(this.#workspaceRoot, stringValue(typeof values.cwd === "string" && !values.cwd.trim() ? "." : values.cwd ?? ".", "cwd", 1, 2048)));
    this.#assertProcessOpen(context.signal);
    if (command.toLocaleLowerCase() === "pwd" && Array.isArray(argsValue) && argsValue.length === 0
      && (isInside(this.#workspaceRoot, cwd) || narrowAgentPermission(this.#permissionMode, context.permissionMode ?? this.#permissionMode) === "full_access")) {
      void context.onOutput?.({ stream: "stdout", text: `${cwd}\n` });
      return {
        modelOutput: { exitCode: 0, signal: null, stdout: `${cwd}\n`, stderr: "", truncated: false },
        summary: {
          kind: "process.run", params: { exitCode: 0 },
          title: "pwd exited with code 0",
          commandLine: "pwd",
          details: [cwd],
          outcome: "succeeded",
        },
      };
    }
    const startedAt = Date.now();
    const { commandLine, session } = await this.#processLaunch(input, context, {
      defaultTimeoutMs: 30_000,
      maximumTimeoutMs: 120_000,
      allowStdin: false,
      allowTty: false,
    });
    const result = await session.waitForExit();
    const changes = await this.#collectCommandChanges(session.processId);
    this.#processes.release(session.processId);
    const secrets = this.#secretValues();
    const retainedStdout = result.chunks.filter(chunk => chunk.stream === "stdout" || chunk.stream === "pty").map(chunk => chunk.text).join("");
    const retainedStderr = result.chunks.filter(chunk => chunk.stream === "stderr").map(chunk => chunk.text).join("");
    // Best reconstruction once the ring evicted its middle: the bounded head it kept plus the retained tail.
    const fullStdout = result.truncatedHead ? `${result.truncatedHead.stdout ?? result.truncatedHead.pty ?? ""}${retainedStdout}` : retainedStdout;
    const fullStderr = result.truncatedHead?.stderr ? `${result.truncatedHead.stderr}${retainedStderr}` : retainedStderr;
    const budget = this.#limits.maxOutputChars;
    const assembleStream = (stream: "stdout" | "stderr", tailText: string): { text: string; clipped: boolean } => {
      const headText = result.truncated
        ? (stream === "stdout" ? result.truncatedHead?.stdout ?? result.truncatedHead?.pty : result.truncatedHead?.stderr)
        : undefined;
      if (!headText) return { text: tailText, clipped: false };
      const marker = "\n...[truncated]...\n";
      const available = Math.max(0, budget - marker.length);
      const headLimit = Math.min(headText.length, Math.max(256, Math.floor(available * 0.25)));
      const tailLimit = Math.max(0, available - headLimit);
      const combined = `${headText.slice(0, headLimit)}${marker}${tailText.length > tailLimit ? tailText.slice(tailText.length - tailLimit) : tailText}`;
      return { text: combined, clipped: true };
    };
    const stdoutAssembly = assembleStream("stdout", retainedStdout);
    const stderrAssembly = assembleStream("stderr", retainedStderr);
    // A single over-long line (minified bundles, base64 blobs, stack-trace dumps) is capped so one line can
    // never consume the whole budget; the unclipped text stays inspectable through the spill file (audit Cline #3).
    const stdoutCapped = capProcessOutputLines(stdoutAssembly.text);
    const stderrCapped = capProcessOutputLines(stderrAssembly.text);
    const clipped = stdoutAssembly.clipped || stderrAssembly.clipped
      || stdoutCapped.length !== stdoutAssembly.text.length || stderrCapped.length !== stderrAssembly.text.length;
    let stdout = scrubSecretValues(stdoutCapped, secrets);
    const stderr = scrubSecretValues(stderrCapped, secrets);
    if (clipped) {
      const spilled = await this.#spillProcessOutput(session.processId, scrubSecretValues(fullStdout, secrets), scrubSecretValues(fullStderr, secrets));
      if (spilled) {
        stdout += `\n[Full unclipped output saved to ${spilled}. Use workspace.read_file with startLine/endLine or workspace.search_text to inspect omitted lines.]`;
      }
    }
    const preview = redacted(`${stdout}${stderr ? `\n${stderr}` : ""}`).trim().slice(0, 2_000);
    return {
      modelOutput: {
        ...changes,
        exitCode: result.exitCode,
        signal: result.signal,
        stdout,
        stderr,
        truncated: result.truncated || clipped,
        ...(clipped && !result.truncated ? { truncation: "line_capped" as const } : {}),
        ...(result.outputEncoding ? { outputEncoding: result.outputEncoding } : {}),
        ...(result.terminationReason ? { terminationReason: result.terminationReason } : {}),
      },
      summary: {
        checkpointIds: changes.checkpointIds,
        changedPaths: changes.changedPaths,
        kind: "process.run", params: { exitCode: result.exitCode ?? result.signal ?? "unknown", durationMs: Date.now() - startedAt,
          incompleteCheckpoint: !changes.checkpointCoverage.complete, truncated: result.truncated,
          ...(result.outputEncoding ? { outputEncoding: result.outputEncoding } : {}) },
        title: `${command} exited with code ${result.exitCode ?? result.signal ?? "unknown"}`,
        commandLine,
        outcome: result.exitCode === 0 && result.signal === null ? "succeeded" : "failed",
        ...(result.terminationReason ? { terminationReason: result.terminationReason } : {}),
        details: preview ? preview.split(/\r?\n/).slice(0, 8) : [],
      },
    };
  }

  /** The private folder spilled output goes to (tool-output-spill.ts); created on the first spill only. */
  async #spillRoot(create = true): Promise<string | undefined> {
    if (this.#spillDirectory) return this.#spillDirectory;
    const directory = privateSpillDirectory(toolOutputSpillDirectory(this.#workspaceRoot), create);
    if (directory) this.#spillDirectory = directory;
    return directory;
  }

  /**
   * Writes the complete unclipped output of a finished command (secrets already scrubbed) so omitted lines stay
   * inspectable with workspace.read_file / workspace.search_text (audit Cline #3 / OpenCode #2).
   */
  async #spillProcessOutput(processId: string, stdout: string, stderr: string): Promise<string | undefined> {
    const body = stderr
      ? `${stdout}${stdout ? "\n" : ""}===== stderr =====\n${stderr}`
      : stdout;
    if (!body) return undefined;
    const directory = await this.#spillRoot();
    if (!directory) return undefined;
    const target = join(directory, `${processId}.log`);
    try {
      await writeFile(target, body, { encoding: "utf8", mode: 0o600 });
    } catch {
      return undefined;
    }
    pruneSpillDirectory(directory);
    return target;
  }

  async #startProcess(input: unknown, context: ToolExecutionContext): Promise<ToolHandlerResult> {
    const { command, commandLine, session } = await this.#processLaunch(input, context, {
      defaultTimeoutMs: 0,
      maximumTimeoutMs: 1_800_000,
      allowStdin: true,
      allowTty: true,
    });
    const initial = session.snapshot(0, 4_096);
    return {
      modelOutput: {
        processId: session.processId,
        nextSequence: 0,
        latestSequence: initial.latestSequence,
        hasMore: initial.latestSequence > 0,
        running: session.running,
        tty: session.tty,
        outputCharacterLimit: initial.outputCharacterLimit,
        ...(initial.outputEncoding ? { outputEncoding: initial.outputEncoding } : {}),
      },
      summary: {
        kind: "process.start", params: { processId: session.processId, ...(initial.outputEncoding ? { outputEncoding: initial.outputEncoding } : {}) },
        title: `Started ${command}`,
        commandLine,
        details: [session.processId],
        outcome: "succeeded",
      },
    };
  }

  async #readProcess(input: unknown, context: ToolExecutionContext): Promise<ToolHandlerResult> {
    if (context.signal?.aborted) throw new AgentToolError("CANCELLED", "Task was cancelled");
    const values = record(input);
    const processId = this.#validatedProcessId(values.processId);
    const afterSequence = integerValue(values.afterSequence, "afterSequence", 0, 0, Number.MAX_SAFE_INTEGER);
    const maxCharacters = integerValue(values.maxCharacters, "maxCharacters", 65_536, 4_096, 80_000);
    const waitMs = integerValue(values.waitMs, "waitMs", 5_000, 0, 30_000);
    let snapshot: ReturnType<ManagedProcessSessionLike["snapshot"]>;
    try {
      const session = this.#processSession(processId);
      snapshot = this.#scrubSnapshot(await session.read(
        afterSequence,
        maxCharacters,
        waitMs,
        context.signal,
      ), session);
    } catch (error) {
      if (context.signal?.aborted || error instanceof Error && error.name === "AbortError") {
        throw new AgentToolError("CANCELLED", "Task was cancelled");
      }
      throw error;
    }
    if (context.signal?.aborted) throw new AgentToolError("CANCELLED", "Task was cancelled");
    return {
      modelOutput: { ...snapshot, ...(!snapshot.running && snapshot.exitCode !== null && snapshot.exitCode !== 0
        ? { failure: `${snapshot.failure ? `${snapshot.failure}\n` : ""}command is one executable name or literal path; pass parameters separately in the args array. Shell operators, pipes, and redirects in command are not parsed. For shell syntax, explicitly open the selected terminal profile with useTerminalProfile=true, then send input with process.write.` } : {}),
        ...(!snapshot.running ? await this.#collectCommandChanges(processId) : {}) },
      summary: {
        ...(!snapshot.running ? this.#checkpointSummary(processId) : {}),
        kind: "process.read", params: { processId, running: snapshot.running, count: snapshot.chunks.length, sequence: snapshot.nextSequence },
        title: snapshot.running ? "Read latest process output" : "Process exited",
        details: [processId],
        outcome: snapshot.running || snapshot.exitCode === 0 && snapshot.signal === null ? "succeeded" : "failed",
      },
    };
  }

  async #writeProcess(input: unknown, context: ToolExecutionContext): Promise<ToolHandlerResult> {
    this.#assertProcessOpen(context.signal);
    context = { ...context, signal: context.signal ? AbortSignal.any([context.signal, this.#processStop.signal]) : this.#processStop.signal };
    await this.assertWorkspaceIdentity();
    const values = record(input);
    const processId = this.#validatedProcessId(values.processId);
    const data = values.data === undefined ? "" : stringValue(values.data, "data", 0, 16_384);
    const closeStdin = booleanValue(values.closeStdin, "closeStdin", false);
    const session = this.#processSession(processId);
    // Closing stdin is process input too (EOF is what many programs act on), so it needs the same one-call approval
    // as written data, and the approval shows it (audit C35-02).
    if ((narrowAgentPermission(this.#permissionMode, context.permissionMode ?? this.#permissionMode)) === "workspace_write" && (data || closeStdin) && !this.#sandboxedProcesses.has(processId)) {
      const target = `${data}${closeStdin ? `${data ? "\n" : ""}[EOF]` : ""}`;
      const approved = await context.requestPermissionApproval?.({ toolName: "process.write", scope: "process_input", target, detail: processId }, context.signal);
      this.#assertProcessOpen(context.signal);
      if (!approved) throw new AgentToolError("PERMISSION_DENIED", "Writing to an unrestricted process needs one-call permission");
    }
    await this.assertWorkspaceIdentity();
    try {
      this.#assertProcessOpen(context.signal);
      if (data) await session.write(data);
      if (context.signal?.aborted) throw new AgentToolError("CANCELLED", "Task was cancelled");
      if (closeStdin) await session.closeStdin();
      if (context.signal?.aborted) throw new AgentToolError("CANCELLED", "Task was cancelled");
    } catch (error) {
      if (context.signal?.aborted || error instanceof AgentToolError && error.code === "CANCELLED") throw error;
      throw new AgentToolError("PROCESS_INPUT_FAILED", error instanceof Error ? error.message : "Process input failed");
    }
    return {
      // A terminal (PTY) has no input pipe to close: the EOF key is typed, which a program in raw mode or with
      // unfinished line input may not treat as end of input (audit B06-08).
      modelOutput: { processId, accepted: data.length, ...(closeStdin ? session.tty
        ? { closed: false, eofKeySent: true, note: "Sent the end-of-input key to the terminal; programs reading raw keys may ignore it. Start the command without a terminal (tty: false) to close its input for certain." }
        : { closed: true } : { closed: false }) },
      summary: { kind: "process.write", params: { processId }, title: "Wrote process input", details: [processId], outcome: "succeeded" },
    };
  }

  async #terminateProcess(input: unknown, context: ToolExecutionContext): Promise<ToolHandlerResult> {
    if (context.signal?.aborted) throw new AgentToolError("CANCELLED", "Task was cancelled");
    const values = record(input);
    const processId = this.#validatedProcessId(values.processId);
    const session = this.#processSession(processId);
    const running = await session.terminate();
    if (context.signal?.aborted) throw new AgentToolError("CANCELLED", "Task was cancelled");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const snapshot = await Promise.race([
      session.waitForExit(),
      new Promise<ReturnType<ManagedProcessSessionLike["snapshot"]>>(resolveWait => {
        timeout = setTimeout(() => resolveWait(session.snapshot()), 5_000);
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
    if (context.signal?.aborted) throw new AgentToolError("CANCELLED", "Task was cancelled");
    if (snapshot.running) {
      throw new AgentToolError("PROCESS_TERMINATION_FAILED", "The process tree is still running after forced termination");
    }
    const changes = await this.#collectCommandChanges(processId);
    return {
      // A termination acknowledgement must not serialize the entire retained PTY ring.
      // Return one readable page with its cursor; process.read can retrieve the rest.
      modelOutput: { ...this.#scrubSnapshot(session.snapshot(0, 65_536), session), terminationRequested: running, ...changes },
      summary: { kind: "process.terminate", params: { processId, alreadyExited: !running }, title: running ? "Terminated process" : "Process already exited", details: [processId], outcome: "succeeded", ...this.#checkpointSummary(processId) },
    };
  }
}
