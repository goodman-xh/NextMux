import {
  resolveCanvasCapability, validateCanvasGenerationParameters,
  type CanvasCapabilityInput, type CanvasCapabilityIssue, type CanvasModelCapability, type CanvasOutputVariant,
} from './canvas-capabilities.js';

export interface CanvasImageToolDimensions {
  readonly width: number;
  readonly height: number;
}

/** Facts about the current generic canvas media contract, not a model-name heuristic. */
export const CANVAS_IMAGE_TOOL_TRANSPORT_SUPPORT = Object.freeze({
  referenceImage: true, maskInput: false, transparentBackground: false,
  alphaOutput: false, trueDepthOutput: false, layerOutputs: false,
} as const);

/** A painted reference is supported; none of these stronger outputs has a typed job contract yet. */
export function canvasImageToolMissingOutput(output: 'alpha' | 'depthMap' | 'layers'): readonly string[] {
  switch (output) {
    case 'alpha': return Object.freeze(['transparent background parameter transport', 'alpha-capable output format transport', 'image alpha output verification']);
    case 'depthMap': return Object.freeze(['depth estimation model route in the fixed registry', 'depth values and pixel-value convention output contract']);
    case 'layers': return Object.freeze(['layer decomposition model route in the fixed registry', 'ordered RGBA layer output contract']);
  }
}

export interface CanvasImageToolRouteOptions {
  /** The caller supplies the effective configured-route capability, including any registry limits. */
  readonly capability: CanvasModelCapability;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly inputs: readonly CanvasCapabilityInput[];
  readonly sourceDimensions?: CanvasImageToolDimensions;
  readonly highestResolution?: boolean;
  readonly preserveSourceAspect?: boolean;
  readonly requireEnlargement?: boolean;
}

export type CanvasImageToolRouteResult = {
  readonly available: true;
  readonly mode: 'imageToImage';
  readonly parametersPatch: Readonly<Record<string, unknown>>;
  readonly variant: CanvasOutputVariant;
  /** Omitted for provider-owned resolution:auto; it makes no promise about returned pixels. */
  readonly dimensions?: CanvasImageToolDimensions;
} | {
  readonly available: false;
  readonly missingCapabilities: readonly string[];
  readonly issues: readonly CanvasCapabilityIssue[];
};

const MAPPED_IMAGE_PARAMETERS = new Set(['resolution', 'aspectRatio', 'negativePrompt', 'width', 'height']);
const TOLERANCE = 0.02;

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

function unavailable(missingCapabilities: readonly string[], issues: readonly CanvasCapabilityIssue[] = []): CanvasImageToolRouteResult {
  return freeze({ available: false, missingCapabilities: [...new Set(missingCapabilities)], issues: [...issues] });
}

function validDimensions(size: CanvasImageToolDimensions | undefined): size is CanvasImageToolDimensions {
  return Boolean(size && [size.width, size.height].every(value => Number.isSafeInteger(value) && value >= 64 && value <= 4096));
}

function validSourceDimensions(size: CanvasImageToolDimensions | undefined): size is CanvasImageToolDimensions {
  return Boolean(size && [size.width, size.height].every(value => Number.isSafeInteger(value) && value > 0));
}

function ratio(value: string, source: CanvasImageToolDimensions | undefined): number | undefined {
  if (value === 'auto') return validSourceDimensions(source) ? source.width / source.height : undefined;
  const match = /^(\d+):(\d+)$/u.exec(value);
  return match && Number(match[1]) > 0 && Number(match[2]) > 0 ? Number(match[1]) / Number(match[2]) : undefined;
}

function sameAspect(size: CanvasImageToolDimensions, reference: CanvasImageToolDimensions): boolean {
  const target = reference.width / reference.height;
  return Math.abs(size.width / size.height - target) / target <= TOLERANCE;
}

/** Uses exact image facts or the queue's explicit pixel/short-side rules; K names alone are ambiguous. */
export function canvasImageToolOutputDimensions(variant: CanvasOutputVariant, aspectRatio: string,
  source?: CanvasImageToolDimensions): CanvasImageToolDimensions | undefined {
  const exact = variant.dimensions?.[aspectRatio];
  if (exact) return validDimensions(exact) ? { ...exact } : undefined;
  const pixels = /^(\d+)x(\d+)$/iu.exec(variant.resolution);
  if (pixels) {
    const size = { width: Number(pixels[1]), height: Number(pixels[2]) };
    return validDimensions(size) ? size : undefined;
  }
  const short = /^(\d+)p$/iu.exec(variant.resolution), aspect = ratio(aspectRatio, source);
  if (!short || aspect === undefined || !Number.isFinite(aspect)) return undefined;
  const side = Number(short[1]);
  const size = {
    width: Math.round((aspect >= 1 ? side * aspect : side) / 2) * 2,
    height: Math.round((aspect >= 1 ? side : side / aspect) / 2) * 2,
  };
  return validDimensions(size) ? size : undefined;
}

/**
 * Pure preparation guard. Highest resolution means the largest verified, executable pixel area,
 * preserving the measured source aspect for upscale. Unknown outputs never become an HD promise.
 * Quotes, holds, input-file loading and generation stay in the existing canvas runner.
 */
export function resolveCanvasImageToolRoute(options: CanvasImageToolRouteOptions): CanvasImageToolRouteResult {
  const { capability, inputs } = options;
  if (!capability || capability.status !== 'available') return unavailable(['available model route']);
  const mode = capability.modes.find(item => item.mode === 'imageToImage');
  if (!mode) return unavailable(['imageToImage']);
  if (options.parameters !== undefined && (!options.parameters || typeof options.parameters !== 'object' || Array.isArray(options.parameters))) return unavailable(['valid image tool parameters']);
  const parameters: Record<string, unknown> = { ...options.parameters };
  const reference = inputs.find(input => input.role === 'referenceImage' || input.role === 'character' && input.kind === 'image');
  const measured = reference?.metadata;
  const source = options.sourceDimensions ?? (measured?.width && measured.height ? { width: measured.width, height: measured.height } : undefined);
  if ((options.preserveSourceAspect || options.requireEnlargement) && !validSourceDimensions(source)) return unavailable(['measured source image dimensions']);
  if (parameters.resolution !== undefined && typeof parameters.resolution !== 'string') return unavailable(['valid resolution parameter']);
  if (parameters.aspectRatio !== undefined && typeof parameters.aspectRatio !== 'string') return unavailable(['valid aspect ratio parameter']);
  // An invalid explicitly selected output cannot be silently repaired by highest-resolution selection.
  if (typeof parameters.resolution === 'string') {
    const selected = resolveCanvasCapability(capability, { mode: 'imageToImage', resolution: parameters.resolution });
    if (selected.issues.length) return unavailable(selected.issues.map(issue => `${issue.path}: ${issue.message}`), selected.issues);
  }
  let variant: CanvasOutputVariant | undefined;
  let dimensions: CanvasImageToolDimensions | undefined;
  if (options.highestResolution) {
    // These fields can be frozen fitter dimensions copied from an earlier generation snapshot.
    // Highest output owns the new request size, just as it owns resolution; malformed values still fail.
    for (const key of ['width', 'height'] as const) {
      const inherited = parameters[key];
      if (inherited !== undefined && (typeof inherited !== 'number' || !Number.isSafeInteger(inherited) || inherited < 64 || inherited > 4096)) return unavailable([`valid inherited ${key} parameter`]);
      delete parameters[key];
    }
    const declaredDimensions = (['width', 'height'] as const).filter(key => mode.parameters?.some(definition => definition.key === key));
    const candidates = (mode.outputVariants ?? []).flatMap(output => (output.aspectRatios ?? []).flatMap(aspectRatio => {
      // Auto metadata can freeze queue fitter inputs; it cannot certify the provider's returned pixels.
      if (output.resolution === 'auto') return [];
      if (parameters.aspectRatio !== undefined && parameters.aspectRatio !== aspectRatio) return [];
      const size = canvasImageToolOutputDimensions(output, aspectRatio, source);
      if (!size || options.preserveSourceAspect && !sameAspect(size, source!)) return [];
      if (options.requireEnlargement && !(size.width > source!.width && size.height > source!.height)) return [];
      const testParameters: Record<string, unknown> = { ...parameters, resolution: output.resolution, aspectRatio };
      for (const key of declaredDimensions) testParameters[key] = size[key];
      const issues = validateCanvasGenerationParameters(capability, 'imageToImage', testParameters, inputs);
      return issues.length ? [] : [{ variant: output, aspectRatio, dimensions: size }];
    })).sort((left, right) => right.dimensions.width * right.dimensions.height - left.dimensions.width * left.dimensions.height);
    const chosen = candidates[0];
    if (!chosen) return unavailable([options.requireEnlargement ? 'larger known output dimensions preserving source aspect ratio' : 'known highest-resolution output dimensions']);
    variant = chosen.variant;
    dimensions = chosen.dimensions;
    parameters.resolution = variant.resolution;
    parameters.aspectRatio = chosen.aspectRatio;
    for (const key of declaredDimensions) parameters[key] = dimensions[key];
  } else {
    const resolved = resolveCanvasCapability(capability, { mode: 'imageToImage', resolution: typeof parameters.resolution === 'string' ? parameters.resolution : undefined });
    if (resolved.issues.length || !resolved.variant) return unavailable(resolved.issues.map(issue => `${issue.path}: ${issue.message}`), resolved.issues);
    variant = resolved.variant;
    parameters.resolution ??= variant.resolution;
    if (parameters.aspectRatio === undefined) {
      const matching = options.preserveSourceAspect ? variant.aspectRatios?.find(value => {
        const aspect = ratio(value, source); return aspect !== undefined && Math.abs(aspect - source!.width / source!.height) / (source!.width / source!.height) <= TOLERANCE;
      }) : undefined;
      parameters.aspectRatio = matching ?? (variant.aspectRatios?.includes(variant.defaultAspectRatio ?? '') ? variant.defaultAspectRatio : variant.aspectRatios?.[0]);
    }
    dimensions = canvasImageToolOutputDimensions(variant, String(parameters.aspectRatio), source);
    if (!dimensions && variant.resolution !== 'auto') return unavailable(['known output dimensions within media queue limits']);
    if (options.preserveSourceAspect && (dimensions ? !sameAspect(dimensions, source!) : ratio(String(parameters.aspectRatio), source) === undefined
      || Math.abs(ratio(String(parameters.aspectRatio), source)! - source!.width / source!.height) / (source!.width / source!.height) > TOLERANCE)) return unavailable(['output aspect ratio preserving source image']);
    if (options.requireEnlargement && (!dimensions || dimensions.width <= source!.width || dimensions.height <= source!.height)) return unavailable(['larger known output dimensions']);
  }
  for (const definition of mode.parameters ?? []) if (parameters[definition.key] === undefined && definition.defaultValue !== undefined) parameters[definition.key] = definition.defaultValue;
  const issues = validateCanvasGenerationParameters(capability, 'imageToImage', parameters, inputs);
  if (issues.length) return unavailable(issues.map(issue => `${issue.path}: ${issue.message}`), issues);
  const unmapped = Object.keys(parameters).filter(key => !MAPPED_IMAGE_PARAMETERS.has(key));
  if (unmapped.length) return unavailable(unmapped.map(key => `parameter transport: ${key}`));
  if (inputs.filter(input => input.kind === 'image' && (input.role === 'referenceImage' || input.role === 'character')).length > 4) return unavailable(['image reference count within media queue limit of four']);
  if (dimensions && (parameters.width !== undefined && parameters.width !== dimensions.width || parameters.height !== undefined && parameters.height !== dimensions.height)) return unavailable(['explicit dimensions matching selected output variant']);
  return freeze(structuredClone({ available: true, mode: 'imageToImage', parametersPatch: parameters, variant,
    ...(dimensions ? { dimensions } : {}) })) as CanvasImageToolRouteResult;
}
