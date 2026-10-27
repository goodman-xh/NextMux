import { applyCanvasCommand, resolveCanvasInputs, validateCanvasDocument, type CanvasAssetVersion, type CanvasDocument, type CanvasEdge } from '@nextmux/comic-core/canvas';
import { reconcileCanvasGenerationParameters, type CanvasCapabilityIssue, type CanvasModelCapability } from '@nextmux/comic-core/canvas-capabilities';

export interface CanvasVideoInput {
    readonly edgeId?: string;
    readonly inputId?: string;
    readonly sourceNodeId?: string;
    readonly version: CanvasAssetVersion;
}
type Availability = 'supported' | 'unsupported' | 'unknown' | 'invalid';
export interface CanvasVideoInputCapability {
    readonly state: 'ready' | 'loading' | 'unknown' | 'error';
    readonly referenceVideo: Availability;
    readonly imageToVideo: Availability;
    readonly issues: readonly CanvasCapabilityIssue[];
}

/** A reference-video label alone is not evidence that a route accepts a video. No guessed frame metadata. */
export function inspectCanvasVideoInputCapability(state: { readonly capability?: CanvasModelCapability; readonly loading?: boolean; readonly error?: string }, source: CanvasAssetVersion): CanvasVideoInputCapability {
    if (state.loading) return { state: 'loading', referenceVideo: 'unknown', imageToVideo: 'unknown', issues: [] };
    if (state.error) return { state: 'error', referenceVideo: 'unknown', imageToVideo: 'unknown', issues: [] };
    const model = state.capability;
    if (!model || model.status === 'unknown') return { state: 'unknown', referenceVideo: 'unknown', imageToVideo: 'unknown', issues: [] };
    if (model.status !== 'available') return { state: 'error', referenceVideo: 'unsupported', imageToVideo: 'unsupported', issues: [] };
    const reference = model.modes.find(mode => mode.mode === 'referenceToVideo');
    const image = model.modes.find(mode => mode.mode === 'imageToVideo');
    let referenceVideo: Availability = !reference ? 'unsupported' : reference.referenceRules?.video === undefined ? 'unknown'
        : !reference.referenceRules.video.supported || reference.referenceRules.video.maxCount < 1 ? 'unsupported' : 'supported';
    const imageToVideo: Availability = !image || image.firstFrame === false || image.frameImageRule?.supported === false || image.frameImageRule && image.frameImageRule.maxCount < 1
        ? 'unsupported' : image.firstFrame === true ? 'supported' : 'unknown';
    let issues: readonly CanvasCapabilityIssue[] = [];
    if (referenceVideo === 'supported') {
        if (source.kind !== 'video' || !source.uri || source.status === 'missing' || source.status === 'uploading') referenceVideo = 'invalid';
        else {
            const decision = reconcileCanvasGenerationParameters(model, 'referenceToVideo', {}, [{ role: 'referenceVideo', kind: 'video', versionId: source.id, metadata: source.metadata }]);
            issues = decision.issues;
            if (issues.length) referenceVideo = issues.some(issue => issue.code.includes('UNKNOWN')) ? 'unknown' : 'invalid';
        }
    }
    return { state: 'ready', referenceVideo, imageToVideo, issues };
}

export type CanvasVideoInputResolution = { readonly ok: true; readonly input: CanvasVideoInput } | { readonly ok: false; readonly code: string };
/** Resolve the chosen version once; following edges must not silently switch source during extraction. */
export function resolveCanvasVideoInput(canvas: CanvasDocument, targetNodeId: string): CanvasVideoInputResolution {
    const target = canvas.nodes.find(node => node.id === targetNodeId);
    if (!target || target.kind !== 'videoGen') return { ok: false, code: 'VIDEO_TARGET_MISSING' };
    const edges = canvas.edges.filter(edge => edge.targetNodeId === targetNodeId && edge.role === 'referenceVideo');
    const direct = (target.payload.inputs ?? []).filter(input => input.role === 'referenceVideo');
    if (edges.length + direct.length !== 1) return { ok: false, code: edges.length + direct.length ? 'VIDEO_INPUT_AMBIGUOUS' : 'VIDEO_INPUT_MISSING' };
    const edge = edges[0], input = direct[0];
    const source = edge && canvas.nodes.find(node => node.id === edge.sourceNodeId);
    const media = source && 'versions' in source.payload ? source.payload : undefined;
    const version = input?.version ?? media?.versions.find(item => item.id === (edge.binding === 'pinnedVersion' ? edge.pinnedVersionId : media.currentVersionId));
    if (!version || version.kind !== 'video' || !version.uri || version.status === 'missing' || version.status === 'uploading') return { ok: false, code: 'VIDEO_INPUT_UNAVAILABLE' };
    return { ok: true, input: { ...(edge ? { edgeId: edge.id, sourceNodeId: edge.sourceNodeId } : { inputId: input.id }), version } };
}

/** Compare immutable media identity, not only the version id (direct references can be replaced in place). */
export function sameCanvasVideoInput(left: CanvasVideoInput, right: CanvasVideoInput): boolean {
    return left.edgeId === right.edgeId && left.inputId === right.inputId && left.sourceNodeId === right.sourceNodeId
        && left.version.id === right.version.id && left.version.assetId === right.version.assetId && left.version.uri === right.version.uri;
}

export interface CanvasVideoFrameConversion {
    readonly targetNodeId: string;
    readonly input: CanvasVideoInput;
    readonly frameNodeId?: string;
    readonly frameVersionId?: string;
    /** Direct extraction returns a registered version without a canvas node. */
    readonly frameVersion?: CanvasAssetVersion;
    readonly capability: CanvasModelCapability;
    readonly edgeId: string;
    readonly now: string;
    /** Only a caller explicitly creating a playback continuation may request this link. */
    readonly sequence?: { readonly id: string; readonly sourceNodeId: string };
}
export type CanvasVideoFrameConversionResult = { readonly ok: true; readonly canvas: CanvasDocument }
    | { readonly ok: false; readonly canvas: CanvasDocument; readonly code: string; readonly issues?: readonly { readonly code: string; readonly path: string; readonly message: string }[] };

/** Replace only the reviewed video reference. Failure always returns the untouched original object. */
export function convertCanvasVideoInputToFrame(canvas: CanvasDocument, request: CanvasVideoFrameConversion): CanvasVideoFrameConversionResult {
    const fail = (code: string, issues?: readonly { readonly code: string; readonly path: string; readonly message: string }[]): CanvasVideoFrameConversionResult => ({ ok: false, canvas, code, ...(issues ? { issues } : {}) });
    const resolved = resolveCanvasVideoInput(canvas, request.targetNodeId);
    if (!resolved.ok) return fail(resolved.code);
    if (!sameCanvasVideoInput(resolved.input, request.input)) return fail('VIDEO_INPUT_CHANGED');
    const target = canvas.nodes.find(node => node.id === request.targetNodeId)!;
    if (target.kind !== 'videoGen') return fail('VIDEO_TARGET_MISSING');
    if (target.payload.modelId !== request.capability.providerModelId) return fail('VIDEO_MODEL_CHANGED');
    const support = inspectCanvasVideoInputCapability({ capability: request.capability }, resolved.input.version);
    if (support.state !== 'ready' || support.imageToVideo !== 'supported') return fail('VIDEO_IMAGE_MODE_UNAVAILABLE');
    const frameNode = canvas.nodes.find(node => node.id === request.frameNodeId);
    const direct = Boolean(request.input.inputId);
    const frame = direct && request.frameVersion ? request.frameVersion
        : frameNode && 'versions' in frameNode.payload ? frameNode.payload.versions.find(version => version.id === request.frameVersionId) : undefined;
    if (!frame || frame.kind !== 'image' || !frame.uri || frame.status === 'missing' || frame.status === 'uploading'
        || frame.provenance?.operation !== 'frameExtract' || frame.provenance.sourceVersionId !== request.input.version.id
        || request.input.sourceNodeId && frame.provenance.sourceNodeId !== request.input.sourceNodeId) return fail('VIDEO_FRAME_UNAVAILABLE');
    if (canvas.edges.some(edge => edge.id === request.edgeId)) return fail('VIDEO_EDGE_EXISTS');
    if (!direct && !request.frameNodeId) return fail('VIDEO_FRAME_UNAVAILABLE');
    const { continuity: _continuity, optionDecision: _optionDecision, ...payload } = target.payload;
    const edge: CanvasEdge = { id: request.edgeId, sourceNodeId: request.frameNodeId!, sourcePort: 'output', targetNodeId: target.id,
        targetPort: 'firstFrame', role: 'firstFrame', binding: 'pinnedVersion', pinnedVersionId: frame.id, order: 0 };
    let candidate: CanvasDocument = { ...canvas, nodes: canvas.nodes.map(node => node.id === target.id
        ? { ...target, payload: { ...payload, mode: 'imageToVideo' as const, ...(payload.inputs || direct ? { inputs: [
            ...(payload.inputs ?? []).filter(input => input.id !== request.input.inputId),
            ...(direct ? [{ id: request.edgeId, role: 'firstFrame' as const, order: 0, version: structuredClone(frame) }] : [])
        ] } : {}) } } : node),
        edges: [...canvas.edges.filter(item => item.id !== request.input.edgeId), ...(direct ? [] : [edge])] };
    const structural = validateCanvasDocument(candidate);
    if (structural.length) return fail('VIDEO_INPUT_INCOMPATIBLE', structural);
    try {
        const inputs = resolveCanvasInputs(candidate, target.id);
        // A draft may have no prompt yet. Every media/identity reference must still resolve.
        if (inputs.missing.some(input => input.role !== 'prompt')) return fail('VIDEO_INPUT_UNAVAILABLE');
        const decision = reconcileCanvasGenerationParameters(request.capability, 'imageToVideo', target.payload.parameters, inputs.inputs);
        if (decision.mode !== 'imageToVideo' || decision.issues.length) return fail('VIDEO_INPUT_INCOMPATIBLE', decision.issues);
        candidate = { ...candidate, nodes: candidate.nodes.map(node => node.id === target.id && node.kind === 'videoGen'
            ? { ...node, payload: { ...node.payload, parameters: decision.parameters, optionDecision: decision.optionDecision } } : node) };
        if (request.sequence) {
            if (request.sequence.sourceNodeId !== request.input.sourceNodeId) return fail('VIDEO_SEQUENCE_SOURCE_CHANGED');
            candidate = applyCanvasCommand(candidate, { type: 'sequence.connect', link: { id: request.sequence.id, sourceNodeId: request.sequence.sourceNodeId, targetNodeId: target.id } }, { now: request.now });
        }
        return { ok: true, canvas: { ...candidate, revision: canvas.revision + 1, updatedAt: request.now } };
    } catch { return fail('VIDEO_INPUT_INCOMPATIBLE'); }
}
