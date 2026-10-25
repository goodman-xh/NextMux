import type { CanvasAssetVersion, CanvasDocument, CanvasGenerationJob, CanvasMediaKind, GenerationSnapshot } from '@nextmux/comic-core/canvas';

export type CanvasHistoryStatus = 'success' | 'running' | 'failed' | 'other';
export interface CanvasHistoryEntry {
    readonly key: string;
    readonly canvasId: string;
    readonly canvasTitle: string;
    readonly nodeId: string;
    readonly nodeTitle: string;
    readonly kind: CanvasMediaKind;
    readonly createdAt: string;
    readonly status: CanvasHistoryStatus;
    readonly rawStatus: string;
    readonly current: boolean;
    readonly version?: CanvasAssetVersion;
    readonly job?: CanvasGenerationJob;
    readonly snapshot?: GenerationSnapshot;
}
export interface CanvasHistoryFilter {
    readonly canvasId?: string;
    readonly nodeId?: string;
    readonly kind?: CanvasMediaKind | 'all';
    readonly status?: CanvasHistoryStatus | 'all';
    readonly query?: string;
}
export function canvasHistoryStatus(status: string): CanvasHistoryStatus {
    if (status === 'succeeded') return 'success';
    if (['reserved', 'awaiting_confirmation', 'queued', 'running', 'paused', 'waiting'].includes(status)) return 'running';
    if (['failed', 'cancelled', 'interrupted'].includes(status)) return 'failed';
    return 'other';
}
/** Keep canvas/node/version identity; equal URLs in different works must never collapse. */
export function collectCanvasHistory(canvases: readonly CanvasDocument[]): readonly CanvasHistoryEntry[] {
    const entries: CanvasHistoryEntry[] = [], seenCanvases = new Set<string>();
    for (const canvas of canvases) {
        if (seenCanvases.has(canvas.id)) continue;
        seenCanvases.add(canvas.id);
        for (const node of canvas.nodes) {
            if (!('versions' in node.payload)) continue;
            const jobs = 'jobs' in node.payload ? node.payload.jobs ?? [] : [];
            const represented = new Set<CanvasGenerationJob>();
            for (const version of node.payload.versions) {
                const job = jobs.find(item => Boolean(version.provenance?.jobId && (item.jobId === version.provenance.jobId || item.idempotencyKey === version.provenance.jobId)));
                if (job) represented.add(job);
                entries.push({ key: JSON.stringify([canvas.id, node.id, 'version', version.id]), canvasId: canvas.id, canvasTitle: canvas.title,
                    nodeId: node.id, nodeTitle: node.title, kind: version.kind, createdAt: version.createdAt,
                    status: version.status === 'uploading' ? 'running' : version.status === 'missing' ? 'other' : 'success', rawStatus: version.status ?? 'ready',
                    current: node.payload.currentVersionId === version.id, version, ...(job ? { job } : {}), ...(version.snapshot ?? job?.snapshot ? { snapshot: version.snapshot ?? job?.snapshot } : {}) });
            }
            for (const job of jobs) {
                if (represented.has(job)) continue;
                entries.push({ key: JSON.stringify([canvas.id, node.id, 'job', job.idempotencyKey]), canvasId: canvas.id, canvasTitle: canvas.title,
                    nodeId: node.id, nodeTitle: node.title, kind: node.kind === 'imageGen' ? 'image' : 'video', createdAt: job.createdAt,
                    status: canvasHistoryStatus(job.status), rawStatus: job.status, current: false, job, snapshot: job.snapshot });
            }
        }
    }
    return entries.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.key.localeCompare(right.key));
}
export function filterCanvasHistory(entries: readonly CanvasHistoryEntry[], filter: CanvasHistoryFilter): readonly CanvasHistoryEntry[] {
    const query = filter.query?.trim().toLocaleLowerCase();
    return entries.filter(entry => (!filter.canvasId || entry.canvasId === filter.canvasId) && (!filter.nodeId || entry.nodeId === filter.nodeId)
        && (!filter.kind || filter.kind === 'all' || entry.kind === filter.kind) && (!filter.status || filter.status === 'all' || entry.status === filter.status)
        && (!query || [entry.nodeTitle, entry.canvasTitle, entry.snapshot?.modelId, entry.snapshot?.prompt].some(value => value?.toLocaleLowerCase().includes(query))));
}
export function canvasHistoryVersionAvailable(entry: CanvasHistoryEntry): boolean {
    return Boolean(entry.version?.uri.trim() && (entry.version.status === undefined || entry.version.status === 'ready'));
}
/** Show only generation options, never arbitrary private adapter configuration. */
export function canvasHistoryParameters(snapshot: GenerationSnapshot | undefined): Readonly<Record<string, string | number | boolean>> {
    return Object.fromEntries(['resolution', 'aspectRatio', 'durationSeconds', 'width', 'height', 'generateAudio', 'preserveInputAudio', 'quality', 'imageCount', 'outputFormat', 'bitrate']
        .flatMap(key => { const value = snapshot?.parameters[key]; return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? [[key, value]] : []; }));
}
export function groupCanvasHistory(entries: readonly CanvasHistoryEntry[], mode: 'day' | 'week' | 'month'): readonly { readonly date: string; readonly entries: readonly CanvasHistoryEntry[] }[] {
    const groups = new Map<string, CanvasHistoryEntry[]>();
    for (const entry of entries) {
        const date = new Date(entry.createdAt);
        if (mode === 'month') date.setDate(1);
        if (mode === 'week') date.setDate(date.getDate() - (date.getDay() + 6) % 7);
        const key = Number.isNaN(date.getTime()) ? '' : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        groups.set(key, [...groups.get(key) ?? [], entry]);
    }
    return [...groups].map(([date, items]) => ({ date, entries: items }));
}
export interface CanvasHistoryWindow { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
export function clampCanvasHistoryWindow(rect: CanvasHistoryWindow, viewport: { readonly width: number; readonly height: number }): CanvasHistoryWindow {
    const availableWidth = Math.max(1, viewport.width - 48), availableHeight = Math.max(1, viewport.height - 48);
    const width = Math.max(Math.min(450, availableWidth), Math.min(Number.isFinite(rect.width) ? rect.width : 760, availableWidth));
    const height = Math.max(Math.min(520, availableHeight), Math.min(Number.isFinite(rect.height) ? rect.height : 720, Math.min(1000, availableHeight)));
    return { width, height, left: Math.min(Math.max(24, Number.isFinite(rect.left) ? rect.left : 24), Math.max(24, viewport.width - width - 24)),
        top: Math.min(Math.max(24, Number.isFinite(rect.top) ? rect.top : 24), Math.max(24, viewport.height - height - 24)) };
}
