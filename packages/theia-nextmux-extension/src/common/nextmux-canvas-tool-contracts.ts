import type { CanvasAssetVersion } from '@nextmux/comic-core';
import type { CanvasLocalToolRequest, CanvasToolProgress, CanvasLocalToolResult } from '../node/nextmux-canvas-tools';

export type { CanvasLocalToolRequest, CanvasToolProgress, CanvasLocalToolResult };
export type { RunComicCanvasToolRequest, ComicCanvasToolJob, CanvasToolStore } from '../node/nextmux-canvas-tools-service';
export * from './nextmux-canvas-local-image-tools';
/** These operations run locally and need no provider connection or model capability route. */
export type CanvasOnDeviceToolOperation = 'image.matting' | 'image.depth' | 'video.depth';
/** These names describe capabilities, independent of provider or sales channel. */
export type CanvasModelToolOperation = 'image.upscale' | 'video.upscale' | 'video.removeSubtitles' | 'video.lipSync'
    | 'image.matting' | 'video.matting' | 'image.relight' | 'image.outpaint' | 'image.styleTransfer'
    | 'image.depth' | 'video.depth' | 'audio.separateVoice' | 'audio.separateBackground';
export interface CanvasModelToolRequest {
    /** The same stable key must be reused for this click and any recovery. */
    readonly idempotencyKey: string;
    readonly canvasId: string;
    readonly nodeId: string;
    readonly operation: CanvasModelToolOperation;
    readonly source: CanvasAssetVersion;
    readonly references?: readonly { readonly role: 'identity' | 'style' | 'audio' | 'mask'; readonly version: CanvasAssetVersion }[];
    readonly prompt?: string;
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly route: {
        readonly connectionId: string;
        readonly modelId: string;
        readonly capabilityVersion: string;
        /** Must contain the selected operation with supported status. Unknown is not support. */
        readonly verifiedOperations: readonly CanvasModelToolOperation[];
    };
}
export interface CanvasModelToolTask {
    readonly idempotencyKey: string;
    readonly jobId: string;
    readonly taskId?: string;
    readonly status: string;
}
/** A future adapter must use the existing persisted media-job pipeline; never directly call a provider. */
export interface CanvasModelToolPipeline {
    submit(request: CanvasModelToolRequest): Promise<CanvasModelToolTask>;
    recover(jobId: string): Promise<CanvasModelToolTask>;
    cancel(jobId: string): Promise<CanvasModelToolTask>;
}
export const CANVAS_MODEL_TOOL_OPERATIONS: readonly CanvasModelToolOperation[] = Object.freeze([
    'image.upscale', 'video.upscale', 'video.removeSubtitles', 'video.lipSync', 'image.matting', 'video.matting',
    'image.relight', 'image.outpaint', 'image.styleTransfer', 'image.depth', 'video.depth', 'audio.separateVoice', 'audio.separateBackground'
]);
/** Validate and freeze a contract, without enqueueing or charging anything. */
export function prepareCanvasModelToolRequest(request: CanvasModelToolRequest): CanvasModelToolRequest {
    if (!request || !request.idempotencyKey?.trim() || !request.canvasId?.trim() || !request.nodeId?.trim()
        || !CANVAS_MODEL_TOOL_OPERATIONS.includes(request.operation) || !request.route?.connectionId?.trim()
        || !request.route.modelId?.trim() || !request.route.capabilityVersion?.trim()
        || !request.route.verifiedOperations?.includes(request.operation)) throw new Error('A stable click key and verified model capability route are required');
    const sourceKind = request.operation.startsWith('image.') ? 'image' : request.operation.startsWith('video.') ? 'video' : undefined;
    if (!request.source?.id || !request.source.assetId || !request.source.uri || request.source.status === 'missing' || request.source.status === 'uploading'
        || sourceKind && request.source.kind !== sourceKind || !sourceKind && !['audio', 'video'].includes(request.source.kind)) throw new Error('A ready source version matching the tool is required');
    if (!request.parameters || typeof request.parameters !== 'object' || Array.isArray(request.parameters)) throw new Error('Tool parameters must be an object');
    if (request.references?.some(reference => !['identity', 'style', 'audio', 'mask'].includes(reference.role) || !reference.version?.id
        || !reference.version.uri || reference.version.status === 'missing' || reference.version.status === 'uploading'
        || reference.version.kind !== (reference.role === 'audio' ? 'audio' : 'image'))) throw new Error('Tool references must be ready versions with explicit roles');
    const frozen = JSON.parse(JSON.stringify(request)) as CanvasModelToolRequest;
    const freeze = (value: unknown): void => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
    freeze(frozen); return frozen;
}
