import { DesktopDomainError } from '../common/nextmux-domain-errors';
import { scheduleDomainMessage } from '../common/nextmux-schedule-domain';
import { mkdir, open, rename, rm } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { SCHEDULE_PROMPT_MAX_CHARACTERS, validScheduleTime, type ScheduledTaskRecord } from '../common/nextmux-schedule';
const lockfile = require('proper-lockfile') as { lock(path: string, options: Record<string, unknown>): Promise<() => Promise<void>> };

const STORE_BYTES = 16 * 1024 * 1024;
// The old writer counted UTF-16 characters: valid legacy UTF-8 can be three
// times larger. Such stores remain readable, but can only be reduced in size.
const LEGACY_RECOVERY_BYTES = STORE_BYTES * 3;

function validated(value: unknown): ScheduledTaskRecord {
    const task = value as ScheduledTaskRecord;
    if (!task || !/^[0-9a-f-]{36}$/i.test(task.id) || typeof task.workspacePath !== 'string' || task.workspacePath.length > 4096
        || typeof task.title !== 'string' || !task.title.trim() || task.title.length > 80 || typeof task.prompt !== 'string'
        || !task.prompt.trim() || task.prompt.length > SCHEDULE_PROMPT_MAX_CHARACTERS || !['once', 'daily', 'weekly'].includes(task.cadence)
        || !validScheduleTime(task.cadence, task.runAt) || typeof task.enabled !== 'boolean' || !Number.isFinite(task.createdAt)
        || task.weekday !== undefined && (!Number.isInteger(task.weekday) || task.weekday < 0 || task.weekday > 6)
        || JSON.stringify(task).length > 32_000) throw new DesktopDomainError('SCHEDULE_RECORD_INVALID', "The saved schedule is invalid. Review its settings before retrying.");
    return task;
}

/** Small, local, atomically updated plan metadata; never sent to the hosted gateway. */
export async function updateScheduledTaskStore(root: string, patch?: { upsert: readonly ScheduledTaskRecord[]; remove: readonly string[]; expectedRevisions?: Readonly<Record<string, number>>; runtimeOnly?: boolean;
    /** Field merges into the stored record under the lock (only while its definition revision still matches). */
    merge?: readonly { readonly id: string; readonly definitionRevision: number; readonly fields: Partial<Pick<ScheduledTaskRecord, 'backgroundMode' | 'backgroundMessage'>> }[] },
    legacy?: readonly ScheduledTaskRecord[]): Promise<readonly ScheduledTaskRecord[]> {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const target = join(root, 'tasks.json');
    const release = await lockfile.lock(target, { realpath: false, stale: 30_000,
        retries: { retries: 100, minTimeout: 10, maxTimeout: 100 } });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
        let tasks: readonly ScheduledTaskRecord[];
        let initialized = true;
        let previousBytes = 0;
        try {
            const file = await open(target, 'r');
            let raw: string;
            try {
                previousBytes = (await file.stat()).size;
                if (previousBytes > LEGACY_RECOVERY_BYTES) throw new DesktopDomainError('SCHEDULE_STORE_TOO_LARGE', "The saved schedules exceed the local storage limit.");
                raw = await file.readFile('utf8');
                if (Buffer.byteLength(raw, 'utf8') > LEGACY_RECOVERY_BYTES) throw new DesktopDomainError('SCHEDULE_STORE_TOO_LARGE', "The saved schedules exceed the local storage limit.");
            }
            finally { await file.close(); }
            const stored = JSON.parse(raw) as { version?: number; tasks?: unknown[] };
            if (stored.version !== 1 || !Array.isArray(stored.tasks)) throw new DesktopDomainError('SCHEDULE_STORE_CORRUPT', "The saved schedule data is damaged. The original file has been preserved.");
            tasks = stored.tasks.map(validated);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            initialized = false;
            tasks = (legacy || []).map(validated);
        }
        const previousIds = new Set(tasks.map(task => task.id));
        if (patch) {
            const byId = new Map(tasks.map(task => [task.id, task]));
            for (const [id, revision] of Object.entries(patch.expectedRevisions || {})) {
                const current = byId.get(id);
                if ((current?.definitionRevision ?? 0) !== revision || revision > 0 && !current) {
                    throw new DesktopDomainError('SCHEDULE_VERSION_CONFLICT', scheduleDomainMessage('SCHEDULE_VERSION_CONFLICT').fallbackEnglish);
                }
            }
            for (const id of patch.remove) byId.delete(id);
            // Merging (not replacing) keeps runtime state another writer stored meanwhile — a pause, an error, the
            // last run — which a stale whole-record upsert of the same definition revision used to wipe (audit C35-06).
            for (const change of patch.merge || []) {
                const current = byId.get(change.id);
                if (!current || (current.definitionRevision ?? 0) !== change.definitionRevision) continue;
                const merged = { ...current, ...change.fields };
                validated(merged);
                byId.set(change.id, merged);
            }
            for (const task of patch.upsert) {
                validated(task);
                const current = byId.get(task.id);
                // A renderer may finish an old occurrence after the plan was edited/deleted elsewhere.
                // It must not resurrect that plan or restore its old model, permissions or enabled flag.
                if (patch.runtimeOnly && (!current || (current.definitionRevision ?? 0) !== (task.definitionRevision ?? 0))) continue;
                byId.set(task.id, task);
            }
            tasks = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
        }
        if (patch || !initialized) {
            const raw = JSON.stringify({ version: 1, tasks });
            const nextBytes = Buffer.byteLength(raw, 'utf8');
            const shrinkingLegacy = previousBytes > STORE_BYTES && nextBytes < previousBytes
                && tasks.every(task => previousIds.has(task.id));
            if (nextBytes > STORE_BYTES && !shrinkingLegacy) throw new DesktopDomainError('SCHEDULE_STORE_TOO_LARGE', "The saved schedules exceed the local storage limit.");
            const file = await open(temporary, 'wx', 0o600);
            try { await file.writeFile(raw, 'utf8'); await file.sync(); } finally { await file.close(); }
            await rename(temporary, target);
            if (process.platform !== 'win32') {
                const directory = await open(root, 'r');
                try { await directory.sync(); } finally { await directory.close(); }
            }
        }
        return tasks;
    } finally { await rm(temporary, { force: true }); await release(); }
}
