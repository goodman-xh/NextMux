import type { CanvasGenerationMode, CanvasGenerationOptionDecision } from './canvas.js';
import { browserSha256 } from './browser-sha256.js';
export { browserSha256 } from './browser-sha256.js';

const CANVAS_CAPABILITY_DIGEST_TAG = 'canvas-capability-sha256-v1:';

/** Compact the exact final identity; the optional own-route prefix retains accepted-job checks. */
export function compactCanvasCapabilityVersion(rawVersion: string, ownConfiguredPrefix?: string): string {
  return `${ownConfiguredPrefix ? `${ownConfiguredPrefix}:` : ''}${CANVAS_CAPABILITY_DIGEST_TAG}${browserSha256(rawVersion)}`;
}

function canvasCapabilityVersionDigest(version: string): string | undefined {
  if (!version.includes(CANVAS_CAPABILITY_DIGEST_TAG)) return browserSha256(version);
  const match = /^(?:([\s\S]+):)?canvas-capability-sha256-v1:([0-9a-f]{64})$/.exec(version);
  return match && !match[1]?.includes(CANVAS_CAPABILITY_DIGEST_TAG) ? match[2] : undefined;
}

/** Only a complete tagged digest is a compact identity; malformed tags fail closed. */
export function isCompactCanvasCapabilityVersion(version: string): boolean {
  return version.includes(CANVAS_CAPABILITY_DIGEST_TAG) && canvasCapabilityVersionDigest(version) !== undefined;
}

/** Existing raw versions keep exact equality; a compact identity can match its original raw bytes. */
export function sameCanvasCapabilityVersion(left: string, right: string): boolean {
  if (!left.includes(CANVAS_CAPABILITY_DIGEST_TAG) && !right.includes(CANVAS_CAPABILITY_DIGEST_TAG)) return left === right;
  const leftDigest = canvasCapabilityVersionDigest(left);
  return leftDigest !== undefined && leftDigest === canvasCapabilityVersionDigest(right);
}

/** All durations in this module are seconds; asset metadata uses explicit durationMs. */
export type CanvasDurationRule =
  | { readonly kind: 'fixed'; readonly seconds: number }
  | { readonly kind: 'enum'; readonly seconds: readonly number[]; readonly defaultSeconds: number }
  | { readonly kind: 'range'; readonly min: number; readonly max: number; readonly step: number; readonly defaultSeconds: number };

export interface CanvasAudioGenerationCapability {
  readonly mode: 'unsupported' | 'optional' | 'required';
  readonly defaultEnabled: boolean;
}

export interface CanvasReferenceRule {
  readonly supported: boolean;
  readonly maxCount: number;
  readonly formats?: readonly string[];
  readonly maxBytes?: number;
  readonly minDurationSeconds?: number;
  readonly maxDurationSeconds?: number;
  readonly maxTotalDurationSeconds?: number;
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly minHeight?: number;
  readonly maxHeight?: number;
  readonly aspectRatios?: readonly string[];
  /** Continuous input aspect bounds, distinct from enumerated output ratios. */
  readonly minAspectRatio?: number;
  readonly maxAspectRatio?: number;
  readonly codecs?: readonly string[];
  readonly resolutions?: readonly string[];
  readonly minFrameRate?: number;
  readonly maxFrameRate?: number;
}

export type CanvasReferenceCombination = 'none' | 'image' | 'video' | 'audio' | 'image+video' | 'image+audio' | 'video+audio' | 'image+video+audio';

export interface CanvasCombinationConstraint {
  readonly combination: CanvasReferenceCombination;
  readonly maxImages?: number;
  readonly maxVideos?: number;
  readonly maxAudios?: number;
  readonly maxTotalBytes?: number;
  readonly maxTotalDurationSeconds?: number;
}

export interface CanvasParameterDefinition {
  readonly key: string;
  readonly type: 'boolean' | 'string' | 'number';
  readonly values?: readonly (string | number | boolean)[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly defaultValue?: string | number | boolean;
  readonly required?: boolean;
}

/** A complete request covered by the selected route's frozen public quote. */
export interface CanvasVideoRequestShape {
  readonly aspectRatio: string;
  readonly durationSeconds: number;
  readonly firstFrame: boolean;
  readonly lastFrame: boolean;
  readonly referenceImages: number;
  /** Actual request control, independent of a native soundtrack in the output. */
  readonly requestAudio: boolean;
  readonly width: number;
  readonly height: number;
}

export interface CanvasProvenVideoRequestShape extends CanvasVideoRequestShape {
  readonly resolution: string;
}

/** Compact public certificates; each rule grants only its named output/input tuple. */
export interface CanvasProvenVideoShapeGroups {
  readonly version: 1;
  readonly outputs: readonly {
    readonly resolution: string;
    readonly aspectRatio: string;
    readonly width: number;
    readonly height: number;
  }[];
  readonly durations: readonly number[];
  readonly rules: readonly ({
    readonly outputs: readonly number[];
    readonly firstFrame: boolean;
    readonly lastFrame: boolean;
    readonly requestAudio: boolean;
    readonly referenceCounts: readonly number[];
  } & ({ readonly minDurationSeconds: number; readonly durationSeconds?: never }
    | { readonly durationSeconds: readonly number[]; readonly minDurationSeconds?: never }))[];
}

export type CanvasVideoShapeProofDecodeResult =
  | { readonly shapes: readonly CanvasProvenVideoRequestShape[]; readonly error?: undefined }
  | { readonly shapes?: undefined; readonly error: 'missing' | 'empty' | 'invalid' | 'ambiguous' };

export interface CanvasDerivedAspectRatioRule {
  readonly inputRole: 'firstFrame' | 'referenceImage';
  readonly aspectRatios: readonly string[];
  readonly tolerance: number;
  readonly allowOmission: boolean;
}

export interface CanvasOutputVariant {
  readonly id: string;
  readonly resolution: string;
  /** Undefined means unknown, including when only another mode's ratios are known. */
  readonly aspectRatios?: readonly string[];
  readonly defaultAspectRatio?: string;
  readonly durationOverride?: CanvasDurationRule;
  readonly audioGenerationOverride?: CanvasAudioGenerationCapability;
  readonly formats?: readonly string[];
  /** Optional exact sizes; useful for an adapter that accepts dimensions rather than a resolution name. */
  readonly dimensions?: Readonly<Record<string, { readonly width: number; readonly height: number }>>;
  readonly derivedAspectRatio?: CanvasDerivedAspectRatioRule;
  /** Absence is unconstrained; an explicit empty list proves no request. */
  readonly requestShapes?: readonly CanvasVideoRequestShape[];
  readonly requestAudioOverride?: boolean;
}

export interface CanvasModeCapability {
  readonly mode: CanvasGenerationMode;
  readonly outputVariants?: readonly CanvasOutputVariant[];
  readonly defaultResolution?: string;
  readonly duration?: CanvasDurationRule;
  readonly audioGeneration?: CanvasAudioGenerationCapability;
  readonly firstFrame?: boolean;
  readonly lastFrame?: boolean;
  readonly frameImageRule?: CanvasReferenceRule;
  readonly referenceRules?: {
    readonly image?: CanvasReferenceRule;
    readonly video?: CanvasReferenceRule;
    readonly audio?: CanvasReferenceRule;
  };
  readonly audioDrivenVideo?: boolean;
  readonly preserveInputAudio?: boolean;
  /** Absence is unknown for a nonempty reference set. An explicit empty list supports no combinations. */
  readonly combinationConstraints?: readonly CanvasCombinationConstraint[];
  readonly parameters?: readonly CanvasParameterDefinition[];
}

export interface CanvasModelCapability {
  readonly id: string;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly displayName: string;
  readonly version: string;
  readonly status: 'available' | 'maintenance' | 'deprecated' | 'unknown';
  readonly modes: readonly CanvasModeCapability[];
  readonly defaultMode?: CanvasGenerationMode;
  readonly sources: readonly string[];
  readonly updatedAt?: string;
}

/** Structural evidence keeps comic-core independent of desktop and provider packages. */
export interface CanvasModelCapabilityEvidence {
  readonly id: string;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly displayName: string;
  readonly version: string;
  readonly status?: CanvasModelCapability['status'];
  readonly capabilities?: readonly string[];
  readonly mediaInput?: { readonly firstFrame?: boolean; readonly lastFrame?: boolean; readonly referenceImages?: boolean; readonly maxReferences?: number };
  readonly videoLimits?: { readonly durations?: readonly number[]; readonly aspectRatios?: readonly string[]; readonly resolutions?: readonly string[]; readonly frameImages?: readonly string[]; readonly provenShapes?: readonly CanvasProvenVideoRequestShape[]; readonly provenShapeGroups?: CanvasProvenVideoShapeGroups; readonly shapeQuoteId?: string; readonly inputImagePriceMicros?: number };
  readonly template?: { readonly kind: 'image' | 'video' | 'music'; readonly seconds: readonly number[]; readonly maxReferences: number; readonly images: string; readonly submit: { readonly body: string } };
  readonly videoProfile?: { readonly aspectRatios: readonly string[]; readonly durationsSeconds?: readonly number[] };
  readonly audioGeneration?: CanvasAudioGenerationCapability;
  /** Complete mode metadata from a verified adapter takes precedence over coarse discovery fields. */
  readonly modes?: readonly CanvasModeCapability[];
  readonly defaultMode?: CanvasGenerationMode;
  readonly sources?: readonly string[];
  readonly updatedAt?: string;
}

export interface CanvasCapabilityInput {
  readonly role: string;
  readonly kind?: 'image' | 'video' | 'audio' | 'text' | 'character';
  readonly versionId?: string;
  readonly edgeId?: string;
  readonly id?: string;
  readonly metadata?: {
    readonly mimeType?: string;
    readonly format?: string;
    readonly byteLength?: number;
    readonly durationMs?: number;
    readonly width?: number;
    readonly height?: number;
    readonly frameRate?: number;
    readonly codec?: string;
    readonly resolution?: string;
  };
}

export interface CanvasCapabilityIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly inputId?: string;
}

export interface ResolvedCanvasCapability {
  readonly model: CanvasModelCapability;
  readonly mode?: CanvasModeCapability;
  readonly variant?: CanvasOutputVariant;
  readonly duration?: CanvasDurationRule;
  readonly audioGeneration?: CanvasAudioGenerationCapability;
  readonly issues: readonly CanvasCapabilityIssue[];
}

const MODES: readonly CanvasGenerationMode[] = ['textToImage', 'imageToImage', 'textToVideo', 'imageToVideo', 'firstLastFrame', 'referenceToVideo', 'videoEdit', 'videoExtend'];
const VIDEO_MODES = new Set<CanvasGenerationMode>(['textToVideo', 'imageToVideo', 'firstLastFrame', 'referenceToVideo', 'videoEdit', 'videoExtend']);
const CAPABILITY_MODES: Readonly<Record<string, CanvasGenerationMode>> = {
  image_generation: 'textToImage', text_to_image: 'textToImage', image_to_image: 'imageToImage',
  text_to_video: 'textToVideo', image_to_video: 'imageToVideo', first_last_frame: 'firstLastFrame',
  reference_to_video: 'referenceToVideo', video_edit: 'videoEdit', video_extend: 'videoExtend'
};
const BASE_PARAMETERS = new Set(['resolution', 'aspectRatio', 'durationSeconds', 'generateAudio', 'preserveInputAudio']);

function issue(code: string, path: string, message: string, input?: CanvasCapabilityInput): CanvasCapabilityIssue {
  const inputId = input?.edgeId ?? input?.id ?? input?.versionId;
  return { code, path, message, ...(inputId ? { inputId } : {}) };
}

function numericAspectRatio(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d+:\d+$/u.test(value)) return undefined;
  const [width, height] = value.split(':').map(Number);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : undefined;
}

/** The queue's even-pixel rounding, shared by the panel guard and desktop compiler. */
export function canvasVideoOutputDimensions(resolution: string, ratio: string | number): { readonly width: number; readonly height: number } | undefined {
  const value = typeof ratio === 'number' ? ratio : numericAspectRatio(ratio);
  if (value === undefined || !Number.isFinite(value) || value <= 0 || typeof resolution !== 'string') return undefined;
  const square = /^(\d+)x(\d+)$/iu.exec(resolution);
  const short = /^(\d+)p$/iu.exec(resolution)?.[1];
  const pixels = short ? Number(short) : ({ '1k': 1080, '2k': 1440, '4k': 2160 } as Readonly<Record<string, number>>)[resolution.toLowerCase()];
  const size = square ? { width: Number(square[1]), height: Number(square[2]) } : pixels ? {
    width: Math.round((value >= 1 ? pixels * value : pixels) / 2) * 2,
    height: Math.round((value >= 1 ? pixels : pixels / value) / 2) * 2
  } : undefined;
  return size && [size.width, size.height].every(dimension => Number.isSafeInteger(dimension) && dimension >= 64 && dimension <= 4096) ? size : undefined;
}

export function isCanvasVideoRequestShape(value: unknown): value is CanvasVideoRequestShape {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const shape = value as Record<string, unknown>;
  return numericAspectRatio(shape.aspectRatio) !== undefined
    && typeof shape.durationSeconds === 'number' && Number.isSafeInteger(shape.durationSeconds) && shape.durationSeconds > 0 && shape.durationSeconds <= 300
    && typeof shape.firstFrame === 'boolean' && typeof shape.lastFrame === 'boolean' && (!shape.lastFrame || shape.firstFrame)
    && typeof shape.referenceImages === 'number' && Number.isSafeInteger(shape.referenceImages) && shape.referenceImages >= 0 && shape.referenceImages <= 4
    && typeof shape.requestAudio === 'boolean'
    && [shape.width, shape.height].every(dimension => typeof dimension === 'number' && Number.isSafeInteger(dimension) && dimension >= 64 && dimension <= 4096);
}

/** Decode both catalog generations through one bounded, fail-closed validator.
 * Quote binding is checked by the caller; this decoder never infers a tariff. */
export function decodeCanvasProvenVideoShapes(limits: {
  readonly provenShapes?: unknown;
  readonly provenShapeGroups?: unknown;
} | undefined): CanvasVideoShapeProofDecodeResult {
  const legacy = limits?.provenShapes, compact = limits?.provenShapeGroups;
  const invalid = (): CanvasVideoShapeProofDecodeResult => ({ error: 'invalid' });
  if (legacy !== undefined && compact !== undefined) return { error: 'ambiguous' };
  if (legacy === undefined && compact === undefined) return { error: 'missing' };
  const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  const fields = (value: Record<string, unknown>, allowed: readonly string[]): boolean => Object.keys(value).every(key => allowed.includes(key));
  const ascending = (value: unknown, minimum: number, maximum: number, allowEmpty = false): value is number[] => Array.isArray(value)
    && value.length <= maximum - minimum + 1 && (allowEmpty || value.length > 0)
    && Array.from(value).every((entry, index) => Number.isSafeInteger(entry) && entry >= minimum && entry <= maximum && (index === 0 || entry > value[index - 1]));
  const output = (value: unknown): value is CanvasProvenVideoShapeGroups['outputs'][number] => {
    if (!record(value) || !fields(value, ['resolution', 'aspectRatio', 'width', 'height'])
      || typeof value.resolution !== 'string' || value.resolution.length > 24
      || typeof value.aspectRatio !== 'string' || value.aspectRatio.length > 24) return false;
    const size = canvasVideoOutputDimensions(value.resolution, value.aspectRatio);
    return Boolean(size && size.width === value.width && size.height === value.height);
  };
  const shapes: CanvasProvenVideoRequestShape[] = [], seen = new Set<string>();
  const append = (shape: CanvasProvenVideoRequestShape): boolean => {
    const key = JSON.stringify([shape.resolution.toLowerCase(), shape.aspectRatio, shape.durationSeconds,
      shape.firstFrame, shape.lastFrame, shape.referenceImages, shape.requestAudio, shape.width, shape.height]);
    if (seen.has(key) || shapes.length >= 32_768) return false;
    seen.add(key);
    shapes.push(shape);
    return true;
  };
  if (legacy !== undefined) {
    if (!Array.isArray(legacy) || legacy.length > 32_768) return invalid();
    for (const row of legacy) {
      if (!record(row) || !fields(row, ['resolution', 'aspectRatio', 'durationSeconds', 'firstFrame', 'lastFrame', 'referenceImages', 'requestAudio', 'width', 'height'])
        || !isCanvasVideoRequestShape(row) || typeof row.resolution !== 'string') return invalid();
      const { aspectRatio, resolution, width, height } = row;
      if (!output({ aspectRatio, resolution, width, height }) || !append({ ...row, resolution })) return invalid();
    }
  } else {
    if (!record(compact) || !fields(compact, ['version', 'outputs', 'durations', 'rules']) || compact.version !== 1
      || !Array.isArray(compact.outputs) || compact.outputs.length > 63 || !Array.from(compact.outputs).every(output)
      || !ascending(compact.durations, 1, 300, true) || !Array.isArray(compact.rules) || compact.rules.length > 256) return invalid();
    try { if (new TextEncoder().encode(JSON.stringify(compact)).byteLength > 8192) return invalid(); }
    catch { return invalid(); }
    const outputs = compact.outputs as CanvasProvenVideoShapeGroups['outputs'];
    if (new Set(outputs.map(value => JSON.stringify([value.resolution.toLowerCase(), value.aspectRatio]))).size !== outputs.length) return invalid();
    const durations = compact.durations;
    for (const rule of compact.rules) {
      if (!record(rule) || !fields(rule, ['outputs', 'firstFrame', 'lastFrame', 'requestAudio', 'referenceCounts', 'minDurationSeconds', 'durationSeconds'])
        || !Array.isArray(rule.outputs) || !rule.outputs.length || rule.outputs.length > 63
        || Array.from(rule.outputs).some(index => !Number.isSafeInteger(index) || index < 0 || index >= outputs.length)
        || new Set(rule.outputs).size !== rule.outputs.length
        || typeof rule.firstFrame !== 'boolean' || typeof rule.lastFrame !== 'boolean' || rule.lastFrame && !rule.firstFrame
        || typeof rule.requestAudio !== 'boolean' || !ascending(rule.referenceCounts, 0, 4)
        || Object.hasOwn(rule, 'minDurationSeconds') === Object.hasOwn(rule, 'durationSeconds')) return invalid();
      let allowedDurations: readonly number[];
      if (Object.hasOwn(rule, 'minDurationSeconds')) {
        if (typeof rule.minDurationSeconds !== 'number' || !Number.isSafeInteger(rule.minDurationSeconds) || !durations.includes(rule.minDurationSeconds)) return invalid();
        allowedDurations = durations.filter(seconds => seconds >= (rule.minDurationSeconds as number));
      } else {
        if (!ascending(rule.durationSeconds, 1, 300) || rule.durationSeconds.some(seconds => !durations.includes(seconds))) return invalid();
        allowedDurations = rule.durationSeconds;
      }
      if (shapes.length + rule.outputs.length * rule.referenceCounts.length * allowedDurations.length > 32_768) return invalid();
      for (const index of rule.outputs) for (const durationSeconds of allowedDurations) for (const referenceImages of rule.referenceCounts) {
        if (!append({ ...outputs[index], durationSeconds, referenceImages, firstFrame: rule.firstFrame, lastFrame: rule.lastFrame, requestAudio: rule.requestAudio })) return invalid();
      }
    }
  }
  return shapes.length ? { shapes } : { error: 'empty' };
}

/** Resolve semantic auto from the carried image; never fall back to another input or crop it. */
export function resolveCanvasDerivedAspectRatio(rule: CanvasDerivedAspectRatioRule, inputs: readonly CanvasCapabilityInput[]): {
  readonly input?: CanvasCapabilityInput; readonly aspectRatio?: string; readonly measuredRatio?: number; readonly issues: readonly CanvasCapabilityIssue[];
} {
  if (!rule || !['firstFrame', 'referenceImage'].includes(rule.inputRole) || !Array.isArray(rule.aspectRatios)
    || rule.aspectRatios.some(ratio => numericAspectRatio(ratio) === undefined) || !Number.isFinite(rule.tolerance)
    || rule.tolerance < 0 || rule.tolerance > 0.02 || typeof rule.allowOmission !== 'boolean') {
    return { issues: [issue('CAPABILITY_INVALID', 'aspectRatio', 'The input-derived aspect constraint is invalid.')] };
  }
  const input = inputs.find(candidate => candidate.kind === 'image' && (rule.inputRole === 'firstFrame'
    ? candidate.role === 'firstFrame' : candidate.role === 'referenceImage' || candidate.role === 'character'));
  if (!input) return { issues: [issue('INPUT_REQUIRED', `inputs.${rule.inputRole}`, 'Following the input aspect requires the carried image.')] };
  const width = input.metadata?.width, height = input.metadata?.height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || Number(width) <= 0 || Number(height) <= 0) {
    const malformed = width !== undefined && (typeof width !== 'number' || !Number.isSafeInteger(width) || width <= 0)
      || height !== undefined && (typeof height !== 'number' || !Number.isSafeInteger(height) || height <= 0);
    return { input, issues: [issue(malformed ? 'INPUT_METADATA_INVALID' : 'INPUT_METADATA_UNKNOWN', `inputs.${rule.inputRole}.aspectRatio`, 'Following the input aspect requires measured positive image dimensions.', input)] };
  }
  const measuredRatio = Number(width) / Number(height);
  const nearest = rule.aspectRatios.map(aspectRatio => ({ aspectRatio, ratio: numericAspectRatio(aspectRatio)! }))
    .sort((left, right) => Math.abs(Math.log(left.ratio / measuredRatio)) - Math.abs(Math.log(right.ratio / measuredRatio)))[0];
  if (nearest && Math.abs(nearest.ratio / measuredRatio - 1) <= rule.tolerance) {
    return { input, aspectRatio: nearest.aspectRatio, measuredRatio: nearest.ratio, issues: [] };
  }
  return { input, measuredRatio, issues: rule.allowOmission ? [] : [issue('AUTO_ASPECT_RATIO_UNSUPPORTED', 'aspectRatio', 'The measured input aspect has no close ratio proven for this resolution and route.', input)] };
}

function durationFrom(values: readonly number[] | undefined): CanvasDurationRule | undefined {
  const seconds = [...new Set((values ?? []).filter(value => Number.isFinite(value) && value > 0))];
  return seconds.length === 1 ? { kind: 'fixed', seconds: seconds[0] } : seconds.length > 1 ? { kind: 'enum', seconds, defaultSeconds: seconds[0] } : undefined;
}

function literalTemplateVariants(body: string): CanvasOutputVariant[] | undefined {
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    parsed = value as Record<string, unknown>;
  } catch { return undefined; }
  const candidates = [parsed, parsed.parameters].filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value));
  for (const value of candidates) {
    const size = typeof value.size === 'string' ? /^(\d+)[x*](\d+)$/i.exec(value.size) : typeof value.image_size === 'string' ? /^(\d+)[x*](\d+)$/i.exec(value.image_size) : undefined;
    const width = size ? Number(size[1]) : typeof value.width === 'number' ? value.width : NaN;
    const height = size ? Number(size[2]) : typeof value.height === 'number' ? value.height : NaN;
    const rawAspect = value.aspect_ratio ?? value.aspectRatio;
    const aspect = typeof rawAspect === 'string' && /^(?:\d+:\d+|auto)$/.test(rawAspect) ? rawAspect : undefined;
    const rawResolution = value.resolution ?? (!size ? value.size : undefined);
    const resolution = typeof rawResolution === 'string' && /^(?:\d+p|\d+k)$/i.test(rawResolution) ? rawResolution : undefined;
    if (Number.isSafeInteger(width) && Number.isSafeInteger(height) && width >= 64 && height >= 64 && width <= 4096 && height <= 4096) {
      let across = width, down = height;
      while (down) { const remainder = across % down; across = down; down = remainder; }
      const reduced = `${width / across}:${height / across}`;
      if (aspect && aspect !== 'auto') {
        const [a, b] = aspect.split(':').map(Number);
        if (!(a > 0 && b > 0) || Math.abs(width / height - a / b) / (a / b) > 0.02) return undefined;
      }
      const ratio = aspect ?? reduced;
      const label = resolution ?? `${width}x${height}`;
      return [{ id: `template:${label}`, resolution: label, aspectRatios: [ratio], dimensions: { [ratio]: { width, height } } }];
    }
    if (resolution && aspect && aspect !== 'auto') return [{ id: `template:${resolution}`, resolution, aspectRatios: [aspect] }];
  }
  return undefined;
}

/** Consumes existing facts only. Names and provider aliases never grant a mode or a parameter. */
export function buildCanvasModelCapability(evidence: CanvasModelCapabilityEvidence): CanvasModelCapability {
  const declared = new Set<CanvasGenerationMode>();
  for (const flag of evidence.capabilities ?? []) if (CAPABILITY_MODES[flag]) declared.add(CAPABILITY_MODES[flag]);
  const template = evidence.template;
  const body = template?.submit.body ?? '';
  const imageDelivery = template && template.images !== 'none';
  const frameImages = evidence.videoLimits?.frameImages;
  const firstFrame = evidence.mediaInput?.firstFrame ?? (template ? Boolean(imageDelivery && /\{\{(first_frame|image|images|images_csv)\}\}/.test(body)) : frameImages?.length ? frameImages.includes('first_frame') : undefined);
  const lastFrame = evidence.mediaInput?.lastFrame ?? (template ? Boolean(imageDelivery && /\{\{last_frame\}\}/.test(body)) : frameImages?.length ? frameImages.includes('last_frame') : undefined);
  const referenceImages = evidence.mediaInput?.referenceImages ?? (template ? Boolean(imageDelivery && template.maxReferences > 0 && /\{\{(references|reference|images|references_csv|images_csv)\}\}/.test(body)) : undefined);
  if (template?.kind === 'image') {
    declared.add('textToImage');
    if (referenceImages) declared.add('imageToImage');
  }
  if (template?.kind === 'video') {
    declared.add('textToVideo');
    if (firstFrame) declared.add('imageToVideo');
    if (firstFrame && lastFrame) declared.add('firstLastFrame');
    if (referenceImages) declared.add('referenceToVideo');
  }
  const templateDuration = durationFrom(template?.seconds);
  const catalogDuration = durationFrom(evidence.videoLimits?.durations ?? evidence.videoProfile?.durationsSeconds);
  const limits = evidence.videoLimits;
  // A profile describes observed outputs, not per-resolution request combinations. It does not invent variants.
  const resolutions = limits?.resolutions;
  // Literal request fields are configured transport facts. Dynamic placeholders are deliberately unknown.
  const configuredVariants = template ? literalTemplateVariants(body) : undefined;
  const literalAudio = /"(?:generate_audio|with_audio|enable_audio|audio|sound)"\s*:\s*"?(?:true|on|1|yes)"?/i.test(body);
  const dynamicAudio = /\{\{(?:generate_audio|request_audio|audio)\}\}/u.test(body);
  const audio = evidence.audioGeneration ?? (template && !dynamicAudio ? { mode: literalAudio ? 'required' as const : 'unsupported' as const, defaultEnabled: literalAudio } : undefined);
  const maxReferences = evidence.mediaInput?.maxReferences ?? template?.maxReferences;
  const imageRule = referenceImages === false ? { supported: false, maxCount: 0 }
    : referenceImages === true && Number.isSafeInteger(maxReferences) && Number(maxReferences) > 0 ? { supported: true, maxCount: Number(maxReferences) } : undefined;
  const modes = evidence.modes ?? MODES.filter(mode => declared.has(mode)).map(mode => {
    const references = mode === 'imageToImage' || mode === 'referenceToVideo';
    // Flat model listings do not prove a cross product or another mode's frame/reference constraints.
    // A single text-mode resolution can use its single listing's ratios. Rich combinations need explicit modes.
    const variants = configuredVariants ?? (resolutions?.length ? resolutions.map(resolution => ({
      id: resolution, resolution,
      ...(mode === 'textToVideo' && resolutions.length === 1 && limits?.aspectRatios?.length ? { aspectRatios: [...limits.aspectRatios] } : {})
    })) : undefined);
    const duration = templateDuration ?? (mode === 'textToVideo' ? catalogDuration : undefined);
    return {
      mode,
      ...(VIDEO_MODES.has(mode) && duration ? { duration } : {}),
      ...(variants ? { outputVariants: variants } : {}),
      ...(VIDEO_MODES.has(mode) && audio ? { audioGeneration: audio } : {}),
      firstFrame: mode === 'imageToVideo' || mode === 'firstLastFrame' ? firstFrame : false,
      lastFrame: mode === 'firstLastFrame' ? lastFrame : false,
      ...(references && imageRule ? { referenceRules: { image: imageRule, video: { supported: false, maxCount: 0 }, audio: { supported: false, maxCount: 0 } } } : {}),
      ...(references && imageRule ? { combinationConstraints: imageRule.supported ? [{ combination: 'image' as const, maxImages: imageRule.maxCount }] : [] } : {}),
      ...(template && /\{\{negative_prompt\}\}/.test(body) ? { parameters: [{ key: 'negativePrompt', type: 'string' as const }] } : {}),
      ...(template ? { preserveInputAudio: false, audioDrivenVideo: false } : {})
    };
  });
  return {
    id: evidence.id, providerId: evidence.providerId, providerModelId: evidence.providerModelId,
    displayName: evidence.displayName, version: evidence.version, status: evidence.status ?? 'unknown',
    modes: structuredClone(modes), ...(evidence.defaultMode ? { defaultMode: evidence.defaultMode } : {}),
    sources: [...(evidence.sources ?? []), ...(template ? ['media-template'] : []), ...(limits ? ['platform-media-limits'] : []), ...(evidence.videoProfile ? ['video-profile'] : [])],
    ...(evidence.updatedAt ? { updatedAt: evidence.updatedAt } : {})
  };
}

function validDurationRule(rule: CanvasDurationRule): boolean {
  switch (rule.kind) {
    case 'fixed': return Number.isFinite(rule.seconds) && rule.seconds > 0;
    case 'enum': return rule.seconds.length > 0 && rule.seconds.every(value => Number.isFinite(value) && value > 0) && rule.seconds.includes(rule.defaultSeconds);
    case 'range': return Number.isFinite(rule.min) && Number.isFinite(rule.max) && Number.isFinite(rule.step) && rule.min > 0 && rule.max >= rule.min && rule.step > 0 && inRangeStep(rule.defaultSeconds, rule.min, rule.max, rule.step);
  }
}

function inRangeStep(value: number, min: number, max: number, step: number): boolean {
  if (!Number.isFinite(value) || value < min || value > max) return false;
  const quotient = (value - min) / step;
  return Math.abs(quotient - Math.round(quotient)) <= 1e-8;
}

export function isCanvasDurationValid(rule: CanvasDurationRule, seconds: unknown): boolean {
  if (typeof seconds !== 'number' || !validDurationRule(rule)) return false;
  switch (rule.kind) {
    case 'fixed': return seconds === rule.seconds;
    case 'enum': return rule.seconds.includes(seconds);
    case 'range': return inRangeStep(seconds, rule.min, rule.max, rule.step);
  }
}

/** Resolves model → mode → resolution before consulting dependent values. */
export function resolveCanvasCapability(model: CanvasModelCapability, selection: { readonly mode: CanvasGenerationMode; readonly resolution?: string }): ResolvedCanvasCapability {
  const issues: CanvasCapabilityIssue[] = [];
  if (model.status !== 'available') issues.push(issue('MODEL_UNAVAILABLE', 'modelId', `Model ${model.id} is ${model.status}.`));
  if (!model.version.trim()) issues.push(issue('CAPABILITY_UNKNOWN', 'capabilityVersion', 'The capability version is unknown.'));
  const mode = model.modes.find(candidate => candidate.mode === selection.mode);
  if (!mode) issues.push(issue('MODE_UNSUPPORTED', 'mode', `Model ${model.id} does not declare ${selection.mode}.`));
  if (model.modes.filter(candidate => candidate.mode === selection.mode).length > 1) issues.push(issue('CAPABILITY_INVALID', 'mode', 'The catalog declares this mode more than once.'));
  if (mode && !mode.outputVariants?.length) issues.push(issue('CAPABILITY_UNKNOWN', 'resolution', 'Output resolutions are unknown for this mode.'));
  // An unset resolution means the mode's declared default, or its only output; anything else must be chosen.
  const resolution = selection.resolution ?? mode?.defaultResolution ?? (mode?.outputVariants?.length === 1 ? mode.outputVariants[0].resolution : undefined);
  const variant = mode?.outputVariants?.find(candidate => candidate.resolution === resolution);
  if ((mode?.outputVariants?.filter(candidate => candidate.resolution === resolution).length ?? 0) > 1) issues.push(issue('CAPABILITY_INVALID', 'resolution', 'The catalog declares this resolution more than once in the selected mode.'));
  if (mode?.outputVariants?.length && !variant) issues.push(issue('RESOLUTION_INVALID', 'resolution', `Resolution ${resolution ?? '(unset)'} is not supported in this mode.`));
  if (variant && !variant.aspectRatios?.length) issues.push(issue('CAPABILITY_UNKNOWN', 'aspectRatio', 'Aspect ratios are unknown for this resolution.'));
  const duration = variant?.durationOverride ?? mode?.duration;
  if (mode && VIDEO_MODES.has(mode.mode) && (!duration || !validDurationRule(duration))) issues.push(issue('CAPABILITY_UNKNOWN', 'durationSeconds', 'The duration rule is missing or invalid.'));
  const audioGeneration = variant?.audioGenerationOverride ?? mode?.audioGeneration;
  if (mode && VIDEO_MODES.has(mode.mode) && !audioGeneration) issues.push(issue('CAPABILITY_UNKNOWN', 'generateAudio', 'Audio generation behavior is unknown.'));
  if (audioGeneration && (!['unsupported', 'optional', 'required'].includes(audioGeneration.mode) || typeof audioGeneration.defaultEnabled !== 'boolean' || audioGeneration.mode === 'required' && !audioGeneration.defaultEnabled || audioGeneration.mode === 'unsupported' && audioGeneration.defaultEnabled)) {
    issues.push(issue('CAPABILITY_INVALID', 'generateAudio', 'The audio default conflicts with its capability mode.'));
  }
  return { model, ...(mode ? { mode } : {}), ...(variant ? { variant } : {}), ...(duration ? { duration } : {}), ...(audioGeneration ? { audioGeneration } : {}), issues };
}

/** Narrows editor choices to complete route proofs for the actual references. It never grants a new request shape. */
export function resolveCanvasGenerationOptions(model: CanvasModelCapability, modeName: CanvasGenerationMode, parameters: Readonly<Record<string, unknown>>, inputs: readonly CanvasCapabilityInput[] = []): ResolvedCanvasCapability {
  const resolved = resolveCanvasCapability(model, { mode: modeName, ...(typeof parameters.resolution === 'string' ? { resolution: parameters.resolution } : {}) });
  const { variant, duration, audioGeneration } = resolved;
  if (!VIDEO_MODES.has(modeName) || !variant || variant.requestShapes === undefined || !Array.isArray(variant.requestShapes)
    || !variant.requestShapes.every(isCanvasVideoRequestShape) || !duration || !validDurationRule(duration) || !audioGeneration) return resolved;
  const firstFrame = inputs.some(input => input.role === 'firstFrame');
  const lastFrame = inputs.some(input => input.role === 'lastFrame');
  const referenceImages = inputs.filter(input => input.kind === 'image' && (input.role === 'referenceImage' || input.role === 'character')).length;
  const fixedAudio = variant.requestAudioOverride ?? (audioGeneration.mode === 'required' ? true : audioGeneration.mode === 'unsupported' ? false : undefined);
  const shapes = variant.requestShapes.filter(shape => shape.firstFrame === firstFrame && shape.lastFrame === lastFrame
    && shape.referenceImages === referenceImages && isCanvasDurationValid(duration, shape.durationSeconds)
    && (fixedAudio === undefined || shape.requestAudio === fixedAudio)
    && (() => { const dimensions = variant.dimensions?.[shape.aspectRatio] ?? canvasVideoOutputDimensions(variant.resolution, shape.aspectRatio);
      return dimensions?.width === shape.width && dimensions.height === shape.height; })());
  const derived = variant.derivedAspectRatio ? resolveCanvasDerivedAspectRatio(variant.derivedAspectRatio, inputs).aspectRatio : undefined;
  const aspectOf = (value: string): string | undefined => value === 'auto' ? derived : value;
  const aspectRatios = (variant.aspectRatios ?? []).filter(aspect => shapes.some(shape => shape.aspectRatio === aspectOf(aspect)));
  const aspect = aspectRatios.includes(String(parameters.aspectRatio)) ? String(parameters.aspectRatio)
    : aspectRatios.includes(variant.defaultAspectRatio ?? '') ? variant.defaultAspectRatio : aspectRatios[0];
  const atAspect = shapes.filter(shape => shape.aspectRatio === (aspect ? aspectOf(aspect) : undefined));
  const seconds = [...new Set(atAspect.map(shape => shape.durationSeconds))].sort((a,b) => a-b);
  const requestedDefault = duration.kind === 'fixed' ? duration.seconds : duration.defaultSeconds;
  const defaultSeconds = seconds.includes(requestedDefault) ? requestedDefault : seconds[0] ?? requestedDefault;
  const selectedSeconds = typeof parameters.durationSeconds === 'number' && seconds.includes(parameters.durationSeconds) ? parameters.durationSeconds : defaultSeconds;
  const audioValues = new Set(atAspect.filter(shape => shape.durationSeconds === selectedSeconds).map(shape => shape.requestAudio));
  const audio = variant.requestAudioOverride !== undefined || audioValues.size !== 1 ? audioGeneration
    : audioValues.has(true) ? {mode:'required' as const,defaultEnabled:true} : {mode:'unsupported' as const,defaultEnabled:false};
  return { ...resolved, variant: { ...variant, aspectRatios },
    duration: duration.kind === 'fixed' && seconds.length === 1 ? duration : {kind:'enum',seconds,defaultSeconds}, audioGeneration: audio };
}

function referenceKind(input: CanvasCapabilityInput): 'image' | 'video' | 'audio' | undefined {
  if (input.role === 'referenceImage' || input.role === 'character' && input.kind === 'image') return 'image';
  if (input.role === 'referenceVideo') return 'video';
  if (input.role === 'referenceAudio') return 'audio';
  return undefined;
}

/** Exact nonempty signatures include audio-only/video-only; no fallback combination. */
export function canvasReferenceCombination(inputs: readonly CanvasCapabilityInput[]): CanvasReferenceCombination {
  const kinds = new Set(inputs.map(referenceKind).filter(Boolean));
  return (['image', 'video', 'audio'].filter(kind => kinds.has(kind as 'image' | 'video' | 'audio')).join('+') || 'none') as CanvasReferenceCombination;
}

function validParameter(definition: CanvasParameterDefinition, value: unknown): boolean {
  if (typeof value !== definition.type) return false;
  if (definition.values && !definition.values.includes(value as string | number | boolean)) return false;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || definition.min !== undefined && value < definition.min || definition.max !== undefined && value > definition.max) return false;
    if (definition.step !== undefined && (!(definition.step > 0) || !inRangeStep(value, definition.min ?? 0, definition.max ?? Number.MAX_VALUE, definition.step))) return false;
  }
  return true;
}

function inputMetadataIssues(input: CanvasCapabilityInput, rule: CanvasReferenceRule, path: string): CanvasCapabilityIssue[] {
  const issues: CanvasCapabilityIssue[] = [];
  const metadata = input.metadata;
  function check(field: string, value: number | undefined, min: number | undefined, max: number | undefined): void {
    if (min === undefined && max === undefined) return;
    if (value === undefined || !Number.isFinite(value)) issues.push(issue('INPUT_METADATA_UNKNOWN', `${path}.${field}`, `Cannot verify the input's ${field}.`, input));
    else if (min !== undefined && value < min || max !== undefined && value > max) issues.push(issue('INPUT_LIMIT_EXCEEDED', `${path}.${field}`, `The input's ${field} violates this model's limit.`, input));
  }
  check('byteLength', metadata?.byteLength, undefined, rule.maxBytes);
  check('durationSeconds', metadata?.durationMs === undefined ? undefined : metadata.durationMs / 1000, rule.minDurationSeconds, rule.maxDurationSeconds);
  check('width', metadata?.width, rule.minWidth, rule.maxWidth);
  check('height', metadata?.height, rule.minHeight, rule.maxHeight);
  check('frameRate', metadata?.frameRate, rule.minFrameRate, rule.maxFrameRate);
  if (rule.minAspectRatio !== undefined || rule.maxAspectRatio !== undefined) {
    check('aspectRatio', metadata?.width && metadata?.height ? metadata.width / metadata.height : undefined, rule.minAspectRatio, rule.maxAspectRatio);
  }
  for (const key of ['codec', 'resolution'] as const) {
    const allowed = key === 'codec' ? rule.codecs : rule.resolutions;
    if (!allowed?.length) continue;
    const value = metadata?.[key];
    if (value === undefined || value === '') issues.push(issue('INPUT_METADATA_UNKNOWN', `${path}.${key}`, `The input ${key} is unknown.`, input));
    else if (typeof value !== 'string') issues.push(issue('INPUT_METADATA_INVALID', `${path}.${key}`, `The input ${key} must be a string.`, input));
    else if (!allowed.some(entry => entry.toLowerCase() === value.toLowerCase())) issues.push(issue('INPUT_FORMAT_INVALID', `${path}.${key}`, `The input ${key} is unsupported.`, input));
  }
  if (rule.formats?.length) {
    const format = metadata?.format?.toLowerCase() ?? metadata?.mimeType?.split('/')[1]?.toLowerCase();
    const aliases: Readonly<Record<string, string>> = { jpeg: 'jpg', 'x-wav': 'wav', mpeg: 'mp3', quicktime: 'mov' };
    if (!format) issues.push(issue('INPUT_METADATA_UNKNOWN', `${path}.format`, 'The input format is unknown.', input));
    else if (!rule.formats.some(allowed => (aliases[allowed.toLowerCase()] ?? allowed.toLowerCase()) === (aliases[format] ?? format))) issues.push(issue('INPUT_FORMAT_INVALID', `${path}.format`, `Format ${format} is not supported.`, input));
  }
  if (rule.aspectRatios?.length) {
    if (!(metadata?.width && metadata?.height)) issues.push(issue('INPUT_METADATA_UNKNOWN', `${path}.aspectRatio`, 'The input dimensions are unknown.', input));
    else if (!rule.aspectRatios.some(ratio => {
      const [width, height] = ratio.split(':').map(Number);
      return width > 0 && height > 0 && Math.abs(metadata.width! / metadata.height! - width / height) / (width / height) <= 0.02;
    })) issues.push(issue('INPUT_ASPECT_INVALID', `${path}.aspectRatio`, 'The input aspect ratio is not supported.', input));
  }
  return issues;
}

/** Submission guard: validate the final parameters and every retained reference. It never truncates inputs. */
export function validateCanvasGenerationParameters(model: CanvasModelCapability, modeName: CanvasGenerationMode, parameters: Readonly<Record<string, unknown>>, inputs: readonly CanvasCapabilityInput[] = []): CanvasCapabilityIssue[] {
  const resolved = resolveCanvasCapability(model, { mode: modeName, resolution: typeof parameters.resolution === 'string' ? parameters.resolution : undefined });
  const issues = [...resolved.issues];
  const { mode, variant, duration, audioGeneration } = resolved;
  if (!mode) return issues;
  if (variant?.aspectRatios?.length && !variant.aspectRatios.includes(String(parameters.aspectRatio ?? ''))) issues.push(issue('ASPECT_RATIO_INVALID', 'aspectRatio', `Aspect ratio ${parameters.aspectRatio ?? '(unset)'} is unsupported at this resolution.`));
  let transportAspect = typeof parameters.aspectRatio === 'string' ? parameters.aspectRatio : undefined;
  if (VIDEO_MODES.has(modeName) && transportAspect === 'auto' && variant?.derivedAspectRatio) {
    const derived = resolveCanvasDerivedAspectRatio(variant.derivedAspectRatio, inputs);
    issues.push(...derived.issues);
    transportAspect = derived.aspectRatio;
  } else if (VIDEO_MODES.has(modeName) && transportAspect === 'auto' && variant?.requestShapes !== undefined) {
    issues.push(issue('CAPABILITY_UNKNOWN', 'aspectRatio', 'The proven request lacks an input-derived aspect constraint.'));
    transportAspect = undefined;
  }
  const exactDimensions = variant?.dimensions?.[String(parameters.aspectRatio ?? '')];
  if (exactDimensions) for (const key of ['width', 'height'] as const) if (parameters[key] !== undefined && parameters[key] !== exactDimensions[key]) issues.push(issue('DIMENSIONS_INVALID', key, `${key} must be ${exactDimensions[key]} for this output variant.`));
  if (VIDEO_MODES.has(modeName) && duration && !isCanvasDurationValid(duration, parameters.durationSeconds)) issues.push(issue('DURATION_INVALID', 'durationSeconds', 'Duration must match the fixed, enum or stepped range rule.'));
  if (!VIDEO_MODES.has(modeName) && parameters.durationSeconds !== undefined) issues.push(issue('PARAMETER_UNSUPPORTED', 'durationSeconds', 'Image generation does not accept a video duration.'));
  if (VIDEO_MODES.has(modeName) && audioGeneration) {
    if (parameters.generateAudio !== undefined && typeof parameters.generateAudio !== 'boolean') issues.push(issue('AUDIO_INVALID', 'generateAudio', 'generateAudio must be boolean.'));
    else if (audioGeneration.mode === 'unsupported' && parameters.generateAudio === true || audioGeneration.mode === 'required' && parameters.generateAudio === false) issues.push(issue('AUDIO_INVALID', 'generateAudio', `Audio generation is ${audioGeneration.mode}.`));
  } else if (!VIDEO_MODES.has(modeName) && parameters.generateAudio !== undefined) issues.push(issue('PARAMETER_UNSUPPORTED', 'generateAudio', 'Image generation does not accept generated audio.'));
  if (VIDEO_MODES.has(modeName) && variant?.requestShapes !== undefined) {
    if (!Array.isArray(variant.requestShapes) || !variant.requestShapes.every(isCanvasVideoRequestShape)
      || variant.requestAudioOverride !== undefined && typeof variant.requestAudioOverride !== 'boolean') {
      issues.push(issue('CAPABILITY_INVALID', 'inputs.shape', 'The route request-shape proof is invalid.'));
    } else if (transportAspect) {
      const dimensions = variant.dimensions?.[transportAspect] ?? canvasVideoOutputDimensions(variant.resolution, transportAspect);
      const requestAudio = variant.requestAudioOverride ?? (typeof parameters.generateAudio === 'boolean' ? parameters.generateAudio : audioGeneration?.defaultEnabled);
      const firstFrame = inputs.some(input => input.role === 'firstFrame');
      const lastFrame = inputs.some(input => input.role === 'lastFrame');
      const referenceImages = inputs.filter(input => input.kind === 'image' && (input.role === 'referenceImage' || input.role === 'character')).length;
      if (!dimensions || !variant.requestShapes.some(shape => shape.aspectRatio === transportAspect && shape.durationSeconds === parameters.durationSeconds
        && shape.firstFrame === firstFrame && shape.lastFrame === lastFrame && shape.referenceImages === referenceImages && shape.requestAudio === requestAudio
        && shape.width === dimensions.width && shape.height === dimensions.height)) {
        issues.push(issue('VIDEO_REQUEST_SHAPE_UNPROVEN', 'inputs.shape', 'This resolution, aspect, duration, frame count, reference count and audio request have no complete proof under the selected route quote.'));
      }
      if (dimensions) for (const key of ['width', 'height'] as const) if (parameters[key] !== undefined && parameters[key] !== dimensions[key]) {
        issues.push(issue('DIMENSIONS_INVALID', key, `${key} must be ${dimensions[key]} for this proven request.`));
      }
    }
  }
  if (parameters.preserveInputAudio !== undefined && typeof parameters.preserveInputAudio !== 'boolean') issues.push(issue('AUDIO_INVALID', 'preserveInputAudio', 'preserveInputAudio must be boolean.'));
  if (parameters.preserveInputAudio === true && (!(modeName === 'videoEdit' || modeName === 'videoExtend') || mode.preserveInputAudio !== true)) issues.push(issue(mode.preserveInputAudio === undefined ? 'CAPABILITY_UNKNOWN' : 'AUDIO_UNSUPPORTED', 'preserveInputAudio', 'Preserving original audio is not declared for this mode.'));
  const definitions = new Map((mode.parameters ?? []).map(definition => [definition.key, definition]));
  for (const [key, value] of Object.entries(parameters)) {
    if (BASE_PARAMETERS.has(key)) continue;
    const definition = definitions.get(key);
    if (!definition) issues.push(issue('PARAMETER_UNSUPPORTED', key, `Parameter ${key} is not declared by this adapter.`));
    else if (!validParameter(definition, value)) issues.push(issue('PARAMETER_INVALID', key, `Parameter ${key} violates its definition.`));
  }
  for (const definition of definitions.values()) if (definition.required && parameters[definition.key] === undefined && definition.defaultValue === undefined) issues.push(issue('PARAMETER_REQUIRED', definition.key, `Parameter ${definition.key} is required.`));

  const requiredRoles: Partial<Record<CanvasGenerationMode, readonly string[]>> = { imageToImage: ['referenceImage'], imageToVideo: ['firstFrame'], firstLastFrame: ['firstFrame', 'lastFrame'], videoEdit: ['referenceVideo'], videoExtend: ['referenceVideo'] };
  for (const role of requiredRoles[modeName] ?? []) if (!inputs.some(input => input.role === role || role === 'referenceImage' && input.role === 'character' && input.kind === 'image')) issues.push(issue('INPUT_REQUIRED', `inputs.${role}`, `${modeName} requires ${role}.`));
  if (modeName === 'referenceToVideo' && canvasReferenceCombination(inputs) === 'none') issues.push(issue('INPUT_REQUIRED', 'inputs.references', 'Reference generation requires at least one reference.'));
  for (const role of ['firstFrame', 'lastFrame'] as const) {
    const frames = inputs.filter(input => input.role === role);
    if (frames.length > 1) issues.push(issue('INPUT_COUNT_EXCEEDED', `inputs.${role}`, 'A frame input accepts one image.'));
    if (frames.length && mode[role] !== true) issues.push(issue(mode[role] === undefined ? 'CAPABILITY_UNKNOWN' : 'INPUT_ROLE_UNSUPPORTED', `inputs.${role}`, `${role} is not supported in this mode.`, frames[0]));
    if (mode.frameImageRule) frames.forEach((input, index) => issues.push(...inputMetadataIssues(input, mode.frameImageRule!, `inputs.${role}.${index}`)));
  }
  const allowedReferenceModes = new Set<CanvasGenerationMode>(['imageToImage', 'referenceToVideo', 'videoEdit', 'videoExtend']);
  const references = inputs.filter(input => referenceKind(input));
  for (const input of inputs) {
    const expected = input.role === 'firstFrame' || input.role === 'lastFrame' ? 'image' : input.role === 'prompt' ? 'text' : referenceKind(input);
    if (expected && input.kind && input.kind !== expected && !(input.role === 'character' && input.kind === 'character')) issues.push(issue('INPUT_KIND_INVALID', `inputs.${input.role}`, `This role requires ${expected}, not ${input.kind}.`, input));
    if (!['prompt', 'firstFrame', 'lastFrame', 'referenceImage', 'referenceVideo', 'referenceAudio', 'character'].includes(input.role)) issues.push(issue('INPUT_ROLE_UNSUPPORTED', `inputs.${input.role}`, 'This input role cannot be used for generation.', input));
    for (const [key, value] of Object.entries(input.metadata ?? {})) if (['byteLength', 'durationMs', 'width', 'height', 'frameRate'].includes(key) && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || key !== 'byteLength' && value === 0)) issues.push(issue('INPUT_METADATA_INVALID', `inputs.${input.role}.${key}`, `The input's ${key} must be a valid positive value.`, input));
  }
  for (const input of references) {
    const frameAudio = input.role === 'referenceAudio' && (modeName === 'imageToVideo' || modeName === 'firstLastFrame');
    const declaredImage = referenceKind(input) === 'image' && mode.referenceRules?.image?.supported === true;
    if (!allowedReferenceModes.has(modeName) && !frameAudio && !declaredImage) issues.push(issue('INPUT_ROLE_UNSUPPORTED', `inputs.${input.role}`, 'This mode does not accept reference inputs.', input));
  }
  for (const kind of ['image', 'video', 'audio'] as const) {
    const selected = references.filter(input => referenceKind(input) === kind);
    if (!selected.length) continue;
    const rule = mode.referenceRules?.[kind];
    if (!rule) { issues.push(issue('CAPABILITY_UNKNOWN', `inputs.reference${kind}`, `Reference ${kind} limits are unknown.`, selected[0])); continue; }
    if (!rule.supported) { for (const input of selected) issues.push(issue('INPUT_ROLE_UNSUPPORTED', `inputs.${input.role}`, `Reference ${kind} is unsupported.`, input)); continue; }
    if (!Number.isSafeInteger(rule.maxCount) || rule.maxCount < 1) issues.push(issue('CAPABILITY_INVALID', `inputs.reference${kind}`, `Reference ${kind} count limit is invalid.`));
    else if (selected.length > rule.maxCount) issues.push(issue('INPUT_COUNT_EXCEEDED', `inputs.reference${kind}`, `At most ${rule.maxCount} ${kind} references are allowed; received ${selected.length}.`));
    selected.forEach((input, index) => issues.push(...inputMetadataIssues(input, rule, `inputs.reference${kind}.${index}`)));
    if (rule.maxTotalDurationSeconds !== undefined) {
      if (selected.some(input => input.metadata?.durationMs === undefined)) issues.push(issue('INPUT_METADATA_UNKNOWN', `inputs.reference${kind}.totalDurationSeconds`, 'The total reference duration cannot be verified.'));
      else if (selected.reduce((sum, input) => sum + input.metadata!.durationMs! / 1000, 0) > rule.maxTotalDurationSeconds) issues.push(issue('INPUT_LIMIT_EXCEEDED', `inputs.reference${kind}.totalDurationSeconds`, 'The total reference duration exceeds the limit.'));
    }
  }
  const combination = canvasReferenceCombination(inputs);
  if (combination !== 'none') {
    const constraint = mode.combinationConstraints?.find(candidate => candidate.combination === combination);
    if (!constraint) issues.push(issue(mode.combinationConstraints === undefined ? 'CAPABILITY_UNKNOWN' : 'INPUT_COMBINATION_UNSUPPORTED', 'inputs.combination', `Reference combination ${combination} is not declared.`));
    else {
      for (const [kind, max] of [['image', constraint.maxImages], ['video', constraint.maxVideos], ['audio', constraint.maxAudios]] as const) if (max !== undefined && references.filter(input => referenceKind(input) === kind).length > max) issues.push(issue('INPUT_COUNT_EXCEEDED', `inputs.combination.${kind}`, `The ${combination} combination allows at most ${max} ${kind} references.`));
      for (const [key, metadataKey, scale, max] of [['totalBytes', 'byteLength', 1, constraint.maxTotalBytes], ['totalDurationSeconds', 'durationMs', 1000, constraint.maxTotalDurationSeconds]] as const) {
        if (max === undefined) continue;
        const applicable = metadataKey === 'durationMs' ? references.filter(input => referenceKind(input) !== 'image') : references;
        if (applicable.some(input => input.metadata?.[metadataKey] === undefined)) issues.push(issue('INPUT_METADATA_UNKNOWN', `inputs.${key}`, `Cannot verify reference ${key}.`));
        else if (applicable.reduce((sum, input) => sum + Number(input.metadata?.[metadataKey]) / scale, 0) > max) issues.push(issue('INPUT_LIMIT_EXCEEDED', `inputs.${key}`, `Reference ${key} exceeds this combination's limit.`));
      }
    }
  }
  return issues;
}

/** Keeps legal values on a model switch and reports every fallback. References are returned intact. */
export function reconcileCanvasGenerationParameters(model: CanvasModelCapability, requestedMode: CanvasGenerationMode, original: Readonly<Record<string, unknown>>, inputs: readonly CanvasCapabilityInput[] = [], preferences: { readonly aspectRatio?: string } = {}): { readonly mode: CanvasGenerationMode; readonly parameters: Readonly<Record<string, unknown>>; readonly inputs: readonly CanvasCapabilityInput[]; readonly notices: readonly CanvasCapabilityIssue[]; readonly issues: readonly CanvasCapabilityIssue[]; readonly optionDecision: CanvasGenerationOptionDecision } {
  const notices: CanvasCapabilityIssue[] = [];
  const modeName = model.modes.some(candidate => candidate.mode === requestedMode) ? requestedMode : model.defaultMode ?? model.modes[0]?.mode ?? requestedMode;
  if (modeName !== requestedMode) notices.push(issue('MODE_RESET', 'mode', `Mode changed from ${requestedMode} to ${modeName}.`));
  const mode = model.modes.find(candidate => candidate.mode === modeName);
  const parameters: Record<string, unknown> = { ...original };
  function replace(key: string, value: unknown): void {
    if (parameters[key] === value) return;
    notices.push(issue('PARAMETER_RESET', key, `${key} changed from ${String(parameters[key] ?? '(unset)')} to ${String(value ?? '(unset)')}.`));
    if (value === undefined) delete parameters[key]; else parameters[key] = value;
  }
  if (mode) {
    if (mode.outputVariants?.length && !mode.outputVariants.some(variant => variant.resolution === parameters.resolution)) replace('resolution', mode.outputVariants.find(variant => variant.resolution === mode.defaultResolution)?.resolution ?? mode.outputVariants[0].resolution);
    let resolved = resolveCanvasGenerationOptions(model, modeName, parameters, inputs);
    const variant = resolved.variant;
    if (variant?.aspectRatios?.length && !variant.aspectRatios.includes(String(parameters.aspectRatio ?? ''))) {
      const preferred = preferences.aspectRatio && variant.aspectRatios.includes(preferences.aspectRatio) ? preferences.aspectRatio
        : preferences.aspectRatio && variant.aspectRatios.includes('auto') ? 'auto' : undefined;
      replace('aspectRatio', preferred ?? (variant.aspectRatios.includes(variant.defaultAspectRatio ?? '') ? variant.defaultAspectRatio : variant.aspectRatios[0]));
    }
    // A project preference can select another proven aspect, with its own duration and audio intersection.
    resolved = resolveCanvasGenerationOptions(model, modeName, parameters, inputs);
    if (VIDEO_MODES.has(modeName)) {
      if (resolved.duration && validDurationRule(resolved.duration) && !isCanvasDurationValid(resolved.duration, parameters.durationSeconds)) replace('durationSeconds', resolved.duration.kind === 'fixed' ? resolved.duration.seconds : resolved.duration.defaultSeconds);
      if (resolved.audioGeneration) {
        const audio = resolved.audioGeneration;
        if (audio.mode === 'unsupported') replace('generateAudio', false);
        else if (audio.mode === 'required') replace('generateAudio', true);
        else if (typeof parameters.generateAudio !== 'boolean') replace('generateAudio', audio.defaultEnabled);
      }
    } else { replace('durationSeconds', undefined); replace('generateAudio', undefined); }
    if (parameters.preserveInputAudio !== undefined && (!(modeName === 'videoEdit' || modeName === 'videoExtend') || mode.preserveInputAudio === false)) replace('preserveInputAudio', false);
    const definitions = new Map((mode.parameters ?? []).map(definition => [definition.key, definition]));
    for (const key of Object.keys(parameters)) {
      if (BASE_PARAMETERS.has(key)) continue;
      const definition = definitions.get(key);
      if (!definition) replace(key, undefined);
      else if (!validParameter(definition, parameters[key])) replace(key, definition.defaultValue);
    }
    for (const definition of definitions.values()) if (parameters[definition.key] === undefined && definition.defaultValue !== undefined) replace(definition.key, definition.defaultValue);
  }
  const issues = validateCanvasGenerationParameters(model, modeName, parameters, inputs);
  notices.push(...issues.filter(candidate => candidate.path.startsWith('inputs.')));
  const optionDecision: CanvasGenerationOptionDecision = {
    schemaVersion: 1, modelId: model.providerModelId, capabilityVersion: model.version,
    requested: { mode: requestedMode, parameters: structuredClone(original) },
    effective: { mode: modeName, parameters: structuredClone(parameters) },
    adjustments: notices.filter(item => item.code === 'MODE_RESET' || item.code === 'PARAMETER_RESET')
      .map(item => ({ code: item.code as 'MODE_RESET' | 'PARAMETER_RESET', path: item.path }))
  };
  return { mode: modeName, parameters, inputs: [...inputs], notices, issues, optionDecision };
}
