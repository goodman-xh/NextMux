import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { relativeMediaUri } from '@nextmux/media-core';
import type { DesktopComicCanvasState } from '../common/nextmux-platform-protocol';
import { ComicCanvasToolsService } from './nextmux-canvas-tools-service';
import type { CanvasToolStore, ComicCanvasToolJob, RunComicCanvasToolRequest } from './nextmux-canvas-tools-service';
import { CanvasToolError, runCanvasLocalTool } from './nextmux-canvas-tools';
import type { CanvasLocalToolOptions, CanvasLocalToolResult, CanvasToolProgress } from './nextmux-canvas-tools';

export type ComicCanvasToolRuntimeOptions = Omit<CanvasLocalToolOptions, 'outputDirectory' | 'signal'>;
export interface PersistentComicCanvasToolJob extends Omit<ComicCanvasToolJob, 'status'> {
    readonly status: ComicCanvasToolJob['status'] | 'interrupted';
    readonly stage: CanvasToolProgress['stage'];
    readonly percent: number;
}
export interface ComicCanvasToolJobState {
    readonly job?: PersistentComicCanvasToolJob;
    readonly state: DesktopComicCanvasState;
}
export interface ComicCanvasToolRunState extends ComicCanvasToolJobState { readonly job: PersistentComicCanvasToolJob }

interface ToolJournalRecord {
    readonly request: RunComicCanvasToolRequest;
    readonly fingerprint: string;
    readonly job: PersistentComicCanvasToolJob;
}
interface BackendToolEntry {
    readonly request: RunComicCanvasToolRequest;
    readonly fingerprint: string;
    readonly promise: Promise<ComicCanvasToolRunState>;
    view: PersistentComicCanvasToolJob;
    cancelRequested: boolean;
    innerStarted: boolean;
    writes: Promise<void>;
    writeError?: Error;
}

const journalQueues = new Map<string, Promise<unknown>>();
const { lock } = require('proper-lockfile') as {
    lock(path: string, options: { realpath: boolean; lockfilePath: string; retries: { retries: number; minTimeout: number; maxTimeout: number }; stale: number; onCompromised?: () => void }): Promise<() => Promise<void>>;
};
export const CANVAS_TOOLS_JOURNAL_FILE = 'nextmux.canvas.tools.jobs.json';

async function atomicJournalWrite(path: string, records: readonly ToolJournalRecord[]): Promise<void> {
    const temporary = join(dirname(path), `.${randomUUID()}.canvas-tools.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(records, null, 2)); await handle.sync(); }
    catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
    finally { await handle.close(); }
    try { await rename(temporary, path); }
    catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
}

async function readJournal(path: string): Promise<ToolJournalRecord[]> {
    try {
        const metadata = await lstat(path);
        if (!metadata.isFile() || metadata.isSymbolicLink()) throw new CanvasToolError('CANVAS_TOOLS_JOURNAL_INVALID', 'The local tool journal is not a regular project file');
        const records: unknown = JSON.parse(await readFile(path, 'utf8'));
        const identifiers = new Set<string>();
        if (!Array.isArray(records) || records.some(record => {
            if (!record || typeof record !== 'object' || typeof record.fingerprint !== 'string' || !record.request || !record.job
                || typeof record.request.requestId !== 'string' || !record.request.requestId.trim() || record.job.requestId !== record.request.requestId
                || record.fingerprint !== JSON.stringify(record.request) || identifiers.has(record.request.requestId)
                || !['running', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(record.job.status)
                || !['probe', 'download', 'process', 'verify', 'complete'].includes(record.job.stage)
                || !Number.isFinite(record.job.percent) || record.job.percent < 0 || record.job.percent > 100) return true;
            identifiers.add(record.request.requestId); return false;
        })) throw new CanvasToolError('CANVAS_TOOLS_JOURNAL_INVALID', 'The local tool journal is invalid');
        return records as ToolJournalRecord[];
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }
}

function withProgress(job: PersistentComicCanvasToolJob, progress: CanvasToolProgress): PersistentComicCanvasToolJob {
    const fraction = typeof progress.fraction === 'number' && Number.isFinite(progress.fraction) ? progress.fraction
        : progress.totalOutputs > 0 ? progress.completedOutputs / progress.totalOutputs : 0;
    return { ...job, progress: structuredClone(progress), stage: progress.stage,
        percent: progress.stage === 'complete' ? 100 : Math.max(job.percent, Math.round(Math.max(0, Math.min(1, fraction)) * 100)) };
}

/** Backend-owned facade: reloads reuse it; a fresh backend only reports interrupted local work. */
export class PersistentComicCanvasToolsService {
    private readonly active = new Map<string, BackendToolEntry>();
    private readonly records = new Map<string, ToolJournalRecord>();
    private readonly context = new AsyncLocalStorage<BackendToolEntry>();
    private initialized?: Promise<void>;
    private inner?: ComicCanvasToolsService;
    private innerPromise?: Promise<ComicCanvasToolsService>;

    constructor(readonly workspaceRoot: string, readonly store: CanvasToolStore,
        readonly options: ComicCanvasToolRuntimeOptions | (() => Promise<ComicCanvasToolRuntimeOptions>),
        readonly runner: typeof runCanvasLocalTool = runCanvasLocalTool) {}

    private async journal<T>(operation: (records: ToolJournalRecord[], path: string) => Promise<T>): Promise<T> {
        const root = this.store.storageDirectory ? await this.store.storageDirectory() : await realpath(this.workspaceRoot);
        const path = join(root, CANVAS_TOOLS_JOURNAL_FILE);
        const previous = journalQueues.get(path) || Promise.resolve();
        const pending = previous.catch(() => undefined).then(async () => {
            // This is the same cross-process lock path used by the supplied ComicCanvasStore.
            const release = await lock(join(root, 'nextmux.canvas.json'), { realpath: false, lockfilePath: `${join(root, 'nextmux.canvas.json')}.lock`,
                retries: { retries: 20, minTimeout: 20, maxTimeout: 100 }, stale: 30_000, onCompromised: () => {} });
            try {
                // Retirement is published under this lock; a preflight that raced it cannot reserve new work.
                if (this.store.storageDirectory && await this.store.storageDirectory() !== root) throw new CanvasToolError('CANVAS_IDENTITY_CHANGED', 'The canvas storage location changed');
                return await operation(await readJournal(path), path);
            } finally { await release(); }
        });
        journalQueues.set(path, pending);
        try { return await pending; } finally { if (journalQueues.get(path) === pending) journalQueues.delete(path); }
    }

    private initialize(): Promise<void> {
        if (!this.initialized) this.initialized = this.journal(async (records, path) => {
            const restored = records.map(record => record.job.status === 'running' ? { ...record, job: { ...record.job, status: 'interrupted' as const,
                error: { code: 'LOCAL_TOOL_INTERRUPTED', message: 'The backend stopped before local processing finished. Start a new request to run it again.' } } } : record);
            if (restored.some((record, index) => record !== records[index])) await atomicJournalWrite(path, restored);
            for (const record of restored) this.records.set(record.request.requestId, record);
        });
        return this.initialized;
    }

    private service(): Promise<ComicCanvasToolsService> {
        if (!this.innerPromise) this.innerPromise = Promise.resolve().then(async () => {
            const options = typeof this.options === 'function' ? await this.options() : this.options;
            this.inner = new ComicCanvasToolsService(this.workspaceRoot, this.store, options, async (request, runOptions) => {
                const entry = this.context.getStore();
                const output = await this.runner(request, { ...runOptions, onProgress: progress => {
                    runOptions.onProgress?.(progress);
                    if (entry) { entry.view = withProgress(entry.view, progress); this.queueView(entry); }
                } });
                const result = await this.normalizeResult(output);
                // Keep completed media recoverable even if the backend dies before canvas attachment.
                if (entry) {
                    entry.view = { ...entry.view, result: structuredClone(result) };
                    this.queueView(entry); await entry.writes;
                    if (entry.writeError) throw entry.writeError;
                }
                return result;
            });
            return this.inner;
        }).catch(error => { this.innerPromise = undefined; throw error; });
        return this.innerPromise;
    }

    private async normalizeResult(result: CanvasLocalToolResult): Promise<CanvasLocalToolResult> {
        const root = await realpath(this.workspaceRoot);
        const versions = await Promise.all(result.versions.map(async version => {
            if (!/^file:/i.test(version.uri)) return version;
            const path = await realpath(fileURLToPath(version.uri)), relation = relative(root, path);
            if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
                throw new CanvasToolError('PROJECT_ASSET_REQUIRED', 'Local tool outputs must remain inside the comic project');
            }
            // Queue inputs use managed relative paths; only these newly created results
            // are normalized, so the immutable source history keeps its original URI.
            const uri = relativeMediaUri(relation.split(sep).join('/'), 'canvas tool output');
            return { ...version, uri };
        }));
        return { ...result, versions };
    }

    private async persist(entry: BackendToolEntry, view: PersistentComicCanvasToolJob): Promise<void> {
        await this.journal(async (records, path) => {
            const index = records.findIndex(record => record.request.requestId === entry.request.requestId);
            if (index < 0 || records[index].fingerprint !== entry.fingerprint) throw new CanvasToolError('REQUEST_ID_CONFLICT', 'The local processing request journal changed');
            const record = { ...records[index], job: structuredClone(view) };
            records[index] = record; await atomicJournalWrite(path, records); this.records.set(entry.request.requestId, record);
        });
    }

    private queueView(entry: BackendToolEntry): void {
        const view = structuredClone(entry.view);
        entry.writes = entry.writes.then(() => this.persist(entry, view)).catch(error => { entry.writeError = error as Error; });
    }

    run(request: RunComicCanvasToolRequest): Promise<ComicCanvasToolRunState> {
        if (!request?.requestId?.trim()) return Promise.reject(new CanvasToolError('REQUEST_ID_REQUIRED', 'A stable local processing request id is required'));
        const frozen = structuredClone(request), fingerprint = JSON.stringify(frozen), existing = this.active.get(frozen.requestId);
        if (existing) {
            if (existing.fingerprint !== fingerprint) return Promise.reject(new CanvasToolError('REQUEST_ID_CONFLICT', 'This request id already belongs to a different operation'));
            return existing.promise;
        }
        const entry: BackendToolEntry = { request: frozen, fingerprint, view: { requestId: frozen.requestId, status: 'running', stage: 'probe', percent: 0 },
            cancelRequested: false, innerStarted: false, writes: Promise.resolve(), promise: Promise.resolve(undefined as never) };
        const pending: Promise<ComicCanvasToolRunState> = Promise.resolve().then(() => this.execute(entry)).catch(error => {
            // A failed reservation must not hide the durable job when queried afterwards.
            if (this.active.get(frozen.requestId)?.promise === pending) this.active.delete(frozen.requestId);
            throw error;
        });
        const registered = { ...entry, promise: pending }; this.active.set(frozen.requestId, registered);
        // execute must use the registered mutable entry, including cancellation requested in this tick.
        return pending;
    }

    private async execute(initial: BackendToolEntry): Promise<ComicCanvasToolRunState> {
        const entry = this.active.get(initial.request.requestId) || initial;
        await this.initialize();
        const previous = await this.journal(async (records, path) => {
            const existing = records.find(record => record.request.requestId === entry.request.requestId);
            if (existing) {
                if (existing.fingerprint !== entry.fingerprint) throw new CanvasToolError('REQUEST_ID_CONFLICT', 'This request id already belongs to a different operation');
                return existing;
            }
            const record = { request: entry.request, fingerprint: entry.fingerprint, job: entry.view };
            await atomicJournalWrite(path, [...records, record]); this.records.set(entry.request.requestId, structuredClone(record));
            return undefined;
        });
        if (previous) { entry.view = structuredClone(previous.job); return { job: structuredClone(entry.view), state: await this.store.read() }; }
        try {
            if (entry.cancelRequested) throw new CanvasToolError('CANCELLED', 'Local media processing was cancelled');
            const service = await this.service();
            if (entry.cancelRequested) throw new CanvasToolError('CANCELLED', 'Local media processing was cancelled');
            entry.innerStarted = true;
            const pending = this.context.run(entry, () => service.run(entry.request));
            const job = await pending;
            entry.view = { ...entry.view, ...job, ...(job.status === 'succeeded' ? { stage: 'complete' as const, percent: 100 } : {}) };
        } catch (error) {
            const exception = error as Error & { code?: string };
            entry.view = { ...entry.view, status: entry.cancelRequested ? 'cancelled' : 'failed',
                error: { code: exception.code || 'LOCAL_TOOL_FAILED', message: exception.message } };
        }
        await entry.writes;
        if (entry.writeError) throw entry.writeError;
        await this.persist(entry, entry.view);
        return { job: structuredClone(entry.view), state: await this.store.read() };
    }

    async getJob(requestId: string): Promise<ComicCanvasToolJobState> {
        await this.initialize();
        const entry = this.active.get(requestId), record = this.records.get(requestId);
        const job = entry && (entry.innerStarted || !record || record.job.status === 'running') ? entry.view : record?.job;
        return { ...(job ? { job: structuredClone(job) } : {}), state: await this.store.read() };
    }

    async cancel(requestId: string): Promise<ComicCanvasToolJobState> {
        await this.initialize();
        const entry = this.active.get(requestId);
        const record = this.records.get(requestId);
        // Replaying a completed/interrupted request is a lookup, even when cancellation
        // arrives before that lookup's promise resolves.
        if (entry && !entry.innerStarted && record && record.job.status !== 'running') entry.view = structuredClone(record.job);
        if (entry?.view.status === 'running') {
            const innerJob = entry.innerStarted ? this.inner?.cancel(requestId) : undefined;
            if (innerJob && innerJob.status !== 'running') entry.view = { ...entry.view, ...innerJob,
                ...(innerJob.status === 'succeeded' ? { stage: 'complete' as const, percent: 100 } : {}) };
            else {
                entry.cancelRequested = true;
                entry.view = { ...entry.view, status: 'cancelled', error: { code: 'CANCELLED', message: 'Local media processing was cancelled' } };
                // A reservation can still be pending; execute will persist cancellation before returning.
                if (this.records.has(requestId)) { this.queueView(entry); await entry.writes; if (entry.writeError) throw entry.writeError; }
            }
        }
        return this.getJob(requestId);
    }
}
