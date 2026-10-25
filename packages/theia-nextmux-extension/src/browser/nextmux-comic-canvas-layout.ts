/** Pure arrangements. Spacing is a gap after node bounds, never a fixed centre pitch. */
import type { CanvasDocument, CanvasNode, CanvasPoint } from '@nextmux/comic-core/canvas';
import { canvasGroupDescendantIds, canvasNodeParentGroupId } from './nextmux-comic-canvas-groups';
import { normalizeCanvasSettings } from './nextmux-comic-canvas-settings';

export interface CanvasArrangeOptions {
    readonly mode?: 'wires' | 'grid' | 'order';
    readonly sortBy?: 'position' | 'createdAt' | 'name';
    readonly direction?: 'ascending' | 'descending';
    readonly flow?: 'rows' | 'columns';
    readonly rows?: number;
    readonly columns?: number;
    readonly order?: readonly string[];
    readonly origin?: CanvasPoint;
    readonly groupId?: string;
    readonly settings?: unknown;
    /** Optional timestamps for historical canvases whose nodes predate createdAt. */
    readonly creationTimes?: Readonly<Record<string, string>>;
    readonly locale?: string;
}

export interface CanvasNodePosition {
    readonly nodeId: string;
    readonly position: CanvasPoint;
}

function creationTime(node: CanvasNode, canvas: CanvasDocument, options: CanvasArrangeOptions): number {
    const supplied = Date.parse(options.creationTimes?.[node.id] ?? node.createdAt ?? '');
    if (Number.isFinite(supplied)) return supplied;
    if ('versions' in node.payload) {
        const oldest = Math.min(...node.payload.versions.map(version => Date.parse(version.createdAt)).filter(Number.isFinite));
        if (Number.isFinite(oldest)) return oldest;
    }
    return Date.parse(canvas.createdAt);
}

function positiveCount(value: number | undefined, max: number): number | undefined {
    return value !== undefined && Number.isFinite(value) && value >= 1 ? Math.min(max, Math.floor(value)) : undefined;
}

/** Return absolute positions for selected roots; moving a group through comic-core also moves its descendants. */
export function arrangeCanvas(canvas: CanvasDocument, nodeIds: readonly string[], options: CanvasArrangeOptions = {}): readonly CanvasNodePosition[] {
    const selected = new Set(nodeIds);
    const excluded = new Set<string>();
    canvas.nodes.filter(node => selected.has(node.id) && node.kind === 'group').forEach(node => {
        if (node.kind === 'group') canvasGroupDescendantIds(canvas, node.payload.groupId).forEach(id => excluded.add(id));
    });
    const nodes = canvas.nodes.filter(node => selected.has(node.id) && !excluded.has(node.id));
    if (!nodes.length) return [];
    const index = new Map(canvas.nodes.map((node, at) => [node.id, at]));
    const collator = new Intl.Collator(options.locale, { numeric: true, sensitivity: 'base' });
    const sign = options.direction === 'descending' ? -1 : 1;
    nodes.sort((left, right) => {
        const difference = options.sortBy === 'name' ? collator.compare(left.title, right.title)
            : options.sortBy === 'createdAt' ? creationTime(left, canvas, options) - creationTime(right, canvas, options)
                : left.position.y - right.position.y || left.position.x - right.position.x;
        return sign * (difference || index.get(left.id)! - index.get(right.id)!);
    });
    if (options.mode === 'order' && options.order) {
        const order = new Map([...new Set(options.order)].map((id, at) => [id, at]));
        const sortedIndex = new Map(nodes.map((node, at) => [node.id, at]));
        nodes.sort((left, right) => (order.get(left.id) ?? Infinity) - (order.get(right.id) ?? Infinity)
            || sortedIndex.get(left.id)! - sortedIndex.get(right.id)!);
    }
    const settings = normalizeCanvasSettings(options.settings ?? canvas.settings);
    const owners = new Set(nodes.map(node => canvasNodeParentGroupId(canvas, node.id)));
    const groupId = options.groupId ?? (owners.size === 1 ? [...owners][0] : undefined);
    const groupNode = canvas.nodes.find(node => node.kind === 'group' && node.payload.groupId === groupId);
    const origin = options.origin ?? (groupNode ? { x: groupNode.position.x + settings.groupPadding, y: groupNode.position.y + settings.groupPadding }
        : { x: Math.min(...nodes.map(node => node.position.x)), y: Math.min(...nodes.map(node => node.position.y)) });
    if (options.mode === 'wires') return wirePositions(canvas, nodes, origin, settings.arrangeHorizontalSpacing, settings.arrangeVerticalSpacing);
    const rows = positiveCount(options.rows, nodes.length);
    const explicitColumns = positiveCount(options.columns, nodes.length);
    const columns = explicitColumns ?? (rows ? Math.ceil(nodes.length / rows) : Math.ceil(Math.sqrt(nodes.length)));
    const rowCount = rows && !explicitColumns ? rows : Math.ceil(nodes.length / columns);
    const cells = nodes.map((node, at) => ({ node, column: options.flow === 'columns' ? Math.floor(at / rowCount) : at % columns,
        row: options.flow === 'columns' ? at % rowCount : Math.floor(at / columns) }));
    const widths: number[] = [], heights: number[] = [];
    for (const cell of cells) {
        widths[cell.column] = Math.max(widths[cell.column] ?? 0, cell.node.size.width);
        heights[cell.row] = Math.max(heights[cell.row] ?? 0, cell.node.size.height);
    }
    const offset = (sizes: readonly number[], at: number, gap: number): number => sizes.slice(0, at).reduce((sum, size) => sum + size + gap, 0);
    return cells.map(cell => ({ nodeId: cell.node.id, position: { x: origin.x + offset(widths, cell.column, settings.arrangeHorizontalSpacing),
        y: origin.y + offset(heights, cell.row, settings.arrangeVerticalSpacing) } }));
}

function wirePositions(canvas: CanvasDocument, nodes: readonly CanvasNode[], origin: CanvasPoint, horizontalGap: number, verticalGap: number): readonly CanvasNodePosition[] {
    const roots = new Map<string, string>();
    for (const node of nodes) {
        roots.set(node.id, node.id);
        if (node.kind === 'group') canvasGroupDescendantIds(canvas, node.payload.groupId).forEach(id => roots.set(id, node.id));
    }
    const graph = new Map<string, Set<string>>();
    for (const edge of canvas.edges) {
        const source = canvas.nodes.find(node => node.id === edge.sourceNodeId);
        const sourceIds = [edge.sourceNodeId, ...(source?.kind === 'group' ? canvasGroupDescendantIds(canvas, source.payload.groupId) : [])];
        for (const sourceId of sourceIds) {
            const targets = graph.get(sourceId) ?? new Set<string>();
            targets.add(edge.targetNodeId);
            graph.set(sourceId, targets);
        }
    }
    const successors = new Map(nodes.map(node => [node.id, new Set<string>()]));
    // Traverse through unselected intermediaries so a partial selection still respects dependencies.
    for (const node of nodes) {
        const pending = [...roots].filter(([, root]) => root === node.id).map(([id]) => id);
        const seen = new Set(pending);
        for (let at = 0; at < pending.length; at++) for (const target of graph.get(pending[at]) ?? []) {
            const root = roots.get(target);
            if (root && root !== node.id) successors.get(node.id)!.add(root);
            if (!seen.has(target)) { seen.add(target); pending.push(target); }
        }
    }
    const indegree = new Map(nodes.map(node => [node.id, 0]));
    successors.forEach(targets => targets.forEach(id => indegree.set(id, indegree.get(id)! + 1)));
    const ranks = new Map(nodes.map(node => [node.id, 0]));
    const pending = nodes.filter(node => indegree.get(node.id) === 0).map(node => node.id);
    for (let at = 0; at < pending.length; at++) for (const target of successors.get(pending[at])!) {
        ranks.set(target, Math.max(ranks.get(target)!, ranks.get(pending[at])! + 1));
        indegree.set(target, indegree.get(target)! - 1);
        if (indegree.get(target) === 0) pending.push(target);
    }
    // Invalid imported cycles still produce deterministic positions rather than an endless walk.
    const lastRank = Math.max(...ranks.values()) + 1;
    nodes.filter(node => indegree.get(node.id)! > 0).forEach(node => ranks.set(node.id, lastRank));
    const layers: CanvasNode[][] = [];
    for (const node of nodes) (layers[ranks.get(node.id)!] ??= []).push(node);
    const positions: CanvasNodePosition[] = [];
    let x = origin.x;
    for (const layer of layers) {
        if (!layer) continue;
        let y = origin.y;
        for (const node of layer) {
            positions.push({ nodeId: node.id, position: { x, y } });
            y += node.size.height + verticalGap;
        }
        x += Math.max(...layer.map(node => node.size.width)) + horizontalGap;
    }
    return positions;
}
