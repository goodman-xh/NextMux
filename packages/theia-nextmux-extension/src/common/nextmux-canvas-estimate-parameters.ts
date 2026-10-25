import { resolveCanvasInputs, type CanvasDocument, type CanvasNode } from '@nextmux/comic-core/canvas';
import { resolveCanvasCapability, type CanvasModelCapability } from '@nextmux/comic-core/canvas-capabilities';

// What a generation node will be priced on, its model's defaults filled in. The canvas shows its estimate from these
// and the platform service sets the same amount aside before the click spends anything, so the two never disagree.

/** Count resolved image inputs, including future wired results; written character descriptions have no image fee. */
export function canvasVideoInputImageCount(canvas: CanvasDocument, node: CanvasNode): number {
    const resolved = resolveCanvasInputs(canvas, node.id);
    return resolved.inputs.filter(input => input.kind === 'image' && ['firstFrame', 'lastFrame', 'referenceImage', 'character'].includes(input.role)).length
        + resolved.missing.filter(input => input.reason !== 'requiredInput' && ['firstFrame', 'lastFrame', 'referenceImage'].includes(input.role)).length;
}

/** Count resolved reference/input images for a canvas image generation node. */
export function canvasImageReferenceCount(canvas: CanvasDocument | undefined, node: CanvasNode): number {
    if (node.kind !== 'imageGen') return 0;
    if (canvas) {
        const resolved = resolveCanvasInputs(canvas, node.id);
        return resolved.inputs.filter(input => input.kind === 'image').length
            + resolved.missing.filter(input => input.reason !== 'requiredInput' && ['referenceImage', 'firstFrame'].includes(input.role)).length;
    }
    return node.payload.inputs?.filter(input => input.version?.kind === 'image').length ?? 0;
}

/** The seconds and output size a video node asks for. */
export function canvasVideoEstimateParameters(node: CanvasNode, capability?: CanvasModelCapability): {
    readonly seconds?: number;
    readonly resolution?: string;
    readonly width?: number;
    readonly height?: number;
} {
    if (node.kind !== 'videoGen') return {};
    const parameters = node.payload.parameters;
    const explicit = parameters.durationSeconds;
    const resolved = capability ? resolveCanvasCapability(capability, {
        mode: node.payload.mode,
        ...(typeof parameters.resolution === 'string' ? { resolution: parameters.resolution } : {})
    }) : undefined;
    const duration = resolved?.variant?.durationOverride ?? resolved?.mode?.duration;
    const seconds = typeof explicit === 'number' ? explicit : duration?.kind === 'fixed' ? duration.seconds : duration?.defaultSeconds;
    const resolution = typeof parameters.resolution === 'string' ? parameters.resolution : resolved?.variant?.resolution;
    const aspectRatio = typeof parameters.aspectRatio === 'string' ? parameters.aspectRatio : resolved?.variant?.defaultAspectRatio;
    const size = aspectRatio ? resolved?.variant?.dimensions?.[aspectRatio] : undefined;
    const width = typeof parameters.width === 'number' && Number.isFinite(parameters.width) ? parameters.width : size?.width;
    const height = typeof parameters.height === 'number' && Number.isFinite(parameters.height) ? parameters.height : size?.height;
    return { seconds, resolution, width, height };
}

/** The size, quality and output class a picture node asks for. */
export function canvasImageEstimateParameters(node: CanvasNode, capability?: CanvasModelCapability): {
    readonly width?: number;
    readonly height?: number;
    readonly quality?: string;
    readonly resolution?: string;
} {
    if (node.kind !== 'imageGen') return {};
    const parameters = node.payload.parameters;
    const resolved = capability ? resolveCanvasCapability(capability, {
        mode: node.payload.mode,
        ...(typeof parameters.resolution === 'string' ? { resolution: parameters.resolution } : {})
    }) : undefined;
    const aspect = typeof parameters.aspectRatio === 'string' ? parameters.aspectRatio : resolved?.variant?.defaultAspectRatio;
    const size = aspect ? resolved?.variant?.dimensions?.[aspect] : undefined;
    const width = size?.width ?? Number(parameters.width);
    const height = size?.height ?? Number(parameters.height);
    const qualityDefault = resolved?.mode?.parameters?.find(parameter => parameter.key === 'quality')?.defaultValue;
    return {
        ...(Number.isFinite(width) && width > 0 ? { width } : {}),
        ...(Number.isFinite(height) && height > 0 ? { height } : {}),
        ...(typeof parameters.quality === 'string' ? { quality: parameters.quality } : typeof qualityDefault === 'string' ? { quality: qualityDefault } : {}),
        ...(typeof parameters.resolution === 'string' ? { resolution: parameters.resolution } : {})
    };
}
