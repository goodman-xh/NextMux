import { createHash, randomUUID } from 'crypto';
import { lstatSync } from 'fs';
import { isDeepStrictEqual } from 'util';
import { chmod, lstat, mkdir, open, readFile, readdir, rename, stat, unlink } from 'fs/promises';
import { dirname, resolve } from 'path';
import type { AgentPermissionMode, AgentRunEvent, AgentSteeringMessage, ToolExecutionSummary } from '@nextmux/agent-runtime';
import { safeAgentMessageParams } from '@nextmux/agent-runtime';
import { capacityReasonMetadata } from '@nextmux/model-runtime/capacity-reasons';
import type { DesktopAgentChildContinuation, DesktopAgentRunSnapshot } from '../common/nextmux-platform-protocol';
import { readManagedPriceUpdate } from '../common/nextmux-managed-price-update';
import type { AgentRunStateOwner } from './nextmux-agent-run-state-store';

export const AGENT_RUN_JOURNAL_MAX_ENTRIES = 96;
export const AGENT_RUN_JOURNAL_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const AGENT_RUN_JOURNAL_MAX_BYTES = 64 * 1024;
const journalLockfile = require('proper-lockfile') as {
    lock(file: string, options: Record<string, unknown>): Promise<() => Promise<void>>;
};
interface JournalWriteLease { assertOwned(): void; release(): Promise<void>; }
const RUN_ID = /^[A-Za-z0-9._:-]{8,180}$/;
const CHECKPOINT_ID = /^resume-[0-9a-f-]{36}$/i;
const JOURNAL_FILE = /^agent-run-([a-f0-9]{64})-[0-9a-f-]{36}\.json$/;
/**
 * A bounded, local activity log used only for crash recovery/replay.  The
 * recovery metadata above intentionally stays small; keeping activity in a
 * separate append-only file means a long run does not rewrite its checkpoint
 * index for every tool event.
 */
const EVENT_LOG_FILE = /^agent-run-([a-f0-9]{64})-events\.ndjson$/;
const AGENT_RUN_EVENT_LOG_MAX_BYTES = 8 * 1024 * 1024;
const AGENT_RUN_EVENT_RECORD_MAX_BYTES = 96 * 1024;
const AGENT_RUN_EVENT_MAX_ENTRIES = 4_096;
const AGENT_RUN_DELTA_CHUNK_MAX_BYTES = 16 * 1024;
const AGENT_RUN_DELTA_BUFFER_MAX_BYTES = 256 * 1024;
const HIGH_FREQUENCY_EVENT_TYPES = new Set(['tool_output']);
const RECOVERY_EVENT_TYPES = new Set([
    'user_input_requested', 'user_input_resolved', 'backend_selected', 'backend_fallback',
    'model_started', 'model_phase', 'model_attempt_completed', 'model_completed', 'model_price_changed',
    'task_plan_updated', 'assistant_progress', 'assistant_delta', 'provider_reasoning', 'tool_started',
    'tool_process_started', 'tool_process_exited', 'tool_completed',
    'context_compaction_started', 'context_compaction_completed', 'model_retry_scheduled', 'model_route_switched',
    'steering_accepted', 'steering_applied'
]);

interface PendingAssistantDelta {
    turn: number;
    delta: string;
    at: string;
    bytes: number;
}

export interface AgentRunJournalRecord {
    readonly schemaVersion: 1;
    /** Durable per-run ordering; absent on legacy records, which have revision zero. */
    readonly journalRevision?: number;
    readonly runId: string;
    readonly state: 'running' | 'interrupted';
    readonly owner: AgentRunStateOwner;
    readonly workbench: 'coding' | 'comic';
    readonly permissionMode: AgentPermissionMode;
    readonly childContinuation?: DesktopAgentChildContinuation;
    readonly checkpointId?: string;
    /** The checkpoint's next turn: direction messages applied at or before it are inside the checkpoint. */
    readonly checkpointTurn?: number;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export class AgentRunJournalError extends Error {
    constructor(readonly code: string, message: string, readonly checkpointReferenceMayExist = false) {
        super(message);
        this.name = 'AgentRunJournalError';
    }
}

/**
 * Small crash-recovery index for AgentRunStateStore checkpoints.
 *
 * Every update is written to a new file and atomically renamed into place;
 * only after that commit do we remove the previous revision. The activity
 * stream is kept in a separate, bounded log and stores only the structured
 * user-visible lifecycle data needed to replay the run; raw token/process
 * output and checkpoint contents never enter the journal.
 */
export class AgentRunJournalStore {
    readonly #directory: string;
    readonly #writes = new Map<string, Promise<unknown>>();
    readonly #pendingDeltas = new Map<string, PendingAssistantDelta>();

    constructor(directory: string) {
        this.#directory = resolve(directory);
    }

    async save(record: AgentRunJournalRecord): Promise<void> {
        const input = normalizeRecord(record);
        return this.#serialize(input.runId, async () => {
            await this.#ensureSafeDirectory();
            const pendingDeltas = this.#drainPendingDeltaEvents(input.runId);
            if (pendingDeltas.length) {
                await this.#writeEvents(input.runId, pendingDeltas).catch(() => undefined);
            }
            const lease = await this.#acquireRunLock(input.runId);
            let published = false;
            let temporary: string | undefined;
            try {
                // Read every previous revision while holding the cross-process
                // lock. An unreadable/conflicting predecessor must stop before
                // publication, never reset the counter or overwrite evidence.
                const previous = latestRevision(await this.#readRevisions(input.runId));
                if (previous && (!ownerMatches(previous.owner, input.owner)
                    || (['conversationId', 'workspaceBindingsKey', 'rootRunId', 'parentRunId', 'depth'] as const)
                        .some(key => previous.owner[key] !== input.owner[key]))) {
                    throw new AgentRunJournalError('AGENT_RUN_JOURNAL_OWNER_MISMATCH', 'Recovery record belongs to another owner');
                }
                const journalRevision = (previous?.journalRevision ?? 0) + 1;
                if (!Number.isSafeInteger(journalRevision)) {
                    throw new AgentRunJournalError('AGENT_RUN_JOURNAL_CORRUPT', 'Recovery revision counter is exhausted');
                }
                const value = { ...input, journalRevision };
                const json = JSON.stringify(value);
                if (Buffer.byteLength(json, 'utf8') > AGENT_RUN_JOURNAL_MAX_BYTES) {
                    throw new AgentRunJournalError('AGENT_RUN_JOURNAL_TOO_LARGE', 'Agent run recovery metadata exceeds its size limit');
                }
                const target = resolve(this.#directory, `agent-run-${digest(value.runId)}-${randomUUID()}.json`);
                temporary = `${target}.tmp-${randomUUID()}`;
                const handle = await open(temporary, 'wx', 0o600);
                try {
                    await handle.writeFile(json, 'utf8');
                    await handle.sync();
                } finally {
                    await handle.close();
                }
                lease.assertOwned();
                await rename(temporary, target);
                published = true;
                if (process.platform !== 'win32') await chmod(target, 0o600);
                await this.#syncDirectory(this.#directory);
                await this.#syncDirectory(dirname(this.#directory));
                lease.assertOwned();
                // Cleanup failure cannot reject a committed reference. Ordering
                // is durable even when old files survive or clocks move back.
                await this.#removeOtherRevisions(value.runId, target, lease).catch(() => undefined);
                await this.prune(value.updatedAt).catch(() => undefined);
                lease.assertOwned();
            } catch (error) {
                if (temporary) try { await unlink(temporary); } catch {}
                if (error instanceof AgentRunJournalError) {
                    throw new AgentRunJournalError(error.code, error.message, published || error.checkpointReferenceMayExist);
                }
                throw new AgentRunJournalError('AGENT_RUN_JOURNAL_UNAVAILABLE', 'Unable to persist agent run recovery metadata', published);
            } finally {
                // A failed release must not turn a committed reference into an
                // orphan at its caller. A stale lease can be reclaimed later.
                await lease.release().catch(() => undefined);
            }
        });
    }

    async load(runId: string, expectedOwner?: Pick<AgentRunStateOwner, 'workspaceRoot' | 'conversationId'>): Promise<AgentRunJournalRecord> {
        assertRunId(runId);
        return this.#serialize(runId, async () => {
            await this.#ensureSafeDirectory();
            const lease = await this.#acquireRunLock(runId);
            try {
                const latest = latestRevision(await this.#readRevisions(runId));
                lease.assertOwned();
                if (!latest) throw new AgentRunJournalError('AGENT_RUN_JOURNAL_NOT_FOUND', 'Agent run recovery metadata does not exist');
                if (expectedOwner && !ownerMatches(latest.owner, expectedOwner)) {
                    throw new AgentRunJournalError('AGENT_RUN_JOURNAL_OWNER_MISMATCH', 'Agent run recovery metadata belongs to another conversation or workspace');
                }
                return latest;
            } finally { await lease.release().catch(() => undefined); }
        });
    }

    async #readRevisions(runId: string): Promise<AgentRunJournalRecord[]> {
        let candidates: readonly string[];
        try { candidates = await this.#candidatePaths(runId); }
        catch { throw new AgentRunJournalError('AGENT_RUN_JOURNAL_UNAVAILABLE', 'Unable to list agent run recovery revisions'); }
        const records: AgentRunJournalRecord[] = [];
        for (const path of candidates) {
            let metadata;
            try { metadata = await lstat(path); }
            catch { throw new AgentRunJournalError('AGENT_RUN_JOURNAL_UNAVAILABLE', 'Unable to inspect agent run recovery metadata'); }
            if (metadata.isSymbolicLink() || !metadata.isFile()) {
                throw new AgentRunJournalError('AGENT_RUN_JOURNAL_UNSAFE', 'Agent run recovery metadata is not a regular file');
            }
            if (metadata.size < 2 || metadata.size > AGENT_RUN_JOURNAL_MAX_BYTES) {
                throw new AgentRunJournalError('AGENT_RUN_JOURNAL_CORRUPT', 'Agent run recovery metadata has an invalid size');
            }
            let text: string;
            try { text = await readFile(path, 'utf8'); }
            catch { throw new AgentRunJournalError('AGENT_RUN_JOURNAL_UNAVAILABLE', 'Unable to read agent run recovery metadata'); }
            let parsed: unknown;
            try { parsed = JSON.parse(text); }
            catch { throw new AgentRunJournalError('AGENT_RUN_JOURNAL_CORRUPT', 'Agent run recovery metadata is not valid JSON'); }
            const candidate = parseRecord(parsed);
            if (!candidate || candidate.runId !== runId) {
                throw new AgentRunJournalError('AGENT_RUN_JOURNAL_CORRUPT', 'Agent run recovery metadata failed validation');
            }
            records.push(candidate);
        }
        return records;
    }

    /** Inspect bounded journal metadata first; never read another owner's event log or checkpoint. */
    async ownedRootRecords(owner: Pick<AgentRunStateOwner, 'workspaceRoot' | 'conversationId'>): Promise<readonly AgentRunJournalRecord[]> {
        if (!owner.conversationId || !owner.workspaceRoot) return [];
        await this.#ensureSafeDirectory();
        const runIds = new Set<string>();
        for (const entry of await readdir(this.#directory, { withFileTypes: true })) {
            if (!JOURNAL_FILE.test(entry.name) || !entry.isFile() || entry.isSymbolicLink()) continue;
            const file = resolve(this.#directory, entry.name);
            const metadata = await lstat(file);
            if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size < 2 || metadata.size > AGENT_RUN_JOURNAL_MAX_BYTES) continue;
            let value: unknown;
            try { value = JSON.parse(await readFile(file, 'utf8')); }
            catch { throw new AgentRunJournalError('AGENT_RUN_JOURNAL_CORRUPT', 'Agent run recovery metadata is not valid JSON'); }
            const claimed = value && typeof value === 'object' && !Array.isArray(value)
                ? (value as { owner?: Partial<AgentRunStateOwner> }).owner : undefined;
            if (claimed?.conversationId !== owner.conversationId || typeof claimed.workspaceRoot !== 'string'
                || !ownerMatches(claimed as AgentRunStateOwner, owner)) continue;
            const record = parseRecord(value);
            if (!record || !entry.name.startsWith(`agent-run-${digest(record.runId)}-`)) {
                throw new AgentRunJournalError('AGENT_RUN_JOURNAL_CORRUPT', 'Owned agent run recovery metadata failed validation');
            }
            if (record.childContinuation || record.owner.parentRunId !== undefined || record.owner.depth !== 0) continue;
            runIds.add(record.runId);
            if (runIds.size > AGENT_RUN_JOURNAL_MAX_ENTRIES) throw new AgentRunJournalError('AGENT_RUN_JOURNAL_CORRUPT', 'Too many owned recovery records');
        }
        // load() resolves revisions of the same explicit run ID. No timestamp
        // ranks distinct runs or chooses a continuation for a conversation.
        const records: AgentRunJournalRecord[] = [];
        for (const runId of runIds) records.push(await this.load(runId, owner));
        return records;
    }

    async remove(runId: string): Promise<void> {
        assertRunId(runId);
        return this.#serialize(runId, async () => {
            this.#pendingDeltas.delete(runId);
            await this.#ensureSafeDirectory();
            const lease = await this.#acquireRunLock(runId);
            try {
                for (const path of await this.#candidatePaths(runId)) {
                    const metadata = await lstat(path).catch(error => {
                        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
                        throw error;
                    });
                    if (!metadata) continue;
                    if (metadata.isSymbolicLink() || !metadata.isFile()) {
                        throw new AgentRunJournalError('AGENT_RUN_JOURNAL_UNSAFE', 'Agent run recovery metadata is not a regular file');
                    }
                    lease.assertOwned();
                    await unlink(path);
                }
                const eventPath = this.#eventPath(runId);
                const eventMetadata = await lstat(eventPath).catch(error => {
                    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
                    throw error;
                });
                if (eventMetadata) {
                    if (eventMetadata.isSymbolicLink() || !eventMetadata.isFile()) {
                        throw new AgentRunJournalError('AGENT_RUN_JOURNAL_UNSAFE', 'Agent run activity log is not a regular file');
                    }
                    lease.assertOwned();
                    await unlink(eventPath);
                }
                lease.assertOwned();
                await this.#syncDirectory(this.#directory);
            } finally { await lease.release().catch(() => undefined); }
        });
    }

    /**
     * Persist a compact, replay-safe activity event. High-frequency process
     * output stays in the live bounded buffer, while assistant_delta tokens are
     * coalesced in memory per turn and flushed at event/checkpoint boundaries.
     */
    async appendEvent(runId: string, event: AgentRunEvent): Promise<void> {
        assertRunId(runId);
        if (event && typeof event === 'object' && event.type === 'assistant_delta') {
            if (!isRecoveryEvent(event)) return;
            return this.#serialize(runId, async () => {
                const toFlush: AgentRunEvent[] = [];
                const existing = this.#pendingDeltas.get(runId);
                const incomingBytes = Buffer.byteLength(event.delta, 'utf8');
                if (existing && (existing.turn !== event.turn || existing.bytes + incomingBytes > AGENT_RUN_DELTA_BUFFER_MAX_BYTES)) {
                    toFlush.push(...this.#drainPendingDeltaEvents(runId));
                }
                if (incomingBytes >= AGENT_RUN_DELTA_BUFFER_MAX_BYTES) {
                    for (const chunk of splitUtf8DeltaChunks(event.delta, AGENT_RUN_DELTA_CHUNK_MAX_BYTES)) {
                        toFlush.push({ type: 'assistant_delta', turn: event.turn, delta: chunk, at: event.at });
                    }
                } else {
                    const current = this.#pendingDeltas.get(runId);
                    if (current) {
                        current.delta += event.delta;
                        current.bytes += incomingBytes;
                    } else {
                        this.#pendingDeltas.set(runId, {
                            turn: event.turn,
                            delta: event.delta,
                            at: event.at,
                            bytes: incomingBytes
                        });
                    }
                }
                if (toFlush.length > 0) {
                    await this.#writeEvents(runId, toFlush);
                }
            });
        }
        const compact = compactRecoveryEvent(event);
        if (!compact || compact.type === 'model_price_changed' && compact.runId !== runId) return;
        return this.#serialize(runId, async () => {
            const events = [...this.#drainPendingDeltaEvents(runId), compact];
            await this.#writeEvents(runId, events);
        });
    }

    #drainPendingDeltaEvents(runId: string): AgentRunEvent[] {
        const pending = this.#pendingDeltas.get(runId);
        if (!pending || !pending.delta) {
            this.#pendingDeltas.delete(runId);
            return [];
        }
        this.#pendingDeltas.delete(runId);
        return splitUtf8DeltaChunks(pending.delta, AGENT_RUN_DELTA_CHUNK_MAX_BYTES).map(chunk => ({
            type: 'assistant_delta' as const,
            turn: pending.turn,
            delta: chunk,
            at: pending.at
        }));
    }

    async #writeEvents(runId: string, events: readonly AgentRunEvent[]): Promise<void> {
        if (!events.length) return;
        await this.#ensureSafeDirectory();
        const incomingLines: { readonly line: string; readonly bytes: number; readonly priority: boolean }[] = [];
        for (const event of events) {
            const compact = compactRecoveryEvent(event);
            if (!compact || compact.type === 'model_price_changed' && compact.runId !== runId) continue;
            const line = `${JSON.stringify(compact)}\n`;
            const bytes = Buffer.byteLength(line, 'utf8');
            if (bytes > AGENT_RUN_EVENT_RECORD_MAX_BYTES) continue;
            const priority = compact.type === 'steering_accepted'
                || compact.type === 'steering_applied'
                || compact.type === 'user_input_requested'
                || compact.type === 'user_input_resolved'
                || compact.type === 'model_price_changed';
            incomingLines.push({ line, bytes, priority });
        }
        if (!incomingLines.length) return;
        const lease = await this.#acquireRunLock(runId);
        let temporary: string | undefined;
        try {
            const path = this.#eventPath(runId);
            const current = await lstat(path).catch(error => {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
                throw error;
            });
            if (current && (current.isSymbolicLink() || !current.isFile())) {
                throw new AgentRunJournalError('AGENT_RUN_JOURNAL_UNSAFE', 'Agent run activity log is not a regular file');
            }
            const currentSize = current?.size || 0;
            const incomingBytes = incomingLines.reduce((sum, item) => sum + item.bytes, 0);
            if (currentSize + incomingBytes <= AGENT_RUN_EVENT_LOG_MAX_BYTES) {
                const payload = incomingLines.map(item => item.line).join('');
                lease.assertOwned();
                const handle = await open(path, 'a', 0o600);
                try {
                    await handle.writeFile(payload, 'utf8');
                    await handle.sync();
                } finally {
                    await handle.close();
                }
                if (process.platform !== 'win32') await chmod(path, 0o600);
                return;
            }

            // Compact the event log when the 8 MiB ceiling is reached so steering
            // and newest recovery events are never silently dropped at the tail.
            const existingLines: { readonly line: string; readonly bytes: number; readonly priority: boolean }[] = [];
            if (current && currentSize > 0 && currentSize <= AGENT_RUN_EVENT_LOG_MAX_BYTES) {
                const rawLines = (await readFile(path, 'utf8')).split('\n');
                for (const raw of rawLines) {
                    if (!raw.trim()) continue;
                    const line = `${raw}\n`;
                    const bytes = Buffer.byteLength(line, 'utf8');
                    if (bytes > AGENT_RUN_EVENT_RECORD_MAX_BYTES) continue;
                    const priority = raw.includes('"steering_accepted"')
                        || raw.includes('"steering_applied"')
                        || raw.includes('"user_input_requested"')
                        || raw.includes('"user_input_resolved"')
                        || raw.includes('"model_price_changed"');
                    existingLines.push({ line, bytes, priority });
                }
            }
            const combined = [...existingLines, ...incomingLines];
            const targetBudget = Math.floor(AGENT_RUN_EVENT_LOG_MAX_BYTES * 0.75);
            const selected = new Set<number>();
            let compactedBytes = 0;
            for (let index = combined.length - 1; index >= 0; index -= 1) {
                if (!combined[index].priority) continue;
                if (compactedBytes + combined[index].bytes > AGENT_RUN_EVENT_LOG_MAX_BYTES) break;
                selected.add(index);
                compactedBytes += combined[index].bytes;
            }
            for (let index = combined.length - 1; index >= 0 && selected.size < AGENT_RUN_EVENT_MAX_ENTRIES; index -= 1) {
                if (selected.has(index)) continue;
                if (compactedBytes + combined[index].bytes > targetBudget) continue;
                selected.add(index);
                compactedBytes += combined[index].bytes;
            }
            const compactedPayload = combined
                .filter((_item, index) => selected.has(index))
                .map(item => item.line)
                .join('');
            temporary = `${path}.tmp-${randomUUID()}`;
            const handle = await open(temporary, 'wx', 0o600);
            try {
                await handle.writeFile(compactedPayload, 'utf8');
                await handle.sync();
            } finally {
                await handle.close();
            }
            lease.assertOwned();
            await rename(temporary, path);
            temporary = undefined;
            if (process.platform !== 'win32') await chmod(path, 0o600);
        } finally {
            if (temporary) try { await unlink(temporary); } catch {}
            await lease.release().catch(() => undefined);
        }
    }

    /** Flush any coalesced assistant deltas and wait for queued activity writes before a host/process shutdown. */
    async flushEvents(runId: string): Promise<void> {
        assertRunId(runId);
        await this.#serialize(runId, async () => {
            const pending = this.#drainPendingDeltaEvents(runId);
            if (pending.length) {
                await this.#writeEvents(runId, pending);
            }
        });
    }

    /** Read the durable activity prefix after a process restart. */
    async loadEvents(runId: string): Promise<readonly AgentRunEvent[]> {
        assertRunId(runId);
        if (this.#pendingDeltas.has(runId) || this.#writes.has(runId)) {
            await this.flushEvents(runId);
        }
        await this.#ensureSafeDirectory();
        const path = this.#eventPath(runId);
        let metadata: Awaited<ReturnType<typeof lstat>>;
        try { metadata = await lstat(path); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw new AgentRunJournalError('AGENT_RUN_JOURNAL_UNAVAILABLE', 'Unable to inspect agent run activity log');
        }
        if (metadata.isSymbolicLink() || !metadata.isFile()) {
            throw new AgentRunJournalError('AGENT_RUN_JOURNAL_UNSAFE', 'Agent run activity log is not a regular file');
        }
        if (metadata.size > AGENT_RUN_EVENT_LOG_MAX_BYTES) {
            throw new AgentRunJournalError('AGENT_RUN_JOURNAL_CORRUPT', 'Agent run activity log exceeds its size limit');
        }
        const lines = (await readFile(path, 'utf8')).split('\n');
        const events: AgentRunEvent[] = [];
        for (const line of lines) {
            if (!line.trim()) continue;
            if (Buffer.byteLength(line, 'utf8') > AGENT_RUN_EVENT_RECORD_MAX_BYTES) continue;
            try {
                const parsed = JSON.parse(line);
                const compact = compactRecoveryEvent(parsed);
                if (compact && (compact.type !== 'model_price_changed' || compact.runId === runId)) events.push(compact);
            } catch {
                // A torn final line must not hide a valid earlier activity log.
                continue;
            }
        }
        // Match the live event buffer's bound. A long-running task can have a
        // much larger durable log than the renderer can safely mount at once;
        // replay the newest activity window and keep the cursor local to this
        // recovered snapshot.
        return events.length > AGENT_RUN_EVENT_MAX_ENTRIES
            ? events.slice(-AGENT_RUN_EVENT_MAX_ENTRIES)
            : events;
    }

    /** Keep the restart index bounded without touching checkpoint contents. */
    async prune(now = Date.now()): Promise<void> {
        await this.#ensureSafeDirectory();
        const entries = await readdir(this.#directory, { withFileTypes: true });
        const groups = new Map<string, { readonly path: string; readonly mtimeMs: number }[]>();
        for (const entry of entries) {
            if (!entry.isFile()) continue;
            const match = JOURNAL_FILE.exec(entry.name) || EVENT_LOG_FILE.exec(entry.name);
            if (!match) continue;
            const path = resolve(this.#directory, entry.name);
            const metadata = await stat(path);
            const group = groups.get(match[1]) || [];
            group.push({ path, mtimeMs: metadata.mtimeMs });
            groups.set(match[1], group);
        }
        const runs = [...groups.entries()].sort((left, right) =>
            Math.max(...right[1].map(file => file.mtimeMs)) - Math.max(...left[1].map(file => file.mtimeMs)));
        await Promise.all(runs.flatMap(([, files], index) => files.flatMap(file =>
            index >= AGENT_RUN_JOURNAL_MAX_ENTRIES || now - file.mtimeMs > AGENT_RUN_JOURNAL_TTL_MS
                ? [unlink(file.path).catch(() => undefined)] : [])));
    }

    async #removeOtherRevisions(runId: string, retained: string, lease: JournalWriteLease): Promise<void> {
        for (const path of await this.#candidatePaths(runId)) {
            lease.assertOwned();
            if (path !== retained) await unlink(path).catch(() => undefined);
        }
    }

    async #candidatePaths(runId: string): Promise<readonly string[]> {
        const prefix = `agent-run-${digest(runId)}-`;
        return (await readdir(this.#directory, { withFileTypes: true }))
            .filter(entry => entry.name.startsWith(prefix) && JOURNAL_FILE.test(entry.name))
            .map(entry => resolve(this.#directory, entry.name));
    }

    #eventPath(runId: string): string {
        return resolve(this.#directory, `agent-run-${digest(runId)}-events.ndjson`);
    }

    async #serialize<T>(runId: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.#writes.get(runId) || Promise.resolve();
        const current = previous.catch(() => undefined).then(operation);
        this.#writes.set(runId, current);
        try {
            return await current;
        } finally {
            if (this.#writes.get(runId) === current) this.#writes.delete(runId);
        }
    }

    async #acquireRunLock(runId: string): Promise<JournalWriteLease> {
        const lockPath = resolve(this.#directory, `.agent-run-${digest(runId)}.lock`);
        let compromised = false;
        let release: () => Promise<void>;
        try {
            release = await journalLockfile.lock(lockPath.slice(0, -5), {
                realpath: false, lockfilePath: lockPath, stale: 60_000, update: 5_000,
                retries: { retries: 50, minTimeout: 20, maxTimeout: 100 },
                onCompromised: () => { compromised = true; }
            });
        } catch {
            throw new AgentRunJournalError('AGENT_RUN_JOURNAL_UNAVAILABLE', 'Unable to acquire recovery revision lock');
        }
        let identity: { dev: number; ino: number };
        try {
            const info = lstatSync(lockPath);
            if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('unsafe');
            identity = { dev: info.dev, ino: info.ino };
        } catch {
            await release().catch(() => undefined);
            throw new AgentRunJournalError('AGENT_RUN_JOURNAL_UNAVAILABLE', 'Recovery revision lock was lost');
        }
        const owned = (): boolean => {
            if (compromised) return false;
            try {
                const info = lstatSync(lockPath);
                return info.isDirectory() && !info.isSymbolicLink() && info.dev === identity.dev && info.ino === identity.ino;
            } catch { return false; }
        };
        return {
            assertOwned: () => {
                if (!owned()) throw new AgentRunJournalError('AGENT_RUN_JOURNAL_UNAVAILABLE', 'Recovery revision lock was lost');
            },
            release: async () => { if (owned()) await release(); }
        };
    }

    async #ensureSafeDirectory(): Promise<void> {
        await mkdir(this.#directory, { recursive: true, mode: 0o700 });
        const metadata = await lstat(this.#directory);
        if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
            throw new AgentRunJournalError('AGENT_RUN_JOURNAL_UNSAFE', 'Agent run recovery directory is unsafe');
        }
        if (process.platform !== 'win32') await chmod(this.#directory, 0o700);
    }

    async #syncDirectory(path: string): Promise<void> {
        // Node has no portable Windows directory flush. File data is flushed
        // on every platform; this does not promise survival of power loss.
        if (process.platform === 'win32') return;
        const handle = await open(path, 'r');
        try {
            await handle.sync();
        } finally {
            await handle.close();
        }
    }
}

/** A persisted running record has no live owner after a service restart. */
export function interruptedAgentRunSnapshot(record: AgentRunJournalRecord, events: readonly AgentRunEvent[] = []): DesktopAgentRunSnapshot {
    return {
        runId: record.runId,
        ...(record.childContinuation ? { childRunId: record.childContinuation.childRunId } : {}),
        status: 'interrupted',
        events,
        firstEventIndex: 0,
        nextEventIndex: events.length,
        startedAt: record.createdAt,
        updatedAt: record.updatedAt,
        pendingMessages: unreadSteeringMessages(record, events),
        children: [],
        error: {
            code: 'AGENT_RUN_INTERRUPTED',
            message: '应用关闭前任务尚未完成。请检查已有变更后手动继续；不会自动重放未知副作用。',
            kind: 'waiting_user',
            retryable: false,
            retrySafe: false,
            resumable: Boolean(record.checkpointId),
            ...(record.checkpointId ? { resumeCheckpointId: record.checkpointId } : {})
        }
    };
}

/**
 * Direction messages the user sent while the run was going that the interrupted run never durably read: accepted but
 * not applied, or applied after the last recovery checkpoint (so continuing from that checkpoint would not see them).
 * They go back to the conversation's queue instead of being dropped (audit A06-01).
 */
function unreadSteeringMessages(record: AgentRunJournalRecord, events: readonly AgentRunEvent[]): AgentSteeringMessage[] {
    const accepted = new Map<string, AgentSteeringMessage>();
    const durable = new Set<string>();
    for (const event of events) {
        if (event.type === 'steering_accepted') accepted.set(event.message.id, event.message);
        else if (event.type === 'steering_applied' && record.checkpointId
            && (record.checkpointTurn === undefined || event.turn <= record.checkpointTurn)) durable.add(event.message.id);
    }
    return [...accepted.values()].filter(message => !durable.has(message.id));
}

/** Keep only the durable, user-visible part of an activity event. */
function compactRecoveryEvent(event: AgentRunEvent): AgentRunEvent | undefined {
    if (!isRecoveryEvent(event) || HIGH_FREQUENCY_EVENT_TYPES.has(event.type)) return undefined;
    // Streaming reasoning is transient; the completed marker is enough for a
    // recovered timeline and avoids persisting model reasoning text.
    if (event.type === 'provider_reasoning' && event.status === 'streaming') return undefined;
    let candidate: AgentRunEvent = event;
    if (event.type === 'model_phase') {
        const { capacityReasons: _reasons, ...base } = event;
        candidate = { ...base, ...(event.phase === 'waiting_capacity' ? capacityReasonMetadata(event.capacityReasons) : {}) };
    } else if (event.type === 'model_price_changed') {
        candidate = { type: event.type, runId: event.runId, ...(event.sessionId ? { sessionId: event.sessionId } : {}),
            pricingUpdate: readManagedPriceUpdate(event.pricingUpdate)!, at: event.at };
    } else if (event.type === 'assistant_progress') {
        candidate = { ...event, content: event.content.slice(0, 8_000) };
    } else if (event.type === 'assistant_delta') {
        candidate = { type: 'assistant_delta', turn: event.turn, delta: event.delta, at: event.at };
    } else if (event.type === 'provider_reasoning') {
        candidate = { ...event, content: event.content.slice(0, 8_000) };
    } else if (event.type === 'tool_started' && event.summary) {
        candidate = { ...event, summary: compactSummary(event.summary) };
    } else if (event.type === 'tool_completed') {
        candidate = { ...event, summary: compactSummary(event.summary), failure: event.failure
            ? { code: event.failure.code, message: event.failure.message.slice(0, 4_000),
                ...(safeAgentMessageParams(event.failure.params) ? { params: safeAgentMessageParams(event.failure.params) } : {}) }
            : undefined };
    }
    try {
        return Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= AGENT_RUN_EVENT_RECORD_MAX_BYTES ? candidate : undefined;
    } catch {
        return undefined;
    }
}

function compactSummary(summary: Partial<ToolExecutionSummary>): ToolExecutionSummary {
    const candidate = summary.resource;
    const path = candidate?.kind === 'file' && typeof candidate.path === 'string' ? candidate.path : undefined;
    const resource = candidate?.kind === 'file' && path && path.length <= 4096 && !/[\0\r\n]/.test(path)
        && ['read', 'created', 'updated'].includes(candidate.action)
        && (!/^[a-z][a-z0-9+.-]*:/i.test(path) || /^[a-z]:[\\/]/i.test(path) || /^file:\/\//i.test(path))
        ? { kind: 'file' as const, path, action: candidate.action,
            ...(Number.isSafeInteger(candidate.startLine) && candidate.startLine! > 0 ? { startLine: candidate.startLine } : {}),
            ...(Number.isSafeInteger(candidate.endLine) && candidate.endLine! >= (candidate.startLine || 1) ? { endLine: candidate.endLine } : {}) }
        : undefined;
    // Browser targets and the row's human object (clicked element, key, option)
    // are part of the recovered transcript; they are bounded display text.
    const browserResource = candidate?.kind === 'browser' ? recoverableBrowserResource(candidate) : undefined;
    const target = typeof summary.target === 'string' ? summary.target.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    return {
        title: String(summary.title || '').slice(0, 2_000),
        ...(typeof summary.kind === 'string' && /^[a-z][a-z0-9_.]{0,199}$/.test(summary.kind) ? { kind: summary.kind } : {}),
        ...(safeAgentMessageParams(summary.params) ? { params: safeAgentMessageParams(summary.params) } : {}),
        details: (summary.details || []).slice(0, 32).map(detail => String(detail).slice(0, 2_000)),
        ...(target ? { target } : {}),
        ...(resource || browserResource ? { resource: resource || browserResource } : {})
    };
}

function recoverableBrowserResource(candidate: { readonly url?: unknown; readonly title?: unknown }): ToolExecutionSummary['resource'] {
    if (typeof candidate.url !== 'string' || candidate.url.length > 2_048) return undefined;
    try {
        const url = new URL(candidate.url);
        if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return undefined;
    } catch {
        return undefined;
    }
    const title = typeof candidate.title === 'string' ? candidate.title.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    return { kind: 'browser', url: candidate.url, ...(title ? { title } : {}) };
}

/** Activity logs are observability only; malformed lines are ignored. */
function isRecoveryEvent(value: unknown): value is AgentRunEvent {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type : '';
    if (!RECOVERY_EVENT_TYPES.has(type) || typeof record.at !== 'string' || !record.at.trim()) return false;
    const stringField = (key: string): boolean => typeof record[key] === 'string' && Boolean(String(record[key]).trim());
    const summary = (candidate: unknown, required: boolean): boolean => {
        if (candidate === undefined && !required) return true;
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
        const item = candidate as Record<string, unknown>;
        return (item.title === undefined || typeof item.title === 'string')
            && (item.details === undefined || Array.isArray(item.details) && item.details.every(detail => typeof detail === 'string'));
    };
    switch (type) {
        case 'model_price_changed':
            return stringField('runId') && RUN_ID.test(String(record.runId))
                && (record.sessionId === undefined || stringField('sessionId') && String(record.sessionId).length <= 200)
                && Boolean(readManagedPriceUpdate(record.pricingUpdate));
        case 'assistant_progress':
        case 'provider_reasoning':
            return typeof record.content === 'string'
                && (type !== 'provider_reasoning' || record.visibility === 'visible')
                && (type !== 'provider_reasoning' || record.status === 'streaming' || record.status === 'complete');
        case 'assistant_delta':
            return typeof record.turn === 'number' && Number.isSafeInteger(record.turn) && record.turn >= 1
                && typeof record.delta === 'string' && record.delta.length > 0;
        case 'tool_started':
            return stringField('callId') && stringField('toolName') && stringField('source') && summary(record.summary, false);
        case 'tool_completed':
            return stringField('callId') && stringField('toolName') && typeof record.ok === 'boolean' && summary(record.summary, true);
        case 'tool_process_started':
            return stringField('callId') && stringField('toolName') && stringField('source') && stringField('processId') && typeof record.commandLine === 'string';
        case 'tool_process_exited':
            return stringField('callId') && stringField('toolName') && stringField('source') && stringField('processId');
        case 'task_plan_updated':
            return Array.isArray(record.steps) && record.steps.every(step => {
                if (!step || typeof step !== 'object' || Array.isArray(step)) return false;
                const item = step as Record<string, unknown>;
                return stringFieldFrom(item, 'id') && stringFieldFrom(item, 'title')
                    && ['pending', 'in_progress', 'completed'].includes(String(item.status));
            });
        case 'steering_accepted':
        case 'steering_applied':
            return record.message !== undefined && typeof record.message === 'object' && !Array.isArray(record.message);
        case 'user_input_requested':
            return record.question !== undefined && typeof record.question === 'object' && !Array.isArray(record.question);
        case 'user_input_resolved':
            return stringField('questionId') && stringField('runId') && stringField('taskId') && stringField('status');
        case 'backend_selected':
        case 'backend_fallback':
        case 'model_started':
        case 'model_phase':
        case 'model_attempt_completed':
        case 'model_completed':
        case 'context_compaction_started':
        case 'context_compaction_completed':
        case 'model_retry_scheduled':
            return true;
        case 'model_route_switched':
            return typeof record.route === 'string';
        default:
            return false;
    }
}

function stringFieldFrom(record: Record<string, unknown>, key: string): boolean {
    return typeof record[key] === 'string' && Boolean(String(record[key]).trim());
}

function utf8SequenceBytes(codePoint: number): number {
    if (codePoint <= 0x7f) return 1;
    if (codePoint <= 0x7ff) return 2;
    if (codePoint <= 0xffff) return 3;
    return 4;
}

function splitUtf8DeltaChunks(text: string, maxBytes = AGENT_RUN_DELTA_CHUNK_MAX_BYTES): string[] {
    if (!text) return [];
    if (Buffer.byteLength(text, 'utf8') <= maxBytes) return [text];
    const chunks: string[] = [];
    let chunkStart = 0;
    let currentBytes = 0;
    for (let index = 0; index < text.length;) {
        const first = text.charCodeAt(index);
        let codePoint = first;
        let units = 1;
        if (first >= 0xd800 && first <= 0xdbff && index + 1 < text.length) {
            const second = text.charCodeAt(index + 1);
            if (second >= 0xdc00 && second <= 0xdfff) {
                codePoint = ((first - 0xd800) << 10) + (second - 0xdc00) + 0x10000;
                units = 2;
            }
        }
        const symbolBytes = utf8SequenceBytes(codePoint);
        if (index > chunkStart && currentBytes + symbolBytes > maxBytes) {
            chunks.push(text.slice(chunkStart, index));
            chunkStart = index;
            currentBytes = symbolBytes;
        } else {
            currentBytes += symbolBytes;
        }
        index += units;
    }
    if (chunkStart < text.length) {
        chunks.push(text.slice(chunkStart));
    }
    return chunks;
}

function digest(runId: string): string {
    assertRunId(runId);
    return createHash('sha256').update(runId, 'utf8').digest('hex');
}

function assertRunId(runId: string): void {
    if (!RUN_ID.test(runId)) throw new AgentRunJournalError('INVALID_RUN_ID', 'Agent run identifier is invalid');
}

/** Revision zero supports legacy single records; conflicting ties never use wall time or filename order. */
function latestRevision(records: readonly AgentRunJournalRecord[]): AgentRunJournalRecord | undefined {
    let latest: AgentRunJournalRecord | undefined;
    let conflict = false;
    for (const record of records) {
        const revision = record.journalRevision ?? 0;
        const highest = latest?.journalRevision ?? 0;
        if (!latest || revision > highest) { latest = record; conflict = false; }
        else if (revision === highest && !isDeepStrictEqual({ ...record, journalRevision: revision }, { ...latest, journalRevision: highest })) conflict = true;
    }
    if (conflict) throw new AgentRunJournalError('AGENT_RUN_JOURNAL_CONFLICT', 'Recovery revisions conflict; automatic replay is unsafe');
    return latest;
}

function normalizeRecord(record: AgentRunJournalRecord): AgentRunJournalRecord {
    const parsed = parseRecord(record);
    if (!parsed) throw new AgentRunJournalError('AGENT_RUN_JOURNAL_CORRUPT', 'Agent run recovery metadata is invalid');
    return parsed;
}

function parseRecord(value: unknown): AgentRunJournalRecord | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Partial<AgentRunJournalRecord>;
    if (record.schemaVersion !== 1 || typeof record.runId !== 'string' || !RUN_ID.test(record.runId)
        || (record.state !== 'running' && record.state !== 'interrupted')
        || (record.workbench !== 'coding' && record.workbench !== 'comic')
        || !['read_only', 'workspace_write', 'full_access'].includes(String(record.permissionMode))
        || !validOwner(record.owner)
        || !Number.isSafeInteger(record.createdAt) || (record.createdAt as number) < 0
        || !Number.isSafeInteger(record.updatedAt) || (record.updatedAt as number) < (record.createdAt as number)
        || (record.journalRevision !== undefined && (!Number.isSafeInteger(record.journalRevision) || record.journalRevision < 0))
        || (record.checkpointId !== undefined && (typeof record.checkpointId !== 'string' || !CHECKPOINT_ID.test(record.checkpointId)))
        || (record.checkpointTurn !== undefined && (!Number.isSafeInteger(record.checkpointTurn) || record.checkpointTurn < 0))
        || (record.childContinuation !== undefined && !validChildContinuation(record.childContinuation))) return undefined;
    if (record.childContinuation) {
        if (record.owner.parentRunId !== record.childContinuation.parentRunId
            || record.owner.rootRunId !== record.childContinuation.rootRunId
            || record.owner.depth !== record.childContinuation.depth) return undefined;
    } else if (record.owner.parentRunId !== undefined || record.owner.rootRunId !== record.runId || record.owner.depth !== 0) {
        return undefined;
    }
    return {
        schemaVersion: 1,
        ...(record.journalRevision !== undefined ? { journalRevision: record.journalRevision } : {}),
        runId: record.runId,
        state: record.state,
        owner: normalizedOwner(record.owner),
        workbench: record.workbench,
        permissionMode: record.permissionMode as AgentPermissionMode,
        ...(record.childContinuation ? { childContinuation: { ...record.childContinuation } } : {}),
        ...(record.checkpointId ? { checkpointId: record.checkpointId } : {}),
        ...(record.checkpointId && record.checkpointTurn !== undefined ? { checkpointTurn: record.checkpointTurn } : {}),
        createdAt: record.createdAt as number,
        updatedAt: record.updatedAt as number
    };
}

function validOwner(value: unknown): value is AgentRunStateOwner {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const owner = value as Partial<AgentRunStateOwner>;
    if (owner.workspaceBindingsKey !== undefined && !/^[a-f0-9]{64}$/.test(owner.workspaceBindingsKey)) return false;
    if (typeof owner.workspaceRoot !== 'string' || !owner.workspaceRoot.trim()
        || owner.workspaceRoot.length > 32_768 || /[\0\r\n]/.test(owner.workspaceRoot)) return false;
    for (const field of ['conversationId', 'parentRunId', 'rootRunId'] as const) {
        if (owner[field] !== undefined && (typeof owner[field] !== 'string' || !owner[field]
            || owner[field]!.length > 500 || /[\0\r\n]/.test(owner[field]!))) return false;
    }
    return owner.depth === undefined || Number.isSafeInteger(owner.depth) && owner.depth >= 0 && owner.depth <= 16;
}

function normalizedOwner(owner: AgentRunStateOwner): AgentRunStateOwner {
    return { ...owner, workspaceRoot: resolve(owner.workspaceRoot) };
}

function validChildContinuation(value: unknown): value is DesktopAgentChildContinuation {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const child = value as Partial<DesktopAgentChildContinuation>;
    return typeof child.childRunId === 'string' && RUN_ID.test(child.childRunId)
        && typeof child.parentRunId === 'string' && RUN_ID.test(child.parentRunId)
        && typeof child.rootRunId === 'string' && RUN_ID.test(child.rootRunId)
        && Number.isSafeInteger(child.depth) && child.depth! >= 1 && child.depth! <= 4
        && typeof child.resumeCheckpointId === 'string' && CHECKPOINT_ID.test(child.resumeCheckpointId);
}

function ownerMatches(owner: AgentRunStateOwner, expected: Pick<AgentRunStateOwner, 'workspaceRoot' | 'conversationId'>): boolean {
    const normalizePath = (path: string): string => process.platform === 'win32'
        ? resolve(path).replace(/[\\/]+/g, '\\').toLocaleLowerCase() : resolve(path);
    return normalizePath(owner.workspaceRoot) === normalizePath(expected.workspaceRoot)
        && (expected.conversationId === undefined || owner.conversationId === expected.conversationId);
}
