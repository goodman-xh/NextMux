import type { CanvasAudioGenerationCapability, CanvasGenerationMode, CanvasModelCapabilityEvidence, CanvasProvenVideoRequestShape } from '@nextmux/comic-core';
import { decodeCanvasProvenVideoShapes } from '@nextmux/comic-core/canvas-capabilities';
import { canvasRegistryFamily } from '@nextmux/comic-core/canvas-model-registry';
import type { MediaImageJobInput, MediaVideoJobInput } from '@nextmux/media-core';
import { openAIImageEditModelSupported, openAIImageOutputVariants } from '@nextmux/media-core/runtime';
import type { DesktopVideoModelFacts, OfficialModelConnection, PlatformOffering } from './nextmux-platform-protocol';
import { videoModelMakesSound } from './nextmux-model-sound';
import { managedVideoImagePriceMatchesProof } from './nextmux-managed-video-price';
import { videoModelGuide, videoModelUsesReferences } from './nextmux-video-model-guide';
import { canvasImageTierPolicy, offeringMediaTiers } from './nextmux-canvas-media-tiers';

export type CanvasAdapterKind = 'image' | 'video';
export interface CanvasAdapterPolicyOptions {
    readonly kind?: CanvasAdapterKind;
    readonly videoFacts?: DesktopVideoModelFacts;
    readonly videoLimits?: CanvasModelCapabilityEvidence['videoLimits'];
}
export type CanvasOfficialAdapterConnection = Pick<OfficialModelConnection, 'protocol' | 'providerSettings'> & Partial<Pick<OfficialModelConnection, 'baseUrl' | 'canvasCapabilities'>>;
export type CanvasManagedAdapterOffering = Pick<PlatformOffering, 'capabilities' | 'mediaInput' | 'providerModelCode'> & Partial<Pick<PlatformOffering, 'category' | 'managedTransport' | 'canonicalModel' | 'videoLimits' | 'imageLimits' | 'keyPriceQuoteId' | 'price'>>;

/** Transport facts shared by discovery, compilation and the guard before enqueue. No credential or URL is retained. */
export interface CanvasAdapterPolicy {
    readonly adapter: 'managed' | 'official' | 'template';
    readonly kind?: CanvasAdapterKind;
    readonly modes: readonly CanvasGenerationMode[];
    readonly registryFamilyId?: string;
    readonly firstFrameField?: 'referenceAssetUris' | 'firstFrameUri';
    /** Compatibility for durable jobs authored before dedicated frame fields were supported. */
    readonly legacyFirstFrame?: boolean;
    readonly referenceAssetInputs?: boolean;
    readonly lastFrame: boolean;
    readonly maxImageReferences: number;
    readonly framesWithImageReferences: boolean;
    readonly referenceVideos: boolean;
    readonly referenceAudios: boolean;
    readonly sourceVideo: boolean;
    readonly preserveOriginalAudio: boolean;
    readonly audioGeneration?: CanvasAudioGenerationCapability;
    /** Fixed input accepted by the adapter; native model audio may still be required in its output. */
    readonly audioRequestEnabled?: boolean;
    /** Only the standard own video adapter with exact listed audio control support sets this. */
    readonly audioControlVersion?: 1;
    readonly negativePromptInPrompt: boolean;
    readonly negativePromptLabel?: string;
    readonly missingTemplate?: boolean;
    readonly missingPrompt?: boolean;
    readonly subtitles: 'unsupported' | 'optional' | 'required';
    readonly durations?: readonly number[];
    /** Some routes (Veo) restrict the output length when identity pictures accompany a text-mode prompt. */
    readonly durationsWithImageReferences?: readonly number[];
    /** Pixel dimensions are chosen by these image providers; their request only transmits the aspect. */
    readonly imageAspectRatios?: readonly string[];
    /** Exact sizes the native image adapter transmits; separate from provider-owned OR resolution. */
    readonly imageOutputVariants?: ReturnType<typeof openAIImageOutputVariants>;
    readonly imageShapeQuoteId?: string;
    /** Output qualities a tier-priced image offering bills separately (GPT Image low/medium/high). */
    readonly imageQualities?: readonly string[];
    readonly defaultImageQuality?: string;
    /** Listed video ratios, or the exact fallback set selected by the transport. */
    readonly videoAspectRatios?: readonly string[];
    readonly videoShapeProofs?: readonly CanvasProvenVideoRequestShape[];
    readonly videoShapeQuoteId?: string;
    /** Semantic canvas auto is resolved from measured input before submission; it is never a provider value. */
    readonly videoAutoAspect?: {
        readonly firstFrame: boolean;
        readonly referenceImage: boolean;
        readonly aspectRatios: readonly string[];
        readonly omitAspectRatio: boolean;
    };
    /** Resolution is owned by the existing desk adapter, not a declared returned pixel size. */
    readonly videoAutoOutput?: { readonly resolution: 'auto'; readonly aspectRatios: readonly string[] };
}

const noAudio: CanvasAudioGenerationCapability = { mode: 'unsupported', defaultEnabled: false };
const requiredAudio: CanvasAudioGenerationCapability = { mode: 'required', defaultEnabled: true };
/** Exact fallback order used by fitOpenRouterVideoRequest, shared with the canvas declaration. */
export const OPENROUTER_VIDEO_DEFAULT_RATIOS: readonly string[] = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'];
/** Exact three aspect values produced by mediaTemplateVariables from the project dimensions. */
export const MEDIA_TEMPLATE_VIDEO_RATIOS: readonly string[] = ['16:9', '9:16', '1:1'];
const imageRatios = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];
const geminiRatios = ['1:1', '16:9', '9:16'];
const referenceCount = (value: number | undefined): number => Number.isSafeInteger(value) && Number(value) > 0 ? Math.min(4, Number(value)) : 0;
const derivedRatios = (fallback: readonly string[], ...lists: (readonly string[] | undefined)[]): readonly string[] => {
    const known = lists.filter((list): list is readonly string[] => Boolean(list?.length));
    return known.length ? known[0].filter(ratio => known.every(list => list.includes(ratio))) : fallback;
};
/** Removing a missing full-field placeholder is safe; removing a prompt containing one is not. */
function aspectPlaceholderOmittable(body: string): boolean {
    try {
        const safe = (value: unknown): boolean => typeof value === 'string' ? !value.includes('{{aspect_ratio}}') || value === '{{aspect_ratio}}'
            : Array.isArray(value) ? value.every(safe) : value && typeof value === 'object' ? Object.values(value).every(safe) : true;
        return safe(JSON.parse(body));
    } catch { return false; }
}
const imageModel = (model: string): boolean => /(?:^|[/_.-])(?:flux|imagen|dall-e|gpt-image|seedream|nano-banana)(?:$|[/_.-]|\d)/iu.test(model)
    || /(?:^|\/)gemini-[^/]*image(?:$|[-_.])/iu.test(model) || openAIImageEditModelSupported(model);
const openRouter = (connection: CanvasOfficialAdapterConnection): boolean => {
    try { const host = new URL(connection.baseUrl ?? '').hostname; return host === 'openrouter.ai' || host.endsWith('.openrouter.ai'); } catch { return false; }
};

/** The fixed catalog can remove transport inputs; it never grants a transport field. */
function registryAdapterPolicy(policy: CanvasAdapterPolicy, modelId: string, canonicalModel?: string): CanvasAdapterPolicy {
    const family = canvasRegistryFamily(modelId) ?? (canonicalModel ? canvasRegistryFamily(canonicalModel) : undefined);
    if (!family) return policy;
    const modes = policy.modes.filter(mode => family.modes.some(candidate => candidate.mode === mode));
    const registryModes = family.modes.filter(mode => modes.includes(mode.mode));
    const maxImages = Math.max(0, ...registryModes.map(mode => mode.referenceRules?.image?.supported ? mode.referenceRules.image.maxCount : 0));
    return { ...policy, registryFamilyId: family.id, modes,
        ...(registryModes.some(mode => mode.firstFrame) ? {} : { firstFrameField: undefined }),
        lastFrame: policy.lastFrame && registryModes.some(mode => mode.lastFrame === true),
        maxImageReferences: Math.min(policy.maxImageReferences, maxImages),
        referenceVideos: policy.referenceVideos && registryModes.some(mode => mode.referenceRules?.video?.supported === true),
        referenceAudios: policy.referenceAudios && registryModes.some(mode => mode.referenceRules?.audio?.supported === true),
        sourceVideo: policy.sourceVideo && modes.some(mode => mode === 'videoEdit' || mode === 'videoExtend'),
        preserveOriginalAudio: policy.preserveOriginalAudio && registryModes.some(mode => mode.preserveInputAudio === true) };
}

export function buildOfficialCanvasAdapterPolicy(connection: CanvasOfficialAdapterConnection, modelId: string, options: CanvasAdapterPolicyOptions = {}): CanvasAdapterPolicy {
    const template = connection.protocol === 'async_media_template' ? connection.providerSettings?.mediaTemplate : undefined;
    if (connection.protocol === 'async_media_template' && !template) return {
        adapter: 'template', kind: options.kind, modes: [], lastFrame: false, maxImageReferences: 0, framesWithImageReferences: false,
        referenceVideos: false, referenceAudios: false, sourceVideo: false, preserveOriginalAudio: false,
        negativePromptInPrompt: false, subtitles: 'unsupported', missingTemplate: true };
    const body = template?.submit.body ?? '';
    const missingPrompt = Boolean(template && !body.includes('{{prompt}}'));
    const facts = options.videoFacts ?? videoModelGuide(modelId);
    const declared = connection.canvasCapabilities?.providerModelId === modelId ? connection.canvasCapabilities.modes : [];
    const kind = template?.kind === 'image' || template?.kind === 'video' ? template.kind : options.kind ?? (
        facts.family || declared.some(mode => !['textToImage', 'imageToImage'].includes(mode.mode)) ? 'video'
            : imageModel(modelId) || declared.some(mode => ['textToImage', 'imageToImage'].includes(mode.mode)) ? 'image' : undefined);
    const imageDelivery = Boolean(template && template.images !== 'none');
    const routerVideo = !template && kind === 'video' && connection.protocol === 'openai_chat_completions' && openRouter(connection);
    const routerImage = !template && kind === 'image' && connection.protocol === 'openai_chat_completions'
        && (connection.providerSettings?.mediaApiStyle === undefined ? openRouter(connection) : connection.providerSettings.mediaApiStyle === 'openrouter');
    const nativeImage = !template && kind === 'image' && connection.protocol === 'openai_chat_completions' && !routerImage && imageModel(modelId);
    const nativeImageEdit = nativeImage && openAIImageEditModelSupported(modelId);
    const first = template ? imageDelivery && /\{\{(?:first_frame|image|images|images_csv)\}\}/u.test(body)
        : kind === 'video' && connection.protocol === 'openai_chat_completions' && facts.firstFrame !== false;
    const listedFrames = options.videoLimits?.frameImages ?? options.videoFacts?.frameImages;
    const last = template ? imageDelivery && /\{\{last_frame\}\}/u.test(body)
        : routerVideo && first && Boolean(listedFrames?.includes('first_frame') && listedFrames.includes('last_frame')) && facts.lastFrame !== false;
    const refs = template ? imageDelivery && /\{\{(?:references|reference|images|references_csv|images_csv)\}\}/u.test(body)
        : kind === 'image' ? connection.protocol === 'gemini_generate_content' || routerImage || nativeImageEdit
            : openRouter(connection) && videoModelUsesReferences(facts);
    const singleReference = Boolean(template && /\{\{reference\}\}/u.test(body) && !/\{\{(?:references|images|references_csv|images_csv)\}\}/u.test(body));
    const maxImageReferences = refs ? referenceCount(template ? singleReference ? Math.min(1, template.maxReferences) : template.maxReferences : kind === 'image' ? 4 : facts.maxReferences) : 0;
    const dynamicAudio = Boolean(template && /\{\{(?:generate_audio|request_audio|audio)\}\}/u.test(body));
    const fixedAudio = Boolean(template && /"(?:generate_audio|with_audio|enable_audio|audio|sound)"\s*:\s*"?(?:true|on|1|yes)"?/iu.test(body));
    const nativeAudio = kind === 'video' && (facts.nativeAudio || videoModelMakesSound(modelId));
    const nativeAudioControl = routerVideo && options.videoFacts?.supportsGenerateAudio === true;
    const audioGeneration: CanvasAudioGenerationCapability | undefined = nativeAudioControl ? { mode: 'optional', defaultEnabled: true }
        : nativeAudio || fixedAudio ? requiredAudio : dynamicAudio ? undefined : noAudio;
    const videoAspectRatios = routerVideo ? options.videoFacts?.aspectRatios.length ? options.videoFacts.aspectRatios : OPENROUTER_VIDEO_DEFAULT_RATIOS : undefined;
    const videoAutoOutput = template && kind === 'video' && body.includes('{{aspect_ratio}}')
        ? { resolution: 'auto' as const, aspectRatios: MEDIA_TEMPLATE_VIDEO_RATIOS }
        : routerVideo
        && !options.videoFacts?.resolutions.length ? { resolution: 'auto' as const,
            aspectRatios: videoAspectRatios ?? OPENROUTER_VIDEO_DEFAULT_RATIOS } : undefined;
    const supportedProtocol = template ? !missingPrompt && (template.kind === 'image' || template.kind === 'video')
        : connection.protocol === 'openai_chat_completions' || connection.protocol === 'gemini_generate_content';
    const modes: CanvasGenerationMode[] = !supportedProtocol ? [] : kind === 'image' ? ['textToImage', ...(maxImageReferences ? ['imageToImage' as const] : [])]
        : kind === 'video' ? ['textToVideo', ...(first ? ['imageToVideo' as const] : []), ...(first && last ? ['firstLastFrame' as const] : []),
            ...(maxImageReferences || body.includes('{{reference_videos}}') || body.includes('{{reference_audios}}') ? ['referenceToVideo' as const] : []),
            ...(body.includes('{{source_video}}') ? ['videoEdit' as const, 'videoExtend' as const] : [])] : [];
    return registryAdapterPolicy({ adapter: template ? 'template' : 'official', kind, modes, ...(first ? { firstFrameField: template || routerVideo ? 'firstFrameUri' : 'referenceAssetUris' } : {}),
        ...(routerVideo ? { legacyFirstFrame: true, referenceAssetInputs: true } : {}),
        ...(missingPrompt ? { missingPrompt: true } : {}),
        lastFrame: last, maxImageReferences, framesWithImageReferences: routerVideo || Boolean(template && /\{\{(?:first_frame|image)\}\}/u.test(body) && /\{\{(?:references|reference|references_csv)\}\}/u.test(body)),
        sourceVideo: Boolean(template && body.includes('{{source_video}}')), referenceVideos: Boolean(template && body.includes('{{reference_videos}}')),
        referenceAudios: Boolean(template && body.includes('{{reference_audios}}')), preserveOriginalAudio: Boolean(template && body.includes('{{preserve_original_audio}}')),
        audioGeneration, ...(nativeAudioControl ? { audioControlVersion: 1 as const } : {}), ...(!dynamicAudio && !nativeAudioControl ? { audioRequestEnabled: fixedAudio } : {}), ...(videoAutoOutput ? { videoAutoOutput } : {}),
        ...(kind === 'video' && (routerVideo || template) ? { videoAutoAspect: {
            firstFrame: first, referenceImage: maxImageReferences > 0,
            aspectRatios: derivedRatios(routerVideo ? OPENROUTER_VIDEO_DEFAULT_RATIOS : MEDIA_TEMPLATE_VIDEO_RATIOS, options.videoFacts?.aspectRatios, options.videoLimits?.aspectRatios),
            omitAspectRatio: routerVideo || aspectPlaceholderOmittable(body)
        } } : {}),
        ...(videoAspectRatios ? { videoAspectRatios } : {}),
        negativePromptInPrompt: template ? !body.includes('{{negative_prompt}}') : openRouter(connection) || kind === 'video' && connection.protocol === 'gemini_generate_content',
        ...(!template && kind === 'video' && connection.protocol === 'gemini_generate_content' ? { negativePromptLabel: 'Negative prompt: ' } : {}),
        subtitles: /"subtitles"\s*:\s*true/iu.test(body) ? 'required' : 'unsupported',
        ...(template?.seconds.length ? { durations: [...template.seconds] } : {}),
        ...(!template && kind === 'video' && openRouter(connection) && facts.clipSecondsWithReferences?.length
            ? { durationsWithImageReferences: [...facts.clipSecondsWithReferences] } : {}),
        ...(nativeImage ? { imageOutputVariants: openAIImageOutputVariants(modelId) } : {}),
        ...(kind === 'image' && !template && (routerImage || connection.protocol === 'gemini_generate_content') ? { imageAspectRatios: connection.protocol === 'gemini_generate_content' ? geminiRatios : imageRatios } : {}) }, modelId);
}

/** A catalogue dimension only becomes a menu option for the reviewed native
 * single-image SKU and its same accepted quote. A model name alone grants none. */
function managedExactImageVariants(offering: CanvasManagedAdapterOffering): CanvasAdapterPolicy['imageOutputVariants'] {
    const limits=offering.imageLimits;
    if(offering.category!=='image'||offering.canonicalModel!=='seedream-4-5-251128'||offering.providerModelCode!=='seedream-4-5-251128'
        ||offering.managedTransport?.protocol!=='openai'||limits?.nativeProtocol!=='byteplus_seedream45_v1'
        ||limits.count!==1||limits.sequentialGeneration!==false||limits.shapeQuoteId!==offering.keyPriceQuoteId
        ||!/^kq1_[a-f0-9]{64}$/u.test(offering.keyPriceQuoteId??'')||!Array.isArray(limits.dimensions)||limits.dimensions.length!==1) return undefined;
    const size=limits.dimensions[0];
    if(size?.width!==1600||size.height!==2848||size.resolution!=='2K'||size.aspectRatio!=='9:16')return undefined;
    return [{id:'managed-seedream45-2k-single',resolution:'2K',aspectRatios:['9:16'],defaultAspectRatio:'9:16',
        dimensions:{'9:16':{width:1600,height:2848}}}];
}

export function buildManagedCanvasAdapterPolicy(offering: CanvasManagedAdapterOffering, options: CanvasAdapterPolicyOptions = {}): CanvasAdapterPolicy {
    const limits = options.videoLimits ?? offering.videoLimits;
    const kind = offering.category === 'image' || offering.category === 'video' ? offering.category : options.kind ?? (
        offering.capabilities.some(flag => /^(?:text_to_video|image_to_video|reference_to_video|video_generation)$/u.test(flag)) ? 'video'
            : offering.capabilities.some(flag => /^(?:image_generation|text_to_image|image_to_image)$/u.test(flag)) ? 'image' : undefined);
    const references = kind === 'video' ? offering.mediaInput?.referenceImages === true
        : offering.mediaInput?.referenceImages ?? (offering.capabilities.includes('image_to_image') || offering.capabilities.includes('reference_to_video'));
    const maxImageReferences = references ? referenceCount(offering.mediaInput?.maxReferences ?? (kind === 'video' ? 0 : 4)) : 0;
    const first = kind === 'video' && offering.mediaInput?.firstFrame === true;
    const last = first && offering.mediaInput?.lastFrame === true;
    const modes: CanvasGenerationMode[] = kind === 'image' ? ['textToImage', ...(maxImageReferences ? ['imageToImage' as const] : [])]
        : kind === 'video' ? ['textToVideo', ...(first ? ['imageToVideo' as const] : []), ...(last ? ['firstLastFrame' as const] : []), ...(maxImageReferences ? ['referenceToVideo' as const] : [])] : [];
    // Audio controls follow complete shapes under this same public quote, never a model label.
    const decoded = decodeCanvasProvenVideoShapes(limits);
    const currentShapes = kind === 'video' && !decoded.error && limits?.shapeQuoteId === offering.keyPriceQuoteId
        && /^kq1_[a-f0-9]{64}$/u.test(offering.keyPriceQuoteId ?? '') && managedVideoImagePriceMatchesProof(offering, limits)
        ? decoded.shapes ?? [] : [];
    const audioChoices = new Set(currentShapes.map(shape => shape.requestAudio));
    const audioGeneration = audioChoices.size > 1 ? { mode: 'optional' as const, defaultEnabled: true }
        : audioChoices.has(true) ? requiredAudio : noAudio;
    const audioRequestEnabled = audioChoices.size > 1 ? undefined : audioChoices.has(true);
    return registryAdapterPolicy({ adapter: 'managed', kind, modes, ...(first ? { firstFrameField: 'firstFrameUri' as const } : {}), lastFrame: last,
        legacyFirstFrame: true, referenceAssetInputs: true,
        maxImageReferences, framesWithImageReferences: true, referenceVideos: false, referenceAudios: false, sourceVideo: false,
        preserveOriginalAudio: false, audioGeneration, ...(audioRequestEnabled === undefined ? {} : { audioRequestEnabled }), negativePromptInPrompt: false, subtitles: 'unsupported',
        ...(kind === 'video' ? { videoAutoAspect: {
            firstFrame: first, referenceImage: maxImageReferences > 0,
            aspectRatios: derivedRatios(OPENROUTER_VIDEO_DEFAULT_RATIOS, options.videoFacts?.aspectRatios, limits?.aspectRatios)
                .filter(ratio => OPENROUTER_VIDEO_DEFAULT_RATIOS.includes(ratio)),
            // The current managed gateway derives and always sends an explicit ratio from queue dimensions.
            omitAspectRatio: false
        } } : {}),
        ...(kind === 'video' && managedVideoImagePriceMatchesProof(offering, limits) && limits?.shapeQuoteId === offering.keyPriceQuoteId && /^kq1_[a-f0-9]{64}$/u.test(offering.keyPriceQuoteId ?? '')
            ? { videoShapeQuoteId: offering.keyPriceQuoteId, videoShapeProofs: decodeCanvasProvenVideoShapes(limits).shapes } : {}),
        ...(kind === 'image' && managedExactImageVariants(offering) ? { imageOutputVariants: managedExactImageVariants(offering), imageShapeQuoteId: offering.keyPriceQuoteId } : {}),
        ...(kind === 'image' && references ? { imageAspectRatios: offering.managedTransport?.protocol === 'gemini' ? geminiRatios : imageRatios } : {}),
        // Official price tiers: only the sizes / classes / qualities a tier prices are offered, so the choice is the bill.
        ...(kind === 'image' && !managedExactImageVariants(offering)
            ? canvasImageTierPolicy(offeringMediaTiers(offering), offering.managedTransport?.protocol === 'gemini' ? geminiRatios : imageRatios) ?? {} : {}) }, offering.providerModelCode, offering.canonicalModel);
}

export function canvasAdapterInputIssues(policy: CanvasAdapterPolicy, kind: CanvasAdapterKind, input: MediaImageJobInput | MediaVideoJobInput): readonly { readonly code: string; readonly message: string }[] {
    const issues: { code: string; message: string }[] = [];
    const unsupported = (message: string): void => { issues.push({ code: 'CANVAS_ADAPTER_UNSUPPORTED', message }); };
    if (policy.missingTemplate) return [{ code: 'CANVAS_ADAPTER_UNKNOWN', message: 'The media adapter template is missing.' }];
    if (policy.missingPrompt) return [{ code: 'CANVAS_ADAPTER_UNSUPPORTED', message: 'The media adapter template has no prompt placeholder, so it cannot transmit the authored prompt.' }];
    if (!policy.modes.length) unsupported('The selected protocol cannot transmit this media request.');
    if (policy.kind && policy.kind !== kind) unsupported('The selected adapter does not generate this media kind.');
    const images = input.characterReferenceUris?.length ?? 0;
    if (images > policy.maxImageReferences) issues.push({ code: policy.maxImageReferences ? 'CANVAS_ADAPTER_REFERENCE_LIMIT' : 'CANVAS_ADAPTER_UNSUPPORTED', message: `This route accepts at most ${policy.maxImageReferences} image references.` });
    if (kind !== 'video') {
        if(policy.imageShapeQuoteId && (input.keyPriceQuoteId!==policy.imageShapeQuoteId || input.width!==1600 || input.height!==2848
            ||input.resolution!=='2K'||input.aspectRatio!=='9:16')) issues.push({code:'CANVAS_PRICE_QUOTE_CHANGED',message:'The native image shape must match this accepted public quote.'});
        return issues;
    }
    const video = input as MediaVideoJobInput;
    if (video.aspectRatio === 'auto') unsupported('The video aspect must be resolved from measured input before submission.');
    if (video.generationMode && !policy.modes.includes(video.generationMode)) unsupported('The selected generation mode cannot be transmitted by this adapter.');
    const references = video.referenceAssetUris?.length ?? 0;
    const legacyFirst = !video.firstFrameUri && references === 1 && video.generationMode !== 'referenceToVideo'
        && (policy.legacyFirstFrame === true || policy.firstFrameField === 'referenceAssetUris');
    const referenceCount = images + (legacyFirst ? 0 : references);
    if (video.firstFrameUri && policy.firstFrameField !== 'firstFrameUri' || references && !legacyFirst && !policy.referenceAssetInputs) unsupported('The adapter cannot transmit this first-frame or reference form.');
    if (referenceCount > policy.maxImageReferences) issues.push({ code: 'CANVAS_ADAPTER_REFERENCE_LIMIT', message: `This route accepts at most ${policy.maxImageReferences} image references.` });
    const first = Boolean(video.firstFrameUri || legacyFirst);
    if ((video.generationMode === 'imageToVideo' || video.generationMode === 'firstLastFrame') && !first) unsupported('Image-to-video requires its first frame to reach the provider.');
    if (video.generationMode === 'firstLastFrame' && !video.lastFrameUri) unsupported('First/last-frame generation requires both frames.');
    if (video.lastFrameUri && (!policy.lastFrame || !first) || referenceCount && first && !policy.framesWithImageReferences) unsupported('This route cannot combine the selected frame and image reference inputs.');
    if (policy.adapter === 'managed') {
        if (!policy.videoShapeQuoteId || video.keyPriceQuoteId !== policy.videoShapeQuoteId) issues.push({ code: 'CANVAS_PRICE_QUOTE_CHANGED', message: 'Refresh the route: the video shape proof must match the selected price quote.' });
        if (!Array.isArray(policy.videoShapeProofs) || !policy.videoShapeProofs.some(shape => shape && typeof shape.resolution === 'string' && shape.resolution.toLowerCase() === video.resolution?.toLowerCase()
            && shape.aspectRatio === video.aspectRatio && shape.durationSeconds === video.durationSeconds && shape.width === video.width && shape.height === video.height
            && shape.firstFrame === first && shape.lastFrame === Boolean(video.lastFrameUri) && shape.referenceImages === referenceCount && shape.requestAudio === (video.requestAudio ?? false))) {
            issues.push({ code: 'CANVAS_MANAGED_SHAPE_UNPROVEN', message: 'The public catalog has not proved this complete video shape against the selected hold.' });
        }
    }
    if (video.sourceVideoUri && !policy.sourceVideo || video.referenceVideoUris?.length && !policy.referenceVideos || video.referenceAudioUris?.length && !policy.referenceAudios
        || video.preserveOriginalAudio === true && !policy.preserveOriginalAudio || video.editFrameSeconds !== undefined || video.editStartSeconds !== undefined || video.editEndSeconds !== undefined) unsupported('The adapter cannot transmit the selected video, audio or edit inputs.');
    if (policy.audioRequestEnabled !== undefined ? video.requestAudio !== undefined && video.requestAudio !== policy.audioRequestEnabled
        : video.requestAudio === true && policy.audioGeneration?.mode === 'unsupported' || video.requestAudio === false && policy.audioGeneration?.mode === 'required') unsupported('The requested audio choice conflicts with this adapter.');
    if (video.requestSubtitles === true && policy.subtitles === 'unsupported' || video.requestSubtitles === false && policy.subtitles === 'required') unsupported('The requested subtitle choice conflicts with this adapter.');
    if (!Number.isSafeInteger(video.durationSeconds) || policy.durations?.length && !policy.durations.includes(video.durationSeconds)) issues.push({ code: 'CANVAS_DURATION_UNSUPPORTED', message: 'The exact duration cannot be transmitted by this adapter.' });
    if (referenceCount && policy.durationsWithImageReferences?.length && !policy.durationsWithImageReferences.includes(video.durationSeconds)) {
        issues.push({ code: 'CANVAS_DURATION_UNSUPPORTED', message: `With image references this route accepts only these video durations: ${policy.durationsWithImageReferences.join(', ')} seconds.` });
    }
    return issues;
}
