import type { DesktopComicCanvasStartFrameResult, GetDesktopComicCanvasStartFramePlanRequest, DesktopComicCanvasStartFramePlan, RunDesktopComicCanvasNodeRequest,
    DesktopComicCanvasGenerationResult, NextMuxPlatformService } from '../common/nextmux-platform-protocol';

export interface ComicStartFrameFlowControl { cancelled: boolean; jobId?: string; preparationId?: string }
/** The same original click names both phases. A cancelled image never silently starts a video. */
export async function runComicStartFrameFlow(input: {
    service: Pick<NextMuxPlatformService, 'runComicCanvasStartFrame' | 'getComicCanvasStartFrame' | 'applyComicCanvasStartFrame' | 'confirmMediaJob' | 'cancelMediaJob' | 'runComicCanvasNode'>;
    request: GetDesktopComicCanvasStartFramePlanRequest; plan: DesktopComicCanvasStartFramePlan;
    imageClickKey: string; newVideoClickKey: string; regenerateImage?: boolean;
    control: ComicStartFrameFlowControl; adopt: (result: DesktopComicCanvasStartFrameResult) => void;
    videoRequest: Omit<RunDesktopComicCanvasNodeRequest, 'idempotencyKey' | 'expectedRevision'>;
    wait: () => Promise<void>;
}): Promise<DesktopComicCanvasGenerationResult | undefined> {
    const { service, request, control } = input;
    let prepared = await service.runComicCanvasStartFrame({ ...request, idempotencyKey: input.imageClickKey,
        planFingerprint: input.plan.fingerprint, acceptedTwoStepBilling: true, ...(input.regenerateImage ? { regenerate: true } : {}) });
    control.preparationId = prepared.preparationId; control.jobId = prepared.job?.id;
    input.adopt(prepared);
    if (control.cancelled) { if (prepared.job && !['succeeded', 'failed', 'cancelled'].includes(prepared.job.status)) await service.cancelMediaJob(request.workspaceRoot, prepared.job.id); return undefined; }
    if (prepared.job?.status === 'awaiting_confirmation') await service.confirmMediaJob(request.workspaceRoot, prepared.job.id);
    while (!prepared.version || prepared.job?.status !== 'succeeded') {
        if (control.cancelled) return undefined;
        if (!prepared.job) throw new Error('START_FRAME_RECORD_INVALID');
        if (prepared.job && ['failed', 'cancelled', 'paused', 'interrupted'].includes(prepared.job.status)) throw Object.assign(new Error('START_FRAME_IMAGE_INCOMPLETE'), prepared.job?.status === 'failed' && prepared.job.failure ? { startFrameImageFailure: prepared.job.failure } : {});
        await input.wait();
        if (control.cancelled) return undefined;
        prepared = await service.getComicCanvasStartFrame({ workspaceRoot: request.workspaceRoot, canvasId: request.canvasId, preparationId: prepared.preparationId,
            intentFingerprint: input.plan.videoIntentFingerprint ?? prepared.videoIntentFingerprint });
        control.jobId = prepared.job?.id; input.adopt(prepared);
    }
    if (control.cancelled) return undefined;
    const intentFingerprint = input.plan.videoIntentFingerprint ?? prepared.videoIntentFingerprint;
    if (!intentFingerprint) throw new Error('START_FRAME_RECORD_INVALID');
    // A cached image may now be used by a different, explicitly selected video
    // route. Read that exact intent's job and stable continuation key.
    prepared = await service.getComicCanvasStartFrame({ workspaceRoot: request.workspaceRoot, canvasId: request.canvasId,
        preparationId: prepared.preparationId, intentFingerprint });
    input.adopt(prepared);
    if (control.cancelled) return undefined;
    if (!prepared.version || prepared.job?.status !== 'succeeded') throw Object.assign(new Error('START_FRAME_IMAGE_INCOMPLETE'), prepared.job?.status === 'failed' && prepared.job.failure ? { startFrameImageFailure: prepared.job.failure } : {});
    if (!prepared.applied) {
        await service.applyComicCanvasStartFrame({ workspaceRoot: request.workspaceRoot, canvasId: request.canvasId,
            nodeId: request.nodeId, preparationId: prepared.preparationId, versionId: prepared.version.id,
            videoConnectionId: request.videoConnectionId, videoKeyPriceQuoteId: request.videoKeyPriceQuoteId, intentFingerprint });
        prepared = await service.getComicCanvasStartFrame({ workspaceRoot: request.workspaceRoot, canvasId: request.canvasId, preparationId: prepared.preparationId, intentFingerprint });
        input.adopt(prepared);
        if (!prepared.applied) throw new Error('START_FRAME_NOT_READY');
    }
    if (control.cancelled) return undefined;
    // A reply lost after dispatch resumes the same queued task, never a second paid call.
    if (prepared.videoJob && !['succeeded', 'failed', 'cancelled'].includes(prepared.videoJob.status)) return { state: prepared.state, job: prepared.videoJob };
    const idempotencyKey = prepared.videoJob ? input.newVideoClickKey : prepared.videoContinuationKey;
    if (!idempotencyKey || !prepared.state.canvas) throw new Error('START_FRAME_RECORD_INVALID');
    const result = await service.runComicCanvasNode({ ...input.videoRequest, expectedRevision: prepared.state.canvas.revision, idempotencyKey,
        startFrameContinuation: { preparationId: prepared.preparationId, intentFingerprint } });
    control.jobId = result.job?.id;
    if (control.cancelled) {
        if (result.job && !['succeeded', 'failed', 'cancelled'].includes(result.job.status)) await service.cancelMediaJob(request.workspaceRoot, result.job.id);
        return undefined;
    }
    return result;
}
