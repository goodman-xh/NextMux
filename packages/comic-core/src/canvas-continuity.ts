import { applyCanvasCommand, CanvasError, createGenerationSnapshot, type CanvasAssetVersion, type CanvasDocument, type CanvasEdge, type CanvasPoint, type CanvasVideoGenNode, type ResolvedCanvasInput } from './canvas.js';
import { reconcileCanvasGenerationParameters, validateCanvasGenerationParameters, type CanvasModelCapability } from './canvas-capabilities.js';

export type CanvasContinuityIntent = 'continueAction' | 'changeCamera' | 'newScene';
export type CanvasContinuityStrategy = 'tailFrame' | 'videoReference' | 'videoExtend';
/** Local provenance. This record is never passed to a provider as a synthetic context ID. */
export interface CanvasShotContinuity {
  readonly version: 1;
  readonly sourceNodeId: string;
  readonly sourceVersionId: string;
  readonly sourceAssetId: string;
  readonly sourceSha256?: string;
  readonly sourceTaskId?: string;
  readonly approvedAt: string;
  readonly intent: CanvasContinuityIntent;
  readonly strategy: CanvasContinuityStrategy;
  readonly inputVersionId: string;
  readonly inputAssetId: string;
  readonly inputNodeId: string;
  readonly boundary: { readonly appearance: string; readonly action: string; readonly camera: string; readonly story: string };
  readonly userPrompt: string;
}
export const CANVAS_CONTINUITY_MODES = Object.freeze({ tailFrame: 'imageToVideo', videoReference: 'referenceToVideo', videoExtend: 'videoExtend' } as const);
const text = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim());
const bounded = (value: unknown): value is string => typeof value === 'string' && value.length <= 10_000;

export function isCanvasShotContinuity(value: unknown): value is CanvasShotContinuity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as CanvasShotContinuity;
  return v.version === 1 && [v.sourceNodeId, v.sourceVersionId, v.sourceAssetId, v.inputVersionId, v.inputAssetId, v.inputNodeId].every(text)
    && text(v.approvedAt) && Number.isFinite(Date.parse(v.approvedAt))
    && ['continueAction', 'changeCamera', 'newScene'].includes(v.intent)
    && Object.hasOwn(CANVAS_CONTINUITY_MODES, v.strategy)
    && (v.sourceSha256 === undefined || /^[a-f\d]{64}$/i.test(v.sourceSha256))
    && (v.sourceTaskId === undefined || text(v.sourceTaskId))
    && Boolean(v.boundary) && ['appearance', 'action', 'camera', 'story'].every(k => bounded(v.boundary[k as keyof typeof v.boundary]))
    && (v.intent !== 'continueAction' || text(v.boundary.action)) && bounded(v.userPrompt) && text(v.userPrompt);
}

/** A user may edit a draft, but it must not keep claiming a source it no longer sends. */
export function assertCanvasContinuityInputs(record: CanvasShotContinuity, inputs: readonly ResolvedCanvasInput[], mode: string): void {
  if (!isCanvasShotContinuity(record) || mode !== CANVAS_CONTINUITY_MODES[record.strategy])
    throw new CanvasError('CONTINUITY_INPUT_CHANGED', 'The continuation mode changed; remove or rebuild its continuity settings.');
  const role = record.strategy === 'tailFrame' ? 'firstFrame' : 'referenceVideo';
  const media = inputs.filter(input => input.role === role);
  const matched = record.strategy === 'videoExtend' ? media[0] : media.find(input => input.versionId === record.inputVersionId && input.sourceNodeId === record.inputNodeId);
  if (!matched || matched.versionId !== record.inputVersionId
      || matched.assetId !== record.inputAssetId || matched.sourceNodeId !== record.inputNodeId
      || record.strategy !== 'tailFrame' && (matched.versionId !== record.sourceVersionId || matched.assetId !== record.sourceAssetId))
    throw new CanvasError('CONTINUITY_INPUT_CHANGED', 'The approved continuation input is no longer connected.');
}

export function compileCanvasContinuityPrompt(record: Pick<CanvasShotContinuity, 'intent' | 'boundary' | 'userPrompt'>): string {
  const intent = {
    continueAction: 'Continue from the supplied ending state. Do not restart or repeat the completed action.',
    changeCamera: 'Continue the story from the supplied state using the requested new camera angle.',
    newScene: 'Move to the requested new scene while preserving the supplied character identity and appearance.'
  }[record.intent];
  const labels = { appearance: 'Character and clothing', action: 'Ending action, direction, hands and props', camera: 'Camera and scene state', story: 'Completed events and remaining goals' };
  return [intent, ...Object.entries(labels).flatMap(([key, label]) => {
    const value = record.boundary[key as keyof typeof record.boundary].trim();
    return value ? `${label}: ${value}` : [];
  }), `Next shot: ${record.userPrompt.trim()}`].join('\n');
}

export interface PrepareCanvasContinuityOptions {
  readonly canvas: CanvasDocument;
  readonly sourceNodeId: string;
  readonly sourceVersionId: string;
  readonly approved: boolean;
  readonly intent: CanvasContinuityIntent;
  readonly strategy: CanvasContinuityStrategy;
  readonly boundary: CanvasShotContinuity['boundary'];
  readonly userPrompt: string;
  readonly capability: CanvasModelCapability;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly tailFrame?: { readonly nodeId: string; readonly versionId: string };
  readonly nodeId: string;
  readonly edgeId: string;
  readonly title: string;
  readonly position: CanvasPoint;
  readonly now: string;
}

/** Creates one unsubmitted draft with one pinned media edge. No queue, provider call, or implicit model switch. */
export function prepareCanvasContinuity(options: PrepareCanvasContinuityOptions): { readonly canvas: CanvasDocument; readonly node: CanvasVideoGenNode; readonly edge: CanvasEdge } {
  const { canvas, sourceNodeId, sourceVersionId, capability } = options;
  const source = canvas.nodes.find(node => node.id === sourceNodeId);
  const sourceVersion = source && 'versions' in source.payload ? source.payload.versions.find(version => version.id === sourceVersionId) : undefined;
  const active = new Set(['reserved', 'awaiting_confirmation', 'queued', 'running', 'paused', 'interrupted']);
  if (!options.approved) throw new CanvasError('CONTINUITY_APPROVAL_REQUIRED', 'Review and approve the selected source version first.');
  if (!source || !ready(sourceVersion, 'video')) throw new CanvasError('CONTINUITY_SOURCE_MISSING', 'The selected source video version is unavailable.');
  const latestJob = 'jobs' in source.payload ? [...(source.payload.jobs ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1) : undefined;
  if (latestJob && active.has(latestJob.status))
    throw new CanvasError('CONTINUITY_SOURCE_BUSY', 'Wait for the source generation to finish before approving it.');
  let inputNode = source;
  let inputVersion = sourceVersion;
  if (options.strategy === 'tailFrame') {
    const candidate = canvas.nodes.find(node => node.id === options.tailFrame?.nodeId);
    const frame = candidate && 'versions' in candidate.payload ? candidate.payload.versions.find(version => version.id === options.tailFrame?.versionId) : undefined;
    if (!candidate || !ready(frame, 'image') || frame.provenance?.sourceVersionId !== sourceVersion.id || frame.provenance.sourceNodeId !== sourceNodeId || frame.provenance.frameSelection?.kind !== 'last')
      throw new CanvasError('CONTINUITY_FRAME_REQUIRED', 'Extract a real frame from this exact source video version first.');
    inputNode = candidate; inputVersion = frame;
  }
  const mode = CANVAS_CONTINUITY_MODES[options.strategy];
  if (!mode || !capability.modes.some(item => item.mode === mode)) throw new CanvasError('CONTINUITY_ROUTE_UNAVAILABLE', 'The selected route does not support this continuation method.');
  const role = options.strategy === 'tailFrame' ? 'firstFrame' : 'referenceVideo';
  const inputs = [{ role, kind: inputVersion.kind, metadata: inputVersion.metadata, versionId: inputVersion.id }] as const;
  const reconciled = reconcileCanvasGenerationParameters(capability, mode, options.parameters ?? {}, inputs);
  const issues = validateCanvasGenerationParameters(capability, mode, reconciled.parameters, inputs);
  if (reconciled.mode !== mode || issues.length) throw new CanvasError('CONTINUITY_ROUTE_UNAVAILABLE', issues.map(issue => issue.message).join('; ') || 'The continuation mode is unavailable.');
  const continuity: CanvasShotContinuity = {
    version: 1, sourceNodeId, sourceVersionId, sourceAssetId: sourceVersion.assetId,
    ...(sourceVersion.metadata?.sha256 ? { sourceSha256: sourceVersion.metadata.sha256 } : {}),
    ...(sourceVersion.provenance?.taskId ? { sourceTaskId: sourceVersion.provenance.taskId } : {}),
    approvedAt: options.now, intent: options.intent, strategy: options.strategy, inputVersionId: inputVersion.id, inputAssetId: inputVersion.assetId, inputNodeId: inputNode.id,
    boundary: structuredClone(options.boundary), userPrompt: options.userPrompt.trim(),
  };
  if (!isCanvasShotContinuity(continuity)) throw new CanvasError('CONTINUITY_STATE_REQUIRED', 'Describe the next shot and, for continuous action, the ending action state.');
  const node: CanvasVideoGenNode = { id: options.nodeId, kind: 'videoGen', title: options.title,
    position: { ...options.position }, size: { width: 360, height: 260 }, createdAt: options.now,
    payload: { modelId: capability.providerModelId, mode, prompt: compileCanvasContinuityPrompt(continuity), parameters: reconciled.parameters, versions: [], continuity } };
  const edge: CanvasEdge = { id: options.edgeId, sourceNodeId: inputNode.id, sourcePort: 'output', targetNodeId: node.id, targetPort: role,
    role, order: 0, binding: 'pinnedVersion', pinnedVersionId: inputVersion.id };
  let next = applyCanvasCommand(canvas, { type: 'node.add', node }, { now: options.now });
  next = applyCanvasCommand(next, { type: 'edge.connect', edge }, { now: options.now });
  createGenerationSnapshot(next, node.id, { capabilityVersion: capability.version });
  return { canvas: next, node, edge };
}

function ready(version: CanvasAssetVersion | undefined, kind: CanvasAssetVersion['kind']): version is CanvasAssetVersion {
  return Boolean(version && version.kind === kind && text(version.uri) && version.status !== 'missing' && version.status !== 'uploading');
}
