import { mkdir, open, readdir, readFile, rename, rm } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
// Reuse the project's maintained, cross-process atomic mkdir lock.
const lockfile = require('proper-lockfile') as { lock(path: string, options: Record<string, unknown>): Promise<() => Promise<void>> };

/** One bounded high-water record per schedule prevents two windows/restarts billing the same occurrence. */
export async function claimScheduledOccurrence(root: string, taskId: string, occurrenceAt: number): Promise<boolean> {
    if (!/^[0-9a-f-]{36}$/i.test(taskId) || !Number.isSafeInteger(occurrenceAt) || occurrenceAt < 1 || occurrenceAt > Date.now() + 60_000) {
        throw new Error('INVALID_SCHEDULE_OCCURRENCE');
    }
    await mkdir(root, { recursive: true, mode: 0o700 });
    const target = join(root, `${taskId}.json`);
    const release = await lockfile.lock(target, { realpath: false, stale: 30_000,
        retries: { retries: 100, minTimeout: 10, maxTimeout: 100 } });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
        let previous = 0;
        try {
            const saved = JSON.parse(await readFile(target, 'utf8')) as { occurrenceAt?: number };
            if (!Number.isSafeInteger(saved.occurrenceAt)) throw new Error('SCHEDULE_CLAIM_CORRUPT');
            previous = saved.occurrenceAt!;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (previous >= occurrenceAt) return false;
        // The lock can be taken over twice when it goes stale (two processes both judge the same old lock dead).
        // Creating this occurrence's own marker file is atomic, so only one of them can claim it (audit B14-02).
        const marker = join(root, `${taskId}.${occurrenceAt}.claim`);
        try { await (await open(marker, 'wx', 0o600)).close(); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
        for (const name of await readdir(root).catch(() => [] as string[])) {
            const match = /^(.+)\.(\d+)\.claim$/.exec(name);
            if (match && match[1] === taskId && Number(match[2]) < occurrenceAt) await rm(join(root, name), { force: true });
        }
        const file = await open(temporary, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify({ occurrenceAt }), 'utf8'); await file.sync(); }
        finally { await file.close(); }
        await rename(temporary, target);
        if (process.platform !== 'win32') {
            const directory = await open(root, 'r');
            try { await directory.sync(); } finally { await directory.close(); }
        }
        return true;
    } finally { await rm(temporary, { force: true }); await release(); }
}
