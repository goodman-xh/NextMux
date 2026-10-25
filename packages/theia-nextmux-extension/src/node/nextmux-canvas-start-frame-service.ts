import { createHash } from 'node:crypto';
import { sameCanvasCapabilityVersion, resolveCanvasInputs } from '@nextmux/comic-core';
import type { CanvasAssetVersion, CanvasDocument, CanvasModelCapability, GenerationSnapshot } from '@nextmux/comic-core';
import { enqueueRequest } from '@nextmux/media-core';
import type { EnqueueMediaJobRequest, MediaJob } from '@nextmux/media-core';
import type { ApplyDesktopComicCanvasStartFrameRequest, DesktopComicCanvasStartFramePlan, DesktopComicCanvasStartFrameResult,
    GetDesktopComicCanvasStartFramePlanRequest, RunDesktopComicCanvasStartFrameRequest, DesktopComicCanvasState } from '../common/nextmux-platform-protocol';
import type { CanvasAdapterPolicy } from '../common/nextmux-canvas-adapter-policy';
import { createCanvasStartFrameDraft, startFrameCanonical, startFrameTargetFingerprint, startFrameSourceFingerprint, startFrameVersion, startFrameImagePrompt, startFrameVideoIntentBase, startFrameCharacterLabels } from '../common/nextmux-canvas-start-frame';
import type { CanvasStartFrameDraft } from '../common/nextmux-canvas-start-frame';
import type { PublicPriceDetails } from '../common/nextmux-public-price-details';
import { compileCanvasGenerationJob } from './nextmux-canvas-generation';
import { CanvasServiceError } from './nextmux-canvas-store';

const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
const recordsKey = 'startFramePreparations';
export const canvasStartFrameSceneId = (canvasId: string): string => `scene-start-frame-${sha(canvasId).slice(0, 32)}`;
export const isCanvasStartFrameMediaJob = (job: { sceneId: string }): boolean => /^scene-start-frame-[a-f0-9]{32}$/u.test(job.sceneId);

export interface CanvasStartFrameRecord {
    readonly version: 1;
    readonly preparationId: string;
    readonly nodeId: string;
    readonly clickKey: string;
    readonly videoContinuationKey: string;
    readonly selectionFingerprint: string;
    readonly videoIntentBase: string;
    readonly videoPriceBeforeImage?: PublicPriceDetails;
    readonly fingerprint: string;
    readonly draft: CanvasStartFrameDraft;
    readonly selection: GetDesktopComicCanvasStartFramePlanRequest;
    readonly request: EnqueueMediaJobRequest;
    readonly execution: { readonly mediaApiStyle?: 'openai' | 'openrouter'; readonly nativeImageSizeContract?: 'seedream45_v1' };
    readonly jobId?: string;
    readonly result?: CanvasAssetVersion;
    readonly appliedVersionId?: string;
    readonly appliedTargetFingerprint?: string;
    readonly createdAt: string;
}
export function canvasStartFrameRecords(canvas: CanvasDocument): readonly CanvasStartFrameRecord[] {
    const value = canvas.settings[recordsKey];
    if (value === undefined) return [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CanvasServiceError('START_FRAME_RECORD_INVALID', 'The local start-frame preparation journal is invalid.');
    return Object.values(value as Record<string, CanvasStartFrameRecord>).map(record => {
        if (!record || record.version !== 1 || !/^start-frame-[a-f0-9]{32}$/u.test(record.preparationId) || !record.nodeId || !record.clickKey || !record.videoContinuationKey || typeof record.videoIntentBase !== 'string' || !record.videoIntentBase
            || !record.draft?.sourceVideo || record.draft.sourceVideo.kind !== 'video' || !Array.isArray(record.draft.characterLabels) || record.draft.characterLabels.length !== record.draft.characters?.length
            || !record.selection || !record.request
            || !isCanvasStartFrameMediaJob(record.request) || record.request.kind !== 'image' || record.request.projectId !== canvas.projectId || record.request.sceneId !== canvasStartFrameSceneId(canvas.id)) throw new CanvasServiceError('START_FRAME_RECORD_INVALID', 'The local preparation belongs to another canvas or has incomplete evidence.');
        enqueueRequest(record.request);
        return structuredClone(record);
    });
}
export function canvasStartFrameRecordForJob(canvas: CanvasDocument, job: EnqueueMediaJobRequest | MediaJob): CanvasStartFrameRecord | undefined {
    return canvasStartFrameRecords(canvas).find(record => record.request.idempotencyKey === job.idempotencyKey || record.jobId === (job as MediaJob).id);
}
export function canvasStartFrameVideoIntent(record: CanvasStartFrameRecord, base = record.videoIntentBase): string | undefined {
    return record.result ? sha(startFrameCanonical({ intent: base, frame: { id: record.result.id, assetId: record.result.assetId, uri: record.result.uri, metadata: record.result.metadata } })) : undefined;
}
function videoContinuationKey(record: CanvasStartFrameRecord, intent?: string): string {
    return !intent || intent === canvasStartFrameVideoIntent(record) ? record.videoContinuationKey
        : `start-frame-video-${sha(`${record.preparationId}\0${intent}`).slice(0, 48)}`;
}
export function canvasStartFramePricesChanged(before: PublicPriceDetails | undefined, after: PublicPriceDetails | undefined): boolean {
    if (before?.status !== 'complete' || after?.status !== 'complete') return false;
    const rate = (amount: number, units: number): string => {
        let a = BigInt(amount), b = BigInt(units), x = a, y = b;
        while (y) { const remainder = x % y; x = y; y = remainder; }
        return `${a / x}/${b / x}`;
    };
    const signature = (price: PublicPriceDetails): string => startFrameCanonical({ currency: price.currency, multiplierBps: price.multiplierBps,
        dimensions: [...price.dimensions].sort((a, b) => a.metric.localeCompare(b.metric)).map(dimension => ({ metric: dimension.metric,
            user: dimension.user ? rate(dimension.user.amountMicros, dimension.user.unitSize) : null })) });
    return signature(before) !== signature(after);
}
function withRecord(canvas: CanvasDocument, record: CanvasStartFrameRecord): CanvasDocument {
    return { ...canvas, settings: { ...canvas.settings, [recordsKey]: { ...(canvas.settings[recordsKey] as Record<string, CanvasStartFrameRecord> ?? {}), [record.preparationId]: structuredClone(record) } } };
}
function selectionFingerprint(request: GetDesktopComicCanvasStartFramePlanRequest): string {
    return startFrameCanonical({ nodeId: request.nodeId, imageRoute: { connectionId: request.imageRoute.connectionId, modelId: request.imageRoute.modelId, parameters: request.imageRoute.parameters,
        billing: request.imageRoute.cost.billing }, characterVersionIds: request.characterVersionIds ?? [], characterLibraryAssetIds: request.characterLibraryAssetIds ?? [] });
}
interface StartFrameStore {
    read(): Promise<DesktopComicCanvasState>;
    mutate(operation: (canvas: CanvasDocument) => CanvasDocument | Promise<CanvasDocument>): Promise<DesktopComicCanvasState>;
}
export interface CanvasStartFramePorts {
    capability(connectionId: string, modelId: string, kind: 'image' | 'video'): Promise<CanvasModelCapability>;
    adapter(connectionId: string, modelId: string, kind: 'image' | 'video'): Promise<CanvasAdapterPolicy>;
    size(projectId: string): Promise<{ width: number; height: number }>;
    validateFile(version: Pick<CanvasAssetVersion, 'uri' | 'metadata'>): Promise<void>;
    validateJob(request: EnqueueMediaJobRequest): Promise<void>;
    execution(request: EnqueueMediaJobRequest): Promise<CanvasStartFrameRecord['execution']>;
    enqueue(request: EnqueueMediaJobRequest, execution: CanvasStartFrameRecord['execution']): Promise<MediaJob>;
    getJob(id: string): Promise<MediaJob>;
    libraryVersions(assetIds: readonly string[], canvasId: string): Promise<readonly (CanvasAssetVersion & { readonly startFrameLabel?: string })[]>;
    sourceVideo(tail: CanvasAssetVersion, canvas: CanvasDocument): Promise<CanvasAssetVersion>;
    videoPrice?(connectionId: string, modelId: string): Promise<PublicPriceDetails | undefined>;
}

/** An image job is a local preparation, never an extra canvas node or a paid video submission. */
export class ComicCanvasStartFrameService {
    constructor(readonly store: StartFrameStore, readonly ports: CanvasStartFramePorts) {}
    private async canvas(): Promise<CanvasDocument> {
        const canvas = (await this.store.read()).canvas;
        if (!canvas) throw new CanvasServiceError('CANVAS_NOT_FOUND', 'Save the canvas before preparing a start frame.');
        return canvas;
    }
    private assertSelection(request: GetDesktopComicCanvasStartFramePlanRequest): void {
        if (!request?.nodeId || !request.imageRoute?.connectionId || !request.imageRoute.modelId || !request.videoConnectionId
            || !request.imageRoute.parameters || !request.imageRoute.cost || !request.videoCost
            || request.characterVersionIds !== undefined && !Array.isArray(request.characterVersionIds)
            || request.characterLibraryAssetIds !== undefined && !Array.isArray(request.characterLibraryAssetIds)) throw new CanvasServiceError('START_FRAME_SELECTION_REQUIRED', 'Select the image route, video route and portraits before preparing a start frame.');
        const ids = [...(request.characterVersionIds ?? []), ...(request.characterLibraryAssetIds ?? [])];
        if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !id.trim())) throw new CanvasServiceError('START_FRAME_REFERENCE_LIMIT', 'Select distinct portraits; the tail frame also consumes one reference.');
    }
    private async validateReferences(draft: CanvasStartFrameDraft): Promise<void> {
        for (const version of [draft.tailFrame, draft.sourceVideo, ...draft.characters]) await this.ports.validateFile(version);
    }
    private async validateSourceIdentity(canvas: CanvasDocument, record: CanvasStartFrameRecord): Promise<void> {
        const imported = await this.ports.libraryVersions(record.selection.characterLibraryAssetIds ?? [], canvas.id);
        const labels = Object.fromEntries(imported.map(version => [version.id, version.startFrameLabel ?? '']));
        const library = imported.map(({ startFrameLabel: _label, ...version }) => version);
        const predecessor = canvasStartFrameRecords(canvas).find(previous => previous.nodeId === record.nodeId && this.applied(canvas, previous));
        const retainedLabels: Record<string, string> = {};
        const portraits = [...(record.selection.characterVersionIds ?? []).map(id => {
            try { return startFrameVersion(canvas, id); }
            catch (error) {
                const retained = predecessor?.draft.characters.find(version => version.id === id);
                if (!retained || startFrameCanonical(retained) !== startFrameCanonical(record.draft.characters.find(version => version.id === id))) throw error;
                retainedLabels[id] = predecessor!.draft.characterLabels[predecessor!.draft.characters.findIndex(version => version.id === id)];
                return retained;
            }
        }), ...library];
        let tail = record.draft.tailFrame;
        try { tail = startFrameVersion(canvas, tail.id); } catch (error) { if (!predecessor) throw error; }
        const source = await this.ports.sourceVideo(tail, canvas);
        if (startFrameSourceFingerprint(canvas, tail, portraits, source) !== record.draft.sourceFingerprint) throw new CanvasServiceError('START_FRAME_REFERENCE_CHANGED', 'The previous video or selected portraits changed; the generated image is kept locally.');
        const currentLabels = startFrameCharacterLabels(canvas, portraits, { ...retainedLabels, ...labels });
        if (startFrameCanonical(currentLabels) !== startFrameCanonical(record.draft.characterLabels)) throw new CanvasServiceError('START_FRAME_REFERENCE_CHANGED', 'The selected character names changed; confirm a new preparation before using the previous image.');
    }
    private applied(canvas: CanvasDocument, record: CanvasStartFrameRecord): boolean {
        if (canvas.nodes.find(node => node.id === record.nodeId)?.kind !== 'videoGen') return false;
        return !!record.result && record.appliedVersionId === record.result.id
            && resolveCanvasInputs(canvas, record.nodeId).inputs.some(input => input.role === 'firstFrame' && input.versionId === record.result!.id && input.uri === record.result!.uri && input.metadata?.sha256 === record.result!.metadata?.sha256);
    }
    private reusable(canvas: CanvasDocument, request: GetDesktopComicCanvasStartFramePlanRequest): CanvasStartFrameRecord | undefined {
        const selection = selectionFingerprint(request);
        const node = canvas.nodes.find(item => item.id === request.nodeId);
        if (node?.kind !== 'videoGen') return undefined;
        const resolved = resolveCanvasInputs(canvas, request.nodeId);
        return [...canvasStartFrameRecords(canvas)].reverse().find(record => record.selectionFingerprint === selection
            && node.payload.parameters.aspectRatio === record.draft.videoSnapshot.parameters.aspectRatio
            && startFrameImagePrompt(record.draft.characterLabels, resolved.prompt) === record.draft.imageSnapshot.prompt
            && startFrameSourceFingerprint(canvas, record.draft.tailFrame, record.draft.characters, record.draft.sourceVideo) === record.draft.sourceFingerprint
            && (this.applied(canvas, record) || resolved.inputs.some(input => input.role === 'firstFrame' && input.versionId === record.draft.tailFrame.id)
                || !record.result && !!record.jobId && startFrameTargetFingerprint(canvas, request.nodeId) === record.draft.targetFingerprint
                    && canvasStartFrameRecords(canvas).some(previous => previous.preparationId !== record.preparationId && previous.nodeId === record.nodeId && this.applied(canvas, previous))));
    }
    private async reusableForRequest(canvas: CanvasDocument, request: GetDesktopComicCanvasStartFramePlanRequest): Promise<CanvasStartFrameRecord | undefined> {
        let candidates = canvas;
        for (;;) {
            const record = this.reusable(candidates, request);
            if (!record || record.result || !record.jobId) return record;
            const job = await this.ports.getJob(record.jobId);
            // A fresh, explicitly confirmed Generate may replace only an image cancelled before any worker dispatch.
            // Keep all accepted, unknown and interrupted tasks on their original identity; never rewrite their journal.
            if (job.status === 'cancelled' && job.attempt === 0 && !job.restoredHistoryOnly && !job.startedAt && !job.remoteTask && !job.checkpoint && !job.failure
                && job.id === record.jobId && job.projectId === record.request.projectId && job.kind === 'image'
                && job.sceneId === record.request.sceneId && job.shotId === record.request.shotId && job.idempotencyKey === record.request.idempotencyKey
                && startFrameCanonical(job.input) === startFrameCanonical(record.request.input)
                && job.events.length > 0 && job.events[0].type === 'created' && job.events.at(-1)?.type === 'cancelled'
                && job.events.every(event => ['created', 'confirmed', 'paused', 'resumed', 'cancelled'].includes(event.type))) {
                candidates = { ...candidates, settings: { ...candidates.settings, [recordsKey]: Object.fromEntries(Object.entries(
                    candidates.settings[recordsKey] as Record<string, CanvasStartFrameRecord>).filter(([, candidate]) => candidate.preparationId !== record.preparationId)) } };
                continue;
            }
            return record;
        }
    }
    private view(record: CanvasStartFrameRecord, canvas: CanvasDocument, request: GetDesktopComicCanvasStartFramePlanRequest): DesktopComicCanvasStartFramePlan {
        const node = canvas.nodes.find(item => item.id === request.nodeId);
        if (node?.kind !== 'videoGen') throw new CanvasServiceError('START_FRAME_VIDEO_REQUIRED', 'The selected video node is missing.');
        const intent = canvasStartFrameVideoIntent(record, startFrameVideoIntentBase(canvas, request.nodeId, request.videoConnectionId, record.draft.characters.map(version => version.id)));
        return { fingerprint: record.fingerprint, imagePrompt: record.draft.imageSnapshot.prompt, tailFrameVersionId: record.draft.tailFrame.id,
            characterVersionIds: record.draft.characters.map(version => version.id), imageParameters: record.draft.imageSnapshot.parameters,
            videoParameters: node.payload.parameters, videoModelId: node.payload.modelId, ...(intent ? { videoIntentFingerprint: intent } : {}),
            reusablePreparationId: record.preparationId, videoContinuationKey: videoContinuationKey(record, intent), ...(record.result ? { readyVersion: structuredClone(record.result) } : {}) };
    }
    private async prepared(canvas: CanvasDocument, request: GetDesktopComicCanvasStartFramePlanRequest): Promise<{ draft: CanvasStartFrameDraft; imageJob: EnqueueMediaJobRequest; fingerprint: string; videoPrice?: PublicPriceDetails }> {
        this.assertSelection(request);
        const node = canvas.nodes.find(item => item.id === request.nodeId);
        if (node?.kind !== 'videoGen') throw new CanvasServiceError('START_FRAME_VIDEO_REQUIRED', 'Select a video generation node.');
        const [imageCapability, videoCapability, imageAdapter, videoAdapter, size] = await Promise.all([
            this.ports.capability(request.imageRoute.connectionId, request.imageRoute.modelId, 'image'),
            this.ports.capability(request.videoConnectionId, node.payload.modelId, 'video'),
            this.ports.adapter(request.imageRoute.connectionId, request.imageRoute.modelId, 'image'),
            this.ports.adapter(request.videoConnectionId, node.payload.modelId, 'video'), this.ports.size(canvas.projectId)
        ]);
        const imported = await this.ports.libraryVersions(request.characterLibraryAssetIds ?? [], canvas.id);
        const labels = Object.fromEntries(imported.map(version => [version.id, version.startFrameLabel ?? '']));
        const library = imported.map(({ startFrameLabel: _label, ...version }) => version);
        const applied = [...canvasStartFrameRecords(canvas)].reverse().find(record => record.nodeId === request.nodeId && this.applied(canvas, record));
        let inputCanvas = canvas, trustedCharacters = library;
        if (applied) {
            if (startFrameSourceFingerprint(canvas, applied.draft.tailFrame, applied.draft.characters, await this.ports.sourceVideo(applied.draft.tailFrame, canvas)) !== applied.draft.sourceFingerprint) throw new CanvasServiceError('START_FRAME_REFERENCE_CHANGED', 'The source video changed. Extract its current tail frame before redoing the image.');
            inputCanvas = { ...canvas, nodes: canvas.nodes.map(item => item.id !== node.id || item.kind !== 'videoGen' ? item : { ...item,
                payload: { ...item.payload, inputs: [...(item.payload.inputs ?? []).filter(input => input.role !== 'firstFrame'),
                    { id: 'start-frame-original-tail', role: 'firstFrame' as const, order: 0, version: applied.draft.tailFrame }] } }),
                edges: canvas.edges.filter(edge => !(edge.targetNodeId === node.id && edge.role === 'firstFrame')) };
            trustedCharacters = [...library, ...applied.draft.characters];
        }
        const tailInput = resolveCanvasInputs(inputCanvas, request.nodeId).inputs.find(input => input.role === 'firstFrame' && input.kind === 'image');
        if (!tailInput) throw new CanvasServiceError('START_FRAME_TAIL_REQUIRED', 'Extract the last frame of the previous video first.');
        const tail = startFrameVersion(inputCanvas, tailInput.versionId), sourceVideo = await this.ports.sourceVideo(tail, inputCanvas);
        const inputDraft = createCanvasStartFrameDraft({ canvas: inputCanvas, nodeId: request.nodeId, characterVersionIds: [...(request.characterVersionIds ?? []), ...library.map(version => version.id)],
            characterVersions: trustedCharacters, characterLabels: { ...Object.fromEntries((applied?.draft.characters ?? []).filter(version => !canvas.nodes.some(item => (item.kind === 'character' || item.origin?.role === 'portrait')
                && 'versions' in item.payload && item.payload.versions.some(candidate => candidate.id === version.id))).map(version => [version.id, applied!.draft.characterLabels[applied!.draft.characters.findIndex(candidate => candidate.id === version.id)]])), ...labels },
            sourceVideo, imageCapability, videoCapability, imageParameters: request.imageRoute.parameters });
        const draft = { ...inputDraft, targetFingerprint: startFrameTargetFingerprint(canvas, request.nodeId) };
        await this.validateReferences(draft);
        const imageJob = enqueueRequest(compileCanvasGenerationJob({ canvasId: canvas.id, projectId: canvas.projectId, nodeId: request.nodeId,
            idempotencyKey: 'start-frame-preflight-image', snapshot: draft.imageSnapshot, capability: imageCapability, adapterPolicy: imageAdapter, canvasSize: size,
            connectionId: request.imageRoute.connectionId, keyPriceQuoteId: request.imageRoute.keyPriceQuoteId, cost: request.imageRoute.cost }));
        const imageInput = imageJob.input as { width: number; height: number };
        const videoSnapshot: GenerationSnapshot = { ...draft.videoSnapshot, resolvedInputs: draft.videoSnapshot.resolvedInputs.map(input => input.role === 'firstFrame'
            ? { ...input, metadata: { ...input.metadata, width: imageInput.width, height: imageInput.height } } : input) };
        const videoJob = enqueueRequest(compileCanvasGenerationJob({ canvasId: canvas.id, projectId: canvas.projectId, nodeId: request.nodeId,
            idempotencyKey: 'start-frame-preflight-video', snapshot: videoSnapshot, capability: videoCapability, adapterPolicy: videoAdapter, canvasSize: size,
            connectionId: request.videoConnectionId, keyPriceQuoteId: videoAdapter.adapter === 'managed' ? videoAdapter.videoShapeQuoteId : request.videoKeyPriceQuoteId, cost: request.videoCost }));
        // Both adapters, pricing/billing kinds and existing remaining references must be valid before an image job can be persisted.
        await this.ports.validateJob(imageJob); await this.ports.validateJob(videoJob);
        for (const input of videoSnapshot.resolvedInputs.filter(input => ['image', 'video', 'audio'].includes(input.kind) && input.role !== 'firstFrame')) await this.ports.validateFile(input);
        return { draft: { ...draft, videoSnapshot }, imageJob, videoPrice: await this.ports.videoPrice?.(request.videoConnectionId, node.payload.modelId), fingerprint: sha(startFrameCanonical({ canvasId: canvas.id, projectId: canvas.projectId, draft,
            selection: selectionFingerprint(request), imageQuote: request.imageRoute.keyPriceQuoteId, videoQuote: request.videoKeyPriceQuoteId, videoBilling: request.videoCost.billing })) };
    }
    async plan(request: GetDesktopComicCanvasStartFramePlanRequest): Promise<DesktopComicCanvasStartFramePlan> {
        this.assertSelection(request);
        const canvas = await this.canvas(), reuse = await this.reusableForRequest(canvas, request);
        if (reuse && !request.regenerate) {
            if (reuse.result) {
                await this.validateReferences(reuse.draft); await this.validateSourceIdentity(canvas, reuse);
                await this.ports.validateFile(reuse.result);
            }
            return this.view(reuse, canvas, request);
        }
        const prepared = await this.prepared(canvas, request);
        if (reuse && reuse.fingerprint === prepared.fingerprint) return this.view(reuse, canvas, request);
        return { fingerprint: prepared.fingerprint, imagePrompt: prepared.draft.imageSnapshot.prompt, tailFrameVersionId: prepared.draft.tailFrame.id,
            characterVersionIds: prepared.draft.characters.map(version => version.id), imageParameters: prepared.draft.imageSnapshot.parameters, videoParameters: prepared.draft.videoSnapshot.parameters, videoModelId: prepared.draft.videoSnapshot.modelId };
    }
    async run(request: RunDesktopComicCanvasStartFrameRequest): Promise<DesktopComicCanvasStartFrameResult> {
        this.assertSelection(request);
        if (request.acceptedTwoStepBilling !== true) throw new CanvasServiceError('COST_CONFIRMATION_REQUIRED', 'Accept the additional image call and video call before starting.');
        if (typeof request.idempotencyKey !== 'string' || !request.idempotencyKey.trim() || request.idempotencyKey.length > 100) throw new CanvasServiceError('CANVAS_CLICK_KEY_REQUIRED', 'A stable click key is required.');
        const canvas = await this.canvas();
        let record = canvasStartFrameRecords(canvas).find(item => item.clickKey === request.idempotencyKey);
        if (record && (record.nodeId !== request.nodeId || record.fingerprint !== request.planFingerprint)) throw new CanvasServiceError('REQUEST_ID_CONFLICT', 'This click belongs to another preparation.');
        if (!record && !request.regenerate) {
            const reuse = await this.reusableForRequest(canvas, request);
            if (reuse) {
                if (reuse.fingerprint !== request.planFingerprint) throw new CanvasServiceError('START_FRAME_PLAN_CHANGED', 'Refresh the two-step plan before generating.');
                if (reuse.result) {
                    await this.validateReferences(reuse.draft); await this.validateSourceIdentity(canvas, reuse);
                    await this.ports.validateFile(reuse.result);
                    return this.get(reuse.preparationId, this.view(reuse, canvas, request).videoIntentFingerprint);
                }
                record = reuse;
            }
        }
        if (!record) {
            for (const previous of canvasStartFrameRecords(canvas).filter(item => item.nodeId === request.nodeId)) {
                if (!previous.jobId) throw new CanvasServiceError('START_FRAME_RECOVERY_REQUIRED', 'Resume the existing preparation before creating another image task.');
                const previousJob = await this.ports.getJob(previous.jobId);
                if (!['succeeded', 'failed', 'cancelled'].includes(previousJob.status)) throw new CanvasServiceError('START_FRAME_BUSY', 'Finish or stop the existing image preparation before explicitly redoing it.');
            }
            const prepared = await this.prepared(canvas, request);
            if (prepared.fingerprint !== request.planFingerprint) throw new CanvasServiceError('START_FRAME_PLAN_CHANGED', 'The sources, options or selected routes changed after the two-step notice.');
            const preparationId = `start-frame-${sha(`${canvas.id}\0${request.idempotencyKey}`).slice(0, 32)}`;
            const queueRequest = enqueueRequest({ ...prepared.imageJob, idempotencyKey: `start-frame:${sha(`${canvas.id}\0${request.idempotencyKey}`)}`,
                sceneId: canvasStartFrameSceneId(canvas.id), shotId: `shot-start-frame-${sha(request.nodeId).slice(0, 32)}` });
            const execution = await this.ports.execution(queueRequest);
            const candidate: CanvasStartFrameRecord = { version: 1, preparationId, nodeId: request.nodeId, clickKey: request.idempotencyKey,
                videoContinuationKey: `start-frame-video-${sha(`${canvas.id}\0${request.idempotencyKey}`).slice(0, 48)}`,
                videoIntentBase: startFrameVideoIntentBase(canvas, request.nodeId, request.videoConnectionId, prepared.draft.characters.map(version => version.id)),
                ...(prepared.videoPrice ? { videoPriceBeforeImage: prepared.videoPrice } : {}),
                selectionFingerprint: selectionFingerprint(request), fingerprint: prepared.fingerprint, draft: prepared.draft, selection: structuredClone(request), request: queueRequest, execution, createdAt: new Date().toISOString() };
            await this.store.mutate(current => {
                const existing = canvasStartFrameRecords(current).find(item => item.preparationId === preparationId);
                if (existing) { if (existing.fingerprint !== candidate.fingerprint) throw new CanvasServiceError('REQUEST_ID_CONFLICT', 'This click belongs to another preparation.'); record = existing; return current; }
                if (startFrameTargetFingerprint(current, request.nodeId) !== candidate.draft.targetFingerprint) throw new CanvasServiceError('START_FRAME_PLAN_CHANGED', 'The target changed before the preparation was reserved.');
                record = candidate; return withRecord(current, candidate);
            });
        }
        // Enqueue is already idempotent. A crash after queue-write/reply loss reuses the original frozen request, never recompiles it.
        const job = record!.jobId ? await this.ports.getJob(record!.jobId) : await this.ports.enqueue(record!.request, record!.execution);
        const state = await this.store.mutate(current => {
            const latest = canvasStartFrameRecords(current).find(item => item.preparationId === record!.preparationId);
            if (!latest || latest.fingerprint !== record!.fingerprint) throw new CanvasServiceError('START_FRAME_RECORD_INVALID', 'The original preparation is missing.');
            return withRecord(current, { ...latest, jobId: job.id });
        });
        const latest = state.canvas && canvasStartFrameRecords(state.canvas).find(item => item.preparationId === record!.preparationId);
        return { state, preparationId: record!.preparationId, job, videoContinuationKey: record!.videoContinuationKey,
            ...(latest?.result ? { version: latest.result, videoIntentFingerprint: canvasStartFrameVideoIntent(latest) } : {}), applied: !!state.canvas && !!latest && this.applied(state.canvas, latest) };
    }
    async get(preparationId: string, intentFingerprint?: string): Promise<DesktopComicCanvasStartFrameResult> {
        const state = await this.store.read(), record = state.canvas && canvasStartFrameRecords(state.canvas).find(item => item.preparationId === preparationId);
        if (!record) throw new CanvasServiceError('START_FRAME_NOT_FOUND', 'The local preparation is missing.');
        const intent = intentFingerprint ?? canvasStartFrameVideoIntent(record);
        const videoId = [...state.jobs].reverse().find(job => job.nodeId === record.nodeId && (job.startFrameContinuation?.preparationId === record.preparationId
            && job.startFrameContinuation.intentFingerprint === intent || !job.startFrameContinuation && job.idempotencyKey === record.videoContinuationKey && intent === canvasStartFrameVideoIntent(record)))?.jobId;
        return { state, preparationId, videoContinuationKey: videoContinuationKey(record, intent),
            ...(record.jobId ? { job: await this.ports.getJob(record.jobId) } : {}), ...(videoId ? { videoJob: await this.ports.getJob(videoId) } : {}),
            ...(record.result ? { version: record.result, videoIntentFingerprint: intent } : {}), applied: this.applied(state.canvas!, record) };
    }
    async validateJob(job: EnqueueMediaJobRequest | MediaJob, accepted: boolean): Promise<void> {
        const canvas = await this.canvas(), record = canvasStartFrameRecordForJob(canvas, job);
        if (!record || record.request.projectId !== job.projectId || record.request.sceneId !== job.sceneId || record.request.shotId !== job.shotId
            || startFrameCanonical(record.request.input) !== startFrameCanonical(job.input)) throw new CanvasServiceError('START_FRAME_RECORD_INVALID', 'The queued image does not match its original preparation.');
        // Accepted tasks may poll/recover their original ID even when the user edits the next video. No new input is dispatched here.
        if (accepted) return;
        await this.validateSourceIdentity(canvas, record);
        if (this.reusable(canvas, record.selection)?.preparationId !== record.preparationId) throw new CanvasServiceError('START_FRAME_PLAN_CHANGED', 'The image sources, prompt or output aspect changed before dispatch.');
        const capability = await this.ports.capability(record.selection.imageRoute.connectionId, record.draft.imageSnapshot.modelId, 'image');
        if (!sameCanvasCapabilityVersion(capability.version, record.draft.imageSnapshot.capabilityVersion)) throw new CanvasServiceError('CANVAS_CAPABILITY_CHANGED', 'The image route changed before dispatch.');
        await this.validateReferences(record.draft); await this.ports.validateJob(record.request);
    }
    async validateVideoIntent(canvas: CanvasDocument, record: CanvasStartFrameRecord, connectionId: string, intentFingerprint: string): Promise<void> {
        if (!this.applied(canvas, record) || !record.result
            || canvasStartFrameVideoIntent(record, startFrameVideoIntentBase(canvas, record.nodeId, connectionId, record.draft.characters.map(version => version.id))) !== intentFingerprint)
            throw new CanvasServiceError('START_FRAME_PLAN_CHANGED', 'The prepared frame, reviewed video route or video options changed.');
        await this.validateReferences(record.draft);
        await this.validateSourceIdentity(canvas, record); await this.ports.validateFile(record.result);
    }
    /** Retains the paid local output even if its target was edited or removed meanwhile. */
    async attach(job: MediaJob, version: CanvasAssetVersion): Promise<void> {
        if (version.kind !== 'image' || version.provenance?.jobId !== job.id || !version.metadata?.sha256) throw new CanvasServiceError('START_FRAME_OUTPUT_INVALID', 'A verified local image output is required.');
        await this.ports.validateFile(version);
        await this.store.mutate(canvas => {
            const record = canvasStartFrameRecordForJob(canvas, job);
            if (!record || startFrameCanonical(record.request.input) !== startFrameCanonical(job.input)) throw new CanvasServiceError('START_FRAME_RECORD_INVALID', 'The output belongs to another preparation.');
            if (record.result && startFrameCanonical(record.result) !== startFrameCanonical(version)) throw new CanvasServiceError('START_FRAME_OUTPUT_INVALID', 'An existing preparation result cannot be replaced.');
            return withRecord(canvas, { ...record, jobId: job.id, result: version });
        });
    }
    async apply(request: ApplyDesktopComicCanvasStartFrameRequest): Promise<DesktopComicCanvasState> {
        return this.store.mutate(async canvas => {
            const record = canvasStartFrameRecords(canvas).find(item => item.preparationId === request.preparationId);
            if (!record || record.nodeId !== request.nodeId || !record.result || record.result.id !== request.versionId) throw new CanvasServiceError('START_FRAME_OUTPUT_INVALID', 'Choose the completed image from this exact preparation.');
            if (!record.jobId || (await this.ports.getJob(record.jobId)).status !== 'succeeded') throw new CanvasServiceError('START_FRAME_NOT_READY', 'Wait for the image task to finish successfully before continuing to video.');
            await this.ports.validateFile(record.result);
            if (this.applied(canvas, record)) return canvas;
            await this.validateReferences(record.draft);
            const videoConnection = request.videoConnectionId ?? record.selection.videoConnectionId;
            const currentIntent = canvasStartFrameVideoIntent(record, startFrameVideoIntentBase(canvas, record.nodeId, videoConnection, record.draft.characters.map(version => version.id)));
            if (request.intentFingerprint ? currentIntent !== request.intentFingerprint : startFrameTargetFingerprint(canvas, record.nodeId) !== record.draft.targetFingerprint)
                throw new CanvasServiceError('START_FRAME_PLAN_CHANGED', 'The reviewed video inputs changed; the image is kept locally but was not applied.');
            await this.validateSourceIdentity(canvas, record);
            const currentNode = canvas.nodes.find(node => node.id === record.nodeId)!;
            if (currentNode.kind !== 'videoGen' || currentNode.payload.mode !== 'imageToVideo') throw new CanvasServiceError('START_FRAME_VIDEO_REQUIRED', 'Choose image-to-video for the prepared frame.');
            const videoCapability = await this.ports.capability(videoConnection, currentNode.payload.modelId, 'video');
            const videoAdapter = await this.ports.adapter(videoConnection, currentNode.payload.modelId, 'video');
            const currentQuote = videoAdapter.adapter === 'managed' ? videoAdapter.videoShapeQuoteId : request.videoKeyPriceQuoteId ?? record.selection.videoKeyPriceQuoteId;
            const videoPreview = enqueueRequest(compileCanvasGenerationJob({ canvasId: canvas.id, projectId: canvas.projectId, nodeId: record.nodeId,
                idempotencyKey: 'start-frame-actual-output-preflight', capability: videoCapability, adapterPolicy: videoAdapter,
                canvasSize: await this.ports.size(canvas.projectId), connectionId: videoConnection, keyPriceQuoteId: currentQuote,
                cost: { ...record.selection.videoCost, billing: videoConnection === 'comfyui:local' ? 'free' : videoConnection.startsWith('managed:') ? 'platform_billed' : 'provider_billed' },
                snapshot: { ...record.draft.videoSnapshot, modelId: currentNode.payload.modelId, prompt: resolveCanvasInputs(canvas, record.nodeId).prompt,
                    parameters: currentNode.payload.parameters, capabilityVersion: videoCapability.version,
                    resolvedInputs: resolveCanvasInputs(canvas, record.nodeId).inputs.filter(input => !(input.kind === 'image' && record.draft.characters.some(version => version.id === input.versionId) && input.role !== 'firstFrame'))
                        .map(input => input.role === 'firstFrame' ? { ...input, versionId: record.result!.id, assetId: record.result!.assetId, uri: record.result!.uri, metadata: record.result!.metadata } : input) } }));
            await this.ports.validateJob(videoPreview);
            const portraits = new Set(record.draft.characters.map(version => version.id));
            // Portraits were explicitly composed into the image; retain their complete originals in the preparation, rather than sending unsupported extra video references.
            const removeEdge = new Set(resolveCanvasInputs(canvas, record.nodeId).inputs.filter(input => input.role === 'firstFrame' || input.kind === 'image' && portraits.has(input.versionId)).map(input => input.edgeId).filter(Boolean));
            const nodes = canvas.nodes.map(node => {
                if (node.id !== record.nodeId || node.kind !== 'videoGen') return node;
                const { continuity: _oldTailContinuity, ...payload } = node.payload;
                return { ...node, payload: { ...payload,
                inputs: [...(node.payload.inputs ?? []).filter(input => input.role !== 'firstFrame' && !(input.version.kind === 'image' && portraits.has(input.version.id))),
                    { id: `input-${record.preparationId}`, role: 'firstFrame' as const, order: 0, version: structuredClone(record.result!) }] } };
            });
            const applied = { ...canvas, nodes, edges: canvas.edges.filter(edge => !removeEdge.has(edge.id)) };
            return withRecord(applied, { ...record, appliedVersionId: record.result.id, appliedTargetFingerprint: startFrameTargetFingerprint(applied, record.nodeId) });
        });
    }
}
