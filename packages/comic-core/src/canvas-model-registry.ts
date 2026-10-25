import type { CanvasGenerationMode } from './canvas.js';
import type {
  CanvasAudioGenerationCapability, CanvasCombinationConstraint, CanvasDurationRule, CanvasModeCapability,
  CanvasOutputVariant, CanvasParameterDefinition, CanvasReferenceCombination, CanvasReferenceRule,
} from './canvas-capabilities.js';
import { CANVAS_REGISTRY_SNAPSHOT } from './canvas-model-registry-snapshot.js';
import { canvasRegistryFamilyId } from './canvas-model-registry-aliases.js';

export type CanvasRegistryKind = 'image' | 'video';

/** Snapshot metadata is evidence of a fixed menu, never evidence of a usable route. */
export interface CanvasRegistrySnapshot {
  readonly capturedDate: string;
  readonly timezone: string;
  readonly videoModels: readonly CanvasRegistryVideoSnapshotModel[];
  readonly imageModels: readonly CanvasRegistryImageSnapshotModel[];
}

export interface CanvasRegistryGenerationType {
  readonly value: string;
  readonly resolutions: readonly {
    readonly value: string;
    readonly aspectRatios: readonly { readonly value: string; readonly [key: string]: unknown }[];
    readonly [key: string]: unknown;
  }[];
  readonly [key: string]: unknown;
}

export interface CanvasRegistryMediaConstraints {
  readonly formats?: readonly string[];
  readonly max_count?: number;
  readonly max_size_mb?: number;
  readonly min_duration?: number;
  readonly max_duration?: number;
  readonly aspect_ratio_range?: readonly number[];
  readonly [key: string]: unknown;
}

export interface CanvasRegistryExtraInputConstraints {
  readonly formats?: readonly string[];
  readonly codecs?: readonly string[];
  readonly resolutions?: readonly string[];
  readonly max_size_mb?: number;
  readonly duration_range_s?: string;
  readonly total_duration_s?: number;
  readonly side_range_px?: string;
  readonly aspect_ratio_range?: string;
  readonly fps_range?: string;
  readonly [key: string]: unknown;
}

export interface CanvasRegistryFeatureConfig {
  readonly supportAudioGeneration: number;
  readonly supportAudioUpload: boolean;
  readonly supportDraft: boolean;
  readonly supportFirstLastFrame: boolean;
  readonly supportReferenceToVideo: boolean;
  readonly supportReferenceToVideoSize: number;
  readonly supportReferenceImage: boolean;
  readonly supportReferenceVideo: boolean;
  readonly supportReferenceAudio: boolean;
  readonly maxReferenceImages: number;
  readonly maxReferenceVideos: number;
  readonly maxReferenceAudios: number;
  readonly comboLimits: Readonly<Record<string, {
    readonly max_images?: number;
    readonly max_videos?: number;
    readonly max_audios?: number;
    readonly [key: string]: unknown;
  }>> | null;
  readonly extraLimits: {
    readonly image_constraints?: CanvasRegistryExtraInputConstraints;
    readonly video_constraints?: CanvasRegistryExtraInputConstraints;
    readonly audio_constraints?: CanvasRegistryExtraInputConstraints;
    readonly output_constraints?: { readonly resolutions?: readonly string[]; readonly duration_range_s?: string; readonly [key: string]: unknown };
    readonly request_constraints?: { readonly max_body_size_mb?: number; readonly [key: string]: unknown };
    readonly [key: string]: unknown;
  } | null;
  readonly [key: string]: unknown;
}

export interface CanvasRegistryVideoSnapshotModel {
  readonly value: string;
  readonly provider: string;
  readonly supportAudio: number;
  readonly supportAudioUpload: boolean;
  readonly supportFirstLastFrame: boolean;
  readonly supportReferenceToVideo: boolean;
  readonly supportReferenceToVideoSize: number;
  readonly supportDraft: boolean;
  readonly durationRange: { readonly min: number; readonly max: number; readonly step?: number };
  readonly featureConfig: CanvasRegistryFeatureConfig;
  readonly generationTypes: readonly CanvasRegistryGenerationType[];
  readonly mediaConstraints?: {
    readonly image?: CanvasRegistryMediaConstraints;
    readonly video?: CanvasRegistryMediaConstraints;
    readonly audio?: CanvasRegistryMediaConstraints;
  } | null;
  readonly [key: string]: unknown;
}

export interface CanvasRegistryImageSnapshotModel {
  readonly model_name: string;
  readonly provider: string;
  readonly model_type: string;
  readonly supported_sizes: readonly string[];
  readonly supported_aspect_ratios: readonly string[];
  readonly quality: readonly string[] | null;
  readonly supported_output_formats: readonly string[] | null;
  readonly max_reference_images: number;
  readonly image_count_options: readonly string[];
  readonly support_seed: boolean;
  readonly support_custom_aspect_ratio: boolean;
  readonly maintenance: boolean;
  readonly [key: string]: unknown;
}

export interface CanvasRegistryReferenceRule extends CanvasReferenceRule {
  readonly minAspectRatio?: number;
  readonly maxAspectRatio?: number;
  readonly codecs?: readonly string[];
  readonly resolutions?: readonly string[];
}

export interface CanvasRegistryRestriction {
  readonly source: string;
  readonly description: string;
  /** Additional output limits remain separate from the authoritative top-level durationRange. */
  readonly outputDuration?: { readonly min: number; readonly max: number };
  readonly outputResolutions?: readonly string[];
  readonly maxRequestBodyBytes?: number;
}

export interface CanvasRegistryImageOptions {
  readonly sizes: readonly string[];
  readonly aspectRatios: readonly string[];
  /** Null is an absent quality selector, not permission to send arbitrary qualities. */
  readonly qualityLevels: readonly string[] | null;
  readonly referenceImageLimit: number;
  readonly imageCountOptions: readonly number[];
  readonly imageCountRange: { readonly min: number; readonly max: number };
  readonly rawImageCountOptions: readonly string[];
  readonly outputFormats: readonly string[] | null;
  readonly customAspectRatio: boolean;
  readonly seed: boolean;
}

export interface CanvasRegistryModel {
  readonly id: string;
  readonly specId: string;
  readonly displayName: string;
  readonly vendor: string;
  readonly kind: CanvasRegistryKind;
  readonly modes: readonly CanvasModeCapability[];
  readonly sources: readonly string[];
  readonly raw: CanvasRegistryVideoSnapshotModel | CanvasRegistryImageSnapshotModel;
  readonly imageOptions?: CanvasRegistryImageOptions;
  /** The regular single-URL upload gate; independent of generated audio and multimodal references. */
  readonly audioUpload?: boolean;
  readonly firstLastFrame?: boolean;
  readonly draft?: boolean;
  readonly referenceRules?: {
    readonly image: CanvasRegistryReferenceRule;
    readonly video: CanvasRegistryReferenceRule;
    readonly audio: CanvasRegistryReferenceRule;
  };
  readonly combinationConstraints?: readonly CanvasCombinationConstraint[];
  readonly restrictions: readonly CanvasRegistryRestriction[];
}

const VIDEO_IDENTITIES: Readonly<Record<string, readonly [string, string, string]>> = {
  'doubao-seedance-2-5-260628': ['seedance-2.5', 'Seedance 2.5', 'ByteDance'],
  'doubao-seedance-2-5-260628-draft': ['seedance-2.5-draft', 'Seedance 2.5 Draft', 'ByteDance'],
  'neo-video-2-0': ['seedance-2.0', 'Seedance 2.0', 'ByteDance'],
  'neo-video-2-0-fast': ['seedance-2.0-fast', 'Seedance 2.0 Fast', 'ByteDance'],
  'doubao-seedance-2-0-mini-260615': ['seedance-2.0-mini', 'Seedance 2.0 Mini', 'ByteDance'],
  'MiniMax-H3': ['minimax-h3', 'MiniMax H3', 'MiniMax'],
  'MiniMax-H3-Max': ['minimax-h3-max', 'MiniMax H3 Max', 'MiniMax'],
  'doubao-seedance-1-0-pro-fast-251015': ['seedance-1.0-fast', 'Seedance 1.0 Fast', 'ByteDance'],
  'doubao-seedance-1-0-pro-250528': ['seedance-1.0-pro', 'Seedance 1.0 Pro', 'ByteDance'],
  'kling-v3': ['kling-v3', 'Kling v3', 'Kuaishou'],
  'kling-v2-6': ['kling-v2.6', 'Kling v2.6', 'Kuaishou'],
  'kling-v2-5': ['kling-v2.5', 'Kling v2.5', 'Kuaishou'],
  'kling-v2-1': ['kling-v2.1', 'Kling v2.1', 'Kuaishou'],
  'vidu-q3-pro': ['vidu-q3-pro', 'Vidu Q3 Pro', 'ShengShu'],
  'vidu-q2-pro': ['vidu-q2-pro', 'Vidu Q2 Pro', 'ShengShu'],
  'wan3.0-video': ['wan-3.0', 'Wan 3.0', 'Alibaba'],
  'wan2.7': ['wan-2.7', 'Wan 2.7', 'Alibaba'],
  'MiniMax-Hailuo-2.3': ['hailuo-2.3', 'MiniMax Hailuo 2.3', 'MiniMax'],
  'happyhorse-1.0': ['happyhorse-1.0', 'HappyHorse 1.0', 'Alibaba'],
  'MiniMax-Hailuo-2.3-Fast': ['hailuo-2.3-fast', 'MiniMax Hailuo 2.3 Fast', 'MiniMax'],
  'MiniMax-Hailuo-02': ['hailuo-02', 'MiniMax Hailuo 02', 'MiniMax'],
  'veo-3.1-generate-001': ['veo-3.1', 'Veo 3.1', 'Google'],
  'veo-3.1-fast-generate-001': ['veo-3.1-fast', 'Veo 3.1 Fast', 'Google'],
};
const IMAGE_IDENTITIES: Readonly<Record<string, readonly [string, string, string]>> = {
  'gpt-image-2.5-flare': ['gpt-image-2.5-flare', 'GPT Image 2.5 Flare', 'OpenAI'],
  'gpt-image-2.5-sunburst': ['gpt-image-2.5-sunburst', 'GPT Image 2.5 Sunburst', 'OpenAI'],
  'gpt-image-2': ['gpt-image-2', 'GPT Image 2', 'OpenAI'],
  'gpt-image-2-official': ['gpt-image-2-official', 'GPT Image 2 Official', 'OpenAI'],
  'doubao-seedream-5-0-pro-260628': ['seedream-5.0-pro', 'Seedream 5.0 Pro', 'ByteDance'],
  'qwen-image-3.0-pro': ['qwen-image-3.0-pro', 'Qwen-Image 3.0 Pro', 'Alibaba'],
  'doubao-seedream-5-0-260128': ['seedream-5.0', 'Seedream 5.0', 'ByteDance'],
  'doubao-seedream-4-5-251128': ['seedream-4.5', 'Seedream 4.5', 'ByteDance'],
  'doubao-seedream-4-0-250828': ['seedream-4.0', 'Seedream 4.0', 'ByteDance'],
  'gemini-3-pro-image-preview': ['gemini-3-pro-image', 'Gemini 3 Pro Image', 'Google'],
  'gemini-3.1-flash-image-preview': ['gemini-3.1-flash-image', 'Gemini 3.1 Flash Image', 'Google'],
  'gemini-3.1-flash-lite-image': ['gemini-3.1-flash-lite-image', 'Gemini 3.1 Flash Lite Image', 'Google'],
  'gemini-2.5-flash-image': ['gemini-2.5-flash-image', 'Gemini 2.5 Flash Image', 'Google'],
  'wan2.7-image-pro': ['wan-2.7-image-pro', 'Wan 2.7 Image Pro', 'Alibaba'],
  'hy-image-3.5-preview': ['hunyuan-image-3.5', 'Hunyuan Image 3.5', 'Tencent'],
};

const GENERATION_MODES: Readonly<Record<string, CanvasGenerationMode>> = {
  TEXT_TO_VIDEO: 'textToVideo', IMAGE_TO_VIDEO: 'imageToVideo', REFERENCE_TO_VIDEO: 'referenceToVideo',
  VIDEO_TO_VIDEO: 'videoEdit', EXTEND_TO_VIDEO: 'videoExtend',
};
const COMBINATIONS: Readonly<Record<string, CanvasReferenceCombination>> = {
  image_only: 'image', video_only: 'video', audio_only: 'audio', image_video: 'image+video',
  image_audio: 'image+audio', video_audio: 'video+audio', image_video_audio: 'image+video+audio',
};

function pair(value: string | undefined): readonly [number, number] | undefined {
  const match = value?.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

function referenceRule(model: CanvasRegistryVideoSnapshotModel, kind: 'image' | 'video' | 'audio', conventionalReference = false): CanvasRegistryReferenceRule {
  const feature = model.featureConfig;
  const extra = feature.extraLimits?.[`${kind}_constraints`];
  const media = model.mediaConstraints?.[kind];
  const declaredCount = kind === 'image' ? feature.maxReferenceImages : kind === 'video' ? feature.maxReferenceVideos : feature.maxReferenceAudios;
  // Conventional REFERENCE_TO_VIDEO is a separate schema: zero universal references does not erase it.
  const count = media?.max_count ?? (conventionalReference && kind === 'image' && declaredCount === 0 ? model.supportReferenceToVideoSize : declaredCount);
  const supported = kind === 'image' ? feature.supportReferenceImage || conventionalReference && model.supportReferenceToVideo : kind === 'video' ? feature.supportReferenceVideo : feature.supportReferenceAudio;
  const duration = pair(extra?.duration_range_s), side = pair(extra?.side_range_px), fps = pair(extra?.fps_range);
  const aspect = media?.aspect_ratio_range ?? pair(extra?.aspect_ratio_range);
  return {
    supported: supported && count > 0, maxCount: supported ? count : 0,
    ...(media?.formats ?? extra?.formats ? { formats: media?.formats ?? extra?.formats } : {}),
    ...(media?.max_size_mb ?? extra?.max_size_mb ? { maxBytes: Number(media?.max_size_mb ?? extra?.max_size_mb) * 1024 * 1024 } : {}),
    ...(media?.min_duration ?? duration?.[0] ? { minDurationSeconds: media?.min_duration ?? duration?.[0] } : {}),
    ...(media?.max_duration ?? duration?.[1] ? { maxDurationSeconds: media?.max_duration ?? duration?.[1] } : {}),
    ...(extra?.total_duration_s !== undefined ? { maxTotalDurationSeconds: extra.total_duration_s } : {}),
    ...(side ? { minWidth: side[0], minHeight: side[0], maxWidth: side[1], maxHeight: side[1] } : {}),
    ...(aspect ? { minAspectRatio: aspect[0], maxAspectRatio: aspect[1] } : {}),
    ...(fps ? { minFrameRate: fps[0], maxFrameRate: fps[1] } : {}),
    ...(extra?.codecs ? { codecs: extra.codecs } : {}),
    ...(extra?.resolutions ? { resolutions: extra.resolutions } : {}),
  };
}

function combinations(model: CanvasRegistryVideoSnapshotModel, conventionalReference = false): readonly CanvasCombinationConstraint[] | undefined {
  const raw = model.featureConfig.comboLimits;
  if (raw) return Object.entries(raw).flatMap(([key, limit]) => COMBINATIONS[key] ? [{
    combination: COMBINATIONS[key],
    ...(limit.max_images !== undefined ? { maxImages: limit.max_images } : {}),
    ...(limit.max_videos !== undefined ? { maxVideos: limit.max_videos } : {}),
    ...(limit.max_audios !== undefined ? { maxAudios: limit.max_audios } : {}),
  }] : []);
  return conventionalReference && model.supportReferenceToVideoSize > 0
    ? [{ combination: 'image', maxImages: model.supportReferenceToVideoSize }] : undefined;
}

function videoParameters(model: CanvasRegistryVideoSnapshotModel): readonly CanvasParameterDefinition[] | undefined {
  // §8 records explicit white lists. Draft naming never implies a draft-to-final switch.
  const bitrateIds = ['neo-video-2-0', 'neo-video-2-0-fast', 'doubao-seedance-2-0-mini-260615', 'doubao-seedance-2-5-260628'];
  const result: CanvasParameterDefinition[] = [];
  if (bitrateIds.includes(model.value)) result.push({ key: 'bitrateMode', type: 'string', values: ['standard', 'high'], defaultValue: model.value === 'doubao-seedance-2-5-260628' ? 'high' : 'standard' });
  if (model.value === 'doubao-seedance-2-5-260628') result.push({ key: 'outputFormat', type: 'string', values: ['mp4', 'mov'], defaultValue: 'mp4' });
  return result.length ? result : undefined;
}

function videoModes(model: CanvasRegistryVideoSnapshotModel): readonly CanvasModeCapability[] {
  const duration: CanvasDurationRule = { kind: 'range', ...model.durationRange, step: model.durationRange.step ?? 1, defaultSeconds: model.durationRange.min };
  // supportAudio=0 means no generateAudio field/control (§8), not a promise that the output is silent.
  const audio: CanvasAudioGenerationCapability = { mode: model.supportAudio === 2 ? 'required' : model.supportAudio === 1 ? 'optional' : 'unsupported', defaultEnabled: model.supportAudio === 2 };
  const parameters = videoParameters(model);
  const result: CanvasModeCapability[] = [];
  for (const generation of model.generationTypes) {
    const mode = GENERATION_MODES[generation.value];
    if (!mode) continue; // Flags do not invent an unlisted output mode or edit/extend route.
    const variants: CanvasOutputVariant[] = generation.resolutions.map(resolution => ({
      id: `${mode}:${resolution.value}`, resolution: resolution.value,
      aspectRatios: resolution.aspectRatios.map(aspect => aspect.value),
      defaultAspectRatio: resolution.aspectRatios[0]?.value,
    }));
    const references = mode === 'referenceToVideo';
    const referenceRules = references ? {
      image: referenceRule(model, 'image', true), video: referenceRule(model, 'video'), audio: referenceRule(model, 'audio'),
    } : undefined;
    const combinationConstraints = references ? combinations(model, true) : undefined;
    const frameImageRule = mode === 'imageToVideo' && (model.mediaConstraints?.image || model.featureConfig.extraLimits?.image_constraints)
      ? { ...referenceRule(model, 'image'), supported: true, maxCount: 1 } : undefined;
    const base: CanvasModeCapability = {
      mode, outputVariants: variants, defaultResolution: variants[0]?.resolution, duration, audioGeneration: audio,
      firstFrame: mode === 'imageToVideo', lastFrame: false,
      ...(frameImageRule ? { frameImageRule } : {}),
      ...(referenceRules ? { referenceRules } : {}),
      ...(combinationConstraints ? { combinationConstraints } : {}),
      ...(parameters ? { parameters } : {}),
    };
    result.push(base);
    if (mode === 'imageToVideo' && model.supportFirstLastFrame) {
      // §8's two-frame Kling exception is explicit and mode-local; single-frame still keeps all listed outputs.
      const frameVariants = model.provider === 'KLING' ? variants.filter(variant => variant.resolution.toLowerCase() === '1080p') : variants;
      result.push({ ...base, mode: 'firstLastFrame', firstFrame: true, lastFrame: true,
        ...(frameImageRule ? { frameImageRule: { ...frameImageRule, maxCount: 2 } } : {}),
        outputVariants: frameVariants.map(variant => ({ ...variant, id: `firstLastFrame:${variant.resolution}` })), defaultResolution: frameVariants[0]?.resolution });
    }
  }
  return result;
}

function videoRestrictions(model: CanvasRegistryVideoSnapshotModel): readonly CanvasRegistryRestriction[] {
  const extra = model.featureConfig.extraLimits;
  const output = extra?.output_constraints;
  const outputDuration = pair(output?.duration_range_s);
  const restrictions: CanvasRegistryRestriction[] = [];
  if (output) restrictions.push({ source: 'canvas-spec.md §22: featureConfig.extraLimits.output_constraints',
    description: 'Additional output constraints are retained independently; inconsistent snapshot fields require the route intersection to choose the narrower limits.',
    ...(outputDuration ? { outputDuration: { min: outputDuration[0], max: outputDuration[1] } } : {}),
    ...(output.resolutions ? { outputResolutions: output.resolutions } : {}) });
  if (extra?.request_constraints?.max_body_size_mb !== undefined) restrictions.push({ source: 'canvas-spec.md §22: featureConfig.extraLimits.request_constraints',
    description: 'Large input files use public URLs; the model has a request body size limit.', maxRequestBodyBytes: extra.request_constraints.max_body_size_mb * 1024 * 1024 });
  if (model.value.endsWith('-draft')) restrictions.push({ source: 'canvas-spec.md §9: draft exception', description: 'The draft-labelled model has supportDraft=false; no draft-to-final operation is granted.' });
  if (model.provider === 'KLING' && model.supportFirstLastFrame) restrictions.push({ source: 'canvas-spec.md §8: regular video two-frame exception', description: 'The firstLastFrame mode is limited to 1080p.' });
  if (model.value === 'wan3.0-video') restrictions.push({ source: 'canvas-spec.md §9: audio exception', description: 'Generated audio has no selectable control (supportAudio=0); audio upload and multimodal audio reference are separate metadata.' });
  return restrictions;
}

function buildVideo(model: CanvasRegistryVideoSnapshotModel, index: number): CanvasRegistryModel {
  const [id, displayName, vendor] = VIDEO_IDENTITIES[model.value];
  return { id, specId: model.value, displayName, vendor, kind: 'video', modes: videoModes(model), raw: model,
    sources: [`canvas-spec.md §22: videoModels[${index}]`, 'canvas-spec.md §8', 'canvas-spec.md §9'],
    audioUpload: model.supportAudioUpload, firstLastFrame: model.supportFirstLastFrame, draft: model.supportDraft,
    referenceRules: { image: referenceRule(model, 'image'), video: referenceRule(model, 'video'), audio: referenceRule(model, 'audio') },
    ...(combinations(model) ? { combinationConstraints: combinations(model) } : {}), restrictions: videoRestrictions(model) };
}

function buildImage(model: CanvasRegistryImageSnapshotModel): CanvasRegistryModel {
  const [id, displayName, vendor] = IMAGE_IDENTITIES[model.model_name];
  // §8: the first two strings are inclusive count bounds, not two selectable count values.
  const min = Number(model.image_count_options[0]), max = Number(model.image_count_options[1] ?? model.image_count_options[0]);
  const imageCountOptions = Array.from({ length: max - min + 1 }, (_, offset) => min + offset);
  const imageOptions: CanvasRegistryImageOptions = { sizes: model.supported_sizes, aspectRatios: model.supported_aspect_ratios,
    qualityLevels: model.quality, referenceImageLimit: model.max_reference_images, imageCountOptions, imageCountRange: { min, max },
    rawImageCountOptions: model.image_count_options, outputFormats: model.supported_output_formats, customAspectRatio: model.support_custom_aspect_ratio, seed: model.support_seed };
  const parameters: CanvasParameterDefinition[] = [{ key: 'imageCount', type: 'number', values: imageCountOptions, defaultValue: min }];
  if (model.quality?.length) parameters.push({ key: 'quality', type: 'string', values: model.quality, defaultValue: model.quality[0] });
  if (model.supported_output_formats?.length) parameters.push({ key: 'outputFormat', type: 'string', values: model.supported_output_formats, defaultValue: model.supported_output_formats[0] });
  const modes: CanvasModeCapability[] = [];
  for (const type of model.model_type.split(',')) {
    const mode = type === 'T2I' ? 'textToImage' : type === 'I2I' ? 'imageToImage' : undefined;
    if (!mode) continue;
    modes.push({ mode, outputVariants: model.supported_sizes.map(size => ({ id: `${mode}:${size}`, resolution: size, aspectRatios: model.supported_aspect_ratios, defaultAspectRatio: model.supported_aspect_ratios[0],
      ...(model.supported_output_formats ? { formats: model.supported_output_formats } : {}) })), defaultResolution: model.supported_sizes[0], parameters,
      firstFrame: false, lastFrame: false,
      ...(mode === 'imageToImage' ? { referenceRules: { image: { supported: model.max_reference_images > 0, maxCount: model.max_reference_images } },
        combinationConstraints: [{ combination: 'image' as const, maxImages: model.max_reference_images }] } : {}) });
  }
  const restrictions: CanvasRegistryRestriction[] = [];
  if (id === 'gpt-image-2' || id === 'gpt-image-2-official') restrictions.push({ source: 'canvas-spec.md §9: structured reference limits',
    description: 'The structured max_reference_images overrides contradictory prose: GPT Image 2 has 10; the Official snapshot variant has 16.' });
  return { id, specId: model.model_name, displayName, vendor, kind: 'image', modes, imageOptions, raw: model,
    sources: [`canvas-spec.md §22: imageModels(model_name=${model.model_name})`, 'canvas-spec.md §8', 'canvas-spec.md §9'], restrictions };
}

/** Deep freeze prevents one widget from widening the shared fixed menu for every caller. */
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

const REGISTRY: readonly CanvasRegistryModel[] = freeze([
  ...CANVAS_REGISTRY_SNAPSHOT.videoModels.map(buildVideo),
  ...CANVAS_REGISTRY_SNAPSHOT.imageModels.map(buildImage),
]);
const FAMILY_BY_ID = new Map(REGISTRY.map(family => [family.id, family]));
const FAMILY_BY_SPEC_ID = new Map(REGISTRY.map(family => [family.specId, family]));

/** Returns the spec order, including unavailable families; actual routes decide availability. */
export function listCanvasRegistryModels(kind?: CanvasRegistryKind): readonly CanvasRegistryModel[] {
  return kind ? REGISTRY.filter(family => family.kind === kind) : REGISTRY;
}

/** Exact family/spec identities and the explicit route alias table are the only accepted mappings. */
export function canvasRegistryFamily(modelId: string): CanvasRegistryModel | undefined {
  return FAMILY_BY_ID.get(modelId) ?? FAMILY_BY_SPEC_ID.get(modelId) ?? FAMILY_BY_ID.get(canvasRegistryFamilyId(modelId) ?? '');
}

export { CANVAS_REGISTRY_ALIASES, CANVAS_REGISTRY_NOT_IN_SPEC, listCanvasRegistryAliases } from './canvas-model-registry-aliases.js';
export { groupCanvasRegistryRoutes, chooseCanvasRegistryDefault, canvasRegistryRouteAvailability } from './canvas-model-registry-routes.js';
export type {
  CanvasRegistryRoute, CanvasRegistryRouteGroup, CanvasRegistryRouteChoice, CanvasRegistryAvailabilityReason,
  CanvasRegistryAvailability, CanvasRegistryDefault,
} from './canvas-model-registry-routes.js';
