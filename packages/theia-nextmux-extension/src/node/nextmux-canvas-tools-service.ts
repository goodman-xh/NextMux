import { randomUUID } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CanvasAssetVersion, CanvasDocument, CanvasNode, CanvasPoint } from '@nextmux/comic-core';
import type { DesktopComicCanvasState } from '../common/nextmux-platform-protocol';
import { CanvasToolError, runCanvasLocalTool } from './nextmux-canvas-tools';
import type { CanvasLocalToolRequest, CanvasLocalToolOptions, CanvasLocalToolResult, CanvasToolProgress } from './nextmux-canvas-tools';

export interface CanvasToolStore {
    storageDirectory?(): Promise<string>;
    read(): Promise<DesktopComicCanvasState>;
    mutate(operation: (canvas: CanvasDocument) => CanvasDocument | Promise<CanvasDocument>, expectedRevision?: number): Promise<DesktopComicCanvasState>;
}
export interface RunComicCanvasToolRequest {
    readonly requestId: string;
    readonly nodeId: string;
    readonly sourceVersionId: string;
    readonly expectedRevision: number;
    readonly tool: CanvasLocalToolRequest['tool'];
    readonly parameters?: Readonly<Record<string, unknown>>;
    readonly position?: CanvasPoint;
    /** The tool's name in the user's language, for the new nodes' titles. */
    readonly label?: string;
}
export interface ComicCanvasToolJob {
    readonly requestId: string;
    readonly status: 'running' | 'succeeded' | 'failed' | 'cancelled';
    readonly progress?: CanvasToolProgress;
    readonly result?: CanvasLocalToolResult;
    readonly nodeIds?: readonly string[];
    readonly error?: { readonly code: string; readonly message: string };
}
interface RunningJob { readonly fingerprint: string; readonly controller: AbortController; readonly promise: Promise<ComicCanvasToolJob>; view: ComicCanvasToolJob }

/** A standalone facade for nextmux-platform-service; constructing it does not modify the core service or enqueue jobs. */
export class ComicCanvasToolsService {
    private readonly jobs = new Map<string, RunningJob>();
    constructor(readonly workspaceRoot: string, readonly store: CanvasToolStore,
        readonly options: Omit<CanvasLocalToolOptions, 'outputDirectory' | 'signal'>,
        readonly runner: typeof runCanvasLocalTool = runCanvasLocalTool) {}

    getJob(requestId: string): ComicCanvasToolJob | undefined {
        const job = this.jobs.get(requestId); return job ? structuredClone(job.view) : undefined;
    }
    cancel(requestId: string): ComicCanvasToolJob | undefined {
        const job = this.jobs.get(requestId); if (job?.view.status === 'running') job.controller.abort(); return this.getJob(requestId);
    }
    run(request: RunComicCanvasToolRequest): Promise<ComicCanvasToolJob> {
        if (!request?.requestId?.trim()) return Promise.reject(new CanvasToolError('REQUEST_ID_REQUIRED', 'A stable local processing request id is required'));
        // Snapshot synchronously so edits made after the click cannot mutate the running operation.
        const frozen = structuredClone(request), fingerprint = JSON.stringify(frozen), existing = this.jobs.get(frozen.requestId);
        if (existing) {
            if (existing.fingerprint !== fingerprint) return Promise.reject(new CanvasToolError('REQUEST_ID_CONFLICT', 'This request id already belongs to a different operation'));
            return existing.promise;
        }
        const controller = new AbortController();
        const entry: RunningJob = { fingerprint, controller, view: { requestId: frozen.requestId, status: 'running' }, promise: Promise.resolve(undefined as never) };
        // Defer the first asynchronous read until the job and cancellation controller are registered.
        const promise = Promise.resolve().then(() => this.execute(frozen, entry));
        const job = { ...entry, promise }; this.jobs.set(frozen.requestId, job);
        return promise;
    }
    private assertProjectPath(root: string, path: string): void {
        const relation = relative(root, path);
        if (relation === '..' || relation.startsWith('../') || relation.startsWith('..\\') || isAbsolute(relation)) throw new CanvasToolError('PROJECT_ASSET_REQUIRED', 'Local tools can process only imported project files');
    }
    private async localPath(uri: string): Promise<string> {
        const root = await realpath(this.workspaceRoot);
        if (typeof uri !== 'string' || !uri) throw new CanvasToolError('LOCAL_ASSET_REQUIRED', 'Import a local project file before processing it');
        if (/^[a-z][a-z\d+.-]*:/i.test(uri) && !/^file:/i.test(uri) && !/^[a-z]:[\\/]/i.test(uri)) throw new CanvasToolError('LOCAL_ASSET_REQUIRED', 'Import remote media before processing it');
        const path = await realpath(/^file:/i.test(uri) ? fileURLToPath(uri) : resolve(root, uri));
        this.assertProjectPath(root, path);
        return path;
    }
    private async localVersion(version: CanvasAssetVersion): Promise<CanvasAssetVersion> {
        return { ...version, uri: pathToFileURL(await this.localPath(version.uri)).href };
    }
    private async outputDirectory(): Promise<string> {
        const root = await realpath(this.workspaceRoot);
        let directory = root;
        // Validate each existing parent before creating a child, so an escaping
        // nextmux.media symlink cannot create canvas-tools outside the project.
        for (const component of ['nextmux.media', 'canvas-tools']) {
            const candidate = join(directory, component);
            await mkdir(candidate, { recursive: true });
            directory = await realpath(candidate);
            this.assertProjectPath(root, directory);
        }
        return directory;
    }
    private async execute(request: RunComicCanvasToolRequest, initial: RunningJob): Promise<ComicCanvasToolJob> {
        const job = this.jobs.get(request.requestId) || initial;
        try {
            const state = await this.store.read(), canvas = state.canvas, node = canvas?.nodes.find(item => item.id === request.nodeId);
            if (!canvas || canvas.revision !== request.expectedRevision) throw new CanvasToolError('CANVAS_REVISION_CONFLICT', 'Reload the canvas before processing this version');
            if (!node || !('versions' in node.payload)) throw new CanvasToolError('SOURCE_NODE_REQUIRED', 'Select a node containing media versions');
            const source = node.payload.versions.find(version => version.id === request.sourceVersionId);
            if (!source) throw new CanvasToolError('SOURCE_VERSION_MISSING', 'The selected asset version is unavailable');
            const sourceSnapshots = [source];
            const parameters: Record<string, unknown> = structuredClone(request.parameters || {});
            if (request.tool === 'color.lut') parameters.cubePath = await this.localPath(parameters.cubePath as string);
            if (request.tool === 'color.transfer') {
                const id = parameters.referenceVersionId;
                const versions = canvas.nodes.flatMap(item => 'versions' in item.payload ? item.payload.versions : []);
                const reference = typeof id === 'string' ? versions.find(version => version.id === id && version.kind === 'image') : undefined;
                if (!reference) throw new CanvasToolError('SOURCE_VERSION_MISSING', 'The colour reference image version is unavailable');
                sourceSnapshots.push(reference); parameters.reference = await this.localVersion(reference);
            }
            if (request.tool === 'image.gridStitch' && Array.isArray(parameters.cells)) {
                const versions = canvas.nodes.flatMap(item => 'versions' in item.payload ? item.payload.versions : []);
                const cells: (CanvasAssetVersion | null)[] = [];
                for (const cell of parameters.cells) {
                    if (cell === null) { cells.push(null); continue; }
                    const id = typeof cell === 'string' ? cell : (cell as Partial<CanvasAssetVersion>)?.id;
                    const version = versions.find(item => item.id === id);
                    if (!version) throw new CanvasToolError('SOURCE_VERSION_MISSING', 'A stitch image version is unavailable');
                    sourceSnapshots.push(version);
                    cells.push(await this.localVersion(version));
                } parameters.cells = cells;
            }
            const local = await this.localVersion(source);
            const result = await this.runner({ tool: request.tool, source: local, parameters } as CanvasLocalToolRequest, {
                ...this.options, outputDirectory: await this.outputDirectory(), signal: job.controller.signal,
                onProgress: progress => { job.view = { ...job.view, progress }; try { this.options.onProgress?.(progress); } catch { /* observer only */ } }
            });
            // Keep outputs even if the canvas was closed/deleted meanwhile; the job's result remains recoverable for manual attachment.
            job.view = { ...job.view, result };
            if (job.controller.signal.aborted) throw new CanvasToolError('CANCELLED', 'Local media processing was cancelled');
            const nodeIds = result.versions.map(() => `canvas-tool-${randomUUID()}`);
            await this.store.mutate(current => {
                if (job.controller.signal.aborted) throw new CanvasToolError('CANCELLED', 'Local media processing was cancelled before attachment');
                if (current.id !== canvas.id) throw new CanvasToolError('CANVAS_IDENTITY_CHANGED', 'The original canvas was replaced');
                const sourceNode = current.nodes.find(item => item.id === node.id);
                const currentVersion = sourceNode && 'versions' in sourceNode.payload ? sourceNode.payload.versions.find(version => version.id === source.id) : undefined;
                if (!currentVersion) throw new CanvasToolError('SOURCE_VERSION_MISSING', 'The original source version was removed during processing');
                if (JSON.stringify(currentVersion) !== JSON.stringify(source)) throw new CanvasToolError('SOURCE_VERSION_CHANGED', 'The original source version changed during processing');
                const available = current.nodes.flatMap(item => 'versions' in item.payload ? item.payload.versions : []);
                for (const snapshot of sourceSnapshots.slice(1)) {
                    if (!available.some(version => version.id === snapshot.id && JSON.stringify(version) === JSON.stringify(snapshot))) throw new CanvasToolError('SOURCE_VERSION_CHANGED', 'A referenced image version changed during processing');
                }
                const label = typeof request.label === 'string' ? request.label.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) : '';
                // Cards keep the result's shape (280 wide, like seeded cards); several results sit in a row, moved down to free space.
                const sizes = result.versions.map(version => {
                    const aspect = version.metadata?.width && version.metadata?.height ? version.metadata.height / version.metadata.width : 0.75;
                    return { width: 280, height: version.kind === 'audio' ? 120 : Math.round(Math.min(560, Math.max(120, 280 * aspect))) };
                });
                const origin = freeCanvasRow(current.nodes, { x: request.position?.x ?? node.position.x + node.size.width + 60, y: request.position?.y ?? node.position.y },
                    { width: sizes.length * 320 - 40, height: Math.max(...sizes.map(size => size.height)) });
                let x = origin.x;
                const added: CanvasNode[] = result.versions.map((version, index) => {
                    const size = sizes[index];
                    const position = { x, y: origin.y };
                    x += size.width + 40;
                    return { id: nodeIds[index], title: `${node.title} · ${label || request.tool}${result.versions.length > 1 ? ` ${index + 1}` : ''}`,
                        kind: version.kind, position, size, payload: { versions: [version], currentVersionId: version.id } };
                });
                return { ...current, nodes: [...current.nodes, ...added] };
            });
            job.view = { ...job.view, status: 'succeeded', nodeIds };
        } catch (error) {
            const exception = error as Error & { code?: string };
            job.view = { ...job.view, status: job.controller.signal.aborted ? 'cancelled' : 'failed', error: { code: exception.code || 'LOCAL_TOOL_FAILED', message: exception.message } };
        }
        return structuredClone(job.view);
    }
}

/** The first spot at or below `at` where a row of this size touches no card (groups are frames, so they may surround it). */
export function freeCanvasRow(nodes: readonly CanvasNode[], at: CanvasPoint, size: { readonly width: number; readonly height: number }): CanvasPoint {
    const margin = 24, cards = nodes.filter(item => item.kind !== 'group');
    const clear = (y: number): boolean => !cards.some(item => at.x < item.position.x + item.size.width + margin && item.position.x < at.x + size.width + margin
        && y < item.position.y + item.size.height + margin && item.position.y < y + size.height + margin);
    for (let step = 0; step < 200; step++) if (clear(at.y + step * 40)) return { x: at.x, y: at.y + step * 40 };
    return at;
}
