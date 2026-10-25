import { CanvasError, applyCanvasCommand, validateCanvasDocument } from './canvas.js';
import type { CanvasAssetNode, CanvasDocument, CanvasPoint } from './canvas.js';
import { organizerId, organizerName, organizerTimestamp } from './project-organizer.js';

export const CANVAS_REGISTRY_SCHEMA_VERSION = 1 as const;
export const CANVAS_REGISTRY_FILE = 'nextmux.canvases.json';
export interface CanvasRegistryEntry { readonly id: string; readonly title: string; readonly kind: 'main' | 'free'; readonly isOpen: boolean; readonly createdAt: string; readonly updatedAt: string; readonly deletedAt?: string; readonly deletionPending?: boolean }
export interface CanvasRegistry { readonly schemaVersion: typeof CANVAS_REGISTRY_SCHEMA_VERSION; readonly revision: number; readonly projectId: string; readonly mainCanvasId: string; readonly canvases: readonly CanvasRegistryEntry[] }
export function validateCanvasRegistry(value: unknown): CanvasRegistry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CanvasError('INVALID_REGISTRY', 'Canvas registry must be an object');
  const item = value as CanvasRegistry;
  if (item.schemaVersion !== CANVAS_REGISTRY_SCHEMA_VERSION || !Number.isSafeInteger(item.revision) || item.revision < 0 || !Array.isArray(item.canvases)) throw new CanvasError('INVALID_REGISTRY', 'Canvas registry has an invalid schema or revision');
  organizerId(item.projectId); organizerId(item.mainCanvasId);
  const ids = new Set<string>();
  for (const entry of item.canvases) {
    if (!entry || typeof entry !== 'object') throw new CanvasError('INVALID_REGISTRY', 'Canvas registry entries must be objects');
    organizerId(entry.id); organizerTimestamp(entry.createdAt); organizerTimestamp(entry.updatedAt);
    if (typeof entry.title !== 'string' || !entry.title.trim() || entry.title.includes('\0')) throw new CanvasError('INVALID_REGISTRY', 'Canvas title is required');
    if (entry.deletionPending !== undefined && typeof entry.deletionPending !== 'boolean') throw new CanvasError('INVALID_REGISTRY', 'Pending deletion must be a boolean');
    if (entry.deletedAt !== undefined) organizerTimestamp(entry.deletedAt);
    if (ids.has(entry.id) || !['main', 'free'].includes(entry.kind) || typeof entry.isOpen !== 'boolean' || entry.deletedAt !== undefined && entry.isOpen) throw new CanvasError('INVALID_REGISTRY', 'Canvas registry entry has an invalid identity or state');
    ids.add(entry.id);
  }
  const main = item.canvases.filter(entry => entry.kind === 'main');
  if (main.length !== 1 || main[0].id !== item.mainCanvasId || main[0].deletedAt || main[0].deletionPending) throw new CanvasError('INVALID_REGISTRY', 'The main canvas must stay present');
  return item;
}
/** Legacy document identity and title are preserved; no canvas file move or revision change is needed. */
export function createCanvasRegistry(projectId: string, main: CanvasDocument): CanvasRegistry {
  if (main.projectId !== projectId) throw new CanvasError('PROJECT_MISMATCH', 'Main canvas belongs to another project');
  const issues = validateCanvasDocument(main);
  if (issues.length) throw new CanvasError('INVALID_DOCUMENT', issues[0].message, issues);
  return validateCanvasRegistry({ schemaVersion: CANVAS_REGISTRY_SCHEMA_VERSION, revision: 0, projectId, mainCanvasId: main.id,
    canvases: [{ id: main.id, title: main.title, kind: 'main', isOpen: true, createdAt: main.createdAt, updatedAt: main.updatedAt }] });
}
export function listRegistryCanvases(registry: CanvasRegistry, options: { readonly includeDeleted?: boolean; readonly openOnly?: boolean } = {}): readonly CanvasRegistryEntry[] {
  validateCanvasRegistry(registry);
  return registry.canvases.filter(entry => (options.includeDeleted || !entry.deletedAt) && (!options.openOnly || entry.isOpen));
}
function entry(registry: CanvasRegistry, id: string): CanvasRegistryEntry {
  validateCanvasRegistry(registry);
  const found = registry.canvases.find(item => item.id === id && !item.deletedAt);
  if (!found) throw new CanvasError('CANVAS_NOT_FOUND', 'Canvas does not exist');
  return found;
}
function update(registry: CanvasRegistry, id: string, now: string, patch: Partial<CanvasRegistryEntry>): CanvasRegistry {
  organizerTimestamp(now);
  return validateCanvasRegistry({ ...registry, revision: registry.revision + 1, canvases: registry.canvases.map(item => item.id === id ? { ...item, ...patch, updatedAt: now } : item) });
}
export function createRegistryCanvas(registry: CanvasRegistry, options: { readonly id: string; readonly title: string; readonly now: string }): CanvasRegistry {
  validateCanvasRegistry(registry); organizerId(options.id); organizerTimestamp(options.now); const title = organizerName(options.title);
  if (registry.canvases.some(item => item.id === options.id)) throw new CanvasError('DUPLICATE_CANVAS_ID', 'Canvas ID already exists');
  return { ...registry, revision: registry.revision + 1, canvases: [...registry.canvases, { id: options.id, title, kind: 'free', isOpen: true, createdAt: options.now, updatedAt: options.now }] };
}
export function renameRegistryCanvas(registry: CanvasRegistry, id: string, title: string, now: string): CanvasRegistry { entry(registry, id); return update(registry, id, now, { title: organizerName(title) }); }
export function closeRegistryCanvas(registry: CanvasRegistry, id: string, now: string): CanvasRegistry {
  const item = entry(registry, id);
  return item.isOpen ? update(registry, id, now, { isOpen: false }) : registry;
}
export function reopenRegistryCanvas(registry: CanvasRegistry, id: string, now: string): CanvasRegistry { const item = entry(registry, id); return item.isOpen ? registry : update(registry, id, now, { isOpen: true }); }
/** Registry tombstones accompany storage's existing Trash move, never a hard delete. */
export function deleteRegistryCanvas(registry: CanvasRegistry, id: string, now: string): CanvasRegistry {
  const item = entry(registry, id);
  if (item.kind === 'main') throw new CanvasError('MAIN_CANVAS_PROTECTED', 'Main canvas cannot be deleted');
  return update(registry, id, now, { isOpen: false, deletedAt: now, deletionPending: false });
}
export function prepareDeleteRegistryCanvas(registry: CanvasRegistry, id: string, now: string): CanvasRegistry {
  const item = entry(registry, id);
  if (item.kind === 'main') throw new CanvasError('MAIN_CANVAS_PROTECTED', 'Main canvas cannot be deleted');
  return update(registry, id, now, { deletionPending: true });
}
export function cancelDeleteRegistryCanvas(registry: CanvasRegistry, id: string, now: string): CanvasRegistry { entry(registry, id); return update(registry, id, now, { deletionPending: false }); }
export const finalizeDeleteRegistryCanvas = deleteRegistryCanvas;
export function orderRegistryCanvases(registry: CanvasRegistry, ids: readonly string[], now: string): CanvasRegistry {
  validateCanvasRegistry(registry); organizerTimestamp(now);
  const live = registry.canvases.filter(item => !item.deletedAt), byId = new Map(live.map(item => [item.id, item]));
  if (ids.length !== live.length || new Set(ids).size !== ids.length || ids.some(id => !byId.has(id))) throw new CanvasError('INVALID_CANVAS_ORDER', 'Canvas order must contain every live canvas exactly once');
  return { ...registry, revision: registry.revision + 1, canvases: [...ids.map(id => byId.get(id)!), ...registry.canvases.filter(item => !!item.deletedAt)] };
}
export interface CanvasNodeTransfer { readonly document: CanvasDocument; readonly node: CanvasAssetNode; readonly placement: { readonly strategy: 'rightOfContent'; readonly position: CanvasPoint; readonly gap: number } }
/** Send the selected ready result as independent media, without the source's generation job or shot binding. */
export function copyCanvasNodeToMain(source: CanvasDocument, main: CanvasDocument, sourceNodeId: string, options: { readonly nodeId: string; readonly now: string; readonly gap?: number }): CanvasNodeTransfer {
  if (source.projectId !== main.projectId) throw new CanvasError('PROJECT_MISMATCH', 'Canvases belong to different projects');
  if (source.id === main.id) throw new CanvasError('MAIN_CANVAS_SOURCE', 'Source must be an extra canvas');
  for (const document of [source, main]) { const issues = validateCanvasDocument(document); if (issues.length) throw new CanvasError('INVALID_DOCUMENT', issues[0].message, issues); }
  const original = source.nodes.find(item => item.id === sourceNodeId);
  if (!original || !('versions' in original.payload)) throw new CanvasError('NO_CURRENT_RESULT', 'Node has no selected media result');
  const payload = original.payload;
  const version = payload.versions.find(item => item.id === payload.currentVersionId);
  if (!version || version.status === 'uploading' || version.status === 'missing' || !version.uri) throw new CanvasError('NO_CURRENT_RESULT', 'Node has no ready selected media result');
  organizerId(options.nodeId); organizerTimestamp(options.now);
  const gap = options.gap ?? 80;
  if (!Number.isFinite(gap) || gap < 0) throw new CanvasError('INVALID_PLACEMENT', 'Placement gap must be nonnegative');
  const position = main.nodes.length ? { x: Math.max(...main.nodes.map(node => node.position.x + node.size.width)) + gap, y: Math.min(...main.nodes.map(node => node.position.y)) } : { x: 0, y: 0 };
  const node: CanvasAssetNode = { id: options.nodeId, title: original.title, kind: version.kind, position, size: { ...original.size }, createdAt: options.now,
    ...(original.pinnedColors ? { pinnedColors: [...original.pinnedColors] } : {}), payload: { versions: [JSON.parse(JSON.stringify(version)) as typeof version], currentVersionId: version.id } };
  const document = applyCanvasCommand(main, { type: 'node.add', node }, { expectedRevision: main.revision, now: options.now });
  return { document, node, placement: { strategy: 'rightOfContent', position, gap } };
}
