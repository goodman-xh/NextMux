import type { CanvasDocument } from '@nextmux/comic-core';

/** Count current canvas outputs, not stale legacy shots or unselected result history. */
export function summarizeComicCanvasVideos(canvases: readonly CanvasDocument[]): {
    readonly total: number; readonly ready: number; readonly durationSeconds: number;
    readonly hasReadyOutput: boolean; readonly updatedAt: string;
} {
    const videos = new Map<string, { ready: boolean; durationMs: number }>();
    let hasReadyOutput = false, updatedAt = '';
    for (const canvas of canvases) {
        if (canvas.updatedAt > updatedAt) updatedAt = canvas.updatedAt;
        for (const node of canvas.nodes) {
            const payload = node.payload;
            if (!('versions' in payload)) continue;
            const version = payload.versions.find(item => item.id === payload.currentVersionId);
            const ready = Boolean(version?.uri && version.status !== 'missing' && version.status !== 'uploading');
            hasReadyOutput ||= ready;
            if (version?.kind !== 'video' && !['video', 'videoGen', 'composition'].includes(node.kind)) continue;
            const isVideo = version?.kind === 'video';
            // The same output can be shared by several canvases. It is still one completed video.
            const key = isVideo ? `asset:${version.assetId}` : `node:${canvas.id}:${node.id}`;
            const itemReady = isVideo && ready;
            const durationMs = itemReady && Number.isFinite(version.metadata?.durationMs) ? Math.max(0, version.metadata?.durationMs ?? 0) : 0;
            const previous = videos.get(key);
            if (!previous || !previous.ready && itemReady) videos.set(key, { ready: itemReady, durationMs });
        }
    }
    const values = [...videos.values()];
    return { total: values.length, ready: values.filter(item => item.ready).length,
        durationSeconds: Math.round(values.reduce((sum, item) => sum + item.durationMs, 0) / 1000), hasReadyOutput, updatedAt };
}
