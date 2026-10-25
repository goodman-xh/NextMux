import { createHash, randomUUID } from 'crypto';
import { constants } from 'fs';
import { access, lstat, mkdir, open, readdir, realpath, rename, unlink } from 'fs/promises';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
    EDITOR_RECOVERY_MAX_BYTES, EDITOR_RECOVERY_MAX_COUNT, EDITOR_RECOVERY_TOTAL_BYTES,
    EditorDraftRecoveryAck, EditorDraftRecoveryDiscardRequest, EditorDraftRecoveryErrorCode,
    EditorDraftRecoveryOpenResult, EditorDraftRecoveryRequest, EditorDraftRecoverySaveRequest,
    EditorDraftRecoverySnapshot, EditorDraftRecoverySource, EditorDraftRecoveryState
} from '../common/nextmux-editor-draft-recovery';

type ShortCode = EditorDraftRecoveryErrorCode extends `EDITOR_RECOVERY_${infer Reason}` ? Reason : never;
export class EditorDraftRecoveryError extends Error {
    readonly code: EditorDraftRecoveryErrorCode;
    constructor(code: EditorDraftRecoveryErrorCode | ShortCode) {
        const normalized = (code.startsWith('EDITOR_RECOVERY_') ? code : `EDITOR_RECOVERY_${code}`) as EditorDraftRecoveryErrorCode;
        super(normalized); this.code = normalized; this.name = 'EditorDraftRecoveryError';
    }
}
export interface EditorRecoveryPolicy { readonly enabled: boolean; readonly revision: number; }
type PolicyReader = () => Promise<EditorRecoveryPolicy>;
interface Identity { readonly dev: number; readonly ino: number; }
interface SourceEvidence extends Identity { readonly realPath: string; readonly baselineSha256: string; }
interface StoredRecovery {
    readonly version: 1;
    readonly id: string;
    readonly revision: number;
    readonly mutationId: string;
    readonly expectedRevision: number;
    readonly refreshSourceBaseline: boolean;
    readonly snapshotSha256: string;
    readonly updatedAt: string;
    readonly snapshot: EditorDraftRecoverySnapshot;
    readonly source: EditorDraftRecoverySource;
    readonly evidence?: SourceEvidence;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
function fail(code: EditorDraftRecoveryErrorCode | ShortCode): never { throw new EditorDraftRecoveryError(code); }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
function shape(value: unknown, fields: readonly string[]): asserts value is Record<string, unknown> {
    if (!object(value) || Object.keys(value).some(key => !fields.includes(key))) fail('CORRUPT');
}
function text(value: unknown, maximum: number, empty = false): asserts value is string {
    if (typeof value !== 'string' || value.length > maximum || (!empty && !value.length)) fail('CORRUPT');
}
function body(value: unknown): asserts value is string {
    if (typeof value !== 'string') fail('CORRUPT');
    if (value.length > EDITOR_RECOVERY_MAX_BYTES) fail('TOO_LARGE');
}
function assertId(value: unknown): asserts value is string { if (typeof value !== 'string' || !uuid.test(value)) fail('CORRUPT'); }
function revision(value: unknown, zero = false): asserts value is number {
    if (!Number.isSafeInteger(value) || Number(value) < (zero ? 0 : 1)) fail('CORRUPT');
}
function normalizeSnapshot(input: unknown): EditorDraftRecoverySnapshot {
    shape(input, ['sessionId', 'sourceUri', 'name', 'baseline', 'drafts']);
    text(input.sourceUri, 8192); text(input.name, 1024);
    if (input.sessionId !== undefined) text(input.sessionId, 200);
    // Source labels are never a transport or destination. Reject hidden/control label characters.
    if (/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(input.sourceUri + input.name)) fail('CORRUPT');
    shape(input.baseline, ['current', 'before']); shape(input.drafts, ['current', 'before']);
    body(input.baseline.current);
    for (const side of ['current', 'before'] as const) {
        if (input.drafts[side] !== undefined) body(input.drafts[side]);
    }
    if (input.baseline.before !== undefined) body(input.baseline.before);
    if (input.drafts.before !== undefined && input.baseline.before === undefined) fail('CORRUPT');
    const value: EditorDraftRecoverySnapshot = {
        ...(input.sessionId !== undefined ? { sessionId: input.sessionId as string } : {}),
        sourceUri: input.sourceUri, name: input.name,
        baseline: { current: input.baseline.current, ...(input.baseline.before !== undefined ? { before: input.baseline.before as string } : {}) },
        drafts: { ...(input.drafts.current !== undefined ? { current: input.drafts.current as string } : {}),
            ...(input.drafts.before !== undefined ? { before: input.drafts.before as string } : {}) }
    };
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > EDITOR_RECOVERY_MAX_BYTES) fail('TOO_LARGE');
    return value;
}
function sameIdentity(left: Identity, right: Identity): boolean { return left.dev === right.dev && left.ino === right.ino; }
function usableIdentity(value: Identity): boolean { return Number.isSafeInteger(value.dev) && Number.isSafeInteger(value.ino); }
function source(status: EditorDraftRecoverySource['status']): EditorDraftRecoverySource {
    return { status, canWriteSource: status === 'matching' };
}

/** No source writes, network schemes, URI guessing, or search-by-basename. */
async function inspectSource(snapshot: EditorDraftRecoverySnapshot, previous?: SourceEvidence): Promise<{
    source: EditorDraftRecoverySource; evidence?: SourceEvidence;
}> {
    try {
        const uri = new URL(snapshot.sourceUri);
        if (uri.protocol !== 'file:' || uri.hostname || uri.search || uri.hash
            || (process.platform !== 'win32' && /^\/[a-z]:\//i.test(uri.pathname))) return { source: source('unverified') };
        const target = fileURLToPath(uri);
        const info = await lstat(target);
        if (!info.isFile() || info.isSymbolicLink() || !usableIdentity(info) || info.size > EDITOR_RECOVERY_MAX_BYTES) return { source: source('unverified') };
        const canonical = await realpath(target);
        if (previous && (!sameIdentity(info, previous) || canonical !== previous.realPath)) return { source: source('changed') };
        const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        let bytes: Buffer;
        try {
            const opened = await handle.stat();
            if (!opened.isFile() || !sameIdentity(info, opened) || opened.size !== info.size) return { source: source('unverified') };
            bytes = Buffer.alloc(opened.size);
            let offset = 0;
            while (offset < bytes.length) {
                const next = await handle.read(bytes, offset, bytes.length - offset, offset);
                if (!next.bytesRead) return { source: source('unverified') };
                offset += next.bytesRead;
            }
            const after = await handle.stat();
            if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
                || (await handle.read(Buffer.alloc(1), 0, 1, bytes.length)).bytesRead) return { source: source('unverified') };
        } finally { await handle.close(); }
        const after = await lstat(target);
        if (!sameIdentity(info, after) || after.isSymbolicLink() || await realpath(target) !== canonical) return { source: source('unverified') };
        const baselineSha256 = digest(snapshot.baseline.current);
        if (digest(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) !== baselineSha256
            || (previous && previous.baselineSha256 !== baselineSha256)) return { source: source('changed') };
        const writable = (info.mode & 0o222) !== 0 && await access(target, constants.W_OK).then(() => true, () => false);
        return { source: source(writable ? 'matching' : 'read_only'), evidence: { dev: info.dev, ino: info.ino, realPath: canonical, baselineSha256 } };
    } catch (error) {
        return { source: source((error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'missing' : 'unverified') };
    }
}

/** One queue per canonical data root in ONE backend process, not an OS-level multi-process lock. */
export class EditorDraftRecoveryStore {
    readonly directory: string;
    #tail: Promise<unknown> = Promise.resolve();
    readonly #handles = new Map<string, string>();
    #directoryIdentity: Identity | undefined;
    constructor(readonly dataRoot: string, private readonly rootIdentity: Identity) { this.directory = join(dataRoot, 'file-editor-recovery-v1'); }

    runExclusive<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.#tail.then(operation, operation);
        this.#tail = result.then(() => undefined, () => undefined);
        return result;
    }
    releaseOwner(owner: string): Promise<void> {
        return this.runExclusive(async () => { for (const [id, candidate] of this.#handles) if (candidate === owner) this.#handles.delete(id); });
    }
    async #operation<T>(action: () => Promise<T>): Promise<T> {
        return this.runExclusive(async () => {
            try { return await action(); }
            catch (error) { if (error instanceof EditorDraftRecoveryError) throw error; throw new EditorDraftRecoveryError('UNAVAILABLE'); }
        });
    }
    async #safeDirectory(create = false): Promise<boolean> {
        const root = await lstat(this.dataRoot);
        if (!root.isDirectory() || root.isSymbolicLink() || !sameIdentity(root, this.rootIdentity)
            || await realpath(this.dataRoot) !== this.dataRoot) fail('UNSAFE_PATH');
        if (create) await mkdir(this.directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
        const info = await lstat(this.directory).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
        if (!info) { if (this.#directoryIdentity) fail('UNSAFE_PATH'); return false; }
        if (!info.isDirectory() || info.isSymbolicLink() || await realpath(this.directory) !== this.directory
            || (this.#directoryIdentity && !sameIdentity(info, this.#directoryIdentity))) fail('UNSAFE_PATH');
        this.#directoryIdentity ||= { dev: info.dev, ino: info.ino };
        return true;
    }
    async #read(id: string): Promise<{ value: StoredRecovery; bytes: number } | undefined> {
        if (!await this.#safeDirectory()) return undefined;
        const target = join(this.directory, `${id}.json`);
        const info = await lstat(target).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
        if (!info) return undefined;
        if (!info.isFile() || info.isSymbolicLink()) fail('UNSAFE_PATH');
        if (info.size > EDITOR_RECOVERY_MAX_BYTES) fail('TOO_LARGE');
        const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        let raw: string;
        try {
            const opened = await handle.stat();
            if (!sameIdentity(info, opened) || !opened.isFile() || opened.size !== info.size) fail('UNSAFE_PATH');
            const bytes = Buffer.alloc(opened.size);
            let offset = 0;
            while (offset < bytes.length) {
                const next = await handle.read(bytes, offset, bytes.length - offset, offset);
                if (!next.bytesRead) fail('CORRUPT');
                offset += next.bytesRead;
            }
            const after = await handle.stat();
            if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
                || (await handle.read(Buffer.alloc(1), 0, 1, bytes.length)).bytesRead) fail('CORRUPT');
            try { raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('CORRUPT'); }
        } finally { await handle.close(); }
        await this.#safeDirectory();
        let parsed: unknown; try { parsed = JSON.parse(raw); } catch { fail('CORRUPT'); }
        if (object(parsed) && parsed.version !== undefined && parsed.version !== 1) fail('UNSUPPORTED_VERSION');
        shape(parsed, ['version', 'id', 'revision', 'mutationId', 'expectedRevision', 'refreshSourceBaseline', 'snapshotSha256', 'updatedAt', 'snapshot', 'source', 'evidence']);
        assertId(parsed.id); assertId(parsed.mutationId); revision(parsed.revision); revision(parsed.expectedRevision, true);
        if (parsed.version !== 1 || parsed.id !== id || parsed.revision !== Number(parsed.expectedRevision) + 1 || typeof parsed.refreshSourceBaseline !== 'boolean'
            || typeof parsed.updatedAt !== 'string' || !Number.isFinite(Date.parse(parsed.updatedAt))) fail('CORRUPT');
        const snapshot = normalizeSnapshot(parsed.snapshot);
        if (digest(JSON.stringify(snapshot)) !== parsed.snapshotSha256) fail('CORRUPT');
        shape(parsed.source, ['status', 'canWriteSource']);
        if (!['matching', 'changed', 'missing', 'read_only', 'unverified'].includes(String(parsed.source.status))
            || parsed.source.canWriteSource !== (parsed.source.status === 'matching')) fail('CORRUPT');
        if (parsed.evidence !== undefined) {
            shape(parsed.evidence, ['dev', 'ino', 'realPath', 'baselineSha256']);
            if (!usableIdentity(parsed.evidence as unknown as Identity) || typeof parsed.evidence.realPath !== 'string'
                || !/^[a-f0-9]{64}$/.test(String(parsed.evidence.baselineSha256))) fail('CORRUPT');
        }
        if (parsed.source.status === 'matching' && !parsed.evidence) fail('CORRUPT');
        return { value: { ...parsed, snapshot } as unknown as StoredRecovery, bytes: info.size };
    }
    async #records(): Promise<readonly { value: StoredRecovery; bytes: number }[]> {
        if (!await this.#safeDirectory()) return [];
        const entries = await readdir(this.directory);
        if (entries.length > EDITOR_RECOVERY_MAX_COUNT * 3) fail('QUOTA_EXCEEDED');
        const records: { value: StoredRecovery; bytes: number }[] = [];
        for (const filename of entries) {
            if (/^\.pending-[a-f0-9-]{36}\.tmp$/.test(filename)) continue; // Crash remnants are never mistaken for committed data.
            const id = filename.replace(/\.json$/, '');
            if (!uuid.test(id) || filename !== `${id}.json`) fail('CORRUPT');
            const record = await this.#read(id);
            if (!record) fail('UNAVAILABLE');
            records.push(record);
        }
        return records;
    }
    #ack(record: StoredRecovery, status = record.source): EditorDraftRecoveryAck {
        return { id: record.id, revision: record.revision, mutationId: record.mutationId,
            snapshotSha256: record.snapshotSha256, updatedAt: record.updatedAt, source: status };
    }
    list(readPolicy: PolicyReader): Promise<EditorDraftRecoveryState> {
        return this.#operation(async () => {
            const policy = await readPolicy(), records = await this.#records();
            return { enabled: policy.enabled, settingsRevision: policy.revision,
                entries: records.map(({ value, bytes }) => ({ id: value.id, revision: value.revision,
                    ...(value.snapshot.sessionId ? { sessionId: value.snapshot.sessionId } : {}), sourceUri: value.snapshot.sourceUri,
                    name: value.snapshot.name, updatedAt: value.updatedAt, bytes })),
                totalBytes: records.reduce((total, record) => total + record.bytes, 0) };
        });
    }
    open(owner: string, request: EditorDraftRecoveryRequest, readPolicy: PolicyReader): Promise<EditorDraftRecoveryOpenResult> {
        return this.#operation(async () => {
            shape(request, ['id']);
            if (request.id === undefined) {
                if (!(await readPolicy()).enabled) fail('EDITOR_RECOVERY_DISABLED');
                if ([...this.#handles.values()].filter(candidate => candidate === owner).length >= EDITOR_RECOVERY_MAX_COUNT) fail('QUOTA_EXCEEDED');
                const id = randomUUID(); this.#handles.set(id, owner);
                return { kind: 'allocated', id, revision: 0 };
            }
            assertId(request.id);
            const record = (await this.#read(request.id))?.value;
            if (!record) fail('NOT_FOUND');
            const inspected = record.evidence ? await inspectSource(record.snapshot, record.evidence) : { source: record.source };
            return { kind: 'record', record: { version: 1, ...this.#ack(record, inspected.source), snapshot: record.snapshot } };
        });
    }
    save(owner: string, request: EditorDraftRecoverySaveRequest, readPolicy: PolicyReader): Promise<EditorDraftRecoveryAck> {
        return this.#operation(async () => {
            shape(request, ['id', 'expectedRevision', 'mutationId', 'snapshot', 'refreshSourceBaseline']);
            assertId(request.id); assertId(request.mutationId); revision(request.expectedRevision, true);
            if (request.refreshSourceBaseline !== undefined && request.refreshSourceBaseline !== true) fail('CORRUPT');
            const snapshot = normalizeSnapshot(request.snapshot), snapshotSha256 = digest(JSON.stringify(snapshot));
            const previous = (await this.#read(request.id))?.value;
            if (previous?.mutationId === request.mutationId) {
                if (previous.snapshotSha256 !== snapshotSha256 || previous.expectedRevision !== request.expectedRevision
                    || previous.refreshSourceBaseline !== (request.refreshSourceBaseline === true)) fail('CONFLICT');
                return this.#ack(previous);
            }
            if (!(await readPolicy()).enabled) fail('EDITOR_RECOVERY_DISABLED');
            if (!previous && (request.expectedRevision !== 0 || this.#handles.get(request.id) !== owner)) fail('NOT_FOUND');
            if (previous && (previous.revision !== request.expectedRevision || previous.snapshot.sourceUri !== snapshot.sourceUri
                || previous.snapshot.sessionId !== snapshot.sessionId)) fail('CONFLICT');
            if (request.expectedRevision >= Number.MAX_SAFE_INTEGER) fail('CONFLICT');
            const refresh = !previous || request.refreshSourceBaseline === true;
            const inspected = refresh || previous?.evidence
                ? await inspectSource(snapshot, refresh ? undefined : previous!.evidence)
                : { source: previous!.source };
            const evidence = refresh && inspected.evidence ? inspected.evidence : previous?.evidence;
            const next: StoredRecovery = { version: 1, id: request.id, revision: request.expectedRevision + 1,
                mutationId: request.mutationId, expectedRevision: request.expectedRevision,
                refreshSourceBaseline: request.refreshSourceBaseline === true, snapshotSha256, updatedAt: new Date().toISOString(),
                snapshot, source: inspected.source, ...(evidence ? { evidence } : {}) };
            const raw = JSON.stringify(next), bytes = Buffer.byteLength(raw, 'utf8');
            if (bytes > EDITOR_RECOVERY_MAX_BYTES) fail('TOO_LARGE');
            const others = (await this.#records()).filter(record => record.value.id !== request.id);
            if (others.length >= EDITOR_RECOVERY_MAX_COUNT || others.reduce((total, record) => total + record.bytes, bytes) > EDITOR_RECOVERY_TOTAL_BYTES) fail('QUOTA_EXCEEDED');
            await this.#safeDirectory(true);
            await this.writeRecord(join(this.directory, `${request.id}.json`), raw);
            this.#handles.delete(request.id);
            return this.#ack(next);
        });
    }
    /** Protected solely to inject write/sync/rename faults in real-filesystem tests. */
    protected async writeRecord(target: string, raw: string): Promise<void> {
        const temporary = join(this.directory, `.pending-${randomUUID()}.tmp`);
        let created: Identity | undefined;
        try {
            await this.#safeDirectory();
            const handle = await open(temporary, 'wx', 0o600);
            try {
                created = await handle.stat();
                await this.#safeDirectory();
                await handle.writeFile(raw, 'utf8');
                await handle.sync();
            } finally { await handle.close(); }
            await this.#safeDirectory();
            await rename(temporary, target);
        } finally {
            if (created) await (async () => {
                await this.#safeDirectory();
                const info = await lstat(temporary).catch(() => undefined);
                if (info && info.isFile() && !info.isSymbolicLink() && sameIdentity(info, created!)) await unlink(temporary);
            })().catch(() => undefined);
        }
    }
    discard(owner: string, request: EditorDraftRecoveryDiscardRequest): Promise<{ readonly discarded: true }> {
        return this.#operation(async () => {
            shape(request, ['id', 'expectedRevision']); assertId(request.id); revision(request.expectedRevision, true);
            const current = (await this.#read(request.id))?.value;
            if (!current && request.expectedRevision === 0 && this.#handles.get(request.id) === owner) {
                this.#handles.delete(request.id);
                return { discarded: true };
            }
            if (!current) fail('NOT_FOUND');
            if (current.revision !== request.expectedRevision) fail('CONFLICT');
            await this.#safeDirectory();
            await unlink(join(this.directory, `${request.id}.json`));
            this.#handles.delete(request.id);
            return { discarded: true };
        });
    }
}

const sharedStores = new Map<string, EditorDraftRecoveryStore>();
export async function sharedEditorDraftRecoveryStore(dataRoot: string): Promise<EditorDraftRecoveryStore> {
    try {
        const requested = resolve(dataRoot);
        await mkdir(requested, { recursive: true, mode: 0o700 });
        const info = await lstat(requested);
        if (!info.isDirectory() || info.isSymbolicLink() || !usableIdentity(info)) fail('UNSAFE_PATH');
        const canonical = await realpath(requested);
        const existing = sharedStores.get(canonical);
        if (existing) return existing;
        const store = new EditorDraftRecoveryStore(canonical, info);
        sharedStores.set(canonical, store);
        return store;
    } catch (error) {
        if (error instanceof EditorDraftRecoveryError) throw error;
        throw new EditorDraftRecoveryError('UNAVAILABLE');
    }
}
