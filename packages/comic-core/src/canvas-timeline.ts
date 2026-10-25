import { validateComicProject } from './codec.js';
import { applyComicEditorEdits, type ComicEditorEdit, type ComicEditorResult } from './editor.js';
import { resolveComicShotTransitions } from './pipeline.js';
import { resolveCanvasSequence, CanvasSequenceError } from './canvas-sequence.js';
import type { CanvasAssetVersion, CanvasDocument } from './canvas.js';
import type { ComicAsset, ComicProject, ComicShot } from './types.js';

export interface CanvasTimelineSource {
  readonly nodeId: string; readonly versionId: string; readonly assetId: string; readonly shotId: string;
  readonly durationMs: number; readonly sourceStartFrames: number; readonly sha256?: string;
}
export interface CanvasTimelineDocument {
  readonly schemaVersion: 1; readonly id: string; readonly projectId: string;
  readonly sourceCanvasId: string; readonly sourceCanvasRevision: number;
  readonly revision: number; readonly title: string; readonly sources: readonly CanvasTimelineSource[];
  /** Independent editor state. Scenes/shots are a renderer adapter, never source-project mutations. */
  readonly project: ComicProject; readonly createdAt: string; readonly updatedAt: string;
  readonly legacySource?: { readonly projectRevision: number };
}
export type CanvasTimelineSummary = Pick<CanvasTimelineDocument, 'id' | 'projectId' | 'sourceCanvasId' | 'sourceCanvasRevision' | 'revision' | 'title' | 'createdAt' | 'updatedAt'>;
export function canvasTimelineSummary(document: CanvasTimelineDocument): CanvasTimelineSummary {
  const { id, projectId, sourceCanvasId, sourceCanvasRevision, revision, title, createdAt, updatedAt } = document;
  return { id, projectId, sourceCanvasId, sourceCanvasRevision, revision, title, createdAt, updatedAt };
}
export function canvasTimelineProjectId(timelineId: string): string { return `project-${timelineId.replace(/^timeline-/, '')}`; }
export function canvasTimelineAsset(version: CanvasAssetVersion): ComicAsset {
  return { id: version.assetId, kind: version.kind, source: 'generated', uri: version.uri,
    status: version.status === 'missing' ? 'missing' : version.status === 'uploading' ? 'generating' : 'ready',
    ...version.metadata, createdAt: version.createdAt, updatedAt: version.createdAt };
}
function referencedTimelineAssets(project: ComicProject): readonly ComicAsset[] {
  const used = new Set(project.characters.flatMap(character => character.referenceAssetIds ?? []));
  for (const clip of project.composition?.clips ?? []) if (clip.assetId) used.add(clip.assetId);
  for (const scene of project.scenes) {
    if (scene.setPlateAssetId) used.add(scene.setPlateAssetId);
    for (const shot of scene.shots) for (const id of [shot.visualAssetId, shot.videoAssetId, shot.pendingVideoAssetId, shot.audioAssetId, shot.subtitleAssetId,
      ...(shot.musicAssetIds ?? []), ...(shot.effectAssetIds ?? [])]) if (id) used.add(id);
  }
  return project.assets.filter(asset => used.has(asset.id));
}
function fail(code: string, message: string, ids: readonly string[] = []): never { throw new CanvasSequenceError(code, message, ids); }
/** Canonical validation is used on disk reads, edits and undo; caller-supplied identity is never trusted. */
export function validateCanvasTimeline(value: unknown): CanvasTimelineDocument {
  if (!value || typeof value !== 'object') fail('TIMELINE_INVALID', 'Timeline must be an object');
  const item = value as CanvasTimelineDocument;
  if (item.schemaVersion !== 1 || !/^timeline-[a-zA-Z0-9-]{8,100}$/.test(item.id)
    || !item.projectId || !item.sourceCanvasId || !Number.isSafeInteger(item.revision) || item.revision < 0
    || !Number.isSafeInteger(item.sourceCanvasRevision) || item.sourceCanvasRevision < 0
    || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 120
    || !Array.isArray(item.sources) || item.sources.length > 5000
    || !Number.isFinite(Date.parse(item.createdAt)) || !Number.isFinite(Date.parse(item.updatedAt))) fail('TIMELINE_INVALID', 'Timeline identity or revision is invalid');
  const project = validateComicProject(item.project);
  if (project.id !== canvasTimelineProjectId(item.id) || project.revision !== item.revision || project.episodes !== undefined || project.scenes.some(scene => scene.episodeNumber !== undefined))
    fail('TIMELINE_IDENTITY', 'Timeline editor state must belong to this timeline and have no episode scope');
  for (const source of item.sources) if (!source || !['nodeId', 'versionId', 'assetId', 'shotId'].every(key => typeof source[key as keyof CanvasTimelineSource] === 'string' && source[key as keyof CanvasTimelineSource])
    || !Number.isFinite(source.durationMs) || source.durationMs <= 0 || !Number.isSafeInteger(source.sourceStartFrames) || source.sourceStartFrames < 0)
    fail('TIMELINE_SOURCE', 'Timeline source snapshot is invalid');
  return { ...structuredClone(item), project: { ...project, assets: referencedTimelineAssets(project) } };
}
export interface CreateCanvasTimelineOptions { readonly id: string; readonly now: string; readonly title?: string; readonly paths?: readonly (readonly string[])[] }
export function createCanvasTimeline(canvas: CanvasDocument, sourceProject: ComicProject, options: CreateCanvasTimelineOptions): CanvasTimelineDocument {
  if (canvas.projectId !== sourceProject.id) fail('TIMELINE_PROJECT_MISMATCH', 'Canvas belongs to another project');
  const ids = resolveCanvasSequence(canvas, options.paths), assets = new Map(sourceProject.assets.map(asset => [asset.id, structuredClone(asset)]));
  const shots: ComicShot[] = [], sources: CanvasTimelineSource[] = [], fps = sourceProject.frameRate;
  const title = (options.title?.trim() || canvas.title).slice(0, 120);
  for (const id of ids) {
    const node = canvas.nodes.find(candidate => candidate.id === id)!;
    const payload = node.payload;
    const version = 'versions' in payload ? payload.versions.find(item => item.id === payload.currentVersionId) : undefined;
    if (!version || version.kind !== 'video' || !version.uri || version.status === 'missing' || version.status === 'uploading')
      fail('TIMELINE_VIDEO_NOT_READY', `Choose a completed video version for ${node.title}`, [id]);
    const durationMs = version.metadata?.durationMs;
    if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) fail('TIMELINE_DURATION_REQUIRED', `Measure the actual video duration for ${node.title}`, [id]);
    const frames = Math.floor(durationMs * fps / 1000 + 1e-6);
    if (frames < 1 || frames > 24 * 60 * 60 * fps) fail('TIMELINE_DURATION_INVALID', `Video duration is outside the editable range: ${node.title}`, [id]);
    const asset = canvasTimelineAsset(version), existing = assets.get(asset.id);
    if (existing && (existing.uri !== asset.uri || existing.kind !== asset.kind || existing.sha256 && asset.sha256 && existing.sha256 !== asset.sha256))
      fail('TIMELINE_ASSET_CONFLICT', 'A video asset id refers to different files or versions', [id]);
    assets.set(asset.id, { ...existing, ...asset });
    // The legacy renderer caps a single shot at 18000 frames. Long source clips are split losslessly in source time.
    for (let start = 0; start < frames; start += 18000) {
      const shotId = `shot-${options.id.replace(/^timeline-/, '')}-${shots.length}`;
      const durationFrames = Math.min(18000, frames - start);
      shots.push({ id: shotId, title: node.title.slice(0, 120) || title, description: '', durationFrames, shotSize: 'medium', cameraMotion: 'static',
        visualPrompt: '', negativePrompt: '', transitionIn: 'cut', transitionOut: 'cut', transitionOutExplicit: true,
        volume: 1, fadeInFrames: 0, fadeOutFrames: 0, dialogueCues: [], videoAssetId: asset.id,
        mediaSourceStartFrames: { [asset.id]: start }, status: 'generated', createdAt: options.now, updatedAt: options.now });
      sources.push({ nodeId: id, versionId: version.id, assetId: asset.id, shotId, durationMs, sourceStartFrames: start, ...(asset.sha256 ? { sha256: asset.sha256 } : {}) });
      if (shots.length > 5000) fail('TIMELINE_LIMIT', 'The timeline exceeds 5000 editable clips');
    }
  }
  const { episodes: _episodes, adaptSettings: _settings, music: _music, titleDefault: _title, composition: _composition, ...base } = structuredClone(sourceProject);
  return validateCanvasTimeline({ schemaVersion: 1, id: options.id, projectId: sourceProject.id, sourceCanvasId: canvas.id, sourceCanvasRevision: canvas.revision,
    revision: 0, title, sources, createdAt: options.now, updatedAt: options.now,
    project: { ...base, id: canvasTimelineProjectId(options.id), projectKind: 'chat', revision: 0, title, characters: [], assets: [...assets.values()],
      scenes: [{ id: `scene-${options.id.replace(/^timeline-/, '')}`, title, summary: '', location: '', timeOfDay: '', shots, createdAt: options.now, updatedAt: options.now }],
      createdAt: options.now, updatedAt: options.now } });
}
/** A one-time copy preserves all old cuts/voice/transitions, without deleting or reseeding the old project. */
export function migrateLegacyCanvasTimeline(canvas: CanvasDocument, sourceProject: ComicProject, options: Omit<CreateCanvasTimelineOptions, 'paths'>): CanvasTimelineDocument {
  if (canvas.projectId !== sourceProject.id) fail('TIMELINE_PROJECT_MISMATCH', 'Canvas belongs to another project');
  const { episodes: _episodes, adaptSettings: _settings, music: _music, titleDefault: _default, ...base } = structuredClone(sourceProject);
  const title = (options.title?.trim() || canvas.title).slice(0, 120);
  const ordered = base.scenes.flatMap(scene => scene.shots.map(shot => ({ scene, shot })));
  const transitions = new Map(ordered.map(({ scene, shot }, index) => {
    const previous = ordered[index - 1], next = ordered[index + 1], episode = scene.episodeNumber ?? 1;
    return [shot.id, resolveComicShotTransitions(shot, { firstInEpisode: !previous || (previous.scene.episodeNumber ?? 1) !== episode,
      lastInEpisode: !next || (next.scene.episodeNumber ?? 1) !== episode, acrossScenes: Boolean(previous && previous.scene.id !== scene.id) })];
  }));
  return validateCanvasTimeline({ schemaVersion: 1, id: options.id, projectId: sourceProject.id, sourceCanvasId: canvas.id, sourceCanvasRevision: canvas.revision,
    revision: 0, title, sources: [], legacySource: { projectRevision: sourceProject.revision }, createdAt: options.now, updatedAt: options.now,
    project: { ...base, id: canvasTimelineProjectId(options.id), projectKind: 'chat', revision: 0, title,
      scenes: base.scenes.map(({ episodeNumber: _episode, ...scene }) => ({ ...scene,
        shots: scene.shots.map(shot => ({ ...shot, ...transitions.get(shot.id), transitionOutExplicit: true })) })), createdAt: options.now, updatedAt: options.now } });
}
/** Newly imported assets may be offered to editing; existing frozen bytes are never silently substituted. */
export function mergeCanvasTimelineAssets(document: CanvasTimelineDocument, project: ComicProject): ComicProject {
  if (document.projectId !== project.id) fail('TIMELINE_PROJECT_MISMATCH', 'Timeline belongs to another project');
  const known = new Set(document.project.assets.map(asset => asset.id));
  return { ...document.project, assets: [...document.project.assets, ...project.assets.filter(asset => !known.has(asset.id)).map(asset => structuredClone(asset))] };
}
export function editCanvasTimeline(document: CanvasTimelineDocument, edits: readonly ComicEditorEdit[], options: { readonly now: string; readonly locale?: string; readonly availableProject?: ComicProject }): { readonly timeline: CanvasTimelineDocument; readonly createdShotIds: ComicEditorResult['createdShotIds'] } {
  validateCanvasTimeline(document);
  const editable = options.availableProject ? mergeCanvasTimelineAssets(document, options.availableProject) : document.project;
  const result = applyComicEditorEdits(editable, edits, { now: options.now, ...(options.locale ? { locale: options.locale } : {}) });
  const timeline = restoreCanvasTimeline(document, result.project, options.now);
  return { timeline, createdShotIds: result.createdShotIds };
}
export function restoreCanvasTimeline(document: CanvasTimelineDocument, project: ComicProject, now: string): CanvasTimelineDocument {
  if (project.id !== document.project.id) fail('TIMELINE_IDENTITY', 'The edit belongs to another timeline');
  const { episodes: _episodes, adaptSettings: _settings, music: _music, ...base } = project;
  return validateCanvasTimeline({ ...document, revision: document.revision + 1, updatedAt: now,
    project: { ...base, projectKind: 'chat', revision: document.revision + 1, updatedAt: now,
      scenes: base.scenes.map(({ episodeNumber: _episode, ...scene }) => scene) } });
}
