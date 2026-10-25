import type { CanvasDocument, CanvasInputRole, CanvasNode } from '@nextmux/comic-core/canvas';
import type { CanvasModelCapability, CanvasModeCapability } from '@nextmux/comic-core/canvas-capabilities';

/** Only offer inputs whose actual connection mode is declared by the selected adapter. */
export function canvasLibraryReferenceRoles(node: CanvasNode, model?: CanvasModelCapability): readonly CanvasInputRole[] {
    if (node.kind !== 'imageGen' && node.kind !== 'videoGen' || !model) return [];
    const mode = node.payload.mode;
    const capability = model.modes.find(item => item.mode === mode);
    const references = (value: CanvasModeCapability | undefined): CanvasInputRole[] => {
        const rules = value?.referenceRules;
        return (['image', 'video', 'audio'] as const).flatMap(kind => rules?.[kind]?.supported && rules[kind]!.maxCount > 0
            ? [kind === 'image' ? 'referenceImage' : kind === 'video' ? 'referenceVideo' : 'referenceAudio'] : []);
    };
    if (node.kind === 'imageGen') {
        const image = model.modes.find(item => item.mode === 'imageToImage');
        return references(image).includes('referenceImage') ? ['referenceImage'] : [];
    }
    if (mode === 'textToVideo') {
        const first = model.modes.find(item => item.mode === 'imageToVideo');
        return [...(first?.firstFrame ? ['firstFrame' as const] : []), ...references(model.modes.find(item => item.mode === 'referenceToVideo'))];
    }
    if (mode === 'imageToVideo') return capability?.firstFrame ? ['firstFrame'] : [];
    if (mode === 'firstLastFrame') return [...(capability?.firstFrame ? ['firstFrame' as const] : []), ...(capability?.lastFrame ? ['lastFrame' as const] : [])];
    return references(capability);
}

/** Remove only this direct input. Other versions, metadata, references and the chosen mode stay intact. */
export function removeCanvasDirectReference(canvas: CanvasDocument, nodeId: string, inputId: string, now: string): CanvasDocument {
    const node = canvas.nodes.find(item => item.id === nodeId);
    if (!node || node.kind !== 'imageGen' && node.kind !== 'videoGen' || !node.payload.inputs?.some(input => input.id === inputId)) return canvas;
    return { ...canvas, revision: canvas.revision + 1, updatedAt: now, nodes: canvas.nodes.map(item => item === node
        ? { ...node, payload: { ...node.payload, inputs: node.payload.inputs!.filter(input => input.id !== inputId) } } as CanvasNode : item) };
}
