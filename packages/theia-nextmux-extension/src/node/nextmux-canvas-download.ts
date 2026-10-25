import { randomUUID } from 'crypto';
import { constants } from 'fs';
import { link, lstat, open, readdir, realpath, unlink } from 'fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import type { CanvasDocument } from '@nextmux/comic-core/canvas';
import { CANVAS_DOWNLOAD_MAX_ITEMS, canvasDownloadExtension, canvasDownloadFileNames, sanitizeCanvasDownloadName,
    type CanvasDownloadResult, type CanvasDownloadScope, type ExportCanvasDownloadRequest } from '../common/nextmux-canvas-download';

const MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const CANVAS_DOWNLOAD_RETRY_WINDOW_MS = 10 * 60 * 1000;
export const CANVAS_DOWNLOAD_RETAINED_REQUESTS = 100;
export class CanvasDownloadError extends Error {
    constructor(readonly code: string) { super(code); this.name = 'CanvasDownloadError'; }
}
const fail = (code: string): never => { throw new CanvasDownloadError(`CANVAS_DOWNLOAD_${code}`); };
const inside = (root: string, path: string): boolean => { const rel = relative(root, path); return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
const identity = (s: { dev: bigint; ino: bigint }): string => `${s.dev}:${s.ino}`;
const contentIdentity = (s: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint }): string => `${identity(s)}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => { let c = i; for (let n = 0; n < 8; n++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crcUpdate(crc: number, chunk: Buffer): number { for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return crc >>> 0; }
function localDestination(uri: unknown): string {
    try {
        if (typeof uri !== 'string' || uri.length > 8192 || /[\u0000-\u001f\u007f-\u009f]/u.test(uri)) return fail('INVALID');
        const url = new URL(uri);
        if (url.protocol !== 'file:' || url.host || url.search || url.hash || url.pathname.endsWith('/')) return fail('INVALID');
        const path = fileURLToPath(url);
        if (!isAbsolute(path) || (process.platform === 'win32' && !/^[a-z]:\\/iu.test(path))) return fail('INVALID');
        return path;
    } catch { return fail('INVALID'); }
}
function validateDownloadRequest(request: ExportCanvasDownloadRequest): void {
    if (!request || Object.keys(request).some(key => !['workspaceRoot', 'canvasId', 'requestId', 'destinationUri', 'items'].includes(key))
        || !Array.isArray(request.items) || request.items.length < 1 || request.items.length > CANVAS_DOWNLOAD_MAX_ITEMS
        || request.items.some(item => !item || Object.keys(item).some(key => !['nodeId', 'versionId', 'assetId', 'name', 'extension'].includes(key))
            || !['nodeId', 'versionId', 'assetId', 'name', 'extension'].every(key => typeof item[key as keyof typeof item] === 'string' && item[key as keyof typeof item].length <= 512))) fail('INVALID');
}

/** Streams registered local versions to an exclusive destination; never fetches a URL or overwrites a source. */
export async function exportCanvasDownload(request: ExportCanvasDownloadRequest, canvas: CanvasDocument, signal?: AbortSignal): Promise<CanvasDownloadResult> {
    const active = (): void => { if (signal?.aborted) fail('CANCELLED'); };
    active();
    validateDownloadRequest(request);
    const named = canvasDownloadFileNames(request.items);
    if (named.empty.length || named.names.some(name => Buffer.byteLength(name) > 240)) fail('INVALID');
    const root = await realpath(request.workspaceRoot), destination = localDestination(request.destinationUri);
    const parent = await realpath(dirname(destination)), parentInfo = await lstat(parent, { bigint: true });
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) fail('UNSAFE');
    const multi = request.items.length > 1;
    const expectedExtension = multi ? 'zip' : request.items[0].extension.toLowerCase();
    const chosen = basename(destination);
    const chosenStem = chosen.slice(0, -(expectedExtension.length + 1));
    if (!chosenStem || sanitizeCanvasDownloadName(chosenStem) !== chosenStem || Buffer.byteLength(chosen) > 240
        || !chosen.toLowerCase().endsWith(`.${expectedExtension}`)) fail('EXTENSION');
    const sources = await Promise.all(request.items.map(async item => {
        const node = canvas.nodes.find(node => node.id === item.nodeId);
        const version = node && 'versions' in node.payload ? node.payload.versions.find(version => version.id === item.versionId && version.assetId === item.assetId) : undefined;
        if (!version || version.status === 'missing' || version.status === 'uploading' || !['image', 'video', 'audio'].includes(version.kind)) return fail('SOURCE');
        if (canvasDownloadExtension(version.uri) !== item.extension.toLowerCase() || version.uri.includes('..')) return fail('SOURCE');
        const source = resolve(root, version.uri);
        if (!inside(join(root, 'nextmux.media'), source)) return fail('UNSAFE');
        let current = root;
        for (const segment of relative(root, source).split(sep)) {
            current = join(current, segment);
            if ((await lstat(current)).isSymbolicLink()) return fail('UNSAFE');
        }
        if (await realpath(source) !== source) return fail('UNSAFE');
        const info = await lstat(source, { bigint: true });
        if (!info.isFile() || info.size > BigInt(MAX_BYTES)) return fail('TOO_LARGE');
        return { source, info };
    }));
    if (sources.reduce((sum, item) => sum + item.info.size, 0n) > BigInt(MAX_BYTES)) fail('TOO_LARGE');
    const checkParent = async (): Promise<void> => {
        active(); const next = await lstat(parent, { bigint: true });
        if (!next.isDirectory() || next.isSymbolicLink() || identity(next) !== identity(parentInfo) || await realpath(parent) !== parent) fail('UNSAFE');
    };
    await checkParent();
    const temporary = join(parent, `.nextmux-download-${randomUUID()}.tmp`);
    const output = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
    const outputIdentity = identity(await output.stat({ bigint: true }));
    let bytes = 0;
    const write = async (chunk: Buffer): Promise<void> => { active(); await output.writeFile(chunk); bytes += chunk.length; };
    try {
        const central: Buffer[] = [];
        for (const [index, item] of sources.entries()) {
            active();
            const source = await open(item.source, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
            try {
                if (contentIdentity(await source.stat({ bigint: true })) !== contentIdentity(item.info) || await realpath(item.source) !== item.source) fail('SOURCE_CHANGED');
                const name = Buffer.from(named.names[index]), offset = bytes;
                if (multi) {
                    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
                    header.writeUInt16LE(0x808, 6); header.writeUInt16LE(33, 12); header.writeUInt16LE(name.length, 26);
                    await write(header); await write(name);
                }
                let size = 0, crc = 0xffffffff;
                const chunk = Buffer.alloc(1024 * 1024);
                while (true) {
                    active(); const { bytesRead } = await source.read(chunk, 0, chunk.length, null);
                    if (!bytesRead) break;
                    size += bytesRead; if (size > Number(item.info.size)) fail('SOURCE_CHANGED');
                    const data = chunk.subarray(0, bytesRead); crc = crcUpdate(crc, data); await write(data);
                }
                if (size !== Number(item.info.size) || contentIdentity(await source.stat({ bigint: true })) !== contentIdentity(item.info)
                    || contentIdentity(await lstat(item.source, { bigint: true })) !== contentIdentity(item.info) || await realpath(item.source) !== item.source) fail('SOURCE_CHANGED');
                if (multi) {
                    const checksum = (crc ^ 0xffffffff) >>> 0, descriptor = Buffer.alloc(16);
                    descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(checksum, 4); descriptor.writeUInt32LE(size, 8); descriptor.writeUInt32LE(size, 12); await write(descriptor);
                    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
                    entry.writeUInt16LE(0x808, 8); entry.writeUInt16LE(33, 14); entry.writeUInt32LE(checksum, 16); entry.writeUInt32LE(size, 20); entry.writeUInt32LE(size, 24);
                    entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42); central.push(entry, name);
                }
            } finally { await source.close(); }
        }
        if (multi) {
            const offset = bytes; for (const entry of central) await write(entry);
            const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(sources.length, 8); end.writeUInt16LE(sources.length, 10);
            end.writeUInt32LE(bytes - offset, 12); end.writeUInt32LE(offset, 16); await write(end);
        }
        await output.sync(); await output.close(); await checkParent();
        const written = await lstat(temporary, { bigint: true });
        if (!written.isFile() || written.isSymbolicLink() || identity(written) !== outputIdentity || written.nlink !== 1n || written.size !== BigInt(bytes)) fail('UNSAFE');
        const existing = new Set((await readdir(parent)).map(name => name.normalize('NFC').toLocaleLowerCase('en-US')));
        const stem = chosenStem;
        for (let suffix = 1; suffix < 10000; suffix++) {
            const fileName = suffix === 1 ? chosen : `${stem}(${suffix}).${expectedExtension}`;
            if (existing.has(fileName.normalize('NFC').toLocaleLowerCase('en-US'))) continue;
            await checkParent();
            try {
                await link(temporary, join(parent, fileName));
                // Publication is the commit point: late cancellation must not delete a completed export.
                return { destinationUri: pathToFileURL(join(parent, fileName)).href, fileName, files: named.names, bytes };
            } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        }
        return fail('EXISTS');
    } catch (error) {
        if (error instanceof CanvasDownloadError) throw error;
        return fail('FAILED');
    } finally {
        await output.close().catch(() => undefined);
        try {
            const current = await lstat(temporary, { bigint: true });
            if (!current.isSymbolicLink() && identity(current) === outputIdentity && await realpath(parent) === parent
                && identity(await lstat(parent, { bigint: true })) === identity(parentInfo)) await unlink(temporary);
        } catch { /* Never remove a replaced or unproven path. */ }
    }
}

/** Retries reuse the last 100 terminal requests for up to ten minutes. Running requests are never evicted. */
export class CanvasDownloadService {
    private readonly tasks = new Map<string, { fingerprint: string; controller: AbortController; result: Promise<CanvasDownloadResult>; settledAt?: number; settledOrder?: number }>();
    private readonly cancelled = new Map<string, number>();
    private settledSequence = 0;
    private disposed = false;
    constructor(private readonly load: (scope: CanvasDownloadScope) => Promise<CanvasDocument>, private readonly clock: () => number = Date.now) {}
    private prune(): void {
        const cutoff = this.clock() - CANVAS_DOWNLOAD_RETRY_WINDOW_MS;
        const completed = [...this.tasks].filter(([, task]) => task.settledAt !== undefined).sort((a, b) => a[1].settledOrder! - b[1].settledOrder!);
        for (let index = 0; index < completed.length; index++) {
            if (completed[index][1].settledAt! <= cutoff || index < completed.length - CANVAS_DOWNLOAD_RETAINED_REQUESTS) this.tasks.delete(completed[index][0]);
        }
        for (const [key, time] of this.cancelled) if (time <= cutoff || this.cancelled.size > CANVAS_DOWNLOAD_RETAINED_REQUESTS) this.cancelled.delete(key);
    }
    private key(scope: CanvasDownloadScope): string {
        if (!scope || typeof scope.workspaceRoot !== 'string' || !scope.workspaceRoot || scope.workspaceRoot.length > 8192 || typeof scope.requestId !== 'string'
            || !/^[a-zA-Z0-9-]{1,100}$/u.test(scope.requestId) || (scope.canvasId !== undefined && (typeof scope.canvasId !== 'string' || scope.canvasId.length > 200))) return fail('INVALID');
        return JSON.stringify([resolve(scope.workspaceRoot), scope.canvasId ?? '', scope.requestId]);
    }
    run(request: ExportCanvasDownloadRequest): Promise<CanvasDownloadResult> {
        if (this.disposed) return Promise.reject(new CanvasDownloadError('CANVAS_DOWNLOAD_CANCELLED'));
        validateDownloadRequest(request); localDestination(request.destinationUri); this.prune();
        const key = this.key(request), fingerprint = JSON.stringify(request), known = this.tasks.get(key);
        if (known) { if (known.fingerprint !== fingerprint) return Promise.reject(new CanvasDownloadError('CANVAS_DOWNLOAD_CONFLICT')); return known.result; }
        if (this.cancelled.has(key)) return Promise.reject(new CanvasDownloadError('CANVAS_DOWNLOAD_CANCELLED'));
        const controller = new AbortController();
        const entry: { fingerprint: string; controller: AbortController; result: Promise<CanvasDownloadResult>; settledAt?: number; settledOrder?: number } = {
            fingerprint, controller, result: Promise.resolve().then(() => this.load(request)).then(canvas => exportCanvasDownload(request, canvas, controller.signal)) };
        entry.result = entry.result.finally(() => { entry.settledAt = this.clock(); entry.settledOrder = ++this.settledSequence; this.prune(); });
        this.tasks.set(key, entry);
        return entry.result;
    }
    dispose(): void {
        this.disposed = true;
        for (const task of this.tasks.values()) task.controller.abort();
        this.tasks.clear(); this.cancelled.clear();
    }
    cancel(scope: CanvasDownloadScope): void {
        if (this.disposed) return;
        this.prune(); const key = this.key(scope), task = this.tasks.get(key);
        if (task) task.controller.abort();
        else { this.cancelled.set(key, this.clock()); this.prune(); }
    }
}
