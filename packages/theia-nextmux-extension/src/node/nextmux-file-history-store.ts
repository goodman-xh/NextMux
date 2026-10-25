import { createHash, randomUUID } from 'crypto';
import { constants } from 'fs';
import { lstat, mkdir, open, readdir, realpath, rename, rm, unlink } from 'fs/promises';
import { join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
    FILE_HISTORY_MAX_ENTRIES, FILE_HISTORY_MAX_FILE_BYTES, FILE_HISTORY_MAX_TOTAL_BYTES, FILE_HISTORY_MAX_VERSION_BYTES,
    FileHistoryEntry, FileHistoryErrorCode, FileHistoryRecordRequest, FileHistoryVersion
} from '../common/nextmux-file-history';

export class FileHistoryError extends Error {
    constructor(readonly code: FileHistoryErrorCode) { super(code); this.name = 'FileHistoryError'; }
}
type StoredEntry = FileHistoryEntry & { readonly sha256: string };
interface Manifest { readonly version: 1; readonly sourceUri: string; readonly entries: readonly StoredEntry[]; }
const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function fail(code: FileHistoryErrorCode): never { throw new FileHistoryError(code); }
function normalizeUri(value: unknown): string {
    try {
        if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) fail('FILE_HISTORY_INVALID_REQUEST');
        const uri = new URL(value);
        if (uri.protocol !== 'file:' || uri.hostname && process.platform !== 'win32' || uri.search || uri.hash) fail('FILE_HISTORY_INVALID_REQUEST');
        return pathToFileURL(resolve(fileURLToPath(uri))).href;
    } catch { return fail('FILE_HISTORY_INVALID_REQUEST'); }
}
const publicEntry = (entry: StoredEntry): FileHistoryEntry => ({ id: entry.id, sourceUri: entry.sourceUri,
    createdAt: entry.createdAt, kind: entry.kind, bytes: entry.bytes });

/** One serialized store shared by every renderer connection. Never reads or writes the source file. */
export class FileHistoryStore {
    readonly directory: string;
    #tail: Promise<unknown> = Promise.resolve();
    constructor(readonly dataRoot: string) { this.directory = join(dataRoot, 'file-history-v1'); }
    #exclusive<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.#tail.then(operation, operation).catch(error => {
            if (error instanceof FileHistoryError) throw error;
            throw new FileHistoryError('FILE_HISTORY_UNAVAILABLE');
        });
        this.#tail = result.then(() => undefined, () => undefined);
        return result;
    }
    async #safeDirectory(path: string, create = false): Promise<boolean> {
        if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
        const info = await lstat(path).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
        if (!info) return false;
        if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) fail('FILE_HISTORY_UNSAFE_PATH');
        return true;
    }
    async #prepare(sourceUri: string, create = false): Promise<string | undefined> {
        if (!await this.#safeDirectory(this.dataRoot) || !await this.#safeDirectory(this.directory, create)) return undefined;
        const path = join(this.directory, digest(sourceUri));
        return await this.#safeDirectory(path, create) ? path : undefined;
    }
    async #read(path: string, limit: number): Promise<Buffer | undefined> {
        const info = await lstat(path).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
        if (!info) return undefined;
        if (!info.isFile() || info.isSymbolicLink()) fail('FILE_HISTORY_UNSAFE_PATH');
        if (info.size > limit) fail('FILE_HISTORY_CORRUPT');
        const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        try {
            const opened = await handle.stat();
            if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== info.size) fail('FILE_HISTORY_UNSAFE_PATH');
            const bytes = await handle.readFile();
            if (bytes.length !== info.size || bytes.length > limit) fail('FILE_HISTORY_CORRUPT');
            return bytes;
        } finally { await handle.close(); }
    }
    async #manifest(directory: string, sourceUri?: string): Promise<Manifest | undefined> {
        const raw = await this.#read(join(directory, 'manifest.json'), 128 * 1024);
        if (!raw) return undefined;
        let value: Manifest;
        try { value = JSON.parse(raw.toString('utf8')); } catch { return fail('FILE_HISTORY_CORRUPT'); }
        if (!value || typeof value !== 'object' || value.version !== 1 || typeof value.sourceUri !== 'string' || (sourceUri && value.sourceUri !== sourceUri)
            || !Array.isArray(value.entries) || value.entries.length > FILE_HISTORY_MAX_ENTRIES) fail('FILE_HISTORY_CORRUPT');
        const ids = new Set<string>();
        for (const entry of value.entries) {
            if (!entry || !idPattern.test(entry.id) || ids.has(entry.id) || entry.sourceUri !== value.sourceUri
                || !['original', 'saved', 'restored'].includes(entry.kind) || !Number.isFinite(Date.parse(entry.createdAt))
                || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > FILE_HISTORY_MAX_VERSION_BYTES
                || !/^[a-f0-9]{64}$/.test(entry.sha256)) fail('FILE_HISTORY_CORRUPT');
            ids.add(entry.id);
        }
        return value;
    }
    async #write(directory: string, filename: string, bytes: string | Buffer): Promise<void> {
        const temporary = join(directory, `.pending-${randomUUID()}`);
        try {
            if (!await this.#safeDirectory(directory)) fail('FILE_HISTORY_UNSAFE_PATH');
            const handle = await open(temporary, 'wx', 0o600);
            try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
            if (!await this.#safeDirectory(directory)) fail('FILE_HISTORY_UNSAFE_PATH');
            await rename(temporary, join(directory, filename));
        } finally { await unlink(temporary).catch(() => undefined); }
    }
    async #accountedBytes(directory: string): Promise<number> {
        try { return (await this.#manifest(directory))?.entries.reduce((sum, item) => sum + item.bytes, 0) || 0; }
        catch (error) {
            if (!(error instanceof FileHistoryError) || !['FILE_HISTORY_CORRUPT', 'FILE_HISTORY_UNSAFE_PATH'].includes(error.code)) throw error;
            // A corrupt history must not disable saving unrelated files. Account for its
            // existing payload sizes without opening them or following symbolic links.
            let bytes = 0;
            for (const name of await readdir(directory)) {
                const info = await lstat(join(directory, name));
                bytes += info.size;
                if (bytes > FILE_HISTORY_MAX_TOTAL_BYTES) break;
            }
            return bytes;
        }
    }
    list(source: string): Promise<readonly FileHistoryEntry[]> {
        return this.#exclusive(async () => {
            const sourceUri = normalizeUri(source), directory = await this.#prepare(sourceUri);
            if (!directory) return [];
            return (await this.#manifest(directory, sourceUri))?.entries.map(publicEntry) || [];
        });
    }
    read(source: string, id: string): Promise<FileHistoryVersion> {
        return this.#exclusive(async () => {
            const sourceUri = normalizeUri(source);
            if (typeof id !== 'string' || !idPattern.test(id)) fail('FILE_HISTORY_INVALID_REQUEST');
            const directory = await this.#prepare(sourceUri);
            const entry = directory && (await this.#manifest(directory, sourceUri))?.entries.find(item => item.id === id);
            if (!directory || !entry) fail('FILE_HISTORY_NOT_FOUND');
            const bytes = await this.#read(join(directory, `${entry.id}.txt`), FILE_HISTORY_MAX_VERSION_BYTES);
            if (!bytes || bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) fail('FILE_HISTORY_CORRUPT');
            let content: string;
            try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail('FILE_HISTORY_CORRUPT'); }
            return { ...publicEntry(entry), content };
        });
    }
    record(request: FileHistoryRecordRequest): Promise<FileHistoryEntry> {
        return this.#exclusive(async () => {
            if (!request || typeof request.content !== 'string' || !['original', 'saved', 'restored'].includes(request.kind)) fail('FILE_HISTORY_INVALID_REQUEST');
            if (request.content.length > FILE_HISTORY_MAX_VERSION_BYTES) fail('FILE_HISTORY_TOO_LARGE');
            const sourceUri = normalizeUri(request.sourceUri), bytes = Buffer.from(request.content, 'utf8');
            if (bytes.length > FILE_HISTORY_MAX_VERSION_BYTES) fail('FILE_HISTORY_TOO_LARGE');
            const directory = await this.#prepare(sourceUri, true);
            if (!directory) fail('FILE_HISTORY_UNAVAILABLE');
            const previous = (await this.#manifest(directory, sourceUri))?.entries || [];
            if (request.kind === 'original' && previous.length) return publicEntry(previous.find(item => item.kind === 'original') || previous[previous.length - 1]);
            const sha256 = digest(bytes);
            // A version is identified by its content for a given file.  In
            // particular, restoring a historical snapshot and saving it again
            // must not create another "restored" entry.  Keep the first
            // occurrence so its original kind and timestamp remain stable.
            const duplicate = previous.find(item => item.sha256 === sha256);
            if (duplicate) return publicEntry(duplicate);
            const entry: StoredEntry = { id: randomUUID(), sourceUri, createdAt: new Date(Math.max(Date.now(), Date.parse(previous[0]?.createdAt || '') + 1 || 0)).toISOString(),
                kind: request.kind, bytes: bytes.length, sha256 };
            const retained = [entry, ...previous];
            const total = (): number => retained.reduce((sum, item) => sum + item.bytes, 0);
            while (retained.length > FILE_HISTORY_MAX_ENTRIES || total() > FILE_HISTORY_MAX_FILE_BYTES) {
                let index = retained.length - 1;
                while (index >= 0 && (retained[index].kind === 'original' || retained[index].id === entry.id)) index--;
                if (index < 0) fail('FILE_HISTORY_QUOTA_EXCEEDED');
                retained.splice(index, 1);
            }
            // A new file refused for quota must not leave its empty folder behind: that folder would count against
            // the limit and block new versions of files already kept (audit B05-06).
            const refuse = async (): Promise<never> => {
                if (!previous.length) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
                return fail('FILE_HISTORY_QUOTA_EXCEEDED');
            };
            const directories = (await readdir(this.directory)).filter(name => /^[a-f0-9]{64}$/.test(name));
            if (directories.length > 256) await refuse();
            let allBytes = total();
            for (const name of directories) {
                const other = join(this.directory, name);
                if (other === directory) continue;
                if (!await this.#safeDirectory(other)) continue;
                allBytes += await this.#accountedBytes(other);
            }
            if (allBytes > FILE_HISTORY_MAX_TOTAL_BYTES) await refuse();
            await this.#write(directory, `${entry.id}.txt`, bytes);
            try { await this.#write(directory, 'manifest.json', JSON.stringify({ version: 1, sourceUri, entries: retained } satisfies Manifest)); }
            catch (error) { await unlink(join(directory, `${entry.id}.txt`)).catch(() => undefined); throw error; }
            // Only versions removed by this successful manifest commit are pruned. The original is retained.
            for (const item of previous) if (!retained.some(candidate => candidate.id === item.id)) await unlink(join(directory, `${item.id}.txt`)).catch(() => undefined);
            return publicEntry(entry);
        });
    }
}

const stores = new Map<string, FileHistoryStore>();
export async function sharedFileHistoryStore(dataRoot: string): Promise<FileHistoryStore> {
    await mkdir(resolve(dataRoot), { recursive: true, mode: 0o700 });
    const info = await lstat(resolve(dataRoot));
    if (!info.isDirectory() || info.isSymbolicLink()) fail('FILE_HISTORY_UNSAFE_PATH');
    const canonical = await realpath(resolve(dataRoot));
    let store = stores.get(canonical);
    if (!store) { store = new FileHistoryStore(canonical); stores.set(canonical, store); }
    return store;
}
