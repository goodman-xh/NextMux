import { validateCanvasDocument, validateCanvasEdge, type CanvasDocument, type CanvasPoint } from '@nextmux/comic-core/canvas';
import { pasteCanvasClipboard, serializeCanvasClipboard } from './nextmux-comic-canvas-clipboard';
import { canvasId } from './nextmux-comic-canvas-logic';
import { copyCanvasNodeAuthoring, mergeCanvasNodeAuthoring, type CanvasNodeAuthoring } from './nextmux-comic-canvas-node-authoring';

export const CANVAS_DRAG_COPY_THRESHOLD = 3;
export interface CanvasDragCopyPlan {
    readonly canvasId: string;
    readonly projectId: string;
    readonly sourceIds: readonly string[];
    readonly nodes: CanvasDocument['nodes'];
    readonly edges: CanvasDocument['edges'];
    readonly groups: CanvasDocument['groups'];
    readonly sequenceLinks: NonNullable<CanvasDocument['sequenceLinks']>;
    readonly authoring?: CanvasNodeAuthoring;
}
type Refusal = { readonly ok: false; readonly message: string };

/** Include nested group cards as well as media members, regardless of how the group hierarchy is represented. */
export function canvasDragGroupMembers(canvas: CanvasDocument, nodeId: string): ReadonlySet<string> {
    const node = canvas.nodes.find(item => item.id === nodeId), members = new Set<string>(), seen = new Set<string>();
    if (node?.kind !== 'group') return members;
    const visit = (groupId: string): void => {
        if (seen.has(groupId)) return; seen.add(groupId);
        const group = canvas.groups.find(item => item.id === groupId);
        for (const id of group?.nodeIds ?? []) {
            members.add(id);
            const child = canvas.nodes.find(item => item.id === id);
            if (child?.kind === 'group') visit(child.payload.groupId);
        }
        for (const child of canvas.groups.filter(item => item.parentGroupId === groupId)) {
            for (const card of canvas.nodes) if (card.kind === 'group' && card.payload.groupId === child.id) members.add(card.id);
            visit(child.id);
        }
    };
    visit(node.payload.groupId); members.delete(nodeId); return members;
}

/** node.move(group) already translates its whole subtree; never issue a second move for selected descendants. */
export function canvasDragMoveRoots(canvas: CanvasDocument, nodeIds: readonly string[]): readonly string[] {
    const covered = new Set<string>();
    for (const id of nodeIds) for (const member of canvasDragGroupMembers(canvas, id)) covered.add(member);
    return [...new Set(nodeIds)].filter(id => !covered.has(id));
}

/** Neowow j5: Alt copies the subgraph; Cmd/Ctrl+Alt also keeps its external incoming references. */
export function prepareCanvasDragCopy(canvas: CanvasDocument, ids: readonly string[], duplicate: boolean, now: string): { readonly ok: true; readonly plan: CanvasDragCopyPlan } | Refusal {
    try {
        const pasted = pasteCanvasClipboard(canvas, serializeCanvasClipboard(canvas, ids), { offset: { x: 0, y: 0 }, now });
        if (!pasted.ok) return pasted;
        const selected = new Set(Object.keys(pasted.idMap)), copies = new Set(pasted.ids);
        const newGroups = new Set(pasted.canvas.nodes.filter(node => copies.has(node.id) && node.kind === 'group').map(node => node.kind === 'group' ? node.payload.groupId : ''));
        let next = pasted.canvas;
        if (duplicate) for (const edge of canvas.edges.filter(item => selected.has(item.targetNodeId) && !selected.has(item.sourceNodeId))) {
            const copied = { ...edge, id: canvasId('canvas-edge'), targetNodeId: pasted.idMap[edge.targetNodeId]! };
            const issues = validateCanvasEdge(next, copied);
            if (issues.length) return { ok: false, message: issues[0].message };
            next = { ...next, edges: [...next.edges, copied] };
        }
        const oldEdges = new Set(canvas.edges.map(edge => edge.id)), oldLinks = new Set((canvas.sequenceLinks ?? []).map(link => link.id));
        return { ok: true, plan: { canvasId: canvas.id, projectId: canvas.projectId, sourceIds: [...selected],
            nodes: next.nodes.filter(node => copies.has(node.id)), edges: next.edges.filter(edge => !oldEdges.has(edge.id)),
            groups: next.groups.filter(group => newGroups.has(group.id)), sequenceLinks: (next.sequenceLinks ?? []).filter(link => !oldLinks.has(link.id)),
            authoring: copyCanvasNodeAuthoring(next.settings, next.nodes.filter(node => copies.has(node.id))) } };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : String(error) }; }
}

/** Merge a drag copy without replacing edits that completed while the pointer was moving. */
export function commitCanvasDragCopy(canvas: CanvasDocument, plan: CanvasDragCopyPlan, offset: CanvasPoint, now: string): { readonly ok: true; readonly canvas: CanvasDocument; readonly ids: readonly string[] } | Refusal {
    if (canvas.id !== plan.canvasId || canvas.projectId !== plan.projectId || plan.sourceIds.some(id => !canvas.nodes.some(node => node.id === id)))
        return { ok: false, message: 'The source canvas or selection changed during the drag.' };
    if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y)) return { ok: false, message: 'Invalid drag position.' };
    const nodes = plan.nodes.map(node => ({ ...node, position: { x: Math.round(node.position.x + offset.x), y: Math.round(node.position.y + offset.y) } }));
    const next = mergeCanvasNodeAuthoring({ ...canvas, nodes: [...canvas.nodes, ...nodes], edges: [...canvas.edges, ...plan.edges], groups: [...canvas.groups, ...plan.groups],
        sequenceLinks: [...(canvas.sequenceLinks ?? []), ...plan.sequenceLinks], revision: canvas.revision + 1, updatedAt: now }, plan.authoring ?? {});
    const issues = validateCanvasDocument(next);
    if (issues.length) return { ok: false, message: issues[0].message };
    return { ok: true, canvas: next, ids: nodes.map(node => node.id) };
}
