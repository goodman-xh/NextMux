/**
 * 画布 — pure helpers for the comic canvas view: which input role a new connection takes, switching a node's
 * mode without leaving wires the new mode cannot take, where a new node goes, duplicates, and rebasing local
 * edits on the copy the desktop service saved (it adds results and job states while the user keeps editing).
 *
 * No React and no styles here, so the rules are tested directly (test/comic-canvas-logic.test.mjs).
 */
import { applyCanvasCommand, validateCanvasEdge } from '@nextmux/comic-core/canvas';
import { SCENE_ASPECT_RATIOS, createSceneDocument, normalizeWorld } from '@nextmux/comic-core/director-scene';
import { copyCanvasNodeAuthoring, mergeCanvasNodeAuthoring } from './nextmux-comic-canvas-node-authoring';
import type {
    CanvasAssetVersion, CanvasCommand, CanvasDirectInput, CanvasDocument, CanvasEdge, CanvasGenerationJob, CanvasGenerationMode, CanvasInputRole, CanvasNode, CanvasNodeKind, CanvasPoint, CanvasSize
} from '@nextmux/comic-core/canvas';

export type CanvasOutputKind = 'text' | 'image' | 'video' | 'audio' | 'character' | 'group';
export type CanvasAddKind = 'text' | 'imageGen' | 'videoGen' | 'frameExtract' | 'composition' | 'sceneComposer' | 'world';

export const CANVAS_ACTIVE_JOB = new Set(['reserved', 'awaiting_confirmation', 'queued', 'running', 'paused', 'interrupted']);
export const CANVAS_DEFAULT_SIZE: CanvasSize = { width: 360, height: 260 };

export function canvasOutputKind(node: CanvasNode): CanvasOutputKind {
    switch (node.kind) {
        case 'imageGen': case 'frameExtract': case 'image': return 'image';
        case 'videoGen': case 'composition': case 'video': return 'video';
        case 'sceneComposer': case 'world': return canvasCurrentVersion(node)?.kind ?? 'image';
        default: return node.kind;
    }
}

export function canvasCurrentVersion(node: CanvasNode | undefined): CanvasAssetVersion | undefined {
    if (!node || !('versions' in node.payload)) return undefined;
    const payload = node.payload;
    return payload.versions.find(version => version.id === payload.currentVersionId);
}

/** The newest job of a generation node (the service keeps one summary per click). */
export function canvasLatestJob(node: CanvasNode | undefined): CanvasGenerationJob | undefined {
    if (!node || (node.kind !== 'imageGen' && node.kind !== 'videoGen')) return undefined;
    return [...(node.payload.jobs ?? [])].sort((left, right) => left.createdAt.localeCompare(right.createdAt)).at(-1);
}

/** Busy while any of its jobs is still active, the same rule the canvas service applies before it accepts a new run. */
export function canvasNodeBusy(node: CanvasNode | undefined): boolean {
    if (!node || (node.kind !== 'imageGen' && node.kind !== 'videoGen')) return false;
    return (node.payload.jobs ?? []).some(job => CANVAS_ACTIVE_JOB.has(job.status));
}

/** Which roles a node's current mode takes (mirrors comic-core's rule so menus never offer a refused role). */
export function canvasRolesFor(node: CanvasNode): readonly CanvasInputRole[] {
    if (node.kind === 'frameExtract') return ['referenceVideo'];
    if (node.kind === 'composition') return ['compositionVideo', 'compositionAudio'];
    if (node.kind === 'sceneComposer' || node.kind === 'world') return ['referenceImage'];
    if (node.kind !== 'imageGen' && node.kind !== 'videoGen') return [];
    const own: Record<CanvasGenerationMode, readonly CanvasInputRole[]> = {
        textToImage: [], textToVideo: [], imageToImage: ['referenceImage'],
        imageToVideo: ['firstFrame', 'referenceAudio'], firstLastFrame: ['firstFrame', 'lastFrame', 'referenceAudio'],
        referenceToVideo: ['referenceImage', 'referenceVideo', 'referenceAudio'], videoEdit: ['referenceImage', 'referenceVideo', 'referenceAudio'],
        videoExtend: ['referenceImage', 'referenceVideo', 'referenceAudio']
    };
    return ['prompt', 'character', ...own[node.payload.mode]];
}

export function canvasRoleKind(role: CanvasInputRole): 'text' | 'character' | 'image' | 'video' | 'audio' {
    switch (role) {
        case 'prompt': return 'text';
        case 'character': return 'character';
        case 'firstFrame': case 'lastFrame': case 'referenceImage': return 'image';
        case 'referenceVideo': case 'compositionVideo': return 'video';
        case 'referenceAudio': case 'compositionAudio': return 'audio';
    }
}

function edgesInto(canvas: CanvasDocument, nodeId: string, role?: CanvasInputRole): readonly CanvasEdge[] {
    return canvas.edges.filter(edge => edge.targetNodeId === nodeId && (!role || edge.role === role));
}

/** A new connection: the role it takes and, when the target's mode cannot take it, the mode to switch to first. */
export interface CanvasConnectionPlan {
    readonly role: CanvasInputRole;
    readonly mode?: CanvasGenerationMode;
}

export function planCanvasConnection(canvas: CanvasDocument, sourceId: string, targetId: string): CanvasConnectionPlan | undefined {
    const source = canvas.nodes.find(node => node.id === sourceId);
    const target = canvas.nodes.find(node => node.id === targetId);
    if (!source || !target || source.id === target.id) return undefined;
    const kind = canvasOutputKind(source);
    const hasInput = (role: CanvasInputRole): boolean => edgesInto(canvas, target.id, role).length > 0
        || Boolean('inputs' in target.payload && target.payload.inputs?.some(input => input.role === role));
    if (target.kind === 'frameExtract') return kind === 'video' ? { role: 'referenceVideo' } : undefined;
    if (target.kind === 'composition') return kind === 'video' ? { role: 'compositionVideo' } : kind === 'audio' ? { role: 'compositionAudio' } : undefined;
    if (target.kind === 'sceneComposer' || target.kind === 'world') return kind === 'image' ? { role: 'referenceImage' } : undefined;
    if (target.kind !== 'imageGen' && target.kind !== 'videoGen') return undefined;
    const mode = target.payload.mode;
    if (kind === 'text') return { role: 'prompt' };
    if (kind === 'character') {
        // A portrait the model can look at beats a description; a first-frame clip keeps its frame and gets the description.
        const picture = Boolean(canvasCurrentVersion(source));
        if (picture && target.kind === 'imageGen') return { role: 'referenceImage', ...(mode === 'textToImage' ? { mode: 'imageToImage' as const } : {}) };
        if (picture && target.kind === 'videoGen' && ['referenceToVideo', 'videoEdit', 'videoExtend'].includes(mode)) return { role: 'referenceImage' };
        return { role: 'character' };
    }
    if (kind === 'image') {
        if (target.kind === 'imageGen') return { role: 'referenceImage', ...(mode === 'textToImage' ? { mode: 'imageToImage' as const } : {}) };
        if (mode === 'textToVideo') return { role: 'firstFrame', mode: 'imageToVideo' };
        if (mode === 'imageToVideo') return hasInput('firstFrame') ? { role: 'lastFrame', mode: 'firstLastFrame' } : { role: 'firstFrame' };
        if (mode === 'firstLastFrame') {
            if (!hasInput('firstFrame')) return { role: 'firstFrame' };
            if (!hasInput('lastFrame')) return { role: 'lastFrame' };
            return { role: 'referenceImage', mode: 'referenceToVideo' };
        }
        return { role: 'referenceImage' };
    }
    if (kind === 'video') {
        if (target.kind === 'imageGen') return undefined;
        return { role: 'referenceVideo', ...(['textToVideo', 'imageToVideo', 'firstLastFrame'].includes(mode) ? { mode: 'referenceToVideo' as const } : {}) };
    }
    if (kind === 'audio') {
        if (target.kind === 'imageGen') return undefined;
        return { role: 'referenceAudio', ...(mode === 'textToVideo' ? { mode: 'referenceToVideo' as const } : {}) };
    }
    return undefined;
}

/** The roles a wire into this node may take instead (the edge menu): the source's kind decides, the mode follows. */
export function canvasAlternativeRoles(canvas: CanvasDocument, edge: CanvasEdge): readonly CanvasInputRole[] {
    const source = canvas.nodes.find(node => node.id === edge.sourceNodeId);
    const target = canvas.nodes.find(node => node.id === edge.targetNodeId);
    if (!source || !target) return [];
    const kind = canvasOutputKind(source);
    if (target.kind === 'videoGen' && kind === 'image') return ['firstFrame', 'lastFrame', 'referenceImage'];
    if (target.kind === 'videoGen' && kind === 'character') return canvasCurrentVersion(source) ? ['character', 'referenceImage'] : ['character'];
    if (target.kind === 'imageGen' && kind === 'character') return canvasCurrentVersion(source) ? ['character', 'referenceImage'] : ['character'];
    return [edge.role];
}

/** The mode a video node needs for a set of input roles (the edge menu changes one role at a time). */
function videoModeFor(roles: readonly CanvasInputRole[], current: CanvasGenerationMode): CanvasGenerationMode {
    if (roles.includes('referenceImage') || roles.includes('referenceVideo')) return ['videoEdit', 'videoExtend'].includes(current) ? current : 'referenceToVideo';
    if (roles.includes('lastFrame')) return 'firstLastFrame';
    if (roles.includes('firstFrame')) return 'imageToVideo';
    return roles.includes('referenceAudio') ? (current === 'textToVideo' ? 'referenceToVideo' : current) : 'textToVideo';
}

let counter = 0;
export function canvasId(prefix: string): string {
    const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}-${random}`;
}

function nextOrder(canvas: CanvasDocument, targetId: string, role: CanvasInputRole): number {
    return edgesInto(canvas, targetId, role).reduce((max, edge) => Math.max(max, edge.order + 1), 0);
}

function apply(canvas: CanvasDocument, commands: readonly CanvasCommand[], now: string): CanvasDocument {
    return commands.reduce((document, command) => applyCanvasCommand(document, command, { now }), canvas);
}

/**
 * Change a generation node's mode. Wires the new mode cannot take are re-roled where the meaning carries over
 * (a first frame becomes a reference picture and back); the rest are disconnected and listed in `dropped`.
 */
export function switchCanvasMode(canvas: CanvasDocument, nodeId: string, mode: CanvasGenerationMode, now: string): { readonly canvas: CanvasDocument; readonly dropped: readonly CanvasEdge[]; readonly droppedInputs?: readonly CanvasDirectInput[] } {
    const node = canvas.nodes.find(item => item.id === nodeId);
    if (!node || (node.kind !== 'imageGen' && node.kind !== 'videoGen') || node.payload.mode === mode) return { canvas, dropped: [] };
    const probe = { ...node, payload: { ...node.payload, mode } } as CanvasNode;
    const allowed = new Set(canvasRolesFor(probe));
    const incoming = edgesInto(canvas, nodeId);
    const move = incoming.filter(edge => !allowed.has(edge.role));
    const direct = node.payload.inputs ?? [];
    const inputs: CanvasDirectInput[] = direct.filter(input => allowed.has(input.role));
    const movingInputs = direct.filter(input => !allowed.has(input.role));
    // Remove old direct roles before setParameters validates the new mode; the caller commits this result once.
    let next: CanvasDocument = movingInputs.length ? { ...canvas, nodes: canvas.nodes.map(item => item.id === nodeId ? { ...node, payload: { ...node.payload, inputs } } as CanvasNode : item) } : canvas;
    next = apply(next, move.map(edge => ({ type: 'edge.disconnect', edgeId: edge.id } as const)), now);
    next = applyCanvasCommand(next, { type: 'node.setParameters', nodeId, parameters: node.payload.parameters, mode }, { now });
    const dropped: CanvasEdge[] = [], droppedInputs: CanvasDirectInput[] = [];
    const candidates = (role: CanvasInputRole): readonly CanvasInputRole[] => {
        const kind = canvasRoleKind(role);
        return (kind === 'image' ? ['firstFrame', 'lastFrame', 'referenceImage'] : kind === 'video' ? ['referenceVideo'] : kind === 'audio' ? ['referenceAudio'] : [])
            .filter(item => allowed.has(item as CanvasInputRole)) as CanvasInputRole[];
    };
    for (const edge of move) {
        let placed = false;
        for (const role of candidates(edge.role)) {
            const moved: CanvasEdge = { ...edge, id: canvasId('canvas-edge'), role, targetPort: role, order: nextOrder(next, nodeId, role) };
            if (validateCanvasEdge(next, moved).length) continue;
            next = applyCanvasCommand(next, { type: 'edge.connect', edge: moved }, { now });
            placed = true;
            break;
        }
        if (!placed) dropped.push(edge);
    }
    for (const input of movingInputs) {
        const role = candidates(input.role).find(candidate => !['firstFrame', 'lastFrame'].includes(candidate)
            || !edgesInto(next, nodeId, candidate).length && !inputs.some(item => item.role === candidate));
        if (!role) { droppedInputs.push(input); continue; }
        const order = Math.max(nextOrder(next, nodeId, role), ...inputs.filter(item => item.role === role).map(item => item.order + 1));
        inputs.push({ ...input, role, order });
    }
    if (movingInputs.length) {
        const byId = new Map(inputs.map(input => [input.id, input]));
        next = { ...next, nodes: next.nodes.map(item => item.id === nodeId && (item.kind === 'imageGen' || item.kind === 'videoGen')
            ? { ...item, payload: { ...item.payload, inputs: direct.flatMap(input => byId.has(input.id) ? [byId.get(input.id)!] : []) } } as CanvasNode : item) };
    }
    return { canvas: next, dropped, ...(droppedInputs.length ? { droppedInputs } : {}) };
}

/** Connect `sourceId` → `targetId` with the planned (or given) role, switching the target's mode first when needed. */
export function connectCanvasNodes(canvas: CanvasDocument, sourceId: string, targetId: string, now: string, role?: CanvasInputRole):
    { readonly canvas: CanvasDocument; readonly edge?: CanvasEdge; readonly error?: string; readonly dropped?: readonly CanvasEdge[] } {
    const plan = role ? { role } as CanvasConnectionPlan : planCanvasConnection(canvas, sourceId, targetId);
    if (!plan) return { canvas, error: 'ROLE_TYPE' };
    let next = canvas;
    let dropped: readonly CanvasEdge[] = [];
    const target = canvas.nodes.find(node => node.id === targetId);
    let mode = plan.mode;
    if (!mode && role && target?.kind === 'videoGen') {
        const roles = [...edgesInto(canvas, targetId).map(edge => edge.role), ...(target.payload.inputs ?? []).map(input => input.role), role];
        // A first/last-frame draft is incomplete after its first image is chosen;
        // keep the user's mode while the second frame is still being selected.
        const wanted = target.payload.mode === 'firstLastFrame' && roles.every(input => input === 'firstFrame' || input === 'lastFrame' || input === 'prompt' || input === 'character')
            ? 'firstLastFrame' : videoModeFor(roles, target.payload.mode);
        if (wanted !== target.payload.mode) mode = wanted;
    }
    if (!mode && role && target?.kind === 'imageGen' && role === 'referenceImage' && target.payload.mode === 'textToImage') mode = 'imageToImage';
    if (mode) ({ canvas: next, dropped } = switchCanvasMode(next, targetId, mode, now));
    const edge: CanvasEdge = { id: canvasId('canvas-edge'), sourceNodeId: sourceId, sourcePort: 'output', targetNodeId: targetId,
        targetPort: plan.role, role: plan.role, order: nextOrder(next, targetId, plan.role), binding: 'followCurrent' };
    const issues = validateCanvasEdge(next, edge);
    if (issues.length) return { canvas, error: issues[0].code };
    return { canvas: applyCanvasCommand(next, { type: 'edge.connect', edge }, { now }), edge, dropped };
}

/** Change one wire's role (首帧 ↔ 尾帧 ↔ 参考图); the target's mode follows the set of roles it then has. */
export function rerouteCanvasEdge(canvas: CanvasDocument, edgeId: string, role: CanvasInputRole, now: string): { readonly canvas: CanvasDocument; readonly error?: string } {
    const edge = canvas.edges.find(item => item.id === edgeId);
    if (!edge || edge.role === role) return { canvas };
    const without = applyCanvasCommand(canvas, { type: 'edge.disconnect', edgeId }, { now });
    const target = without.nodes.find(node => node.id === edge.targetNodeId);
    // A role another wire already holds (one first frame, one last frame) swaps with it.
    const holder = (role === 'firstFrame' || role === 'lastFrame') ? edgesInto(without, edge.targetNodeId, role)[0] : undefined;
    let base = without;
    if (holder && (edge.role === 'firstFrame' || edge.role === 'lastFrame')) base = rerouteCanvasEdge(without, holder.id, edge.role, now).canvas;
    else if (holder) base = applyCanvasCommand(without, { type: 'edge.disconnect', edgeId: holder.id }, { now });
    void target;
    const result = connectCanvasNodes(base, edge.sourceNodeId, edge.targetNodeId, now, role);
    return result.error ? { canvas, error: result.error } : { canvas: result.canvas };
}

/** After a wire is removed: a picture-to-picture or first-frame node with no picture left goes back to text. */
export function relaxCanvasMode(canvas: CanvasDocument, nodeId: string, now: string): CanvasDocument {
    const node = canvas.nodes.find(item => item.id === nodeId);
    if (!node || (node.kind !== 'imageGen' && node.kind !== 'videoGen')) return canvas;
    const roles = [...edgesInto(canvas, nodeId).map(edge => edge.role), ...(node.payload.inputs ?? []).map(input => input.role)];
    const media = roles.filter(role => !['prompt', 'character'].includes(role));
    if (node.kind === 'imageGen' && node.payload.mode === 'imageToImage' && !media.length) return switchCanvasMode(canvas, nodeId, 'textToImage', now).canvas;
    if (node.kind === 'videoGen' && !['videoEdit', 'videoExtend'].includes(node.payload.mode)) {
        const wanted = videoModeFor(roles, node.payload.mode);
        if (wanted !== node.payload.mode && (wanted === 'textToVideo' || wanted === 'imageToVideo')) return switchCanvasMode(canvas, nodeId, wanted, now).canvas;
    }
    return canvas;
}

/** New nodes a wire dragged into empty space can create, by the source's output. */
export function canvasConnectTargets(kind: CanvasOutputKind): readonly CanvasAddKind[] {
    switch (kind) {
        case 'text': return ['imageGen', 'videoGen'];
        case 'character': return ['imageGen', 'videoGen'];
        case 'image': return ['imageGen', 'videoGen', 'sceneComposer', 'world'];
        case 'video': return ['videoGen', 'frameExtract', 'composition'];
        case 'audio': return ['videoGen', 'composition'];
        default: return [];
    }
}

export interface CanvasNodeDefaults {
    readonly imageModelId?: string;
    readonly videoModelId?: string;
    readonly aspectRatio?: string;
    readonly durationSeconds?: number;
    readonly title: string;
}

/** Reference media cards keep a 280px short side; their outer size is separate from output pixels. */
export function canvasMediaCardSize(aspectRatio?: string): CanvasSize {
    const pair = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspectRatio ?? '16:9');
    const width = pair ? Number(pair[1]) : 16, height = pair ? Number(pair[2]) : 9;
    const ratio = width > 0 && height > 0 ? width / height : 16 / 9;
    return ratio >= 1 ? { width: Math.round(280 * Math.min(ratio, 8)), height: 280 }
        : { width: 280, height: Math.round(280 / Math.max(ratio, 1 / 8)) };
}

export function createCanvasNode(kind: CanvasAddKind, position: CanvasPoint, defaults: CanvasNodeDefaults): CanvasNode {
    const base = { id: canvasId('canvas-node'), title: defaults.title, position, size: kind === 'imageGen' || kind === 'videoGen' ? canvasMediaCardSize(defaults.aspectRatio) : CANVAS_DEFAULT_SIZE };
    switch (kind) {
        case 'text': return { ...base, kind, payload: { text: '' } };
        case 'imageGen': return { ...base, kind, payload: { mode: 'textToImage', modelId: defaults.imageModelId || 'unconfigured:image', prompt: '',
            parameters: defaults.aspectRatio ? { aspectRatio: defaults.aspectRatio } : {}, versions: [] } };
        case 'videoGen': return { ...base, kind, payload: { mode: 'textToVideo', modelId: defaults.videoModelId || 'unconfigured:video', prompt: '',
            parameters: { ...(defaults.aspectRatio ? { aspectRatio: defaults.aspectRatio } : {}), ...(defaults.durationSeconds ? { durationSeconds: defaults.durationSeconds } : {}) }, versions: [] } };
        case 'frameExtract': return { ...base, kind, payload: { selection: { kind: 'last' }, versions: [] } };
        case 'composition': return { ...base, kind, size: { width: 360, height: 240 }, payload: { clips: [], parameters: {}, versions: [] } };
        // A stage or world starts in the project's frame (a 9:16 comic gets 9:16 shots), when the stage offers that ratio.
        case 'sceneComposer': {
            const scene = createSceneDocument();
            const aspectRatio = SCENE_ASPECT_RATIOS.find(ratio => ratio === defaults.aspectRatio);
            return { ...base, kind, payload: { scene: aspectRatio ? { ...scene, aspectRatio } : scene, versions: [] } };
        }
        case 'world': {
            const world = normalizeWorld({});
            const aspectRatio = SCENE_ASPECT_RATIOS.find(ratio => ratio === defaults.aspectRatio);
            return { ...base, kind, payload: { world: aspectRatio ? normalizeWorld({ ...world, aspectRatio, scene: { ...world.scene, aspectRatio } }) : world, versions: [] } };
        }
    }
}

function overlaps(canvas: CanvasDocument, at: CanvasPoint, size: CanvasSize): boolean {
    return canvas.nodes.some(node => node.kind !== 'group' && at.x < node.position.x + node.size.width && at.x + size.width > node.position.x
        && at.y < node.position.y + node.size.height && at.y + size.height > node.position.y);
}

/** Put a new node at `center` (the view's middle), stepping 40 px right-down up to 20 times while it would cover another. */
export function placeCanvasNode(canvas: CanvasDocument, center: CanvasPoint, size: CanvasSize = CANVAS_DEFAULT_SIZE): CanvasPoint {
    let at = { x: Math.round(center.x - size.width / 2), y: Math.round(center.y - size.height / 2) };
    for (let attempt = 0; attempt < 20 && overlaps(canvas, at, size); attempt++) at = { x: at.x + 40, y: at.y + 40 };
    return at;
}

/** Place a whole draft batch around its first card, retaining every relative position. */
export function canvasBatchPlacementOffset(canvas: CanvasDocument, nodes: readonly CanvasNode[], firstCenter: CanvasPoint): CanvasPoint {
    const first = nodes[0];
    if (!first) return { x: 0, y: 0 };
    const left = Math.min(...nodes.map(node => node.position.x)), top = Math.min(...nodes.map(node => node.position.y));
    const size = { width: Math.max(...nodes.map(node => node.position.x + node.size.width)) - left,
        height: Math.max(...nodes.map(node => node.position.y + node.size.height)) - top };
    let at = placeCanvasNode(canvas, {
        x: firstCenter.x - first.size.width / 2 + left - first.position.x + size.width / 2,
        y: firstCenter.y - first.size.height / 2 + top - first.position.y + size.height / 2
    }, size);
    // The short diagonal search can run out in a crowded canvas. A position beyond
    // every existing card still guarantees that no part of the new batch covers one.
    if (overlaps(canvas, at, size)) at = { x: canvas.nodes.filter(node => node.kind !== 'group')
        .reduce((right, node) => Math.max(right, node.position.x + node.size.width), at.x) + 40, y: at.y };
    return { x: at.x - left, y: at.y - top };
}

/**
 * Copies of the selected nodes, offset by `offset`: new IDs, the same inputs (wires from outside are copied too,
 * wires between copies point at the copies), results kept, any running or queued job left with the original.
 */
export function duplicateCanvasNodes(canvas: CanvasDocument, nodeIds: readonly string[], offset: CanvasPoint, now: string): { readonly canvas: CanvasDocument; readonly ids: readonly string[] } {
    const chosen = canvas.nodes.filter(node => nodeIds.includes(node.id) && node.kind !== 'group');
    if (!chosen.length) return { canvas, ids: [] };
    const ids = new Map(chosen.map(node => [node.id, canvasId('canvas-node')]));
    let next = canvas;
    for (const node of chosen) {
        const payload = 'jobs' in node.payload || 'job' in node.payload
            ? (({ job: _job, jobs: _jobs, ...rest }) => rest)(node.payload as CanvasNode['payload'] & { job?: unknown; jobs?: unknown })
            : node.payload;
        const { origin: _origin, orphaned: _orphaned, ...rest } = node;
        next = applyCanvasCommand(next, { type: 'node.add', node: { ...rest, id: ids.get(node.id)!, position: { x: node.position.x + offset.x, y: node.position.y + offset.y }, payload } as CanvasNode }, { now });
    }
    for (const edge of canvas.edges.filter(item => ids.has(item.targetNodeId))) {
        const copy: CanvasEdge = { ...edge, id: canvasId('canvas-edge'), targetNodeId: ids.get(edge.targetNodeId)!, sourceNodeId: ids.get(edge.sourceNodeId) ?? edge.sourceNodeId };
        if (!validateCanvasEdge(next, copy).length) next = applyCanvasCommand(next, { type: 'edge.connect', edge: copy }, { now });
    }
    for (const link of canvas.sequenceLinks ?? []) if (ids.has(link.sourceNodeId) && ids.has(link.targetNodeId)) next = applyCanvasCommand(next, { type: 'sequence.connect', link: { id: canvasId('canvas-sequence'), sourceNodeId: ids.get(link.sourceNodeId)!, targetNodeId: ids.get(link.targetNodeId)! } }, { now });
    return { canvas: mergeCanvasNodeAuthoring(next, copyCanvasNodeAuthoring(canvas.settings, chosen, ids)), ids: [...ids.values()] };
}

/** Delete nodes (a scene group takes its members) and wires; modes relax where a picture input went away. */
export function deleteFromCanvas(canvas: CanvasDocument, nodeIds: readonly string[], edgeIds: readonly string[], now: string): CanvasDocument {
    const targets = new Set<string>();
    let next = canvas;
    for (const edgeId of edgeIds) {
        if (next.sequenceLinks?.some(link => link.id === edgeId)) { next = applyCanvasCommand(next, { type: 'sequence.disconnect', linkId: edgeId }, { now }); continue; }
        const edge = next.edges.find(item => item.id === edgeId);
        if (!edge || nodeIds.includes(edge.targetNodeId)) continue;
        targets.add(edge.targetNodeId);
        next = applyCanvasCommand(next, { type: 'edge.disconnect', edgeId }, { now });
    }
    const present = nodeIds.filter(id => next.nodes.some(node => node.id === id));
    if (present.length) {
        for (const edge of next.edges.filter(item => present.includes(item.sourceNodeId) && !present.includes(item.targetNodeId))) targets.add(edge.targetNodeId);
        next = applyCanvasCommand(next, { type: 'node.delete', nodeIds: present }, { now });
    }
    for (const target of targets) if (next.nodes.some(node => node.id === target)) next = relaxCanvasMode(next, target, now);
    return next;
}

/**
 * Inputs of `nodeId` that have no result yet, nearest first: the node waits for them. A missing input is followed
 * further up (a frame from a video that is still generating), so a failure anywhere upstream is found; an input that
 * already has a result ends the walk there.
 */
export function canvasPendingUpstream(canvas: CanvasDocument, nodeId: string): readonly string[] {
    const pending: string[] = [];
    const seen = new Set<string>([nodeId]);
    let frontier = [nodeId];
    while (frontier.length) {
        const next: string[] = [];
        for (const target of frontier) {
            for (const edge of canvas.edges) {
                if (edge.targetNodeId !== target || seen.has(edge.sourceNodeId)) continue;
                seen.add(edge.sourceNodeId);
                const node = canvas.nodes.find(item => item.id === edge.sourceNodeId);
                if (!node || (node.kind !== 'imageGen' && node.kind !== 'videoGen' && node.kind !== 'frameExtract') || canvasCurrentVersion(node)) continue;
                pending.push(node.id);
                next.push(node.id);
            }
        }
        frontier = next;
    }
    return pending;
}

/**
 * Selected generation nodes in dependency order (a storyboard before the clip it feeds). Dependencies are followed
 * through any node between them (a frame extract, a scene composer, an unselected node), so video A → frame → video C
 * still runs A first.
 */
export function canvasRunOrder(canvas: CanvasDocument, nodeIds: readonly string[]): readonly string[] {
    const chosen = new Set(nodeIds.filter(id => canvas.nodes.some(node => node.id === id && (node.kind === 'imageGen' || node.kind === 'videoGen'))));
    const sources = new Map<string, string[]>();
    for (const edge of canvas.edges) {
        const list = sources.get(edge.targetNodeId);
        if (list) list.push(edge.sourceNodeId); else sources.set(edge.targetNodeId, [edge.sourceNodeId]);
    }
    const order: string[] = [];
    const done = new Set<string>();
    const visiting = new Set<string>();
    const visit = (id: string): void => {
        if (done.has(id) || visiting.has(id)) return;
        visiting.add(id);
        for (const source of sources.get(id) ?? []) visit(source);
        visiting.delete(id);
        done.add(id);
        if (chosen.has(id)) order.push(id);
    };
    for (const id of nodeIds) if (chosen.has(id)) visit(id);
    return order;
}

function versionsOf(node: CanvasNode | undefined): readonly CanvasAssetVersion[] {
    return node && 'versions' in node.payload ? node.payload.versions : [];
}

/**
 * Local edits on top of what the service saved since `base`:
 *  - results (versions) and job summaries always come from the service, and a result that arrived selects itself
 *    unless the user picked another version locally;
 *  - nodes the service added (an import, a tool output) join; nodes the user deleted stay deleted;
 *  - everything else (layout, prompts, parameters, wires, groups) is the user's.
 */
export function rebaseCanvas(local: CanvasDocument, base: CanvasDocument | undefined, server: CanvasDocument): CanvasDocument {
    const serverNodes = new Map(server.nodes.map(node => [node.id, node]));
    const baseNodes = new Map((base?.nodes ?? []).map(node => [node.id, node]));
    const nodes: CanvasNode[] = local.nodes.map(node => {
        const remote = serverNodes.get(node.id);
        if (!remote || !('versions' in node.payload) || !('versions' in remote.payload)) return node;
        const remoteVersions = remote.payload.versions;
        const known = new Set(node.payload.versions.map(version => version.id));
        const arrived = remoteVersions.filter(version => !known.has(version.id));
        const versions = [...remoteVersions, ...node.payload.versions.filter(version => !remoteVersions.some(item => item.id === version.id))];
        const pickedLocally = node.payload.currentVersionId !== (baseNodes.get(node.id) && 'versions' in baseNodes.get(node.id)!.payload
            ? (baseNodes.get(node.id)!.payload as { currentVersionId?: string }).currentVersionId : undefined);
        const currentVersionId = arrived.length && !pickedLocally ? remote.payload.currentVersionId : node.payload.currentVersionId ?? remote.payload.currentVersionId;
        const jobs = 'jobs' in remote.payload ? { jobs: (remote.payload as { jobs?: readonly CanvasGenerationJob[] }).jobs, job: (remote.payload as { job?: unknown }).job } : {};
        return { ...node, payload: { ...node.payload, ...jobs, versions, ...(currentVersionId ? { currentVersionId } : {}) } } as CanvasNode;
    });
    const localIds = new Set(local.nodes.map(node => node.id));
    for (const remote of server.nodes) if (!localIds.has(remote.id) && !baseNodes.has(remote.id)) nodes.push(remote);
    const nodeIds = new Set(nodes.map(node => node.id));
    const baseEdges = new Set((base?.edges ?? []).map(edge => edge.id));
    const localEdges = new Set(local.edges.map(edge => edge.id));
    const edges = [...local.edges, ...server.edges.filter(edge => !localEdges.has(edge.id) && !baseEdges.has(edge.id))]
        .filter(edge => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId));
    const baseSequence = new Set((base?.sequenceLinks ?? []).map(link => link.id));
    const localSequence = new Set((local.sequenceLinks ?? []).map(link => link.id));
    const sequenceLinks = [...(local.sequenceLinks ?? []), ...(server.sequenceLinks ?? []).filter(link => !localSequence.has(link.id) && !baseSequence.has(link.id))]
        .filter(link => nodeIds.has(link.sourceNodeId) && nodeIds.has(link.targetNodeId));
    return { ...local, nodes, edges, sequenceLinks, revision: server.revision, updatedAt: server.updatedAt };
}

/** A result the user can see: ready versions only (an interrupted upload or a missing file is not shown as done). */
export function canvasVersionReady(version: CanvasAssetVersion | undefined): boolean {
    return Boolean(version && version.status !== 'missing' && version.status !== 'uploading');
}

export function canvasKindIcon(kind: CanvasNodeKind): string {
    switch (kind) {
        case 'text': return 'note';
        case 'image': case 'imageGen': return 'file-media';
        case 'video': case 'videoGen': return 'device-camera-video';
        case 'audio': return 'unmute';
        case 'frameExtract': return 'screen-full';
        case 'composition': return 'layers';
        case 'group': return 'folder';
        case 'character': return 'person';
        case 'sceneComposer': return 'preview';
        case 'world': return 'globe';
    }
}

export { versionsOf as canvasVersions };

/** Ref for a canvas dialog: it takes focus when it opens (unless a field inside already has it), so Escape and its keys reach it. */
export function focusDialogOnMount(element: HTMLElement | null): void {
    if (element && !element.contains(element.ownerDocument.activeElement)) element.focus({ preventScroll: true });
}
