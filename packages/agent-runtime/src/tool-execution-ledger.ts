import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, stat, truncate, unlink, writeFile } from "node:fs/promises";
import { dirname, posix, resolve } from "node:path";

import type {
  AgentToolCall,
  AgentToolDescriptor,
  ToolExecutionContext,
  ToolExecutionLedgerState,
  ToolExecutionResult,
  AgentMessageAttachment,
} from "./types.js";

const JOURNAL_VERSION = 1;
const DEFAULT_MAX_JOURNAL_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_BYTES = 1024 * 1024;
const sharedLedgers = new Map<string, Promise<ToolExecutionLedger>>();

export interface ToolExecutionLedgerOptions {
  readonly journalPath: string;
  readonly maxJournalBytes?: number;
  readonly maxEntryBytes?: number;
}

interface JournalEntry {
  readonly version: 1;
  readonly fingerprint: string;
  /** Stable across intentional executions; retains unknown-outcome protection for the whole scope. */
  readonly logicalFingerprint?: string;
  readonly toolName: string;
  readonly state: ToolExecutionLedgerState;
  readonly attempt: number;
  readonly callId: string;
  readonly runId: string;
  readonly executionScopeId: string;
  readonly ownerId: string;
  readonly ownerPid: number;
  readonly at: string;
  readonly result?: ToolExecutionResult;
  /** Large image bytes live beside the local journal, not in every JSONL record. */
  readonly attachmentAsset?: { readonly sha256: string; readonly bytes: number };
  readonly reason?: string;
}

function boundedPositive(value: number | undefined, fallback: number, maximum: number): number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= maximum
    ? value as number : fallback;
}

function normalizePortablePath(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const portable = value.replace(/\\/g, "/");
  const normalized = posix.normalize(portable);
  return normalized === "." ? "." : normalized.replace(/^\.\//, "");
}

function normalizedArguments(call: AgentToolCall): unknown {
  if (!call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments)) return call.arguments;
  const source = call.arguments as Readonly<Record<string, unknown>>;
  const normalized: Record<string, unknown> = { ...source };
  if ("path" in normalized) normalized.path = normalizePortablePath(normalized.path);
  if ("cwd" in normalized) normalized.cwd = normalizePortablePath(normalized.cwd);
  // Optimistic-concurrency guards prove that an effect is currently safe, but
  // do not change the intended write or patch. A retry may legitimately carry
  // a newly observed guard for the same logical effect.
  if (call.name === "workspace.write_file" || call.name === "workspace.apply_patch") {
    delete normalized.expectedSha256;
  }
  return normalized;
}

function stableValue(value: unknown, seen = new Set<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return JSON.stringify(String(value));
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (typeof value === "bigint") return JSON.stringify(`${value}n`);
  if (typeof value === "undefined") return '"[undefined]"';
  if (typeof value !== "object") return JSON.stringify(String(value));
  if (seen.has(value)) throw new TypeError("Tool arguments cannot contain cycles");
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map(item => stableValue(item, seen)).join(",")}]`;
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableValue(record[key], seen)}`).join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

function logicalFingerprint(call: AgentToolCall, executionScopeId: string): string {
  const logical = stableValue({
    version: JOURNAL_VERSION,
    executionScopeId,
    toolName: call.name,
    arguments: normalizedArguments(call),
  });
  return createHash("sha256").update(logical).digest("hex");
}

function sideEffecting(descriptor: AgentToolDescriptor): boolean {
  if (descriptor.executionKind) return descriptor.executionKind === "side_effect";
  if (descriptor.source === "mcp") return true;
  if (/^workspace\.(?:write_file|apply_patch|edit|create|delete|move|rename|replace)$/i.test(descriptor.name)) return true;
  if (/^process\.(?:run|start|write|terminate)$/i.test(descriptor.name)) return true;
  return descriptor.requiredPermission !== "read_only";
}

function safeFailure(code: string | undefined): boolean {
  if (!code) return false;
  return code === "PERMISSION_DENIED" || code === "TOOL_NOT_ALLOWED" || code === "TOOL_NOT_FOUND"
    || code === "STALE_WRITE" || code.startsWith("INVALID_") || code === "PATH_OUTSIDE_WORKSPACE"
    || code === "FILE_NOT_FOUND" || code === "NOT_A_FILE" || code === "PATCH_FAILED"
    // Rejected while parsing or measuring, before any write: a corrected retry must not be blocked as a replay.
    || code === "PATCH_INVALID" || code === "FILE_TOO_LARGE";
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" ? (error as NodeJS.ErrnoException).code : undefined;
    return code === "EPERM";
  }
}

function cloneResult(result: ToolExecutionResult): ToolExecutionResult {
  return JSON.parse(JSON.stringify(result)) as ToolExecutionResult;
}

function ledgerResult(
  result: ToolExecutionResult,
  fingerprint: string,
  state: ToolExecutionLedgerState,
  replayed: boolean,
): ToolExecutionResult {
  return {
    ...cloneResult(result),
    ledger: Object.freeze({ fingerprint, state, replayed }),
  };
}

function uncertainResult(fingerprint: string, reason: string): ToolExecutionResult {
  return {
    ok: false,
    summary: {
      kind: "tool.execution_unknown", params: { code: "TOOL_EXECUTION_UNKNOWN" },
      title: "The operation's side-effect status is unknown",
    },
    error: {
      code: "TOOL_EXECUTION_UNKNOWN",
      message: reason,
    },
    ledger: Object.freeze({ fingerprint, state: "unknown", replayed: true }),
  };
}

function validJournalEntry(value: unknown): value is JournalEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<JournalEntry>;
  return entry.version === 1
    && typeof entry.fingerprint === "string" && /^[a-f0-9]{64}$/.test(entry.fingerprint)
    && (entry.logicalFingerprint === undefined || typeof entry.logicalFingerprint === "string" && /^[a-f0-9]{64}$/.test(entry.logicalFingerprint))
    && typeof entry.toolName === "string" && entry.toolName.length > 0 && entry.toolName.length <= 180
    && ["prepared", "running", "committed", "failed", "unknown"].includes(String(entry.state))
    && Number.isSafeInteger(entry.attempt) && (entry.attempt as number) >= 1
    && typeof entry.callId === "string" && entry.callId.length > 0 && entry.callId.length <= 160
    && typeof entry.runId === "string" && entry.runId.length > 0 && entry.runId.length <= 180
    && typeof entry.executionScopeId === "string" && entry.executionScopeId.length > 0 && entry.executionScopeId.length <= 180
    && typeof entry.ownerId === "string" && entry.ownerId.length > 0 && entry.ownerId.length <= 180
    && Number.isSafeInteger(entry.ownerPid) && (entry.ownerPid as number) > 0
    && typeof entry.at === "string" && !Number.isNaN(Date.parse(entry.at))
    && (entry.state !== "committed" || Boolean(entry.result && typeof entry.result === "object"
      && typeof entry.result.ok === "boolean" && entry.result.summary
      && typeof entry.result.summary.title === "string"));
}

/**
 * Durable idempotency module for tool effects.
 *
 * Reads bypass the ledger. Effects cross a prepared -> running -> terminal
 * journal before their handler result is released. A committed result can be
 * replayed, while a running operation whose process died becomes unknown and
 * is permanently fail-closed within the same execution scope.
 */
export class ToolExecutionLedger {
  readonly #journalPath: string;
  readonly #lockRoot: string;
  readonly #maxJournalBytes: number;
  readonly #maxEntryBytes: number;
  readonly #ownerId = `ledger-${randomUUID()}`;
  readonly #entries = new Map<string, JournalEntry>();
  /** Committed effects from before a crash that a recovered run has already handed back once. */
  readonly #reconciledAfterRecovery = new Set<string>();
  readonly #logicalEntries = new Map<string, Map<string, JournalEntry>>();
  readonly #inFlight = new Map<string, Promise<ToolExecutionResult>>();
  #appendQueue = Promise.resolve();

  private constructor(options: ToolExecutionLedgerOptions) {
    this.#journalPath = resolve(options.journalPath);
    this.#lockRoot = `${this.#journalPath}.locks`;
    this.#maxJournalBytes = boundedPositive(options.maxJournalBytes, DEFAULT_MAX_JOURNAL_BYTES, 512 * 1024 * 1024);
    this.#maxEntryBytes = boundedPositive(options.maxEntryBytes, DEFAULT_MAX_ENTRY_BYTES, 16 * 1024 * 1024);
  }

  static open(options: ToolExecutionLedgerOptions): Promise<ToolExecutionLedger> {
    const journalPath = resolve(options.journalPath);
    const existing = sharedLedgers.get(journalPath);
    if (existing) return existing;
    const opening = ToolExecutionLedger.#open({ ...options, journalPath }).catch(error => {
      sharedLedgers.delete(journalPath);
      throw error;
    });
    sharedLedgers.set(journalPath, opening);
    return opening;
  }

  static async #open(options: ToolExecutionLedgerOptions): Promise<ToolExecutionLedger> {
    const ledger = new ToolExecutionLedger(options);
    await mkdir(dirname(ledger.#journalPath), { recursive: true });
    await mkdir(ledger.#lockRoot, { recursive: true });
    await ledger.#load();
    await ledger.#recoverDeadOwners();
    await ledger.#compactIfNeeded();
    return ledger;
  }

  fingerprint(call: AgentToolCall, executionScopeId: string): string {
    return logicalFingerprint(call, executionScopeId);
  }

  /** Read only: an interrupted batch may hydrate a committed result, never start an effect. */
  async recoverCommitted(call: AgentToolCall, context: ToolExecutionContext): Promise<ToolExecutionResult | undefined> {
    if (!context.executionId) return undefined;
    const logical = logicalFingerprint(call, context.executionScopeId?.trim() || context.runId);
    const fingerprint = createHash("sha256").update(stableValue({ logical, executionId: context.executionId })).digest("hex");
    await this.#refresh();
    const entry = this.#entries.get(fingerprint);
    if (entry?.state !== "committed" || !entry.result) return undefined;
    try {
      const result = entry.attachmentAsset
        ? { ...entry.result, attachments: await this.#readAttachments(entry.attachmentAsset) } : entry.result;
      return ledgerResult(result, fingerprint, "committed", true);
    } catch { return undefined; }
  }

  async execute(
    call: AgentToolCall,
    descriptor: AgentToolDescriptor,
    context: ToolExecutionContext,
    operation: () => Promise<ToolExecutionResult>,
  ): Promise<ToolExecutionResult> {
    if (!sideEffecting(descriptor)) return operation();
    const executionScopeId = context.executionScopeId?.trim() || context.runId;
    const logical = logicalFingerprint(call, executionScopeId);
    // Without a host batch identity retain legacy callers' conservative semantics.
    // A model-supplied call ID alone cannot upgrade an uncertain effect to a new intent.
    const fingerprint = context.executionId
      ? createHash("sha256").update(stableValue({ logical, executionId: context.executionId })).digest("hex")
      : logical;
    const active = this.#inFlight.get(fingerprint);
    if (active) {
      const result = await active;
      return ledgerResult(result, fingerprint, result.ledger?.state ?? "unknown", true);
    }
    const pending = this.#executeEffect(call, context, executionScopeId, fingerprint, logical, operation);
    this.#inFlight.set(fingerprint, pending);
    try {
      return await pending;
    } finally {
      if (this.#inFlight.get(fingerprint) === pending) this.#inFlight.delete(fingerprint);
    }
  }

  async #executeEffect(
    call: AgentToolCall,
    context: ToolExecutionContext,
    executionScopeId: string,
    fingerprint: string,
    logical: string,
    operation: () => Promise<ToolExecutionResult>,
  ): Promise<ToolExecutionResult> {
    const release = await this.#acquireLock(`effect-${logical}`, 30_000);
    if (!release) {
      return uncertainResult(fingerprint, "Another runtime is still handling this logical effect; automatic replay is blocked");
    }
    try {
      await this.#refresh();
      return await this.#executeLockedEffect(call, context, executionScopeId, fingerprint, logical, operation);
    } finally {
      await release();
    }
  }

  async #executeLockedEffect(
    call: AgentToolCall,
    context: ToolExecutionContext,
    executionScopeId: string,
    fingerprint: string,
    logical: string,
    operation: () => Promise<ToolExecutionResult>,
  ): Promise<ToolExecutionResult> {
    const related = [...(this.#logicalEntries.get(logical)?.values() ?? [])];
    // A new model batch or call ID never authorizes retrying an unknown effect.
    if (related.some(entry => ["unknown", "running", "prepared"].includes(entry.state))) {
      return uncertainResult(fingerprint, "A previous attempt may have produced this side effect; automatic replay is blocked");
    }
    const unseen = context.recoveredSeenCallIds;
    const previous = this.#entries.get(fingerprint)
      ?? (context.replayPreviousEffects ? related.reverse().find(entry => entry.state === "committed") : undefined)
      ?? (unseen ? [...related].reverse().find(entry => entry.state === "committed"
        && !unseen.has(entry.callId) && !this.#reconciledAfterRecovery.has(entry.fingerprint)) : undefined);
    if (previous?.state === "committed" && previous.result) {
      if (previous.fingerprint !== fingerprint) this.#reconciledAfterRecovery.add(previous.fingerprint);
      try {
        const result = previous.attachmentAsset
          ? { ...previous.result, attachments: await this.#readAttachments(previous.attachmentAsset) }
          : previous.result;
        return ledgerResult(result, fingerprint, "committed", true);
      } catch {
        return uncertainResult(fingerprint, "The committed tool media could not be recovered; do not repeat the operation automatically");
      }
    }
    if (previous?.state === "unknown" || previous?.state === "running" || previous?.state === "prepared") {
      return uncertainResult(fingerprint, "A previous attempt may have produced this side effect; automatic replay is blocked");
    }
    const attempt = (previous?.attempt ?? 0) + 1;
    const base = {
      version: JOURNAL_VERSION,
      fingerprint,
      logicalFingerprint: logical,
      toolName: call.name,
      attempt,
      callId: call.id,
      runId: context.runId,
      executionScopeId,
      ownerId: this.#ownerId,
      ownerPid: process.pid,
    } as const;
    await this.#append({ ...base, state: "prepared", at: new Date().toISOString() });
    if (context.signal?.aborted) {
      await this.#append({ ...base, state: "failed", reason: "cancelled_before_start", at: new Date().toISOString() });
      return {
        ok: false,
        summary: { kind: "tool.error", params: { code: "CANCELLED" }, title: "Task cancelled" },
        error: { code: "CANCELLED", message: "Agent run was cancelled before the effect started" },
        ledger: Object.freeze({ fingerprint, state: "failed", replayed: false }),
      };
    }
    await this.#append({ ...base, state: "running", at: new Date().toISOString() });
    let result: ToolExecutionResult;
    try {
      result = await operation();
    } catch {
      await this.#append({ ...base, state: "unknown", reason: "handler_threw_after_start", at: new Date().toISOString() });
      return uncertainResult(fingerprint, "The tool handler stopped after the effect began; automatic replay is blocked");
    }
    const state: ToolExecutionLedgerState = result.unsettled ? "unknown" : result.ok ? "committed" : safeFailure(result.error?.code) ? "failed" : "unknown";
    const terminal: JournalEntry = {
      ...base,
      state,
      at: new Date().toISOString(),
      ...(state === "committed" ? { result: cloneResult(result) } : {}),
      ...(!result.ok && result.error ? { reason: result.error.code } : {}),
    };
    try {
      if (state === "committed" && result.attachments?.length) {
        const attachmentAsset = await this.#writeAttachments(result.attachments);
        const { attachments: _attachments, ...textResult } = terminal.result!;
        await this.#append({ ...terminal, result: textResult, attachmentAsset });
      } else await this.#append(terminal);
    } catch {
      // The operation already ran. A failed commit record is itself an unknown
      // effect and must never be hidden behind the handler's apparent result.
      return uncertainResult(fingerprint, "The tool completed but its durable commit record could not be written");
    }
    return ledgerResult(result, fingerprint, state, false);
  }

  async #writeAttachments(attachments: readonly AgentMessageAttachment[]): Promise<{ sha256: string; bytes: number }> {
    const content = Buffer.from(JSON.stringify(attachments), "utf8");
    if (content.length > 48 * 1024 * 1024) throw new Error("Tool attachments exceed the durability limit");
    const sha256 = createHash("sha256").update(content).digest("hex");
    const directory = `${this.#journalPath}.assets`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (!(await lstat(directory)).isDirectory()) throw new Error("Invalid attachment directory");
    const destination = `${directory}/${sha256}.json`;
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, destination);
      // The JSONL commit must not outlive the directory entry on a crash.
      if (process.platform !== "win32") {
        const handle = await open(directory, "r");
        try { await handle.sync(); } finally { await handle.close(); }
      }
    } finally { await unlink(temporary).catch(() => undefined); }
    return { sha256, bytes: content.length };
  }

  async #readAttachments(asset: { readonly sha256: string; readonly bytes: number }): Promise<readonly AgentMessageAttachment[]> {
    if (!/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes < 2 || asset.bytes > 48 * 1024 * 1024) {
      throw new Error("Invalid tool attachment identity");
    }
    const path = `${this.#journalPath}.assets/${asset.sha256}.json`;
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.size !== asset.bytes) throw new Error("Tool attachment size changed");
    const content = await readFile(path);
    if (content.length !== asset.bytes || createHash("sha256").update(content).digest("hex") !== asset.sha256) throw new Error("Tool attachment digest changed");
    const attachments: unknown = JSON.parse(content.toString("utf8"));
    if (!Array.isArray(attachments) || attachments.length > 20) throw new Error("Invalid tool attachments");
    return attachments;
  }

  async #load(): Promise<void> {
    await this.#readJournal();
  }

  async #refresh(): Promise<void> {
    const release = await this.#acquireLock("journal", 10_000);
    if (!release) throw new Error("Timed out while refreshing the tool execution journal");
    try {
      await this.#readJournal();
    } finally {
      await release();
    }
  }

  async #readJournal(): Promise<void> {
    let content: string;
    try {
      content = await readFile(this.#journalPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const complete = content.endsWith("\n");
    const lines = content.split("\n");
    if (!complete) lines.pop(); // a process may have died during its final append
    for (const [index, line] of lines.entries()) {
      if (!line) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch {
        throw new Error(`Tool execution journal is corrupt at line ${index + 1}`);
      }
      if (!validJournalEntry(parsed)) throw new Error(`Tool execution journal entry ${index + 1} is invalid`);
      this.#remember(parsed);
    }
  }

  async #recoverDeadOwners(): Promise<void> {
    for (const entry of [...this.#entries.values()]) {
      if ((entry.state !== "prepared" && entry.state !== "running") || processIsAlive(entry.ownerPid)) continue;
      await this.#append({
        ...entry,
        state: entry.state === "prepared" ? "failed" : "unknown",
        ownerId: this.#ownerId,
        ownerPid: process.pid,
        reason: entry.state === "prepared" ? "recovered_before_start" : "recovered_after_start",
        at: new Date().toISOString(),
      });
    }
  }

  async #append(entry: JournalEntry): Promise<void> {
    const serialized = `${JSON.stringify(entry)}\n`;
    if (Buffer.byteLength(serialized) > this.#maxEntryBytes) {
      throw new Error("Tool execution journal entry exceeds its durability limit");
    }
    const append = this.#appendQueue.then(async () => {
      const release = await this.#acquireLock("journal", 30_000);
      if (!release) throw new Error("Timed out while writing the tool execution journal");
      try {
        // A dead writer may leave one incomplete final record. Remove only that
        // suffix before appending so it can never become corruption in the
        // middle of an otherwise valid journal.
        try {
          const existing = await readFile(this.#journalPath);
          if (existing.length && existing[existing.length - 1] !== 0x0a) {
            const lastNewline = existing.lastIndexOf(0x0a);
            await truncate(this.#journalPath, lastNewline + 1);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const handle = await open(this.#journalPath, "a", 0o600);
        try {
          await handle.writeFile(serialized, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        this.#remember(entry);
      } finally {
        await release();
      }
    });
    this.#appendQueue = append.catch(() => undefined);
    await append;
  }

  async #compactIfNeeded(): Promise<void> {
    let size = 0;
    try { size = (await stat(this.#journalPath)).size; } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (size <= this.#maxJournalBytes) return;
    const release = await this.#acquireLock("journal", 30_000);
    if (!release) throw new Error("Timed out while compacting the tool execution journal");
    try {
      await this.#readJournal();
      const compacted = [...this.#entries.values()].map(entry => `${JSON.stringify(entry)}\n`).join("");
      const temporary = `${this.#journalPath}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, compacted, { encoding: "utf8", mode: 0o600, flag: "wx" });
        const handle = await open(temporary, "r+");
        try { await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, this.#journalPath);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
    } finally {
      await release();
    }
  }

  #remember(entry: JournalEntry): void {
    this.#entries.set(entry.fingerprint, entry);
    const logical = entry.logicalFingerprint ?? entry.fingerprint;
    let related = this.#logicalEntries.get(logical);
    if (!related) this.#logicalEntries.set(logical, related = new Map());
    related.set(entry.fingerprint, entry);
  }

  async #acquireLock(name: string, waitMs: number): Promise<(() => Promise<void>) | undefined> {
    const lockPath = resolve(this.#lockRoot, `${name}.lock`);
    const deadline = Date.now() + waitMs;
    while (true) {
      try {
        const handle = await open(lockPath, "wx", 0o600);
        try {
          await handle.writeFile(JSON.stringify({ ownerId: this.#ownerId, ownerPid: process.pid }), "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        return async () => {
          try {
            const owner = JSON.parse(await readFile(lockPath, "utf8")) as { ownerId?: unknown };
            if (owner.ownerId === this.#ownerId) await unlink(lockPath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }

      let ownerPid = 0;
      let staleByAge = false;
      try {
        const owner = JSON.parse(await readFile(lockPath, "utf8")) as { ownerPid?: unknown };
        ownerPid = Number(owner.ownerPid);
        staleByAge = Date.now() - (await stat(lockPath)).mtimeMs > 60_000;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        try { staleByAge = Date.now() - (await stat(lockPath)).mtimeMs > 60_000; } catch {}
      }
      const ownerKnown = Number.isSafeInteger(ownerPid) && ownerPid > 0;
      // Never age out a valid live owner: a long-running MCP action may exceed
      // an arbitrary wall-clock threshold. Age is only a fallback for a lock
      // whose creator died before its owner record was durably written.
      if (ownerKnown ? !processIsAlive(ownerPid) : staleByAge) {
        try { await unlink(lockPath); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") await new Promise(resolveWait => setTimeout(resolveWait, 10));
        }
        continue;
      }
      if (Date.now() >= deadline) return undefined;
      await new Promise(resolveWait => setTimeout(resolveWait, 20));
    }
  }
}
