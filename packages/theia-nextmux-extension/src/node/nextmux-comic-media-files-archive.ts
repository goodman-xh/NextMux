import { createHash, randomUUID } from 'crypto';
import { constants as fsConstants, lstatSync } from 'fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, rmdir } from 'fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'path';
import { COMIC_MEDIA_DIRECTORY, COMIC_PROJECT_FILE } from '@nextmux/comic-core';

const lockfile = require('proper-lockfile') as {
    lock(path: string, options: Record<string, unknown>): Promise<() => Promise<void>>;
};

const FORMAT = 'nextmux-comic-media-files';
const VERSION = 1;
const ARCHIVE_SUFFIX = '.nmxcomicmedia';
const RESTORE_PREFIX = '.nextmux-media-restore-';
const RESTORE_MARKER = 'nextmux-media-restore-v1';
const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_PROJECT_BYTES = 64 * 1024 * 1024;
const MAX_DEPTH = 16;

type ArchiveErrorCode = 'COMIC_MEDIA_EMPTY' | 'COMIC_MEDIA_UNSAFE' | 'COMIC_MEDIA_TOO_LARGE'
    | 'COMIC_MEDIA_CHANGED' | 'COMIC_MEDIA_ARCHIVE_INVALID' | 'COMIC_MEDIA_WORKSPACE_MISMATCH'
    | 'COMIC_MEDIA_PROJECT_CHANGED' | 'COMIC_MEDIA_NOT_EMPTY' | 'COMIC_MEDIA_BUSY';

export class ComicMediaFilesArchiveError extends Error {
    constructor(readonly code: ArchiveErrorCode, message = code) {
        super(message);
        this.name = 'ComicMediaFilesArchiveError';
    }
}

interface MediaFile {
    readonly path: string;
    readonly size: number;
    readonly sha256: string;
}

interface ScannedFile {
    readonly path: string;
    readonly absolutePath: string;
    readonly size: number;
    readonly identity: string;
}

interface Manifest {
    readonly format: typeof FORMAT;
    readonly version: typeof VERSION;
    readonly mediaFilesIncluded: true;
    readonly workspaceBinding: string;
    readonly projectSha256: string | null;
    readonly exportedAt: string;
    readonly fileCount: number;
    readonly totalBytes: number;
    readonly contentSha256: string;
    readonly files: readonly MediaFile[];
}

export interface ComicMediaFilesArchiveResult {
    readonly directoryPath: string;
    readonly files: number;
    readonly bytes: number;
}

function sha256(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
}

function isInside(parent: string, child: string): boolean {
    const path = relative(parent, child);
    return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
    return Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

function hex(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function validRelativePath(path: unknown): path is string {
    if (typeof path !== 'string' || path.length < 1 || Buffer.byteLength(path, 'utf8') > 1024
        || path.includes('\\') || path.includes(':') || path.startsWith('/')
        || /[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(path)) return false;
    const parts = path.split('/');
    return parts.length <= MAX_DEPTH && parts.every(part => part.length > 0 && part !== '.' && part !== '..'
        && Buffer.byteLength(part, 'utf8') <= 255
        && !/[. ]$/.test(part) && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part));
}

async function canonicalDirectory(path: string): Promise<string> {
    if (!isAbsolute(path)) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_UNSAFE');
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_UNSAFE');
    const canonical = await realpath(path);
    const final = await lstat(canonical);
    if (!final.isDirectory() || final.isSymbolicLink()) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_UNSAFE');
    return canonical;
}

async function mediaDirectory(root: string): Promise<string | undefined> {
    const target = join(root, COMIC_MEDIA_DIRECTORY);
    let info;
    try { info = await lstat(target); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_UNSAFE');
    const canonical = await realpath(target);
    if (!isInside(root, canonical) || canonical === root) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_UNSAFE');
    return canonical;
}

function identity(info: { readonly dev: bigint; readonly ino: bigint; readonly size: bigint;
    readonly mtimeNs: bigint; readonly ctimeNs: bigint; readonly nlink: bigint }): string {
    return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs, info.nlink].join(':');
}

async function scanFiles(directory: string | undefined): Promise<readonly ScannedFile[]> {
    if (!directory) return [];
    const files: ScannedFile[] = [];
    const queue: Array<{ path: string; prefix: string; depth: number }> = [{ path: directory, prefix: '', depth: 0 }];
    let total = 0;
    while (queue.length) {
        const current = queue.shift()!;
        const entries = await readdir(current.path);
        for (const name of entries) {
            const path = current.prefix ? `${current.prefix}/${name}` : name;
            if (!validRelativePath(path)) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_UNSAFE');
            const absolutePath = join(current.path, name);
            const info = await lstat(absolutePath, { bigint: true });
            if (info.isSymbolicLink() || !isInside(directory, await realpath(absolutePath))) {
                throw new ComicMediaFilesArchiveError('COMIC_MEDIA_UNSAFE');
            }
            if (info.isDirectory()) {
                if (current.depth + 1 >= MAX_DEPTH) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_TOO_LARGE');
                queue.push({ path: absolutePath, prefix: path, depth: current.depth + 1 });
            } else if (info.isFile() && info.nlink === 1n) {
                const size = Number(info.size);
                if (!Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_BYTES) {
                    throw new ComicMediaFilesArchiveError('COMIC_MEDIA_TOO_LARGE');
                }
                files.push({ path, absolutePath, size, identity: identity(info) });
                total += size;
                if (files.length > MAX_FILES || total > MAX_TOTAL_BYTES) {
                    throw new ComicMediaFilesArchiveError('COMIC_MEDIA_TOO_LARGE');
                }
            } else throw new ComicMediaFilesArchiveError('COMIC_MEDIA_UNSAFE');
        }
    }
    files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
    if (new Set(files.map(file => file.path.toLowerCase())).size !== files.length) {
        throw new ComicMediaFilesArchiveError('COMIC_MEDIA_UNSAFE');
    }
    return files;
}

async function projectSha256(root: string): Promise<string | null> {
    const path = join(root, COMIC_PROJECT_FILE);
    let before;
    try { before = await lstat(path, { bigint: true }); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
    if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(MAX_PROJECT_BYTES)) {
        throw new ComicMediaFilesArchiveError('COMIC_MEDIA_UNSAFE');
    }
    const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    let digest: string;
    try {
        const actual = await handle.stat({ bigint: true });
        if (identity(before) !== identity(actual)) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_CHANGED');
        const hash = createHash('sha256');
        const buffer = Buffer.allocUnsafe(64 * 1024);
        let offset = 0;
        while (offset < Number(before.size)) {
            const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, Number(before.size) - offset), offset);
            if (bytesRead === 0) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_CHANGED');
            hash.update(buffer.subarray(0, bytesRead));
            offset += bytesRead;
        }
        if (identity(actual) !== identity(await handle.stat({ bigint: true }))) {
            throw new ComicMediaFilesArchiveError('COMIC_MEDIA_CHANGED');
        }
        digest = hash.digest('hex');
    } finally { await handle.close(); }
    const after = await lstat(path, { bigint: true });
    if (identity(before) !== identity(after)) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_CHANGED');
    return digest;
}

async function safeMkdirs(root: string, relativeDirectory: string): Promise<void> {
    if (!relativeDirectory) return;
    let path = root;
    for (const part of relativeDirectory.split('/')) {
        path = join(path, part);
        try { await mkdir(path, { mode: 0o700 }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        const info = await lstat(path);
        if (!info.isDirectory() || info.isSymbolicLink() || !isInside(root, await realpath(path))) {
            throw new ComicMediaFilesArchiveError('COMIC_MEDIA_UNSAFE');
        }
    }
}

async function copyVerified(source: string, destination: string, expectedSize: number, allowedSourceRoot: string, expectedSha256?: string): Promise<string> {
    if (!isInside(allowedSourceRoot, await realpath(source))) {
        throw new ComicMediaFilesArchiveError('COMIC_MEDIA_UNSAFE');
    }
    const sourceHandle = await open(source, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    let destinationHandle: Awaited<ReturnType<typeof open>> | undefined;
    let created = false;
    try {
        const before = await sourceHandle.stat({ bigint: true });
        if (!before.isFile() || before.nlink !== 1n || before.size !== BigInt(expectedSize)) {
            throw new ComicMediaFilesArchiveError('COMIC_MEDIA_CHANGED');
        }
        destinationHandle = await open(destination, 'wx', 0o600);
        created = true;
        const hash = createHash('sha256');
        const buffer = Buffer.allocUnsafe(64 * 1024);
        let offset = 0;
        while (offset < expectedSize) {
            const { bytesRead } = await sourceHandle.read(buffer, 0, Math.min(buffer.length, expectedSize - offset), offset);
            if (bytesRead === 0) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_CHANGED');
            hash.update(buffer.subarray(0, bytesRead));
            let written = 0;
            while (written < bytesRead) {
                const result = await destinationHandle.write(buffer, written, bytesRead - written, offset + written);
                if (result.bytesWritten <= 0) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_CHANGED');
                written += result.bytesWritten;
            }
            offset += bytesRead;
        }
        const after = await sourceHandle.stat({ bigint: true });
        const current = await lstat(source, { bigint: true });
        if (identity(before) !== identity(after) || identity(before) !== identity(current)
            || !isInside(allowedSourceRoot, await realpath(source))) {
            throw new ComicMediaFilesArchiveError('COMIC_MEDIA_CHANGED');
        }
        const digest = hash.digest('hex');
        if (expectedSha256 && digest !== expectedSha256) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_ARCHIVE_INVALID');
        await destinationHandle.sync();
        return digest;
    } catch (error) {
        if (created) await rm(destination, { force: true }).catch(() => undefined);
        throw error;
    } finally {
        await destinationHandle?.close().catch(() => undefined);
        await sourceHandle.close().catch(() => undefined);
    }
}

function manifestContent(value: Omit<Manifest, 'contentSha256'>): string {
    return JSON.stringify(value);
}

function parseManifest(raw: Buffer, binding: string): Manifest {
    if (raw.byteLength < 1 || raw.byteLength > MAX_MANIFEST_BYTES) {
        throw new ComicMediaFilesArchiveError('COMIC_MEDIA_ARCHIVE_INVALID');
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw.toString('utf8')); }
    catch { throw new ComicMediaFilesArchiveError('COMIC_MEDIA_ARCHIVE_INVALID'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ComicMediaFilesArchiveError('COMIC_MEDIA_ARCHIVE_INVALID');
    }
    const item = parsed as Record<string, unknown>;
    if (!exactKeys(item, ['format', 'version', 'mediaFilesIncluded', 'workspaceBinding', 'projectSha256',
        'exportedAt', 'fileCount', 'totalBytes', 'contentSha256', 'files'])
        || item.format !== FORMAT || item.version !== VERSION || item.mediaFilesIncluded !== true
        || !hex(item.workspaceBinding) || !(item.projectSha256 === null || hex(item.projectSha256))
        || typeof item.exportedAt !== 'string' || Number.isNaN(Date.parse(item.exportedAt))
        || !Number.isSafeInteger(item.fileCount) || !Number.isSafeInteger(item.totalBytes)
        || !hex(item.contentSha256) || !Array.isArray(item.files)
        || item.fileCount !== item.files.length || item.files.length < 1 || item.files.length > MAX_FILES
        || (item.totalBytes as number) < 1 || (item.totalBytes as number) > MAX_TOTAL_BYTES) {
        throw new ComicMediaFilesArchiveError('COMIC_MEDIA_ARCHIVE_INVALID');
    }
    const files = item.files as unknown[];
    if (!files.every(file => file && typeof file === 'object' && !Array.isArray(file)
        && exactKeys(file as Record<string, unknown>, ['path', 'size', 'sha256'])
        && validRelativePath((file as MediaFile).path)
        && Number.isSafeInteger((file as MediaFile).size) && (file as MediaFile).size > 0
        && (file as MediaFile).size <= MAX_FILE_BYTES && hex((file as MediaFile).sha256))
        || files.reduce<number>((sum, file) => sum + (file as MediaFile).size, 0) !== item.totalBytes
        || new Set(files.map(file => (file as MediaFile).path.toLowerCase())).size !== files.length) {
        throw new ComicMediaFilesArchiveError('COMIC_MEDIA_ARCHIVE_INVALID');
    }
    const { contentSha256, ...content } = item;
    if (sha256(manifestContent(content as Omit<Manifest, 'contentSha256'>)) !== contentSha256) {
        throw new ComicMediaFilesArchiveError('COMIC_MEDIA_ARCHIVE_INVALID');
    }
    if (item.workspaceBinding !== binding) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_WORKSPACE_MISMATCH');
    return item as unknown as Manifest;
}

async function readManifest(archive: string, binding: string): Promise<Manifest> {
    const path = join(archive, 'manifest.json');
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > MAX_MANIFEST_BYTES) {
        throw new ComicMediaFilesArchiveError('COMIC_MEDIA_ARCHIVE_INVALID');
    }
    return parseManifest(await readFile(path), binding);
}

async function ensureArchiveContents(archive: string, manifest: Manifest): Promise<void> {
    const entries = await readdir(archive);
    if (entries.length !== 2 || !entries.includes('manifest.json') || !entries.includes('files')) {
        throw new ComicMediaFilesArchiveError('COMIC_MEDIA_ARCHIVE_INVALID');
    }
    const actual = await scanFiles(await canonicalDirectory(join(archive, 'files')));
    if (actual.length !== manifest.files.length || actual.some((file, index) => file.path !== manifest.files[index]?.path
        || file.size !== manifest.files[index]?.size)) {
        throw new ComicMediaFilesArchiveError('COMIC_MEDIA_ARCHIVE_INVALID');
    }
}

async function ensureEmptyTarget(root: string): Promise<void> {
    const directory = await mediaDirectory(root);
    if (directory && (await readdir(directory)).length > 0) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_NOT_EMPTY');
}

async function cleanupPriorStages(root: string): Promise<void> {
    for (const name of await readdir(root)) {
        if (!name.startsWith(RESTORE_PREFIX) || !name.endsWith('.owner')
            || !/^[a-f0-9-]{36}$/.test(name.slice(RESTORE_PREFIX.length, -'.owner'.length))) continue;
        const marker = join(root, name);
        const markerInfo = await lstat(marker).catch(() => undefined);
        if (!markerInfo?.isFile() || markerInfo.isSymbolicLink() || markerInfo.size !== RESTORE_MARKER.length) continue;
        if (await readFile(marker, 'utf8') !== RESTORE_MARKER) continue;
        const path = join(root, name.slice(0, -'.owner'.length));
        const info = await lstat(path).catch(() => undefined);
        if (info && (!info.isDirectory() || info.isSymbolicLink() || !isInside(root, await realpath(path)))) continue;
        if (info) await rm(path, { recursive: true, force: true });
        await rm(marker, { force: true });
    }
}

export async function withComicMediaFilesArchiveLock<T>(workspaceRoot: string, work: (root: string, assertOwned: () => void) => Promise<T>): Promise<T> {
    const root = await canonicalDirectory(resolve(workspaceRoot));
    let lost = false;
    let release: (() => Promise<void>) | undefined;
    let identity: { readonly dev: bigint; readonly ino: bigint } | undefined;
    try {
        release = await lockfile.lock(root, { realpath: true, stale: 60_000, update: 15_000,
            retries: { retries: 2, minTimeout: 100, maxTimeout: 300 },
            onCompromised: () => { lost = true; } });
        // Heartbeat compromise detection is asynchronous. A replaced lock must be rejected
        // before a former owner publishes files or releases the new owner's directory.
        const acquired = lstatSync(`${root}.lock`, { bigint: true });
        if (!acquired.isDirectory()) throw new Error('media archive lock is not a directory');
        identity = { dev: acquired.dev, ino: acquired.ino };
    } catch { throw new ComicMediaFilesArchiveError('COMIC_MEDIA_BUSY'); }
    const stillOwned = (): boolean => {
        if (lost || !identity) return false;
        try {
            const current = lstatSync(`${root}.lock`, { bigint: true });
            return current.isDirectory() && current.dev === identity.dev && current.ino === identity.ino;
        } catch { return false; }
    };
    try {
        return await work(root, () => { if (!stillOwned()) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_BUSY'); });
    } finally {
        // proper-lockfile releases by pathname. A former owner must preserve a replacement lock.
        // A release failure cannot roll back a committed rename; report the actual operation outcome.
        if (stillOwned()) await release!().catch(() => undefined);
    }
}

export async function exportComicMediaFilesArchive(
    workspaceRoot: string,
    destinationDirectory: string,
    beforePublish: () => void = () => undefined
): Promise<ComicMediaFilesArchiveResult> {
    return withComicMediaFilesArchiveLock(workspaceRoot, async (root, assertOwned) => {
        if (!isAbsolute(destinationDirectory)) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_UNSAFE');
        const destination = await canonicalDirectory(resolve(destinationDirectory));
        if (isInside(root, destination)) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_UNSAFE');
        const media = await mediaDirectory(root);
        const beforeFiles = await scanFiles(media);
        if (beforeFiles.length === 0) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_EMPTY');
        const beforeProject = await projectSha256(root);
        const id = randomUUID();
        const stage = join(destination, `.nextmux-comic-media-${id}.tmp`);
        const final = join(destination, `nextmux-comic-media-${id}${ARCHIVE_SUFFIX}`);
        await mkdir(stage, { mode: 0o700 });
        try {
            const copied: MediaFile[] = [];
            const fileRoot = join(stage, 'files');
            await mkdir(fileRoot, { mode: 0o700 });
            for (const file of beforeFiles) {
                assertOwned();
                await safeMkdirs(fileRoot, file.path.split('/').slice(0, -1).join('/'));
                copied.push({ path: file.path, size: file.size,
                    sha256: await copyVerified(file.absolutePath, join(fileRoot, ...file.path.split('/')), file.size, media!) });
            }
            const afterFiles = await scanFiles(await mediaDirectory(root));
            if (afterFiles.length !== beforeFiles.length || afterFiles.some((file, index) =>
                file.path !== beforeFiles[index]?.path || file.identity !== beforeFiles[index]?.identity)
                || await projectSha256(root) !== beforeProject) {
                throw new ComicMediaFilesArchiveError('COMIC_MEDIA_CHANGED');
            }
            const content: Omit<Manifest, 'contentSha256'> = {
                format: FORMAT, version: VERSION, mediaFilesIncluded: true, workspaceBinding: sha256(root),
                projectSha256: beforeProject, exportedAt: new Date().toISOString(),
                fileCount: copied.length, totalBytes: copied.reduce((sum, file) => sum + file.size, 0), files: copied
            };
            const manifest = { ...content, contentSha256: sha256(manifestContent(content)) };
            const handle = await open(join(stage, 'manifest.json'), 'wx', 0o600);
            try { await handle.writeFile(JSON.stringify(manifest)); await handle.sync(); }
            finally { await handle.close(); }
            assertOwned();
            if (await lstat(final).then(() => true, error => {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
                throw error;
            })) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_UNSAFE');
            beforePublish();
            await rename(stage, final);
            return { directoryPath: final, files: copied.length, bytes: content.totalBytes };
        } catch (error) {
            await rm(stage, { recursive: true, force: true }).catch(() => undefined);
            throw error;
        }
    });
}

export async function importComicMediaFilesArchive(
    workspaceRoot: string,
    archiveDirectory: string,
    guardPublish: (publish: () => Promise<void>) => Promise<void> = publish => publish()
): Promise<ComicMediaFilesArchiveResult> {
    return withComicMediaFilesArchiveLock(workspaceRoot, async (root, assertOwned) => {
        if (!isAbsolute(archiveDirectory) || !archiveDirectory.endsWith(ARCHIVE_SUFFIX)) {
            throw new ComicMediaFilesArchiveError('COMIC_MEDIA_ARCHIVE_INVALID');
        }
        const archive = await canonicalDirectory(resolve(archiveDirectory));
        if (isInside(root, archive)) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_UNSAFE');
        const manifest = await readManifest(archive, sha256(root));
        if (await projectSha256(root) !== manifest.projectSha256) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_PROJECT_CHANGED');
        await ensureArchiveContents(archive, manifest);
        await cleanupPriorStages(root);
        await ensureEmptyTarget(root);
        const stage = join(root, `${RESTORE_PREFIX}${randomUUID()}`);
        const owner = `${stage}.owner`;
        const marker = await open(owner, 'wx', 0o600);
        try { await marker.writeFile(RESTORE_MARKER); await marker.sync(); }
        finally { await marker.close(); }
        try {
            await mkdir(stage, { mode: 0o700 });
            for (const file of manifest.files) {
                assertOwned();
                await safeMkdirs(stage, file.path.split('/').slice(0, -1).join('/'));
                await copyVerified(join(archive, 'files', ...file.path.split('/')),
                    join(stage, ...file.path.split('/')), file.size, join(archive, 'files'), file.sha256);
            }
            let published = false;
            await guardPublish(async () => {
                if (published) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_UNSAFE');
                assertOwned();
                if (await projectSha256(root) !== manifest.projectSha256) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_PROJECT_CHANGED');
                await ensureEmptyTarget(root);
                // The target is absent after normal per-item deletion. Remove an empty directory only after
                // every file has passed validation, then publish the complete tree with one rename.
                const existing = await mediaDirectory(root);
                if (existing) await rmdir(existing);
                await rename(stage, join(root, COMIC_MEDIA_DIRECTORY));
                published = true;
            });
            if (!published) throw new ComicMediaFilesArchiveError('COMIC_MEDIA_UNSAFE');
            await rm(owner, { force: true }).catch(() => undefined);
            return { directoryPath: join(root, COMIC_MEDIA_DIRECTORY), files: manifest.fileCount, bytes: manifest.totalBytes };
        } catch (error) {
            await rm(stage, { recursive: true, force: true }).catch(() => undefined);
            await rm(owner, { force: true }).catch(() => undefined);
            throw error;
        }
    });
}

export async function inspectComicMediaFiles(workspaceRoot: string): Promise<{ readonly files: number; readonly bytes: number }> {
    const root = await canonicalDirectory(resolve(workspaceRoot));
    const files = await scanFiles(await mediaDirectory(root));
    return { files: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0) };
}

export async function clearComicMediaFiles(workspaceRoot: string, guard: (remove: () => Promise<void>) => Promise<void>): Promise<void> {
    await withComicMediaFilesArchiveLock(workspaceRoot, async (root, assertOwned) => {
        await guard(async () => {
            assertOwned();
            const media = await mediaDirectory(root);
            if (!media) return;
            await scanFiles(media); // Reject symlinks, devices, hard links and unbounded trees before deleting.
            assertOwned();
            const quarantine = join(root, `.nextmux-media-clear-${randomUUID()}`);
            await rename(media, quarantine);
            try { await rm(quarantine, { recursive: true, force: true }); }
            catch (error) {
                await rename(quarantine, media).catch(() => undefined);
                throw error;
            }
        });
    });
}
