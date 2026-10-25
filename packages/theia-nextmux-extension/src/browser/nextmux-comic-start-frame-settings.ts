import type { CanvasDocument } from '@nextmux/comic-core/canvas';
import type { EnqueueMediaJobRequest, MediaJob } from '@nextmux/media-core';
import { browserSha256 } from '@nextmux/comic-core/canvas-capabilities';
import { startFrameCanonical } from '../common/nextmux-canvas-start-frame';

export interface ComicStartFrameSettings {
    readonly enabled: boolean;
    readonly imageRouteKey: string;
    readonly imageModelId: string;
    readonly imageParameters: Readonly<Record<string, unknown>>;
    readonly characterVersionIds: readonly string[];
    readonly characterLibraryAssetIds: readonly string[];
}

/** A durable preparation can outlive its renderer flow; only its exact owned queue task is cancellable. */
export function comicPendingStartFrameJob(canvas: CanvasDocument, nodeId: string, jobs: readonly MediaJob[]): MediaJob | undefined {
    if (canvas.nodes.find(node => node.id === nodeId)?.kind !== 'videoGen') return undefined;
    const journal = canvas.settings.startFramePreparations;
    if (!journal || typeof journal !== 'object' || Array.isArray(journal)) return undefined;
    for (const value of Object.values(journal).reverse()) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const record = value as { version?: number; preparationId?: string; nodeId?: string; jobId?: string;
            selection?: { nodeId?: string; canvasId?: string }; request?: EnqueueMediaJobRequest };
        const request = record.request;
        if (record.version !== 1 || typeof record.preparationId !== 'string' || !/^start-frame-[a-f0-9]{32}$/u.test(record.preparationId)
            || record.nodeId !== nodeId || record.selection?.nodeId !== nodeId
            || record.selection.canvasId !== undefined && record.selection.canvasId !== canvas.id
            || !record.jobId || request?.kind !== 'image' || request.projectId !== canvas.projectId
            || request.sceneId !== `scene-start-frame-${browserSha256(canvas.id).slice(0, 32)}`
            || request.shotId !== `shot-start-frame-${browserSha256(nodeId).slice(0, 32)}`) continue;
        const job = jobs.find(item => item.id === record.jobId);
        if (!job || job.restoredHistoryOnly || job.cancelRequestedAt || job.checkpoint || job.kind !== 'image' || job.projectId !== canvas.projectId
            || job.sceneId !== request.sceneId || job.shotId !== request.shotId || job.idempotencyKey !== request.idempotencyKey
            || !['awaiting_confirmation', 'queued', 'running', 'paused'].includes(job.status)) continue;
        if (startFrameCanonical(job.input) !== startFrameCanonical(request.input)) continue;
        return job;
    }
    return undefined;
}

const settingsKey = 'nodeCharacterStartFrames';
const identifiers = (value: unknown): string[] => Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 300))] : [];
export function comicStartFrameSettings(canvas: CanvasDocument, nodeId: string): ComicStartFrameSettings | undefined {
    const all = canvas.settings[settingsKey] as Record<string, unknown> | undefined;
    const value = all?.[nodeId] as Partial<ComicStartFrameSettings> | undefined;
    if (!value || typeof value !== 'object' || typeof value.imageRouteKey !== 'string' || typeof value.imageModelId !== 'string') return undefined;
    return { enabled: value.enabled === true, imageRouteKey: value.imageRouteKey, imageModelId: value.imageModelId,
        imageParameters: value.imageParameters && typeof value.imageParameters === 'object' && !Array.isArray(value.imageParameters) ? value.imageParameters : {},
        characterVersionIds: identifiers(value.characterVersionIds), characterLibraryAssetIds: identifiers(value.characterLibraryAssetIds) };
}
export function setComicStartFrameSettings(canvas: CanvasDocument, nodeId: string, value: ComicStartFrameSettings): CanvasDocument {
    return { ...canvas, settings: { ...canvas.settings, [settingsKey]: { ...(canvas.settings[settingsKey] as Record<string, unknown> | undefined), [nodeId]: value } } };
}
