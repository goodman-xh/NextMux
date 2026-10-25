/** Search and minimap buckets, independent of viewport/rendering. */
import type { CanvasDocument, CanvasNode, CanvasNodeKind } from '@nextmux/comic-core/canvas';
import { canvasNodeParentGroupId } from './nextmux-comic-canvas-groups';
import { canvasOutputKind } from './nextmux-comic-canvas-logic';
import { canvasText } from './nextmux-comic-canvas-text';

export type CanvasLocatorFilter = 'all' | 'picture' | 'clip' | 'sound' | 'text' | 'character';
export interface CanvasLocatorSearchOptions {
    readonly locale?: string;
    readonly kindLabels?: Readonly<Partial<Record<CanvasNodeKind, string>>>;
}

function normalized(value: string): string {
    return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/\s+/gu, '');
}

function subsequence(text: string, query: string): boolean {
    const wanted = [...query];
    let at = 0;
    for (const letter of normalized(text)) if (letter === wanted[at] && ++at === wanted.length) return true;
    return !wanted.length;
}

/** Fuzzy subsequence search over title and translated kind label, preserving document order. */
export function searchCanvasNodes(canvas: CanvasDocument, query: string, filter: CanvasLocatorFilter = 'all', options: CanvasLocatorSearchOptions = {}): readonly CanvasNode[] {
    const kinds: Readonly<Partial<Record<CanvasLocatorFilter, string>>> = { picture: 'image', clip: 'video', sound: 'audio', text: 'text', character: 'character' };
    const kind = kinds[filter];
    const wanted = normalized(query);
    return canvas.nodes.filter(node => (filter === 'all' || canvasOutputKind(node) === kind)
        && (subsequence(node.title, wanted) || subsequence(options.kindLabels?.[node.kind] ?? canvasText(options.locale ?? 'zh-CN', `kind.${node.kind}`), wanted)
            || subsequence(node.kind, wanted)));
}

export interface CanvasMinimapBucket {
    readonly id: string;
    readonly kind: 'canvas' | 'group' | 'quadrant';
    readonly nodeIds: readonly string[];
    readonly groupId?: string;
    readonly parentGroupId?: string;
}

function median(values: readonly number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Group members keep their own buckets; ungrouped leaves use one bucket up to 8, otherwise median quadrants. */
export function canvasMinimapBuckets(canvas: CanvasDocument): readonly CanvasMinimapBucket[] {
    const buckets: CanvasMinimapBucket[] = canvas.groups.map(group => {
        const card = canvas.nodes.find(node => node.kind === 'group' && node.payload.groupId === group.id);
        const parentGroupId = group.parentGroupId ?? (card ? canvasNodeParentGroupId(canvas, card.id) : undefined);
        return { id: `group:${group.id}`, kind: 'group', groupId: group.id, ...(parentGroupId ? { parentGroupId } : {}),
            nodeIds: canvas.nodes.filter(node => node.kind !== 'group' && canvasNodeParentGroupId(canvas, node.id) === group.id).map(node => node.id) };
    });
    const nodes = canvas.nodes.filter(node => node.kind !== 'group' && !canvasNodeParentGroupId(canvas, node.id));
    if (nodes.length <= 8) return [...buckets, { id: 'canvas', kind: 'canvas', nodeIds: nodes.map(node => node.id) }];
    const middleX = median(nodes.map(node => node.position.x + node.size.width / 2));
    const middleY = median(nodes.map(node => node.position.y + node.size.height / 2));
    const quadrants: Record<string, string[]> = { topLeft: [], topRight: [], bottomLeft: [], bottomRight: [] };
    for (const node of nodes) {
        const top = node.position.y + node.size.height / 2 < middleY;
        const left = node.position.x + node.size.width / 2 < middleX;
        quadrants[top ? (left ? 'topLeft' : 'topRight') : (left ? 'bottomLeft' : 'bottomRight')].push(node.id);
    }
    return [...buckets, ...Object.entries(quadrants).map(([id, nodeIds]) => ({ id, kind: 'quadrant' as const, nodeIds }))];
}
