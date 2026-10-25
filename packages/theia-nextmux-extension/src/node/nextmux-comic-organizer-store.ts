import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, open, readFile, realpath, rename, rm, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyComicProjectMetaPatch, createComicProjectFolder, deleteComicProjectFolder, duplicateComicProjectBundle,
    migrateCanvasDocument, parseComicProject, productionDocumentFromComicProject, renameComicProjectFolder, serializeComicProject,
    COMIC_PROJECT_FILE, COMIC_PRODUCTION_FILE, ComicProductionStore, CANVAS_FILE } from '@nextmux/comic-core';
import type { CanvasDocument, ComicProductionDocument, ComicProject, ComicProjectFolder, ComicProjectMetadata, ComicProjectMetaPatch } from '@nextmux/comic-core';
import { ComicCanvasStore, COMIC_CANVAS_REGISTRY_FILE } from './nextmux-canvas-store';
import { ComicCanvasRegistryStore } from './nextmux-canvas-registry-store';
import { CANVAS_TIMELINES_DIRECTORY, ComicCanvasTimelineStore, timelineCreationIntent } from './nextmux-canvas-timeline-store';
import { canvasTimelineProjectId, validateCanvasTimeline, type CanvasTimelineDocument } from '@nextmux/comic-core/canvas-timeline';

export const COMIC_ORGANIZER_FILE = 'folders.json';
export interface ComicOrganizerDocument {
    readonly version: 1;
    readonly revision: number;
    readonly folders: readonly ComicProjectFolder[];
    readonly projectMetadata: readonly ComicProjectMetadata[];
}
export interface DuplicateComicLibraryProjectOptions { readonly title?: string; readonly folderId?: string | null }
export interface DuplicateComicLibraryProjectResult {
    readonly path: string;
    readonly project: ComicProject;
    readonly assetsCopied: number;
    readonly canvasesCopied: number;
    readonly timelinesCopied: number;
}
export class ComicOrganizerStoreError extends Error {
    constructor(readonly code: string, message: string) { super(message); this.name = 'ComicOrganizerStoreError'; }
}

const { lock } = require('proper-lockfile') as { lock(path: string, options: { realpath: boolean; lockfilePath: string;
    retries: { retries: number; minTimeout: number; maxTimeout: number }; stale: number; onCompromised?: () => void }): Promise<() => Promise<void>> };
const queues = new Map<string, Promise<unknown>>();
const empty = (): ComicOrganizerDocument => ({ version: 1, revision: 0, folders: [], projectMetadata: [] });
const timestamp = (value: unknown): boolean => typeof value === 'string' && Number.isFinite(Date.parse(value));
const inside = (root: string, candidate: string): boolean => {
    const delta = relative(root, candidate);
    return delta === '' || (!isAbsolute(delta) && delta !== '..' && !delta.startsWith(`..${sep}`));
};
async function atomicWrite(path: string, value: unknown): Promise<void> {
    const temporary = join(dirname(path), `.${randomUUID()}.organizer.tmp`), handle = await open(temporary, 'wx', 0o600);
    try {
        try { await handle.writeFile(typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
        finally { await handle.close(); }
    }
    catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
    try { await rename(temporary, path); }
    catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
}
async function regularFile(path: string, maximumBytes = 32 * 1024 * 1024): Promise<string | undefined> {
    try {
        const metadata = await lstat(path);
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximumBytes) throw new ComicOrganizerStoreError('COMIC_ORGANIZER_FILE_INVALID', 'The comic data file is not a regular project file.');
        return await readFile(path, 'utf8');
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
function checkedDocument(value: unknown): ComicOrganizerDocument {
    const raw = value as ComicOrganizerDocument;
    if (!raw || raw.version !== 1 || !Number.isSafeInteger(raw.revision) || raw.revision < 0
        || !Array.isArray(raw.folders) || !Array.isArray(raw.projectMetadata)) throw new ComicOrganizerStoreError('COMIC_ORGANIZER_INVALID', 'The comic organizer file has an invalid format.');
    const folders = new Set<string>(), names = new Set<string>(), projects = new Set<string>();
    for (const folder of raw.folders) {
        if (!folder || typeof folder.id !== 'string' || !folder.id.trim() || folders.has(folder.id)
            || typeof folder.name !== 'string' || !folder.name.trim() || folder.name.length > 64
            || names.has(folder.name.normalize('NFKC').trim().toLocaleLowerCase('zh-CN'))
            || !timestamp(folder.createdAt) || !timestamp(folder.updatedAt)) throw new ComicOrganizerStoreError('COMIC_ORGANIZER_INVALID', 'The comic folder list is invalid.');
        folders.add(folder.id); names.add(folder.name.normalize('NFKC').trim().toLocaleLowerCase('zh-CN'));
    }
    for (const metadata of raw.projectMetadata) {
        if (!metadata || typeof metadata.projectId !== 'string' || !metadata.projectId.trim() || projects.has(metadata.projectId)
            || metadata.folderId !== undefined && metadata.folderId !== null && (typeof metadata.folderId !== 'string' || !metadata.folderId.trim())
            || metadata.coverAssetId !== undefined && metadata.coverAssetId !== null && (typeof metadata.coverAssetId !== 'string' || !metadata.coverAssetId.trim())
            || !timestamp(metadata.updatedAt)) throw new ComicOrganizerStoreError('COMIC_ORGANIZER_INVALID', 'The comic project metadata is invalid.');
        projects.add(metadata.projectId);
    }
    return raw;
}
function localUris(value: unknown, output = new Set<string>()): Set<string> {
    if (Array.isArray(value)) for (const item of value) localUris(item, output);
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
        if ((key === 'uri' || key.endsWith('Uri')) && typeof item === 'string' && item.trim() && !/^(?:https?:|data:)/i.test(item)) output.add(item);
        else localUris(item, output);
    }
    return output;
}
function requiredUris(value: unknown, output = new Set<string>()): Set<string> {
    if (Array.isArray(value)) for (const item of value) requiredUris(item, output);
    else if (value && typeof value === 'object') {
        const record = value as { status?: unknown };
        for (const [key, uri] of Object.entries(value)) {
            if ((key === 'uri' || key.endsWith('Uri')) && typeof uri === 'string' && uri && (record.status === undefined || record.status === 'ready')) output.add(uri);
        }
        for (const item of Object.values(value)) requiredUris(item, output);
    }
    return output;
}
function remapProductionSource<T>(value: T, ids: Readonly<Record<string, string>>, uris: ReadonlyMap<string, string>, field = ''): T {
    if (typeof value === 'string') {
        if (field === 'uri' || field.endsWith('Uri')) return (uris.get(value) || value) as T;
        if (['title', 'summary', 'text', 'description', 'prompt', 'language', 'reason'].includes(field)) return value;
        return (Object.hasOwn(ids, value) ? ids[value] : value) as T;
    }
    if (Array.isArray(value)) return value.map(item => remapProductionSource(item, ids, uris, field)) as T;
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [Object.hasOwn(ids, key) ? ids[key] : key, remapProductionSource(item, ids, uris, key)])) as T;
    return value;
}
function productionSourceIds(value: unknown, ids: Record<string, string>): void {
    if (Array.isArray(value)) for (const item of value) productionSourceIds(item, ids);
    else if (value && typeof value === 'object') {
        const id = (value as { id?: unknown }).id;
        if (typeof id === 'string' && id && !Object.hasOwn(ids, id)) ids[id] = `${/^[A-Za-z][A-Za-z0-9]*/.exec(id)?.[0] || 'entity'}-${randomUUID()}`;
        for (const item of Object.values(value)) productionSourceIds(item, ids);
    }
}
function duplicateProduction(source: ComicProductionDocument | undefined, project: ComicProject, idMap: Readonly<Record<string, string>>, uris: ReadonlyMap<string, string>, now: string): ComicProductionDocument {
    const projected = productionDocumentFromComicProject(project);
    if (!source) return projected;
    const ids: Record<string, string> = Object.assign(Object.create(null), idMap);
    // Capability facts are configuration; render jobs retain their ownership solely in the original.
    const body = { ...source, renderJobs: [], providerProfiles: [] };
    productionSourceIds(body, ids); ids[source.id] = projected.id;
    const copy = remapProductionSource(body, ids, uris);
    return { ...copy, id: projected.id, projectId: project.id, title: project.title, revision: 0, storyboardRevision: project.revision,
        createdAt: now, updatedAt: now, renderJobs: [], providerProfiles: structuredClone(source.providerProfiles),
        episodes: copy.episodes.map(episode => episode.status === 'generating' || episode.status === 'planning' ? { ...episode, status: 'draft' } : episode),
        shots: copy.shots.map(shot => shot.status === 'generating' || shot.status === 'queued' ? { ...shot, status: 'draft' } : shot) };
}

/** The existing comic home owns the folder list and project metadata in one atomic file. */
export class ComicOrganizerStore {
    constructor(readonly libraryRoot: string) {}

    protected async root(): Promise<string> {
        await mkdir(this.libraryRoot, { recursive: true, mode: 0o700 });
        const metadata = await lstat(this.libraryRoot);
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new ComicOrganizerStoreError('COMIC_HOME_INVALID', 'The comic home must be a regular local directory.');
        return realpath(this.libraryRoot);
    }
    protected async exclusive<T>(operation: (root: string) => Promise<T>): Promise<T> {
        const root = await this.root(), file = join(root, COMIC_ORGANIZER_FILE), previous = queues.get(file) || Promise.resolve();
        const pending = previous.catch(() => undefined).then(async () => {
            const release = await lock(file, { realpath: false, lockfilePath: `${file}.lock`, retries: { retries: 40, minTimeout: 20, maxTimeout: 100 }, stale: 30_000, onCompromised: () => {} });
            try { return await operation(root); } finally { await release(); }
        });
        queues.set(file, pending);
        try { return await pending; } finally { if (queues.get(file) === pending) queues.delete(file); }
    }
    async read(): Promise<ComicOrganizerDocument> {
        const raw = await regularFile(join(await this.root(), COMIC_ORGANIZER_FILE));
        return raw === undefined ? empty() : checkedDocument(JSON.parse(raw));
    }
    protected async write(root: string, document: ComicOrganizerDocument): Promise<ComicOrganizerDocument> {
        const next = checkedDocument({ ...document, revision: document.revision + 1 });
        await atomicWrite(join(root, COMIC_ORGANIZER_FILE), next);
        return next;
    }
    async createFolder(name: string): Promise<ComicOrganizerDocument> {
        return this.exclusive(async root => {
            const document = await this.read();
            return this.write(root, { ...document, folders: createComicProjectFolder(document.folders, randomUUID(), name, new Date().toISOString()) });
        });
    }
    async renameFolder(id: string, name: string): Promise<ComicOrganizerDocument> {
        return this.exclusive(async root => {
            const document = await this.read();
            return this.write(root, { ...document, folders: renameComicProjectFolder(document.folders, id, name, new Date().toISOString()) });
        });
    }
    async deleteFolder(id: string): Promise<ComicOrganizerDocument> {
        return this.exclusive(async root => {
            const document = await this.read(), next = deleteComicProjectFolder(document.folders, document.projectMetadata, id, new Date().toISOString());
            return this.write(root, { ...document, ...next });
        });
    }
    async patchProject(project: ComicProject, patch: ComicProjectMetaPatch, commitProject?: (prepared: ComicProject) => Promise<void>):
        Promise<{ document: ComicOrganizerDocument; project: ComicProject; metadata: ComicProjectMetadata }> {
        return this.exclusive(async root => {
            const document = await this.read(), now = new Date().toISOString();
            const metadata = document.projectMetadata.find(item => item.projectId === project.id) || { projectId: project.id, updatedAt: project.updatedAt };
            const next = applyComicProjectMetaPatch(project, metadata, patch, document.folders, now);
            if (next.project !== project && commitProject) await commitProject(next.project);
            const saved = await this.write(root, { ...document, projectMetadata: [...document.projectMetadata.filter(item => item.projectId !== project.id), next.metadata] });
            return { document: saved, ...next };
        });
    }

    /** Every referenced local asset is copied; the original project may later move to Trash safely. */
    async duplicate(sourceRoot: string, options: DuplicateComicLibraryProjectOptions = {}): Promise<DuplicateComicLibraryProjectResult> {
        return this.exclusive(async library => {
            const organizer = await this.read(), source = await realpath(resolve(sourceRoot));
            if (options.folderId !== undefined && options.folderId !== null && !organizer.folders.some(folder => folder.id === options.folderId)) throw new ComicOrganizerStoreError('COMIC_FOLDER_NOT_FOUND', 'The target folder does not exist.');
            const originalText = await regularFile(join(source, COMIC_PROJECT_FILE), 10 * 1024 * 1024);
            if (!originalText) throw new ComicOrganizerStoreError('PROJECT_NOT_FOUND', 'The comic project does not exist.');
            const original = parseComicProject(originalText).project, mainState = await new ComicCanvasStore(source).read();
            const productionText = await regularFile(join(source, COMIC_PRODUCTION_FILE));
            const production = productionText === undefined ? undefined : (await (await ComicProductionStore.create({ workspaceRoot: source })).read()).document;
            if (production && production.projectId !== original.id) throw new ComicOrganizerStoreError('CANVAS_PROJECT_CHANGED', 'The production document belongs to another comic project.');
            const sourceRegistry = mainState.canvas ? await new ComicCanvasRegistryStore(source).read(original.id, mainState.canvas) : undefined;
            const registryText = await regularFile(join(source, COMIC_CANVAS_REGISTRY_FILE));
            if (registryText !== undefined && !mainState.canvas) throw new ComicOrganizerStoreError('CANVAS_MAIN_REQUIRED', 'The source project main canvas is missing.');
            const canvases: CanvasDocument[] = mainState.canvas ? [mainState.canvas] : [];
            const sourceDocuments = new Map<string, string>();
            const capture = async (path: string, document: CanvasDocument): Promise<void> => {
                const snapshot = await regularFile(path, Number.POSITIVE_INFINITY);
                if (!snapshot || JSON.stringify(migrateCanvasDocument(JSON.parse(snapshot))) !== JSON.stringify(document)) throw new ComicOrganizerStoreError('COMIC_DUPLICATE_CONFLICT', 'A source canvas changed while copying.');
                sourceDocuments.set(path, snapshot);
            };
            for (const entry of sourceRegistry?.canvases || []) {
                if (entry.kind === 'main' || entry.deletedAt) continue;
                if (entry.deletionPending) throw new ComicOrganizerStoreError('CANVAS_UNAVAILABLE', 'A project canvas is currently being moved to Trash.');
                const store = new ComicCanvasStore(source, entry.id), state = await store.read();
                if (!state.canvas) throw new ComicOrganizerStoreError('CANVAS_NOT_FOUND', 'A project canvas document is missing.');
                canvases.push(state.canvas);
                await capture(join(await store.storageDirectory(), CANVAS_FILE), state.canvas);
            }
            if (mainState.canvas) await capture(join(source, CANVAS_FILE), mainState.canvas);
            const timelines: CanvasTimelineDocument[] = [];
            const timelineStore = new ComicCanvasTimelineStore(source);
            const timelineInfo = await lstat(join(source, CANVAS_TIMELINES_DIRECTORY)).catch(error => {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error;
            });
            if (timelineInfo) {
                if (!timelineInfo.isDirectory() || timelineInfo.isSymbolicLink()) throw new ComicOrganizerStoreError('COMIC_ORGANIZER_FILE_INVALID', 'Timeline storage is not a regular project directory.');
                for (const summary of await timelineStore.list(original.id)) {
                    const document = await timelineStore.read(summary.id, original.id), path = join(source, CANVAS_TIMELINES_DIRECTORY, `${summary.id}.json`);
                    const snapshot = await regularFile(path, 16 * 1024 * 1024);
                    if (!snapshot || JSON.stringify(validateCanvasTimeline(JSON.parse(snapshot).document)) !== JSON.stringify(document)) throw new ComicOrganizerStoreError('COMIC_DUPLICATE_CONFLICT', 'A source timeline changed while copying.');
                    timelines.push(document); sourceDocuments.set(path, snapshot);
                }
            }
            const staging = join(library, `.nextmux-duplicate-${randomUUID()}`), now = new Date().toISOString();
            await mkdir(staging, { mode: 0o700 });
            let destination: string | undefined, published = false;
            try {
                const uriMap = new Map<string, string>(), fileMap = new Map<string, string>();
                await mkdir(join(staging, 'nextmux.media'), { mode: 0o700 });
                const productionBody = production ? { ...production, renderJobs: [] } : undefined;
                const required = requiredUris([original, ...canvases, productionBody, ...timelines]);
                for (const uri of localUris([original, ...canvases, productionBody, ...timelines])) {
                    const fileUri = uri.startsWith('file:') ? fileURLToPath(uri) : uri;
                    const requested = resolve(source, fileUri);
                    if (!inside(source, requested)) throw new ComicOrganizerStoreError('COMIC_ASSET_OUTSIDE_PROJECT', 'A comic asset resolves outside its project.');
                    let sourceFile: string;
                    try {
                        const components = relative(source, requested).split(sep);
                        for (let index = 1; index <= components.length; index++) {
                            const metadata = await lstat(join(source, ...components.slice(0, index)));
                            if (metadata.isSymbolicLink()) throw new ComicOrganizerStoreError('COMIC_ASSET_INVALID', 'A comic asset cannot be a symbolic link.');
                        }
                        sourceFile = await realpath(requested);
                    } catch (error) {
                        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !required.has(uri)) {
                            uriMap.set(uri, `nextmux.media/missing-${randomUUID()}${extname(basename(requested)).slice(0, 16)}`);
                            continue; // Explicitly missing references remain missing within the copy's own folder.
                        }
                        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ComicOrganizerStoreError('COMIC_ASSET_MISSING', 'A ready comic asset is missing from the source project.');
                        throw error;
                    }
                    if (!inside(source, sourceFile)) throw new ComicOrganizerStoreError('COMIC_ASSET_OUTSIDE_PROJECT', 'A comic asset resolves outside its project.');
                    let copied = fileMap.get(sourceFile);
                    if (!copied) {
                        const metadata = await lstat(sourceFile);
                        if (!metadata.isFile()) throw new ComicOrganizerStoreError('COMIC_ASSET_INVALID', 'A comic asset is not a regular file.');
                        copied = `nextmux.media/copy-${randomUUID()}${extname(basename(sourceFile)).slice(0, 16)}`;
                        await copyFile(sourceFile, join(staging, copied), constants.COPYFILE_EXCL);
                        const after = await lstat(sourceFile);
                        if (after.size !== metadata.size || after.mtimeMs !== metadata.mtimeMs || after.ino !== metadata.ino) throw new ComicOrganizerStoreError('COMIC_DUPLICATE_CONFLICT', 'A source asset changed while copying.');
                        fileMap.set(sourceFile, copied);
                    }
                    uriMap.set(uri, copied);
                }
                const copied = duplicateComicProjectBundle(original, canvases, { projectId: `project-${randomUUID()}`, title: options.title ?? original.title,
                    now, idFactory: (prefix: string) => `${prefix}-${randomUUID()}`, assetUri: (uri: string) => uriMap.get(uri) || uri });
                const serializedProject = serializeComicProject(copied.project), copiedProduction = duplicateProduction(production, copied.project, copied.idMap, uriMap, now);
                if (Buffer.byteLength(serializedProject, 'utf8') > 10 * 1024 * 1024 || Buffer.byteLength(JSON.stringify(copiedProduction), 'utf8') > 32 * 1024 * 1024) throw new ComicOrganizerStoreError('COMIC_DUPLICATE_TOO_LARGE', 'The copied comic exceeds the existing project or production file size limit.');
                await atomicWrite(join(staging, COMIC_PROJECT_FILE), serializedProject);
                await atomicWrite(join(staging, COMIC_PRODUCTION_FILE), copiedProduction);
                if (copied.documents.length) {
                    await atomicWrite(join(staging, CANVAS_FILE), copied.documents[0]);
                    const originalEntries = sourceRegistry?.canvases.filter(entry => !entry.deletedAt) || [];
                    await new ComicCanvasRegistryStore(staging).installDuplicate(copied.project.id, copied.documents, originalEntries);
                }
                // A timeline may retain a video version no longer present on its source canvas. Copy that frozen asset too.
                const timelineIds: Record<string, string> = { ...copied.idMap };
                const allocate = (prefix: string, id: string): string => timelineIds[id] ??= `${prefix}-${randomUUID()}`;
                for (const document of timelines) {
                    const id = allocate('timeline', document.id), sourceCanvasId = allocate('canvas', document.sourceCanvasId);
                    const edit = duplicateComicProjectBundle(document.project, [], { projectId: canvasTimelineProjectId(id), title: document.project.title, now,
                        idFactory: (prefix, oldId) => allocate(prefix, oldId), assetUri: uri => uriMap.get(uri) || uri });
                    Object.assign(timelineIds, edit.idMap);
                    const timeline = validateCanvasTimeline({ ...document, id, projectId: copied.project.id, sourceCanvasId, sourceCanvasRevision: 0,
                        revision: 0, project: edit.project, createdAt: now, updatedAt: now,
                        sources: document.sources.map(item => ({ ...item, nodeId: allocate('node', item.nodeId), versionId: allocate('version', item.versionId),
                            assetId: allocate('asset', item.assetId), shotId: allocate('shot', item.shotId) })) });
                    await new ComicCanvasTimelineStore(staging).create(id, copied.project.id, timelineCreationIntent({ canvasId: sourceCanvasId, title: timeline.title }), async () => timeline);
                }
                if (await regularFile(join(source, COMIC_PROJECT_FILE), 10 * 1024 * 1024) !== originalText
                    || await regularFile(join(source, COMIC_CANVAS_REGISTRY_FILE)) !== registryText
                    || await regularFile(join(source, COMIC_PRODUCTION_FILE)) !== productionText) throw new ComicOrganizerStoreError('COMIC_DUPLICATE_CONFLICT', 'The source project changed while copying.');
                for (const [path, snapshot] of sourceDocuments) {
                    const current = await regularFile(path, Number.POSITIVE_INFINITY);
                    if (current !== snapshot) throw new ComicOrganizerStoreError('COMIC_DUPLICATE_CONFLICT', 'A source canvas changed while copying.');
                }
                const finalTimelineInfo = await lstat(join(source, CANVAS_TIMELINES_DIRECTORY)).catch(error => {
                    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error;
                });
                if (finalTimelineInfo && (!finalTimelineInfo.isDirectory() || finalTimelineInfo.isSymbolicLink())
                    || JSON.stringify((finalTimelineInfo ? await timelineStore.list(original.id) : []).map(item => item.id).sort()) !== JSON.stringify(timelines.map(item => item.id).sort()))
                    throw new ComicOrganizerStoreError('COMIC_DUPLICATE_CONFLICT', 'The source timeline list changed while copying.');
                const slug = copied.project.title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[.\s]+/, '').slice(0, 60).replace(/[. ]+$/, '') || 'comic';
                for (let attempt = 1; attempt <= 200; attempt++) {
                    const candidate = join(library, attempt === 1 ? slug : `${slug} ${attempt}`);
                    const existing = await lstat(candidate).catch(error => {
                        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
                        throw error;
                    });
                    if (existing) continue;
                    try {
                        for (let retry = 0; ; retry++) {
                            try {
                                await rename(staging, candidate);
                                break;
                            } catch (renameError) {
                                const renameCode = (renameError as NodeJS.ErrnoException).code;
                                if ((renameCode === 'EPERM' || renameCode === 'EACCES') && retry < 4 && !(await lstat(candidate).catch(() => undefined))) {
                                    await new Promise(resolveDelay => setTimeout(resolveDelay, 40 * (retry + 1)));
                                    continue;
                                }
                                throw renameError;
                            }
                        }
                        destination = candidate;
                        published = true;
                        break;
                    } catch (error) {
                        const code = (error as NodeJS.ErrnoException).code;
                        if (code === 'EEXIST' || code === 'ENOTEMPTY' || ((code === 'EPERM' || code === 'EACCES') && await lstat(candidate).catch(() => undefined))) continue;
                        throw error;
                    }
                }
                if (!destination) throw new ComicOrganizerStoreError('COMIC_CREATE_FAILED', 'Unable to allocate a folder for the copied comic.');
                const previousMeta = organizer.projectMetadata.find(item => item.projectId === original.id);
                const coverAssetId = previousMeta?.coverAssetId === null ? null : previousMeta?.coverAssetId ? copied.idMap[previousMeta.coverAssetId] : undefined;
                const metadata: ComicProjectMetadata = { projectId: copied.project.id, updatedAt: now,
                    ...(options.folderId !== undefined ? { folderId: options.folderId } : previousMeta?.folderId !== undefined ? { folderId: previousMeta.folderId } : {}),
                    ...(coverAssetId !== undefined ? { coverAssetId } : {}) };
                await this.write(library, { ...organizer, projectMetadata: [...organizer.projectMetadata, metadata] });
                return { path: destination, project: copied.project, assetsCopied: fileMap.size, canvasesCopied: copied.documents.length, timelinesCopied: timelines.length };
            } finally {
                await rm(staging, { recursive: true, force: true }).catch(() => undefined);
                if (destination && !published) await rmdir(destination).catch(() => undefined);
            }
        });
    }
}
