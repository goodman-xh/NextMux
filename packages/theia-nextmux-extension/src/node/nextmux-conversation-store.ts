import { conversationDomainError, type ConversationDomainReason } from '../common/nextmux-conversation-domain-errors';
import type { DomainMessage } from '../common/nextmux-domain-errors';
import { createHash, randomUUID } from 'crypto';
import { chmod, lstat, mkdir, open, readFile as fsReadFile, readdir, rename, rm, unlink, writeFile as fsWriteFile } from 'fs/promises';
import { join, relative, resolve, sep } from 'path';
// proper-lockfile is a maintained mkdir+heartbeat lock. It is a direct
// dependency because this store is used by multiple desktop processes.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const processLockfile = require('proper-lockfile') as {
    lock(file: string, options?: Record<string, unknown>): Promise<() => Promise<void>>;
};
import { ConversationIndex } from './nextmux-conversation-index';
import { searchConversationHistoryRecords } from './nextmux-conversation-search';
import type { DesktopConversationSearchRequest, DesktopConversationSearchResult, DesktopConversationIndexRecord,
    DesktopConversationHistoryProjectsRequest, DesktopConversationHistoryProjectsResult } from '../common/nextmux-platform-protocol';

export const CONVERSATION_STORE_SCHEMA_VERSION = 1 as const;
/** Data-format writer version, intentionally independent from the application semver. */
export const CONVERSATION_STORE_WRITER_VERSION = 2 as const;
/** Highest data-format reader version implemented by this store. */
export const CONVERSATION_STORE_READER_VERSION = 2 as const;
export const CONVERSATION_SESSION_MAX_BYTES = 64 * 1024 * 1024;
/**
 * Payload files keep the existing temp+fsync+rename durability contract. A
 * small fixed worker pool overlaps independent fsyncs on fast local disks
 * without changing the manifest format or allowing an unbounded write burst.
 * Set to 1 as the immediate rollback switch if a platform's filesystem does
 * not benefit from concurrent durable writes.
 */
export const CONVERSATION_PAYLOAD_WRITE_CONCURRENCY = 4 as const;
/**
 * Legacy aggregate constant kept for source compatibility. Conversation
 * history has no aggregate byte cap; payloads are validated individually
 * using the per-session safety bound below. Keep this value effectively
 * unlimited so older callers cannot mistake the former 128 MiB value for a
 * current store limit.
 */
export const CONVERSATION_STORE_MAX_BYTES = Number.MAX_SAFE_INTEGER;
/** No aggregate conversation-count cap. Individual payload validation remains bounded. */
export const CONVERSATION_STORE_MAX_SESSIONS = Number.MAX_SAFE_INTEGER;
export const CONVERSATION_SESSION_MAX_TURNS = 10_000_000;
/**
 * Inline manifest threshold, not a history capacity limit. Larger metadata is
 * written as content-addressed shards so the number and total size of
 * conversations is bounded only by the local disk and per-record validation.
 * Preserve the established threshold: reducing it forces ordinary large
 * histories onto the costlier shard-validation path without raising capacity.
 * Invalid JSON above this size receives a distinct error after parsing fails.
 */
export const CONVERSATION_MANIFEST_INLINE_THRESHOLD_BYTES = 128 * 1024 * 1024;
/** @deprecated Use CONVERSATION_MANIFEST_INLINE_THRESHOLD_BYTES. */
export const CONVERSATION_MANIFEST_MAX_BYTES = CONVERSATION_MANIFEST_INLINE_THRESHOLD_BYTES;

const MANIFEST_FILE = 'manifest-v1.json';
const MANIFEST_SHARD_PATTERN = /^manifest-v1-shard-[0-9a-f]{64}\.json$/;
const MANIFEST_SHARD_MAX_ENTRIES = 1_000;
const INDEX_FILE = 'index-v1.sqlite';
const LEGACY_MANIFEST_BACKUP_FILE = 'manifest-v1.legacy-backup.json';
/**
 * Tombstones live outside the manifest so a missing/corrupt manifest can never
 * turn a payload left behind by a permanent delete back into a visible
 * conversation.  They are metadata only; conversation bodies never enter
 * this file.
 */
const TOMBSTONE_FILE = '.conversation-store-tombstones-v1.json';
const TOMBSTONE_SCHEMA_VERSION = 1 as const;
const TOMBSTONE_MAX_BYTES = 16 * 1024 * 1024;
const PROCESS_LOCK_PATH = '.conversation-store-write-lock';
const COMMIT_INTENT_PATTERN = /^\.conversation-store-intent-[0-9a-f-]{36}\.json$/;
const COMMIT_INTENT_SCHEMA_VERSION = 1 as const;
/** Intent metadata is bounded independently from conversation bodies. */
const COMMIT_INTENT_MAX_BYTES = 256 * 1024 * 1024;
const SESSION_FILE_PATTERN = /^session-[0-9a-f]{64}-[0-9a-f-]{36}\.json$/;
const SESSION_ID_MAX_LENGTH = 300;
const WORKSPACE_PATH_MAX_LENGTH = 4_096;
const TITLE_MAX_LENGTH = 1_000;

/**
 * proper-lockfile protects multiple processes, but it does not promise FIFO
 * acquisition between store instances in the same process. Keep a small
 * process-local queue per storage root so two renderer/backend instances do
 * not reorder writes before they reach the filesystem lock. Rejections are
 * swallowed only for the queue tail; the original operation still receives
 * its own error.
 */
const PROCESS_WRITE_QUEUES = new Map<string, Promise<void>>();

type StoredSession = Record<string, unknown> & {
    readonly id: string;
    readonly workspacePath: string;
    readonly title: string;
    readonly titleOrigin?: 'default' | 'draft' | 'recoveredDraft';
    readonly turns: readonly unknown[];
    readonly createdAt: number;
    readonly updatedAt: number;
};

interface ConversationManifestEntry {
    readonly id: string;
    readonly file: string;
    readonly workspacePath: string;
    readonly title: string;
    readonly titleOrigin?: 'default' | 'draft' | 'recoveredDraft';
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly sha256?: string;
    readonly bytes?: number;
}

interface ConversationManifest {
    readonly schemaVersion: typeof CONVERSATION_STORE_SCHEMA_VERSION;
    readonly createdByVersion: number;
    readonly minimumReaderVersion: number;
    readonly generation: string;
    readonly sessions: readonly ConversationManifestEntry[];
    /** New stores keep large entry lists in content-addressed shards. */
    readonly shardFiles?: readonly string[];
    /** Prevent an old renderer snapshot from resurrecting permanently removed conversations. */
    readonly deletedSessionIds?: readonly string[];
}

interface ParsedConversationManifest {
    readonly manifest: ConversationManifest;
    readonly legacy: boolean;
}

interface ConversationCommitIntent {
    readonly schemaVersion: typeof COMMIT_INTENT_SCHEMA_VERSION;
    readonly baseGeneration: string | null;
    readonly manifest: ConversationManifest;
}

export interface ConversationStoreLoadResult {
    readonly sessions: readonly unknown[];
    readonly status: 'empty' | 'ok' | 'partial';
    readonly deletedSessionIds?: readonly string[];
    /** Names of crash intents retained for explicit recovery; never guessed or silently discarded. */
    readonly pendingRecovery?: readonly string[];
}

export interface ConversationStorePatchResult {
    readonly conversations: number;
    readonly upserted: number;
    readonly removed: number;
}

export interface ConversationStoreListOptions {
    readonly workspacePath?: string;
    readonly pinned?: boolean;
    readonly cursor?: string;
    readonly limit?: number;
}

export interface ConversationStoreListResult extends ConversationStoreLoadResult {
    /** Summaries have historyLoaded=false and must be hydrated before editing. */
    readonly sessions: readonly Record<string, unknown>[];
    readonly total: number;
    readonly nextCursor?: string;
}

export interface ConversationArchiveInsertOptions {
    readonly archiveSha256: string;
    readonly conflictPolicy: 'skip' | 'copy';
    readonly expectedIdsDigest: string;
}

export function conversationIdsDigest(ids: readonly string[]): string {
    return createHash('sha256').update(JSON.stringify([...ids].sort())).digest('hex');
}

export function conversationArchiveCopyId(archiveSha256: string, id: string): string {
    // A deterministic UUID also remains valid for the desktop's owned-workspace allocator.
    const digest = createHash('sha256').update(`${archiveSha256}\0${id}`).digest('hex');
    return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-${((parseInt(digest[16], 16) & 3) | 8).toString(16)}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

interface SerializedSession {
    readonly session: StoredSession;
    readonly bytes: number;
    readonly sha256: string;
}

export class ConversationStoreError extends Error {
    readonly domainError: DomainMessage;
    readonly data: { readonly domainError: DomainMessage };
    constructor(readonly code: 'INVALID_STORE_ROOT' | 'INVALID_SESSION' | 'TOO_LARGE' | 'UNSUPPORTED_VERSION' | 'STORE_CORRUPT' | 'STORE_UNSAFE' | 'STORE_UNAVAILABLE' | 'IMPORT_CONFLICT', reason: ConversationDomainReason, options?: ErrorOptions & { readonly params?: DomainMessage['params'] }) {
        const message = conversationDomainError(reason, options?.cause, options?.params);
        super(message.fallbackEnglish, options);
        this.domainError = message; this.data = { domainError: message };
        this.name = 'ConversationStoreError';
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function byteLength(value: string): number {
    return Buffer.byteLength(value, 'utf8');
}

function isSafeSessionId(value: unknown): value is string {
    return typeof value === 'string'
        && value.length >= 1
        && value.length <= SESSION_ID_MAX_LENGTH
        && !/[\\/\0]/.test(value)
        && !value.includes('..')
        && !/^[.]+$/.test(value);
}

function isSafeGeneration(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);
}

function isSafeWorkspacePath(value: unknown): value is string {
    return typeof value === 'string'
        && value.length <= WORKSPACE_PATH_MAX_LENGTH
        && !value.includes('\0');
}

function isValidTimestamp(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isFormatVersion(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function isValidManifestEntry(value: unknown): value is ConversationManifestEntry {
    if (!isRecord(value)) return false;
    return isSafeSessionId(value.id)
        && typeof value.file === 'string'
        && SESSION_FILE_PATTERN.test(value.file)
        && isSafeWorkspacePath(value.workspacePath)
        && typeof value.title === 'string'
        && value.title.length <= TITLE_MAX_LENGTH
        && (value.titleOrigin === undefined || value.titleOrigin === 'default' || value.titleOrigin === 'draft' || value.titleOrigin === 'recoveredDraft')
        && isValidTimestamp(value.createdAt)
        && isValidTimestamp(value.updatedAt)
        && ((value.sha256 === undefined && value.bytes === undefined)
            || (typeof value.sha256 === 'string' && /^[0-9a-f]{64}$/.test(value.sha256)
                && typeof value.bytes === 'number' && Number.isSafeInteger(value.bytes)
                && value.bytes >= 0 && value.bytes <= CONVERSATION_SESSION_MAX_BYTES));
}

function isValidManifestShard(value: unknown): value is string {
    return typeof value === 'string' && MANIFEST_SHARD_PATTERN.test(value);
}

function parseManifest(value: unknown): ParsedConversationManifest | undefined {
    if (!isRecord(value)) return undefined;
    if ((isFormatVersion(value.schemaVersion) && value.schemaVersion > CONVERSATION_STORE_SCHEMA_VERSION)
        || (isFormatVersion(value.minimumReaderVersion) && value.minimumReaderVersion > CONVERSATION_STORE_READER_VERSION)) {
        throw new ConversationStoreError('UNSUPPORTED_VERSION', 'store_newer_version');
    }
    const legacy = value.createdByVersion === undefined && value.minimumReaderVersion === undefined;
    const deletedIds = Array.isArray(value.deletedSessionIds) ? new Set(value.deletedSessionIds) : new Set();
    if (value.schemaVersion !== CONVERSATION_STORE_SCHEMA_VERSION
        || (!legacy && (!isFormatVersion(value.createdByVersion) || !isFormatVersion(value.minimumReaderVersion)))
        || !isSafeGeneration(value.generation)
        || !Array.isArray(value.sessions)
        || value.sessions.length > CONVERSATION_STORE_MAX_SESSIONS
        || !value.sessions.every(isValidManifestEntry)
        || new Set(value.sessions.map(entry => entry.id)).size !== value.sessions.length
        || new Set(value.sessions.map(entry => entry.file)).size !== value.sessions.length
        || value.deletedSessionIds !== undefined && (!Array.isArray(value.deletedSessionIds)
            || value.deletedSessionIds.length > 100_000 || !value.deletedSessionIds.every(isSafeSessionId)
            || deletedIds.size !== value.deletedSessionIds.length
            || value.sessions.some(entry => deletedIds.has(entry.id)))
        || value.shardFiles !== undefined && (!Array.isArray(value.shardFiles)
            || value.shardFiles.length > 100_000 || !value.shardFiles.every(isValidManifestShard)
            || new Set(value.shardFiles).size !== value.shardFiles.length
            || value.shardFiles.length > 0 && value.sessions.length > 0)) return undefined;
    return {
        legacy,
        manifest: {
            schemaVersion: CONVERSATION_STORE_SCHEMA_VERSION,
            createdByVersion: legacy ? CONVERSATION_STORE_WRITER_VERSION : value.createdByVersion as number,
            minimumReaderVersion: legacy ? CONVERSATION_STORE_READER_VERSION : value.minimumReaderVersion as number,
            generation: value.generation,
            sessions: value.sessions,
            ...(Array.isArray(value.shardFiles) && value.shardFiles.length ? { shardFiles: value.shardFiles } : {}),
            ...(Array.isArray(value.deletedSessionIds) && value.deletedSessionIds.length ? { deletedSessionIds: value.deletedSessionIds } : {})
        }
    };
}

function sessionFileName(id: string, generation: string): string {
    const digest = createHash('sha256').update(id).digest('hex');
    return `session-${digest}-${generation}.json`;
}

function jsonString(value: unknown, context: string): string {
    try {
        const serialized = JSON.stringify(value);
        if (serialized === undefined) throw new Error('JSON.stringify returned undefined');
        return serialized;
    } catch (error) {
        throw new ConversationStoreError('INVALID_SESSION', 'store_json_invalid', { cause: error, params: { context } });
    }
}

export class ConversationStore {
    readonly root: string;
    readonly corruptRoot: string;
    public writeFile: typeof fsWriteFile = fsWriteFile;
    public readFile: typeof fsReadFile = fsReadFile;
    public unlinkFile: typeof unlink = unlink;
    private writeQueue: Promise<void> = Promise.resolve();
    private manifestCache: { signature: string; manifest: ConversationManifest } | undefined;
    /**
     * Lazy indexed queries do not parse every manifest shard. Keep the
     * filesystem signature of each shard so a later query can detect a
     * changed/deleted shard and verify its content-addressed hash before
     * reusing the derived SQLite index. This preserves lazy reads while
     * preventing a modified shard from being silently hidden behind a cached
     * manifest pointer.
     */
    private manifestShardSignatures: { manifestSignature: string; values: Map<string, string> } | undefined;
    private activeWriteLockValid: (() => boolean) | undefined;
    private recoveringIntents = false;
    private pendingRecoveryIntents: string[] = [];
    /**
     * A failed write in this store instance leaves its commit intent on disk
     * for crash recovery. Keep that intent blocked for reads in the same
     * process, however: recovering it immediately would publish the partially
     * attempted delete and make a failed operation appear committed. A fresh
     * store instance may still recover the intent after a real process crash.
     */
    private readonly blockedRecoveryIntents = new Set<string>();

    constructor(root: string) {
        if (typeof root !== 'string' || root.length < 1 || root.length > 4_096 || root.includes('\0')) {
            throw new ConversationStoreError('INVALID_STORE_ROOT', 'store_root_invalid');
        }
        this.root = resolve(root);
        this.corruptRoot = join(this.root, 'corrupt');
    }

    async load(): Promise<ConversationStoreLoadResult> {
        await this.writeQueue;
        return this.withProcessWriteLock(async () => {
        await this.ensureSafeRoot();
        await this.recoverPendingCommitIntents();
        const durableDeletedIds = await this.readTombstoneIds();
        const manifestPath = join(this.root, MANIFEST_FILE);
        let rawManifest: string;
        let manifestLocated = false;
        try {
            await this.assertSafeFile(manifestPath, true);
            manifestLocated = true;
            rawManifest = await this.readFile(manifestPath, 'utf8');
        } catch (error) {
            if (this.isNotFound(error) && !manifestLocated) {
                if (this.pendingRecoveryIntents.length) return { sessions: [], status: 'partial', pendingRecovery: [...this.pendingRecoveryIntents] };
                const recovered = await this.scanUnindexedSessions('empty');
                const sessions = recovered.sessions.filter(value => isRecord(value) && !durableDeletedIds.has(String(value.id)));
                return { sessions, status: recovered.status,
                    ...(durableDeletedIds.size ? { deletedSessionIds: [...durableDeletedIds] } : {}) };
            }
            if (error instanceof ConversationStoreError) throw error;
            throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_index_read_preserved', { cause: error });
        }
        let parsedManifest: unknown;
        try {
            parsedManifest = JSON.parse(rawManifest);
        } catch {
            // The aggregate limit no longer applies to valid sharded history.
            // Keep a bounded fail-closed path for an invalid giant manifest so
            // an accidental/corrupt blob is never parsed or quarantined over
            // the authoritative session files.
            if (byteLength(rawManifest) > CONVERSATION_MANIFEST_MAX_BYTES) {
                throw new ConversationStoreError('TOO_LARGE', 'store_index_invalid_too_large');
            }
            throw new ConversationStoreError('STORE_CORRUPT', 'store_index_corrupt_recover');
        }
        const parsed = parseManifest(parsedManifest);
        if (!parsed) {
            throw new ConversationStoreError('STORE_CORRUPT', 'store_index_corrupt_recover');
        }
        const manifest = await this.expandManifest(parsed.manifest);
        if (parsed.legacy) await this.migrateManifest(rawManifest, manifest);
        const deletedIds = new Set([...(manifest.deletedSessionIds || []), ...durableDeletedIds]);
        if (manifest.sessions.some(entry => deletedIds.has(entry.id))) {
            throw new ConversationStoreError('STORE_CORRUPT', 'store_index_tombstone_conflict');
        }

        const sessions: unknown[] = [];
        let partial = false;
        for (const entry of manifest.sessions) {
            const path = this.safeChildPath(entry.file);
            let rawSession: string;
            try {
                await this.assertSafeFile(path, true);
                rawSession = await this.readFile(path, 'utf8');
            } catch (error) {
                if (!this.isNotFound(error)) {
                    partial = true;
                    await this.quarantine(path);
                } else {
                    partial = true;
                }
                continue;
            }
            const bytes = byteLength(rawSession);
            const digest = createHash('sha256').update(rawSession).digest('hex');
            if (bytes > CONVERSATION_SESSION_MAX_BYTES
                || entry.bytes !== undefined && entry.bytes !== bytes
                || entry.sha256 !== undefined && entry.sha256 !== digest) {
                partial = true;
                await this.quarantine(path);
                continue;
            }
            let parsedSession: unknown;
            try {
                parsedSession = JSON.parse(rawSession);
            } catch {
                partial = true;
                await this.quarantine(path);
                continue;
            }
            if (!this.isValidSession(parsedSession) || parsedSession.id !== entry.id
                || parsedSession.workspacePath !== entry.workspacePath || parsedSession.title !== entry.title
                || parsedSession.createdAt !== entry.createdAt || parsedSession.updatedAt !== entry.updatedAt) {
                partial = true;
                await this.quarantine(path);
                continue;
            }
            sessions.push(parsedSession);
        }
        return { sessions, status: partial ? 'partial' : sessions.length ? 'ok' : 'empty',
            ...(deletedIds.size ? { deletedSessionIds: [...deletedIds] } : {}),
            ...(this.pendingRecoveryIntents.length ? { pendingRecovery: [...this.pendingRecoveryIntents] } : {}) };
        });
    }

    /** Sidebar/project queries read only SQLite metadata, never every conversation body. */
    async list(options: ConversationStoreListOptions = {}): Promise<ConversationStoreListResult> {
        return this.withIndexedHistory(async (index, manifest) => {
            if (options.workspacePath !== undefined && !isSafeWorkspacePath(options.workspacePath)) {
                throw new ConversationStoreError('INVALID_SESSION', 'store_project_path_invalid');
            }
            if (options.pinned !== undefined && typeof options.pinned !== 'boolean') {
                throw new ConversationStoreError('INVALID_SESSION', 'store_pinned_filter_invalid');
            }
            const limit = Math.max(1, Math.min(500, Math.trunc(Number(options.limit) || 100)));
            let after: { updatedAt: number; id: string } | undefined;
            if (options.cursor) {
                try {
                    if (options.cursor.length > 16_384) throw new Error('invalid cursor');
                    const value = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8'));
                    if (!isValidTimestamp(value.updatedAt) || !isSafeSessionId(value.id)
                        || value.workspacePath !== (options.workspacePath ?? null)
                        || (value.pinned ?? null) !== (options.pinned ?? null)) throw new Error('invalid cursor');
                    after = value;
                } catch { throw new ConversationStoreError('INVALID_SESSION', 'store_conversation_cursor_invalid'); }
            }
            const page = index.list({ workspacePath: options.workspacePath, pinned: options.pinned, limit, after });
            const last = page.sessions[page.sessions.length - 1];
            return { sessions: page.sessions, total: page.total,
                status: index.status() === 'partial' ? 'partial' : page.total ? 'ok' : 'empty',
                ...(page.hasMore && last ? { nextCursor: Buffer.from(JSON.stringify({
                    updatedAt: last.updatedAt, id: last.id, workspacePath: options.workspacePath ?? null, pinned: options.pinned ?? null
                })).toString('base64url') } : {}),
                ...(!options.cursor && manifest.deletedSessionIds?.length ? { deletedSessionIds: manifest.deletedSessionIds } : {}),
                ...(!options.cursor && this.pendingRecoveryIntents.length ? { pendingRecovery: [...this.pendingRecoveryIntents] } : {}) };
        });
    }

    /** Project discovery is independent from the newest conversation page. */
    async listProjects(options: DesktopConversationHistoryProjectsRequest = {}): Promise<DesktopConversationHistoryProjectsResult> {
        return this.withIndexedHistory(async index => {
            const limit = Math.max(1, Math.min(500, Math.trunc(Number(options.limit) || 100)));
            let after: { latestUpdatedAt: number; workspacePath: string } | undefined;
            if (options.cursor) {
                try {
                    if (options.cursor.length > 16_384) throw new Error('invalid cursor');
                    const value = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8'));
                    if (value.kind !== 'projects' || !isValidTimestamp(value.latestUpdatedAt)
                        || !isSafeWorkspacePath(value.workspacePath) || !value.workspacePath) throw new Error('invalid cursor');
                    after = value;
                } catch { throw new ConversationStoreError('INVALID_SESSION', 'store_project_cursor_invalid'); }
            }
            const page = index.projects({ limit, after });
            const last = page.projects[page.projects.length - 1];
            return { projects: page.projects, total: page.total,
                status: index.status() === 'partial' ? 'partial' : page.total ? 'ok' : 'empty',
                ...(page.hasMore && last ? { nextCursor: Buffer.from(JSON.stringify({ kind: 'projects',
                    latestUpdatedAt: last.latestUpdatedAt, workspacePath: last.workspacePath
                })).toString('base64url') } : {}) };
        });
    }

    /** Direct conversation hydration does not load or serialize unrelated payloads. */
    async readSession(id: string): Promise<Record<string, unknown> | undefined> {
        if (!isSafeSessionId(id)) throw new ConversationStoreError('INVALID_SESSION', 'store_session_id_invalid');
        const operation = this.writeQueue.then(() => this.withProcessWriteLock(async () => {
            const manifest = await this.readReusableManifest();
            if (!manifest && (await readdir(this.root).catch(() => [] as string[])).some(file => SESSION_FILE_PATTERN.test(file))) {
                throw new ConversationStoreError('STORE_CORRUPT', 'store_index_missing_recover');
            }
            const entry = manifest?.sessions.find(item => item.id === id);
            return entry ? this.readManifestSession(entry) : undefined;
        }));
        this.writeQueue = operation.then(() => undefined, () => undefined);
        return operation;
    }

    /**
     * Read a bounded slice of historical turns for a session (for scroll-up pagination)
     * without dropping or mutating any stored turn on disk.
     */
    async readSessionTurnWindow(
        id: string,
        options: { readonly beforeTurnIndex?: number; readonly limit?: number } = {}
    ): Promise<{
        readonly session: Record<string, unknown>;
        readonly turns: readonly unknown[];
        readonly totalTurns: number;
        readonly startTurnIndex: number;
        readonly endTurnIndex: number;
        readonly hasOlderTurns: boolean;
    } | undefined> {
        const session = await this.readSession(id);
        if (!session) return undefined;
        const allTurns = Array.isArray(session.turns) ? session.turns : [];
        const totalTurns = allTurns.length;
        const limit = Math.max(1, Math.min(CONVERSATION_SESSION_MAX_TURNS, Math.trunc(Number(options.limit) || 100)));
        const endTurnIndex = options.beforeTurnIndex !== undefined && Number.isFinite(options.beforeTurnIndex)
            ? Math.max(0, Math.min(totalTurns, Math.trunc(options.beforeTurnIndex)))
            : totalTurns;
        const startTurnIndex = Math.max(0, endTurnIndex - limit);
        const turns = allTurns.slice(startTurnIndex, endTurnIndex);
        return {
            session: { ...session, turns, totalTurns, startTurnIndex, endTurnIndex, hasOlderTurns: startTurnIndex > 0 },
            turns,
            totalTurns,
            startTurnIndex,
            endTurnIndex,
            hasOlderTurns: startTurnIndex > 0
        };
    }

    async search(request: DesktopConversationSearchRequest): Promise<DesktopConversationSearchResult> {
        return this.withIndexedHistory(async index => {
            const limit = Math.max(1, Math.min(500, Math.trunc(Number(request.limit) || 50)));
            const matches: DesktopConversationSearchResult['matches'][number][] = [];
            let offset = 0;
            while (matches.length < limit) {
                const candidates = index.searchRecords(request, 100, offset);
                if (!candidates.length) break;
                matches.push(...searchConversationHistoryRecords(candidates, { ...request, limit: limit - matches.length }).matches);
                if (candidates.length < 100) break;
                offset += candidates.length;
            }
            return { matches };
        });
    }

    async searchRecords(request: DesktopConversationSearchRequest): Promise<readonly DesktopConversationIndexRecord[]> {
        return this.withIndexedHistory(async index => {
            const limit = Math.max(1, Math.min(500, Math.trunc(Number(request.limit) || 50)));
            const records: DesktopConversationIndexRecord[] = [];
            let offset = 0;
            while (records.length < limit) {
                const candidates = index.searchRecords(request, 100, offset);
                for (const candidate of candidates) {
                    if (searchConversationHistoryRecords([candidate], request).matches.length) records.push(candidate);
                    if (records.length === limit) break;
                }
                if (candidates.length < 100) break;
                offset += candidates.length;
            }
            return records;
        });
    }

    async save(sessions: readonly unknown[]): Promise<void> {
        const operation = this.writeQueue.then(() => this.withProcessWriteLock(() => this.saveNow(sessions)));
        this.writeQueue = operation.catch(() => undefined);
        return operation;
    }

    /** Read-only archive boundary: never migrate, quarantine, or create a directory. */
    async snapshot(): Promise<readonly Record<string, unknown>[]> {
        await this.writeQueue;
        return this.snapshotNow();
    }

    /** Select conflicts and commit under the same queue as normal history writes. */
    async insertArchiveSessions(
        sessions: readonly unknown[], options: ConversationArchiveInsertOptions,
        prepare: (selected: readonly Record<string, unknown>[], idMap: Readonly<Record<string, string>>) => Promise<readonly unknown[]>
    ): Promise<{ readonly imported: number; readonly skipped: number; readonly idMap: Readonly<Record<string, string>>; readonly conversations: number }> {
        const operation = this.writeQueue.then(() => this.withProcessWriteLock(async () => {
            if (!/^[a-f0-9]{64}$/.test(options.archiveSha256) || !['skip', 'copy'].includes(options.conflictPolicy)) {
                throw new ConversationStoreError('INVALID_SESSION', 'store_import_options_invalid');
            }
            const existing = await this.snapshotNow();
            const ids = new Set(existing.map(session => String(session.id)));
            if (conversationIdsDigest([...ids]) !== options.expectedIdsDigest) throw new ConversationStoreError('IMPORT_CONFLICT', 'store_import_list_changed');
            for (const id of await this.readTombstoneIds()) ids.add(id);
            for (const id of (await this.readReusableManifest())?.deletedSessionIds || []) ids.add(id);
            const { serializedSessions } = this.serializeSessions(sessions);
            const selected: Record<string, unknown>[] = [];
            const idMap: Record<string, string> = Object.create(null);
            for (const { session } of serializedSessions) {
                let id = session.id;
                if (ids.has(id)) {
                    if (options.conflictPolicy === 'skip') continue;
                    id = conversationArchiveCopyId(options.archiveSha256, id);
                    if (ids.has(id)) continue;
                }
                ids.add(id);
                idMap[session.id] = id;
                selected.push({ ...session, id });
            }
            if (!selected.length) return { imported: 0, skipped: sessions.length, idMap, conversations: existing.length };
            const prepared = await prepare(selected, idMap);
            if (prepared.length !== selected.length || prepared.some((item, index) => !isRecord(item) || item.id !== selected[index].id)) {
                throw new ConversationStoreError('INVALID_SESSION', 'store_import_preparation_mismatch');
            }
            const result = await this.patchNow(prepared, []);
            return { imported: selected.length, skipped: sessions.length - selected.length, idMap, conversations: result.conversations };
        }));
        this.writeQueue = operation.then(() => undefined, () => undefined);
        return operation;
    }

    private async snapshotNow(): Promise<readonly Record<string, unknown>[]> {
        let rootInfo;
        try { rootInfo = await lstat(this.root); } catch (error) { if (this.isNotFound(error)) return []; throw error; }
        if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new ConversationStoreError('STORE_UNSAFE', 'store_directory_symlink');
        const manifestPath = join(this.root, MANIFEST_FILE);
        let manifestInfo;
        try { manifestInfo = await lstat(manifestPath); } catch (error) {
            if (!this.isNotFound(error)) throw error;
            if ((await readdir(this.root)).some(name => SESSION_FILE_PATTERN.test(name))) throw new ConversationStoreError('STORE_CORRUPT', 'store_index_missing_recover');
            return [];
        }
        if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) throw new ConversationStoreError('STORE_UNSAFE', 'store_index_symlink');
        let parsed: ParsedConversationManifest | undefined;
        try { parsed = parseManifest(JSON.parse(await this.readFile(manifestPath, 'utf8'))); }
        catch (error) { if (error instanceof ConversationStoreError) throw error; throw new ConversationStoreError('STORE_CORRUPT', 'store_index_corrupt'); }
        if (!parsed) throw new ConversationStoreError('STORE_CORRUPT', 'store_index_corrupt');
        const manifest = await this.expandManifest(parsed.manifest);
        const sessions: StoredSession[] = [];
        for (const entry of manifest.sessions) {
            const path = this.safeChildPath(entry.file);
            const info = await lstat(path);
            if (!info.isFile() || info.isSymbolicLink()) throw new ConversationStoreError('STORE_UNSAFE', 'store_file_symlink');
            if (info.size > CONVERSATION_SESSION_MAX_BYTES) throw new ConversationStoreError('TOO_LARGE', 'store_history_too_large');
            const bytes = await this.readFile(path);
            let session: unknown;
            try { session = JSON.parse(bytes.toString('utf8')); } catch { throw new ConversationStoreError('STORE_CORRUPT', 'store_content_corrupt'); }
            if (bytes.length !== info.size || !this.isValidSession(session) || session.id !== entry.id
                || session.workspacePath !== entry.workspacePath || session.title !== entry.title
                || session.createdAt !== entry.createdAt || session.updatedAt !== entry.updatedAt
                || entry.bytes !== undefined && entry.bytes !== bytes.length
                || entry.sha256 !== undefined && entry.sha256 !== createHash('sha256').update(bytes).digest('hex')) {
                throw new ConversationStoreError('STORE_CORRUPT', 'store_content_index_mismatch');
            }
            sessions.push(session);
        }
        return sessions;
    }

    /**
     * `baseUpdatedAt` names, per upserted conversation, the stored version the writer's copy was based on. A copy
     * based on an older version than the stored one is refused instead of overwriting turns saved in between; the
     * writer reads the conversation again and merges (audit B04-01).
     */
    async patch(upserts: readonly unknown[], removedSessionIds: readonly string[], baseUpdatedAt?: Readonly<Record<string, number>>): Promise<ConversationStorePatchResult> {
        // A deleted conversation stays deleted: an older window's snapshot cannot write it back (audit B04-04).
        const operation = this.writeQueue.then(() => this.withProcessWriteLock(() => this.patchNow(upserts, removedSessionIds, removedSessionIds.length > 0, baseUpdatedAt)));
        this.writeQueue = operation.then(() => undefined, () => undefined);
        return operation;
    }

    /** Remove only the exact unsent draft copied by an explicit normal-to-incognito transition. */
    async removeTransferredDraft(expected: Record<string, unknown>): Promise<void> {
        const operation = this.writeQueue.then(() => this.withProcessWriteLock(async () => {
            const id = String(expected.id || '');
            const manifest = await this.readReusableManifest();
            const entry = manifest?.sessions.find(item => item.id === id);
            if (!entry || (await this.readTombstoneIds()).has(id)) throw new ConversationStoreError('IMPORT_CONFLICT', 'store_concurrent_update');
            const path = this.safeChildPath(entry.file); await this.assertSafeFile(path, false);
            const bytes = await this.readFile(path);
            let current: Record<string, unknown>;
            try { current = JSON.parse(bytes.toString('utf8')); } catch { throw new ConversationStoreError('STORE_CORRUPT', 'store_content_corrupt'); }
            if (!this.isValidSession(current) || JSON.stringify(current) !== JSON.stringify(expected)
                || !Array.isArray(current.turns) || current.turns.length) throw new ConversationStoreError('IMPORT_CONFLICT', 'store_concurrent_update');
            await this.patchNow([], [id], true);
            // Remove older immutable revisions too; the derived FTS already uses secure_delete.
            const prefix = `session-${createHash('sha256').update(id).digest('hex')}-`;
            for (const file of await readdir(this.root)) if (SESSION_FILE_PATTERN.test(file) && file.startsWith(prefix)) await this.removeSessionFiles([file], true);
            await this.removeLegacyManifestBackup();
        }));
        this.writeQueue = operation.then(() => undefined, () => undefined);
        return operation;
    }

    async isDeletedSession(id: string): Promise<boolean> {
        await this.writeQueue;
        return this.withProcessWriteLock(async () => {
            // Validate the manifest before consulting the tombstone sidecar.
            // Returning a tombstone result while the pointer is malformed
            // would make corruption appear healthy and would let callers
            // continue mutating an unsafe store.
            const manifest = await this.readReusableManifest();
            if ((await this.readTombstoneIds()).has(id)) return true;
            return manifest?.deletedSessionIds?.includes(id) === true;
        });
    }

    /** Select the exact project and remove its records in the existing atomic write queue. */
    async deleteProject(workspacePath: string): Promise<{ readonly removedSessionIds: readonly string[] }> {
        const operation = this.writeQueue.then(() => this.withProcessWriteLock(async () => {
            if (!isSafeWorkspacePath(workspacePath) || !workspacePath) {
                throw new ConversationStoreError('INVALID_SESSION', 'store_project_path_invalid');
            }
            await this.ensureSafeRoot();
            const manifest = await this.readReusableManifest();
            if (!manifest && (await readdir(this.root)).some(file => SESSION_FILE_PATTERN.test(file))) {
                throw new ConversationStoreError('STORE_CORRUPT', 'store_index_missing_recover');
            }
            const removedSessionIds = (manifest?.sessions || []).filter(session => session.workspacePath === workspacePath).map(session => session.id);
            if (removedSessionIds.length) await this.patchNow([], removedSessionIds, true);
            // A previous call may have committed the manifest but failed to
            // unlink a payload. Retry that cleanup without resurrecting data.
            const deleted = (await this.readReusableManifest())?.deletedSessionIds || [];
            const deletedPrefixes = new Set(deleted.map(id => `session-${createHash('sha256').update(id).digest('hex')}-`));
            for (const file of await readdir(this.root)) {
                if (SESSION_FILE_PATTERN.test(file) && deletedPrefixes.has(file.slice(0, 73))) {
                    await this.removeSessionFiles([file], true);
                }
            }
            if (deleted.length) await this.removeLegacyManifestBackup();
            return { removedSessionIds };
        }));
        this.writeQueue = operation.then(() => undefined, () => undefined);
        return operation;
    }

    async clear(): Promise<void> {
        const operation = this.writeQueue.then(() => this.withProcessWriteLock(async () => {
            await this.ensureSafeRoot();
            const previous = await this.readReusableManifest();
            const manifestPath = join(this.root, MANIFEST_FILE);
            const temporary = `${manifestPath}.tmp-${randomUUID()}`;
            const emptyManifest: ConversationManifest = {
                schemaVersion: CONVERSATION_STORE_SCHEMA_VERSION,
                createdByVersion: CONVERSATION_STORE_WRITER_VERSION,
                minimumReaderVersion: CONVERSATION_STORE_READER_VERSION,
                generation: randomUUID(),
                ...(previous?.deletedSessionIds?.length ? { deletedSessionIds: previous.deletedSessionIds } : {}),
                sessions: []
            };
            await this.atomicWrite(temporary, manifestPath, jsonString(emptyManifest, 'Conversation index'));
            // Pending commit intents would otherwise protect (and later restore) bodies the user just deleted (audit B04-07).
            for (const name of (await readdir(this.root)).filter(name => COMMIT_INTENT_PATTERN.test(name))) {
                await unlink(this.safeChildPath(name)).catch(error => { if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error; });
            }
            this.blockedRecoveryIntents.clear();
            await this.removeUnreferencedManifestShards(new Set());
            await this.removeUnreferencedSessionFiles(new Set());
            await rm(join(this.root, INDEX_FILE), { force: true });
            await rm(join(this.root, `${INDEX_FILE}-journal`), { force: true });
            await this.removeCorruptPayloads();
            await this.removeLegacyManifestBackup();
        }));
        this.writeQueue = operation.catch(() => undefined);
        return operation;
    }

    private async saveNow(sessions: readonly unknown[], alsoDeleted: ReadonlySet<string> = new Set()): Promise<void> {
        await this.ensureSafeRoot();
        const previousManifest = await this.readReusableManifest();
        const deletedIds = new Set([...await this.readTombstoneIds(), ...alsoDeleted]);
        for (const id of previousManifest?.deletedSessionIds || []) deletedIds.add(id);
        // A missing manifest is an index failure, not permission to discard
        // valid session payloads. Validate the caller snapshot first, then
        // discover orphaned payloads and include them in the next generation.
        // This matters when a process dies after payload rename but before the
        // manifest pointer is published: save() must be lossless just like
        // patch() and the indexed read path.
        const incoming = sessions.filter(value => !isRecord(value) || !deletedIds.has(String(value.id)));
        const serializedIncoming = this.serializeSessions(incoming).serializedSessions;
        let serializedSessions = serializedIncoming;
        if (!previousManifest) {
            if (this.pendingRecoveryIntents.length) {
                throw new ConversationStoreError('STORE_CORRUPT', 'store_intent_recovery_pending');
            }
            const recovered = await this.scanUnindexedSessions('empty');
            const incomingIds = new Set(serializedIncoming.map(item => item.session.id));
            const recoveredSessions = recovered.sessions.filter((value): value is StoredSession =>
                this.isValidSession(value) && !deletedIds.has(value.id) && !incomingIds.has(value.id));
            const serializedRecovered = this.serializeSessions(recoveredSessions).serializedSessions;
            serializedSessions = [...serializedIncoming, ...serializedRecovered];
        }
        const previousEntries = new Map(previousManifest?.sessions.map(entry => [entry.id, entry]) || []);
        const generation = randomUUID();
        const selectedFiles = new Map<string, string>();
        for (const item of serializedSessions) {
            const previous = previousEntries.get(item.session.id);
            const reusable = previous && previous.sha256 === item.sha256 && previous.bytes === item.bytes
                ? await this.reusableSessionFile(previous, item.bytes) : undefined;
            selectedFiles.set(item.session.id, reusable || sessionFileName(item.session.id, generation));
        }
        const manifest: ConversationManifest = {
            schemaVersion: CONVERSATION_STORE_SCHEMA_VERSION,
            createdByVersion: CONVERSATION_STORE_WRITER_VERSION,
            minimumReaderVersion: CONVERSATION_STORE_READER_VERSION,
            generation,
            ...(deletedIds.size ? { deletedSessionIds: [...deletedIds] } : {}),
            sessions: serializedSessions.map(({ session, bytes, sha256 }) => ({
                id: session.id,
                file: selectedFiles.get(session.id)!,
                workspacePath: session.workspacePath,
                title: session.title,
                ...(session.titleOrigin === 'default' || session.titleOrigin === 'draft' || session.titleOrigin === 'recoveredDraft' ? { titleOrigin: session.titleOrigin } : {}),
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
                sha256,
                bytes
            }))
        };
        try {
            await this.writeCommitIntent({ schemaVersion: COMMIT_INTENT_SCHEMA_VERSION,
                baseGeneration: previousManifest?.generation ?? null, manifest });
            await this.writeTombstoneIds(deletedIds);
            await this.writeSerializedSessions(serializedSessions, selectedFiles, previousEntries);
            // Publish the small pointer plus content-addressed shards.  The
            // legacy single-file manifest is still readable, but new writes
            // must never recreate an aggregate history bottleneck.
            await this.writeManifest(manifest);
            await this.removeCommitIntent(generation).catch(() => undefined);
            await this.updateIndexAfterCommit(previousManifest, manifest, serializedSessions.map(item => item.session));
            await this.removeUnreferencedSessionFiles(new Set(manifest.sessions.map(entry => entry.file)));
            await this.clearBlockedRecoveryIntents();
        } catch (error) {
            this.blockRecoveryIntent(generation);
            // This call reports the failure to its caller, so a later process must not roll it forward: the intent is
            // for crashes only (audit B04-05). A published manifest already references everything it needs.
            await this.removeCommitIntent(generation).catch(() => undefined);
            if (error instanceof ConversationStoreError) throw error;
            throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_snapshot_save_failed', { cause: error });
        }
    }

    private async patchNow(
        upserts: readonly unknown[],
        removedSessionIds: readonly string[],
        permanent = false,
        baseUpdatedAt?: Readonly<Record<string, number>>
    ): Promise<ConversationStorePatchResult> {
        if (!Array.isArray(removedSessionIds) || removedSessionIds.length > CONVERSATION_STORE_MAX_SESSIONS) {
            throw new ConversationStoreError('INVALID_SESSION', 'store_delete_count_limit');
        }
        const removedIds = new Set<string>();
        for (const id of removedSessionIds) {
            if (!isSafeSessionId(id) || removedIds.has(id)) {
                throw new ConversationStoreError('INVALID_SESSION', 'store_delete_ids_invalid');
            }
            removedIds.add(id);
        }
        await this.ensureSafeRoot();
        const previousManifest = await this.readReusableManifest();
        const previousTombstoneIds = new Set(await this.readTombstoneIds());
        const deletedIds = new Set(previousTombstoneIds);
        for (const id of previousManifest?.deletedSessionIds || []) deletedIds.add(id);
        const { serializedSessions } = this.serializeSessions(upserts.filter(value => !isRecord(value) || !deletedIds.has(String(value.id))));
        const upsertIds = new Set(serializedSessions.map(item => item.session.id));
        if ([...removedIds].some(id => upsertIds.has(id))) {
            throw new ConversationStoreError('INVALID_SESSION', 'store_update_delete_conflict');
        }

        if (permanent) for (const id of removedIds) deletedIds.add(id);
        if (deletedIds.size > 100_000) throw new ConversationStoreError('TOO_LARGE', 'store_delete_index_limit');
        if (!previousManifest) {
            const recovered = await this.scanUnindexedSessions('empty');
            const recoveredSessions = recovered.sessions.filter((value): value is StoredSession => this.isValidSession(value) && !deletedIds.has(value.id));
            const recoveredIds = new Set(recoveredSessions.map(session => session.id));
            const combined = [
                ...serializedSessions.map(item => item.session),
                ...recoveredSessions.filter(session => !removedIds.has(session.id) && !upsertIds.has(session.id))
            ].sort((left, right) => right.updatedAt - left.updatedAt);
            // The recovery scan inside save must not collect the bodies this call deletes (audit B04-06).
            await this.saveNow(combined, new Set([...deletedIds, ...removedIds]));
            return {
                conversations: combined.length,
                upserted: serializedSessions.length,
                removed: [...removedIds].filter(id => recoveredIds.has(id)).length
            };
        }

        const previousEntries = new Map(previousManifest.sessions.map(entry => [entry.id, entry]));
        for (const item of serializedSessions) {
            const stored = previousEntries.get(item.session.id)?.updatedAt || 0;
            const base = baseUpdatedAt?.[item.session.id];
            if (stored > item.session.updatedAt || typeof base === 'number' && Number.isFinite(base) && stored > base) {
                throw new ConversationStoreError('IMPORT_CONFLICT', 'store_concurrent_update');
            }
        }
        const generation = randomUUID();
        const nextEntries: ConversationManifestEntry[] = [];
        for (const entry of previousManifest.sessions) {
            if (removedIds.has(entry.id) || upsertIds.has(entry.id)) continue;
            nextEntries.push(await this.completeManifestEntry(entry));
        }

        const selectedFiles = new Map<string, string>();
        for (const item of serializedSessions) {
            const previous = previousEntries.get(item.session.id);
            const reusable = previous && previous.sha256 === item.sha256 && previous.bytes === item.bytes
                ? await this.reusableSessionFile(previous, item.bytes) : undefined;
            const file = reusable || sessionFileName(item.session.id, generation);
            selectedFiles.set(item.session.id, file);
            nextEntries.push({
                id: item.session.id,
                file,
                workspacePath: item.session.workspacePath,
                title: item.session.title,
                ...(item.session.titleOrigin === 'default' || item.session.titleOrigin === 'draft' || item.session.titleOrigin === 'recoveredDraft' ? { titleOrigin: item.session.titleOrigin } : {}),
                createdAt: item.session.createdAt,
                updatedAt: item.session.updatedAt,
                sha256: item.sha256,
                bytes: item.bytes
            });
        }
        nextEntries.sort((left, right) => right.updatedAt - left.updatedAt);
        if (nextEntries.length > CONVERSATION_STORE_MAX_SESSIONS) {
            throw new ConversationStoreError('INVALID_SESSION', 'store_session_count_limit');
        }
        const manifest: ConversationManifest = {
            schemaVersion: CONVERSATION_STORE_SCHEMA_VERSION,
            createdByVersion: CONVERSATION_STORE_WRITER_VERSION,
            minimumReaderVersion: CONVERSATION_STORE_READER_VERSION,
            generation,
            ...(deletedIds.size ? { deletedSessionIds: [...deletedIds] } : {}),
            sessions: nextEntries
        };
        let committed = false;
        try {
            await this.writeCommitIntent({ schemaVersion: COMMIT_INTENT_SCHEMA_VERSION,
                baseGeneration: previousManifest.generation, manifest });
            await this.writeTombstoneIds(deletedIds);
            await this.writeSerializedSessions(serializedSessions, selectedFiles, previousEntries);
            await this.writeManifest(manifest);
            committed = true;
            await this.removeCommitIntent(generation).catch(() => undefined);
            await this.updateIndexAfterCommit(previousManifest, manifest, serializedSessions.map(item => item.session));
            const referencedFiles = new Set(nextEntries.map(entry => entry.file));
            await this.removeSessionFiles(previousManifest.sessions
                .map(entry => entry.file)
                .filter(file => !referencedFiles.has(file)), permanent);
            await this.clearBlockedRecoveryIntents();
        } catch (error) {
            this.blockRecoveryIntent(generation);
            const published = committed || await this.manifestGenerationPublished(generation);
            // Reported to the caller as failed: never rolled forward by a later process (audit B04-05).
            await this.removeCommitIntent(generation).catch(() => undefined);
            if (!published && permanent) {
                // Keep the failed delete retryable and preserve the old
                // manifest/payloads.  Tombstones are written first for crash
                // safety, so they need the same rollback treatment as the
                // manifest when the pointer was never published.
                await this.writeTombstoneIds(previousTombstoneIds).catch(() => undefined);
            }
            if (error instanceof ConversationStoreError) throw error;
            throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_patch_save_failed', { cause: error });
        }
        return {
            conversations: nextEntries.length,
            upserted: serializedSessions.length,
            removed: [...removedIds].filter(id => previousEntries.has(id)).length
        };
    }

    private serializeSessions(sessions: readonly unknown[]): {
        readonly serializedSessions: readonly SerializedSession[];
        readonly totalBytes: number;
    } {
        if (!Array.isArray(sessions) || sessions.length > CONVERSATION_STORE_MAX_SESSIONS) {
            throw new ConversationStoreError('INVALID_SESSION', 'store_session_count_limit');
        }
        const serializedSessions: SerializedSession[] = [];
        const ids = new Set<string>();
        let totalBytes = 0;
        for (const value of sessions) {
            if (!this.isValidSession(value)) throw new ConversationStoreError('INVALID_SESSION', 'store_session_invalid');
            if (value.incognito === true) throw new ConversationStoreError('INVALID_SESSION', 'store_session_invalid');
            if (ids.has(value.id)) throw new ConversationStoreError('INVALID_SESSION', 'store_session_id_duplicate');
            ids.add(value.id);
            const content = jsonString(value, `Conversation ${value.id}`);
            const bytes = byteLength(content);
            if (bytes > CONVERSATION_SESSION_MAX_BYTES) {
                throw new ConversationStoreError('TOO_LARGE', 'store_payload_limit', { params: { sessionId: value.id, limitBytes: CONVERSATION_SESSION_MAX_BYTES, actualBytes: bytes } });
            }
            totalBytes += bytes;
            serializedSessions.push({
                session: value,
                bytes,
                sha256: createHash('sha256').update(content).digest('hex')
            });
        }
        return { serializedSessions, totalBytes };
    }

    /**
     * Serialize one payload only while it is being committed. Keeping JSON
     * strings for every session doubled memory during 50k-session saves. The
     * hash is recomputed before publication so a caller mutating a session
     * object during an awaited write fails closed instead of committing a
     * body that disagrees with its manifest entry.
     */
    private async writeSerializedSession(item: SerializedSession, temporary: string, target: string): Promise<void> {
        const content = jsonString(item.session, `Conversation ${item.session.id}`);
        const bytes = byteLength(content);
        const sha256 = createHash('sha256').update(content).digest('hex');
        if (bytes !== item.bytes || sha256 !== item.sha256) {
            throw new ConversationStoreError('IMPORT_CONFLICT', 'store_changed_during_save');
        }
        await this.atomicWrite(temporary, target, content);
    }

    /**
     * Write independent payloads with a bounded pool. Promise.allSettled is
     * intentional: when one write fails, all workers must settle before the
     * process lock is released so no write can publish after the commit has
     * been reported as failed. The existing commit intent then preserves the
     * recovery boundary for any payloads already renamed into place.
     */
    private async writeSerializedSessions(
        sessions: readonly SerializedSession[],
        selectedFiles: ReadonlyMap<string, string>,
        previousEntries: ReadonlyMap<string, ConversationManifestEntry>
    ): Promise<void> {
        const pending = sessions.filter(item => previousEntries.get(item.session.id)?.file !== selectedFiles.get(item.session.id));
        if (!pending.length) return;
        let cursor = 0;
        const worker = async (): Promise<void> => {
            while (cursor < pending.length) {
                const item = pending[cursor++];
                const file = selectedFiles.get(item.session.id);
                if (!file) throw new ConversationStoreError('STORE_CORRUPT', 'store_payload_index_missing');
                const target = this.safeChildPath(file);
                const temporary = `${target}.tmp-${randomUUID()}`;
                await this.writeSerializedSession(item, temporary, target);
            }
        };
        const workerCount = Math.min(CONVERSATION_PAYLOAD_WRITE_CONCURRENCY, pending.length);
        const results = await Promise.allSettled(Array.from({ length: workerCount }, () => worker()));
        const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failed) throw failed.reason;
    }

    private isValidSession(value: unknown): value is StoredSession {
        if (!isRecord(value)
            || value.historyLoaded === false
            || !isSafeSessionId(value.id)
            || !isSafeWorkspacePath(value.workspacePath)
            || typeof value.title !== 'string'
            || value.title.length > TITLE_MAX_LENGTH
            || value.titleOrigin !== undefined && value.titleOrigin !== 'default' && value.titleOrigin !== 'draft' && value.titleOrigin !== 'recoveredDraft'
            || !Array.isArray(value.turns)
            || value.turns.length > CONVERSATION_SESSION_MAX_TURNS
            || !isValidTimestamp(value.createdAt)
            || !isValidTimestamp(value.updatedAt)) return false;
        return true;
    }

    private safeChildPath(file: string): string {
        if (!SESSION_FILE_PATTERN.test(file)) {
            throw new ConversationStoreError('STORE_UNSAFE', 'store_payload_path_invalid');
        }
        const target = resolve(this.root, file);
        const segment = relative(this.root, target);
        if (!segment || segment === '..' || segment.startsWith(`..${sep}`) || segment.includes(sep)) {
            throw new ConversationStoreError('STORE_UNSAFE', 'store_payload_path_outside');
        }
        return target;
    }

    /** Resolve a content-addressed manifest shard without widening the session path allow-list. */
    private safeManifestShardPath(file: string): string {
        if (!MANIFEST_SHARD_PATTERN.test(file)) {
            throw new ConversationStoreError('STORE_UNSAFE', 'store_shard_path_invalid');
        }
        const target = resolve(this.root, file);
        const segment = relative(this.root, target);
        if (!segment || segment === '..' || segment.startsWith(`..${sep}`) || segment.includes(sep)) {
            throw new ConversationStoreError('STORE_UNSAFE', 'store_shard_path_outside');
        }
        return target;
    }

    private async assertSafeFile(path: string, allowMissing: boolean): Promise<void> {
        try {
            const metadata = await lstat(path);
            if (metadata.isSymbolicLink() || !metadata.isFile()) {
                throw new ConversationStoreError('STORE_UNSAFE', 'store_file_unsafe');
            }
        } catch (error) {
            if (allowMissing && this.isNotFound(error)) throw error;
            if (error instanceof ConversationStoreError) throw error;
            throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_file_access_failed', { cause: error });
        }
    }

    private async ensureSafeRoot(): Promise<void> {
        try {
            await mkdir(this.root, { recursive: true, mode: 0o700 });
        } catch (error) {
            if (!error || typeof error !== 'object' || (error as NodeJS.ErrnoException).code !== 'EEXIST') {
                throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_directory_create_failed', { cause: error });
            }
        }
        let metadata;
        try {
            metadata = await lstat(this.root);
        } catch (error) {
            throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_directory_access_failed', { cause: error });
        }
        if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
            throw new ConversationStoreError('STORE_UNSAFE', 'store_root_unsafe');
        }
    }

    private commitIntentPath(generation: string): string {
        if (!isSafeGeneration(generation)) throw new ConversationStoreError('STORE_UNSAFE', 'store_intent_id_invalid');
        return join(this.root, `.conversation-store-intent-${generation}.json`);
    }

    private async writeCommitIntent(intent: ConversationCommitIntent): Promise<void> {
        const path = this.commitIntentPath(intent.manifest.generation);
        await this.atomicWrite(`${path}.tmp-${randomUUID()}`, path, jsonString(intent, 'Conversation commit intent'));
    }

    /** Read the permanent-delete fence without consulting the conversation index. */
    private async readTombstoneIds(): Promise<Set<string>> {
        const path = join(this.root, TOMBSTONE_FILE);
        try { await this.assertSafeFile(path, true); }
        catch (error) {
            if (this.isNotFound(error)) return new Set();
            throw error;
        }
        let info;
        try { info = await lstat(path); }
        catch (error) { throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_tombstone_read_failed', { cause: error }); }
        if (info.size > TOMBSTONE_MAX_BYTES) {
            throw new ConversationStoreError('TOO_LARGE', 'store_tombstone_limit_preserved');
        }
        let parsed: unknown;
        try { parsed = JSON.parse(await this.readFile(path, 'utf8')); }
        catch (error) { throw new ConversationStoreError('STORE_CORRUPT', 'store_tombstone_corrupt', { cause: error }); }
        if (!isRecord(parsed) || parsed.schemaVersion !== TOMBSTONE_SCHEMA_VERSION
            || !Array.isArray(parsed.deletedSessionIds)
            || parsed.deletedSessionIds.length > 100_000
            || !parsed.deletedSessionIds.every(isSafeSessionId)
            || new Set(parsed.deletedSessionIds).size !== parsed.deletedSessionIds.length) {
            throw new ConversationStoreError('STORE_CORRUPT', 'store_tombstone_invalid');
        }
        return new Set(parsed.deletedSessionIds);
    }

    /** Publish tombstones before the new manifest pointer; an interrupted write remains fenced. */
    private async writeTombstoneIds(ids: ReadonlySet<string>): Promise<void> {
        const path = join(this.root, TOMBSTONE_FILE);
        if (!ids.size) {
            // An empty set is a real committed state.  Removing a stale
            // sidecar is required when a failed permanent delete rolls back
            // to a manifest that had no tombstones.
            try { await unlink(path); } catch (error) {
                if (!this.isNotFound(error)) throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_tombstone_cleanup_failed', { cause: error });
            }
            return;
        }
        const values = [...ids].sort();
        const content = jsonString({ schemaVersion: TOMBSTONE_SCHEMA_VERSION, deletedSessionIds: values }, 'Conversation deletion records');
        if (byteLength(content) > TOMBSTONE_MAX_BYTES) {
            throw new ConversationStoreError('TOO_LARGE', 'store_tombstone_limit');
        }
        try { await this.assertSafeFile(path, true); }
        catch (error) { if (!this.isNotFound(error)) throw error; }
        await this.atomicWrite(`${path}.tmp-${randomUUID()}`, path, content);
    }

    private async removeCommitIntent(generation: string): Promise<void> {
        try { await unlink(this.commitIntentPath(generation)); }
        catch (error) { if (!this.isNotFound(error)) throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_intent_cleanup_failed', { cause: error }); }
    }

    private parseCommitIntent(value: unknown): ConversationCommitIntent | undefined {
        if (!isRecord(value) || value.schemaVersion !== COMMIT_INTENT_SCHEMA_VERSION
            || !(value.baseGeneration === null || isSafeGeneration(value.baseGeneration))) return undefined;
        const parsed = parseManifest(value.manifest);
        if (!parsed || parsed.legacy || parsed.manifest.generation === value.baseGeneration) return undefined;
        return { schemaVersion: COMMIT_INTENT_SCHEMA_VERSION, baseGeneration: value.baseGeneration, manifest: parsed.manifest };
    }

    private blockRecoveryIntent(generation: string): void {
        if (isSafeGeneration(generation)) this.blockedRecoveryIntents.add(`.conversation-store-intent-${generation}.json`);
    }

    private async clearBlockedRecoveryIntents(): Promise<void> {
        if (!this.blockedRecoveryIntents.size) return;
        for (const name of this.blockedRecoveryIntents) {
            try { await unlink(join(this.root, name)); } catch (error) {
                if (!this.isNotFound(error)) continue;
            }
            this.blockedRecoveryIntents.delete(name);
        }
    }

    /**
     * Recover only an intent whose base manifest is still current and whose
     * every immutable payload validates. A changed generation, tombstone,
     * malformed intent, missing body, or conflicting body remains pending and
     * is reported to the caller instead of being guessed or deleted.
     */
    private async recoverPendingCommitIntents(): Promise<void> {
        if (this.recoveringIntents) return;
        this.recoveringIntents = true;
        this.pendingRecoveryIntents = [];
        try {
            await this.ensureSafeRoot();
            let names: string[];
            try { names = (await readdir(this.root)).filter(name => COMMIT_INTENT_PATTERN.test(name)).sort(); }
            catch { return; }
            if (!names.length) return;
            let current: ConversationManifest | undefined;
            try { current = await this.readReusableManifest(); }
            catch {
                this.pendingRecoveryIntents.push(...names);
                return;
            }
            let currentGeneration = current?.generation ?? null;
            let deleted = new Set(current?.deletedSessionIds || []);
            for (const name of names) {
                if (this.blockedRecoveryIntents.has(name)) {
                    this.pendingRecoveryIntents.push(name);
                    continue;
                }
                const intentPath = join(this.root, name);
                let intent: ConversationCommitIntent | undefined;
                try {
                    const info = await lstat(intentPath);
                    if (!info.isFile() || info.isSymbolicLink() || info.size > COMMIT_INTENT_MAX_BYTES) throw new Error('unsafe intent');
                    intent = this.parseCommitIntent(JSON.parse(await this.readFile(intentPath, 'utf8')));
                } catch { intent = undefined; }
                if (!intent) { this.pendingRecoveryIntents.push(name); continue; }
                const targetGeneration = intent.manifest.generation;
                if (currentGeneration === targetGeneration) {
                    try { await this.removeCommitIntent(targetGeneration); } catch { this.pendingRecoveryIntents.push(name); }
                    continue;
                }
                if (currentGeneration !== intent.baseGeneration) { this.pendingRecoveryIntents.push(name); continue; }
                const expanded = await this.expandManifest(intent.manifest).catch(() => undefined);
                if (!expanded || expanded.sessions.some(entry => deleted.has(entry.id))) {
                    this.pendingRecoveryIntents.push(name); continue;
                }
                let complete = true;
                for (const entry of expanded.sessions) {
                    try { await this.readManifestSession(entry); }
                    catch { complete = false; break; }
                }
                if (!complete) { this.pendingRecoveryIntents.push(name); continue; }
                try {
                    // The tombstone sidecar is part of the recovery boundary.
                    // Re-publish it before the recovered manifest so a later
                    // manifest loss cannot resurrect a permanently deleted ID.
                    await this.writeTombstoneIds(new Set(intent.manifest.deletedSessionIds || []));
                    await this.writeManifest(intent.manifest);
                    await this.removeCommitIntent(targetGeneration);
                    current = intent.manifest;
                    currentGeneration = targetGeneration;
                    deleted = new Set(intent.manifest.deletedSessionIds || []);
                } catch {
                    this.pendingRecoveryIntents.push(name);
                }
            }
        } finally {
            this.recoveringIntents = false;
        }
    }

    /**
     * Read the manifest pointer without expanding content-addressed shards
     * when a caller only needs the SQLite generation/deleted-id metadata.
     * Indexed sidebar queries use this lazy mode; body reads and write paths
     * keep the existing expanded behaviour.
     */
    private async readReusableManifest(expandShards = true): Promise<ConversationManifest | undefined> {
        if (!this.recoveringIntents) await this.recoverPendingCommitIntents();
        const path = join(this.root, MANIFEST_FILE);
        let manifestLocated = false;
        try {
            await this.assertSafeFile(path, true);
            manifestLocated = true;
            const info = await lstat(path);
            const signature = `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
            if (this.manifestCache?.signature === signature) {
                const cached = this.manifestCache.manifest;
                await this.verifyChangedManifestShards(cached, signature);
                if (!expandShards || !cached.shardFiles?.length) return cached;
                return this.expandManifest(cached);
            }
            const raw = await this.readFile(path, 'utf8');
            let parsed: unknown;
            try { parsed = JSON.parse(raw); }
            catch (error) {
                if (byteLength(raw) > CONVERSATION_MANIFEST_MAX_BYTES) {
                    throw new ConversationStoreError('TOO_LARGE', 'store_index_invalid_too_large', { cause: error });
                }
                throw new ConversationStoreError('STORE_CORRUPT', 'store_index_corrupt_recover', { cause: error });
            }
            const result = parseManifest(parsed);
            if (!result) throw new ConversationStoreError('STORE_CORRUPT', 'store_index_corrupt_recover');
            // Legacy manifests are inline and must still be migrated. Sharded
            // manifests stay as a small pointer in lazy mode so list/search do
            // not parse every shard before consulting the derived index.
            if (result.legacy) {
                // A legacy manifest may itself point at shards: migrate its complete content, never the empty pointer,
                // whichever entry point (list, read, load) reads it first (audit B17-01).
                const complete = await this.expandManifest(result.manifest);
                await this.migrateManifest(raw, complete);
                this.manifestCache = undefined;
                // The sessions are inline now; the old shards may already be collected.
                const { shardFiles: _migratedShards, ...inline } = complete;
                return inline;
            }
            const manifest = expandShards ? await this.expandManifest(result.manifest) : result.manifest;
            this.manifestCache = { signature, manifest: result.manifest };
            await this.captureManifestShardSignatures(result.manifest, signature);
            return manifest;
        } catch (error) {
            if (this.isNotFound(error) && !manifestLocated) return undefined;
            if (error instanceof ConversationStoreError) throw error;
            throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_index_read_failed', { cause: error });
        }
    }

    /**
     * Record shard metadata without reading shard bodies on the first lazy
     * query. If a shard changes while the pointer/generation stays the same,
     * read it once and verify its filename hash before the index is reused.
     */
    private async captureManifestShardSignatures(manifest: ConversationManifest, manifestSignature: string): Promise<void> {
        if (!manifest.shardFiles?.length) {
            this.manifestShardSignatures = undefined;
            return;
        }
        const values = new Map<string, string>();
        for (const shard of manifest.shardFiles) {
            const path = this.safeManifestShardPath(shard);
            try {
                await this.assertSafeFile(path, false);
                const info = await lstat(path);
                values.set(shard, `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`);
            } catch (error) {
                if (error instanceof ConversationStoreError) throw error;
                throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_shard_access_failed', { cause: error });
            }
        }
        this.manifestShardSignatures = { manifestSignature, values };
    }

    private async verifyChangedManifestShards(manifest: ConversationManifest, manifestSignature: string): Promise<void> {
        if (!manifest.shardFiles?.length) {
            this.manifestShardSignatures = undefined;
            return;
        }
        const previous = this.manifestShardSignatures?.manifestSignature === manifestSignature
            ? this.manifestShardSignatures.values : new Map<string, string>();
        const current = new Map<string, string>();
        for (const shard of manifest.shardFiles) {
            const path = this.safeManifestShardPath(shard);
            let info;
            try {
                await this.assertSafeFile(path, false);
                info = await lstat(path);
            } catch (error) {
                if (error instanceof ConversationStoreError && error.code === 'STORE_UNAVAILABLE') {
                    throw new ConversationStoreError('STORE_CORRUPT', 'store_shard_missing', { cause: error });
                }
                throw error;
            }
            const signature = `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
            if (previous.get(shard) !== signature) {
                const raw = await this.readFile(path, 'utf8');
                if (shard !== `manifest-v1-shard-${createHash('sha256').update(raw).digest('hex')}.json`) {
                    throw new ConversationStoreError('STORE_CORRUPT', 'store_shard_integrity_failed');
                }
            }
            current.set(shard, signature);
        }
        this.manifestShardSignatures = { manifestSignature, values: current };
    }

    private async reusableSessionFile(entry: ConversationManifestEntry, expectedBytes: number): Promise<string | undefined> {
        const path = this.safeChildPath(entry.file);
        try {
            const metadata = await lstat(path);
            return !metadata.isSymbolicLink() && metadata.isFile() && metadata.size === expectedBytes ? entry.file : undefined;
        } catch (error) {
            if (this.isNotFound(error)) return undefined;
            throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_payload_verification_failed', { cause: error });
        }
    }

    private async completeManifestEntry(entry: ConversationManifestEntry): Promise<ConversationManifestEntry> {
        if (entry.sha256 !== undefined && entry.bytes !== undefined) return entry;
        const path = this.safeChildPath(entry.file);
        try {
            await this.assertSafeFile(path, false);
            const raw = await this.readFile(path, 'utf8');
            const bytes = byteLength(raw);
            if (bytes > CONVERSATION_SESSION_MAX_BYTES) throw new ConversationStoreError('TOO_LARGE', 'store_payload_limit');
            const parsed: unknown = JSON.parse(raw);
            if (!this.isValidSession(parsed) || parsed.id !== entry.id) {
                throw new ConversationStoreError('STORE_CORRUPT', 'store_payload_index_mismatch');
            }
            return {
                ...entry,
                sha256: createHash('sha256').update(raw).digest('hex'),
                bytes
            };
        } catch (error) {
            if (error instanceof ConversationStoreError) throw error;
            throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_legacy_read_failed', { cause: error });
        }
    }

    private async readManifestSession(entry: ConversationManifestEntry): Promise<StoredSession> {
        const path = this.safeChildPath(entry.file);
        await this.assertSafeFile(path, true);
        const info = await lstat(path);
        if (info.size > CONVERSATION_SESSION_MAX_BYTES) {
            throw new ConversationStoreError('TOO_LARGE', 'store_payload_limit_preserved');
        }
        const raw = await this.readFile(path, 'utf8');
        const bytes = byteLength(raw);
        let session: unknown;
        try { session = JSON.parse(raw); }
        catch { throw new ConversationStoreError('STORE_CORRUPT', 'store_content_corrupt_preserved'); }
        if (!this.isValidSession(session) || session.id !== entry.id || session.workspacePath !== entry.workspacePath
            || session.title !== entry.title || session.createdAt !== entry.createdAt || session.updatedAt !== entry.updatedAt
            || entry.bytes !== undefined && entry.bytes !== bytes
            || entry.sha256 !== undefined && entry.sha256 !== createHash('sha256').update(raw).digest('hex')) {
            throw new ConversationStoreError('STORE_CORRUPT', 'store_content_index_mismatch_preserved');
        }
        return session;
    }

    private async expandManifest(manifest: ConversationManifest): Promise<ConversationManifest> {
        if (!manifest.shardFiles?.length) return manifest;
        const sessions: ConversationManifestEntry[] = [];
        const ids = new Set<string>();
        const files = new Set<string>();
        const deletedIds = new Set(manifest.deletedSessionIds || []);
        for (const shard of manifest.shardFiles) {
            const path = this.safeManifestShardPath(shard);
            await this.assertSafeFile(path, false);
            const raw = await this.readFile(path, 'utf8');
            if (shard !== `manifest-v1-shard-${createHash('sha256').update(raw).digest('hex')}.json`) {
                throw new ConversationStoreError('STORE_CORRUPT', 'store_shard_integrity_failed');
            }
            let parsed: unknown;
            try { parsed = JSON.parse(raw); }
            catch (error) { throw new ConversationStoreError('STORE_CORRUPT', 'store_shard_corrupt', { cause: error }); }
            if (!isRecord(parsed) || !Array.isArray(parsed.sessions) || parsed.sessions.length > MANIFEST_SHARD_MAX_ENTRIES
                || !parsed.sessions.every(isValidManifestEntry)) {
                throw new ConversationStoreError('STORE_CORRUPT', 'store_shard_invalid');
            }
            for (const entry of parsed.sessions) {
                if (ids.has(entry.id) || files.has(entry.file)) throw new ConversationStoreError('STORE_CORRUPT', 'store_shard_duplicate');
                if (deletedIds.has(entry.id)) throw new ConversationStoreError('STORE_CORRUPT', 'store_shard_tombstone_conflict');
                ids.add(entry.id); files.add(entry.file); sessions.push(entry);
            }
        }
        sessions.sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
        return { ...manifest, sessions };
    }

    private async writeManifest(manifest: ConversationManifest): Promise<void> {
        // Keep the established inline format for ordinary histories. This
        // preserves simple recovery/debugging and old readers, while large
        // histories switch to content-addressed shards below so the pointer
        // itself never grows with the number of conversations.
        const { shardFiles: _previousShards, ...inlineManifest } = manifest;
        const inlineContent = jsonString(inlineManifest, 'Conversation index');
        const pointerTarget = join(this.root, MANIFEST_FILE);
        if (byteLength(inlineContent) <= CONVERSATION_MANIFEST_MAX_BYTES) {
            await this.atomicWrite(`${pointerTarget}.tmp-${randomUUID()}`, pointerTarget, inlineContent);
            await this.removeUnreferencedManifestShards(new Set());
            this.manifestCache = undefined;
            return;
        }
        const chunks: ConversationManifestEntry[][] = [];
        for (let offset = 0; offset < manifest.sessions.length; offset += MANIFEST_SHARD_MAX_ENTRIES) {
            chunks.push(manifest.sessions.slice(offset, offset + MANIFEST_SHARD_MAX_ENTRIES) as ConversationManifestEntry[]);
        }
        const shardFiles: string[] = [];
        for (const entries of chunks) {
            const content = jsonString({ sessions: entries }, 'Conversation index shard');
            const shard = `manifest-v1-shard-${createHash('sha256').update(content).digest('hex')}.json`;
            shardFiles.push(shard);
            const target = this.safeManifestShardPath(shard);
            try {
                await this.assertSafeFile(target, true);
                if (await this.readFile(target, 'utf8') !== content) {
                    throw new ConversationStoreError('STORE_CORRUPT', 'store_shard_integrity_failed');
                }
            }
            catch (error) {
                if (!this.isNotFound(error)) throw error;
                await this.atomicWrite(`${target}.tmp-${randomUUID()}`, target, content);
            }
        }
        const pointer: ConversationManifest = { ...manifest, sessions: [], shardFiles };
        const target = join(this.root, MANIFEST_FILE);
        await this.atomicWrite(`${target}.tmp-${randomUUID()}`, target, jsonString(pointer, 'Conversation index'));
        await this.removeUnreferencedManifestShards(new Set(shardFiles));
        this.manifestCache = undefined;
    }

    private async removeUnreferencedManifestShards(referenced: ReadonlySet<string>): Promise<void> {
        const protectedShards = new Set(referenced);
        let intentNames: string[] = [];
        try { intentNames = (await readdir(this.root)).filter(name => COMMIT_INTENT_PATTERN.test(name)); }
        catch { return; }
        for (const name of intentNames) {
            try {
                const info = await lstat(join(this.root, name));
                if (!info.isFile() || info.isSymbolicLink() || info.size > COMMIT_INTENT_MAX_BYTES) return;
                const intent = this.parseCommitIntent(JSON.parse(await this.readFile(join(this.root, name), 'utf8')));
                if (!intent) return;
                for (const shard of intent.manifest.shardFiles || []) protectedShards.add(shard);
            } catch { return; }
        }
        let names: string[];
        try { names = await readdir(this.root); }
        catch { return; }
        for (const name of names) {
            if (!MANIFEST_SHARD_PATTERN.test(name) || protectedShards.has(name)) continue;
            try { await unlink(this.safeManifestShardPath(name)); }
            catch (error) { if (!this.isNotFound(error)) throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_legacy_shard_cleanup_failed', { cause: error }); }
        }
    }

    private async openIndex(): Promise<ConversationIndex> {
        const path = join(this.root, INDEX_FILE);
        try { await this.assertSafeFile(path, true); }
        catch (error) { if (!this.isNotFound(error)) throw error; }
        try {
            const index = new ConversationIndex(path);
            try { await chmod(path, 0o600); } catch (error) { index.close(); throw error; }
            return index;
        }
        catch (error) {
            // Only the derived database is moved. A broken search index never deletes source payloads.
            if (!String((error as { code?: string })?.code || '').startsWith('ERR_SQLITE')) throw error;
            await this.quarantine(path);
            // SQLite WAL and shared-memory files are part of the same
            // persistent database state. Leaving either beside a freshly
            // created index can replay stale pages or make recovery depend
            // on an orphaned checkpoint. Move both sidecars with the broken
            // derived index; authoritative conversation JSON is untouched.
            await this.quarantine(`${path}-wal`);
            await this.quarantine(`${path}-shm`);
            return new ConversationIndex(path);
        }
    }

    private async withIndexedHistory<T>(operation: (index: ConversationIndex, manifest: ConversationManifest) => Promise<T>): Promise<T> {
        const pending = this.writeQueue.then(() => this.withProcessWriteLock(async () => {
            await this.ensureSafeRoot();
            const durableDeletedIds = await this.readTombstoneIds();
            // The derived index is the query path. Keep sharded manifests lazy
            // unless its generation changed and a complete rebuild is needed.
            let manifest = await this.readReusableManifest(false);
            if (!manifest) {
                if (this.pendingRecoveryIntents.length) {
                    throw new ConversationStoreError('STORE_CORRUPT', 'store_intent_recovery_pending');
                }
                const oldManifestPath = join(this.root, MANIFEST_FILE);
                try { await this.assertSafeFile(oldManifestPath, true); await this.quarantine(oldManifestPath); }
                catch (error) { if (!this.isNotFound(error)) throw error; }
                const recovered = await this.scanUnindexedSessions('empty');
                // Rebuild a manifest without deleting any unindexed payloads. A previous interrupted
                // write can leave other valid generations needed for recovery.
                const generation = randomUUID();
                const entries: ConversationManifestEntry[] = [];
                for (const candidate of recovered.sessions) {
                    if (!this.isValidSession(candidate) || durableDeletedIds.has(candidate.id)) continue;
                    const content = jsonString(candidate, 'Conversation');
                    const file = sessionFileName(candidate.id, generation);
                    const path = this.safeChildPath(file);
                    await this.atomicWrite(`${path}.tmp-${randomUUID()}`, path, content);
                    entries.push({ id: candidate.id, file, workspacePath: candidate.workspacePath, title: candidate.title,
                        ...(candidate.titleOrigin === 'default' || candidate.titleOrigin === 'draft' || candidate.titleOrigin === 'recoveredDraft' ? { titleOrigin: candidate.titleOrigin } : {}),
                        createdAt: candidate.createdAt, updatedAt: candidate.updatedAt,
                        sha256: createHash('sha256').update(content).digest('hex'), bytes: byteLength(content) });
                }
                manifest = { schemaVersion: CONVERSATION_STORE_SCHEMA_VERSION, createdByVersion: CONVERSATION_STORE_WRITER_VERSION,
                    minimumReaderVersion: CONVERSATION_STORE_READER_VERSION, generation,
                    ...(durableDeletedIds.size ? { deletedSessionIds: [...durableDeletedIds] } : {}), sessions: entries };
                await this.writeManifest(manifest);
            }
            if (manifest.sessions.some(entry => durableDeletedIds.has(entry.id))) {
                throw new ConversationStoreError('STORE_CORRUPT', 'store_index_tombstone_conflict');
            }
            if (durableDeletedIds.size) {
                const allDeleted = new Set([...(manifest.deletedSessionIds || []), ...durableDeletedIds]);
                manifest = { ...manifest, deletedSessionIds: [...allDeleted] };
            }
            const current = manifest;
            const run = async (index: ConversationIndex): Promise<T> => {
                if (index.generation() !== current.generation) {
                    const expandedManifest = await this.expandManifest(current);
                    index.begin(true);
                    let partial = false;
                    try {
                        for (const entry of expandedManifest.sessions) {
                            try { index.upsert(await this.readManifestSession(entry)); }
                            catch (error) {
                                if (!(error instanceof ConversationStoreError && error.code === 'STORE_CORRUPT') && !this.isNotFound(error)) throw error;
                                partial = true;
                            }
                        }
                        index.commit(expandedManifest.generation, partial ? 'partial' : 'ok');
                    } catch (error) { index.rollback(); throw error; }
                }
                return await operation(index, current);
            };
            let index = await this.openIndex();
            try {
                return await run(index);
            } catch (error) {
                // The index is derived data. Damage found while querying it (a malformed page, an unreadable summary)
                // moves it aside and rebuilds it from the conversation files, as damage found on opening does (audit B04-03).
                const code = String((error as { code?: string })?.code || '');
                if (!code.startsWith('ERR_SQLITE') && !(error instanceof SyntaxError)) throw error;
                index.close();
                const path = join(this.root, INDEX_FILE);
                for (const file of [path, `${path}-wal`, `${path}-shm`]) await this.quarantine(file);
                index = await this.openIndex();
                return await run(index);
            } finally { index.close(); }
        }));
        this.writeQueue = pending.then(() => undefined, () => undefined);
        return pending;
    }

    private async updateIndexAfterCommit(previous: ConversationManifest | undefined, next: ConversationManifest, sessions: readonly StoredSession[]): Promise<void> {
        let index: ConversationIndex | undefined;
        try {
            index = await this.openIndex();
            if (previous && index.generation() !== previous.generation) return; // Lazily rebuild an outdated/missing index.
            index.begin(!previous);
            try {
                const nextIds = new Set(next.sessions.map(entry => entry.id));
                for (const entry of previous?.sessions || []) if (!nextIds.has(entry.id)) index.remove(entry.id);
                for (const session of sessions) index.upsert(session);
                index.commit(next.generation);
            } catch (error) { index.rollback(); throw error; }
        } catch {
            // The committed JSON is authoritative. A failed derived index update is rebuilt on query.
        } finally { index?.close(); }
    }

    /**
     * Serialize writes across desktop processes, not only calls in one JS
     * instance. proper-lockfile uses an atomic mkdir and heartbeat; a killed
     * process leaves a stale lock that another process can safely reclaim.
     */
    private async withProcessWriteLock<T>(operation: () => Promise<T>): Promise<T> {
        const previous = PROCESS_WRITE_QUEUES.get(this.root) ?? Promise.resolve();
        const run = previous.then(() => this.withProcessWriteLockUnqueued(operation), () => this.withProcessWriteLockUnqueued(operation));
        const tail = run.then(() => undefined, () => undefined);
        PROCESS_WRITE_QUEUES.set(this.root, tail);
        try { return await run; }
        finally {
            if (PROCESS_WRITE_QUEUES.get(this.root) === tail) PROCESS_WRITE_QUEUES.delete(this.root);
        }
    }

    private async withProcessWriteLockUnqueued<T>(operation: () => Promise<T>): Promise<T> {
        await this.ensureSafeRoot();
        let release: (() => Promise<void>) | undefined;
        let compromised: Error | undefined;
        const lockIsValid = () => compromised === undefined;
        try {
            release = await processLockfile.lock(this.root, {
                lockfilePath: join(this.root, PROCESS_LOCK_PATH),
                realpath: false,
                stale: 30_000,
                update: 10_000,
                retries: { retries: 240, minTimeout: 10, maxTimeout: 250 },
                onCompromised: (error: Error) => { compromised = error; }
            });
            this.activeWriteLockValid = lockIsValid;
            const value = await operation();
            if (compromised) throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_write_lock_lost', { cause: compromised });
            return value;
        } catch (error) {
            if (error instanceof ConversationStoreError) throw error;
            // Archive binding and archive validation errors are deliberate
            // user-facing domain results raised inside the write transaction.
            // Preserve their stable code; only lock/filesystem failures are
            // normalized to STORE_UNAVAILABLE here.
            if (error && typeof error === 'object' && typeof (error as { readonly code?: unknown }).code === 'string'
                && (error as { readonly code: string }).code.startsWith('ARCHIVE_')) throw error;
            throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_write_lock_unavailable', { cause: error });
        } finally {
            if (this.activeWriteLockValid === lockIsValid) this.activeWriteLockValid = undefined;
            if (release) {
                try { await release(); }
                catch (error) { /* Commit already published; next process can reclaim stale lock. */ }
            }
        }
    }

    private async atomicWrite(temporary: string, target: string, content: string): Promise<void> {
        try {
            if (this.activeWriteLockValid && !this.activeWriteLockValid()) {
                throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_write_lock_lost');
            }
            await this.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
            const handle = await open(temporary, 'r+');
            try { await handle.sync(); } finally { await handle.close(); }
            if (this.activeWriteLockValid && !this.activeWriteLockValid()) {
                throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_write_lock_lost');
            }
            await rename(temporary, target);
            // All payload files are fsynced above. Publishing the manifest flushes the directory
            // once for the entire transaction, including those payload renames; syncing it for
            // every imported conversation adds thousands of unnecessary blocking disk flushes.
            if (process.platform !== 'win32' && !SESSION_FILE_PATTERN.test(target.split(/[\\/]/).pop() || '')) {
                const directory = await open(this.root, 'r');
                try { await directory.sync(); } finally { await directory.close(); }
            }
        } catch (error) {
            try { await unlink(temporary); } catch {}
            throw error;
        }
    }

    private async manifestGenerationPublished(generation: string): Promise<boolean> {
        // A directory fsync can fail after rename has already published the new manifest.
        // Such an error must never trigger deletion of the payloads it now references.
        try { return JSON.parse(await this.readFile(join(this.root, MANIFEST_FILE), 'utf8')).generation === generation; }
        catch { return false; }
    }

    private async migrateManifest(rawLegacyManifest: string, manifest: ConversationManifest): Promise<void> {
        const backup = join(this.root, LEGACY_MANIFEST_BACKUP_FILE);
        try {
            // Another process may have published a newer generation while the
            // reader was validating this legacy snapshot. Never overwrite it.
            if (await this.readFile(join(this.root, MANIFEST_FILE), 'utf8') !== rawLegacyManifest) return;
            try {
                await this.assertSafeFile(backup, true);
            } catch (error) {
                if (!this.isNotFound(error)) throw error;
                // Keep a self-contained migration manifest: its old shards
                // may be collected after the new pointer is published.
                const backupContent = manifest.shardFiles?.length
                    ? jsonString({ ...JSON.parse(rawLegacyManifest), sessions: manifest.sessions, shardFiles: undefined }, 'Legacy conversation index backup')
                    : rawLegacyManifest;
                await this.atomicWrite(`${backup}.tmp-${randomUUID()}`, backup, backupContent);
            }
            await this.writeManifest(manifest);
        } catch (error) {
            throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_index_upgrade_failed', { cause: error });
        }
    }

    private async removeLegacyManifestBackup(): Promise<void> {
        try {
            await unlink(join(this.root, LEGACY_MANIFEST_BACKUP_FILE));
        } catch (error) {
            if (!this.isNotFound(error)) {
                throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_legacy_backup_cleanup_failed', { cause: error });
            }
        }
    }

    private async removeUnreferencedSessionFiles(referenced: ReadonlySet<string>): Promise<void> {
        const protectedFiles = new Set(referenced);
        let intentNames: string[] = [];
        try { intentNames = (await readdir(this.root)).filter(name => COMMIT_INTENT_PATTERN.test(name)); }
        catch { return; }
        // If any pending intent is malformed, retain all unreferenced bodies;
        // deleting them would defeat explicit crash recovery.
        for (const name of intentNames) {
            try {
                const info = await lstat(join(this.root, name));
                if (!info.isFile() || info.isSymbolicLink() || info.size > COMMIT_INTENT_MAX_BYTES) return;
                const intent = this.parseCommitIntent(JSON.parse(await this.readFile(join(this.root, name), 'utf8')));
                if (!intent) return;
                const expanded = await this.expandManifest(intent.manifest);
                for (const entry of expanded.sessions) protectedFiles.add(entry.file);
            } catch { return; }
        }
        let names: string[];
        try {
            names = await readdir(this.root);
        } catch {
            return;
        }
        for (const name of names) {
            if (!SESSION_FILE_PATTERN.test(name) || protectedFiles.has(name)) continue;
            try { await unlink(this.safeChildPath(name)); } catch {}
        }
    }

    private async removeSessionFiles(files: readonly string[], strict = false): Promise<void> {
        for (const file of files) {
            try { await this.unlinkFile(this.safeChildPath(file)); } catch (error) {
                if (strict && !this.isNotFound(error)) throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_removed_cleanup_failed', { cause: error });
            }
        }
    }

    private async scanUnindexedSessions(status: 'empty' | 'partial'): Promise<ConversationStoreLoadResult> {
        let names: string[];
        try {
            names = await readdir(this.root);
        } catch (error) {
            if (this.isNotFound(error)) return { sessions: [], status: 'empty' };
            throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_directory_read_failed', { cause: error });
        }
        const sessions = new Map<string, { readonly value: StoredSession; readonly content: string }>();
        const conflicts = new Set<string>();
        let partial = status === 'partial';
        for (const name of names.filter(candidate => SESSION_FILE_PATTERN.test(candidate))) {
            const path = this.safeChildPath(name);
            try {
                await this.assertSafeFile(path, false);
                const raw = await this.readFile(path, 'utf8');
                const bytes = byteLength(raw);
                if (bytes > CONVERSATION_SESSION_MAX_BYTES) {
                    throw new ConversationStoreError('TOO_LARGE', 'store_payload_limit');
                }
                const parsed = JSON.parse(raw);
                if (!this.isValidSession(parsed)) throw new ConversationStoreError('STORE_CORRUPT', 'store_payload_format_invalid');
                const existing = sessions.get(parsed.id);
                if (!existing || parsed.updatedAt > existing.value.updatedAt) {
                    sessions.set(parsed.id, { value: parsed, content: jsonString(parsed, 'Conversation') });
                    conflicts.delete(parsed.id);
                } else if (parsed.updatedAt === existing.value.updatedAt && jsonString(parsed, 'Conversation') !== existing.content) {
                    conflicts.add(parsed.id);
                }
            } catch {
                partial = true;
                await this.quarantine(path);
            }
        }
        // A timestamp is not a revision. Equal-time generations may contain
        // different completed turns; choosing by directory order can hide the
        // only complete copy. Keep every valid generation until the conflict
        // is resolved instead of quarantining one as if it were corrupt.
        if (conflicts.size) {
            throw new ConversationStoreError('STORE_CORRUPT', 'store_recovery_conflict');
        }
        const values = [...sessions.values()].map(entry => entry.value)
            .sort((left, right) => right.updatedAt - left.updatedAt);
        return { sessions: values, status: partial ? 'partial' : values.length ? 'ok' : 'empty' };
    }

    private async quarantine(path: string): Promise<void> {
        try {
            await lstat(path);
        } catch {
            return;
        }
        await this.ensureSafeCorruptRoot();
        const name = path.split(/[\\/]/).pop() || 'unknown';
        const target = join(this.corruptRoot, `${name}.corrupt-${randomUUID()}`);
        try {
            await rename(path, target);
        } catch (error) {
            throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_quarantine_failed', { cause: error });
        }
    }

    private async ensureSafeCorruptRoot(): Promise<void> {
        try {
            await mkdir(this.corruptRoot, { recursive: true, mode: 0o700 });
        } catch (error) {
            if (!error || typeof error !== 'object' || (error as NodeJS.ErrnoException).code !== 'EEXIST') {
                throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_quarantine_create_failed', { cause: error });
            }
        }
        const metadata = await lstat(this.corruptRoot);
        if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
            throw new ConversationStoreError('STORE_UNSAFE', 'store_quarantine_unsafe');
        }
    }

    private async removeCorruptPayloads(): Promise<void> {
        try {
            const metadata = await lstat(this.corruptRoot);
            if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
                throw new ConversationStoreError('STORE_UNSAFE', 'store_quarantine_cleanup_unsafe');
            }
            await rm(this.corruptRoot, { recursive: true, force: true });
        } catch (error) {
            if (this.isNotFound(error)) return;
            if (error instanceof ConversationStoreError) throw error;
            throw new ConversationStoreError('STORE_UNAVAILABLE', 'store_quarantine_cleanup_failed', { cause: error });
        }
    }

    private isNotFound(error: unknown): boolean {
        return Boolean(error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT');
    }
}
