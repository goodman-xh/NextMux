import type { CanvasSequenceLink } from '@nextmux/comic-core/canvas-sequence';
/** Versioned node clipboard. It never submits work or transfers a live generation/upload job. */
import { CanvasError, createCanvasDocument, validateCanvasDocument } from '@nextmux/comic-core/canvas';
import { normalizeScene, normalizeWorld } from '@nextmux/comic-core/director-scene';
import type { CanvasAssetVersion, CanvasDocument, CanvasEdge, CanvasGroup, CanvasNode, CanvasPoint, CanvasValidationIssue } from '@nextmux/comic-core/canvas';
import { canvasId } from './nextmux-comic-canvas-logic';
import { copyCanvasNodeAuthoring, mergeCanvasNodeAuthoring, type CanvasNodeAuthoring } from './nextmux-comic-canvas-node-authoring';

export const CANVAS_CLIPBOARD_FORMAT = 'nextmux.canvas.clipboard' as const;
export const CANVAS_CLIPBOARD_VERSION = 1 as const;

export interface CanvasClipboard {
    readonly format: typeof CANVAS_CLIPBOARD_FORMAT;
    readonly version: typeof CANVAS_CLIPBOARD_VERSION;
    readonly sourceProjectId?: string;
    readonly nodes: readonly CanvasNode[];
    readonly edges: readonly CanvasEdge[];
    readonly groups: readonly CanvasGroup[];
    readonly sequenceLinks?: readonly CanvasSequenceLink[];
    readonly authoring?: CanvasNodeAuthoring;
}

export interface CanvasClipboardRefusal {
    readonly ok: false;
    readonly code: 'CLIPBOARD_FORMAT' | 'CLIPBOARD_VERSION' | 'CLIPBOARD_EMPTY' | 'CLIPBOARD_INVALID' | 'CLIPBOARD_OFFSET' | 'CLIPBOARD_ID';
    readonly message: string;
    readonly issues?: readonly CanvasValidationIssue[];
}

export type CanvasClipboardParseResult = { readonly ok: true; readonly clipboard: CanvasClipboard } | CanvasClipboardRefusal;
export type CanvasClipboardIdKind = 'node' | 'edge' | 'group' | 'character' | 'input' | 'clip' | 'track';
export interface CanvasClipboardPasteOptions {
    readonly offset?: CanvasPoint;
    readonly now?: string;
    /** Inject an allocator for deterministic tests. Collisions are retried; no IDs are reused. */
    readonly createId?: (kind: CanvasClipboardIdKind) => string;
}
export type CanvasClipboardPasteResult = {
    readonly ok: true;
    readonly canvas: CanvasDocument;
    readonly ids: readonly string[];
    readonly idMap: Readonly<Record<string, string>>;
} | CanvasClipboardRefusal & { readonly canvas: CanvasDocument };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const RUNTIME_KEY = /^(jobs?|runs?|jobId|runId|taskId|idempotencyKey|status|progress|error|uploadProgress|generationStatus|sessionId|queuedAt|startedAt|finishedAt|completedAt)$/i;

/** Model parameters can be nested, but executing state must never ride along with them. */
function copyParameters(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    const clean = (item: unknown): unknown => {
        if (Array.isArray(item)) return item.map(clean);
        if (isObject(item)) return Object.fromEntries(Object.entries(item).filter(([key]) => !RUNTIME_KEY.test(key)).map(([key, child]) => [key, clean(child)]));
        return item;
    };
    return clean(value) as Readonly<Record<string, unknown>>;
}

/** Media IDs/URIs remain references. Snapshots, provenance task IDs and unfinished uploads are omitted. */
function mediaReference(version: CanvasAssetVersion): CanvasAssetVersion | undefined {
    if (!version.uri.trim() || version.status === 'uploading') return undefined;
    const metadata = version.metadata;
    return {
        id: version.id, assetId: version.assetId, kind: version.kind, uri: version.uri, createdAt: version.createdAt,
        ...(metadata ? { metadata: {
            ...(metadata.durationMs !== undefined ? { durationMs: metadata.durationMs } : {}),
            ...(metadata.width !== undefined ? { width: metadata.width } : {}),
            ...(metadata.height !== undefined ? { height: metadata.height } : {}),
            ...(metadata.mimeType !== undefined ? { mimeType: metadata.mimeType } : {}),
            ...(metadata.byteLength !== undefined ? { byteLength: metadata.byteLength } : {}),
            ...(metadata.sha256 !== undefined ? { sha256: metadata.sha256 } : {}),
            ...(metadata.frameRate !== undefined ? { frameRate: metadata.frameRate } : {}),
            ...(metadata.hasAudio !== undefined ? { hasAudio: metadata.hasAudio } : {}),
            ...(metadata.streamStartMs !== undefined ? { streamStartMs: metadata.streamStartMs } : {}),
        } } : {}),
        ...(version.status === 'missing' ? { status: 'missing' as const } : {}),
    };
}

/** Whitelist the portable authoring contract rather than copying arbitrary runtime payload properties. */
function portableNode(node: CanvasNode): CanvasNode {
    const base = {
        id: node.id, title: node.title, position: { x: node.position.x, y: node.position.y }, size: { width: node.size.width, height: node.size.height },
        ...(node.createdAt !== undefined ? { createdAt: node.createdAt } : {}),
        ...(node.pinnedColors !== undefined ? { pinnedColors: [...node.pinnedColors] } : {}),
    };
    if (node.kind === 'text') return { ...base, kind: node.kind, payload: { text: node.payload.text } };
    if (node.kind === 'group') return { ...base, kind: node.kind, payload: { groupId: node.payload.groupId } };
    const versions = node.payload.versions.map(mediaReference).filter((version): version is CanvasAssetVersion => !!version);
    const inputs = node.payload.inputs?.flatMap(input => {
        const version = mediaReference(input.version);
        return version ? [{ id: input.id, role: input.role, order: input.order, version }] : [];
    });
    const result = {
        versions,
        ...(versions.some(version => version.id === node.payload.currentVersionId) ? { currentVersionId: node.payload.currentVersionId } : {}),
        ...(inputs ? { inputs } : {}),
    };
    switch (node.kind) {
        case 'imageGen': case 'videoGen': return { ...base, kind: node.kind, payload: { ...result, mode: node.payload.mode, modelId: node.payload.modelId, prompt: node.payload.prompt, parameters: copyParameters(node.payload.parameters) } } as CanvasNode;
        case 'frameExtract': return { ...base, kind: node.kind, payload: { ...result, selection: node.payload.selection.kind === 'time' ? { kind: 'time', timeMs: node.payload.selection.timeMs } : { kind: node.payload.selection.kind } } };
        case 'composition': return { ...base, kind: node.kind, payload: { ...result, parameters: copyParameters(node.payload.parameters), clips: node.payload.clips.map(clip => ({ id: clip.id, assetVersionId: clip.assetVersionId, trackId: clip.trackId, startMs: clip.startMs, inMs: clip.inMs, outMs: clip.outMs, volume: clip.volume, muted: clip.muted })) } };
        case 'character': return { ...base, kind: node.kind, payload: { ...result, characterId: node.payload.characterId, ...(node.payload.description !== undefined ? { description: node.payload.description } : {}), ...(node.payload.appearance !== undefined ? { appearance: node.payload.appearance } : {}) } };
        case 'sceneComposer': return { ...base, kind: node.kind, payload: { ...result, scene: normalizeScene(node.payload.scene) } };
        case 'world': return { ...base, kind: node.kind, payload: { ...result, world: normalizeWorld(node.payload.world) } };
        default: return { ...base, kind: node.kind, payload: result };
    }
}

function portableEdge(edge: CanvasEdge): CanvasEdge {
    return { id: edge.id, sourceNodeId: edge.sourceNodeId, sourcePort: edge.sourcePort, targetNodeId: edge.targetNodeId, targetPort: edge.targetPort, role: edge.role, order: edge.order, binding: edge.binding, ...(edge.pinnedVersionId !== undefined ? { pinnedVersionId: edge.pinnedVersionId } : {}) };
}

function portableGroup(group: CanvasGroup, included: ReadonlySet<string>): CanvasGroup {
    return { id: group.id, title: group.title, nodeIds: [...group.nodeIds], ...(group.parentGroupId && included.has(group.parentGroupId) ? { parentGroupId: group.parentGroupId } : {}) };
}

function clipboardDocument(clipboard: Pick<CanvasClipboard, 'nodes' | 'edges' | 'groups' | 'sequenceLinks' | 'authoring'>): CanvasDocument {
    return { ...createCanvasDocument({ id: 'clipboard-validation', projectId: 'clipboard-validation' }), settings: clipboard.authoring as Readonly<Record<string, unknown>> ?? {}, nodes: clipboard.nodes, edges: clipboard.edges, groups: clipboard.groups, sequenceLinks: clipboard.sequenceLinks };
}

/** Copy selection, recursively including selected groups' descendants and only wires within that selection. */
export function serializeCanvasClipboard(canvas: CanvasDocument, nodeIds: readonly string[]): string {
    const issues = validateCanvasDocument(canvas);
    if (issues.length) throw new CanvasError('CLIPBOARD_INVALID', issues[0].message, issues);
    const nodes = new Map(canvas.nodes.map(node => [node.id, node]));
    const groups = new Map(canvas.groups.map(group => [group.id, group]));
    const selected = new Set(nodeIds.filter(id => nodes.has(id)));
    const includedGroups = new Set<string>();
    const includeGroup = (groupId: string): void => {
        if (includedGroups.has(groupId)) return;
        includedGroups.add(groupId);
        const group = groups.get(groupId)!;
        for (const nodeId of group.nodeIds) {
            selected.add(nodeId);
            const member = nodes.get(nodeId)!;
            if (member.kind === 'group') includeGroup(member.payload.groupId);
        }
        for (const child of canvas.groups.filter(candidate => candidate.parentGroupId === groupId)) includeGroup(child.id);
        for (const node of canvas.nodes) if (node.kind === 'group' && node.payload.groupId === groupId) selected.add(node.id);
    };
    for (const id of [...selected]) {
        const node = nodes.get(id)!;
        if (node.kind === 'group') includeGroup(node.payload.groupId);
    }
    if (!selected.size) throw new CanvasError('CLIPBOARD_EMPTY', 'Select at least one node to copy');
    const authoring = copyCanvasNodeAuthoring(canvas.settings, canvas.nodes.filter(node => selected.has(node.id)));
    const clipboard: CanvasClipboard = {
        format: CANVAS_CLIPBOARD_FORMAT, version: CANVAS_CLIPBOARD_VERSION, sourceProjectId: canvas.projectId,
        sequenceLinks: (canvas.sequenceLinks ?? []).filter(link => selected.has(link.sourceNodeId) && selected.has(link.targetNodeId)),
        nodes: canvas.nodes.filter(node => selected.has(node.id)).map(portableNode),
        edges: canvas.edges.filter(edge => selected.has(edge.sourceNodeId) && selected.has(edge.targetNodeId)).map(portableEdge),
        groups: canvas.groups.filter(group => includedGroups.has(group.id)).map(group => portableGroup(group, includedGroups)),
        ...(Object.keys(authoring).length ? { authoring } : {}),
    };
    return JSON.stringify(clipboard);
}

/** Ordinary text/JSON and unsupported versions are explicit refusals, never text nodes. */
export function parseCanvasClipboard(text: string): CanvasClipboardParseResult {
    let value: unknown;
    try { value = JSON.parse(text); } catch { return { ok: false, code: 'CLIPBOARD_FORMAT', message: 'The clipboard does not contain canvas nodes' }; }
    if (!isObject(value) || value.format !== CANVAS_CLIPBOARD_FORMAT) return { ok: false, code: 'CLIPBOARD_FORMAT', message: 'The clipboard does not contain canvas nodes' };
    if (value.version !== CANVAS_CLIPBOARD_VERSION) return { ok: false, code: 'CLIPBOARD_VERSION', message: 'This canvas clipboard version is not supported' };
    const raw = value as unknown as CanvasClipboard;
    if (raw.authoring !== undefined && !isObject(raw.authoring)) return { ok: false, code: 'CLIPBOARD_INVALID', message: 'The clipboard authoring metadata must be an object' };
    const issues = validateCanvasDocument(clipboardDocument(raw));
    if (issues.length) return { ok: false, code: 'CLIPBOARD_INVALID', message: 'The canvas clipboard has invalid nodes, wires or groups', issues };
    if (!raw.nodes.length) return { ok: false, code: 'CLIPBOARD_EMPTY', message: 'The canvas clipboard has no nodes' };
    let authoring: CanvasNodeAuthoring;
    try { authoring = copyCanvasNodeAuthoring(raw.authoring as Readonly<Record<string, unknown>> ?? {}, raw.nodes); }
    catch (error) { return { ok: false, code: 'CLIPBOARD_INVALID', message: error instanceof Error ? error.message : 'Invalid copied authoring metadata' }; }
    const groupIds = new Set(raw.groups.map(group => group.id));
    const clipboard: CanvasClipboard = {
        format: CANVAS_CLIPBOARD_FORMAT, version: CANVAS_CLIPBOARD_VERSION, ...(typeof raw.sourceProjectId === 'string' ? { sourceProjectId: raw.sourceProjectId } : {}),
        sequenceLinks: raw.sequenceLinks?.map(link => ({ id: link.id, sourceNodeId: link.sourceNodeId, targetNodeId: link.targetNodeId })),
        nodes: raw.nodes.map(portableNode), edges: raw.edges.map(portableEdge), groups: raw.groups.map(group => portableGroup(group, groupIds)),
        ...(Object.keys(authoring).length ? { authoring } : {}),
    };
    return { ok: true, clipboard };
}

/** Paste atomically: new authoring identities, offset world positions, existing media references only. */
export function pasteCanvasClipboard(canvas: CanvasDocument, value: string | CanvasClipboard, options: CanvasClipboardPasteOptions = {}): CanvasClipboardPasteResult {
    let parsed: CanvasClipboardParseResult;
    try { parsed = parseCanvasClipboard(typeof value === 'string' ? value : JSON.stringify(value)); }
    catch { return { ok: false, canvas, code: 'CLIPBOARD_INVALID', message: 'The canvas clipboard is not valid JSON' }; }
    if (!parsed.ok) return { ...parsed, canvas };
    const offset = options.offset ?? { x: 40, y: 40 };
    if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y)) return { ok: false, canvas, code: 'CLIPBOARD_OFFSET', message: 'Paste offset must contain finite coordinates' };
    const clipboard = parsed.clipboard;
    const used = new Set([...canvas.nodes, ...canvas.edges, ...canvas.groups, ...(canvas.sequenceLinks ?? []), ...(clipboard.sequenceLinks ?? []), ...clipboard.nodes, ...clipboard.edges, ...clipboard.groups].map(item => item.id));
    for (const node of [...canvas.nodes, ...clipboard.nodes]) {
        if (node.kind === 'character') used.add(node.payload.characterId);
        if ('inputs' in node.payload) node.payload.inputs?.forEach(input => used.add(input.id));
        if (node.kind === 'composition') node.payload.clips.forEach(clip => { used.add(clip.id); used.add(clip.trackId); });
    }
    const allocate = (kind: CanvasClipboardIdKind): string => {
        for (let attempt = 0; attempt < 100; attempt++) {
            const id = options.createId ? options.createId(kind) : canvasId(`canvas-${kind}`);
            if (typeof id === 'string' && id.trim() && !used.has(id)) { used.add(id); return id; }
        }
        throw new CanvasError('CLIPBOARD_ID', 'Could not allocate new canvas IDs');
    };
    try {
        const nodeIds = new Map(clipboard.nodes.map(node => [node.id, allocate('node')]));
        const groupIds = new Map(clipboard.groups.map(group => [group.id, allocate('group')]));
        const characterIds = new Map<string, string>();
        const trackIds = new Map<string, string>();
        const now = options.now ?? canvas.updatedAt;
        const nodes = clipboard.nodes.map(node => {
            let payload = clone(node.payload);
            if (node.kind === 'group') payload = { groupId: groupIds.get(node.payload.groupId)! };
            else {
                if ('inputs' in payload && payload.inputs) payload = { ...payload, inputs: payload.inputs.map(input => ({ ...input, id: allocate('input') })) };
                if (node.kind === 'character') {
                    if (!characterIds.has(node.payload.characterId)) characterIds.set(node.payload.characterId, clipboard.sourceProjectId === canvas.projectId ? node.payload.characterId : allocate('character'));
                    payload = { ...payload, characterId: characterIds.get(node.payload.characterId)! };
                }
                if (node.kind === 'composition') payload = { ...payload, clips: node.payload.clips.map(clip => {
                    if (!trackIds.has(clip.trackId)) trackIds.set(clip.trackId, allocate('track'));
                    return { ...clip, id: allocate('clip'), trackId: trackIds.get(clip.trackId)! };
                }) };
            }
            return { ...node, id: nodeIds.get(node.id)!, createdAt: now, position: { x: node.position.x + offset.x, y: node.position.y + offset.y }, payload } as CanvasNode;
        });
        const edges = clipboard.edges.map(edge => ({ ...edge, id: allocate('edge'), sourceNodeId: nodeIds.get(edge.sourceNodeId)!, targetNodeId: nodeIds.get(edge.targetNodeId)! }));
        const groups = clipboard.groups.map(group => ({ ...group, id: groupIds.get(group.id)!, nodeIds: group.nodeIds.map(id => nodeIds.get(id)!), ...(group.parentGroupId ? { parentGroupId: groupIds.get(group.parentGroupId)! } : {}) }));
        const sequenceLinks = (clipboard.sequenceLinks ?? []).map(link => ({ id: allocate('edge'), sourceNodeId: nodeIds.get(link.sourceNodeId)!, targetNodeId: nodeIds.get(link.targetNodeId)! }));
        const next = mergeCanvasNodeAuthoring({ ...canvas, sequenceLinks: [...(canvas.sequenceLinks ?? []), ...sequenceLinks], nodes: [...canvas.nodes, ...nodes], edges: [...canvas.edges, ...edges], groups: [...canvas.groups, ...groups], revision: canvas.revision + 1, updatedAt: now },
            copyCanvasNodeAuthoring(clipboard.authoring as Readonly<Record<string, unknown>> ?? {}, clipboard.nodes, nodeIds));
        const issues = validateCanvasDocument(next);
        if (issues.length) return { ok: false, canvas, code: 'CLIPBOARD_INVALID', message: 'The pasted nodes are not valid for this canvas', issues };
        return { ok: true, canvas: next, ids: [...nodeIds.values()], idMap: Object.fromEntries(nodeIds) };
    } catch (error) {
        return { ok: false, canvas, code: 'CLIPBOARD_ID', message: error instanceof Error ? error.message : 'Could not allocate new canvas IDs' };
    }
}
