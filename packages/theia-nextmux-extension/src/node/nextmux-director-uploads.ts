import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { BeginComicDirectorUploadRequest, ComicDirectorModelImportResult, ComicDirectorUploadState } from '../common/nextmux-director-contracts';
import { decodeDirectorBase64, directorSha256, DirectorMediaError, DIRECTOR_MEDIA_MAX_BYTES } from './nextmux-director-media';

export const DIRECTOR_UPLOAD_CHUNK_BYTES = 768 * 1024;
export type DirectorUploadReceipt = { readonly purpose: 'capture'; readonly captureId: string; readonly requestSha256: string }
    | { readonly purpose: 'model'; readonly result: ComicDirectorModelImportResult };
interface UploadRecord {
    version: 1; uploadId: string; purpose: 'capture' | 'model'; byteLength: number; offset: number;
    mimeType: string; name: string; updatedAt: number; sha256?: string; receipt?: DirectorUploadReceipt; claim?: string;
}
const queues = new Map<string, Promise<unknown>>();
const { lock } = require('proper-lockfile') as { lock(path: string, options: { realpath: boolean; lockfilePath: string; stale: number; retries: { retries: number; minTimeout: number; maxTimeout: number } }): Promise<() => Promise<void>> };
function fail(code: string, text: string): never { throw new DirectorMediaError(code, text); }
function uploadId(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) fail('DIRECTOR_UPLOAD_INVALID', 'The upload identifier is invalid.');
    return value;
}
/** Root-owned local staging; only small base64 chunks cross Theia's 100 MB message boundary. */
export class DirectorUploadStore {
    constructor(readonly workspaceRoot: string) {}
    private async directory(): Promise<string> {
        const root = await realpath(this.workspaceRoot);
        let current = root;
        for (const part of ['.nextmux', 'director-uploads']) {
            const next = join(current, part);
            try { await mkdir(next, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
            current = await realpath(next);
            const local = relative(root, current);
            if (local === '..' || local.startsWith('../') || local.startsWith('..\\') || isAbsolute(local) || !(await lstat(current)).isDirectory()) fail('DIRECTOR_PROJECT_PATH', 'The upload directory points outside the project.');
        }
        return current;
    }
    private paths(directory: string, id: string): { metadata: string; data: string } {
        const hash = directorSha256(uploadId(id));
        return { metadata: join(directory, `${hash}.json`), data: join(directory, `${hash}.part`) };
    }
    private async exclusive<T>(operation: (directory: string) => Promise<T>): Promise<T> {
        const directory = await this.directory(), previous = queues.get(directory) || Promise.resolve();
        const pending = previous.catch(() => undefined).then(async () => {
            const release = await lock(directory, { realpath: false, lockfilePath: `${directory}.lock`, stale: 30_000, retries: { retries: 40, minTimeout: 25, maxTimeout: 100 } });
            try { return await operation(directory); } finally { await release(); }
        });
        queues.set(directory, pending);
        try { return await pending; } finally { if (queues.get(directory) === pending) queues.delete(directory); }
    }
    private async read(directory: string, id: string): Promise<UploadRecord> {
        const path = this.paths(directory, id).metadata, info = await lstat(path).catch(() => undefined);
        if (!info?.isFile() || info.isSymbolicLink() || info.size > 8192) fail('DIRECTOR_UPLOAD_MISSING', 'The upload is unavailable.');
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        let record: UploadRecord;
        try { record = JSON.parse(await handle.readFile('utf8')) as UploadRecord; } finally { await handle.close(); }
        if (record.version !== 1 || record.uploadId !== id || !['model', 'capture'].includes(record.purpose)
            || !Number.isSafeInteger(record.byteLength) || record.byteLength < 1 || record.byteLength > DIRECTOR_MEDIA_MAX_BYTES
            || !Number.isSafeInteger(record.offset) || record.offset < 0 || record.offset > record.byteLength
            || typeof record.mimeType !== 'string' || typeof record.name !== 'string' || !Number.isFinite(record.updatedAt)
            || record.claim !== undefined && (typeof record.claim !== 'string' || !/^[a-f0-9]{64}$/.test(record.claim))
            || record.receipt && (!record.sha256 || !/^[a-f0-9]{64}$/.test(record.sha256) || record.receipt.purpose !== record.purpose)) fail('DIRECTOR_UPLOAD_INVALID', 'The upload metadata is invalid.');
        if (record.receipt?.purpose === 'capture' && (typeof record.receipt.captureId !== 'string' || !/^[a-f0-9]{64}$/.test(record.receipt.requestSha256))) fail('DIRECTOR_UPLOAD_INVALID', 'The capture receipt is invalid.');
        if (record.receipt?.purpose === 'model') {
            const result = record.receipt.result;
            if (!result || !/^nextmux\.media\/director-models\/[a-f0-9]{64}\.(?:glb|gltf|spz|ply)$/.test(result.uri)
                || result.sha256 !== record.sha256 || result.byteLength !== record.byteLength || !['model', 'splat'].includes(result.kind)
                || !['model/gltf-binary', 'model/gltf+json', 'application/octet-stream'].includes(result.mimeType)) fail('DIRECTOR_UPLOAD_INVALID', 'The model receipt is invalid.');
        }
        return record;
    }
    private async write(directory: string, record: UploadRecord): Promise<void> {
        const path = this.paths(directory, record.uploadId).metadata, temporary = join(directory, `${randomUUID()}.tmp`), handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); } finally { await handle.close(); }
        try { await rename(temporary, path); } finally { await unlink(temporary).catch(() => undefined); }
    }
    private state(record: UploadRecord): ComicDirectorUploadState { return { uploadId: record.uploadId, offset: record.offset, byteLength: record.byteLength }; }
    async begin(request: Omit<BeginComicDirectorUploadRequest, 'workspaceRoot'>): Promise<ComicDirectorUploadState> {
        const id = uploadId(request.uploadId || randomUUID()), name = request.name || '';
        if (!['capture', 'model'].includes(request.purpose) || !Number.isSafeInteger(request.byteLength) || request.byteLength < 1 || request.byteLength > DIRECTOR_MEDIA_MAX_BYTES
            || typeof request.mimeType !== 'string' || request.mimeType.length > 128 || /[\u0000-\u001f]/.test(request.mimeType)
            || typeof name !== 'string' || name.length > 256 || /[\u0000-\u001f]/.test(name)) fail('DIRECTOR_UPLOAD_INVALID', 'The upload type or size is invalid.');
        return this.exclusive(async directory => {
            const existing = await lstat(this.paths(directory, id).metadata).catch(() => undefined);
            if (existing) {
                const record = await this.read(directory, id);
                if (record.purpose !== request.purpose || record.byteLength !== request.byteLength || record.mimeType !== request.mimeType || record.name !== name) fail('DIRECTOR_UPLOAD_CONFLICT', 'This upload identifier belongs to another file.');
                return this.state(record);
            }
            let count = 0, total = 0;
            for (const file of await readdir(directory)) if (/^[a-f0-9]{64}\.json$/.test(file)) {
                const path = join(directory, file), info = await lstat(path);
                if (!info.isFile() || info.isSymbolicLink() || info.size > 8192) continue;
                const record = JSON.parse(await readFile(path, 'utf8')) as UploadRecord;
                if (Number.isFinite(record.updatedAt) && Date.now() - record.updatedAt > 24 * 3600_000) {
                    await unlink(path); await unlink(join(directory, file.replace(/\.json$/, '.part'))).catch(() => undefined);
                } else if (!record.receipt) { count++; total += record.byteLength; }
            }
            if (count >= 4 || total + request.byteLength > 512 * 1024 * 1024) fail('DIRECTOR_UPLOAD_LIMIT', 'Finish or discard another upload before starting this file.');
            const paths = this.paths(directory, id), handle = await open(paths.data, 'wx', 0o600); await handle.close();
            const record: UploadRecord = { version: 1, uploadId: id, purpose: request.purpose, byteLength: request.byteLength, offset: 0, mimeType: request.mimeType, name, updatedAt: Date.now() };
            try { await this.write(directory, record); } catch (error) { await unlink(paths.data).catch(() => undefined); throw error; }
            return this.state(record);
        });
    }
    async append(id: string, offset: number, base64: string): Promise<ComicDirectorUploadState> {
        const bytes = decodeDirectorBase64(base64, DIRECTOR_UPLOAD_CHUNK_BYTES);
        if (!Number.isSafeInteger(offset) || offset < 0) fail('DIRECTOR_UPLOAD_OFFSET', 'The upload offset is invalid.');
        return this.exclusive(async directory => {
            const record = await this.read(directory, id);
            if (record.receipt) fail('DIRECTOR_UPLOAD_CONSUMED', 'The upload has already been consumed.');
            if (offset + bytes.length > record.byteLength || offset > record.offset) fail('DIRECTOR_UPLOAD_OFFSET', 'The chunk exceeds its declared file or skips an upload offset.');
            const handle = await open(this.paths(directory, id).data, constants.O_RDWR | constants.O_NOFOLLOW);
            try {
                const info = await handle.stat(); if (!info.isFile() || info.size < record.offset) fail('DIRECTOR_UPLOAD_INVALID', 'The upload file is incomplete.');
                if (offset < record.offset) {
                    if (offset + bytes.length > record.offset) fail('DIRECTOR_UPLOAD_OFFSET', 'Upload chunks cannot overlap.');
                    const prior = Buffer.alloc(bytes.length); await handle.read(prior, 0, prior.length, offset);
                    if (!prior.equals(bytes)) fail('DIRECTOR_UPLOAD_CONFLICT', 'The repeated chunk contains different bytes.');
                    return this.state(record);
                }
                // A crash after writing bytes but before updating metadata rolls back the uncommitted tail.
                if (info.size > record.offset) await handle.truncate(record.offset);
                let written = 0; while (written < bytes.length) written += (await handle.write(bytes, written, bytes.length - written, offset + written)).bytesWritten;
                await handle.sync(); record.offset += bytes.length; record.updatedAt = Date.now(); await this.write(directory, record);
                return this.state(record);
            } finally { await handle.close(); }
        });
    }
    async load(id: string, purpose: 'capture' | 'model', mimeType: string, name?: string, claim?: string): Promise<{ data?: Buffer; sha256: string; receipt?: DirectorUploadReceipt }> {
        return this.exclusive(async directory => {
            const record = await this.read(directory, id);
            if (record.purpose !== purpose || record.mimeType !== mimeType || name !== undefined && record.name !== name) fail('DIRECTOR_UPLOAD_CONFLICT', 'The upload does not match the requested file.');
            if (record.receipt) return { sha256: record.sha256!, receipt: record.receipt };
            if (record.offset !== record.byteLength) fail('DIRECTOR_UPLOAD_INCOMPLETE', 'Upload the complete file before saving it.');
            if (record.claim && record.claim !== claim) fail('DIRECTOR_UPLOAD_CONFLICT', 'The upload belongs to another operation.');
            if (claim && !record.claim) { record.claim = claim; record.updatedAt = Date.now(); await this.write(directory, record); }
            const handle = await open(this.paths(directory, id).data, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
                const info = await handle.stat(); if (!info.isFile() || info.size !== record.byteLength) fail('DIRECTOR_UPLOAD_INVALID', 'The upload file size is invalid.');
                const data = await handle.readFile(); return { data, sha256: directorSha256(data) };
            } finally { await handle.close(); }
        });
    }
    async complete(id: string, sha256: string, receipt: DirectorUploadReceipt): Promise<void> {
        await this.exclusive(async directory => {
            const record = await this.read(directory, id);
            if (record.receipt) { if (record.sha256 !== sha256 || JSON.stringify(record.receipt) !== JSON.stringify(receipt)) fail('DIRECTOR_UPLOAD_CONFLICT', 'The upload was already consumed by another operation.'); return; }
            if (record.purpose !== receipt.purpose || record.offset !== record.byteLength || !/^[a-f0-9]{64}$/.test(sha256)) fail('DIRECTOR_UPLOAD_INVALID', 'The upload cannot be consumed.');
            record.sha256 = sha256; record.receipt = receipt; record.updatedAt = Date.now(); await this.write(directory, record);
            await unlink(this.paths(directory, id).data).catch(() => undefined);
        });
    }
    async discard(id: string): Promise<void> {
        await this.exclusive(async directory => { const paths = this.paths(directory, id); await unlink(paths.metadata).catch(() => undefined); await unlink(paths.data).catch(() => undefined); });
    }
}
