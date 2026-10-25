import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import type { AgentRunCheckpoint, AgentDurableCallBinding, AgentDurableCheckpointAck, AgentDelegateOutput } from '@nextmux/agent-runtime';

export interface DurableOperationOwner {
    readonly workspaceRoot: string;
    readonly workspaceBindingsKey?: string;
    readonly conversationId: string;
    readonly executionScopeId: string;
}
interface BlobRef { readonly name: string; readonly sha256: string; readonly bytes: number; }
export interface DurableOperationRecord {
    readonly operationId: string; readonly admissionId: string; readonly originalToolCallId: string;
    readonly logicalParentOperationId: string; readonly requestFingerprint: string; readonly executionFingerprint: string;
    readonly childRunId: string; readonly revision: number;
    readonly state: 'prepared' | 'running' | 'completed' | 'interrupted_unknown' | 'cancelled_before_start';
    readonly attemptId: string; readonly attempts: readonly { readonly id: string; readonly childRunId?: string; readonly state: string; readonly usage?: unknown; readonly usageKnown?: boolean }[];
    readonly executionBinding?: unknown; readonly resultRef?: BlobRef; readonly usage?: AgentDelegateOutput['usage']; readonly usageKnown?: boolean;
}
interface ScopeState {
    readonly schemaVersion: 1; readonly owner: DurableOperationOwner; readonly revision: number;
    readonly head?: { readonly revision: number; readonly handle: string; readonly checkpointHash: string; readonly checkpoint: AgentRunCheckpoint };
    readonly operations: readonly DurableOperationRecord[];
    readonly retryAuthorizations: readonly { readonly token: string; readonly operationId: string; readonly expectedRevision: number; readonly newFingerprint: string; readonly consumed: boolean }[];
    readonly committedHandles?: readonly string[];
    readonly credentialGenerations: Readonly<Record<string, { readonly proof: string; readonly generation: string }>>;
}
const SHA = /^[a-f0-9]{64}$/;
const id = /^(?:scope|admit|op|child|attempt|retry)-[A-Za-z0-9._:-]{8,180}$/;
const hash = (x: string | Buffer): string => createHash('sha256').update(x).digest('hex');
const stable = (v: unknown): string => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
function fail(code: string): never { throw Object.assign(new Error(code), { code }); }
function requireThat(v: unknown, code: string): asserts v { if (!v) fail(code); }
/** One local scope file is the atomic index/head CAS. Unknown operations are never evicted. No network/filesystem exactly-once promise. */
export class AgentDurableOperationStore {
    readonly #directory: string;
    readonly #fault?: (point: string) => void | Promise<void>;
    constructor(root: string, fault?: (point: string) => void | Promise<void>) { this.#directory = join(resolve(root), 'durable-operations-v3'); this.#fault = fault; }
    owner(owner: DurableOperationOwner): DurableOperationOwner {
        requireThat(owner && typeof owner.workspaceRoot === 'string' && owner.workspaceRoot.length > 0
            && typeof owner.conversationId === 'string' && owner.conversationId.length > 0 && owner.conversationId.length <= 200
            && typeof owner.executionScopeId === 'string' && id.test(owner.executionScopeId), 'DURABLE_OWNER_INVALID');
        return { workspaceRoot: resolve(owner.workspaceRoot), conversationId: owner.conversationId, executionScopeId: owner.executionScopeId,
            ...(owner.workspaceBindingsKey === undefined ? {} : { workspaceBindingsKey: owner.workspaceBindingsKey }) };
    }
    async #directorySafe(): Promise<void> {
        // Never follow a symbolic parent. mkdir only absent leaves; no chmod of user directories.
        let cursor = this.#directory; const missing: string[] = [];
        while (true) {
            try { const st = await lstat(cursor); requireThat(st.isDirectory() && !st.isSymbolicLink(), 'DURABLE_PATH_UNSAFE'); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; missing.push(cursor); }
            const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
        }
        for (const p of missing.reverse()) { try { await mkdir(p, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; } const st = await lstat(p); requireThat(st.isDirectory() && !st.isSymbolicLink(), 'DURABLE_PATH_UNSAFE'); }
        const st = await lstat(this.#directory); requireThat((process.platform === 'win32' || st.uid === process.getuid?.() && (st.mode & 0o077) === 0), 'DURABLE_DIRECTORY_OWNER');
    }
    #path(owner: DurableOperationOwner): string { return join(this.#directory, hash(stable(this.owner(owner))) + '.json'); }
    async #read<T>(path: string, limit: number): Promise<T> {
        const st = await lstat(path); requireThat(st.isFile() && !st.isSymbolicLink() && st.nlink === 1 && st.size <= limit && (process.platform === 'win32' || st.uid === process.getuid?.() && (st.mode & 0o077) === 0), 'DURABLE_FILE_UNSAFE');
        return JSON.parse(await readFile(path, 'utf8')) as T;
    }
    async #syncDirectory(): Promise<void> { if (process.platform === 'win32') return; const h = await open(this.#directory, 'r'); try { await h.sync(); } finally { await h.close(); } }
    async #write(path: string, value: unknown, immutable = false): Promise<void> {
        const text = JSON.stringify(value); requireThat(Buffer.byteLength(text) <= 64 * 1024 * 1024, 'DURABLE_STATE_TOO_LARGE');
        const tmp = immutable ? path : path + '.tmp-' + randomUUID();
        const f = await open(tmp, 'wx', 0o600);
        try { await f.writeFile(text); await f.sync(); await this.#fault?.('after_file_sync'); } finally { await f.close(); }
        if (!immutable) { await this.#fault?.('before_index_rename'); await rename(tmp, path); }
        await this.#syncDirectory(); await this.#fault?.('after_directory_sync');
        if (!immutable) await this.#fault?.('after_index_directory_sync');
    }
    async #load(owner: DurableOperationOwner): Promise<ScopeState> {
        const normalized = this.owner(owner); let state: ScopeState;
        try { state = await this.#read<ScopeState>(this.#path(normalized), 64 * 1024 * 1024); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; return { schemaVersion: 1, owner: normalized, revision: 0, operations: [], retryAuthorizations: [], credentialGenerations: {} }; }
        requireThat(state.schemaVersion === 1 && stable(state.owner) === stable(normalized) && Number.isSafeInteger(state.revision) && state.revision >= 0
            && Array.isArray(state.operations) && state.operations.length <= 10000 && new Set(state.operations.map(x => x.operationId)).size === state.operations.length, 'DURABLE_STATE_INVALID');
        if (state.head) requireThat(state.head.checkpoint.version === 3 && state.head.checkpoint.executionScopeId === normalized.executionScopeId && hash(JSON.stringify(state.head.checkpoint)) === state.head.checkpointHash && Number.isSafeInteger(state.head.revision) && state.head.revision > 0 && state.committedHandles?.includes(state.head.handle), 'DURABLE_HEAD_CORRUPT');
        for (const op of state.operations) requireThat(id.test(op.operationId) && id.test(op.childRunId) && SHA.test(op.requestFingerprint) && SHA.test(op.executionFingerprint)
            && ['prepared', 'running', 'completed', 'interrupted_unknown', 'cancelled_before_start'].includes(op.state), 'DURABLE_STATE_INVALID');
        return state;
    }
    async #mutex(mutex: string): Promise<{ assertOwned: () => Promise<void>; release: () => void }> {
        try { const f = await open(mutex, 'wx', 0o600); try { await f.sync(); } finally { await f.close(); } await this.#syncDirectory(); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
        const identity = await lstat(mutex);
        requireThat(identity.isFile() && !identity.isSymbolicLink() && identity.nlink === 1 && identity.size === 0
            && (process.platform === 'win32' || identity.uid === process.getuid?.() && (identity.mode & 0o077) === 0), 'DURABLE_MUTEX_UNSAFE');
        // BEGIN IMMEDIATE on an empty mutex creates SQLite's own rollback journal.
        // Validate its path/owner, then let SQLite recover it after process death.
        for (const suffix of ['-journal', '-wal', '-shm']) {
            try { const sidecar = await lstat(mutex + suffix);
                requireThat(suffix === '-journal' && sidecar.isFile() && !sidecar.isSymbolicLink() && sidecar.nlink === 1 && sidecar.size <= 1024 * 1024
                    && (process.platform === 'win32' || sidecar.uid === process.getuid?.() && (sidecar.mode & 0o077) === 0), 'DURABLE_MUTEX_UNSAFE'); }
            catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
        }
        const db = new DatabaseSync(mutex); let locked = false, released = false;
        try {
            db.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
            try { db.exec('BEGIN IMMEDIATE'); locked = true; }
            catch (e) { if ((e as { errcode?: number }).errcode === 5 || (e as { errcode?: number }).errcode === 6) fail('DURABLE_SCOPE_LOCKED'); throw e; }
        } catch (e) { db.close(); throw e; }
        return { assertOwned: async () => {
            requireThat(!released && locked, 'DURABLE_MUTEX_RELEASED');
            const current = await lstat(mutex);
            requireThat(current.isFile() && !current.isSymbolicLink() && current.nlink === 1
                && current.dev === identity.dev && current.ino === identity.ino, 'DURABLE_MUTEX_REPLACED');
        }, release: () => {
            if (released) return; released = true;
            try { if (locked) db.exec('ROLLBACK'); } finally { db.close(); }
        } };
    }
    async #transaction<T>(owner: DurableOperationOwner, fn: (state: ScopeState) => Promise<{ state: ScopeState; value: T }>): Promise<T> {
        await this.#directorySafe(); const path = this.#path(owner);
        // Old unowned directory locks require review. SQLite OS reservations die with the process;
        // no PID/mtime guesses, stale-file deletion, or network lock server is involved.
        try { await lstat(path + '.lock'); fail('DURABLE_LEGACY_LOCK_REQUIRES_REVIEW'); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
        const lease = await this.#mutex(path + '.mutex.sqlite');
        try {
            await this.#fault?.('after_lock_acquired');
            const state = await this.#load(owner), next = await fn(state);
            requireThat(next.state.operations.length <= 10000 && next.state.retryAuthorizations.length <= 10000, 'DURABLE_CAPACITY_REACHED');
            await lease.assertOwned();
            await this.#write(path, { ...next.state, revision: state.revision + 1 });
            return next.value;
        } finally { lease.release(); }
    }
    /** Held for the entire child execution, separately from short index transactions. */
    async acquireExecutionLease(owner: DurableOperationOwner, operationId: string): Promise<() => void> {
        requireThat(id.test(operationId), 'DURABLE_BINDING_INVALID'); await this.#directorySafe();
        const lease = await this.#mutex(this.#path(owner) + '.execution.sqlite');
        return lease.release;
    }
    async loadHead(owner: DurableOperationOwner): Promise<ScopeState['head']> { await this.#directorySafe(); return (await this.#load(owner)).head; }
    async currentCheckpointRecord(owner: DurableOperationOwner, requestedHandle: string): Promise<{ checkpoint: AgentRunCheckpoint; revision: number; handle: string }> {
        await this.#directorySafe(); const state = await this.#load(owner);
        requireThat(state.head && state.committedHandles?.includes(requestedHandle), 'DURABLE_HEAD_UNCONFIRMED');
        return { checkpoint: JSON.parse(JSON.stringify(state.head.checkpoint)), revision: state.head.revision, handle: state.head.handle };
    }
    async currentCheckpoint(owner: DurableOperationOwner, requestedHandle: string): Promise<AgentRunCheckpoint> {
        return (await this.currentCheckpointRecord(owner, requestedHandle)).checkpoint;
    }
    async getOperation(owner: DurableOperationOwner, operationId: string): Promise<DurableOperationRecord | undefined> {
        await this.#directorySafe(); return (await this.#load(owner)).operations.find(x => x.operationId === operationId);
    }
    async commitCheckpoint(owner: DurableOperationOwner, cp: AgentRunCheckpoint, handle: string, expectedHeadRevision: number): Promise<AgentDurableCheckpointAck> {
        requireThat(cp.version === 3 && cp.executionScopeId === owner.executionScopeId && /^resume-[a-f0-9-]{36}$/i.test(handle), 'DURABLE_CHECKPOINT_INVALID');
        const checkpointHash = hash(JSON.stringify(cp));
        return this.#transaction(owner, async state => {
            requireThat((state.head?.revision ?? 0) === expectedHeadRevision, 'DURABLE_HEAD_CONFLICT');
            if (state.head?.checkpoint.pendingToolBatch && !cp.pendingToolBatch) {
                const old = state.head.checkpoint.pendingToolBatch;
                requireThat(old.calls.every(c => cp.accountedOperationIds?.includes(c.operationId)) && old.calls.every(c => cp.messages.some(m => m.role === 'tool' && m.toolCallId === c.call.id)), 'DURABLE_PENDING_NOT_PAIRED');
            }
            const revision = expectedHeadRevision + 1;
            requireThat((state.committedHandles?.length ?? 0) < 20000, 'DURABLE_HEAD_CAPACITY');
            return { state: { ...state, committedHandles: [...(state.committedHandles ?? []), handle], head: { revision, handle, checkpointHash, checkpoint: JSON.parse(JSON.stringify(cp)) } }, value: { handle, scopeId: owner.executionScopeId, admissionId: cp.pendingToolBatch?.admissionId, checkpointHash, revision } };
        });
    }
    async credentialGeneration(owner: DurableOperationOwner, resourceIdentity: unknown, credential: string): Promise<string> {
        requireThat(typeof credential === 'string' && credential.length > 0, 'DURABLE_CREDENTIAL_IDENTITY_UNAVAILABLE');
        await this.#directorySafe(); const saltPath = join(this.#directory, 'credential-proof-salt.json'); let salt: string;
        try { salt = (await this.#read<{ salt: string }>(saltPath, 1024)).salt; }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; salt = randomBytes(32).toString('hex'); try { await this.#write(saltPath, { salt }, true); } catch (x) { if ((x as NodeJS.ErrnoException).code !== 'EEXIST') throw x; salt = (await this.#read<{ salt: string }>(saltPath, 1024)).salt; } }
        requireThat(SHA.test(salt), 'DURABLE_CREDENTIAL_IDENTITY_UNAVAILABLE');
        const key = hash(stable(resourceIdentity)), proof = createHmac('sha256', salt).update(credential).digest('hex');
        return this.#transaction(owner, async state => {
            const prior = state.credentialGenerations[key]; const generation = prior?.proof === proof ? prior.generation : 'generation-' + randomUUID();
            return { state: { ...state, credentialGenerations: { ...state.credentialGenerations, [key]: { proof, generation } } }, value: generation };
        });
    }
    async admit(owner: DurableOperationOwner, binding: AgentDurableCallBinding, requestFingerprint: string, executionFingerprint: string, executionBinding?: unknown): Promise<DurableOperationRecord> {
        requireThat(binding.scopeId === owner.executionScopeId && id.test(binding.operationId) && id.test(binding.admissionId) && SHA.test(requestFingerprint) && SHA.test(executionFingerprint), 'DURABLE_BINDING_INVALID');
        return this.#transaction(owner, async state => {
            const existing = state.operations.find(x => x.operationId === binding.operationId);
            if (existing) {
                requireThat(existing.admissionId === binding.admissionId && existing.originalToolCallId === binding.originalToolCallId && existing.logicalParentOperationId === binding.logicalParentOperationId
                    && existing.requestFingerprint === requestFingerprint && existing.executionFingerprint === executionFingerprint, 'DURABLE_FINGERPRINT_MISMATCH');
                requireThat(existing.state === 'completed' || existing.state === 'prepared', 'DURABLE_OPERATION_UNKNOWN');
                return { state, value: existing };
            }
            requireThat(!state.operations.some(x => x.state === 'running' || x.state === 'interrupted_unknown' || x.attempts.some(a => a.state === 'interrupted_unknown')), 'DURABLE_SCOPE_UNKNOWN');
            const op: DurableOperationRecord = { ...binding, requestFingerprint, executionFingerprint, childRunId: 'child-' + randomUUID(), revision: 1,
                state: 'prepared', executionBinding, attemptId: 'attempt-' + randomUUID(), attempts: [] };
            return { state: { ...state, operations: [...state.operations, op] }, value: op };
        });
    }
    async begin(owner: DurableOperationOwner, operationId: string, expectedRevision: number): Promise<DurableOperationRecord> {
        return this.#transaction(owner, async state => {
            const op = state.operations.find(x => x.operationId === operationId);
            requireThat(op?.revision === expectedRevision && op.state === 'prepared' && !state.operations.some(x => x.operationId !== operationId && (['running', 'interrupted_unknown'].includes(x.state) || x.attempts.some(a => a.state === 'interrupted_unknown'))), 'DURABLE_OPERATION_UNKNOWN');
            const next = { ...op, state: 'running' as const, usageKnown: false, revision: op.revision + 1 };
            return { state: { ...state, operations: state.operations.map(x => x.operationId === operationId ? next : x) }, value: next };
        });
    }
    async complete(owner: DurableOperationOwner, operationId: string, expectedRevision: number, result: AgentDelegateOutput): Promise<DurableOperationRecord> {
        requireThat(result && result.usage && [result.usage.inputTokens, result.usage.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0), 'DURABLE_RESULT_INVALID');
        const text = JSON.stringify(result); requireThat(Buffer.byteLength(text) <= 16 * 1024 * 1024, 'DURABLE_RESULT_TOO_LARGE');
        return this.#transaction(owner, async state => {
            const op = state.operations.find(x => x.operationId === operationId); requireThat(op?.state === 'running' && op.revision === expectedRevision && op.childRunId === result.runId, 'DURABLE_OPERATION_CONFLICT');
            const blob: BlobRef = { name: 'result-' + randomUUID() + '.json', sha256: hash(text), bytes: Buffer.byteLength(text) };
            await this.#write(join(this.#directory, blob.name), result, true); await this.#fault?.('after_result_blob');
            const next: DurableOperationRecord = { ...op, revision: op.revision + 1, state: result.status === 'completed' ? 'completed' : 'interrupted_unknown', resultRef: blob, usage: result.usage, usageKnown: result.usageKnown === true,
                attempts: [...op.attempts, { id: op.attemptId, childRunId: op.childRunId, state: result.status === 'completed' ? 'completed' : 'interrupted_unknown', usage: result.usage, usageKnown: result.usageKnown === true }] };
            return { state: { ...state, operations: state.operations.map(x => x.operationId === operationId ? next : x) }, value: next };
        });
    }
    async loadResult(owner: DurableOperationOwner, op: DurableOperationRecord): Promise<AgentDelegateOutput> {
        await this.#directorySafe(); const current = (await this.#load(owner)).operations.find(x => x.operationId === op.operationId);
        requireThat(current && stable(current) === stable(op) && current.state === 'completed' && current.resultRef, 'DURABLE_RESULT_UNAVAILABLE');
        const ref = current.resultRef; requireThat(/^result-[a-f0-9-]{36}\.json$/.test(ref.name) && SHA.test(ref.sha256), 'DURABLE_RESULT_INVALID');
        const value = await this.#read<AgentDelegateOutput>(join(this.#directory, ref.name), 16 * 1024 * 1024), text = JSON.stringify(value);
        requireThat(Buffer.byteLength(text) === ref.bytes && hash(text) === ref.sha256 && value.runId === op.childRunId && value.status === 'completed' && stable(value.usage) === stable(op.usage) && (value.usageKnown === true) === op.usageKnown, 'DURABLE_RESULT_CORRUPT');
        return value;
    }
    accounting(op: DurableOperationRecord): { usage: { inputTokens: number; outputTokens: number }; usageKnown: boolean } {
        const usage = { inputTokens: 0, outputTokens: 0 }; let usageKnown = true;
        requireThat(new Set(op.attempts.map(a => a.id)).size === op.attempts.length, 'DURABLE_ATTEMPT_CONFLICT');
        for (const attempt of op.attempts) {
            const raw = attempt.usage as { inputTokens?: unknown; outputTokens?: unknown } | undefined;
            for (const field of ['inputTokens', 'outputTokens'] as const) {
                const value = raw?.[field];
                if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) usage[field] += value;
                else usageKnown = false;
            }
            if (attempt.usageKnown !== true || attempt.state !== 'completed') usageKnown = false;
        }
        requireThat(Number.isSafeInteger(usage.inputTokens) && Number.isSafeInteger(usage.outputTokens), 'DURABLE_USAGE_TOO_LARGE');
        return { usage, usageKnown: usageKnown && op.state === 'completed' && op.attempts.length > 0 };
    }
    async listOperations(owner: DurableOperationOwner): Promise<readonly DurableOperationRecord[]> {
        await this.#directorySafe(); return JSON.parse(JSON.stringify((await this.#load(owner)).operations));
    }
    #retryRecord(op: DurableOperationRecord, newFingerprint: string, executionBinding = op.executionBinding): DurableOperationRecord {
        const attempts = op.attempts.some(a => a.id === op.attemptId) ? op.attempts : [...op.attempts,
            { id: op.attemptId, childRunId: op.childRunId, state: 'interrupted_unknown', usage: op.usage, usageKnown: false }];
        const { usage: _usage, usageKnown: _known, resultRef: _result, ...previous } = op;
        return { ...previous, revision: op.revision + 1, state: 'prepared', executionFingerprint: newFingerprint, executionBinding,
            childRunId: 'child-' + randomUUID(), attemptId: 'attempt-' + randomUUID(), attempts };
    }
    /** One trusted user action authorizes and consumes in the same CAS: no unconsumed capability survives a lost ACK. */
    async retryWithAuthorization(owner: DurableOperationOwner, operationId: string, expectedRevision: number,
        requestFingerprint: string, newFingerprint: string, executionBinding?: unknown): Promise<DurableOperationRecord> {
        requireThat(SHA.test(newFingerprint) && SHA.test(requestFingerprint), 'DURABLE_FINGERPRINT_MISMATCH');
        return this.#transaction(owner, async state => {
            const op = state.operations.find(x => x.operationId === operationId);
            requireThat(op?.revision === expectedRevision && ['running', 'interrupted_unknown'].includes(op.state)
                && op.requestFingerprint === requestFingerprint, 'DURABLE_RETRY_STALE');
            const token = 'retry-' + randomUUID(), next = this.#retryRecord(op, newFingerprint, executionBinding);
            return { state: { ...state, operations: state.operations.map(x => x.operationId === operationId ? next : x),
                retryAuthorizations: [...state.retryAuthorizations, { token, operationId, expectedRevision, newFingerprint, consumed: true }] }, value: next };
        });
    }
    async cancelPreparedRetry(owner: DurableOperationOwner, operationId: string, expectedRevision: number): Promise<void> {
        await this.#transaction(owner, async state => {
            const op = state.operations.find(x => x.operationId === operationId);
            requireThat(op?.state === 'prepared' && op.revision === expectedRevision, 'DURABLE_RETRY_STALE');
            const next: DurableOperationRecord = { ...op, revision: op.revision + 1, state: 'interrupted_unknown',
                attempts: [...op.attempts, { id: op.attemptId, childRunId: op.childRunId, state: 'cancelled_before_start',
                    usage: { inputTokens: 0, outputTokens: 0 }, usageKnown: true }] };
            return { state: { ...state, operations: state.operations.map(x => x.operationId === operationId ? next : x) }, value: undefined };
        });
    }
    /** Only called by an authenticated backend user-action handler; never a tool argument. */
    async authorizeRetry(owner: DurableOperationOwner, operationId: string, expectedRevision: number, newFingerprint: string): Promise<string> {
        requireThat(SHA.test(newFingerprint), 'DURABLE_FINGERPRINT_MISMATCH');
        return this.#transaction(owner, async state => { const op = state.operations.find(x => x.operationId === operationId);
            requireThat(op?.revision === expectedRevision && ['running', 'interrupted_unknown'].includes(op.state), 'DURABLE_RETRY_STALE');
            const token = 'retry-' + randomUUID(); return { state: { ...state, retryAuthorizations: [...state.retryAuthorizations, { token, operationId, expectedRevision, newFingerprint, consumed: false }] }, value: token }; });
    }
    async consumeRetry(owner: DurableOperationOwner, token: string, operationId: string, expectedRevision: number, newFingerprint: string): Promise<DurableOperationRecord> {
        return this.#transaction(owner, async state => { const auth = state.retryAuthorizations.find(x => x.token === token), op = state.operations.find(x => x.operationId === operationId);
            requireThat(auth && !auth.consumed && auth.operationId === operationId && auth.expectedRevision === expectedRevision && auth.newFingerprint === newFingerprint && op?.revision === expectedRevision && ['running', 'interrupted_unknown'].includes(op.state), 'DURABLE_RETRY_UNAUTHORIZED');
            const next = this.#retryRecord(op, newFingerprint);
            return { state: { ...state, operations: state.operations.map(x => x.operationId === operationId ? next : x), retryAuthorizations: state.retryAuthorizations.map(x => x.token === token ? { ...x, consumed: true } : x) }, value: next }; });
    }
}
