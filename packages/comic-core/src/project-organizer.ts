import type { ComicAsset, ComicProject } from './types.js';
import type { CanvasDocument, CanvasNode } from './canvas.js';
import { validateCanvasDocument } from './canvas.js';
import { validateComicProject } from './codec.js';

export const COMIC_PROJECT_FOLDERS_FILE = 'folders.json';
export const COMIC_ORGANIZER_NAME_LIMIT = 64;
export interface ComicProjectFolder { readonly id: string; readonly name: string; readonly createdAt: string; readonly updatedAt: string }
/** Covers reference project-owned immutable assets. Undefined uses the automatic cover; null clears it. */
export interface ComicProjectMetadata { readonly projectId: string; readonly folderId?: string | null; readonly coverAssetId?: string | null; readonly updatedAt: string }
export interface ComicProjectMetaPatch { readonly title?: string; readonly folderId?: string | null; readonly coverAssetId?: string | null }
export class ComicOrganizerError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ComicOrganizerError'; }
}
export function organizerName(value: unknown): string {
  if (typeof value !== 'string' || value.includes('\0')) throw new ComicOrganizerError('INVALID_NAME', 'Name must be text');
  const result = value.trim();
  if (!result || result.length > COMIC_ORGANIZER_NAME_LIMIT) throw new ComicOrganizerError('INVALID_NAME', 'Name must contain 1 to 64 characters');
  return result;
}
export function organizerTimestamp(value: string): string {
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) throw new ComicOrganizerError('INVALID_TIMESTAMP', 'A valid timestamp is required');
  return value;
}
export function organizerId(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) throw new ComicOrganizerError('INVALID_ID', 'A safe identifier is required');
  return value;
}
function checkFolderName(folders: readonly ComicProjectFolder[], name: string, exclude?: string): void {
  if (folders.some(folder => folder.id !== exclude && folder.name.trim().normalize('NFKC').toLocaleLowerCase('zh-CN') === name.normalize('NFKC').toLocaleLowerCase('zh-CN'))) throw new ComicOrganizerError('DUPLICATE_FOLDER_NAME', 'A folder with this name already exists');
}
export function createComicProjectFolder(folders: readonly ComicProjectFolder[], id: string, name: string, now: string): readonly ComicProjectFolder[] {
  organizerId(id); name = organizerName(name); organizerTimestamp(now); checkFolderName(folders, name);
  if (folders.some(folder => folder.id === id)) throw new ComicOrganizerError('DUPLICATE_FOLDER_ID', 'Folder ID already exists');
  return [...folders, { id, name, createdAt: now, updatedAt: now }];
}
export function renameComicProjectFolder(folders: readonly ComicProjectFolder[], id: string, name: string, now: string): readonly ComicProjectFolder[] {
  name = organizerName(name); organizerTimestamp(now);
  if (!folders.some(folder => folder.id === id)) throw new ComicOrganizerError('FOLDER_NOT_FOUND', 'Folder does not exist');
  checkFolderName(folders, name, id);
  return folders.map(folder => folder.id === id ? { ...folder, name, updatedAt: now } : folder);
}
/** The returned metadata clears membership; project documents and media never enter this operation. */
export function deleteComicProjectFolder(folders: readonly ComicProjectFolder[], projectMetadata: readonly ComicProjectMetadata[], id: string, now: string): { readonly folders: readonly ComicProjectFolder[]; readonly projectMetadata: readonly ComicProjectMetadata[] } {
  organizerTimestamp(now);
  if (!folders.some(folder => folder.id === id)) throw new ComicOrganizerError('FOLDER_NOT_FOUND', 'Folder does not exist');
  return { folders: folders.filter(folder => folder.id !== id), projectMetadata: projectMetadata.map(meta => meta.folderId === id ? { ...meta, folderId: null, updatedAt: now } : meta) };
}
export function readyComicProjectCoverCandidates(project: Pick<ComicProject, 'assets'>): readonly ComicAsset[] {
  return project.assets.filter(asset => asset.kind === 'image' && asset.status === 'ready' && !!asset.uri.trim());
}
export type ComicProjectCoverCandidate = ComicAsset;
export const comicProjectCoverCandidates = readyComicProjectCoverCandidates;
export function normalizeComicProjectMetaPatch(project: ComicProject, value: unknown, folders: readonly ComicProjectFolder[]): ComicProjectMetaPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ComicOrganizerError('INVALID_META_PATCH', 'Project metadata patch must be an object');
  const patch = value as Record<string, unknown>;
  if (Object.keys(patch).some(key => !['title', 'folderId', 'coverAssetId'].includes(key))) throw new ComicOrganizerError('INVALID_META_PATCH', 'Unknown project metadata field');
  const result: { title?: string; folderId?: string | null; coverAssetId?: string | null } = {};
  if (Object.hasOwn(patch, 'title')) result.title = organizerName(patch.title);
  if (Object.hasOwn(patch, 'folderId')) {
    if (patch.folderId !== null && (typeof patch.folderId !== 'string' || !folders.some(folder => folder.id === patch.folderId))) throw new ComicOrganizerError('FOLDER_NOT_FOUND', 'Target folder does not exist');
    result.folderId = patch.folderId as string | null;
  }
  if (Object.hasOwn(patch, 'coverAssetId')) {
    if (patch.coverAssetId !== null && (typeof patch.coverAssetId !== 'string' || !readyComicProjectCoverCandidates(project).some(asset => asset.id === patch.coverAssetId))) throw new ComicOrganizerError('INVALID_COVER', 'Cover must be a ready image owned by this project');
    result.coverAssetId = patch.coverAssetId as string | null;
  }
  return result;
}
export function applyComicProjectMetaPatch(project: ComicProject, metadata: ComicProjectMetadata, value: unknown, folders: readonly ComicProjectFolder[], now: string): { readonly project: ComicProject; readonly metadata: ComicProjectMetadata } {
  organizerTimestamp(now);
  if (metadata.projectId !== project.id) throw new ComicOrganizerError('PROJECT_MISMATCH', 'Metadata belongs to another project');
  const patch = normalizeComicProjectMetaPatch(project, value, folders);
  const { titleDefault: _titleDefault, ...authored } = project;
  return { project: patch.title === undefined ? project : { ...authored, title: patch.title, revision: project.revision + 1, updatedAt: now }, metadata: { ...metadata,
    ...(patch.folderId === undefined ? {} : { folderId: patch.folderId }), ...(patch.coverAssetId === undefined ? {} : { coverAssetId: patch.coverAssetId }), updatedAt: now } };
}
export type ComicProjectFolderView = '__all__' | '__none__' | string;
export function queryComicProjects<T extends Pick<ComicProject, 'id' | 'title' | 'updatedAt'>>(projects: readonly T[], folders: readonly ComicProjectFolder[], metadata: readonly ComicProjectMetadata[], options: { readonly folderId?: ComicProjectFolderView; readonly query?: string; readonly sort?: 'recent' | 'name' } = {}): readonly T[] {
  const folderIds = new Set(folders.map(folder => folder.id));
  const metas = new Map(metadata.map(meta => [meta.projectId, meta]));
  const query = (options.query ?? '').trim().toLocaleLowerCase('zh-CN');
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
  const modifiedAt = (project: T): number => Math.max(Date.parse(metas.get(project.id)?.updatedAt ?? '') || 0, Date.parse(project.updatedAt) || 0);
  return projects.filter(project => {
    const folder = metas.get(project.id)?.folderId;
    const validFolder = folder && folderIds.has(folder) ? folder : null;
    return (!options.folderId || options.folderId === '__all__' || (options.folderId === '__none__' ? !validFolder : validFolder === options.folderId)) && (!query || project.title.toLocaleLowerCase('zh-CN').includes(query));
  }).sort((a, b) => options.sort === 'name' ? collator.compare(a.title, b.title) || a.id.localeCompare(b.id) :
    modifiedAt(b) - modifiedAt(a) || collator.compare(a.title, b.title) || a.id.localeCompare(b.id));
}

export type ComicDuplicateIdKind = 'project' | 'character' | 'asset' | 'scene' | 'shot' | 'dialogue' | 'canvas' | 'node' | 'version' | 'edge' | 'group' | 'input' | 'clip' | 'outfit' | 'binding' | 'take' | 'track' | 'line' | 'segment' | 'object' | 'keyframe';
export interface ComicDuplicateOptions { readonly projectId: string; readonly title: string; readonly now: string; readonly idFactory?: (kind: ComicDuplicateIdKind, sourceId: string) => string; readonly assetUri?: (uri: string) => string }
export interface ComicProjectDuplicate { readonly project: ComicProject; readonly idMap: Readonly<Record<string, string>> }
export interface ComicProjectBundleDuplicate extends ComicProjectDuplicate { readonly documents: readonly CanvasDocument[] }
const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const terminal = (status: string): boolean => /^(?:succeeded|completed|complete|ready|failed|canceled|cancelled|rejected|expired)$/i.test(status);
/** Remap schema identity fields, never authored text, prompts, model IDs or external provider IDs. */
function remap(value: unknown, ids: Readonly<Record<string, string>>, assetUri?: (uri: string) => string, key = ''): unknown {
  if (typeof value === 'string') {
    if (key === 'uri' || key.endsWith('Uri')) return assetUri?.(value) ?? value;
    if (['id', 'parentId', 'sourceIdentityVersion', 'identityVersion'].includes(key) || /(?:Asset|Character|Project|Scene|Shot|Cue|Node|Version|Group|Edge|Input|Outfit|Binding|Canvas|Take|Track|Line|Segment|Object)Ids?$/i.test(key)) return ids[value] ?? value;
    return value;
  }
  if (Array.isArray(value)) return value.map(item => remap(item, ids, assetUri, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([field, item]) => [key === 'mediaSourceStartFrames' || key === 'mediaDurationFrames' ? ids[field] ?? field : field, remap(item, ids, assetUri, field)]));
  return value;
}
function collectIdentities(project: ComicProject, documents: readonly CanvasDocument[], allocate: (kind: ComicDuplicateIdKind, id: string) => void): void {
  for (const asset of project.assets) allocate('asset', asset.id);
  for (const character of project.characters) {
    allocate('character', character.id);
    for (const outfit of character.canvasCharacter?.outfits ?? []) allocate('outfit', outfit.id);
    for (const binding of [...character.canvasCharacter?.providerBindings ?? [], ...character.canvasCharacter?.voiceBindings ?? []]) allocate('binding', binding.id);
  }
  for (const scene of project.scenes) { allocate('scene', scene.id); for (const shot of scene.shots) { allocate('shot', shot.id); if (shot.continuousTakeId) allocate('take', shot.continuousTakeId); for (const cue of shot.dialogueCues) allocate('dialogue', cue.id); } }
  for (const line of project.music?.mv?.lines ?? []) allocate('line', line.id);
  for (const segment of project.music?.mv?.segments ?? []) allocate('segment', segment.id);
  const collectVersions = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(collectVersions); return; }
    if (!value || typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    if (typeof item.id === 'string' && typeof item.assetId === 'string' && typeof item.uri === 'string') { allocate('version', item.id); allocate('asset', item.assetId); }
    if (typeof item.versionId === 'string' && typeof item.assetId === 'string') { allocate('version', item.versionId); allocate('asset', item.assetId); }
    Object.values(item).forEach(collectVersions);
  };
  for (const character of project.characters) collectVersions(character.canvasCharacter);
  for (const document of documents) {
    allocate('canvas', document.id);
    for (const node of document.nodes) {
      allocate('node', node.id);
      if ('inputs' in node.payload) for (const input of node.payload.inputs ?? []) allocate('input', input.id);
      if (node.kind === 'composition') for (const clip of node.payload.clips) { allocate('clip', clip.id); allocate('track', clip.trackId); }
      if (node.kind === 'sceneComposer') { for (const object of node.payload.scene.objects) allocate('object', object.id); for (const key of node.payload.scene.keys) allocate('keyframe', key.id); }
    }
    for (const edge of document.edges) allocate('edge', edge.id);
    for (const link of document.sequenceLinks ?? []) allocate('edge', link.id);
    for (const group of document.groups) allocate('group', group.id);
    collectVersions(document.nodes);
  }
}
/** The storage layer copies media bytes before publishing this bundle. Jobs are historical only. */
export function duplicateComicProjectBundle(source: ComicProject, documents: readonly CanvasDocument[], options: ComicDuplicateOptions): ComicProjectBundleDuplicate {
  validateComicProject(source); organizerTimestamp(options.now);
  // Existing authored project titles predate the organizer's shorter rename limit.
  const title = options.title === source.title ? source.title : organizerName(options.title);
  if (source.id === options.projectId) throw new ComicOrganizerError('DUPLICATE_ID', 'A duplicate requires a new project ID');
  const originalIds = new Set<string>([source.id]);
  collectIdentities(source, documents, (_kind, id) => originalIds.add(id));
  const ids: Record<string, string> = Object.create(null) as Record<string, string>;
  const used = new Set<string>([options.projectId]); ids[source.id] = options.projectId;
  const allocate = (kind: ComicDuplicateIdKind, id: string): void => {
    if (ids[id]) return;
    const next = options.idFactory?.(kind, id) ?? `${kind}-${globalThis.crypto.randomUUID()}`;
    organizerId(next);
    if (originalIds.has(next) || used.has(next)) throw new ComicOrganizerError('DUPLICATE_ID', 'Duplicate identifiers must be new and unique');
    ids[id] = next; used.add(next);
  };
  if (originalIds.has(options.projectId)) throw new ComicOrganizerError('DUPLICATE_ID', 'Duplicate project ID collides with its source');
  collectIdentities(source, documents, allocate);
  const project = remap(jsonCopy(source), ids, options.assetUri) as ComicProject;
  const { titleDefault: _default, ...base } = project;
  const result: ComicProject = { ...base, id: options.projectId, title, revision: 0, createdAt: options.now, updatedAt: options.now,
    assets: project.assets.map(asset => asset.status === 'generating' ? { ...asset, status: 'missing' } : asset),
    scenes: project.scenes.map(scene => ({ ...scene, shots: scene.shots.map(shot => shot.status === 'generating' ? { ...shot, status: 'draft' } : shot) })) };
  validateComicProject(result);
  const copies = documents.map(document => {
    if (document.projectId !== source.id) throw new ComicOrganizerError('PROJECT_MISMATCH', 'Canvas belongs to another project');
    const copy = remap(jsonCopy(document), ids, options.assetUri) as CanvasDocument;
    const clean: CanvasDocument = { ...copy, projectId: options.projectId, revision: 0, createdAt: options.now, updatedAt: options.now, nodes: copy.nodes.map(node => {
      if (node.kind !== 'imageGen' && node.kind !== 'videoGen') return node;
      const { job, jobs, ...payload } = node.payload;
      return { ...node, payload: { ...payload, ...(job && terminal(job.status) ? { job } : {}), ...(jobs ? { jobs: jobs.filter(item => terminal(item.status)) } : {}) } } as CanvasNode;
    }) };
    const issues = validateCanvasDocument(clean);
    if (issues.length) throw new ComicOrganizerError('INVALID_CANVAS', issues[0].message);
    return clean;
  });
  return { project: result, documents: copies, idMap: { ...ids } };
}
export function duplicateComicProject(project: ComicProject, options: ComicDuplicateOptions): ComicProjectDuplicate {
  const result = duplicateComicProjectBundle(project, [], options);
  return { project: result.project, idMap: result.idMap };
}
export function duplicateCanvasDocument(document: CanvasDocument, options: { readonly projectId: string; readonly id: string; readonly now: string; readonly idMap: Readonly<Record<string, string>>; readonly assetUri?: (uri: string) => string }): CanvasDocument {
  const issues = validateCanvasDocument(document);
  if (issues.length) throw new ComicOrganizerError('INVALID_CANVAS', issues[0].message);
  organizerTimestamp(options.now); organizerId(options.id);
  if (options.id === document.id) throw new ComicOrganizerError('DUPLICATE_ID', 'A duplicate requires a new canvas ID');
  const copy = remap(jsonCopy(document), { ...options.idMap, [document.id]: options.id, [document.projectId]: options.projectId }, options.assetUri) as CanvasDocument;
  const result: CanvasDocument = { ...copy, id: options.id, projectId: options.projectId, revision: 0, createdAt: options.now, updatedAt: options.now, nodes: copy.nodes.map(node => {
    if (node.kind !== 'imageGen' && node.kind !== 'videoGen') return node;
    const { job, jobs, ...payload } = node.payload;
    return { ...node, payload: { ...payload, ...(job && terminal(job.status) ? { job } : {}), ...(jobs ? { jobs: jobs.filter(item => terminal(item.status)) } : {}) } } as CanvasNode;
  }) };
  const resultIssues = validateCanvasDocument(result);
  if (resultIssues.length) throw new ComicOrganizerError('INVALID_CANVAS', resultIssues[0].message);
  return result;
}
