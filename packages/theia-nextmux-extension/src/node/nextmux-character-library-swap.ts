import { mkdir, readdir, rename, rm, stat } from 'fs/promises';
import { join, resolve } from 'path';

const lockfile = require('proper-lockfile') as {
    lock(path: string, options: Record<string, unknown>): Promise<() => Promise<void>>;
};
const queues = new Map<string, Promise<unknown>>();
const bundleName = /^bundle-[0-9a-f-]{36}$/i;

async function exists(path: string): Promise<boolean> {
    try { await stat(path); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** All connections/processes use this lock, including readers doing startup recovery. */
export async function withCharacterLibraryLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
    const key = resolve(root);
    const previous = queues.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
        await mkdir(root, { recursive: true, mode: 0o700 });
        const release = await lockfile.lock(root, { realpath: false, stale: 30_000, update: 10_000, onCompromised: () => {},
            retries: { retries: 100, minTimeout: 20, maxTimeout: 100 } });
        try { return await operation(); } finally { await release(); }
    });
    queues.set(key, current);
    try { return await current; } finally { if (queues.get(key) === current) queues.delete(key); }
}

/** The deterministic backup/staging names are the recovery record, written before either rename. */
export async function recoverCharacterLibrarySwaps(root: string, validate: (path: string) => Promise<void>): Promise<void> {
    const entries = await readdir(root);
    const bundles = new Set(entries.flatMap(name => {
        const id = name.replace(/^\.(?:backup|staging)-/, '');
        return name !== id && bundleName.test(id) ? [id] : [];
    }));
    for (const id of bundles) {
        const target = join(root, id), backup = join(root, `.backup-${id}`), staging = join(root, `.staging-${id}`);
        if (await exists(target)) {
            // Never remove the backup until the published replacement is readable.
            try { await validate(target); } catch (error) {
                if (!(await exists(backup)) || await exists(staging)) throw error;
                await validate(backup);
                await rename(target, staging);
                await rename(backup, target);
            }
        } else if (await exists(backup)) {
            await validate(backup);
            await rename(backup, target);
        } else if (await exists(staging)) {
            // An interrupted first save has no old copy. Only publish a complete staging directory.
            try { await validate(staging); } catch { await rm(staging, { recursive: true, force: true }); continue; }
            await rename(staging, target);
        }
        await rm(backup, { recursive: true, force: true }).catch(() => undefined);
        await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
}

/** Caller holds the library lock from lookup through publication (also serializes first saves). */
export async function replaceCharacterLibraryBundle(root: string, id: string,
    prepare: (staging: string) => Promise<void>, validate: (path: string) => Promise<void>): Promise<void> {
    if (!bundleName.test(id)) throw new Error('INVALID_CHARACTER_BUNDLE_ID');
    const target = join(root, id), backup = join(root, `.backup-${id}`), staging = join(root, `.staging-${id}`);
    if (await exists(backup) || await exists(staging)) throw new Error('CHARACTER_LIBRARY_RECOVERY_PENDING');
    let movedOld = false, published = false;
    try {
        await prepare(staging);
        await validate(staging);
        if (await exists(target)) { await rename(target, backup); movedOld = true; }
        await rename(staging, target);
        published = true;
        await validate(target);
    } catch (error) {
        if (movedOld) {
            // If Windows still holds the new directory open, leave both copies for startup recovery.
            if (published) await rename(target, staging).catch(() => undefined);
            if (!(await exists(target))) await rename(backup, target).catch(() => undefined);
        }
        // Do not erase staging or backup on failure: either may be the only complete copy.
        throw error;
    }
    // A Windows file lock on cleanup is harmless; recovery retries it on the next access.
    await rm(backup, { recursive: true, force: true }).catch(() => undefined);
}
