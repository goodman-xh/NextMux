/** World-coordinate grouping and drag membership; no UI or model work. */
import { applyCanvasCommand, CanvasError } from '@nextmux/comic-core/canvas';
import type { CanvasDocument, CanvasGroup, CanvasGroupNode, CanvasNode, CanvasPoint, CanvasSize } from '@nextmux/comic-core/canvas';
import { canvasId } from './nextmux-comic-canvas-logic';
import { normalizeCanvasSettings } from './nextmux-comic-canvas-settings';

export const CANVAS_GROUP_NODE_LIMIT = 60;

export interface CanvasGroupOptions {
    readonly groupId?: string;
    readonly nodeId?: string;
    readonly title?: string;
    readonly parentGroupId?: string;
    readonly settings?: unknown;
    readonly now?: string;
}

export interface CanvasGroupRefusal {
    readonly ok: false;
    readonly canvas: CanvasDocument;
    readonly code: string;
    readonly message: string;
    readonly count: number;
    readonly limit: typeof CANVAS_GROUP_NODE_LIMIT;
}

export type CanvasGroupingResult = CanvasGroupRefusal | {
    readonly ok: true;
    readonly canvas: CanvasDocument;
    readonly group: CanvasGroup;
    readonly node: CanvasGroupNode;
    readonly count: number;
    readonly limit: typeof CANVAS_GROUP_NODE_LIMIT;
};

/** Immediate group owner, including groups represented only by a parent link. */
export function canvasNodeParentGroupId(canvas: CanvasDocument, nodeId: string): string | undefined {
    const node = canvas.nodes.find(candidate => candidate.id === nodeId);
    return (node?.kind === 'group' ? canvas.groups.find(group => group.id === node.payload.groupId)?.parentGroupId : undefined)
        ?? canvas.groups.find(group => group.nodeIds.includes(nodeId))?.id;
}

/** All descendant node IDs, including nested group cards, de-duplicated in member order. */
export function canvasGroupDescendantIds(canvas: CanvasDocument, groupId: string): readonly string[] {
    const nodes = new Map(canvas.nodes.map(node => [node.id, node]));
    const groups = new Map(canvas.groups.map(group => [group.id, group]));
    const ids = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
        if (visited.has(id)) return;
        visited.add(id);
        const group = groups.get(id);
        if (!group) return;
        for (const nodeId of group.nodeIds) {
            ids.add(nodeId);
            const node = nodes.get(nodeId);
            if (node?.kind === 'group') visit(node.payload.groupId);
        }
        for (const child of canvas.groups.filter(candidate => candidate.parentGroupId === id)) {
            for (const node of canvas.nodes) if (node.kind === 'group' && node.payload.groupId === child.id) ids.add(node.id);
            visit(child.id);
        }
    };
    visit(groupId);
    return [...ids];
}

function ancestorIds(canvas: CanvasDocument, groupId: string | undefined): readonly string[] {
    const ids = new Set<string>();
    while (groupId && !ids.has(groupId)) {
        ids.add(groupId);
        const card = canvas.nodes.find(node => node.kind === 'group' && node.payload.groupId === groupId);
        groupId = canvas.groups.find(group => group.id === groupId)?.parentGroupId
            ?? (card ? canvasNodeParentGroupId(canvas, card.id) : undefined);
    }
    return [...ids];
}

function directMemberIds(canvas: CanvasDocument, groupId: string): readonly string[] {
    const ids = new Set(canvas.groups.find(group => group.id === groupId)?.nodeIds ?? []);
    for (const node of canvas.nodes) if (node.kind === 'group' && canvasNodeParentGroupId(canvas, node.id) === groupId) ids.add(node.id);
    return [...ids];
}

function rootSelection(canvas: CanvasDocument, nodeIds: readonly string[]): readonly CanvasNode[] {
    const chosen = new Set(nodeIds);
    const selectedGroupIds = new Set(canvas.nodes.filter(node => chosen.has(node.id) && node.kind === 'group').map(node => (node as CanvasGroupNode).payload.groupId));
    return canvas.nodes.filter(node => chosen.has(node.id) && !ancestorIds(canvas, canvasNodeParentGroupId(canvas, node.id)).some(id => selectedGroupIds.has(id)));
}

function bounds(nodes: readonly CanvasNode[], padding: number): { readonly position: CanvasPoint; readonly size: CanvasSize } {
    const left = Math.min(...nodes.map(node => node.position.x));
    const top = Math.min(...nodes.map(node => node.position.y));
    const right = Math.max(...nodes.map(node => node.position.x + node.size.width));
    const bottom = Math.max(...nodes.map(node => node.position.y + node.size.height));
    return { position: { x: left - padding, y: top - padding }, size: { width: right - left + padding * 2, height: bottom - top + padding * 2 } };
}

function refusal(canvas: CanvasDocument, code: string, message: string, count: number): CanvasGroupRefusal {
    return { ok: false, canvas, code, message, count, limit: CANVAS_GROUP_NODE_LIMIT };
}

/** Create a group through comic-core, preserving every member's world position. */
export function groupCanvasNodes(canvas: CanvasDocument, nodeIds: readonly string[], options: CanvasGroupOptions = {}): CanvasGroupingResult {
    const requested = [...new Set(nodeIds)];
    if (!requested.length) return refusal(canvas, 'EMPTY_SELECTION', 'Select at least one node to create a group.', 0);
    const missing = requested.find(id => !canvas.nodes.some(node => node.id === id));
    if (missing) return refusal(canvas, 'NODE_MISSING', `Canvas node ${missing} does not exist.`, requested.length);
    const selected = rootSelection(canvas, requested);
    const allIds = new Set(selected.map(node => node.id));
    selected.forEach(node => { if (node.kind === 'group') canvasGroupDescendantIds(canvas, node.payload.groupId).forEach(id => allIds.add(id)); });
    const count = allIds.size;
    if (count > CANVAS_GROUP_NODE_LIMIT) return refusal(canvas, 'GROUP_LIMIT', `This group would contain ${count} nodes; the limit is ${CANVAS_GROUP_NODE_LIMIT}.`, count);
    const owners = new Set(selected.map(node => canvasNodeParentGroupId(canvas, node.id)));
    const parentGroupId = options.parentGroupId ?? (owners.size === 1 ? [...owners][0] : undefined);
    if (parentGroupId && !canvas.groups.some(group => group.id === parentGroupId)) return refusal(canvas, 'GROUP_PARENT', `Canvas group ${parentGroupId} does not exist.`, count);
    if (parentGroupId && selected.some(node => node.kind === 'group' && (node.payload.groupId === parentGroupId
        || ancestorIds(canvas, parentGroupId).includes(node.payload.groupId)))) return refusal(canvas, 'GROUP_CYCLE', 'A group cannot be placed inside itself or one of its descendants.', count);
    const group: CanvasGroup = { id: options.groupId ?? canvasId('canvas-group'), title: options.title ?? 'New group', nodeIds: selected.map(node => node.id),
        ...(parentGroupId ? { parentGroupId } : {}) };
    const box = bounds(canvas.nodes.filter(node => allIds.has(node.id)), normalizeCanvasSettings(options.settings ?? canvas.settings).groupPadding);
    const node: CanvasGroupNode = { id: options.nodeId ?? canvasId('canvas-node'), kind: 'group', title: group.title, ...box, payload: { groupId: group.id } };
    try {
        const next = applyCanvasCommand(canvas, { type: 'group.create', group, node }, { now: options.now });
        for (const id of ancestorIds(next, parentGroupId)) {
            const ancestorCount = canvasGroupDescendantIds(next, id).length;
            if (ancestorCount > CANVAS_GROUP_NODE_LIMIT) return refusal(canvas, 'GROUP_LIMIT', `This group would contain ${ancestorCount} nodes; the limit is ${CANVAS_GROUP_NODE_LIMIT}.`, ancestorCount);
        }
        return { ok: true, canvas: next, group, node: next.nodes.find(candidate => candidate.id === node.id) as CanvasGroupNode, count, limit: CANVAS_GROUP_NODE_LIMIT };
    } catch (error) {
        if (error instanceof CanvasError) return refusal(canvas, error.code, error.message, count);
        throw error;
    }
}

/** Ungroup through comic-core; children return to the parent and retain world coordinates. */
export function ungroupCanvas(canvas: CanvasDocument, groupId: string, now?: string): CanvasDocument {
    return applyCanvasCommand(canvas, { type: 'group.ungroup', groupId }, { now });
}

export type CanvasMembershipResult = CanvasGroupRefusal | {
    readonly ok: true;
    readonly canvas: CanvasDocument;
    readonly fromGroupId?: string;
    readonly toGroupId?: string;
    readonly changed: boolean;
};

/** After a drag, choose the deepest containing group by node centre, excluding cyclic destinations. */
export function updateCanvasNodeMembership(canvas: CanvasDocument, nodeId: string, now?: string): CanvasMembershipResult {
    const node = canvas.nodes.find(candidate => candidate.id === nodeId);
    if (!node) return refusal(canvas, 'NODE_MISSING', `Canvas node ${nodeId} does not exist.`, 0);
    const centre = { x: node.position.x + node.size.width / 2, y: node.position.y + node.size.height / 2 };
    const fromGroupId = canvasNodeParentGroupId(canvas, nodeId);
    const candidates = canvas.nodes.filter((candidate): candidate is CanvasGroupNode => candidate.kind === 'group'
        && candidate.id !== nodeId && centre.x >= candidate.position.x && centre.x <= candidate.position.x + candidate.size.width
        && centre.y >= candidate.position.y && centre.y <= candidate.position.y + candidate.size.height
        && (node.kind !== 'group' || !ancestorIds(canvas, candidate.payload.groupId).includes(node.payload.groupId)));
    candidates.sort((left, right) => ancestorIds(canvas, right.payload.groupId).length - ancestorIds(canvas, left.payload.groupId).length
        || left.size.width * left.size.height - right.size.width * right.size.height || left.id.localeCompare(right.id));
    const toGroupId = candidates[0]?.payload.groupId;
    if (fromGroupId === toGroupId) return { ok: true, canvas, fromGroupId, toGroupId, changed: false };
    if (toGroupId) {
        const moving = new Set([nodeId, ...(node.kind === 'group' ? canvasGroupDescendantIds(canvas, node.payload.groupId) : [])]);
        for (const id of ancestorIds(canvas, toGroupId)) {
            const combined = new Set([...canvasGroupDescendantIds(canvas, id), ...moving]);
            if (combined.size > CANVAS_GROUP_NODE_LIMIT) return refusal(canvas, 'GROUP_LIMIT', `This group would contain ${combined.size} nodes; the limit is ${CANVAS_GROUP_NODE_LIMIT}.`, combined.size);
        }
    }
    try {
        let next = canvas;
        if (fromGroupId) {
            next = applyCanvasCommand(next, { type: 'group.setMembers', groupId: fromGroupId, nodeIds: directMemberIds(next, fromGroupId).filter(id => id !== nodeId) }, { now });
        }
        if (toGroupId) {
            next = applyCanvasCommand(next, { type: 'group.setMembers', groupId: toGroupId, nodeIds: [...directMemberIds(next, toGroupId), nodeId] }, { now });
        }
        return { ok: true, canvas: next, fromGroupId, toGroupId, changed: true };
    } catch (error) {
        if (error instanceof CanvasError) return refusal(canvas, error.code, error.message, 0);
        throw error;
    }
}
