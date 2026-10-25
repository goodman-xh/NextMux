import { createHash, randomUUID } from 'crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rmdir, unlink, writeFile } from 'fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OWNER = /^owner-(\d+)-([0-9a-f-]{36})$/;
const MARKER = '.nextmux-incognito-owner.json';
const SESSION_MARKER = '.nextmux-incognito-session.json';
const RECORD = /^session-[0-9a-f-]{36}\.json$/i;
const MAX_RECORD_BYTES = 64 * 1024 * 1024;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const processLockfile = require('proper-lockfile') as { lock(path: string, options: Record<string, unknown>): Promise<() => Promise<void>> };
const instances = new Map<string, IncognitoSessions>();
interface SessionMarker {
    version: 1; kind: 'nextmux-incognito-session'; id: string; incognitoOrigin: true;
    mode: 'private' | 'normal'; revision: number; activePid: number; activeNonce: string;
    recordFile?: string; recordSha256?: string;
}

function inside(root: string, target: string): boolean {
    const path = relative(root, target);
    return path === '' || !path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path);
}

/** Delete only our marked tree. Links are unlinked, never traversed. */
async function removeTree(path: string): Promise<void> {
    let info;
    try { info = await lstat(path); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
    }
    if (info.isSymbolicLink() || !info.isDirectory()) { await unlink(path); return; }
    for (const entry of await readdir(path)) await removeTree(join(path, entry));
    await rmdir(path);
}

/** Private bodies stay in memory; explicitly retained origin sessions use an isolated atomic record. */
export class IncognitoSessions {
    root: string;
    ownerRoot: string;
    private initialization?: Promise<void>;
    private closingAll = false;
    private readonly pendingCreates = new Set<Promise<{ id: string; workspaceRoot: string }>>();
    private readonly roots = new Map<string, string>();
    private readonly readFailures = new Set<string>();
    private readonly modes = new Map<string, SessionMarker>();
    private readonly writes = new Map<string, Promise<unknown>>();
    private readonly records = new Map<string, Record<string, unknown>>();
    private readonly retired = new Set<string>();
    private readonly transitions = new Set<string>();
    private readonly preparations = new Map<string, number>();
    private readonly runOwners = new Map<string, string>();
    private readonly recoveryOwners = new Map<string, string>();
    private readonly workspaceKeys = new Map<string, { id: string; path: string }>();

    constructor(dataRoot: string, private readonly ownerPid = process.pid,
        private readonly isProcessAlive: (pid: number) => boolean = pid => {
            try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
        }) {
        this.root = join(resolve(dataRoot), 'incognito-sessions-v1');
        this.ownerRoot = join(this.root, `owner-${ownerPid}-${randomUUID()}`);

    }

    /** Pure ownership lookups must not start background disk writes for ordinary conversations. */
    get ready(): Promise<void> { return this.initialization ||= this.initialize(); }

    private async initialize(): Promise<void> {
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        if ((await lstat(this.root)).isSymbolicLink()) throw new Error('INCOGNITO_UNSAFE_ROOT');
        const ownerName = this.ownerRoot.split(sep).at(-1)!;
        this.root = await realpath(this.root);
        this.ownerRoot = join(this.root, ownerName);
        await this.refreshOwners();
        await mkdir(this.ownerRoot, { mode: 0o700 });
        await writeFile(join(this.ownerRoot, MARKER), JSON.stringify({ version: 1, kind: 'nextmux-incognito',
            pid: this.ownerPid, nonce: OWNER.exec(this.ownerRoot.split(sep).at(-1)!)![2] }), { flag: 'wx', mode: 0o600 });
    }

    /** Normal mode retains its original, isolated container and survives owner restarts. */
    private async refreshOwners(): Promise<void> {
        for (const name of await readdir(this.root)) {
            const match = OWNER.exec(name);
            if (!match) continue;
            const owner = join(this.root, name), ownerAlive = this.isProcessAlive(Number(match[1]));
            if (!await this.owned(owner, Number(match[1]))) continue;
            for (const id of await readdir(owner)) {
                if (!ID.test(id)) continue;
                const container = join(owner, id);
                const info = await lstat(container);
                if (info.isSymbolicLink() || !info.isDirectory() || await realpath(container) !== container) continue;
                const known = this.roots.get(id);
                if (known && dirname(known) !== container) throw Error('INCOGNITO_ID_COLLISION');
                const release = await processLockfile.lock(container, { realpath: false, stale: 30_000, update: 10_000, retries: { retries: 20, minTimeout: 20, maxTimeout: 100 } });
                try {
                let marker: SessionMarker | undefined;
                try { marker = await this.readMarker(container, id); } catch { this.readFailures.add(id); continue; } // Invalid ownership is never deletion authority.
                if (!marker) {
                    if (!ownerAlive) await removeTree(container); // Old private-only format.
                    continue;
                }
                if (marker.mode === 'private') {
                    if (!this.isProcessAlive(marker.activePid)) { await removeTree(container); this.roots.delete(id); this.records.delete(id); this.modes.delete(id); }
                    else if (this.roots.has(id)) {
                        this.modes.set(id, marker);
                        if (!this.localPrivate(marker)) this.records.delete(id);
                    }
                    continue;
                }
                let record: Record<string, unknown>;
                try { record = this.modes.get(id)?.recordSha256 === marker.recordSha256 && this.modes.get(id)?.recordFile === marker.recordFile && this.modes.get(id)?.revision === marker.revision && this.records.has(id) ? this.records.get(id)! : await this.readRecord(container, marker); }
                catch { this.readFailures.add(id); this.records.delete(id); continue; }
                this.readFailures.delete(id);
                this.roots.set(id, join(container, 'workspace')); this.modes.set(id, marker);
                if (record.historyCleared === true) { this.records.delete(id); this.retired.add(id); }
                else this.records.set(id, this.canonical(record, marker));
                } finally { await release(); }
            }
            if (!ownerAlive && (await readdir(owner)).every(file => file === MARKER)) await removeTree(owner);
        }
    }

    hasReadFailures(): boolean { return this.readFailures.size > 0; }
    async refresh(): Promise<void> { await this.ready; await this.settleWrites(); await this.refreshOwners(); }
    private localPrivate(marker: SessionMarker): boolean {
        return marker.mode === 'private' && marker.activePid === this.ownerPid
            && marker.activeNonce === OWNER.exec(this.ownerRoot.split(sep).at(-1)!)![2];
    }
    private async readMarker(container: string, id: string): Promise<SessionMarker | undefined> {
        const path = join(container, SESSION_MARKER);
        let stat;
        try { stat = await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw Error('INCOGNITO_UNSAFE_ROOT');
        const value = JSON.parse(await readFile(path, 'utf8')) as SessionMarker;
        if (value.version !== 1 || value.kind !== 'nextmux-incognito-session' || value.id !== id || value.incognitoOrigin !== true
            || !['private', 'normal'].includes(value.mode) || !Number.isSafeInteger(value.revision) || value.revision < 0
            || !Number.isSafeInteger(value.activePid) || value.activePid <= 0 || !ID.test(value.activeNonce)
            || value.mode === 'normal' && (!RECORD.test(value.recordFile || '') || !/^[a-f0-9]{64}$/.test(value.recordSha256 || ''))
            || value.mode === 'private' && (value.recordFile !== undefined || value.recordSha256 !== undefined)) throw Error('INCOGNITO_UNSAFE_ROOT');
        return value;
    }
    private async readRecord(container: string, marker: SessionMarker): Promise<Record<string, unknown>> {
        const path = join(container, marker.recordFile!); const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_RECORD_BYTES) throw Error('INCOGNITO_UNSAFE_ROOT');
        const raw = await readFile(path);
        if (createHash('sha256').update(raw).digest('hex') !== marker.recordSha256) throw Error('INCOGNITO_RECORD_CORRUPT');
        const value = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (value.id !== marker.id || !Array.isArray(value.turns) || typeof value.title !== 'string') throw Error('INCOGNITO_RECORD_CORRUPT');
        return value;
    }
    private canonical(value: Record<string, unknown>, marker: SessionMarker): Record<string, unknown> {
        const workspacePath = marker.mode === 'normal' && typeof value.workspacePath === 'string' ? value.workspacePath : '';
        return { ...value, incognito: marker.mode === 'private', incognitoOrigin: true, incognitoRevision: marker.revision,
            ownedWorkspace: !workspacePath, workspacePath, privateWorkspacePath: undefined,
            workspaceBindings: marker.mode === 'normal' ? value.workspaceBindings : undefined };
    }
    private async atomic(path: string, data: string): Promise<void> {
        const temp = `${path}.tmp-${randomUUID()}`;
        let handle;
        try {
            handle = await open(temp, 'wx', 0o600); await handle.writeFile(data); await handle.sync(); await handle.close(); handle = undefined;
            await rename(temp, path);
            // Directory fsync is unavailable on some Windows filesystems; rename remains atomic there.
            const directory = await open(dirname(path), 'r').catch(() => undefined);
            if (directory) try { await directory.sync(); } catch (error) { if (!['EINVAL', 'EPERM', 'EBADF'].includes(String((error as NodeJS.ErrnoException).code))) throw error; } finally { await directory.close(); }
        } finally { await handle?.close(); await unlink(temp).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
    }
    private write<T>(id: string, operation: (marker: SessionMarker, container: string) => Promise<T>): Promise<T> {
        const prior = this.writes.get(id) || Promise.resolve();
        const work = prior.catch(() => undefined).then(async () => {
            await this.ready;
            const workspace = this.roots.get(id);
            if (!workspace || this.retired.has(id)) throw Error('INCOGNITO_SESSION_INVALID');
            const container = dirname(workspace), owner = dirname(container), match = OWNER.exec(owner.split(sep).at(-1)!);
            if (!match || !await this.owned(owner, Number(match[1])) || await realpath(container) !== container || (await lstat(container)).isSymbolicLink()) throw Error('INCOGNITO_UNSAFE_ROOT');
            const release = await processLockfile.lock(container, { realpath: false, stale: 30_000, update: 10_000, retries: { retries: 20, minTimeout: 20, maxTimeout: 100 } });
            try {
                const marker = await this.readMarker(container, id);
                if (!marker) throw Error('INCOGNITO_SESSION_INVALID');
                if (marker.mode === 'private' && !this.localPrivate(marker)) throw Error('INCOGNITO_MODE_CHANGED');
                this.modes.set(id, marker);
                return await operation(marker, container);
            } finally { await release(); }
        });
        this.writes.set(id, work);
        void work.finally(() => { if (this.writes.get(id) === work) this.writes.delete(id); }).catch(() => undefined);
        return work;
    }
    async settleWrites(): Promise<void> { await Promise.allSettled([...this.writes.values()]); }
    private async publishRecord(container: string, marker: SessionMarker, record: Record<string, unknown>): Promise<SessionMarker> {
        const next = { ...marker }, value = this.canonical(record, marker);
        if (next.mode === 'normal') {
            const raw = JSON.stringify(value);
            if (Buffer.byteLength(raw) > MAX_RECORD_BYTES) throw Error('INCOGNITO_RECORD_TOO_LARGE');
            next.recordFile = `session-${randomUUID()}.json`; next.recordSha256 = createHash('sha256').update(raw).digest('hex');
            await this.atomic(join(container, next.recordFile), raw);
        } else { delete next.recordFile; delete next.recordSha256; }
        await this.atomic(join(container, SESSION_MARKER), JSON.stringify(next));
        this.modes.set(next.id, next); this.records.set(next.id, this.canonical(record, next));
        // Only payloads created by this store, never user workspace/state files.
        for (const file of await readdir(container)) if (RECORD.test(file) && file !== next.recordFile) await unlink(join(container, file)).catch(() => undefined);
        return next;
    }
    async save(value: Record<string, unknown>, baseUpdatedAt?: number, allowProjectBinding = false): Promise<void> {
        const id = String(value.id || '');
        await this.write(id, async (marker, container) => {
            if (value.incognito !== (marker.mode === 'private') || (marker.revision > 0 || value.incognitoRevision !== undefined) && value.incognitoRevision !== marker.revision) throw Error('INCOGNITO_MODE_CHANGED');
            const current = marker.mode === 'normal' ? await this.readRecord(container, marker) : this.records.get(id);
            if (current?.historyCleared === true) throw Error('INCOGNITO_SESSION_INVALID');
            if (marker.mode === 'normal' && !allowProjectBinding && String(value.workspacePath || '') !== String(current?.workspacePath || '')) throw Error('INCOGNITO_PROJECT_BINDING_REQUIRED');
            if (baseUpdatedAt !== undefined && baseUpdatedAt !== Number(current?.updatedAt || 0) && JSON.stringify(current) !== JSON.stringify(this.canonical(value, marker))) throw Error('INCOGNITO_MODE_CHANGED');
            if (marker.mode === 'private') this.records.set(id, this.canonical(value, marker));
            else await this.publishRecord(container, marker, value);
        });
    }
    async setMode(id: string, enabled: boolean, expectedRevision: number): Promise<Record<string, unknown>> {
        return this.write(id, async (marker, container) => {
            if (this.closingAll || this.retired.has(id)) throw Error('INCOGNITO_SESSION_INVALID');
            if (enabled) throw Error('INCOGNITO_REENABLE_UNAVAILABLE');
            if (marker.revision !== expectedRevision) throw Error('INCOGNITO_MODE_CHANGED');
            if (marker.activePid !== this.ownerPid && this.isProcessAlive(marker.activePid)) throw Error('INCOGNITO_MODE_BUSY');
            const current = marker.mode === 'normal' ? await this.readRecord(container, marker) : this.records.get(id);
            if (!current || current.historyCleared === true) throw Error('INCOGNITO_SESSION_INVALID');
            if (enabled !== (marker.mode === 'private')) {
                await this.publishRecord(container, { ...marker, mode: enabled ? 'private' : 'normal', revision: marker.revision + 1,
                    activePid: this.ownerPid, activeNonce: OWNER.exec(this.ownerRoot.split(sep).at(-1)!)![2] },
                    { ...current, updatedAt: Math.max(Date.now(), Number(current.updatedAt || 0) + 1) });
            }
            const record = this.records.get(id)!;
            return { ...record, privateWorkspacePath: record.workspacePath ? undefined : this.workspace(id) };
        });
    }

    /** Clearing history must not delete generated workspace files. A small
     * opaque record prevents a retained container from restoring old messages. */
    async forgetRetainedHistory(ids: readonly string[]): Promise<void> {
        for (const id of new Set(ids)) {
            if (this.retired.has(id)) continue;
            await this.write(id, async (marker, container) => {
                if (marker.mode !== 'normal') return;
                await this.publishRecord(container, { ...marker, revision: marker.revision + 1 }, {
                    id, title: '', turns: [], workspacePath: '', historyCleared: true,
                    createdAt: 0, updatedAt: Date.now()
                });
                this.records.delete(id); this.retired.add(id);
                // Report a partial cleanup instead of claiming old plaintext
                // was removed when the filesystem denied deleting a payload.
                const keep = this.modes.get(id)!.recordFile;
                for (const file of await readdir(container)) if (RECORD.test(file) && file !== keep) await unlink(join(container, file));
            });
        }
    }

    private async owned(path: string, pid: number): Promise<boolean> {
        try {
            if (dirname(path) !== this.root || (await lstat(path)).isSymbolicLink() || await realpath(path) !== path) return false;
            const marker = join(path, MARKER), info = await lstat(marker);
            if (!info.isFile() || info.isSymbolicLink() || info.size > 1_024) return false;
            const value = JSON.parse(await readFile(marker, 'utf8'));
            return value?.version === 1 && value.kind === 'nextmux-incognito' && value.pid === pid
                && `owner-${pid}-${value.nonce}` === path.split(sep).at(-1);
        } catch { return false; }
    }

    async create(id: string = randomUUID(), materialize = true): Promise<{ id: string; workspaceRoot: string }> {
        const work = this.createWorkspace(id, materialize);
        this.pendingCreates.add(work);
        try { return await work; } finally { this.pendingCreates.delete(work); }
    }
    async settleCreations(): Promise<void> { await Promise.allSettled([...this.pendingCreates]); }
    private async createWorkspace(id: string, materialize: boolean): Promise<{ id: string; workspaceRoot: string }> {
        if (this.closingAll || !ID.test(id) || this.retired.has(id)) throw new Error('INCOGNITO_SESSION_INVALID');
        await this.ready;
        if (this.closingAll || this.retired.has(id) || this.roots.has(id)) throw new Error('INCOGNITO_SESSION_INVALID');
        const workspaceRoot = join(this.ownerRoot, id, 'workspace');
        await mkdir(materialize ? workspaceRoot : dirname(workspaceRoot), { recursive: true, mode: 0o700 });
        if (await realpath(materialize ? workspaceRoot : dirname(workspaceRoot)) !== (materialize ? workspaceRoot : dirname(workspaceRoot))) throw new Error('INCOGNITO_UNSAFE_ROOT');
        if (this.closingAll || this.retired.has(id)) { await removeTree(dirname(workspaceRoot)); throw new Error('INCOGNITO_SESSION_INVALID'); }
        this.roots.set(id, workspaceRoot);
        const marker: SessionMarker = { version: 1, kind: 'nextmux-incognito-session', id, incognitoOrigin: true, mode: 'private', revision: 0,
            activePid: this.ownerPid, activeNonce: OWNER.exec(this.ownerRoot.split(sep).at(-1)!)![2] };
        await this.atomic(join(dirname(workspaceRoot), SESSION_MARKER), JSON.stringify(marker));
        this.modes.set(id, marker);
        return { id, workspaceRoot };
    }

    has(id: unknown): boolean { return typeof id === 'string' && this.roots.has(id) && Boolean(this.modes.get(id) && this.localPrivate(this.modes.get(id)!)); }
    owns(id: unknown): boolean { return typeof id === 'string' && this.roots.has(id); }
    setClosingAll(closing: boolean): void { this.closingAll = closing; }
    beginClose(id: string): void { if (this.owns(id)) this.retired.add(id); }
    isRetired(id: unknown): boolean { return typeof id === 'string' && this.retired.has(id); }
    workspace(id: string): string | undefined { return this.roots.get(id); }
    ids(): string[] { return [...this.roots.keys()].filter(id => this.has(id)); }
    originIds(): string[] { return [...this.roots.keys()]; }
    sessionForPath(path: string): string | undefined {
        if (!path || !isAbsolute(path)) return undefined;
        const target = resolve(path);
        return [...this.roots].find(([, root]) => inside(dirname(root), target))?.[0];
    }
    /** Recognizes stale/retired temporary paths too, without granting access. */
    isTemporaryPath(path: string): boolean { return isAbsolute(path) && inside(this.root, resolve(path)); }
    dataRoot(id: string): string | undefined {
        const workspace = this.workspace(id);
        return workspace ? join(dirname(workspace), 'state') : undefined;
    }
    values(): Record<string, unknown>[] { return [...this.records.values()]; }
    read(id: string): Record<string, unknown> | undefined { return this.records.get(id); }
    put(value: Record<string, unknown>): void {
        const id = String(value.id || '');
        if (!this.has(id) || value.incognito !== true || value.workspacePath !== '') throw new Error('INCOGNITO_SESSION_INVALID');
        // Backend identity, not a renderer-supplied path, owns temporary files.
        this.records.set(id, this.canonical(value, this.modes.get(id)!));
    }
    /** Per-conversation only: unrelated chats never share a preparation/mode fence. */
    holdRunPreparation(id?: string): () => void {
        if (!id) return () => undefined;
        if (this.transitions.has(id)) throw Error('INCOGNITO_MODE_BUSY');
        this.preparations.set(id, (this.preparations.get(id) || 0) + 1);
        let released = false;
        return () => { if (released) return; released = true; const count = (this.preparations.get(id) || 1) - 1; if (count) this.preparations.set(id, count); else this.preparations.delete(id); };
    }
    holdModeTransition(id: string): () => void {
        if (this.transitions.has(id) || this.preparations.has(id)) throw Error('INCOGNITO_MODE_BUSY');
        this.transitions.add(id);
        return () => { this.transitions.delete(id); };
    }
    bindRun(runId: string, id: string): void { if (this.owns(id)) this.runOwners.set(runId, id); }
    bindWorkspace(key: string, path: string): void { const id = this.sessionForPath(path); if (id) this.workspaceKeys.set(key, { id, path }); }
    workspaceSession(key: string): string | undefined { return this.workspaceKeys.get(key)?.id; }
    ownedWorkspaces(id: string): string[] { return [...new Set([this.workspace(id), ...[...this.workspaceKeys.values()].filter(value => value.id === id).map(value => value.path)].filter((path): path is string => Boolean(path)))]; }
    runSession(runId: string): string | undefined { return this.runOwners.get(runId); }
    bindRecovery(id: string, sessionId: string): void { if (this.owns(sessionId)) this.recoveryOwners.set(id, sessionId); }
    recoverySession(id: string): string | undefined { return this.recoveryOwners.get(id); }

    async remove(id: string): Promise<void> {
        await this.ready;
        const workspace = this.workspace(id);
        if (!workspace) return;
        await this.settleWrites();
        const owner = dirname(dirname(workspace)), match = OWNER.exec(owner.split(sep).at(-1)!);
        if (!match || !await this.owned(owner, Number(match[1]))) throw new Error('INCOGNITO_UNSAFE_ROOT');
        this.retired.add(id);
        // Share the mode/save lock so an old window cannot recreate a deleted payload.
        const container = dirname(workspace);
        const release = await processLockfile.lock(container, { realpath: false, stale: 30_000, update: 10_000, retries: { retries: 20, minTimeout: 20, maxTimeout: 100 } });
        try {
            const marker = await this.readMarker(container, id);
            if (!marker || marker.mode === 'private' && !this.localPrivate(marker)) throw Error('INCOGNITO_MODE_CHANGED');
            await removeTree(container);
        } finally { await release(); }
        this.roots.delete(id); this.records.delete(id); this.modes.delete(id);
        // Keep opaque owner tombstones in memory until process exit. Late writes must never fall back to the normal profile.
    }
}

export function sharedIncognitoSessions(root: string): IncognitoSessions {
    const key = resolve(root);
    let store = instances.get(key);
    if (!store) { store = new IncognitoSessions(key); instances.set(key, store); }
    return store;
}
