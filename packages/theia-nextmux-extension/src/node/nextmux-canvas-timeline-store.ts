import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { canvasTimelineSummary, validateCanvasTimeline } from '@nextmux/comic-core/canvas-timeline';
import type { CanvasTimelineDocument, CanvasTimelineSummary } from '@nextmux/comic-core/canvas-timeline';
import { CanvasServiceError } from './nextmux-canvas-store';

export const CANVAS_TIMELINES_DIRECTORY = 'nextmux.timelines';
const queues = new Map<string, Promise<unknown>>();
const { lock } = require('proper-lockfile') as { lock(path: string, options: { realpath: boolean; lockfilePath: string; retries: { retries: number; minTimeout: number; maxTimeout: number }; stale: number; onCompromised?: () => void }): Promise<() => Promise<void>> };
interface StoredTimeline { readonly document: CanvasTimelineDocument; readonly creationIntent: string }
function identity(id: string): string {
    if (typeof id !== 'string' || !/^timeline-[a-zA-Z0-9-]{8,100}$/.test(id)) throw new CanvasServiceError('TIMELINE_ID', 'Invalid timeline id.');
    return id;
}
export function timelineIdForRequest(canvasId: string, requestId: string): string {
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{8,120}$/.test(requestId)) throw new CanvasServiceError('TIMELINE_REQUEST_ID', 'A stable timeline request id is required.');
    return `timeline-${createHash('sha256').update(JSON.stringify([canvasId, requestId])).digest('hex').slice(0, 40)}`;
}
export function timelineCreationIntent(value: { readonly canvasId: string; readonly paths?: readonly (readonly string[])[]; readonly title?: string; readonly importLegacyEdit?: boolean }): string {
    return createHash('sha256').update(JSON.stringify({ canvasId: value.canvasId, paths: value.paths ?? null, title: value.title ?? null, importLegacyEdit: value.importLegacyEdit === true })).digest('hex');
}
/** Each timeline is one atomic JSON document; process + filesystem locks protect revision edits. */
export class ComicCanvasTimelineStore {
    constructor(readonly workspaceRoot: string) {}
    protected async directory(): Promise<string> {
        const root = await realpath(this.workspaceRoot), folder = join(root, CANVAS_TIMELINES_DIRECTORY);
        await mkdir(folder, { recursive: true, mode: 0o700 });
        const info = await lstat(folder);
        if (!info.isDirectory() || info.isSymbolicLink() || await realpath(folder) !== folder) throw new CanvasServiceError('TIMELINE_PATH', 'Timeline storage must be a regular project directory.');
        return folder;
    }
    protected async readStored(folder: string, id: string): Promise<StoredTimeline | undefined> {
        const file = join(folder, `${identity(id)}.json`);
        try {
            const info = await lstat(file);
            if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024) throw new CanvasServiceError('TIMELINE_FILE', 'Timeline data is not a regular bounded project file.');
            const value = JSON.parse(await readFile(file, 'utf8')) as StoredTimeline;
            if (!value || !/^[a-f0-9]{64}$/.test(value.creationIntent)) throw new CanvasServiceError('TIMELINE_FILE', 'Timeline creation record is invalid.');
            const document = validateCanvasTimeline(value.document);
            if (document.id !== id) throw new CanvasServiceError('TIMELINE_ID', 'Timeline file identity changed.');
            return { document, creationIntent: value.creationIntent };
        } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    }
    protected async write(folder: string, value: StoredTimeline): Promise<void> {
        validateCanvasTimeline(value.document);
        const text = `${JSON.stringify(value)}\n`;
        if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new CanvasServiceError('TIMELINE_LIMIT', 'Timeline data exceeds the storage limit.');
        const temp = join(folder, `.${randomUUID()}.tmp`), file = join(folder, `${identity(value.document.id)}.json`);
        const handle = await open(temp, 'wx', 0o600);
        try { try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); } await rename(temp, file); }
        catch (error) { await unlink(temp).catch(() => undefined); throw error; }
    }
    protected async exclusive<T>(id: string, action: (folder: string) => Promise<T>): Promise<T> {
        const folder = await this.directory(), file = join(folder, `${identity(id)}.json`), previous = queues.get(file) ?? Promise.resolve();
        const pending = previous.catch(() => undefined).then(async () => {
            const release = await lock(file, { realpath: false, lockfilePath: `${file}.lock`, retries: { retries: 80, minTimeout: 25, maxTimeout: 100 }, stale: 30_000, onCompromised: () => {} });
            try { return await action(folder); } finally { await release(); }
        });
        queues.set(file, pending);
        try { return await pending; } finally { if (queues.get(file) === pending) queues.delete(file); }
    }
    async read(id: string, projectId: string): Promise<CanvasTimelineDocument> {
        const stored = await this.readStored(await this.directory(), id);
        if (!stored) throw new CanvasServiceError('TIMELINE_MISSING', 'The selected timeline does not exist.');
        if (stored.document.projectId !== projectId) throw new CanvasServiceError('TIMELINE_PROJECT_MISMATCH', 'The selected timeline belongs to another project.');
        return stored.document;
    }
    async list(projectId: string, canvasId?: string): Promise<readonly CanvasTimelineSummary[]> {
        const folder = await this.directory(), result: CanvasTimelineSummary[] = [];
        for (const name of await readdir(folder)) {
            if (!/^timeline-[a-zA-Z0-9-]{8,100}\.json$/.test(name)) continue;
            const stored = await this.readStored(folder, name.slice(0, -5));
            if (stored?.document.projectId === projectId && (canvasId === undefined || stored.document.sourceCanvasId === canvasId)) result.push(canvasTimelineSummary(stored.document));
        }
        return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    }
    async create(id: string, projectId: string, intent: string, prepare: () => Promise<CanvasTimelineDocument>): Promise<CanvasTimelineDocument> {
        return this.exclusive(id, async folder => {
            const existing = await this.readStored(folder, id);
            if (existing) {
                if (existing.document.projectId !== projectId || existing.creationIntent !== intent) throw new CanvasServiceError('TIMELINE_INTENT_CHANGED', 'This request id already created another timeline intent.');
                return existing.document;
            }
            const document = validateCanvasTimeline(await prepare());
            if (document.id !== id || document.projectId !== projectId) throw new CanvasServiceError('TIMELINE_ID', 'Prepared timeline identity changed.');
            await this.write(folder, { document, creationIntent: intent }); return document;
        });
    }
    async mutate(id: string, projectId: string, expectedRevision: number, edit: (document: CanvasTimelineDocument) => CanvasTimelineDocument | Promise<CanvasTimelineDocument>): Promise<CanvasTimelineDocument> {
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new CanvasServiceError('TIMELINE_REVISION', 'A timeline revision is required.');
        return this.exclusive(id, async folder => {
            const stored = await this.readStored(folder, id);
            if (!stored || stored.document.projectId !== projectId) throw new CanvasServiceError('TIMELINE_MISSING', 'The selected timeline is unavailable in this project.');
            if (stored.document.revision !== expectedRevision) throw new CanvasServiceError('TIMELINE_REVISION_CONFLICT', 'The timeline changed in another editor. Reload it before saving.');
            const document = validateCanvasTimeline(await edit(structuredClone(stored.document)));
            if (document.id !== id || document.projectId !== projectId || document.sourceCanvasId !== stored.document.sourceCanvasId || document.revision !== expectedRevision + 1)
                throw new CanvasServiceError('TIMELINE_ID', 'An edit must keep its timeline identity and advance one revision.');
            await this.write(folder, { ...stored, document }); return document;
        });
    }
}
