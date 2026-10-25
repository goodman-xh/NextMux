import { constants, type Stats } from 'node:fs';
import { copyFile, link, lstat, mkdir, mkdtemp, open, realpath, rename, rm, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

type Extension = 'mp4' | 'srt' | 'vtt' | 'ass';
type Identity = Pick<Stats, 'dev' | 'ino' | 'size' | 'mtimeMs' | 'ctimeMs'>;
export type ComicExportFiles = Readonly<{ mp4: string; srt?: string; vtt?: string; ass?: string }>;
export interface ComicExportDestinationPlan {
    readonly directory: string;
    readonly directoryIdentity?: Identity;
    readonly stem: string;
    readonly targets: readonly { readonly extension: Extension; readonly path: string; readonly identity?: Identity }[];
}

export class ComicExportDestinationError extends Error {
    constructor(readonly code: 'COMIC_EXPORT_DESTINATION_CONFLICT' | 'COMIC_EXPORT_DESTINATION_CHANGED' | 'COMIC_EXPORT_DESTINATION_UNSAFE' | 'COMIC_EXPORT_DESTINATION_RECOVERY', message: string) {
        super(message); this.name = 'ComicExportDestinationError';
    }
}

/** Shared by the destination preview, project output and final publication. */
export function comicExportFileStem(value: string | undefined, fallback: string): string {
    const source = (value?.trim() || fallback.trim() || 'nextmux-film').normalize('NFKC');
    const stem = source.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/[. ]+$/g, '')
        .replace(/\s*[·・•|｜—–]+\s*/g, '-').replace(/\s+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/[. ]+$/g, '') || 'nextmux-film';
    // Win32 reserves device names even before an extension, and regardless of case.
    return /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem) ? `_${stem}` : stem;
}

async function inspect(path: string): Promise<Stats | undefined> {
    try { return await lstat(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

function sameFile(left: Identity | undefined, right: Identity | undefined, checkChangeTime = true): boolean {
    return !left || !right ? left === right : left.dev === right.dev && left.ino === right.ino && left.size === right.size
        && left.mtimeMs === right.mtimeMs && (!checkChangeTime || left.ctimeMs === right.ctimeMs);
}

function unsafe(path: string): never {
    throw new ComicExportDestinationError('COMIC_EXPORT_DESTINATION_UNSAFE', `Export destination is not a regular file or directory: ${path}`);
}

/** Read-only. Canonicalizes existing parents, so a later symlink retarget cannot redirect publication. */
export async function prepareComicExportDestination(directory: string, stem: string, subtitles: boolean, conflict?: 'error' | 'overwrite'): Promise<ComicExportDestinationPlan> {
    if (!isAbsolute(directory) || directory.includes('\0') || directory.length > 4096) unsafe(directory);
    let ancestor = resolve(directory);
    const missing: string[] = [];
    let metadata = await inspect(ancestor);
    while (!metadata) {
        missing.unshift(basename(ancestor));
        const parent = dirname(ancestor);
        if (parent === ancestor) unsafe(directory);
        ancestor = parent;
        metadata = await inspect(ancestor);
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) unsafe(ancestor);
    const canonical = join(await realpath(ancestor), ...missing);
    const directoryIdentity = missing.length ? undefined : metadata;
    const targets: ComicExportDestinationPlan['targets'][number][] = [];
    for (const extension of (subtitles ? ['mp4', 'srt', 'vtt', 'ass'] : ['mp4']) as Extension[]) {
        const path = join(canonical, `${stem}.${extension}`);
        const identity = await inspect(path);
        if (identity && (!identity.isFile() || identity.isSymbolicLink())) unsafe(path);
        targets.push({ extension, path, ...(identity ? { identity } : {}) });
    }
    const conflicts = targets.filter(target => target.identity).map(target => basename(target.path));
    if (conflict === 'error' && conflicts.length) throw new ComicExportDestinationError('COMIC_EXPORT_DESTINATION_CONFLICT', `Export files already exist: ${conflicts.join(', ')}`);
    return { directory: canonical, ...(directoryIdentity ? { directoryIdentity } : {}), stem, targets };
}

function checkCancelled(signal?: AbortSignal): void { signal?.throwIfAborted(); }

/** Filesystem operations are injectable for deterministic disk-full / locked-file recovery tests. */
export interface ComicExportPublishOperations {
    readonly copyFile: typeof copyFile;
    readonly rename: typeof rename;
    readonly link: typeof link;
    readonly unlink: typeof unlink;
}
const defaultOperations: ComicExportPublishOperations = { copyFile, rename, link, unlink };

/**
 * Publish one video/subtitle set. Originals are untouched until every new file has been staged on
 * the destination volume. Each final name is claimed exclusively; never rename over a target.
 * A failed rollback retains its private backup directory and reports its location for recovery.
 */
export async function publishComicExportDestination(plan: ComicExportDestinationPlan, files: ComicExportFiles, signal?: AbortSignal,
    operations: ComicExportPublishOperations = defaultOperations): Promise<{ readonly savedPath: string; readonly savedSubtitlePaths?: { readonly srt: string; readonly vtt: string; readonly ass: string } }> {
    checkCancelled(signal);
    await mkdir(plan.directory, { recursive: true });
    const directory = await lstat(plan.directory);
    if (!directory.isDirectory() || directory.isSymbolicLink()) unsafe(plan.directory);
    if (await realpath(plan.directory) !== plan.directory) unsafe(plan.directory);
    if (plan.directoryIdentity && (directory.dev !== plan.directoryIdentity.dev || directory.ino !== plan.directoryIdentity.ino))
        throw new ComicExportDestinationError('COMIC_EXPORT_DESTINATION_CHANGED', 'Export folder changed during rendering.');
    const assertDirectory = async (): Promise<void> => {
        const current = await lstat(plan.directory);
        if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== directory.dev || current.ino !== directory.ino
            || await realpath(plan.directory) !== plan.directory)
            throw new ComicExportDestinationError('COMIC_EXPORT_DESTINATION_CHANGED', 'Export folder changed during saving.');
    };
    const assertUnchanged = async (target: ComicExportDestinationPlan['targets'][number]): Promise<void> => {
        const current = await inspect(target.path);
        if (current && (!current.isFile() || current.isSymbolicLink())) unsafe(target.path);
        if (!sameFile(target.identity, current)) throw new ComicExportDestinationError('COMIC_EXPORT_DESTINATION_CHANGED', `Export target changed during rendering: ${basename(target.path)}`);
    };
    for (const target of plan.targets) await assertUnchanged(target);
    const staging = await mkdtemp(join(plan.directory, '.nextmux-export-'));
    const backups: { target: string; path: string; identity: Identity }[] = [];
    const published: { path: string; identity: Identity }[] = [];
    let keepBackup = false;
    // Hard links are atomic exclusive claims on NTFS/APFS. Other filesystems use an exclusively
    // opened file descriptor, so a copy failure can remove only the file this operation created.
    const claim = async (source: string, target: string): Promise<void> => {
        try { await operations.link(source, target); }
        catch (error) {
            if (!['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
            const handle = await open(target, 'wx', 0o600);
            const owned = await handle.stat();
            try {
                const input = await open(source, 'r');
                try {
                    const buffer = Buffer.allocUnsafe(1024 * 1024);
                    let position = 0;
                    for (;;) {
                        const { bytesRead } = await input.read(buffer, 0, buffer.length, position);
                        if (!bytesRead) break;
                        let written = 0;
                        while (written < bytesRead) written += (await handle.write(buffer, written, bytesRead - written, position + written)).bytesWritten;
                        position += bytesRead;
                    }
                    await handle.sync();
                } finally { await input.close(); }
            } catch (copyError) {
                await handle.close();
                const current = await inspect(target);
                if (current?.dev === owned.dev && current.ino === owned.ino) await operations.unlink(target);
                throw copyError;
            }
            await handle.close();
        }
    };
    try {
        for (const target of plan.targets) {
            checkCancelled(signal);
            const source = files[target.extension];
            if (!source) continue;
            const metadata = await lstat(source);
            if (!metadata.isFile() || metadata.isSymbolicLink()) unsafe(source);
            const path = join(staging, `new.${target.extension}`);
            await operations.copyFile(source, path, constants.COPYFILE_EXCL);
            const handle = await open(path, 'r+');
            try { await handle.sync(); } finally { await handle.close(); }
        }
        checkCancelled(signal);
        // Recheck the whole group after copying: staging a large video can take a while.
        await assertDirectory();
        for (const target of plan.targets) await assertUnchanged(target);
        for (const target of plan.targets) {
            checkCancelled(signal);
            await assertDirectory();
            await assertUnchanged(target);
            if (target.identity) {
                const path = join(staging, `old.${target.extension}`);
                await operations.rename(target.path, path);
                const identity = await lstat(path);
                backups.push({ target: target.path, path, identity });
                if (!sameFile(target.identity, identity, false))
                    throw new ComicExportDestinationError('COMIC_EXPORT_DESTINATION_CHANGED', `Export target changed before replacement: ${basename(target.path)}`);
            }
            checkCancelled(signal);
            if (files[target.extension]) {
                await claim(join(staging, `new.${target.extension}`), target.path);
                published.push({ path: target.path, identity: await lstat(target.path) });
            }
        }
        checkCancelled(signal);
    } catch (error) {
        // Do not delete an unrelated file that appeared while publishing or rolling back.
        for (const item of published.reverse()) {
            try {
                if (!sameFile(item.identity, await inspect(item.path), false)) { keepBackup = true; continue; }
                await operations.unlink(item.path);
            } catch { keepBackup = true; }
        }
        for (const backup of backups.reverse()) {
            try { await claim(backup.path, backup.target); }
            catch { keepBackup = true; }
        }
        if (keepBackup) throw new ComicExportDestinationError('COMIC_EXPORT_DESTINATION_RECOVERY', `Export was not replaced completely. Original files are preserved in ${staging}. ${String(error)}`);
        throw error;
    } finally {
        if (!keepBackup) await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
    // Publication is committed. A late cancellation cannot undo a successful save.
    for (const source of Object.values(files)) if (source) await unlink(source).catch(() => undefined);
    const savedPath = join(plan.directory, `${plan.stem}.mp4`);
    return files.srt && files.vtt && files.ass ? { savedPath, savedSubtitlePaths: {
        srt: join(plan.directory, `${plan.stem}.srt`), vtt: join(plan.directory, `${plan.stem}.vtt`), ass: join(plan.directory, `${plan.stem}.ass`)
    } } : { savedPath };
}
