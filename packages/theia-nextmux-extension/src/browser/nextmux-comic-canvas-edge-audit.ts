import { validateCanvasDocument, validateCanvasEdge } from '@nextmux/comic-core/canvas';
import type { CanvasDocument, CanvasEdge, CanvasValidationIssue } from '@nextmux/comic-core/canvas';

export interface CanvasEdgeFinding {
    /** Original array index: duplicate edge IDs must never delete another, unselected edge. */
    readonly index: number;
    readonly edge: CanvasEdge;
    readonly issues: readonly CanvasValidationIssue[];
}
export function scanCanvasEdges(canvas: CanvasDocument): readonly CanvasEdgeFinding[] {
    const ids = new Map<string, number>();
    for (const edge of canvas.edges) ids.set(edge.id, (ids.get(edge.id) ?? 0) + 1);
    return canvas.edges.flatMap((edge, index) => {
        let issues: CanvasValidationIssue[];
        try { issues = [...validateCanvasEdge(canvas, edge)]; }
        catch { issues = [{ code: 'SCAN_FAILED', path: `edges.${index}`, message: 'The connection could not be checked.' }]; }
        if ((ids.get(edge.id) ?? 0) > 1) issues.push({ code: 'EDGE_ID_DUPLICATE', path: `edges.${index}`, message: 'Connection identifiers must be unique.' });
        return issues.length ? [{ index, edge, issues }] : [];
    });
}

/** Drop only explicitly selected, currently invalid edges. Nodes, asset versions and provenance are untouched. */
export function previewCanvasEdgeRepair(canvas: CanvasDocument, indices: readonly number[]): CanvasDocument {
    const bad = new Set(scanCanvasEdges(canvas).map(item => item.index));
    const selected = new Set(indices.filter(index => Number.isSafeInteger(index) && bad.has(index)));
    if (!selected.size) return canvas;
    return { ...canvas, edges: canvas.edges.filter((_edge, index) => !selected.has(index)) };
}

export type CanvasEdgeRepairResult =
    | { readonly ok: true; readonly canvas: CanvasDocument; readonly removed: number }
    | { readonly ok: false; readonly reason: 'changed' | 'empty' | 'invalid'; readonly issues: readonly CanvasValidationIssue[] };

/** The base identity is a deliberate concurrency guard, not permission to bypass the save validator. */
export function applyCanvasEdgeRepair(base: CanvasDocument, current: CanvasDocument, indices: readonly number[], now: string): CanvasEdgeRepairResult {
    if (base !== current) return { ok: false, reason: 'changed', issues: [] };
    const preview = previewCanvasEdgeRepair(current, indices);
    const removed = current.edges.length - preview.edges.length;
    if (!removed) return { ok: false, reason: 'empty', issues: [] };
    const canvas = { ...preview, revision: current.revision + 1, updatedAt: now };
    const issues = validateCanvasDocument(canvas);
    return issues.length ? { ok: false, reason: 'invalid', issues } : { ok: true, canvas, removed };
}

export function canvasEdgeBounds(canvas: CanvasDocument, edge: CanvasEdge): { x: number; y: number; width: number; height: number } | undefined {
    const endpoints = canvas.nodes.filter(node => node.id === edge.sourceNodeId || node.id === edge.targetNodeId);
    if (!endpoints.length) return undefined;
    const x = Math.min(...endpoints.map(node => node.position.x)), y = Math.min(...endpoints.map(node => node.position.y));
    return { x, y, width: Math.max(...endpoints.map(node => node.position.x + node.size.width)) - x,
        height: Math.max(...endpoints.map(node => node.position.y + node.size.height)) - y };
}

/** Only these checks correspond to the reference status panel; the rest are labelled as NextMux additions. */
export const CANVAS_EDGE_BASE_CHECKS = new Set(['SOURCE_PORT', 'TARGET_PORT', 'ROLE_LIMIT']);
