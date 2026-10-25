/** Cross-canvas media references: confirm the destination before removing anything from the source. */
import { applyCanvasCommand, CanvasError, type CanvasDocument } from '@nextmux/comic-core/canvas';
import { canvasCurrentVersion, canvasNodeBusy } from './nextmux-comic-canvas-logic';
import { pasteCanvasClipboard, serializeCanvasClipboard } from './nextmux-comic-canvas-clipboard';
import { copyCanvasNodeAuthoring } from './nextmux-comic-canvas-node-authoring';

export interface CanvasTransferRequest {
    readonly requestId: string;
    readonly createdAt: string;
    readonly sourceId: string;
    readonly targetId: string;
    readonly nodeIds: readonly string[];
    readonly mode: 'copy' | 'move';
}
export interface CanvasTransferResult { readonly outcome: 'copied' | 'moved' | 'sourceRetained'; readonly target: CanvasDocument; readonly source?: CanvasDocument; }
export interface CanvasTransferIo {
    read(id: string): Promise<CanvasDocument>;
    save(document: CanvasDocument, expectedRevision: number): Promise<CanvasDocument>;
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function prepareCanvasTransfer(source: CanvasDocument, target: CanvasDocument, request: CanvasTransferRequest): { readonly document: CanvasDocument; readonly ids: readonly string[]; readonly alreadySaved: boolean } {
    if (source.id !== request.sourceId || target.id !== request.targetId || source.id === target.id || source.projectId !== target.projectId
        || !/^[a-zA-Z0-9-]{8,80}$/u.test(request.requestId) || !Number.isFinite(Date.parse(request.createdAt)) || !['copy', 'move'].includes(request.mode)
        || !request.nodeIds.length || new Set(request.nodeIds).size !== request.nodeIds.length) throw new CanvasError('CANVAS_TRANSFER_INVALID', 'Choose distinct canvases and media nodes from this project.');
    for (const id of request.nodeIds) {
        const node = source.nodes.find(item => item.id === id), version = node && canvasCurrentVersion(node);
        if (!node || !version?.uri || version.status === 'uploading' || version.status === 'missing') throw new CanvasError('NO_CURRENT_RESULT', 'A selected node has no ready media.');
        if (request.mode === 'move' && canvasNodeBusy(node))
            throw new CanvasError('CANVAS_ACTIVE_JOB', 'Wait for the selected node job before moving it.');
    }
    // Stable IDs make retry after a lost save response recognizable. Never overwrite a
    // partly edited earlier copy, and never duplicate it just because the response was lost.
    const prefix = `canvas-transfer-${request.requestId}-`;
    const original = { ...target, nodes: target.nodes.filter(item => !item.id.startsWith(prefix)), edges: target.edges.filter(item => !item.id.startsWith(prefix)),
        groups: target.groups.filter(item => !item.id.startsWith(prefix)), sequenceLinks: target.sequenceLinks?.filter(item => !item.id.startsWith(prefix)) };
    const nodes = source.nodes.filter(node => request.nodeIds.includes(node.id));
    const left = Math.min(...nodes.map(node => node.position.x));
    const top = Math.min(...nodes.map(node => node.position.y));
    const right = original.nodes.length ? Math.max(...original.nodes.map(node => node.position.x + node.size.width)) + 80 : 80;
    let counter = 0;
    const pasted = pasteCanvasClipboard(original, serializeCanvasClipboard(source, request.nodeIds), {
        now: request.createdAt, offset: { x: right - left, y: 80 - top }, createId: kind => `${prefix}${kind}-${++counter}`
    });
    if (!pasted.ok) throw new CanvasError(pasted.code, pasted.message);
    const existing = target.nodes.filter(node => node.id.startsWith(prefix));
    if (existing.length) {
        const copied = pasted.canvas.nodes.filter(node => node.id.startsWith(prefix));
        const nodeContent = (node: typeof copied[number]): unknown => ({ id: node.id, kind: node.kind, title: node.title, size: node.size, payload: node.payload });
        const match = existing.length === copied.length && copied.every(node => existing.some(item => same(nodeContent(item), nodeContent(node))))
            && pasted.canvas.edges.filter(item => item.id.startsWith(prefix)).every(edge => target.edges.some(item => same(item, edge)))
            && (pasted.canvas.sequenceLinks ?? []).filter(item => item.id.startsWith(prefix)).every(link => (target.sequenceLinks ?? []).some(item => same(item, link)))
            && same(copyCanvasNodeAuthoring(target.settings, existing), copyCanvasNodeAuthoring(pasted.canvas.settings, copied));
        if (!match) throw new CanvasError('CANVAS_TRANSFER_CONFLICT', 'The earlier destination copy changed; its source was retained.');
        return { document: target, ids: pasted.ids, alreadySaved: true };
    }
    return { document: pasted.canvas, ids: pasted.ids, alreadySaved: false };
}

/** IO confirms disk revisions. A source conflict is a completed copy, never a completed move. */
export async function transferCanvasMedia(source: CanvasDocument, target: CanvasDocument, request: CanvasTransferRequest, io: CanvasTransferIo): Promise<CanvasTransferResult> {
    const prepared = prepareCanvasTransfer(source, target, request);
    let savedTarget = prepared.document;
    if (!prepared.alreadySaved) {
        try { savedTarget = await io.save(prepared.document, target.revision); }
        catch (failure) {
            try {
                const latest = await io.read(target.id);
                if (!prepareCanvasTransfer(source, latest, request).alreadySaved) throw failure;
                savedTarget = latest;
            } catch { throw failure; }
        }
    }
    if (!prepareCanvasTransfer(source, savedTarget, request).alreadySaved) throw new CanvasError('CANVAS_TRANSFER_CONFLICT', 'The destination did not retain the transferred media.');
    if (request.mode === 'copy') return { outcome: 'copied', target: savedTarget };
    try {
        const latest = await io.read(source.id);
        // Jobs, edges, or authoring changes made while copying must never be deleted
        // under a snapshot that did not contain them.
        if (!same(latest, source)) return { outcome: 'sourceRetained', target: savedTarget };
        const removed = applyCanvasCommand(latest, { type: 'node.delete', nodeIds: request.nodeIds }, { now: new Date().toISOString() });
        let savedSource: CanvasDocument;
        try { savedSource = await io.save(removed, latest.revision); }
        catch {
            savedSource = await io.read(source.id);
            if (request.nodeIds.some(id => savedSource.nodes.some(node => node.id === id))) return { outcome: 'sourceRetained', target: savedTarget };
        }
        return { outcome: 'moved', target: savedTarget, source: savedSource };
    } catch { return { outcome: 'sourceRetained', target: savedTarget }; }
}
