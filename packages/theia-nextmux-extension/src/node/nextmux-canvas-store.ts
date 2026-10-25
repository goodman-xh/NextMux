import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { CANVAS_FILE, createCanvasDocument, migrateCanvasDocument, validateCanvasDocument, validateCanvasRegistry } from '@nextmux/comic-core';
import type { CanvasAssetVersion, CanvasDocument, CanvasNode, GenerationSnapshot } from '@nextmux/comic-core';
import type { EnqueueMediaJobRequest, MediaJob } from '@nextmux/media-core';
import { enqueueRequest, isoTimestamp, jobStatus, mediaJobId } from '@nextmux/media-core';
import type { DesktopComicCanvasJob, DesktopComicCanvasState } from '../common/nextmux-platform-protocol';

export class CanvasServiceError extends Error {
    constructor(readonly code: string, message: string) { super(message); this.name = 'CanvasServiceError'; }
}

export const COMIC_CANVASES_DIRECTORY = 'nextmux.canvases';
export const COMIC_CANVAS_REGISTRY_FILE = 'nextmux.canvases.json';

/** IDs are path components only for free canvases; the legacy main document never moves. */
export function safeCanvasFileId(id: string): string {
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) || id.includes('..')) {
        throw new CanvasServiceError('CANVAS_ID_INVALID', 'The canvas ID is not a safe project file name.');
    }
    return id;
}

/** The original compiled request survives an enqueue/reply crash; it is never recompiled on recovery. */
export interface CanvasJobRecord extends DesktopComicCanvasJob {
    readonly request: EnqueueMediaJobRequest;
    readonly mediaEventCount?: number;
    readonly mediaApiStyle?: "openai" | "openrouter";
    readonly nativeImageSizeContract?: "seedream45_v1";
}

/** Trusted execution metadata is journaled separately from the model request and UI summary. */
function canvasMediaExecution(value: { readonly mediaApiStyle?: unknown; readonly nativeImageSizeContract?: unknown }, request: EnqueueMediaJobRequest): Pick<CanvasJobRecord, 'mediaApiStyle' | 'nativeImageSizeContract'> {
    const style = value.mediaApiStyle, size = value.nativeImageSizeContract;
    if (style !== undefined && style !== 'openai' && style !== 'openrouter'
        || size !== undefined && (size !== 'seedream45_v1' || request.kind !== 'image' || style !== 'openai'
            || (request.input as { model?: string }).model !== 'doubao-seedream-4-5-251128')) {
        throw new CanvasServiceError('CANVAS_JOBS_INVALID', 'The canvas execution metadata is invalid.');
    }
    return { ...(style === undefined ? {} : { mediaApiStyle: style }), ...(size === undefined ? {} : { nativeImageSizeContract: size }) };
}
function summaryOf({ request: _request, mediaEventCount: _eventCount, mediaApiStyle: _mediaApiStyle, nativeImageSizeContract: _nativeImageSizeContract, ...record }: CanvasJobRecord): DesktopComicCanvasJob { return record; }
function stableJson(value: unknown): string {
    const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
        : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().filter(key => (item as Record<string, unknown>)[key] !== undefined).map(key => [key, canonical((item as Record<string, unknown>)[key])])) : item;
    return JSON.stringify(canonical(value));
}

const queues = new Map<string, Promise<unknown>>();
const { lock } = require('proper-lockfile') as {
    lock(path: string, options: { realpath: boolean; lockfilePath: string; retries: { retries: number; minTimeout: number; maxTimeout: number }; stale: number; onCompromised?: () => void }): Promise<() => Promise<void>>;
};

async function atomicWrite(path: string, value: unknown): Promise<void> {
    const temporary = join(dirname(path), `.${randomUUID()}.canvas.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
        try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync(); }
        finally { await handle.close(); }
    }
    catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
    try { await rename(temporary, path); }
    catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
}

async function readJson(path: string): Promise<unknown | undefined> {
    try {
        const metadata = await lstat(path);
        if (!metadata.isFile() || metadata.isSymbolicLink()) throw new CanvasServiceError('CANVAS_FILE_INVALID', 'The canvas file is not a regular project file.');
        return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
    }
}

/** One atomic document write and a cross-process revision lock per canvas. */
export class ComicCanvasStore {
    constructor(readonly workspaceRoot: string, readonly canvasId?: string) {}

    protected async paths(): Promise<{ root: string; canvas: string; jobs: string }> {
        const root = await realpath(this.workspaceRoot);
        const mainPaths = { root, canvas: join(root, CANVAS_FILE), jobs: join(root, 'nextmux.canvas.jobs.json') };
        if (!this.canvasId || this.canvasId === 'main') return mainPaths;
        const rawRegistry = await readJson(join(root, COMIC_CANVAS_REGISTRY_FILE));
        const registry = rawRegistry === undefined ? undefined : validateCanvasRegistry(rawRegistry);
        const entry = registry?.canvases?.find(item => item.id === this.canvasId);
        if (entry?.deletedAt || entry?.deletionPending) throw new CanvasServiceError('CANVAS_UNAVAILABLE', 'This canvas is being moved to Trash or has been deleted.');
        if (registry?.mainCanvasId === this.canvasId) return mainPaths;
        const main = await readJson(mainPaths.canvas) as { id?: string } | undefined;
        if (main?.id === this.canvasId) return mainPaths;
        const folder = join(root, COMIC_CANVASES_DIRECTORY, safeCanvasFileId(this.canvasId));
        try {
            for (const candidate of [dirname(folder), folder]) {
                const metadata = await lstat(candidate);
                if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new CanvasServiceError('CANVAS_FILE_INVALID', 'The canvas directory is not a regular project directory.');
            }
            const canonical = await realpath(folder), delta = relative(root, canonical);
            if (isAbsolute(delta) || delta === '..' || delta.startsWith(`..${sep}`)) throw new CanvasServiceError('CANVAS_FILE_INVALID', 'The canvas directory is outside its project.');
            return { root, canvas: join(canonical, CANVAS_FILE), jobs: join(canonical, 'nextmux.canvas.jobs.json') };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new CanvasServiceError('CANVAS_NOT_FOUND', 'The canvas directory does not exist.');
            throw error;
        }
    }

    /** Local tool journals use the same owning directory as the document and media job journal. */
    async storageDirectory(): Promise<string> { return dirname((await this.paths()).canvas); }

    /** The registry uses this lock to mark a canvas unavailable before requesting native Trash. */
    async withLock<T>(operation: () => Promise<T>): Promise<T> { return this.exclusive(operation); }

    protected async exclusive<T>(operation: () => Promise<T>): Promise<T> {
        const { canvas } = await this.paths();
        const previous = queues.get(canvas) || Promise.resolve();
        const pending = previous.catch(() => undefined).then(async () => {
            const release = await lock(canvas, { realpath: false, lockfilePath: `${canvas}.lock`, retries: { retries: 20, minTimeout: 20, maxTimeout: 100 }, stale: 30_000, onCompromised: () => {} });
            try { return await operation(); } finally { await release(); }
        });
        queues.set(canvas, pending);
        try { return await pending; } finally { if (queues.get(canvas) === pending) queues.delete(canvas); }
    }

    protected async records(): Promise<CanvasJobRecord[]> {
        const raw = await readJson((await this.paths()).jobs);
        if (raw === undefined) return [];
        if (!Array.isArray(raw) || raw.some(record => !record || typeof record !== 'object' || typeof record.nodeId !== 'string'
            || !record.nodeId.trim() || typeof record.idempotencyKey !== 'string' || !record.idempotencyKey.trim()
            || !record.snapshot || !record.request || typeof record.status !== 'string')) {
            throw new CanvasServiceError('CANVAS_JOBS_INVALID', 'The canvas job journal is invalid.');
        }
        try {
            const keys = new Set<string>(), requestKeys = new Set<string>(), jobIds = new Set<string>();
            for (const record of raw as CanvasJobRecord[]) {
                const request = enqueueRequest(record.request);
                canvasMediaExecution(record, request);
                if (keys.has(record.idempotencyKey) || requestKeys.has(request.idempotencyKey)
                    || record.jobId && jobIds.has(record.jobId) || (request.kind !== 'image' && request.kind !== 'video')
                    || stableJson(request) !== stableJson(record.request)) throw new Error('Invalid request identity');
                keys.add(record.idempotencyKey); requestKeys.add(request.idempotencyKey);
                if (record.jobId !== undefined) jobIds.add(mediaJobId(record.jobId));
                if (record.status !== 'reserved') jobStatus(record.status);
                isoTimestamp(record.createdAt, 'canvas job.createdAt'); isoTimestamp(record.updatedAt, 'canvas job.updatedAt');
                if (record.mediaEventCount !== undefined && (!Number.isSafeInteger(record.mediaEventCount) || record.mediaEventCount < 0)
                    || record.error !== undefined && (!record.error || typeof record.error.code !== 'string' || typeof record.error.message !== 'string')) throw new Error('Invalid task metadata');
                if (record.startFrameContinuation !== undefined && (!/^start-frame-[a-f0-9]{32}$/u.test(record.startFrameContinuation.preparationId)
                    || !/^[a-f0-9]{64}$/u.test(record.startFrameContinuation.intentFingerprint) || request.kind !== 'video')) throw new Error('Invalid start-frame continuation');
            }
            // Reuse the canvas snapshot and secret/temporary-URL validator for the independent journal.
            const document = createCanvasDocument({ id: 'journal-validation', projectId: 'journal-validation' });
            const issues = validateCanvasDocument({ ...document, nodes: [{ id: 'journal-validation', kind: 'videoGen', title: 'Journal',
                position: { x: 0, y: 0 }, size: { width: 1, height: 1 }, payload: { mode: 'textToVideo', modelId: 'journal-validation',
                    prompt: '', parameters: {}, versions: [], jobs: raw.map(summaryOf) } }] });
            if (issues.length) throw new Error('Invalid request snapshot');
        } catch {
            throw new CanvasServiceError('CANVAS_JOBS_INVALID', 'The canvas job journal is invalid.');
        }
        return raw as CanvasJobRecord[];
    }

    async read(): Promise<DesktopComicCanvasState> {
        const paths = await this.paths(), raw = await readJson(paths.canvas);
        const records = await this.records();
        const canvas = raw === undefined ? undefined : migrateCanvasDocument(raw);
        if (canvas) this.checkedDocument(canvas, canvas.projectId);
        return { exists: raw !== undefined, fileName: relative(paths.root, paths.canvas).split(sep).join('/'), ...(canvas ? { canvas, canvasId: canvas.id } : this.canvasId ? { canvasId: this.canvasId } : {}),
            jobs: records.map(summaryOf) };
    }

    async getRecord(key: string): Promise<CanvasJobRecord | undefined> { return (await this.records()).find(record => record.idempotencyKey === key); }

    protected checkedDocument(canvas: CanvasDocument, projectId: string): void {
        const issues = validateCanvasDocument(canvas);
        if (issues.length) throw new CanvasServiceError('CANVAS_INVALID', issues.map(issue => `${issue.path}: ${issue.message}`).join('; '));
        if (canvas.projectId !== projectId) throw new CanvasServiceError('CANVAS_PROJECT_CHANGED', 'The canvas belongs to another comic project.');
        if (this.canvasId && this.canvasId !== 'main' && canvas.id !== this.canvasId) throw new CanvasServiceError('CANVAS_IDENTITY_CHANGED', 'The saved canvas does not match the selected canvas tab.');
    }

    protected async writeDocument(document: CanvasDocument, revision: number): Promise<CanvasDocument> {
        const next = { ...document, revision: revision + 1, updatedAt: new Date().toISOString() };
        this.checkedDocument(next, document.projectId);
        await atomicWrite((await this.paths()).canvas, next);
        return next;
    }

    async save(canvas: CanvasDocument, expectedRevision: number, projectId: string): Promise<DesktopComicCanvasState> {
        return this.exclusive(async () => {
            this.checkedDocument(canvas, projectId);
            const current = (await this.read()).canvas;
            this.assertRevision(current, expectedRevision);
            if (current && (current.id !== canvas.id || current.projectId !== canvas.projectId)) throw new CanvasServiceError('CANVAS_IDENTITY_CHANGED', 'The saved canvas identity cannot change.');
            if (current) {
                for (const oldNode of current.nodes) {
                    const incoming = canvas.nodes.find(node => node.id === oldNode.id);
                    if (!incoming || !('versions' in oldNode.payload)) continue;
                    if (!('versions' in incoming.payload)) throw new CanvasServiceError('CANVAS_VERSION_IMMUTABLE', 'Result history must survive a node type change.');
                    for (const version of oldNode.payload.versions) {
                        const nextVersion = incoming.payload.versions.find(item => item.id === version.id);
                        if (!nextVersion || stableJson(nextVersion) !== stableJson(version)) throw new CanvasServiceError('CANVAS_VERSION_IMMUTABLE', 'Existing result versions and their request snapshots cannot be rewritten.');
                    }
                }
                const priorVersions = new Map(current.nodes.flatMap(node => 'versions' in node.payload ? node.payload.versions.map(version => [version.id, version] as const) : []));
                for (const node of canvas.nodes) for (const version of 'versions' in node.payload ? node.payload.versions : []) {
                    const previous = priorVersions.get(version.id);
                    if (previous && stableJson(previous) !== stableJson(version)) throw new CanvasServiceError('CANVAS_VERSION_IMMUTABLE', 'An existing asset version ID cannot be reused for another result.');
                }
            }
            const records = await this.records();
            canvas = { ...canvas, nodes: canvas.nodes.map(node => {
                if (node.kind !== 'imageGen' && node.kind !== 'videoGen') return node;
                const jobs = records.filter(record => record.nodeId === node.id).map(({ nodeId: _nodeId, ...record }) => summaryOf({ ...record, nodeId: node.id }));
                return { ...node, payload: { ...node.payload, ...(jobs.length || node.payload.jobs !== undefined ? { jobs: jobs.map(({ nodeId: _nodeId, ...job }) => job) } : {}) } } as CanvasNode;
            }) };
            await this.writeDocument(canvas, current?.revision ?? 0);
            return this.read();
        });
    }

    protected assertRevision(canvas: CanvasDocument | undefined, expected: number): void {
        if (!Number.isSafeInteger(expected) || expected < 0 || (canvas?.revision ?? 0) !== expected) throw new CanvasServiceError('CANVAS_REVISION_CONFLICT', 'The canvas changed in another save. Reload it before saving.');
    }

    async mutate(operation: (canvas: CanvasDocument) => CanvasDocument | Promise<CanvasDocument>, expectedRevision?: number): Promise<DesktopComicCanvasState> {
        return this.exclusive(async () => {
            const canvas = (await this.read()).canvas;
            if (!canvas) throw new CanvasServiceError('CANVAS_NOT_FOUND', 'The comic canvas has not been saved.');
            if (expectedRevision !== undefined) this.assertRevision(canvas, expectedRevision);
            const next = await operation(canvas);
            if (next !== canvas) await this.writeDocument(next, canvas.revision);
            return this.read();
        });
    }

    async reserve(options: { nodeId: string; idempotencyKey: string; snapshot: GenerationSnapshot; request: EnqueueMediaJobRequest; expectedRevision: number; mediaApiStyle?: "openai" | "openrouter"; nativeImageSizeContract?: "seedream45_v1"; startFrameContinuation?: CanvasJobRecord['startFrameContinuation'] }): Promise<CanvasJobRecord> {
        return this.exclusive(async () => {
            const records = await this.records();
            const existing = records.find(record => record.idempotencyKey === options.idempotencyKey);
            if (existing) {
                if (existing.nodeId !== options.nodeId) throw new CanvasServiceError('CANVAS_IDEMPOTENCY_CONFLICT', 'This click key already belongs to another node.');
                if (options.startFrameContinuation && (existing.startFrameContinuation?.preparationId !== options.startFrameContinuation.preparationId
                    || existing.startFrameContinuation.intentFingerprint !== options.startFrameContinuation.intentFingerprint
                    || (existing.request.input as { connectionId?: string }).connectionId !== (options.request.input as { connectionId?: string }).connectionId)) throw new CanvasServiceError('CANVAS_IDEMPOTENCY_CONFLICT', 'This click key belongs to a different prepared video intent.');
                return existing;
            }
            if (records.some(record => record.nodeId === options.nodeId && ['reserved', 'awaiting_confirmation', 'queued', 'running', 'paused', 'interrupted'].includes(record.status))) {
                throw new CanvasServiceError('CANVAS_NODE_BUSY', 'This node already has an active media task. Recover or cancel it before generating again.');
            }
            const canvas = (await this.read()).canvas;
            this.assertRevision(canvas, options.expectedRevision);
            const node = canvas?.nodes.find(item => item.id === options.nodeId);
            if (!canvas || !node || (node.kind !== 'imageGen' && node.kind !== 'videoGen')) throw new CanvasServiceError('CANVAS_GENERATION_NODE_REQUIRED', 'Select an image or video generation node.');
            const now = new Date().toISOString();
            const request = enqueueRequest(options.request);
            if (options.startFrameContinuation !== undefined && (!/^start-frame-[a-f0-9]{32}$/u.test(options.startFrameContinuation.preparationId)
                || !/^[a-f0-9]{64}$/u.test(options.startFrameContinuation.intentFingerprint) || request.kind !== 'video')) throw new CanvasServiceError('CANVAS_JOBS_INVALID', 'The start-frame continuation identity is invalid.');
            const record: CanvasJobRecord = { nodeId: options.nodeId, idempotencyKey: options.idempotencyKey, snapshot: options.snapshot, request, ...canvasMediaExecution(options, request),
                ...(options.startFrameContinuation ? { startFrameContinuation: structuredClone(options.startFrameContinuation) } : {}), status: 'reserved', createdAt: now, updatedAt: now };
            const { nodeId: _nodeId, ...summary } = summaryOf(record);
            const prospective = { ...canvas, nodes: canvas.nodes.map(item => item.id === node.id ? { ...node, payload: { ...node.payload, jobs: [...(node.payload.jobs || []), summary] } } as CanvasNode : item) };
            this.checkedDocument(prospective, canvas.projectId);
            // The request journal lands before the browser sees a queue ID or any provider can run.
            await atomicWrite((await this.paths()).jobs, [...records, record]);
            await this.writeDocument(prospective, canvas.revision);
            return record;
        });
    }

    /** Resolve the current reservation under the canvas lock, including definite enqueue failures. */
    async resolveReservedJob(key: string, resolveJob: (record: CanvasJobRecord) => Promise<MediaJob>): Promise<MediaJob> {
        return this.exclusive(async () => {
            const records = await this.records();
            const index = records.findIndex(record => record.idempotencyKey === key);
            if (index < 0) throw new CanvasServiceError('CANVAS_JOB_NOT_FOUND', 'The canvas request reservation is missing.');
            const record = records[index];
            if (!record.jobId && record.status === 'failed') throw new CanvasServiceError(record.error?.code || 'CANVAS_ENQUEUE_FAILED', record.error?.message || 'This click did not create a media task. Generate again with a new click key.');
            try { return await resolveJob(record); }
            catch (error) {
                // MEDIA_QUEUE_FULL is raised before the queue writes a task. IO/transport failures
                // remain reserved because a task may already exist under this idempotency key.
                if (!record.jobId && record.status === 'reserved' && (error as { code?: string }).code === 'MEDIA_QUEUE_FULL') {
                    const failed: CanvasJobRecord = { ...record, status: 'failed', error: { code: 'MEDIA_QUEUE_FULL', message: (error as Error).message }, updatedAt: new Date().toISOString() };
                    records[index] = failed;
                    await atomicWrite((await this.paths()).jobs, records);
                    const canvas = (await this.read()).canvas;
                    const node = canvas?.nodes.find(item => item.id === record.nodeId);
                    if (canvas && node && (node.kind === 'imageGen' || node.kind === 'videoGen')) {
                        const { nodeId: _nodeId, ...summary } = summaryOf(failed);
                        const payload = { ...node.payload, jobs: [...(node.payload.jobs || []).filter(item => item.idempotencyKey !== key), summary] };
                        await this.writeDocument({ ...canvas, nodes: canvas.nodes.map(item => item.id === node.id ? { ...node, payload } as CanvasNode : item) }, canvas.revision);
                    }
                }
                throw error;
            }
        });
    }

    async recordJob(job: MediaJob, version?: CanvasAssetVersion): Promise<DesktopComicCanvasState> {
        return this.exclusive(async () => {
            const records = await this.records();
            const index = records.findIndex(record => record.request.idempotencyKey === job.idempotencyKey || record.jobId === job.id);
            if (index < 0) throw new CanvasServiceError('CANVAS_JOB_NOT_FOUND', 'The media task has no canvas request snapshot.');
            const old = records[index];
            const error = job.failure ? { code: job.failure.code, message: job.failure.message } : undefined;
            const eventCount = job.events?.length ?? 0;
            const oldTime = Date.parse(old.updatedAt), newTime = Date.parse(job.updatedAt);
            const stale = Boolean(old.jobId) && (newTime < oldTime || newTime === oldTime && ['succeeded', 'failed', 'cancelled'].includes(old.status)
                && !['succeeded', 'failed', 'cancelled'].includes(job.status) && eventCount <= (old.mediaEventCount ?? 0));
            const record: CanvasJobRecord = stale ? old : { ...old, jobId: job.id, status: job.status, ...(error ? { error } : { error: undefined }), updatedAt: job.updatedAt, mediaEventCount: eventCount };
            const changed = JSON.stringify(record) !== JSON.stringify(old);
            if (changed) { records[index] = record; await atomicWrite((await this.paths()).jobs, records); }
            const canvas = (await this.read()).canvas;
            const node = canvas?.nodes.find(item => item.id === record.nodeId);
            if (canvas && node && (node.kind === 'imageGen' || node.kind === 'videoGen')) {
                const { nodeId: _nodeId, ...summary } = summaryOf(record);
                const jobs = [...(node.payload.jobs || []).filter(item => item.idempotencyKey !== record.idempotencyKey), summary];
                const already = version && node.payload.versions.some(item => item.id === version.id);
                const payload = { ...node.payload, jobs, ...(version && !already ? { versions: [...node.payload.versions, version], currentVersionId: version.id } : {}) };
                if (JSON.stringify(payload) !== JSON.stringify(node.payload)) await this.writeDocument({ ...canvas, nodes: canvas.nodes.map(item => item.id === node.id ? { ...node, payload } as CanvasNode : item) }, canvas.revision);
            }
            return this.read();
        });
    }
}
