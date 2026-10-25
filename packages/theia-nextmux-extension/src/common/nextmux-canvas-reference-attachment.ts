import { validateCanvasDocument, type CanvasAssetVersion, type CanvasDocument, type CanvasInputRole, type CanvasMediaKind, type CanvasNode } from '@nextmux/comic-core/canvas';

export interface CanvasReferenceTarget { readonly nodeId: string; readonly role: CanvasInputRole }
type GenerationNode = Extract<CanvasNode, { kind: 'imageGen' | 'videoGen' }>;
const active = new Set(['reserved', 'awaiting_confirmation', 'queued', 'running', 'paused', 'interrupted']);
function fail(code: string): never { throw Object.assign(new Error(code), { code }); }

export function canvasReferenceKind(role: CanvasInputRole): CanvasMediaKind {
    if (role === 'referenceVideo') return 'video';
    if (role === 'referenceAudio') return 'audio';
    if (role === 'referenceImage' || role === 'firstFrame' || role === 'lastFrame') return 'image';
    return fail('ROLE_TYPE');
}

function targetNode(canvas: CanvasDocument, target: CanvasReferenceTarget, kind?: CanvasMediaKind): GenerationNode {
    const expected = canvasReferenceKind(target?.role);
    if (kind !== undefined && kind !== expected) fail('ROLE_TYPE');
    const node = canvas.nodes.find(item => item.id === target?.nodeId);
    if (!node || node.kind !== 'imageGen' && node.kind !== 'videoGen') fail('CANVAS_SOURCE_MISSING');
    if (node.kind === 'imageGen' && target.role !== 'referenceImage') fail('MODE_ROLE');
    const job = [...(node.payload.jobs ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1) ?? node.payload.job;
    if (job && active.has(job.status)) fail('CANVAS_NODE_BUSY');
    return node;
}

function candidate(canvas: CanvasDocument, node: GenerationNode, target: CanvasReferenceTarget, version: CanvasAssetVersion, inputId: string, now: string): CanvasDocument {
    const frame = target.role === 'firstFrame' || target.role === 'lastFrame';
    const previous = node.payload.inputs ?? [];
    const collision = previous.find(input => input.id === inputId);
    if (collision && (collision.role !== target.role || collision.version.id !== version.id || collision.version.assetId !== version.assetId || collision.version.uri !== version.uri)) fail('DIRECT_INPUT');
    let mode = node.payload.mode;
    if (node.kind === 'imageGen' && mode === 'textToImage') mode = 'imageToImage';
    if (node.kind === 'videoGen' && mode === 'textToVideo') mode = target.role === 'firstFrame' ? 'imageToVideo' : target.role === 'lastFrame' ? 'firstLastFrame' : 'referenceToVideo';
    const inputs = frame ? previous.filter(input => input.role !== target.role) : previous.filter(input => input.id !== inputId);
    const order = inputs.reduce((highest, input) => Math.max(highest, input.order + 1), 0);
    const { optionDecision, continuity, ...payload } = node.payload;
    // Replacing an approved tail frame must also clear its old source claim.
    const keepContinuity = continuity && mode === node.payload.mode
        && !(target.role === 'firstFrame' && continuity.strategy === 'tailFrame');
    const replacement = { ...node, payload: { ...payload, mode,
        ...(mode === node.payload.mode && optionDecision ? { optionDecision } : {}),
        ...(keepContinuity ? { continuity } : {}),
        inputs: [...inputs, { id: inputId, role: target.role, order, version: structuredClone(version) }] } } as GenerationNode;
    return { ...canvas, nodes: canvas.nodes.map(item => item.id === node.id ? replacement : item),
        edges: frame ? canvas.edges.filter(edge => edge.targetNodeId !== node.id || edge.role !== target.role) : canvas.edges,
        revision: canvas.revision + 1, updatedAt: now };
}

/** Validate before importing any bytes. A single-frame selection replaces only that frame slot. */
export function validateCanvasReferenceTarget(canvas: CanvasDocument, target: CanvasReferenceTarget, kind?: CanvasMediaKind): GenerationNode {
    const node = targetNode(canvas, target, kind), media = canvasReferenceKind(target.role);
    const probe: CanvasAssetVersion = { id: 'reference-validation-version', assetId: 'reference-validation-asset', kind: media,
        uri: 'nextmux.media/reference-validation', createdAt: canvas.updatedAt };
    const errors = validateCanvasDocument(candidate(canvas, node, target, probe, 'reference-validation-input', canvas.updatedAt));
    if (errors.length) fail(errors[0].code);
    return node;
}

/** Selected media is an immutable input version; no hidden canvas node or automatic wire is needed. */
export function attachCanvasReferenceVersion(canvas: CanvasDocument, target: CanvasReferenceTarget, version: CanvasAssetVersion, inputId: string, now: string): CanvasDocument {
    const node = validateCanvasReferenceTarget(canvas, target, version.kind);
    if (!version.uri || version.status === 'missing' || version.status === 'uploading') fail('MISSING_INPUT');
    if (!inputId) fail('DIRECT_INPUT');
    const same = node.payload.inputs?.some(input => input.role === target.role && input.version.id === version.id
        && input.version.assetId === version.assetId && input.version.uri === version.uri);
    const frame = target.role === 'firstFrame' || target.role === 'lastFrame';
    if (same && (!frame || !canvas.edges.some(edge => edge.targetNodeId === node.id && edge.role === target.role))) return canvas;
    const next = candidate(canvas, node, target, version, inputId, now);
    const errors = validateCanvasDocument(next);
    if (errors.length) fail(errors[0].code);
    return next;
}
