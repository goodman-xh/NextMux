import { applyCanvasCommand, resolveCanvasInputs, type CanvasDocument, type CanvasGenerationMode } from '@nextmux/comic-core/canvas';
import { reconcileCanvasGenerationParameters, type CanvasCapabilityInput, type CanvasModelCapability } from '@nextmux/comic-core/canvas-capabilities';
import { switchCanvasMode } from './nextmux-comic-canvas-logic';

export function canvasOptionInputs(canvas: CanvasDocument, nodeId: string): readonly CanvasCapabilityInput[] {
    return resolveCanvasInputs(canvas, nodeId).inputs.map(input => ({ role: input.role, kind: input.kind, versionId: input.versionId,
        ...(input.edgeId ? { edgeId: input.edgeId } : {}), ...(input.metadata ? { metadata: input.metadata } : {}) }));
}

/** A mode change is atomic: compatible pictures can be re-roled, but no reference disappears. */
export function switchCanvasModeKeepingInputs(canvas: CanvasDocument, nodeId: string, mode: CanvasGenerationMode, now: string): CanvasDocument | undefined {
    const node = canvas.nodes.find(item => item.id === nodeId);
    if (!node || (node.kind !== 'imageGen' && node.kind !== 'videoGen')) return undefined;
    if ((node.kind === 'imageGen') !== (mode === 'textToImage' || mode === 'imageToImage')) return undefined;
    const switched = switchCanvasMode(canvas, nodeId, mode, now);
    return switched.dropped.length || switched.droppedInputs?.length ? undefined : switched.canvas;
}

/** Model changes and capability refreshes use the same actual media inputs as request validation. */
export function fitCanvasNodeOptions(canvas: CanvasDocument, nodeId: string, model: CanvasModelCapability, now: string, aspectRatio?: string): CanvasDocument | undefined {
    const node = canvas.nodes.find(item => item.id === nodeId);
    if (!node || (node.kind !== 'imageGen' && node.kind !== 'videoGen')) return undefined;
    const initial = reconcileCanvasGenerationParameters(model, node.payload.mode, node.payload.parameters, canvasOptionInputs(canvas, nodeId), { aspectRatio });
    const next = switchCanvasModeKeepingInputs(canvas, nodeId, initial.mode, now);
    if (!next) return undefined;
    const result = initial.mode !== node.payload.mode
        ? reconcileCanvasGenerationParameters(model, initial.mode, node.payload.parameters, canvasOptionInputs(next, nodeId), { aspectRatio })
        : initial;
    const optionDecision = initial.mode !== node.payload.mode
        ? {
            ...result.optionDecision,
            requested: initial.optionDecision.requested,
            adjustments: [
                ...initial.optionDecision.adjustments.filter(item => item.code === 'MODE_RESET'),
                ...result.optionDecision.adjustments.filter(item => item.code !== 'MODE_RESET')
            ]
        }
        : result.optionDecision;
    return applyCanvasCommand(next, { type: 'node.setParameters', nodeId, parameters: result.parameters, optionDecision }, { now });
}
