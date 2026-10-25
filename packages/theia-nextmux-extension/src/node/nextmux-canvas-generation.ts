import { createHash } from 'node:crypto';
import { sameCanvasCapabilityVersion, compileCanvasGenerationRequest, resolveCanvasCapability, resolveCanvasDerivedAspectRatio, validateCanvasGenerationParameters } from '@nextmux/comic-core';
import type { CanvasModelCapability, GenerationSnapshot } from '@nextmux/comic-core';
import type { EnqueueMediaJobRequest, MediaImageJobInput, MediaVideoJobInput } from '@nextmux/media-core';
import { CanvasServiceError } from './nextmux-canvas-store';
import { canvasAdapterInputIssues, type CanvasAdapterPolicy } from '../common/nextmux-canvas-adapter-policy';
import { OPENROUTER_VIDEO_RESOLUTION_HEIGHT } from './nextmux-openrouter-video-limits';
import { videoModelGuide } from '../common/nextmux-video-model-guide';

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
export const canvasMediaSceneId = (canvasId: string): string => `scene-canvas-${digest(canvasId).slice(0, 32)}`;
export const canvasMediaShotId = (nodeId: string): string => `shot-canvas-${digest(nodeId).slice(0, 32)}`;
export const canvasMediaClickKey = (canvasId: string, key: string): string => `canvas:${digest(`${canvasId}\0${key}`)}`;
export const isCanvasMediaJob = (job: { sceneId: string }): boolean => /^scene-canvas-[a-f0-9]{32}$/u.test(job.sceneId);

/** Pure mapping; no route submission or mutable node lookup is performed here. */
export function compileCanvasGenerationJob(options: {
    canvasId: string; projectId: string; nodeId: string; idempotencyKey: string;
    snapshot: GenerationSnapshot; capability: CanvasModelCapability; connectionId: string;
    adapterPolicy?: CanvasAdapterPolicy; canvasSize?: { readonly width: number; readonly height: number };
    keyPriceQuoteId?: string; cost: EnqueueMediaJobRequest['cost'];
    /** Translation/preflight checks keep authored text; the final request adds defaults once. */
    includeContinuityDefaults?: boolean;
}): EnqueueMediaJobRequest {
    const { snapshot, capability } = options;
    compileCanvasGenerationRequest(snapshot);
    if (!sameCanvasCapabilityVersion(snapshot.capabilityVersion, capability.version) || snapshot.modelId !== capability.providerModelId) throw new CanvasServiceError('CANVAS_CAPABILITY_CHANGED', 'The snapshot belongs to a different model or capability version.');
    const issues = validateCanvasGenerationParameters(capability, snapshot.mode, snapshot.parameters, snapshot.resolvedInputs);
    if (issues.length) throw new CanvasServiceError('CANVAS_CAPABILITY_INVALID', issues.map(issue => issue.message).join('; '));
    if (options.adapterPolicy?.adapter === 'managed' && options.adapterPolicy.kind === 'video'
        && (!options.adapterPolicy.videoShapeQuoteId || options.keyPriceQuoteId !== options.adapterPolicy.videoShapeQuoteId)) {
        throw new CanvasServiceError('CANVAS_PRICE_QUOTE_CHANGED', 'The frozen price quote does not match the public video shape proof. Refresh the selected route before generating.');
    }
    const parameters = snapshot.parameters;
    const mapped = new Set(['resolution', 'aspectRatio', 'durationSeconds', 'generateAudio', 'preserveInputAudio', 'negativePrompt', 'width', 'height', 'requestSubtitles', 'quality']);
    const unmapped = Object.keys(parameters).filter(key => !mapped.has(key));
    if (unmapped.length) throw new CanvasServiceError('CANVAS_PARAMETER_UNMAPPED', `The current media adapter cannot transmit: ${unmapped.join(', ')}.`);
    const resolution = typeof parameters.resolution === 'string' ? parameters.resolution : undefined;
    const aspectRatio = typeof parameters.aspectRatio === 'string' ? parameters.aspectRatio : undefined;
    const resolved = resolveCanvasCapability(capability, { mode: snapshot.mode, resolution });
    const image = snapshot.mode === 'textToImage' || snapshot.mode === 'imageToImage';
    let measuredRatio: number | undefined;
    let transportAspect = aspectRatio;
    let aspectRatioSource: MediaVideoJobInput['aspectRatioSource'];
    if (!image && aspectRatio === 'auto') {
        const policy = options.adapterPolicy?.videoAutoAspect;
        const frameMode = snapshot.mode === 'imageToVideo' || snapshot.mode === 'firstLastFrame';
        aspectRatioSource = frameMode ? 'firstFrame' : 'referenceImage';
        if (!policy || !(frameMode ? policy.firstFrame : policy.referenceImage)) throw new CanvasServiceError('CANVAS_ADAPTER_UNSUPPORTED', 'This adapter cannot derive the video aspect from an image.');
        // The panel and compiler use the same per-resolution rule; global model ratios cannot authorize a hold.
        const derived = resolveCanvasDerivedAspectRatio(resolved.variant?.derivedAspectRatio ?? {
            inputRole: aspectRatioSource, aspectRatios: policy.aspectRatios.filter(ratio => {
                const [across, down] = ratio.split(':').map(Number); return across > 0 && down > 0;
            }), tolerance: 0.02, allowOmission: policy.omitAspectRatio
        }, snapshot.resolvedInputs);
        if (derived.issues.length) throw new CanvasServiceError('CANVAS_ASPECT_RATIO_UNSUPPORTED', derived.issues.map(issue => issue.message).join('; '));
        transportAspect = derived.aspectRatio;
        const [across, down] = transportAspect?.split(':').map(Number) ?? [];
        measuredRatio = transportAspect ? across / down : derived.measuredRatio;
    }
    const videoAuto = !image && resolution === 'auto' && options.adapterPolicy?.videoAutoOutput?.resolution === 'auto';
    const exact = aspectRatio && resolved.variant?.dimensions?.[aspectRatio];
    // Auto video uses the desk's project dimensions as fitter inputs, not inferred output pixels.
    let width = videoAuto && measuredRatio === undefined ? Number(parameters.width ?? options.canvasSize?.width) : exact ? exact.width : NaN;
    let height = videoAuto && measuredRatio === undefined ? Number(parameters.height ?? options.canvasSize?.height) : exact ? exact.height : NaN;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
        let ratio: number;
        if (aspectRatio === 'auto') {
            const source = snapshot.resolvedInputs.find(input => input.kind === 'image' && input.metadata?.width && input.metadata.height);
            ratio = measuredRatio ?? (source ? source.metadata!.width! / source.metadata!.height! : NaN);
        } else {
            const parts = aspectRatio?.split(':').map(Number);
            ratio = parts?.length === 2 && parts[1] > 0 ? parts[0] / parts[1] : NaN;
        }
        const shortSide = resolution && (/^(\d+)p$/i.exec(resolution)?.[1]
            ?? (/^[124]k$/iu.test(resolution) ? OPENROUTER_VIDEO_RESOLUTION_HEIGHT[resolution.toLowerCase()] : undefined));
        const square = resolution && /^(\d+)x(\d+)$/i.exec(resolution);
        if (resolution === 'auto' && (options.adapterPolicy?.imageAspectRatios?.length || videoAuto && measuredRatio !== undefined) && Number.isFinite(ratio) && ratio > 0) {
            const frozenWidth = Number(parameters.width), frozenHeight = Number(parameters.height);
            if (Number.isSafeInteger(frozenWidth) && Number.isSafeInteger(frozenHeight)) { width = frozenWidth; height = frozenHeight; }
            else if (options.canvasSize) {
                const pixels = Math.min(options.canvasSize.width, options.canvasSize.height);
                width = Math.round((ratio >= 1 ? pixels * ratio : pixels) / 2) * 2;
                height = Math.round((ratio >= 1 ? pixels : pixels / ratio) / 2) * 2;
            }
            if (Number.isFinite(width) && Number.isFinite(height) && Math.abs(width / height - ratio) / ratio > 0.02) throw new CanvasServiceError('CANVAS_DIMENSIONS_INVALID', 'The frozen image dimensions do not match the selected aspect ratio.');
        } else if (square) { width = Number(square[1]); height = Number(square[2]); }
        else if (shortSide && Number.isFinite(ratio) && ratio > 0) {
            width = Math.round((ratio >= 1 ? Number(shortSide) * ratio : Number(shortSide)) / 2) * 2;
            height = Math.round((ratio >= 1 ? Number(shortSide) : Number(shortSide) / ratio) / 2) * 2;
        }
    }
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 64 || height < 64 || width > 4096 || height > 4096) {
        throw new CanvasServiceError('CANVAS_DIMENSIONS_UNKNOWN', 'The selected resolution and aspect require known output dimensions.');
    }
    if (parameters.width !== undefined && parameters.width !== width || parameters.height !== undefined && parameters.height !== height) {
        throw new CanvasServiceError('CANVAS_DIMENSIONS_INVALID', 'Explicit dimensions do not match the selected resolution and aspect ratio.');
    }
    const images = snapshot.resolvedInputs.filter(input => input.kind === 'image' && (input.role === 'referenceImage' || input.role === 'character')).map(input => input.uri);
    if (images.length > 4) throw new CanvasServiceError('CANVAS_ADAPTER_REFERENCE_LIMIT', 'The current media queue supports at most four image references.');
    // Reference continuity belongs to the application, not the authored canvas text.
    // Only actual, supported inputs add these defaults; explicit story/camera changes remain authoritative.
    // Reserved clicks keep their stored request and are never recompiled on recovery.
    const continuity: string[] = [];
    if (!image && options.includeContinuityDefaults !== false) {
        if (snapshot.resolvedInputs.some(input => input.role === 'firstFrame' && input.kind === 'image')) {
            continuity.push('Start from the supplied first-frame image. Continue into the requested action without replaying a previous action or holding a still image.');
        }
        if (images.length || snapshot.resolvedInputs.some(input => input.kind === 'video' && input.role === 'referenceVideo')
            || snapshot.resolvedInputs.some(input => input.kind === 'image' && input.role === 'firstFrame')) {
            continuity.push('Keep each referenced character distinct, with the same face, hairstyle, body and outfit. Do not swap or merge identities. Use the supplied scene and lighting as the starting state. Follow explicit changes to appearance, scene, action and camera in the shot description.');
        }
        if (snapshot.resolvedInputs.some(input => input.role === 'lastFrame' && input.kind === 'image')) {
            continuity.push('Reach the supplied last-frame image as the ending state.');
        }
    }
    const expandedPrompt = continuity.length ? [...continuity, 'Shot description:', snapshot.prompt].join('\n') : snapshot.prompt;
    // Media transports already cap prompt text at 20,000 characters. Never truncate authored text
    // or drop actual images to make room for optional instructions near that existing boundary.
    const compact = continuity.length ? [
        'Continue from the supplied visual inputs. Keep character identities distinct and their appearance unchanged unless the shot explicitly changes it.',
        ...(snapshot.resolvedInputs.some(input => input.role === 'lastFrame' && input.kind === 'image') ? ['End at the supplied last frame.'] : []),
        snapshot.prompt
    ].join('\n') : snapshot.prompt;
    const promptLimit = image ? 20_000 : Math.min(20_000, videoModelGuide(snapshot.modelId).maxPromptChars);
    const prompt = expandedPrompt.trim().length <= promptLimit ? expandedPrompt : compact.trim().length <= promptLimit ? compact : snapshot.prompt;
    const base = { connectionId: options.connectionId, model: snapshot.modelId, prompt, width, height,
        ...(resolution && !videoAuto ? { resolution } : {}), ...(transportAspect ? { aspectRatio: transportAspect } : {}),
        ...(options.keyPriceQuoteId ? { keyPriceQuoteId: options.keyPriceQuoteId } : {}),
        ...(typeof parameters.negativePrompt === 'string' ? { negativePrompt: parameters.negativePrompt } : {}) };
    let input: MediaImageJobInput | MediaVideoJobInput;
    if (image) input = { ...base, ...(typeof parameters.quality === 'string' ? { quality: parameters.quality } : {}), ...(images.length ? { characterReferenceUris: images } : {}) };
    else {
        const durationSeconds = Number(parameters.durationSeconds);
        if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 300) throw new CanvasServiceError('CANVAS_DURATION_UNSUPPORTED', 'The current media queue requires a whole-second video duration.');
        const first = snapshot.resolvedInputs.find(item => item.role === 'firstFrame');
        const last = snapshot.resolvedInputs.find(item => item.role === 'lastFrame');
        const videos = snapshot.resolvedInputs.filter(item => item.role === 'referenceVideo').map(item => item.uri);
        const audios = snapshot.resolvedInputs.filter(item => item.role === 'referenceAudio').map(item => item.uri);
        const sourceMode = snapshot.mode === 'videoEdit' || snapshot.mode === 'videoExtend';
        if ((snapshot.mode === 'imageToVideo' || snapshot.mode === 'firstLastFrame') && !first) throw new CanvasServiceError('CANVAS_INPUT_REQUIRED', 'Image-to-video requires a first frame.');
        input = { ...base, generationMode: snapshot.mode as MediaVideoJobInput['generationMode'], durationSeconds,
            ...(aspectRatioSource ? { aspectRatioSource } : {}),
            ...(first ? options.adapterPolicy?.firstFrameField === 'referenceAssetUris' ? { referenceAssetUris: [first.uri] } : { firstFrameUri: first.uri } : {}), ...(last ? { lastFrameUri: last.uri } : {}),
            ...(images.length ? { characterReferenceUris: images } : {}),
            ...(videos.length ? sourceMode ? { sourceVideoUri: videos[0], ...(videos.length > 1 ? { referenceVideoUris: videos.slice(1) } : {}) } : { referenceVideoUris: videos } : {}),
            ...(audios.length ? { referenceAudioUris: audios } : {}),
            requestAudio: options.adapterPolicy?.audioRequestEnabled ?? (typeof parameters.generateAudio === 'boolean' ? parameters.generateAudio : resolved.audioGeneration?.defaultEnabled ?? false),
            ...(options.adapterPolicy?.audioControlVersion === 1 ? { audioControlVersion: 1 as const } : {}),
            ...(typeof parameters.preserveInputAudio === 'boolean' ? { preserveOriginalAudio: parameters.preserveInputAudio } : {}),
            requestSubtitles: typeof parameters.requestSubtitles === 'boolean' ? parameters.requestSubtitles : options.adapterPolicy?.subtitles === 'required' };
    }
    if (options.adapterPolicy) {
        const adapterIssues = canvasAdapterInputIssues(options.adapterPolicy, image ? 'image' : 'video', input);
        if (adapterIssues.length) throw new CanvasServiceError(adapterIssues[0].code, adapterIssues.map(issue => issue.message).join('; '));
    }
    return { idempotencyKey: options.idempotencyKey, projectId: options.projectId,
        sceneId: canvasMediaSceneId(options.canvasId), shotId: canvasMediaShotId(options.nodeId), kind: image ? 'image' : 'video', input, cost: options.cost };
}
