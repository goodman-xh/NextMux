import { createHash, randomUUID } from 'crypto';
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rmdir, unlink } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import {
    AGENT_DELEGATION_LEDGER_MAX_CHILDREN,
    AGENT_DELEGATION_LEDGER_MAX_BYTES,
    normalizeAgentDelegationLedger
} from '@nextmux/agent-runtime';
import type { AgentDelegationLedger, AgentDelegationLedgerChild, AgentDelegationUsage, AgentRunCheckpoint } from '@nextmux/agent-runtime';
import { moveWindowsDelegationLock } from './nextmux-agent-delegation-lock-windows';
import type { DelegationLockPublicationError } from './nextmux-agent-delegation-lock-windows';

export const AGENT_RUN_STATE_MAX_BYTES = 8 * 1024 * 1024;
const RUN_STATE_ID = /^resume-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DELEGATION_ROOT_ID = /^[A-Za-z0-9._:-]{8,180}$/;
const AGENT_RUN_STATE_SCHEMA_VERSION = 2 as const;

/** Stable local ownership metadata; checkpoint contents remain backend-only. */
export interface AgentRunStateOwner {
    readonly workspaceRoot: string;
    readonly workspaceBindingsKey?: string;
    readonly conversationId?: string;
    readonly parentRunId?: string;
    readonly rootRunId?: string;
    readonly depth?: number;
}

export interface AgentRunStateLoadOptions {
    /**
     * Only ownership fields are compared; continuation runs intentionally get
     * a new run id. Root continuations cannot consume a child-owned handle.
     */
    readonly expectedOwner?: {
        readonly workspaceRoot: string;
        readonly workspaceBindingsKey?: string;
        readonly conversationId?: string;
        readonly scope?: 'root' | 'child';
        readonly parentRunId?: string;
        readonly rootRunId?: string;
        readonly depth?: number;
    };
}

export interface AgentRunStateRecord {
    readonly schemaVersion: 1 | 2;
    readonly id: string;
    readonly createdAt: string;
    readonly owner?: AgentRunStateOwner;
    readonly checkpoint: AgentRunCheckpoint;
}

/**
 * Backend-only diagnostic projection for a delegation tree.  Unlike a run
 * checkpoint it contains no model messages or raw tool output.
 */
export interface AgentDelegationLedgerRecord {
    readonly schemaVersion: 1;
    readonly rootRunId: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly owner: AgentRunStateOwner;
    readonly ledger: AgentDelegationLedger;
}

/** Required child boundary update, compared under the existing root file lock. */
export interface AgentDelegationCheckpointCommit {
    readonly childRunId: string;
    readonly resumeCheckpointId: string;
    readonly expectedPreviousCheckpointId?: string;
    readonly expectedCheckpointRevision: number;
}

interface StoredAgentRunState {
    readonly schemaVersion: 1;
    readonly id: string;
    readonly createdAt: string;
    readonly checkpoint: AgentRunCheckpoint;
}

interface StoredAgentRunStateV2 {
    readonly schemaVersion: typeof AGENT_RUN_STATE_SCHEMA_VERSION;
    readonly id: string;
    readonly createdAt: string;
    readonly owner: AgentRunStateOwner;
    readonly checkpoint: AgentRunCheckpoint;
}

interface StoredAgentDelegationLedger {
    readonly schemaVersion: 1;
    readonly rootRunId: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly owner: AgentRunStateOwner;
    readonly ledger: AgentDelegationLedger;
}

export class AgentRunStateStoreError extends Error {
    constructor(readonly code: string, message: string) {
        super(message);
        this.name = 'AgentRunStateStoreError';
    }
}

function encodedBytes(value: unknown): { readonly json: string; readonly bytes: number } {
    let json: string;
    try {
        json = JSON.stringify(value);
    } catch {
        throw new AgentRunStateStoreError('RUN_STATE_CORRUPT', 'Agent run state cannot be serialized');
    }
    return { json, bytes: Buffer.byteLength(json, 'utf8') };
}

async function writeSyncedTemporary(path: string, json: string): Promise<void> {
    const handle = await open(path, 'wx', 0o600);
    try {
        await handle.writeFile(json, 'utf8');
        await handle.sync();
    } finally {
        await handle.close();
    }
}

async function syncStateDirectory(path: string): Promise<void> {
    // Node does not expose portable directory flushing on Windows. File data
    // is flushed there too; this is not a cross-platform power-loss guarantee.
    if (process.platform === 'win32') return;
    const handle = await open(path, 'r');
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
}

const DELEGATION_LOCK_WAIT_MS = 30_000;
const DELEGATION_LOCK_OWNER = /^owner-([0-9a-f-]{36})\.json$/i;

function processIsAlive(pid: number): boolean {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // EPERM means the process exists but this host cannot probe it.
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}

function parsedTimestamp(value: string | undefined, fallback: number): number {
    const parsed = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
}

function mergeDelegationUsage(
    current: AgentDelegationUsage | undefined,
    incoming: AgentDelegationUsage | undefined,
): AgentDelegationUsage | undefined {
    if (!current) return incoming;
    if (!incoming) return current;
    return {
        inputTokens: Math.max(current.inputTokens, incoming.inputTokens),
        outputTokens: Math.max(current.outputTokens, incoming.outputTokens),
        usageKnown: current.usageKnown && incoming.usageKnown,
    };
}

function mergeDelegationChild(
    current: AgentDelegationLedgerChild,
    incoming: AgentDelegationLedgerChild,
): AgentDelegationLedgerChild {
    const currentUpdated = parsedTimestamp(current.updatedAt, 0);
    const incomingUpdated = parsedTimestamp(incoming.updatedAt, currentUpdated);
    const incomingIsNewer = incomingUpdated >= currentUpdated;
    const older = incomingIsNewer ? current : incoming;
    const newer = incomingIsNewer ? incoming : current;
    const currentTerminal = current.status !== 'running';
    const incomingTerminal = incoming.status !== 'running';
    const usage = mergeDelegationUsage(current.usage, incoming.usage);
    const currentRevision = current.checkpointRevision ?? 0;
    const incomingRevision = incoming.checkpointRevision ?? 0;
    if (currentRevision === incomingRevision && current.resumeCheckpointId && incoming.resumeCheckpointId
        && current.resumeCheckpointId !== incoming.resumeCheckpointId) {
        throw new AgentRunStateStoreError('CHILD_CHECKPOINT_CONFLICT', 'Equal checkpoint revisions reference different child states');
    }
    // Wall clocks govern diagnostics only. A stale observation cannot replace
    // an acknowledged checkpoint, even after clock rollback or from another host.
    const boundary = incomingRevision > currentRevision ? incoming : currentRevision > incomingRevision ? current
        : newer.resumeCheckpointId ? newer : older;
    const boundaryOutcome = incomingRevision > currentRevision ? incoming : currentRevision > incomingRevision ? current : newer;
    // Confirmed boundary order also governs its outcome. Neither a future wall
    // clock nor a stale running observation may hide a known terminal result.
    const outcome = currentTerminal && !incomingTerminal ? current : incomingTerminal && !currentTerminal ? incoming : boundaryOutcome;
    const matchingOutcome = current.status === incoming.status && currentRevision === incomingRevision
        ? outcome === current ? incoming : current : undefined;
    const recoveryStatus = currentRevision === incomingRevision && current.resumeCheckpointId === incoming.resumeCheckpointId
        ? current.recoveryStatus === 'unknown' || incoming.recoveryStatus === 'unknown' ? 'unknown'
            : current.recoveryStatus === 'unavailable' || incoming.recoveryStatus === 'unavailable' ? 'unavailable'
                : boundary.recoveryStatus
        : boundary.recoveryStatus;
    return {
        ...older,
        ...newer,
        // A stale running snapshot must never regress a durable terminal
        // outcome, even when two hosts' clocks are not perfectly aligned.
        status: outcome.status,
        stopReason: outcome.stopReason ?? matchingOutcome?.stopReason,
        receipt: outcome.receipt ?? matchingOutcome?.receipt,
        error: outcome.error ?? matchingOutcome?.error,
        startedAt: parsedTimestamp(current.startedAt, 0) <= parsedTimestamp(incoming.startedAt, 0)
            ? current.startedAt : incoming.startedAt,
        updatedAt: newer.updatedAt,
        eventCount: Math.max(current.eventCount, incoming.eventCount),
        resumeCheckpointId: boundary.resumeCheckpointId,
        checkpointRevision: boundary.checkpointRevision,
        recoveryStatus,
        checkpointError: recoveryStatus === 'durable' ? undefined : boundary.checkpointError || incoming.checkpointError || current.checkpointError,
        ...(usage ? { usage } : {}),
        finishedAt: outcome.finishedAt ?? matchingOutcome?.finishedAt,
    };
}

/** Merge snapshots written by concurrent hosts without importing transcripts. */
function mergeDelegationLedgers(
    current: AgentDelegationLedger,
    incoming: AgentDelegationLedger,
): AgentDelegationLedger {
    const byId = new Map<string, AgentDelegationLedgerChild>();
    for (const child of current.children) byId.set(child.childRunId, child);
    for (const child of incoming.children) {
        const previous = byId.get(child.childRunId);
        byId.set(child.childRunId, previous ? mergeDelegationChild(previous, child) : child);
    }
    const children = [...byId.values()]
        .sort((left, right) => {
            const leftRunning = left.status === 'running' ? 0 : 1;
            const rightRunning = right.status === 'running' ? 0 : 1;
            if (leftRunning !== rightRunning) return leftRunning - rightRunning;
            return parsedTimestamp(right.updatedAt, 0) - parsedTimestamp(left.updatedAt, 0);
        })
        .slice(0, AGENT_DELEGATION_LEDGER_MAX_CHILDREN)
        .sort((left, right) => parsedTimestamp(left.startedAt, 0) - parsedTimestamp(right.startedAt, 0));
    const normalized = normalizeAgentDelegationLedger({
        schemaVersion: 1,
        rootRunId: incoming.rootRunId,
        createdAt: parsedTimestamp(current.createdAt, 0) <= parsedTimestamp(incoming.createdAt, 0)
            ? current.createdAt : incoming.createdAt,
        updatedAt: parsedTimestamp(current.updatedAt, 0) >= parsedTimestamp(incoming.updatedAt, 0)
            ? current.updatedAt : incoming.updatedAt,
        children,
        ...(mergeDelegationUsage(current.usage, incoming.usage)
            ? { usage: mergeDelegationUsage(current.usage, incoming.usage) } : {}),
    });
    return normalized || incoming;
}

/** Local-only, atomic persistence for resumable model context. */
export class AgentRunStateStore {
    readonly #root: string;
    readonly #directory: string;

    constructor(root: string) {
        this.#root = resolve(root);
        this.#directory = join(this.#root, 'run-state');
    }

    async save(checkpoint: AgentRunCheckpoint, owner?: AgentRunStateOwner): Promise<string> {
        const id = `resume-${randomUUID()}`;
        const value: StoredAgentRunState | StoredAgentRunStateV2 = owner ? {
            schemaVersion: AGENT_RUN_STATE_SCHEMA_VERSION,
            id,
            createdAt: new Date().toISOString(),
            owner: normalizeOwner(owner),
            checkpoint
        } : {
            schemaVersion: 1,
            id,
            createdAt: new Date().toISOString(),
            checkpoint
        };
        const serialized = encodedBytes(value);
        if (serialized.bytes > AGENT_RUN_STATE_MAX_BYTES) {
            throw new AgentRunStateStoreError('RUN_STATE_TOO_LARGE', 'Agent run state exceeds the local size limit');
        }
        await this.#ensureSafeDirectory();
        const target = this.#path(id);
        const temporary = `${target}.tmp-${randomUUID()}`;
        try {
            await writeSyncedTemporary(temporary, serialized.json);
            await rename(temporary, target);
            if (process.platform !== 'win32') await chmod(target, 0o600);
            await syncStateDirectory(this.#directory);
            await syncStateDirectory(this.#root);
        } catch (error) {
            try { await unlink(temporary); } catch {}
            if (error instanceof AgentRunStateStoreError) throw error;
            throw new AgentRunStateStoreError('RUN_STATE_UNAVAILABLE', 'Unable to persist the agent run state');
        }
        return id;
    }

    async load(id: string, options: AgentRunStateLoadOptions = {}): Promise<AgentRunCheckpoint> {
        const record = await this.loadRecord(id, options);
        return record.checkpoint;
    }

    /** Read the bounded wrapper when the host needs diagnostics in addition to the checkpoint. */
    async loadRecord(id: string, options: AgentRunStateLoadOptions = {}): Promise<AgentRunStateRecord> {
        const target = this.#path(id);
        await this.#ensureSafeDirectory();
        let metadata;
        try {
            metadata = await lstat(target);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                throw new AgentRunStateStoreError('RUN_STATE_NOT_FOUND', 'The resumable agent state no longer exists');
            }
            throw new AgentRunStateStoreError('RUN_STATE_UNAVAILABLE', 'Unable to inspect the resumable agent state');
        }
        if (metadata.isSymbolicLink() || !metadata.isFile()) {
            throw new AgentRunStateStoreError('RUN_STATE_UNSAFE', 'The resumable agent state is not a regular file');
        }
        if (metadata.size < 2 || metadata.size > AGENT_RUN_STATE_MAX_BYTES) {
            throw new AgentRunStateStoreError(metadata.size > AGENT_RUN_STATE_MAX_BYTES ? 'RUN_STATE_TOO_LARGE' : 'RUN_STATE_CORRUPT', 'The resumable agent state has an invalid size');
        }
        let raw: string;
        try {
            raw = await readFile(target, 'utf8');
        } catch {
            throw new AgentRunStateStoreError('RUN_STATE_UNAVAILABLE', 'Unable to read the resumable agent state');
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw new AgentRunStateStoreError('RUN_STATE_CORRUPT', 'The resumable agent state is not valid JSON');
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new AgentRunStateStoreError('RUN_STATE_CORRUPT', 'The resumable agent state has an invalid shape');
        }
        const value = parsed as Partial<StoredAgentRunState> & Partial<StoredAgentRunStateV2>;
        if (value.id !== id || typeof value.createdAt !== 'string'
            || !value.checkpoint || typeof value.checkpoint !== 'object' || Array.isArray(value.checkpoint)) {
            throw new AgentRunStateStoreError('RUN_STATE_CORRUPT', 'The resumable agent state failed schema validation');
        }
        if (value.schemaVersion === 1) {
            return { schemaVersion: 1, id, createdAt: value.createdAt, checkpoint: value.checkpoint as AgentRunCheckpoint };
        }
        if (value.schemaVersion !== AGENT_RUN_STATE_SCHEMA_VERSION || !isValidOwner(value.owner)) {
            throw new AgentRunStateStoreError('RUN_STATE_CORRUPT', 'The resumable agent state failed schema validation');
        }
        if (options.expectedOwner && !ownersMatch(value.owner, options.expectedOwner)) {
            throw new AgentRunStateStoreError('RUN_STATE_OWNER_MISMATCH', 'The resumable agent state belongs to another conversation or workspace');
        }
        return {
            schemaVersion: AGENT_RUN_STATE_SCHEMA_VERSION,
            id,
            createdAt: value.createdAt,
            owner: value.owner,
            checkpoint: value.checkpoint as AgentRunCheckpoint
        };
    }

    async remove(id: string): Promise<void> {
        const target = this.#path(id);
        try {
            const metadata = await lstat(target);
            if (metadata.isSymbolicLink() || !metadata.isFile()) {
                throw new AgentRunStateStoreError('RUN_STATE_UNSAFE', 'The resumable agent state is not a regular file');
            }
            await unlink(target);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            if (error instanceof AgentRunStateStoreError) throw error;
            throw new AgentRunStateStoreError('RUN_STATE_UNAVAILABLE', 'Unable to remove the resumable agent state');
        }
    }

    /** Persist the compact delegation tree beside resumable checkpoints. */
    async saveDelegationLedger(ledger: AgentDelegationLedger, owner: AgentRunStateOwner,
        checkpointCommit?: AgentDelegationCheckpointCommit): Promise<AgentDelegationLedger> {
        let normalized = normalizeAgentDelegationLedger(ledger);
        if (!normalized || !owner || owner.rootRunId !== normalized.rootRunId
            || owner.parentRunId !== undefined || owner.depth !== 0) {
            throw new AgentRunStateStoreError('DELEGATION_LEDGER_CORRUPT', 'Delegation ledger ownership metadata is invalid');
        }
        const normalizedOwner = normalizeOwner(owner);
        await this.#ensureSafeDirectory();
        const target = this.#delegationPath(normalized.rootRunId);
        const release = await this.#acquireDelegationLock(normalized.rootRunId);
        try {
            // Never overwrite a corrupt or differently owned ledger silently.
            // Read while holding the lock, then merge concurrent snapshots so
            // two hosts cannot erase each other's child diagnostics.
            let existingLedger: AgentDelegationLedger | undefined;
            try {
                const existing = await this.loadDelegationLedger(normalized.rootRunId, {
                    expectedOwner: {
                        workspaceRoot: normalizedOwner.workspaceRoot,
                        ...(normalizedOwner.conversationId ? { conversationId: normalizedOwner.conversationId } : {}),
                        scope: 'root',
                        rootRunId: normalized.rootRunId,
                        depth: 0
                    }
                });
                existingLedger = existing.ledger;
            } catch (error) {
                if (!(error instanceof AgentRunStateStoreError) || error.code !== 'DELEGATION_LEDGER_NOT_FOUND') throw error;
            }
            if (checkpointCommit) {
                const proposed = normalized.children.find(child => child.childRunId === checkpointCommit.childRunId);
                const current = existingLedger?.children.find(child => child.childRunId === checkpointCommit.childRunId);
                const revision = current?.checkpointRevision ?? 0;
                if (!proposed || proposed.resumeCheckpointId !== checkpointCommit.resumeCheckpointId
                    || !RUN_STATE_ID.test(checkpointCommit.resumeCheckpointId)
                    || !Number.isSafeInteger(checkpointCommit.expectedCheckpointRevision) || checkpointCommit.expectedCheckpointRevision < 0
                    || checkpointCommit.expectedPreviousCheckpointId !== undefined && !RUN_STATE_ID.test(checkpointCommit.expectedPreviousCheckpointId)) {
                    throw new AgentRunStateStoreError('CHILD_CHECKPOINT_INVALID', 'Required child checkpoint metadata is invalid');
                }
                if (revision !== checkpointCommit.expectedCheckpointRevision
                    || current?.resumeCheckpointId !== checkpointCommit.expectedPreviousCheckpointId) {
                    throw new AgentRunStateStoreError('CHILD_CHECKPOINT_CONFLICT', 'Child checkpoint changed before this boundary could be committed');
                }
                if (revision >= Number.MAX_SAFE_INTEGER) {
                    throw new AgentRunStateStoreError('CHILD_CHECKPOINT_REVISION_EXHAUSTED', 'Child checkpoint revision cannot be advanced safely');
                }
                if (current && (current.parentRunId !== proposed.parentRunId || current.rootRunId !== proposed.rootRunId
                    || current.depth !== proposed.depth || current.taskContext && (current.taskContext.workspaceRoot !== proposed.taskContext?.workspaceRoot
                    || current.taskContext.conversationId !== proposed.taskContext?.conversationId))) {
                    throw new AgentRunStateStoreError('CHILD_CHECKPOINT_OWNER_MISMATCH', 'Child checkpoint ownership changed before commit');
                }
                normalized = { ...normalized, children: normalized.children.map(child => child === proposed
                    ? { ...child, checkpointRevision: revision + 1, recoveryStatus: 'durable' as const, checkpointError: undefined } : child) };
            }
            const effective = existingLedger ? mergeDelegationLedgers(existingLedger, normalized) : normalized;
            if (checkpointCommit && !effective.children.some(child => child.childRunId === checkpointCommit.childRunId
                && child.resumeCheckpointId === checkpointCommit.resumeCheckpointId
                && child.checkpointRevision === checkpointCommit.expectedCheckpointRevision + 1)) {
                throw new AgentRunStateStoreError('CHILD_CHECKPOINT_CONFLICT', 'Committed child boundary was not retained by the root index');
            }
            const value: StoredAgentDelegationLedger = {
                schemaVersion: 1,
                rootRunId: effective.rootRunId,
                createdAt: effective.createdAt,
                updatedAt: effective.updatedAt,
                owner: normalizedOwner,
                ledger: effective
            };
            const serialized = encodedBytes(value);
            if (serialized.bytes > AGENT_DELEGATION_LEDGER_MAX_BYTES) {
                throw new AgentRunStateStoreError('DELEGATION_LEDGER_TOO_LARGE', 'Delegation ledger exceeds the local size limit');
            }
            const temporary = `${target}.tmp-${randomUUID()}`;
            try {
                await writeSyncedTemporary(temporary, serialized.json);
                // Never delete the last committed ledger to work around a
                // failed replacement: a lock cannot close that crash window.
                await rename(temporary, target);
                if (process.platform !== 'win32') await chmod(target, 0o600);
                await syncStateDirectory(this.#directory);
                await syncStateDirectory(this.#root);
            } catch (error) {
                try { await unlink(temporary); } catch {}
                if (error instanceof AgentRunStateStoreError) throw error;
                throw new AgentRunStateStoreError('DELEGATION_LEDGER_UNAVAILABLE', 'Unable to persist the delegation ledger');
            }
            return effective;
        } finally {
            await release();
        }
    }

    /** Load a delegation ledger only when its workspace/conversation owner matches. */
    async loadDelegationLedger(
        rootRunId: string,
        options: AgentRunStateLoadOptions = {}
    ): Promise<AgentDelegationLedgerRecord> {
        const target = this.#delegationPath(rootRunId);
        await this.#ensureSafeDirectory();
        let metadata;
        try {
            metadata = await lstat(target);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                throw new AgentRunStateStoreError('DELEGATION_LEDGER_NOT_FOUND', 'The delegation ledger no longer exists');
            }
            throw new AgentRunStateStoreError('DELEGATION_LEDGER_UNAVAILABLE', 'Unable to inspect the delegation ledger');
        }
        if (metadata.isSymbolicLink() || !metadata.isFile()) {
            throw new AgentRunStateStoreError('DELEGATION_LEDGER_UNSAFE', 'The delegation ledger is not a regular file');
        }
        if (metadata.size < 2 || metadata.size > AGENT_DELEGATION_LEDGER_MAX_BYTES) {
            throw new AgentRunStateStoreError(
                metadata.size > AGENT_DELEGATION_LEDGER_MAX_BYTES ? 'DELEGATION_LEDGER_TOO_LARGE' : 'DELEGATION_LEDGER_CORRUPT',
                'The delegation ledger has an invalid size'
            );
        }
        let raw: string;
        try {
            raw = await readFile(target, 'utf8');
        } catch {
            throw new AgentRunStateStoreError('DELEGATION_LEDGER_UNAVAILABLE', 'Unable to read the delegation ledger');
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw new AgentRunStateStoreError('DELEGATION_LEDGER_CORRUPT', 'The delegation ledger is not valid JSON');
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new AgentRunStateStoreError('DELEGATION_LEDGER_CORRUPT', 'The delegation ledger has an invalid shape');
        }
        const value = parsed as Partial<StoredAgentDelegationLedger>;
        const ledger = normalizeAgentDelegationLedger(value.ledger);
        if (value.schemaVersion !== 1 || value.rootRunId !== rootRunId
            || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string'
            || !isValidOwner(value.owner) || value.owner.rootRunId !== rootRunId || value.owner.parentRunId !== undefined
            || value.owner.depth !== 0 || !ledger || ledger.rootRunId !== rootRunId) {
            throw new AgentRunStateStoreError('DELEGATION_LEDGER_CORRUPT', 'The delegation ledger failed schema validation');
        }
        if (options.expectedOwner && !ownersMatch(value.owner, options.expectedOwner)) {
            throw new AgentRunStateStoreError('DELEGATION_LEDGER_OWNER_MISMATCH', 'The delegation ledger belongs to another conversation or workspace');
        }
        return {
            schemaVersion: 1,
            rootRunId,
            createdAt: value.createdAt,
            updatedAt: value.updatedAt,
            owner: value.owner,
            ledger
        };
    }

    async removeDelegationLedger(rootRunId: string): Promise<void> {
        const target = this.#delegationPath(rootRunId);
        try {
            const metadata = await lstat(target);
            if (metadata.isSymbolicLink() || !metadata.isFile()) {
                throw new AgentRunStateStoreError('DELEGATION_LEDGER_UNSAFE', 'The delegation ledger is not a regular file');
            }
            await unlink(target);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            if (error instanceof AgentRunStateStoreError) throw error;
            throw new AgentRunStateStoreError('DELEGATION_LEDGER_UNAVAILABLE', 'Unable to remove the delegation ledger');
        }
    }

    /** Publish only nonempty lock directories; stale reclaimers remove exact owner tokens. */
    async #acquireDelegationLock(rootRunId: string): Promise<() => Promise<void>> {
        const lockPath = this.#delegationLockPath(rootRunId);
        const ownerId = randomUUID();
        const tokenName = `owner-${ownerId}.json`;
        const candidatePath = `${lockPath}.candidate-${ownerId}`;
        const tokenPath = join(lockPath, tokenName);
        const deadline = Date.now() + DELEGATION_LOCK_WAIT_MS;
        let published = false;
        let preserveCandidate = false;
        try {
            // Building privately avoids a public mkdir-to-owner-write window.
            // A published live lock is always nonempty, so another directory
            // rename or rmdir cannot replace it on either POSIX or Windows.
            await mkdir(candidatePath, { mode: 0o700 });
            await writeSyncedTemporary(join(candidatePath, tokenName), JSON.stringify({ ownerId, ownerPid: process.pid }));
            await syncStateDirectory(candidatePath);
            const identity = await lstat(candidatePath);
            while (true) {
                if (Date.now() >= deadline) throw new AgentRunStateStoreError('DELEGATION_LEDGER_UNAVAILABLE', 'Timed out waiting for the delegation ledger lock');
                try {
                    if (process.platform === 'win32') {
                        try {
                            await moveWindowsDelegationLock(candidatePath, lockPath, deadline - Date.now());
                        } catch (error) {
                            const failure = error as DelegationLockPublicationError;
                            if (!failure.publicationUncertain) throw error;
                            preserveCandidate = true;
                            // A lost helper response is not proof that the move
                            // failed. Never retry or clean up an uncertain move
                            // while that helper might still publish later.
                            if (failure.helperMayStillRun) throw error;
                            const actual = await lstat(lockPath).catch(() => undefined);
                            if (!actual || !actual.isDirectory() || actual.isSymbolicLink()
                                || actual.dev !== identity.dev || actual.ino !== identity.ino) throw error;
                            const token = await lstat(tokenPath);
                            if (!token.isFile() || token.isSymbolicLink()) throw error;
                            const value = JSON.parse(await readFile(tokenPath, 'utf8')) as { ownerId?: unknown; ownerPid?: unknown };
                            if (value.ownerId !== ownerId || value.ownerPid !== process.pid) throw error;
                        }
                    } else {
                        await rename(candidatePath, lockPath);
                    }
                    published = true;
                    const actual = await lstat(lockPath);
                    if (!actual.isDirectory() || actual.isSymbolicLink() || actual.dev !== identity.dev || actual.ino !== identity.ino) {
                        throw new AgentRunStateStoreError('DELEGATION_LEDGER_UNAVAILABLE', 'Delegation lock ownership changed during publication');
                    }
                    return async () => {
                        const actual = await lstat(lockPath).catch(error => {
                            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
                            throw error;
                        });
                        if (!actual || !actual.isDirectory() || actual.isSymbolicLink()
                            || actual.dev !== identity.dev || actual.ino !== identity.ino) {
                            throw new AgentRunStateStoreError('DELEGATION_LEDGER_UNAVAILABLE', 'Delegation lock ownership was lost');
                        }
                        // Only a successful removal of our unique token permits
                        // rmdir. A replacement owner's nonempty directory is safe.
                        await unlink(tokenPath);
                        try { await rmdir(lockPath); } catch (error) {
                            if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
                        }
                    };
                } catch (error) {
                    if (published || error instanceof AgentRunStateStoreError) throw error;
                    // Windows may report EPERM/EACCES instead of ENOTEMPTY for
                    // a destination directory. Inspect it before treating that
                    // response as contention; unrelated I/O failures must fail.
                    if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES', 'ENOTDIR', 'EISDIR'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
                    const existing = await lstat(lockPath).catch(inspectError => {
                        if ((inspectError as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
                        throw inspectError;
                    });
                    if (!existing) {
                        // A contending owner may have released after rename
                        // reported a destination collision. Retry that race,
                        // but do not hide an unrelated Windows permission error.
                        if (['EEXIST', 'ENOTEMPTY', 'ENOTDIR', 'EISDIR'].includes((error as NodeJS.ErrnoException).code || '')) continue;
                        throw error;
                    }
                    if (existing.isSymbolicLink()) throw new AgentRunStateStoreError('DELEGATION_LEDGER_UNSAFE', 'Delegation lock is a symbolic link');
                    if (existing.isFile()) {
                        // Older desktop versions use a single file without an
                        // atomic reclaim protocol. Preserve it, including dead
                        // owner evidence; do not race an older writer to unlink.
                        throw new AgentRunStateStoreError('DELEGATION_LEDGER_LEGACY_LOCK', 'An older delegation lock remains; its ownership must be checked before recovery');
                    }
                    if (!existing.isDirectory()) throw new AgentRunStateStoreError('DELEGATION_LEDGER_UNSAFE', 'Delegation lock is not a directory');
                }
                let names: string[];
                try { names = await readdir(lockPath); } catch (error) {
                    if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
                    throw error;
                }
                if (!names.length) {
                    // Only a released/dead lock can be empty. If a new nonempty
                    // candidate wins first, rmdir refuses to remove that lock.
                    try { await rmdir(lockPath); } catch (error) {
                        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
                    }
                    continue;
                }
                const tokenMatch = names.length === 1 ? DELEGATION_LOCK_OWNER.exec(names[0]) : null;
                if (!tokenMatch) throw new AgentRunStateStoreError('DELEGATION_LEDGER_UNSAFE', 'Delegation lock owner metadata is invalid');
                const observedToken = join(lockPath, names[0]);
                let ownerPid: number;
                try {
                    const token = await lstat(observedToken);
                    if (token.isSymbolicLink() || !token.isFile()) throw new AgentRunStateStoreError('DELEGATION_LEDGER_UNSAFE', 'Delegation lock owner is not a regular file');
                    const value = JSON.parse(await readFile(observedToken, 'utf8')) as { ownerId?: unknown; ownerPid?: unknown };
                    ownerPid = Number(value.ownerPid);
                    if (value.ownerId !== tokenMatch[1] || !Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
                        throw new AgentRunStateStoreError('DELEGATION_LEDGER_UNSAFE', 'Delegation lock owner metadata is invalid');
                    }
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
                    throw error;
                }
                if (!processIsAlive(ownerPid)) {
                    // A competing reclaimer that already removed this token
                    // makes unlink fail with ENOENT. It cannot remove a new
                    // owner's differently named token or that nonempty lock.
                    try { await unlink(observedToken); } catch (error) {
                        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
                        throw error;
                    }
                    try { await rmdir(lockPath); } catch (error) {
                        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
                    }
                    continue;
                }
                if (Date.now() >= deadline) throw new AgentRunStateStoreError('DELEGATION_LEDGER_UNAVAILABLE', 'Timed out waiting for the delegation ledger lock');
                await new Promise(resolveWait => setTimeout(resolveWait, 20));
            }
        } catch (error) {
            if (error instanceof AgentRunStateStoreError) throw error;
            throw new AgentRunStateStoreError('DELEGATION_LEDGER_UNAVAILABLE', 'Unable to acquire the delegation ledger lock');
        } finally {
            if (!published && !preserveCandidate) {
                try { await unlink(join(candidatePath, tokenName)); } catch {}
                try { await rmdir(candidatePath); } catch {}
            }
        }
    }

    async #ensureSafeDirectory(): Promise<void> {
        await mkdir(this.#directory, { recursive: true, mode: 0o700 });
        for (const candidate of [this.#root, this.#directory]) {
            const metadata = await lstat(candidate);
            if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
                throw new AgentRunStateStoreError('RUN_STATE_UNSAFE', 'Agent run state directory is unsafe');
            }
        }
        if (process.platform !== 'win32') await chmod(this.#directory, 0o700);
    }

    #path(id: string): string {
        if (!RUN_STATE_ID.test(id)) {
            throw new AgentRunStateStoreError('INVALID_RUN_STATE_ID', 'The resumable agent state identifier is invalid');
        }
        const target = resolve(this.#directory, `${id}.json`);
        if (dirname(target) !== this.#directory) {
            throw new AgentRunStateStoreError('INVALID_RUN_STATE_ID', 'The resumable agent state identifier escapes its store');
        }
        return target;
    }

    #delegationPath(rootRunId: string): string {
        if (!DELEGATION_ROOT_ID.test(rootRunId)) {
            throw new AgentRunStateStoreError('INVALID_RUN_STATE_ID', 'The delegation root identifier is invalid');
        }
        const digest = createHash('sha256').update(rootRunId, 'utf8').digest('hex');
        const target = resolve(this.#directory, `delegation-${digest}.json`);
        if (dirname(target) !== this.#directory) {
            throw new AgentRunStateStoreError('INVALID_RUN_STATE_ID', 'The delegation ledger identifier escapes its store');
        }
        return target;
    }

    #delegationLockPath(rootRunId: string): string {
        return `${this.#delegationPath(rootRunId)}.lock`;
    }
}

function normalizedPath(value: string): string {
    const resolved = resolve(value);
    return process.platform === 'win32' ? resolved.replace(/[\\/]+/g, '\\').toLocaleLowerCase() : resolved;
}

function boundedIdentity(value: unknown): value is string {
    return typeof value === 'string' && value.length <= 500 && value.length > 0 && !/[\0\r\n]/.test(value);
}

function normalizeOwner(owner: AgentRunStateOwner): AgentRunStateOwner {
    if (!owner || typeof owner.workspaceRoot !== 'string' || !owner.workspaceRoot.trim()
        || owner.workspaceRoot.length > 32_768 || /[\0\r\n]/.test(owner.workspaceRoot)) {
        throw new AgentRunStateStoreError('RUN_STATE_CORRUPT', 'Agent run state ownership metadata is invalid');
    }
    const optional = (value: string | undefined): string | undefined => value === undefined ? undefined : boundedIdentity(value) ? value : undefined;
    if (owner.workspaceBindingsKey !== undefined && !/^[a-f0-9]{64}$/.test(owner.workspaceBindingsKey)) {
        throw new AgentRunStateStoreError('RUN_STATE_CORRUPT', 'Agent workspace binding identity is invalid');
    }
    const depth = owner.depth === undefined ? undefined
        : Number.isSafeInteger(owner.depth) && owner.depth >= 0 && owner.depth <= 16 ? owner.depth : undefined;
    if (owner.depth !== undefined && depth === undefined) {
        throw new AgentRunStateStoreError('RUN_STATE_CORRUPT', 'Agent run state ownership depth is invalid');
    }
    return {
        workspaceRoot: resolve(owner.workspaceRoot),
        ...(owner.workspaceBindingsKey ? { workspaceBindingsKey: owner.workspaceBindingsKey } : {}),
        ...(optional(owner.conversationId) ? { conversationId: optional(owner.conversationId) } : {}),
        ...(optional(owner.parentRunId) ? { parentRunId: optional(owner.parentRunId) } : {}),
        ...(optional(owner.rootRunId) ? { rootRunId: optional(owner.rootRunId) } : {}),
        ...(depth === undefined ? {} : { depth })
    };
}

function isValidOwner(value: unknown): value is AgentRunStateOwner {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const owner = value as Partial<AgentRunStateOwner>;
    if (owner.workspaceBindingsKey !== undefined && !/^[a-f0-9]{64}$/.test(owner.workspaceBindingsKey)) return false;
    if (typeof owner.workspaceRoot !== 'string' || !owner.workspaceRoot.trim()
        || owner.workspaceRoot.length > 32_768 || /[\0\r\n]/.test(owner.workspaceRoot)) return false;
    for (const field of ['conversationId', 'parentRunId', 'rootRunId'] as const) {
        if (owner[field] !== undefined && !boundedIdentity(owner[field])) return false;
    }
    return owner.depth === undefined || Number.isSafeInteger(owner.depth) && owner.depth >= 0 && owner.depth <= 16;
}

function ownersMatch(owner: AgentRunStateOwner, expected: AgentRunStateLoadOptions['expectedOwner']): boolean {
    if (!expected || normalizedPath(owner.workspaceRoot) !== normalizedPath(expected.workspaceRoot)) return false;
    if (owner.workspaceBindingsKey !== expected.workspaceBindingsKey) return false;
    if (expected.conversationId !== undefined && owner.conversationId !== expected.conversationId) return false;
    if (expected.scope === 'root' && owner.parentRunId !== undefined) return false;
    if (expected.scope === 'child' && (!expected.parentRunId || owner.parentRunId !== expected.parentRunId)) return false;
    if (expected.rootRunId !== undefined && owner.rootRunId !== expected.rootRunId) return false;
    if (expected.depth !== undefined && owner.depth !== expected.depth) return false;
    return true;
}
