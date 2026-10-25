import { randomUUID } from 'crypto';
import { mkdir, open, readFile, readdir, rename, unlink, lstat } from 'fs/promises';
import { dirname, join } from 'path';
import { authorityBodyHash, normalizedAuthorityOrigin, syncAuthorityDirectory } from './nextmux-managed-task-authority';
const lockfile = require('proper-lockfile') as { lock(path: string, options: Record<string, unknown>): Promise<() => Promise<void>> };
export interface ManagedStopScope { root: string; platformOrigin: string; userId: string; requestKey: string; }
export interface ManagedStopRecord { version: 1; originHash: string; ownerHash: string; requestKey: string; requestId?: string; reason?: 'user_stop' | 'exit_incognito'; acknowledged?: boolean; }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const directory = (s: Omit<ManagedStopScope, 'requestKey'>) => join(s.root, 'managed-request-stop', authorityBodyHash(normalizedAuthorityOrigin(s.platformOrigin)), authorityBodyHash(s.userId));
const file = (s: ManagedStopScope) => join(directory(s), authorityBodyHash(s.requestKey) + '.json');
function validate(s: ManagedStopScope, v: ManagedStopRecord): void {
    if (!s.userId || !/^[A-Za-z0-9._:-]{1,200}$/.test(s.requestKey) || v.version !== 1 || v.requestKey !== s.requestKey
        || v.ownerHash !== authorityBodyHash(s.userId) || v.originHash !== authorityBodyHash(normalizedAuthorityOrigin(s.platformOrigin))
        || v.requestId !== undefined && !uuid.test(v.requestId) || v.reason !== undefined && !['user_stop', 'exit_incognito'].includes(v.reason)) throw new Error('REQUEST_STOP_JOURNAL_INVALID');
}
async function read(s: ManagedStopScope): Promise<ManagedStopRecord | undefined> {
    try { const p = file(s), stat = await lstat(p); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error('REQUEST_STOP_JOURNAL_INVALID'); const v = JSON.parse(await readFile(p, 'utf8')); validate(s, v); return v; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
/** This journal never contains prompts, outputs, attachments, credentials or a generation body. */
export async function updateManagedStop(s: ManagedStopScope, change: Pick<ManagedStopRecord, 'requestId' | 'reason' | 'acknowledged'> = {}): Promise<ManagedStopRecord> {
    if (change.requestId !== undefined && !uuid.test(change.requestId)) throw new Error('REQUEST_STOP_ID_INVALID');
    const dir = directory(s); await mkdir(dir, { recursive: true, mode: 0o700 });
    // Flush each directory link before allowing an accepted request to rely on it.
    let cursor = dir; while (cursor !== s.root && cursor !== dirname(cursor)) { await syncAuthorityDirectory(dirname(cursor)); cursor = dirname(cursor); }
    const release = await lockfile.lock(dir, { realpath: true, stale: 60000, update: 10000, retries: { retries: 50, minTimeout: 20, maxTimeout: 200 } });
    try {
        const prior = await read(s);
        if (prior?.requestId && change.requestId && prior.requestId !== change.requestId) throw new Error('REQUEST_STOP_IDENTITY_CONFLICT');
        const value: ManagedStopRecord = { version: 1, originHash: authorityBodyHash(normalizedAuthorityOrigin(s.platformOrigin)), ownerHash: authorityBodyHash(s.userId), requestKey: s.requestKey, ...prior,
            ...(change.requestId ? { requestId: change.requestId } : {}), ...(change.reason ? { reason: prior?.reason || change.reason } : {}), ...(change.acknowledged ? { acknowledged: true } : {}) };
        validate(s, value);
        const target = file(s), temporary = target + '.' + randomUUID() + '.tmp', handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
        try { await rename(temporary, target); await syncAuthorityDirectory(dir); } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
        return value;
    } finally { await release(); }
}
export async function pendingManagedStops(s: Omit<ManagedStopScope, 'requestKey'>): Promise<ManagedStopRecord[]> {
    let names: string[]; try { names = await readdir(directory(s)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const result: ManagedStopRecord[] = [];
    for (const name of names) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
        const p = join(directory(s), name), stat = await lstat(p);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) continue;
        const value = JSON.parse(await readFile(p, 'utf8')) as ManagedStopRecord;
        validate({ ...s, requestKey: value.requestKey }, value);
        if (name !== authorityBodyHash(value.requestKey) + '.json') throw new Error('REQUEST_STOP_JOURNAL_INVALID');
        if (value.reason && !value.acknowledged) result.push(value);
    }
    return result;
}
