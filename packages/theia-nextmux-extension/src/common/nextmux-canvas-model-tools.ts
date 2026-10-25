import { resolveCanvasCapability, validateCanvasGenerationParameters } from '@nextmux/comic-core/canvas-capabilities';
import type { CanvasAssetVersion, CanvasCapabilityIssue, CanvasModelCapability, CanvasModeCapability, CanvasOutputVariant } from '@nextmux/comic-core';
import type { MediaProviderCapabilityEvidence } from '@nextmux/media-core';
import type { CanvasModelToolOperation, CanvasModelToolRequest, CanvasOnDeviceToolOperation } from './nextmux-canvas-tool-contracts';
import { CANVAS_MODEL_TOOL_OPERATIONS } from './nextmux-canvas-tool-contracts';

export interface CanvasModelToolRouteInput {
    readonly role: 'referenceImage' | 'referenceVideo' | 'referenceAudio';
    readonly version: CanvasAssetVersion;
}
export interface CanvasOnDeviceToolRoutePlan {
    readonly status: 'local';
    readonly operation: CanvasOnDeviceToolOperation;
    readonly kind: 'image' | 'video';
    readonly parameters: Readonly<Record<string, unknown>>;
}
export type CanvasModelToolRoutePlan = CanvasOnDeviceToolRoutePlan | {
    readonly status: 'available';
    readonly operation: CanvasModelToolOperation;
    readonly kind: 'image' | 'video';
    readonly mode: 'imageToImage' | 'videoEdit';
    readonly modelId: string;
    readonly capabilityVersion: string;
    readonly prompt: string;
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly inputs: readonly CanvasModelToolRouteInput[];
} | {
    readonly status: 'unavailable';
    readonly code: 'CANVAS_TOOL_NO_MODEL';
    readonly operation: CanvasModelToolOperation;
    readonly missingCapabilities: readonly string[];
    readonly message: string;
};
export type CanvasModelToolUnavailableRoute = Extract<CanvasModelToolRoutePlan, { readonly status: 'unavailable' }>;
export interface CanvasModelToolRouteOptions {
    readonly operation: CanvasModelToolOperation;
    /** Resolve this version from the persisted canvas before planning. */
    readonly source: CanvasAssetVersion;
    readonly references?: CanvasModelToolRequest['references'];
    readonly prompt?: string;
    readonly parameters?: Readonly<Record<string, unknown>>;
    readonly capability?: CanvasModelCapability;
    /** Existing public catalog capability flags, never caller verifiedOperations. */
    readonly catalogCapabilities?: readonly string[];
    /** Existing media-core profile facts, if the selected route exposes them. */
    readonly mediaCapabilities?: readonly Pick<MediaProviderCapabilityEvidence, 'capability' | 'status'>[];
}
export class CanvasModelToolRouteError extends Error {
    constructor(readonly code: 'CANVAS_TOOL_INPUT_INVALID' | 'CANVAS_TOOL_PARAMETERS_INVALID', message: string) {
        super(message);
        this.name = 'CanvasModelToolRouteError';
    }
}

const IMAGE_PROMPTS: Partial<Record<CanvasModelToolOperation, string>> = {
    'image.upscale': 'Upscale this image to the requested output size. Preserve the composition, identity and colors while restoring fine detail.',
    'image.relight': 'Relight this image according to the instructions. Preserve the subject identity, geometry and composition.',
    'image.outpaint': 'Extend the image beyond its current borders to fill the requested canvas. Preserve the original subject and continue the surrounding scene naturally.',
    'image.styleTransfer': 'Apply the requested visual style to this image. Preserve the subject identity and composition; use style references when provided.'
};
/** These output semantics have no contract in the current canvas/media adapters. */
const MISSING_OUTPUTS: Partial<Record<CanvasModelToolOperation, readonly string[]>> = {
    'video.upscale': ['video upscale operation'],
    'video.removeSubtitles': ['video subtitle removal operation'],
    'video.matting': ['video matting operation', 'video alpha output'],
    'audio.separateVoice': ['voice separation operation', 'audio separation job input'],
    'audio.separateBackground': ['background separation operation', 'audio separation job input']
};
const MAPPED_PARAMETERS = new Set(['resolution', 'aspectRatio', 'durationSeconds', 'generateAudio', 'preserveInputAudio', 'negativePrompt', 'width', 'height', 'requestSubtitles']);

function freeze<T>(value: T): T {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}
function unavailable(operation: CanvasModelToolOperation, missing: readonly string[]): CanvasModelToolUnavailableRoute {
    const missingCapabilities = [...new Set(missing)];
    return freeze({ status: 'unavailable', code: 'CANVAS_TOOL_NO_MODEL', operation, missingCapabilities,
        message: `当前没有支持该功能的模型。Missing capability: ${missingCapabilities.join(', ')}.` });
}
/** Known transport gaps can be reported before resolving any selected model route. */
export function canvasModelToolMissingRoute(operation: CanvasModelToolOperation): CanvasModelToolUnavailableRoute | undefined {
    if (!CANVAS_MODEL_TOOL_OPERATIONS.includes(operation)) throw new CanvasModelToolRouteError('CANVAS_TOOL_PARAMETERS_INVALID', 'Unknown canvas model tool operation.');
    const missing = MISSING_OUTPUTS[operation];
    return missing ? unavailable(operation, missing) : undefined;
}
function readyVersion(version: CanvasAssetVersion, kind: 'image' | 'video' | 'audio'): boolean {
    return Boolean(version?.id && version.assetId && version.uri && version.kind === kind && version.status !== 'missing' && version.status !== 'uploading');
}
export function isCanvasOnDeviceToolOperation(operation: CanvasModelToolOperation): operation is CanvasOnDeviceToolOperation {
    return operation === 'image.matting' || operation === 'image.depth' || operation === 'video.depth';
}
/** Local tools preserve the source pixels' dimensions and never resolve a provider or billing route. */
export function planCanvasOnDeviceToolRoute(options: {
    readonly operation: CanvasOnDeviceToolOperation;
    readonly source: CanvasAssetVersion;
    readonly parameters?: Readonly<Record<string, unknown>>;
    readonly references?: CanvasModelToolRequest['references'];
    readonly prompt?: string;
}): CanvasOnDeviceToolRoutePlan {
    const video = options.operation === 'video.depth', kind = video ? 'video' : 'image';
    if (!readyVersion(options.source, kind)) throw new CanvasModelToolRouteError('CANVAS_TOOL_INPUT_INVALID', `This operation requires a ready ${kind} source version.`);
    if (options.references?.length || options.prompt?.trim()) throw new CanvasModelToolRouteError('CANVAS_TOOL_PARAMETERS_INVALID', 'On-device tools accept one source and no prompt or references.');
    const parameters = options.parameters === undefined ? {} : options.parameters;
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)
        || Object.keys(parameters).some(key => !(video ? ['resolution', 'invert', 'smooth'] : options.operation === 'image.depth' ? ['invert'] : []).includes(key))
        || parameters.invert !== undefined && typeof parameters.invert !== 'boolean'
        || parameters.smooth !== undefined && typeof parameters.smooth !== 'boolean'
        || parameters.resolution !== undefined && !['source', '720', '480'].includes(parameters.resolution as string)) {
        throw new CanvasModelToolRouteError('CANVAS_TOOL_PARAMETERS_INVALID', 'Invalid on-device tool settings.');
    }
    return freeze({ status: 'local', operation: options.operation, kind,
        parameters: video ? { resolution: parameters.resolution ?? 'source', invert: parameters.invert ?? false, smooth: parameters.smooth ?? true }
            : options.operation === 'image.depth' ? { invert: parameters.invert ?? false } : {} });
}
function dimensions(variant: CanvasOutputVariant, aspectRatio: string | undefined, source: CanvasAssetVersion): { width: number; height: number } | undefined {
    const exact = aspectRatio && variant.dimensions?.[aspectRatio];
    if (exact) return exact;
    const square = /^(\d+)x(\d+)$/iu.exec(variant.resolution);
    if (square) return { width: Number(square[1]), height: Number(square[2]) };
    const side = /^(\d+)p$/iu.exec(variant.resolution);
    const parts = aspectRatio?.split(':').map(Number);
    const ratio = aspectRatio === 'auto' ? Number(source.metadata?.width) / Number(source.metadata?.height)
        : parts?.length === 2 && parts[1] > 0 ? parts[0] / parts[1] : NaN;
    if (!side || !Number.isFinite(ratio) || ratio <= 0) return undefined;
    return { width: Math.round((ratio >= 1 ? Number(side[1]) * ratio : Number(side[1])) / 2) * 2,
        height: Math.round((ratio >= 1 ? Number(side[1]) : Number(side[1]) / ratio) / 2) * 2 };
}
function transportDimensions(size: { width: number; height: number } | undefined): boolean {
    return Boolean(size && [size.width, size.height].every(value => Number.isSafeInteger(value) && value >= 64 && value <= 4096));
}
function enlarged(size: { width: number; height: number } | undefined, source: CanvasAssetVersion): boolean {
    const width = source.metadata?.width, height = source.metadata?.height;
    return Boolean(width && height && transportDimensions(size) && size!.width > width && size!.height > height
        && Math.abs(size!.width / size!.height - width / height) / (width / height) <= 0.02);
}
function defaultParameters(mode: CanvasModeCapability, original: Readonly<Record<string, unknown>>, source: CanvasAssetVersion, upscale: boolean): Record<string, unknown> {
    const parameters: Record<string, unknown> = { ...original };
    let variant = mode.outputVariants?.find(item => item.resolution === parameters.resolution);
    if (parameters.resolution === undefined) {
        variant = mode.outputVariants?.find(item => item.resolution === mode.defaultResolution) ?? mode.outputVariants?.[0];
        if (upscale) {
            const candidates = mode.outputVariants?.flatMap(item => (item.aspectRatios ?? []).map(aspectRatio => ({ variant: item, aspectRatio, size: dimensions(item, aspectRatio, source) }))) ?? [];
            const selected = candidates.filter(item => item.variant.resolution !== 'auto' && (parameters.aspectRatio === undefined || item.aspectRatio === parameters.aspectRatio) && enlarged(item.size, source))
                .sort((left, right) => right.size!.width * right.size!.height - left.size!.width * left.size!.height)[0];
            if (selected) { variant = selected.variant; if (parameters.aspectRatio === undefined) parameters.aspectRatio = selected.aspectRatio; }
        }
        if (variant) parameters.resolution = variant.resolution;
    }
    if (parameters.aspectRatio === undefined && variant?.aspectRatios?.length) {
        const matchingUpscaleRatio = upscale ? variant.aspectRatios.find(ratio => enlarged(dimensions(variant!, ratio, source), source)) : undefined;
        parameters.aspectRatio = matchingUpscaleRatio ?? (variant.aspectRatios.includes(variant.defaultAspectRatio ?? '') ? variant.defaultAspectRatio : variant.aspectRatios[0]);
    }
    if (mode.mode === 'videoEdit') {
        const duration = variant?.durationOverride ?? mode.duration;
        if (parameters.durationSeconds === undefined && duration) parameters.durationSeconds = duration.kind === 'fixed' ? duration.seconds : duration.defaultSeconds;
        const audio = variant?.audioGenerationOverride ?? mode.audioGeneration;
        if (parameters.generateAudio === undefined && audio) parameters.generateAudio = audio.defaultEnabled;
    }
    for (const definition of mode.parameters ?? []) if (parameters[definition.key] === undefined && definition.defaultValue !== undefined) parameters[definition.key] = definition.defaultValue;
    return parameters;
}
function capabilityIssues(issues: readonly CanvasCapabilityIssue[]): boolean {
    return issues.every(issue => ['CAPABILITY_UNKNOWN', 'CAPABILITY_INVALID', 'MODEL_UNAVAILABLE', 'MODE_UNSUPPORTED', 'INPUT_ROLE_UNSUPPORTED', 'INPUT_COMBINATION_UNSUPPORTED'].includes(issue.code));
}

/** Pure capability-selected plan. Submission, quotes, billing and recovery stay in runComicCanvasNode. */
export function planCanvasModelToolRoute(options: CanvasModelToolRouteOptions): CanvasModelToolRoutePlan {
    const { operation, capability, source } = options;
    if (isCanvasOnDeviceToolOperation(operation)) return planCanvasOnDeviceToolRoute({ ...options, operation });
    const unsupported = canvasModelToolMissingRoute(operation);
    if (unsupported) return unsupported;
    const imagePrompt = IMAGE_PROMPTS[operation];
    if (!imagePrompt && operation !== 'video.lipSync') throw new CanvasModelToolRouteError('CANVAS_TOOL_PARAMETERS_INVALID', 'Unknown canvas model tool operation.');
    if (!capability || capability.status !== 'available') return unavailable(operation, ['available model route']);
    const modeName = imagePrompt ? 'imageToImage' : 'videoEdit';
    const mode = capability.modes.find(item => item.mode === modeName);
    if (!mode) return unavailable(operation, [modeName]);
    if (operation === 'video.lipSync') {
        const declarations = options.mediaCapabilities?.filter(item => item.capability === 'lip_sync');
        const lipSync = declarations?.length ? declarations.every(item => item.status === 'supported') : options.catalogCapabilities?.includes('lip_sync');
        if (!lipSync || mode.audioDrivenVideo !== true) return unavailable(operation, [...(!lipSync ? ['lip_sync'] : []), ...(mode.audioDrivenVideo !== true ? ['audioDrivenVideo'] : [])]);
    }
    const kind = imagePrompt ? 'image' : 'video';
    if (!readyVersion(source, kind)) throw new CanvasModelToolRouteError('CANVAS_TOOL_INPUT_INVALID', `This operation requires a ready ${kind} source version.`);
    const inputs: CanvasModelToolRouteInput[] = [{ role: kind === 'image' ? 'referenceImage' : 'referenceVideo', version: source }];
    for (const reference of options.references ?? []) {
        if (reference.role === 'mask') return unavailable(operation, ['mask input transport']);
        const audio = reference.role === 'audio';
        if (!['identity', 'style', 'audio'].includes(reference.role) || !readyVersion(reference.version, audio ? 'audio' : 'image')) throw new CanvasModelToolRouteError('CANVAS_TOOL_INPUT_INVALID', 'Tool references require ready versions with explicit image/audio roles.');
        if (audio && kind === 'image') throw new CanvasModelToolRouteError('CANVAS_TOOL_INPUT_INVALID', 'Image editing cannot consume an audio reference.');
        inputs.push({ role: audio ? 'referenceAudio' : 'referenceImage', version: reference.version });
    }
    if (operation === 'video.lipSync' && !inputs.some(input => input.role === 'referenceAudio')) throw new CanvasModelToolRouteError('CANVAS_TOOL_INPUT_INVALID', 'Lip sync requires a reference audio version.');
    if (options.parameters !== undefined && (!options.parameters || typeof options.parameters !== 'object' || Array.isArray(options.parameters))) {
        throw new CanvasModelToolRouteError('CANVAS_TOOL_PARAMETERS_INVALID', 'Tool parameters must be an object.');
    }
    // Fill absent fields only; invalid caller values are never replaced.
    const parameters = defaultParameters(mode, options.parameters ?? {}, source, operation === 'image.upscale');
    const issues = validateCanvasGenerationParameters(capability, modeName, parameters, inputs.map(input => ({ role: input.role, kind: input.version.kind, versionId: input.version.id, metadata: input.version.metadata })));
    if (issues.length) {
        if (capabilityIssues(issues)) return unavailable(operation, issues.map(issue => `${issue.path}: ${issue.message}`));
        throw new CanvasModelToolRouteError('CANVAS_TOOL_PARAMETERS_INVALID', issues.map(issue => `${issue.path}: ${issue.message}`).join('; '));
    }
    const unmapped = Object.keys(parameters).filter(key => !MAPPED_PARAMETERS.has(key));
    if (unmapped.length || parameters.requestSubtitles === true) return unavailable(operation, [...unmapped.map(key => `parameter transport: ${key}`), ...(parameters.requestSubtitles === true ? ['subtitle request transport'] : [])]);
    const resolved = resolveCanvasCapability(capability, { mode: modeName, resolution: String(parameters.resolution) });
    // Auto dimensions freeze queue fitter inputs; they cannot certify returned pixels for upscale.
    const size = resolved.variant && !(operation === 'image.upscale' && resolved.variant.resolution === 'auto')
        ? dimensions(resolved.variant, String(parameters.aspectRatio), source) : undefined;
    // These adapters choose the pixels and transmit only the declared aspect.
    // The platform freezes queue dimensions from project canvasSize before submission.
    const deferredImageSize = kind === 'image' && operation !== 'image.upscale' && resolved.variant?.resolution === 'auto';
    if (!transportDimensions(size) && !deferredImageSize) return unavailable(operation, ['known output dimensions within media queue limits']);
    if (size && (parameters.width !== undefined && parameters.width !== size.width || parameters.height !== undefined && parameters.height !== size.height)) throw new CanvasModelToolRouteError('CANVAS_TOOL_PARAMETERS_INVALID', 'Explicit dimensions must match the selected output variant.');
    if (operation === 'image.upscale' && !enlarged(size, source)) return unavailable(operation, ['larger output dimensions preserving source aspect ratio']);
    if (kind === 'video' && (!Number.isSafeInteger(parameters.durationSeconds) || Number(parameters.durationSeconds) < 1 || Number(parameters.durationSeconds) > 300)) return unavailable(operation, ['whole-second video duration within media queue limits']);
    if (inputs.filter(input => input.role === 'referenceImage').length > 4) return unavailable(operation, ['image reference count within media queue limits']);
    if (inputs.filter(input => input.role === 'referenceAudio').length > 16 || inputs.filter(input => input.role === 'referenceVideo').length > 16) return unavailable(operation, ['video/audio reference count within media queue limits']);
    const instruction = imagePrompt ?? 'Synchronize the visible mouth movements in the source video to the supplied audio. Preserve the subject identity, motion and scene.';
    const prompt = [instruction, options.prompt?.trim()].filter(Boolean).join('\n\n');
    return freeze(structuredClone({ status: 'available', operation, kind, mode: modeName, modelId: capability.providerModelId,
        capabilityVersion: capability.version, prompt, parameters, inputs })) as CanvasModelToolRoutePlan;
}
