import { randomUUID } from 'crypto';
import { lstatSync } from 'fs';
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'fs/promises';
import { hostname } from 'os';
import { basename, dirname, join } from 'path';

const lockfile = require('proper-lockfile') as {
    lock(file: string, options: Record<string, unknown>): Promise<() => Promise<void>>;
};

const GATE_STALE_MS = 40_000;
const GATE_UPDATE_MS = 5_000;
const LEASE_MARKER = /^(run|maintenance)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;

export class AgentCheckpointLeaseError extends Error {
    constructor(readonly code: 'BUSY' | 'UNAVAILABLE', message: string) {
        super(message);
        this.name = 'AgentCheckpointLeaseError';
    }
}

export interface AgentCheckpointLease {
    readonly assertOwned: () => void;
    readonly release: () => Promise<void>;
}

function lockPaths(checkpointRoot: string): { readonly gate: string; readonly runs: string } {
    // The lock must survive a rename/removal of the mutable checkpoint root.
    const lockRoot = join(dirname(checkpointRoot), '.locks', basename(checkpointRoot));
    return { gate: join(lockRoot, 'gate'), runs: join(lockRoot, 'runs') };
}

function aliveOnThisHost(pid: number): boolean {
    try { process.kill(pid, 0); return true; }
    catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

async function assertPrivateDirectory(path: string): Promise<void> {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new AgentCheckpointLeaseError('BUSY', 'Unsafe checkpoint lease directory');
    }
}

function directoryStillOwned(path: string, identity: { readonly dev: number; readonly ino: number }): boolean {
    try {
        const current = lstatSync(path);
        return current.isDirectory() && !current.isSymbolicLink()
            && current.dev === identity.dev && current.ino === identity.ino;
    } catch { return false; }
}

async function acquireGate(path: string): Promise<AgentCheckpointLease> {
    const lockDirectory = dirname(path);
    const lockBase = dirname(lockDirectory);
    try {
        await mkdir(lockBase, { recursive: true, mode: 0o700 });
        await assertPrivateDirectory(lockBase);
        await mkdir(lockDirectory, { recursive: true, mode: 0o700 });
        await assertPrivateDirectory(lockDirectory);
    } catch (error) {
        if (error instanceof AgentCheckpointLeaseError) throw error;
        throw new AgentCheckpointLeaseError('UNAVAILABLE', 'Unable to prepare checkpoint lease directory');
    }
    let compromised = false;
    let release: () => Promise<void>;
    try {
        release = await lockfile.lock(path, {
            realpath: false, stale: GATE_STALE_MS, update: GATE_UPDATE_MS,
            retries: { retries: 5, minTimeout: 20, maxTimeout: 30 },
            onCompromised: () => { compromised = true; }
        });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ELOCKED') {
            throw new AgentCheckpointLeaseError('BUSY', 'Another process is using this checkpoint workspace');
        }
        throw new AgentCheckpointLeaseError('UNAVAILABLE', 'Unable to coordinate checkpoint workspace access');
    }
    let identity: { readonly dev: number; readonly ino: number };
    try {
        const info = lstatSync(`${path}.lock`);
        identity = { dev: info.dev, ino: info.ino };
    } catch {
        await release().catch(() => undefined);
        throw new AgentCheckpointLeaseError('UNAVAILABLE', 'Checkpoint workspace lock was lost');
    }
    const owned = (): boolean => {
        if (compromised) return false;
        try {
            const current = lstatSync(`${path}.lock`);
            return current.dev === identity.dev && current.ino === identity.ino;
        } catch { return false; }
    };
    return {
        assertOwned: () => {
            if (!owned()) throw new AgentCheckpointLeaseError('BUSY', 'Checkpoint workspace lock was lost');
        },
        release: async () => { if (owned()) await release(); }
    };
}

async function rejectLiveMarkers(runs: string, conflicts: 'all' | 'maintenance'): Promise<void> {
    let names: string[];
    let directoryIdentity: { readonly dev: number; readonly ino: number };
    try {
        await assertPrivateDirectory(runs);
        const info = lstatSync(runs);
        directoryIdentity = { dev: info.dev, ino: info.ino };
        names = await readdir(runs);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        if (error instanceof AgentCheckpointLeaseError) throw error;
        throw new AgentCheckpointLeaseError('UNAVAILABLE', 'Unable to inspect checkpoint run leases');
    }
    for (const name of names) {
        if (!directoryStillOwned(runs, directoryIdentity)) {
            throw new AgentCheckpointLeaseError('BUSY', 'Checkpoint lease directory changed during inspection');
        }
        if (name.startsWith('.pending-')) continue;
        const markerKind = name.match(LEASE_MARKER)?.[1];
        if (!markerKind) {
            throw new AgentCheckpointLeaseError('BUSY', 'Unknown checkpoint run lease blocks maintenance');
        }
        const path = join(runs, name);
        let metadata;
        try { metadata = await lstat(path); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
            throw new AgentCheckpointLeaseError('UNAVAILABLE', 'Unable to inspect checkpoint run lease');
        }
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 2 || metadata.size > 512) {
            throw new AgentCheckpointLeaseError('BUSY', 'Unsafe checkpoint run lease blocks maintenance');
        }
        let owner: { readonly pid?: unknown; readonly host?: unknown; readonly kind?: unknown };
        try { owner = JSON.parse(await readFile(path, 'utf8')); }
        catch { throw new AgentCheckpointLeaseError('BUSY', 'Unreadable checkpoint run lease blocks maintenance'); }
        if (!owner || !Number.isSafeInteger(owner.pid) || (owner.pid as number) <= 0
            || typeof owner.host !== 'string' || owner.kind !== markerKind) {
            throw new AgentCheckpointLeaseError('BUSY', 'Invalid checkpoint run lease blocks maintenance');
        }
        // A remote host cannot be probed by local PID. A reused local PID also
        // stays conservatively busy rather than risking an active run's data.
        if (owner.host !== hostname() || aliveOnThisHost(owner.pid as number)) {
            if (conflicts === 'all' || markerKind === 'maintenance') {
                throw new AgentCheckpointLeaseError('BUSY', 'Another process still owns this checkpoint workspace');
            }
            continue;
        }
        // The original process no longer exists. No future process can write
        // under this unique marker, so it can be reclaimed while holding gate.
        if (!directoryStillOwned(runs, directoryIdentity)) {
            throw new AgentCheckpointLeaseError('BUSY', 'Checkpoint lease directory changed before reclamation');
        }
        try { await unlink(path); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw new AgentCheckpointLeaseError('UNAVAILABLE', 'Unable to reclaim a dead checkpoint run lease');
            }
        }
    }
}

async function registerMarker(runs: string, kind: 'run' | 'maintenance'): Promise<AgentCheckpointLease> {
    let temporary: string | undefined;
    let marker: string | undefined;
    let directoryIdentity: { readonly dev: number; readonly ino: number } | undefined;
    try {
        await mkdir(runs, { recursive: true, mode: 0o700 });
        await assertPrivateDirectory(runs);
        const directory = lstatSync(runs);
        directoryIdentity = { dev: directory.dev, ino: directory.ino };
        const id = randomUUID();
        temporary = join(runs, `.pending-${id}`);
        marker = join(runs, `${kind}-${id}.json`);
        await writeFile(temporary, JSON.stringify({ pid: process.pid, host: hostname(), kind }), { mode: 0o600, flag: 'wx' });
        await rename(temporary, marker);
        temporary = undefined;
        const ownedMarker = marker;
        const info = lstatSync(ownedMarker);
        const identity = { dev: info.dev, ino: info.ino };
        let released = false;
        return {
            assertOwned: () => {
                if (released) throw new AgentCheckpointLeaseError('BUSY', 'Checkpoint lease was released');
                if (!directoryStillOwned(runs, directoryIdentity!)) {
                    throw new AgentCheckpointLeaseError('BUSY', 'Checkpoint lease directory was replaced');
                }
                try {
                    const current = lstatSync(ownedMarker);
                    if (!current.isFile() || current.isSymbolicLink()
                        || current.dev !== identity.dev || current.ino !== identity.ino) throw new Error('unsafe');
                } catch { throw new AgentCheckpointLeaseError('BUSY', 'Checkpoint lease was lost'); }
            },
            release: async () => {
                if (released) return;
                released = true;
                if (!directoryStillOwned(runs, directoryIdentity!)) {
                    throw new AgentCheckpointLeaseError('BUSY', 'Checkpoint lease directory was replaced');
                }
                try {
                    const current = await lstat(ownedMarker);
                    if (!current.isFile() || current.isSymbolicLink()
                        || current.dev !== identity.dev || current.ino !== identity.ino) {
                        throw new AgentCheckpointLeaseError('BUSY', 'Checkpoint lease marker was replaced');
                    }
                    await unlink(ownedMarker);
                }
                catch (error) {
                    if (error instanceof AgentCheckpointLeaseError) throw error;
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                }
            }
        };
    } catch (error) {
        if (directoryIdentity && directoryStillOwned(runs, directoryIdentity)) {
            if (temporary) await unlink(temporary).catch(() => undefined);
            if (marker) await unlink(marker).catch(() => undefined);
        }
        if (error instanceof AgentCheckpointLeaseError) throw error;
        throw new AgentCheckpointLeaseError('UNAVAILABLE', 'Unable to register checkpoint lease');
    }
}

/** Register one running agent before it can write any checkpoint data. */
export async function acquireAgentCheckpointRunLease(checkpointRoot: string): Promise<AgentCheckpointLease> {
    const paths = lockPaths(checkpointRoot);
    const gate = await acquireGate(paths.gate);
    let marker: AgentCheckpointLease | undefined;
    try {
        // A stolen stale gate must not admit a run into live maintenance.
        await rejectLiveMarkers(paths.runs, 'maintenance');
        marker = await registerMarker(paths.runs, 'run');
        gate.assertOwned();
        return marker;
    } catch (error) {
        await marker?.release().catch(() => undefined);
        if (error instanceof AgentCheckpointLeaseError) throw error;
        throw new AgentCheckpointLeaseError('UNAVAILABLE', 'Unable to register checkpoint run lease');
    } finally {
        await gate.release().catch(() => undefined);
    }
}

/** Keep this exclusion through the final checkpoint rename and re-scan. */
export async function acquireAgentCheckpointMaintenanceLease(checkpointRoot: string): Promise<AgentCheckpointLease> {
    const paths = lockPaths(checkpointRoot);
    const gate = await acquireGate(paths.gate);
    let marker: AgentCheckpointLease | undefined;
    try {
        await rejectLiveMarkers(paths.runs, 'all');
        marker = await registerMarker(paths.runs, 'maintenance');
        gate.assertOwned();
        return {
            assertOwned: () => { gate.assertOwned(); marker!.assertOwned(); },
            release: async () => {
                try { await marker!.release(); }
                finally { await gate.release(); }
            }
        };
    } catch (error) {
        await marker?.release().catch(() => undefined);
        await gate.release().catch(() => undefined);
        if (error instanceof AgentCheckpointLeaseError) throw error;
        throw new AgentCheckpointLeaseError('UNAVAILABLE', 'Unable to inspect checkpoint run leases');
    }
}
