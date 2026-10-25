import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, rm, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CANVAS_FILE, cancelDeleteRegistryCanvas, closeRegistryCanvas, createCanvasDocument, createCanvasRegistry,
    createRegistryCanvas, finalizeDeleteRegistryCanvas, orderRegistryCanvases, prepareDeleteRegistryCanvas,
    renameRegistryCanvas, reopenRegistryCanvas, validateCanvasRegistry, validateCanvasDocument } from '@nextmux/comic-core';
import type { CanvasDocument, CanvasRegistry, CanvasRegistryEntry } from '@nextmux/comic-core';
import { CanvasServiceError, ComicCanvasStore, COMIC_CANVAS_REGISTRY_FILE, COMIC_CANVASES_DIRECTORY, safeCanvasFileId } from './nextmux-canvas-store';

export interface PrepareComicCanvasDeleteResult { readonly registry: CanvasRegistry; readonly trashPath: string }
const { lock } = require('proper-lockfile') as { lock(path: string, options: { realpath: boolean; lockfilePath: string;
    retries: { retries: number; minTimeout: number; maxTimeout: number }; stale: number; onCompromised?: () => void }): Promise<() => Promise<void>> };
const queues = new Map<string, Promise<unknown>>();
const activeJob = (status: string): boolean => ['reserved', 'awaiting_confirmation', 'queued', 'running', 'paused', 'interrupted'].includes(status);

async function atomicWrite(path: string, value: unknown): Promise<void> {
    const temporary = join(dirname(path), `.${randomUUID()}.registry.tmp`), handle = await open(temporary, 'wx', 0o600);
    try {
        try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
        finally { await handle.close(); }
    }
    catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
    try { await rename(temporary, path); }
    catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
}
async function readJson(path: string): Promise<unknown | undefined> {
    try {
        const metadata = await lstat(path);
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 32 * 1024 * 1024) throw new CanvasServiceError('CANVAS_REGISTRY_INVALID', 'The canvas data file is not a regular project file.');
        return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
async function exists(path: string): Promise<boolean> {
    try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** The main canvas keeps its legacy file; free canvases own a directory with all their journals. */
export class ComicCanvasRegistryStore {
    constructor(readonly workspaceRoot: string) {}
    protected async exclusive<T>(operation: (root: string) => Promise<T>): Promise<T> {
        const root = await realpath(this.workspaceRoot), file = join(root, COMIC_CANVAS_REGISTRY_FILE), previous = queues.get(file) || Promise.resolve();
        const pending = previous.catch(() => undefined).then(async () => {
            const release = await lock(file, { realpath: false, lockfilePath: `${file}.lock`, retries: { retries: 40, minTimeout: 20, maxTimeout: 100 }, stale: 30_000, onCompromised: () => {} });
            try { return await operation(root); } finally { await release(); }
        });
        queues.set(file, pending);
        try { return await pending; } finally { if (queues.get(file) === pending) queues.delete(file); }
    }
    /** Library inspection must not create a registry or otherwise migrate an unopened project. */
    async readExisting(projectId: string, mainCanvas?: CanvasDocument): Promise<CanvasRegistry | undefined> {
        return this.existing(await realpath(this.workspaceRoot), projectId, mainCanvas);
    }
    protected async existing(root: string, projectId: string, mainCanvas?: CanvasDocument): Promise<CanvasRegistry | undefined> {
        if (mainCanvas && mainCanvas.projectId !== projectId) throw new CanvasServiceError('CANVAS_PROJECT_CHANGED', 'The main canvas belongs to another comic project.');
        const raw = await readJson(join(root, COMIC_CANVAS_REGISTRY_FILE));
        if (raw !== undefined) {
            const registry = validateCanvasRegistry(raw);
            if (registry.projectId !== projectId) throw new CanvasServiceError('CANVAS_PROJECT_CHANGED', 'The canvas registry belongs to another comic project.');
            if (mainCanvas && registry.mainCanvasId !== mainCanvas.id) throw new CanvasServiceError('CANVAS_IDENTITY_CHANGED', 'The main canvas identity differs from its saved registry.');
            for (const entry of registry.canvases) if (entry.kind === 'free') safeCanvasFileId(entry.id);
            return registry;
        }
        return undefined;
    }
    protected async current(root: string, projectId: string, mainCanvas?: CanvasDocument): Promise<CanvasRegistry> {
        const existing = await this.existing(root, projectId, mainCanvas);
        if (existing) return existing;
        const main = mainCanvas || (await new ComicCanvasStore(root).read()).canvas;
        if (!main) throw new CanvasServiceError('CANVAS_MAIN_REQUIRED', 'Save the project main canvas before adding canvas tabs.');
        const registry = createCanvasRegistry(projectId, main);
        await atomicWrite(join(root, COMIC_CANVAS_REGISTRY_FILE), registry);
        return registry;
    }
    async read(projectId: string, mainCanvas?: CanvasDocument): Promise<CanvasRegistry> {
        return this.exclusive(root => this.current(root, projectId, mainCanvas));
    }
    protected async write(root: string, registry: CanvasRegistry): Promise<CanvasRegistry> {
        validateCanvasRegistry(registry);
        await atomicWrite(join(root, COMIC_CANVAS_REGISTRY_FILE), registry);
        return registry;
    }
    async create(projectId: string, options: { readonly title: string; readonly mainCanvas?: CanvasDocument }): Promise<CanvasRegistry> {
        return this.exclusive(async root => {
            const registry = await this.current(root, projectId, options.mainCanvas), now = new Date().toISOString(), id = `canvas-${randomUUID()}`;
            const next = createRegistryCanvas(registry, { id, title: options.title, now }), parent = join(root, COMIC_CANVASES_DIRECTORY), folder = join(parent, safeCanvasFileId(id));
            await mkdir(parent, { recursive: true, mode: 0o700 });
            const metadata = await lstat(parent);
            if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new CanvasServiceError('CANVAS_FILE_INVALID', 'The canvas directory is not a regular project directory.');
            await mkdir(folder, { mode: 0o700 });
            try {
                const document = createCanvasDocument({ id, projectId, title: next.canvases.find(entry => entry.id === id)!.title, now });
                await new ComicCanvasStore(root, id).save(document, 0, projectId);
                return await this.write(root, next);
            } catch (error) {
                // This directory was never published in the registry; only failed creation staging is removed.
                await rm(folder, { recursive: true, force: true }).catch(() => undefined);
                throw error;
            }
        });
    }
    async rename(projectId: string, canvasId: string, title: string): Promise<CanvasRegistry> {
        return this.exclusive(async root => {
            const registry = await this.current(root, projectId), next = renameRegistryCanvas(registry, canvasId, title, new Date().toISOString());
            await new ComicCanvasStore(root, canvasId).mutate(document => ({ ...document, title: next.canvases.find(entry => entry.id === canvasId)!.title }));
            return this.write(root, next);
        });
    }
    async setOpen(projectId: string, canvasId: string, isOpen: boolean): Promise<CanvasRegistry> {
        return this.exclusive(async root => {
            const registry = await this.current(root, projectId), entry = registry.canvases.find(item => item.id === canvasId);
            if (entry?.deletionPending) throw new CanvasServiceError('CANVAS_UNAVAILABLE', 'The canvas is being moved to Trash.');
            return this.write(root, (isOpen ? reopenRegistryCanvas : closeRegistryCanvas)(registry, canvasId, new Date().toISOString()));
        });
    }
    async order(projectId: string, canvasIds: readonly string[]): Promise<CanvasRegistry> {
        return this.exclusive(async root => this.write(root, orderRegistryCanvases(await this.current(root, projectId), canvasIds, new Date().toISOString())));
    }
    async prepareDelete(projectId: string, canvasId: string, beforeRetire?: () => void | Promise<void>): Promise<PrepareComicCanvasDeleteResult> {
        return this.exclusive(async root => {
            const registry = await this.current(root, projectId), entry = registry.canvases.find(item => item.id === canvasId && !item.deletedAt);
            if (!entry || entry.kind === 'main') throw new CanvasServiceError(entry ? 'MAIN_CANVAS_PROTECTED' : 'CANVAS_NOT_FOUND', 'Only a free canvas can be moved to Trash.');
            const trashPath = join(root, COMIC_CANVASES_DIRECTORY, safeCanvasFileId(canvasId));
            if (entry.deletionPending) return { registry, trashPath };
            const store = new ComicCanvasStore(root, canvasId);
            return store.withLock(async () => {
                const state = await store.read();
                const localJobs = await readJson(join(await store.storageDirectory(), 'nextmux.canvas.tools.jobs.json'));
                if (localJobs !== undefined && (!Array.isArray(localJobs) || localJobs.some(record => !record || !record.job || typeof record.job.status !== 'string'))) throw new CanvasServiceError('CANVAS_JOBS_INVALID', 'The canvas tool journal is invalid.');
                // Local interrupted work is historical after backend recovery; it cannot resume or be cancelled.
                const active = state.jobs.some(job => activeJob(job.status)) || (Array.isArray(localJobs) && localJobs.some(record => record.job.status === 'running'))
                    || state.canvas?.nodes.some(node => 'job' in node.payload && node.payload.job && activeJob(node.payload.job.status)
                        || 'jobs' in node.payload && node.payload.jobs?.some(job => activeJob(job.status)));
                if (active) throw new CanvasServiceError('CANVAS_JOBS_ACTIVE', 'Finish or cancel the canvas tasks before deleting this canvas.');
                // Export reservations start before their locked source read. Check the same owning canvas here.
                await beforeRetire?.();
                return { registry: await this.write(root, prepareDeleteRegistryCanvas(registry, canvasId, new Date().toISOString())), trashPath };
            });
        });
    }
    /** Native Trash runs in the desktop renderer; a tombstone is written only after its directory moved. */
    async finalizeDelete(projectId: string, canvasId: string): Promise<CanvasRegistry> {
        return this.exclusive(async root => {
            const registry = await this.current(root, projectId), entry = registry.canvases.find(item => item.id === canvasId);
            if (entry?.deletedAt) return registry;
            if (!entry?.deletionPending) throw new CanvasServiceError('CANVAS_DELETE_NOT_PREPARED', 'Prepare the canvas Trash move before deleting its registry entry.');
            if (await exists(join(root, COMIC_CANVASES_DIRECTORY, safeCanvasFileId(canvasId)))) throw new CanvasServiceError('CANVAS_TRASH_REQUIRED', 'The canvas directory has not been moved to Trash.');
            return this.write(root, finalizeDeleteRegistryCanvas(registry, canvasId, new Date().toISOString()));
        });
    }
    async cancelDelete(projectId: string, canvasId: string): Promise<CanvasRegistry> {
        return this.exclusive(async root => {
            const registry = await this.current(root, projectId), entry = registry.canvases.find(item => item.id === canvasId);
            if (!entry?.deletionPending) return registry;
            if (!await exists(join(root, COMIC_CANVASES_DIRECTORY, safeCanvasFileId(canvasId)))) throw new CanvasServiceError('CANVAS_TRASH_ALREADY_MOVED', 'Finalize the canvas deletion because its directory has already moved to Trash.');
            return this.write(root, cancelDeleteRegistryCanvas(registry, canvasId, new Date().toISOString()));
        });
    }
    /** Install a complete duplicate while its workspace is hidden staging, including closed tabs and order. */
    async installDuplicate(projectId: string, documents: readonly CanvasDocument[], sourceEntries: readonly CanvasRegistryEntry[]): Promise<CanvasRegistry> {
        return this.exclusive(async root => {
            if (!documents.length) throw new CanvasServiceError('CANVAS_MAIN_REQUIRED', 'The duplicate needs a main canvas.');
            let registry = createCanvasRegistry(projectId, documents[0]), extra = 0;
            const entries = new Map<string, CanvasRegistryEntry>();
            for (const source of sourceEntries) {
                if (source.deletedAt) continue;
                const document = source.kind === 'main' ? documents[0] : documents[++extra];
                if (!document) throw new CanvasServiceError('CANVAS_REGISTRY_INVALID', 'The duplicate canvas registry does not match its documents.');
                if (validateCanvasDocument(document).length || document.projectId !== projectId) throw new CanvasServiceError('CANVAS_INVALID', 'A duplicate canvas document is invalid.');
                if (source.kind === 'free') {
                    registry = createRegistryCanvas(registry, { id: document.id, title: document.title, now: document.createdAt });
                    const folder = join(root, COMIC_CANVASES_DIRECTORY, safeCanvasFileId(document.id));
                    await mkdir(folder, { recursive: true, mode: 0o700 });
                    await atomicWrite(join(folder, CANVAS_FILE), document);
                }
                const entry = registry.canvases.find(item => item.id === document.id)!;
                entries.set(source.id, { ...entry, isOpen: source.isOpen });
            }
            if (extra !== documents.length - 1) throw new CanvasServiceError('CANVAS_REGISTRY_INVALID', 'The duplicate is missing canvas registry entries.');
            registry = { ...registry, canvases: sourceEntries.filter(source => !source.deletedAt).map(source => entries.get(source.id)!) };
            return this.write(root, registry);
        });
    }
}
