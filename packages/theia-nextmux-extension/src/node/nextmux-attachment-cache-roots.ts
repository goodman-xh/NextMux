import { DesktopDomainError } from '../common/nextmux-domain-errors';
import { createHash, randomUUID } from 'crypto';
import { constants } from 'fs';
import { lstat, mkdir, open, readdir, realpath, rename, rm } from 'fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { readWorkspaceForkLayout } from '@nextmux/agent-runtime';

interface DirectoryIdentity {
    readonly path: string;
    readonly device: string;
    readonly inode: string;
    readonly birthtime: string;
}
export interface AttachmentCacheRoot {
    readonly path: string;
    readonly directories: readonly DirectoryIdentity[];
    readonly staged?: boolean;
}
export interface AttachmentCacheRoots {
    readonly roots: readonly AttachmentCacheRoot[];
    readonly unavailableRoots: number;
    readonly pendingStagingRoots: number;
}
interface RegisteredRoot {
    readonly version: 1;
    readonly workspaceRoot: string;
    readonly directories: readonly DirectoryIdentity[];
}

const registryName = 'attachment-cache-roots-v1';
const stagingName = 'attachment-cache-staging-v1';
const maximumEntries = 100_000;
const locks = new Map<string, Promise<void>>();
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';
const unsafe = (): Error => Object.assign(new DesktopDomainError('ATTACHMENT_ROOT_CHANGED', 'The attachment cache directory changed or is unsafe; it was not cleared'), { code: 'LOCAL_DATA_UNSAFE' });
const inside = (root: string, path: string): boolean => {
    const delta = relative(root, path);
    return !!delta && delta !== '..' && !delta.startsWith(`..${sep}`) && !isAbsolute(delta);
};
const same = (a: DirectoryIdentity, b: DirectoryIdentity): boolean =>
    a.path === b.path && a.device === b.device && a.inode === b.inode && a.birthtime === b.birthtime;

/** Shared by service instances in this host: clear cannot race a cache write. */
export async function withAttachmentRootLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
    const previous = locks.get(path) || Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>(done => { release = done; });
    const tail = previous.then(() => held);
    locks.set(path, tail);
    await previous;
    try { return await operation(); }
    finally { release(); if (locks.get(path) === tail) locks.delete(path); }
}

async function directoryIdentity(path: string): Promise<DirectoryIdentity> {
    const info = await lstat(path, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) throw unsafe();
    return { path, device: String(info.dev), inode: String(info.ino), birthtime: String(info.birthtimeNs) };
}

async function chain(anchor: string, segments: readonly string[], create = false): Promise<AttachmentCacheRoot> {
    const directories = [await directoryIdentity(anchor)];
    let path = anchor;
    for (const segment of segments) {
        if (!segment || segment === '.' || segment === '..' || segment.includes(sep) || isAbsolute(segment)) throw unsafe();
        path = join(path, segment);
        if (create) {
            // Never mkdir recursively through a project-controlled .nextmux link.
            await assertAttachmentCacheRoot({ path: dirname(path), directories });
            await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
        }
        directories.push(await directoryIdentity(path));
    }
    const result = { path, directories };
    await assertAttachmentCacheRoot(result);
    return result;
}

async function profileRoot(dataRoot: string, create = false): Promise<string> {
    const path = resolve(dataRoot);
    if (create) await mkdir(path, { recursive: true, mode: 0o700 });
    // The configured profile itself must not become a symlink.
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw unsafe();
    return realpath(path);
}

async function workspaceCache(dataRoot: string, workspaceRoot: string, create = false): Promise<AttachmentCacheRoot> {
    if (!isAbsolute(workspaceRoot) || workspaceRoot.length > 4096 || /[\0\r\n]/.test(workspaceRoot)
        || resolve(workspaceRoot) !== workspaceRoot || dirname(workspaceRoot) === workspaceRoot) throw unsafe();
    const owned = join(dataRoot, 'conversation-workspaces');
    // Validate every private-fork ancestor, not only its final project directory.
    return inside(owned, workspaceRoot)
        ? chain(dataRoot, [...relative(dataRoot, workspaceRoot).split(sep), '.nextmux', 'conversation-attachments'], create)
        : chain(workspaceRoot, ['.nextmux', 'conversation-attachments'], create);
}

export async function prepareAttachmentCacheRoot(dataRoot: string, workspaceRoot?: string): Promise<AttachmentCacheRoot> {
    const profile = await profileRoot(dataRoot, true);
    return workspaceRoot ? workspaceCache(profile, workspaceRoot, true) : chain(profile, ['conversation-attachments'], true);
}

export async function assertAttachmentCacheRoot(root: AttachmentCacheRoot): Promise<void> {
    for (const expected of root.directories) if (!same(expected, await directoryIdentity(expected.path))) throw unsafe();
}

/** Only call after the host has authorized a successful project cache write. */
export async function registerAttachmentCacheRoot(dataRoot: string, workspaceRoot: string, root: AttachmentCacheRoot): Promise<void> {
    const profile = await profileRoot(dataRoot, true);
    const expected = await workspaceCache(profile, workspaceRoot);
    if (root.path !== expected.path || root.directories.length !== expected.directories.length
        || root.directories.some((entry, index) => !same(entry, expected.directories[index]))) throw unsafe();
    const registry = await chain(profile, [registryName], true);
    const target = join(registry.path, `${createHash('sha256').update(workspaceRoot).digest('hex')}.json`);
    const temporary = join(registry.path, `.write-${randomUUID()}`);
    const record: RegisteredRoot = { version: 1, workspaceRoot, directories: root.directories };
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
    try {
        try {
            await handle.writeFile(JSON.stringify(record));
            await handle.sync();
        } finally { await handle.close(); }
        await assertAttachmentCacheRoot(root);
        await assertAttachmentCacheRoot(registry);
        await rename(temporary, target);
        await assertAttachmentCacheRoot(registry);
        await assertAttachmentCacheRoot(root);
    } finally {
        // Never clean up through a substituted registry directory.
        await assertAttachmentCacheRoot(registry).then(() => rm(temporary, { force: true })).catch(() => undefined);
    }
}

/** Fixed app-owned locations plus write receipts; history strings confer no deletion authority. */
export async function resolveAttachmentCacheRoots(dataRoot: string): Promise<AttachmentCacheRoots> {
    const roots = new Map<string, AttachmentCacheRoot>();
    let unavailableRoots = 0;
    let profile: string;
    try { profile = await profileRoot(dataRoot); }
    catch (error) { return { roots: [], unavailableRoots: missing(error) ? 0 : 1, pendingStagingRoots: 0 }; }
    const collect = async (operation: () => Promise<AttachmentCacheRoot>): Promise<void> => {
        try { const root = await operation(); roots.set(root.path, root); }
        catch (error) { if (!missing(error)) unavailableRoots++; }
    };
    await collect(() => chain(profile, ['conversation-attachments']));
    try {
        const container = await chain(profile, ['conversation-workspaces']);
        const entries = await readdir(container.path, { withFileTypes: true });
        if (entries.length > maximumEntries) throw unsafe();
        for (const entry of entries) {
            if (!/^[0-9a-f-]{36}$/i.test(entry.name)) continue;
            if (entry.isSymbolicLink() || !entry.isDirectory()) { unavailableRoots++; continue; }
            const path = join(container.path, entry.name);
            await collect(() => workspaceCache(profile, path));
            try {
                const owned = await chain(profile, ['conversation-workspaces', entry.name]);
                const layout = await readWorkspaceForkLayout(path);
                await assertAttachmentCacheRoot(owned);
                for (const item of layout?.workspaces || []) await collect(() => workspaceCache(profile, item.workspaceRoot));
            } catch (error) { if (!missing(error)) unavailableRoots++; }
        }
        await assertAttachmentCacheRoot(container);
    } catch (error) { if (!missing(error)) unavailableRoots++; }
    try {
        const registry = await chain(profile, [registryName]);
        const entries = await readdir(registry.path, { withFileTypes: true });
        if (entries.length > maximumEntries) throw unsafe();
        for (const entry of entries) {
            if (!/^[a-f0-9]{64}\.json$/.test(entry.name)) continue;
            try {
                if (!entry.isFile() || entry.isSymbolicLink()) throw unsafe();
                const path = join(registry.path, entry.name);
                const before = await lstat(path, { bigint: true });
                if (!before.isFile() || before.isSymbolicLink() || before.size > 128n * 1024n) throw unsafe();
                const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
                let raw: string;
                try {
                    const opened = await handle.stat({ bigint: true });
                    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw unsafe();
                    raw = await handle.readFile('utf8');
                } finally { await handle.close(); }
                await assertAttachmentCacheRoot(registry);
                const record = JSON.parse(raw) as RegisteredRoot;
                if (record.version !== 1 || typeof record.workspaceRoot !== 'string' || !Array.isArray(record.directories)
                    || `${createHash('sha256').update(record.workspaceRoot).digest('hex')}.json` !== entry.name) throw unsafe();
                const current = await workspaceCache(profile, record.workspaceRoot);
                if (record.directories.length !== current.directories.length
                    || record.directories.some((value, index) => !value || !same(value, current.directories[index]))) throw unsafe();
                roots.set(current.path, current);
            } catch (error) { if (!missing(error)) unavailableRoots++; }
        }
    } catch (error) { if (!missing(error)) unavailableRoots++; }
    let pendingStagingRoots = 0;
    try {
        const staging = await chain(profile, [stagingName]);
        const entries = await readdir(staging.path, { withFileTypes: true });
        if (entries.length > maximumEntries) throw unsafe();
        for (const entry of entries) {
            if (!/^[0-9a-f-]{36}$/i.test(entry.name)) continue;
            pendingStagingRoots++;
            try {
                if (!entry.isDirectory() || entry.isSymbolicLink()) throw unsafe();
                const current = await chain(profile, [stagingName, entry.name]);
                const receiptPath = join(staging.path, `${entry.name}.json`);
                const metadata = await lstat(receiptPath);
                if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 16_384) throw unsafe();
                const handle = await open(receiptPath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
                let raw: string;
                try { raw = await handle.readFile('utf8'); } finally { await handle.close(); }
                const receipt = JSON.parse(raw) as { version?: number; identity?: DirectoryIdentity };
                const actual = current.directories[current.directories.length - 1];
                if (receipt.version !== 1 || !receipt.identity || !same({ ...receipt.identity, path: current.path }, actual)) throw unsafe();
                await assertAttachmentCacheRoot(staging);
                roots.set(current.path, { ...current, staged: true });
            } catch { unavailableRoots++; }
        }
    } catch (error) { if (!missing(error)) unavailableRoots++; }
    return { roots: [...roots.values()].sort((a, b) => a.path.localeCompare(b.path)), unavailableRoots, pendingStagingRoots };
}

/** Caches are flat. Reject unknown directories/links instead of recursively following them. */
export async function measureAttachmentCacheRoot(root: AttachmentCacheRoot): Promise<{ bytes: number; files: number }> {
    await assertAttachmentCacheRoot(root);
    const entries = await readdir(root.path, { withFileTypes: true });
    if (entries.length > maximumEntries) throw unsafe();
    let bytes = 0;
    for (const entry of entries) {
        const info = await lstat(join(root.path, entry.name));
        if (entry.isSymbolicLink() || !entry.isFile() || info.isSymbolicLink() || !info.isFile()) throw unsafe();
        bytes += info.size;
    }
    await assertAttachmentCacheRoot(root);
    return { bytes, files: entries.length };
}

export async function assertAttachmentCachesClearable(dataRoot: string, roots: readonly AttachmentCacheRoot[]): Promise<void> {
    const profile = await profileRoot(dataRoot, true);
    const staging = await chain(profile, [stagingName], true);
    const stagingDevice = staging.directories[staging.directories.length - 1].device;
    for (const root of roots) {
        await measureAttachmentCacheRoot(root);
        if (root.directories[root.directories.length - 1].device !== stagingDevice) {
            throw Object.assign(new DesktopDomainError('ATTACHMENT_CROSS_DEVICE', 'The attachment cache is on another disk and cannot be moved safely; cleanup did not start'), { code: 'LOCAL_DATA_CROSS_DEVICE' });
        }
    }
}

export async function clearAttachmentCacheRoot(dataRoot: string, root: AttachmentCacheRoot): Promise<void> {
    await withAttachmentRootLock(root.path, async () => {
        await assertAttachmentCachesClearable(dataRoot, [root]);
        const profile = await profileRoot(dataRoot);
        const staging = await chain(profile, [stagingName]);
        if (root.staged) {
            if (dirname(root.path) !== staging.path) throw unsafe();
            await assertAttachmentCacheRoot(root);
            await rm(root.path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
            await rm(`${root.path}.json`, { force: true });
            return;
        }
        const id = randomUUID(), quarantine = join(staging.path, id);
        const receiptPath = `${quarantine}.json`;
        const expected = root.directories[root.directories.length - 1];
        // Persist an intent before moving bytes. After a crash or failed rm, the
        // resolver counts identity-matching staged caches and offers retry. A
        // substituted directory remains quarantined but is never auto-deleted.
        const receipt = await open(receiptPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
        try { await receipt.writeFile(JSON.stringify({ version: 1, identity: expected })); await receipt.sync(); }
        finally { await receipt.close(); }
        await assertAttachmentCacheRoot(root);
        await assertAttachmentCacheRoot(staging);
        await rename(root.path, quarantine); // EXDEV deliberately has no copy/delete fallback.
        await assertAttachmentCacheRoot(staging);
        const moved = await directoryIdentity(quarantine);
        if (!same({ ...expected, path: quarantine }, moved)) throw unsafe();
        // rm traverses only the app-owned staging path, never a replaceable project ancestor.
        await rm(quarantine, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        await rm(receiptPath, { force: true });
    });
}
