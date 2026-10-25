import { CanvasError, createGenerationSnapshot } from './canvas.js';
import type { CanvasAssetVersion, CanvasDirectInput, CanvasDocument, CanvasInputResolverOptions, GenerationSnapshot } from './canvas.js';
import { compileShotCharacterInputs } from './canvas-characters.js';
import type { CanvasCharacterCapability, CanvasCharacterShot, CompiledCharacterInput, FrozenShotCharacter } from './canvas-characters.js';
import type { ComicProject } from './types.js';

export type ShotCharacterGenerationSnapshot = GenerationSnapshot & {
  readonly characterSnapshot: readonly FrozenShotCharacter[];
};
export type ShotCharacterGenerationSnapshotOptions = CanvasInputResolverOptions;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

function materializeVersion(input: CompiledCharacterInput, canvas: CanvasDocument, project: ComicProject): CanvasAssetVersion {
  if (!['image', 'video', 'audio'].includes(input.kind)) throw new CanvasError('CHARACTER_MEDIA_REQUIRED', 'Only compiled media inputs can be materialized');
  const versions: CanvasAssetVersion[] = [];
  for (const node of canvas.nodes) {
    if ('versions' in node.payload) versions.push(...node.payload.versions);
    if ('inputs' in node.payload) versions.push(...(node.payload.inputs ?? []).map(direct => direct.version));
  }
  const original = versions.find(version => version.id === input.versionId && version.assetId === input.assetId && version.kind === input.kind
    && version.uri === input.uri && version.status !== 'missing' && version.status !== 'uploading'
    && (!input.metadata?.sha256 || version.metadata?.sha256 === input.metadata.sha256));
  if (original) return clone(original);
  // The compiler has already resolved and validated the exact project asset/version.
  // Canvas-only inputs also keep their compiled ID, URI and measured metadata.
  return { id: input.versionId, assetId: input.assetId, kind: input.kind as CanvasAssetVersion['kind'], uri: input.uri,
    createdAt: project.updatedAt, status: 'ready', ...(input.metadata ? { metadata: clone(input.metadata) } : {}) };
}

/**
 * Bridges the pure character compiler to the existing frozen generation contract.
 * The isolated canvas is never persisted. All upstream text is already in compiled.prompt,
 * so target edges and direct imports are replaced together to avoid duplicate references.
 */
export function createShotCharacterGenerationSnapshot(
  project: ComicProject,
  shot: CanvasCharacterShot,
  canvas: CanvasDocument,
  capability: CanvasCharacterCapability,
  options: ShotCharacterGenerationSnapshotOptions = {},
): ShotCharacterGenerationSnapshot {
  const compiled = compileShotCharacterInputs(project, shot, canvas, capability);
  if (!compiled.canSubmit) throw new CanvasError('CHARACTER_INPUTS_INVALID', 'Resolve the character reference issues before generation', compiled.issues);
  if (compiled.characters.some(character => character.providerBinding)) throw new CanvasError('ELEMENT_ADAPTER_REQUIRED',
    'The existing generation pipeline has no element input transport; use managed identity images or a verified element-aware adapter',
    [{ code: 'ELEMENT_ADAPTER_REQUIRED', path: 'characters.providerBinding', message: 'A provider element cannot be represented by the existing media generation snapshot' }]);
  const node = canvas.nodes.find(candidate => candidate.id === compiled.nodeId);
  if (!node || node.kind !== 'imageGen' && node.kind !== 'videoGen') throw new CanvasError('CHARACTER_TARGET_MISSING', 'Choose a generation node for the character snapshot');
  const mediaInputs = compiled.inputs.filter(input => input.kind === 'image' || input.kind === 'video' || input.kind === 'audio');
  const directInputs: CanvasDirectInput[] = mediaInputs.map((input, order) => ({
    id: `compiled-character-${encodeURIComponent(node.id)}-${order}`, role: input.role, order,
    version: materializeVersion(input, canvas, project),
  }));
  const payloadChanges = { prompt: compiled.prompt, modelId: compiled.modelId, parameters: clone(compiled.parameters), inputs: directInputs };
  const preparedNode = node.kind === 'imageGen'
    ? { ...node, payload: { ...node.payload, ...payloadChanges } }
    : { ...node, payload: { ...node.payload, ...payloadChanges } };
  const isolated: CanvasDocument = {
    ...canvas,
    nodes: canvas.nodes.map(candidate => candidate.id !== node.id ? candidate : preparedNode),
    edges: canvas.edges.filter(edge => edge.targetNodeId !== node.id),
  };
  const snapshot = createGenerationSnapshot(isolated, node.id, { ...options, capabilityVersion: compiled.capabilityVersion });
  return freeze({ ...snapshot, characterSnapshot: clone(compiled.characters) });
}
