/** Persistent canvas pins. The color order is shared with the document contract. */
import { CanvasError, PIN_COLORS, applyCanvasCommand } from '@nextmux/comic-core/canvas';
import type { CanvasDocument, CanvasNode, PinColor } from '@nextmux/comic-core/canvas';

export interface CanvasPinGroup {
    readonly color: PinColor;
    readonly nodes: readonly CanvasNode[];
}

/** All twelve color buckets, in palette order; a multi-color node appears in each of its buckets. */
export function listCanvasPins(canvas: CanvasDocument): readonly CanvasPinGroup[] {
    return PIN_COLORS.map(color => ({ color, nodes: canvas.nodes.filter(node => node.pinnedColors?.includes(color)) }));
}

/** Apply one node's chosen colors through comic-core validation. An empty list clears this node. */
export function setCanvasNodePins(canvas: CanvasDocument, nodeId: string, pinnedColors: readonly PinColor[], now: string = canvas.updatedAt): CanvasDocument {
    return applyCanvasCommand(canvas, { type: 'node.setPins', nodeId, pinnedColors }, { now });
}

/** Clear one color everywhere, or clear all pins when color is omitted; no changes return the same document. */
export function clearCanvasPins(canvas: CanvasDocument, color?: PinColor, now: string = canvas.updatedAt): CanvasDocument {
    if (color !== undefined && !(PIN_COLORS as readonly string[]).includes(color)) throw new CanvasError('PIN_COLOR', 'Unknown pin color');
    let next = canvas;
    for (const node of canvas.nodes) {
        if (!node.pinnedColors?.length || color !== undefined && !node.pinnedColors.includes(color)) continue;
        next = setCanvasNodePins(next, node.id, color === undefined ? [] : node.pinnedColors.filter(candidate => candidate !== color), now);
    }
    return next;
}
