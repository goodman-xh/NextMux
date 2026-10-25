import { CANVAS_SCHEMA_VERSION, resolveCanvasInputs, validateCanvasEdge } from './canvas.js';
import { applyComicCommand } from './core.js';
import { setProjectCharacterProfile } from './canvas-characters.js';
import { getComicAssetDurationFrames } from './media-timing.js';
import type { CanvasAssetVersion, CanvasCharacterNode, CanvasCompositionClip, CanvasDocument, CanvasEdge, CanvasGroup, CanvasNode, CanvasResultPayload } from './canvas.js';
import type { CanvasModelCapability } from './canvas-capabilities.js';
import type { ComicAsset, ComicCommand, ComicProject, ComicShot } from './types.js';

export interface SeedCanvasOptions {
  readonly previous?: CanvasDocument;
  readonly now?: string;
  readonly imageModelId?: string;
  readonly videoModelId?: string;
  readonly imageParameters?: Readonly<Record<string, unknown>>;
  readonly videoParameters?: Readonly<Record<string, unknown>>;
  readonly imageCapability?: CanvasModelCapability;
}

/** Deterministic IDs depend on project/source IDs, never labels or array positions. */
export function canvasProjectNodeId(projectId: string, role: string, sourceId: string): string {
  return `canvas-${encodeURIComponent(projectId)}-${role}-${encodeURIComponent(sourceId)}`;
}

export function canvasVersionFromComicAsset(asset: ComicAsset): CanvasAssetVersion {
  if (!['image', 'video', 'audio', 'music', 'effect'].includes(asset.kind)) throw new Error('Only media assets can enter a canvas');
  return {
    id: `version-${asset.id}`, assetId: asset.id, kind: asset.kind === 'music' || asset.kind === 'effect' ? 'audio' : asset.kind as 'image' | 'video' | 'audio',
    uri: asset.uri, createdAt: asset.createdAt, status: asset.status === 'ready' ? 'ready' : asset.status === 'generating' ? 'uploading' : 'missing',
    metadata: { ...(asset.durationMs !== undefined ? { durationMs: asset.durationMs } : {}),
      ...(asset.streamStartMs !== undefined ? { streamStartMs: asset.streamStartMs } : {}),
      ...(asset.width !== undefined ? { width: asset.width } : {}), ...(asset.height !== undefined ? { height: asset.height } : {}),
      ...(asset.mimeType ? { mimeType: asset.mimeType } : {}), ...(asset.byteLength !== undefined ? { byteLength: asset.byteLength } : {}),
      ...(asset.sha256 ? { sha256: asset.sha256 } : {}) },
    ...(asset.jobId ? { provenance: { jobId: asset.jobId } } : {}),
  };
}

interface SeedBaseline { readonly title: string; readonly prompt?: string; readonly mode?: string; readonly text?: string; readonly parameters?: Readonly<Record<string, unknown>>;
  readonly description?: string; readonly appearance?: string; }

/** Only the visible look belongs in a picture or clip prompt; personality notes do not. */
function visualCharacterLooks(appearance: string): string {
  return appearance.split(/\n+/).filter(line => !/^\s*(?:性格|性情|个性|個性|脾气|脾氣|personality|temperament)\s*[:：]/i.test(line))
    .join(' ').replace(/\s+/g, ' ').trim();
}

function sameProjectVersion(left: CanvasAssetVersion, right: CanvasAssetVersion): boolean {
  return left.id === right.id || left.assetId === right.assetId && left.uri === right.uri;
}

/** Project results can arrive after the canvas was opened; retain every authored take and selection. */
function mergeProjectResults(old: CanvasResultPayload, next: CanvasResultPayload): CanvasResultPayload {
  const versions = [...old.versions];
  for (const version of next.versions) if (!versions.some(existing => sameProjectVersion(existing, version))) versions.push(version);
  const selected = next.versions.find(version => version.id === next.currentVersionId);
  const currentVersionId = old.currentVersionId ?? (selected ? versions.find(version => sameProjectVersion(version, selected))?.id : undefined);
  return { versions, ...(currentVersionId ? { currentVersionId } : {}) };
}

/** Creates editable nodes without submitting jobs. Reseeding preserves edits/results and marks removed sources orphaned. */
export function seedCanvasFromProject(project: ComicProject, options: SeedCanvasOptions = {}): CanvasDocument {
  const previous = options.previous;
  if (previous && previous.projectId !== project.id) throw new Error('Canvas belongs to another comic project');
  const now = options.now ?? project.updatedAt;
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const groups: CanvasGroup[] = [];
  const baselines: Record<string, SeedBaseline> = {};
  const notices: string[] = [];
  // Card geometry is workspace chrome, not the generated media's aspect ratio.
  const cardSize = { width: 360, height: 260 };
  // The row gap also clears a scene group's title, drawn 24 px above its 60 px top inset.
  const rowStep = Math.max(360, cardSize.height + 104);
  const id = (role: string, source: string) => canvasProjectNodeId(project.id, role, source);
  const add = (node: CanvasNode) => {
    nodes.push(node);
    baselines[node.id] = { title: node.title, ...('prompt' in node.payload ? { prompt: node.payload.prompt, parameters: node.payload.parameters, mode: node.payload.mode } : {}),
      ...(node.kind === 'text' ? { text: node.payload.text } : {}),
      ...(node.kind === 'character' ? { description: node.payload.description, appearance: node.payload.appearance } : {}) };
  };
  const edge = (source: string, target: string, role: CanvasEdge['role'], order: number) => edges.push({
    id: id('edge', `${source}:${target}:${role}`), sourceNodeId: source, sourcePort: role === 'character' ? 'character' : role === 'firstFrame' || role === 'referenceImage' ? 'image' : 'output',
    targetNodeId: target, targetPort: role, role, order, binding: 'followCurrent',
  });
  const result = (...assetIds: readonly (string | undefined)[]) => {
    const versions = [...new Set(assetIds)].map(assetId => assetId ? assets.get(assetId) : undefined)
      .filter((asset): asset is ComicAsset => Boolean(asset)).map(canvasVersionFromComicAsset);
    return { versions, ...(versions[0] ? { currentVersionId: versions[0].id } : {}) };
  };
  const imageMode = options.imageCapability?.modes.find(mode => mode.mode === 'imageToImage');
  const referenceLimit = options.imageCapability && !imageMode || imageMode?.referenceRules?.image?.supported === false
    ? 0 : imageMode?.referenceRules?.image?.maxCount;
  project.characters.forEach((character, index) => {
    const versions = (character.referenceAssetIds ?? []).map(assetId => assets.get(assetId)).filter((asset): asset is ComicAsset => asset?.kind === 'image').map(canvasVersionFromComicAsset);
    const characterId = id('character', character.id);
    // These nodes also supply text-only identity edges when reference budgets are exhausted.
    // Keep their exported identity visual, just like the shot prompt; the source character retains story notes.
    add({ id: characterId, kind: 'character', title: character.name, position: { x: 0, y: index * rowStep }, size: cardSize,
      origin: { characterId: character.id, role: 'character' }, payload: { characterId: character.id,
        appearance: visualCharacterLooks(character.appearance), versions, ...(versions[0] ? { currentVersionId: versions[0].id } : {}) } });
    const portraitId = id('portrait', character.id);
    const portraitReference = versions.length > 0 && referenceLimit !== 0;
    add({ id: portraitId, kind: 'imageGen', title: character.name, position: { x: 460, y: index * rowStep }, size: cardSize,
      origin: { characterId: character.id, role: 'portrait' }, payload: { mode: portraitReference ? 'imageToImage' : 'textToImage', modelId: options.imageModelId ?? 'unconfigured:image',
        prompt: [character.name, character.description, character.appearance, project.styleBible].filter(Boolean).join('\n'),
        parameters: { ...options.imageParameters, aspectRatio: options.imageParameters?.aspectRatio ?? '1:1' }, versions,
        ...(versions[0] ? { currentVersionId: versions[0].id } : {}) } });
    // A new identity has no image yet. A typed identity edge avoids a circular portrait prerequisite.
    edge(characterId, portraitId, portraitReference ? 'referenceImage' : 'character', 0);
  });
  let sceneY = Math.max(0, project.characters.length * rowStep);
  for (const episode of project.episodes ?? []) {
    add({ id: id('script', String(episode.number)), kind: 'text', title: episode.title, position: { x: 0, y: sceneY }, size: { width: 320, height: 280 },
      origin: { role: 'script' }, payload: { text: episode.script } });
    sceneY += 384;
  }
  // Scene groups fill a near-square grid to the right of the characters and scripts, so a long episode opens readable
  // instead of as one tall column. Existing canvases keep their own layout (the merge below keeps old positions).
  const blockHeight = (shots: number) => Math.max(cardSize.height + 180, shots * rowStep + 140);
  const columns = Math.max(1, Math.min(4, Math.round(Math.sqrt(project.scenes.length * 0.8))));
  const rowHeights: number[] = [];
  project.scenes.forEach((scene, index) => { const row = Math.floor(index / columns); rowHeights[row] = Math.max(rowHeights[row] ?? 0, blockHeight(scene.shots.length)); });
  const rowTops = rowHeights.map((_, row) => 60 + rowHeights.slice(0, row).reduce((sum, height) => sum + height + 60, 0));
  project.scenes.forEach((scene, sceneIndex) => {
    const blockX = 960 + (sceneIndex % columns) * 1020;
    const sceneY = rowTops[Math.floor(sceneIndex / columns)];
    const groupId = id('scene', scene.id);
    const members: string[] = [];
    add({ id: groupId, kind: 'group', title: scene.title, position: { x: blockX, y: sceneY - 60 }, size: { width: 900, height: Math.max(cardSize.height + 120, scene.shots.length * rowStep + 80) },
      origin: { sceneId: scene.id, role: 'scene' }, payload: { groupId } });
    scene.shots.forEach((shot, index) => {
      const storyId = id('storyboard', shot.id);
      const videoId = id('shotVideo', shot.id);
      const words = shot.visualPrompt.toLocaleLowerCase();
      const characters = project.characters.filter(character => [character.name, ...(character.aliases ?? [])]
        .some(name => name.trim().length > 1 && words.includes(name.trim().toLocaleLowerCase())));
      const place = [scene.location, scene.timeOfDay].map(value => value.trim()).filter(Boolean).join(' · ');
      const identity = characters.map(character => `${character.name}: ${visualCharacterLooks(character.appearance)}`).join('; ');
      const prompt = [shot.visualPrompt, place, identity, project.styleBible].filter(value => value.trim()).join('\n');
      const refs = characters.slice(0, referenceLimit ?? characters.length);
      if (refs.length < characters.length) notices.push(`${shot.id}: ${characters.length - refs.length} character image references exceed the model limit; their identity text is retained`);
      add({ id: storyId, kind: 'imageGen', title: shot.title, position: { x: blockX + 40, y: sceneY + index * rowStep }, size: cardSize,
        origin: { sceneId: scene.id, shotId: shot.id, role: 'storyboard' }, payload: { mode: refs.length ? 'imageToImage' : 'textToImage',
          modelId: options.imageModelId ?? 'unconfigured:image', prompt,
          parameters: { ...options.imageParameters, aspectRatio: project.canvas.aspectRatio }, ...result(shot.visualAssetId) } });
      add({ id: videoId, kind: 'videoGen', title: shot.title, position: { x: blockX + 500, y: sceneY + index * rowStep }, size: cardSize,
        origin: { sceneId: scene.id, shotId: shot.id, role: 'shotVideo' }, payload: { mode: 'imageToVideo', modelId: options.videoModelId ?? 'unconfigured:video',
          prompt, parameters: { ...options.videoParameters, durationSeconds: Math.max(1, Math.ceil(shot.durationFrames / project.frameRate)), aspectRatio: project.canvas.aspectRatio }, ...result(shot.videoAssetId, shot.pendingVideoAssetId) } });
      characters.forEach((character, order) => edge(id('character', character.id), storyId, refs.includes(character) ? 'referenceImage' : 'character', order));
      edge(storyId, videoId, 'firstFrame', 0);
      members.push(storyId, videoId);
    });
    groups.push({ id: groupId, title: scene.title, nodeIds: members });
  });
  if (!previous) return { schemaVersion: CANVAS_SCHEMA_VERSION, id: id('document', project.id), projectId: project.id, title: project.title,
    viewport: { x: 0, y: 0, zoom: 1 }, settings: { seedBaselines: baselines, seedEdges: edges, seedGroups: groups, seedNotices: notices, sourceProjectRevision: project.revision },
    nodes, edges, groups, revision: 0, createdAt: now, updatedAt: now };
  const oldBaselines = (previous.settings.seedBaselines ?? {}) as Record<string, SeedBaseline>;
  const fresh = new Map(nodes.map(node => [node.id, node]));
  const mergedNodes = previous.nodes.map(old => {
    const next = fresh.get(old.id);
    fresh.delete(old.id);
    if (!next) {
      const removedShot = old.origin?.shotId && !project.scenes.some(scene => scene.shots.some(shot => shot.id === old.origin?.shotId));
      const removedCharacter = old.origin?.characterId && !project.characters.some(character => character.id === old.origin?.characterId);
      const removedScene = !old.origin?.shotId && old.origin?.sceneId && !project.scenes.some(scene => scene.id === old.origin?.sceneId);
      return removedShot || removedCharacter || removedScene || oldBaselines[old.id] ? { ...old, orphaned: true } : old;
    }
    const baseline = oldBaselines[old.id];
    let payload = old.payload;
    if ((old.kind === 'imageGen' || old.kind === 'videoGen') && (next.kind === 'imageGen' || next.kind === 'videoGen')) {
      const parameters = { ...old.payload.parameters };
      for (const [key, value] of Object.entries(next.payload.parameters)) {
        if (old.payload.parameters[key] === baseline?.parameters?.[key]) parameters[key] = value;
      }
      payload = { ...old.payload, ...mergeProjectResults(old.payload, next.payload), parameters, mode: old.payload.mode === baseline?.mode ? next.payload.mode : old.payload.mode,
        prompt: old.payload.prompt === baseline?.prompt ? next.payload.prompt : old.payload.prompt };
    } else if (old.kind === 'character' && next.kind === 'character') {
      const trackedIdentity = baseline && Object.hasOwn(baseline, 'appearance');
      payload = { ...old.payload, ...mergeProjectResults(old.payload, next.payload),
        description: !trackedIdentity || old.payload.description === baseline.description ? next.payload.description : old.payload.description,
        appearance: !trackedIdentity || old.payload.appearance === baseline.appearance ? next.payload.appearance : old.payload.appearance };
    }
    else if (old.kind === 'text' && next.kind === 'text') payload = old.payload.text === baseline?.text ? next.payload : old.payload;
    // Compare against the saved title verbatim: unchanged legacy English suffixes migrate,
    // while a suffix the user added to a newer plain title remains an authored edit.
    return { ...old, origin: next.origin, orphaned: false, title: old.title === baseline?.title ? next.title : old.title, payload } as CanvasNode;
  });
  mergedNodes.push(...fresh.values());
  const oldNodeIds = new Set(previous.nodes.map(node => node.id));
  const oldSeedEdges = new Map((Array.isArray(previous.settings.seedEdges) ? previous.settings.seedEdges as readonly CanvasEdge[] : []).map(edge => [edge.id, edge]));
  const newSeedEdges = new Map(edges.map(edge => [edge.id, edge]));
  const mergedEdges = previous.edges.filter(edge => {
    const baseline = oldSeedEdges.get(edge.id);
    // Removed/changed default relations can change; authored edges and orphan wiring stay intact.
    return !baseline || JSON.stringify(edge) !== JSON.stringify(baseline) || newSeedEdges.has(edge.id)
      || !nodes.some(node => node.id === edge.targetNodeId);
  }).map(edge => oldSeedEdges.has(edge.id) && JSON.stringify(edge) === JSON.stringify(oldSeedEdges.get(edge.id)) ? newSeedEdges.get(edge.id) ?? edge : edge);
  const oldSeedGroups = (Array.isArray(previous.settings.seedGroups) ? previous.settings.seedGroups : []) as readonly CanvasGroup[];
  const oldMembership = new Map(previous.groups.flatMap(group => group.nodeIds.map(nodeId => [nodeId, group.id] as const)));
  const seededMembership = new Map(oldSeedGroups.flatMap(group => group.nodeIds.map(nodeId => [nodeId, group.id] as const)));
  const desiredMembership = new Map(groups.flatMap(group => group.nodeIds.map(nodeId => [nodeId, group.id] as const)));
  const mergedGroups = previous.groups.map(group => ({ ...group, nodeIds: group.nodeIds.filter(nodeId =>
    oldMembership.get(nodeId) !== seededMembership.get(nodeId) || !desiredMembership.has(nodeId) || desiredMembership.get(nodeId) === group.id) }));
  for (const group of groups) {
    const existingIndex = mergedGroups.findIndex(old => old.id === group.id);
    const actual = existingIndex >= 0 ? mergedGroups[existingIndex] : undefined;
    const nodeIds = group.nodeIds.filter(nodeId => !oldNodeIds.has(nodeId) || oldMembership.get(nodeId) === seededMembership.get(nodeId));
    const updated = { ...group, ...(actual ? { title: actual.title, nodeIds: [...new Set([...actual.nodeIds, ...nodeIds])] } : { nodeIds }) };
    if (existingIndex >= 0) mergedGroups[existingIndex] = updated; else mergedGroups.push(updated);
  }
  for (const candidate of edges) {
    if (mergedEdges.some(edge => edge.id === candidate.id) || oldSeedEdges.has(candidate.id)) continue; // authored disconnection
    const issues = validateCanvasEdge({ ...previous, nodes: mergedNodes, groups: mergedGroups, edges: mergedEdges }, candidate);
    if (issues.length) notices.push(`${candidate.targetNodeId}: new adaptation relation was not connected: ${issues.map(issue => issue.message).join('; ')}`);
    else mergedEdges.push(candidate);
  }
  return { ...previous, nodes: mergedNodes, edges: mergedEdges, groups: mergedGroups,
    settings: { ...previous.settings, seedBaselines: baselines, seedEdges: edges, seedGroups: groups, seedNotices: notices, sourceProjectRevision: project.revision }, revision: previous.revision + 1, updatedAt: now };
}

function selectedVersion(node: CanvasNode | undefined, kind: CanvasAssetVersion['kind']): CanvasAssetVersion | undefined {
  if (!node || !('versions' in node.payload) || !node.payload.currentVersionId) return undefined;
  const payload = node.payload;
  const version = payload.versions.find(item => item.id === payload.currentVersionId);
  if (!version || version.kind !== kind || version.status === 'missing' || version.status === 'uploading') throw new Error('Canvas current output is not ready');
  return version;
}
function requireProjectAsset(project: ComicProject, version: CanvasAssetVersion, kind: 'image' | 'video'): ComicAsset {
  const asset = project.assets.find(item => item.id === version.assetId);
  if (!asset || asset.kind !== kind || asset.status !== 'ready' || asset.uri !== version.uri) throw new Error(`Canvas asset ${version.assetId} must be imported into the comic project before commit`);
  return asset;
}

/** Revision-sequenced existing comic commands; the caller applies them atomically through the project store. */
export function commitCanvasToProject(canvas: CanvasDocument, project: ComicProject): readonly ComicCommand[] {
  if (canvas.projectId !== project.id) throw new Error('Canvas belongs to another comic project');
  const commands: ComicCommand[] = [];
  for (const scene of project.scenes) for (const shot of scene.shots) {
    const bound = (kind: 'imageGen' | 'videoGen') => {
      const matches = canvas.nodes.filter(node => !node.orphaned && node.kind === kind && node.origin?.shotId === shot.id);
      if (matches.length > 1) throw new Error(`More than one ${kind} is bound to shot ${shot.id}`);
      return matches[0];
    };
    const video = selectedVersion(bound('videoGen'), 'video');
    const firstFrame = video?.snapshot?.resolvedInputs.find(input => input.role === 'firstFrame' && input.kind === 'image');
    const fallback = firstFrame ? { id: firstFrame.versionId, assetId: firstFrame.assetId, kind: 'image' as const, uri: firstFrame.uri, createdAt: video!.createdAt }
      : selectedVersion(bound('imageGen'), 'image');
    for (const [version, kind, slot, current] of [[fallback, 'image', 'visual', shot.visualAssetId], [video, 'video', 'video', shot.videoAssetId]] as const) {
      if (!version) continue;
      requireProjectAsset(project, version, kind);
      if (version.assetId === current) continue;
      commands.push({ type: 'media.link', expectedRevision: project.revision + commands.length, sceneId: scene.id, shotId: shot.id, slot, assetId: version.assetId });
    }
  }
  return commands;
}

/** Explicit portrait approval. The generation result never silently replaces an identity reference. */
export function commitCanvasCharacterToProject(canvas: CanvasDocument, project: ComicProject, characterNodeId: string, portraitNodeId?: string): readonly ComicCommand[] {
  if (canvas.projectId !== project.id) throw new Error('Canvas belongs to another comic project');
  const node = canvas.nodes.find(item => item.id === characterNodeId);
  if (node?.kind !== 'character' || node.orphaned) throw new Error('Character node does not exist');
  const character = project.characters.find(item => item.id === node.payload.characterId);
  if (!character) throw new Error('Character is no longer in the comic project');
  const portrait = portraitNodeId ? canvas.nodes.find(item => item.id === portraitNodeId) : node;
  if (portraitNodeId && (portrait?.kind !== 'imageGen' || portrait.origin?.characterId !== character.id || portrait.orphaned)) throw new Error('Portrait belongs to another character');
  const version = selectedVersion(portrait, 'image');
  if (!version) throw new Error('Choose a ready portrait version before binding');
  requireProjectAsset(project, version, 'image');
  const references = [version.assetId, ...(character.referenceAssetIds ?? []).filter(assetId => assetId !== version.assetId)];
  if (character.identityVersion === version.id && JSON.stringify(character.referenceAssetIds) === JSON.stringify(references)) return [];
  return [{ type: 'character.update', expectedRevision: project.revision, characterId: character.id,
    patch: { referenceAssetIds: references, identityVersion: version.id } }];
}

/** Prepares an approved portrait binding for one atomic project-store commit. */
export function prepareCanvasCharacterProjectBinding(canvas: CanvasDocument, project: ComicProject, characterNodeId: string, portraitNodeId?: string, now = project.updatedAt): ComicProject {
  const commands = commitCanvasCharacterToProject(canvas, project, characterNodeId, portraitNodeId);
  const node = canvas.nodes.find(item => item.id === characterNodeId) as CanvasCharacterNode;
  const character = project.characters.find(item => item.id === node.payload.characterId)!;
  const profile = character.canvasCharacter;
  if (!profile) return commands.reduce((current, command) => applyComicCommand(current, command, { now }), project);
  const version = selectedVersion(portraitNodeId ? canvas.nodes.find(item => item.id === portraitNodeId) : node, 'image')!;
  if (!commands.length && profile.sourceIdentityVersion === version.id && profile.referenceViews[0]?.versionId === version.id) return project;
  const asset = requireProjectAsset(project, version, 'image');
  const existing = profile.referenceViews.find(ref => ref.assetId === version.assetId && ref.versionId === version.id);
  const reference = { ...(existing ?? { view: 'unspecified' as const }), assetId: version.assetId, versionId: version.id,
    qualityStatus: 'approved' as const, ...(asset.sha256 ? { sha256: asset.sha256 } : {}) };
  return setProjectCharacterProfile(project, character.id, { ...profile, canonicalVersion: profile.canonicalVersion + 1,
    sourceIdentityVersion: version.id, referenceViews: [reference, ...profile.referenceViews.filter(ref => ref.assetId !== version.assetId)],
    providerBindings: profile.providerBindings.map(binding => ['active', 'valid'].includes(binding.status) ? { ...binding, status: 'stale' as const } : binding),
  }, now);
}

/** Copies an explicitly approved portrait into the character output used on every later request. */
export function bindCanvasCharacterPortrait(canvas: CanvasDocument, characterNodeId: string, portraitNodeId: string, now = canvas.updatedAt): CanvasDocument {
  const character = canvas.nodes.find(node => node.id === characterNodeId);
  const portrait = canvas.nodes.find(node => node.id === portraitNodeId);
  if (character?.kind !== 'character' || portrait?.kind !== 'imageGen' || character.payload.characterId !== portrait.origin?.characterId) throw new Error('Portrait belongs to another character');
  const version = selectedVersion(portrait, 'image');
  if (!version) throw new Error('Portrait has no selected image');
  const updated: CanvasCharacterNode = { ...character, payload: { ...character.payload,
    versions: [...character.payload.versions.filter(item => item.id !== version.id), version], currentVersionId: version.id } };
  return { ...canvas, nodes: canvas.nodes.map(node => node.id === characterNodeId ? updated : node), revision: canvas.revision + 1, updatedAt: now };
}

function exportId(prefix: string, key: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193) >>> 0;
  return `${prefix}-canvas-${hash.toString(16).padStart(8, '0')}`;
}

/**
 * Builds an export-only project for the existing FFmpeg exporter. Video clips must form one
 * continuous track; audio offsets/overlap are represented by splitting at their boundaries.
 * Times are quantized to the selected project frame rate. Unequal simultaneous gains cannot
 * be represented by the existing per-shot mixer and are rejected explicitly.
 */
export function buildCanvasCompositionProject(canvas: CanvasDocument, nodeId: string, project: ComicProject): ComicProject {
  if (canvas.projectId !== project.id) throw new Error('Canvas belongs to another comic project');
  const node = canvas.nodes.find(candidate => candidate.id === nodeId);
  if (node?.kind !== 'composition') throw new Error('Composition node does not exist');
  const versions = new Map<string, CanvasAssetVersion>();
  const conflictingVersions = new Set<string>();
  const addVersion = (version: CanvasAssetVersion): void => {
    const previous = versions.get(version.id);
    const identity = (item: CanvasAssetVersion) => JSON.stringify([item.assetId, item.kind, item.uri, item.metadata?.sha256]);
    if (previous && identity(previous) !== identity(version)) conflictingVersions.add(version.id);
    versions.set(version.id, version);
  };
  for (const candidate of canvas.nodes) if ('versions' in candidate.payload) for (const version of candidate.payload.versions) addVersion(version);
  if (node.payload.inputs) for (const input of node.payload.inputs) addVersion(input.version);
  let clips = [...node.payload.clips];
  if (!clips.length) {
    const resolved = resolveCanvasInputs(canvas, nodeId);
    if (resolved.missing.length) throw new Error('Composition has missing inputs');
    let videoEndMs = 0;
    clips = resolved.inputs.filter(input => input.kind === 'video' || input.kind === 'audio').map((input, index): CanvasCompositionClip => {
      if (!input.metadata?.durationMs) throw new Error(`Composition input ${input.versionId} has no measured duration`);
      const startMs = input.kind === 'video' ? videoEndMs : 0;
      if (input.kind === 'video') videoEndMs += input.metadata.durationMs;
      return { id: `clip-${index}`, assetVersionId: input.versionId, trackId: input.kind, startMs, inMs: 0, outMs: input.metadata.durationMs, volume: 1, muted: false };
    });
  }
  const frameRate = node.payload.parameters.frameRate ?? project.frameRate;
  if (![24, 25, 30].includes(frameRate as number)) throw new Error('Composition frame rate must be 24, 25 or 30');
  const fps = frameRate as ComicProject['frameRate'];
  const frame = (ms: number) => Math.round(ms * fps / 1_000);
  const timeline = clips.map(clip => {
    if (conflictingVersions.has(clip.assetVersionId)) throw new Error(`Composition version ${clip.assetVersionId} has conflicting media`);
    const version = versions.get(clip.assetVersionId);
    if (!version || !['video', 'audio'].includes(version.kind) || version.status === 'uploading' || version.status === 'missing') throw new Error(`Composition version ${clip.assetVersionId} is unavailable`);
    const asset = project.assets.find(candidate => candidate.id === version.assetId && candidate.uri === version.uri && candidate.status === 'ready');
    if (!asset || (version.kind === 'video' ? asset.kind !== 'video' : !['audio', 'music', 'effect'].includes(asset.kind))) throw new Error(`Composition asset ${version.assetId} must be imported before export`);
    if (![clip.startMs, clip.inMs, clip.outMs, clip.volume].every(Number.isFinite) || clip.startMs < 0 || clip.inMs < 0
      || clip.outMs <= clip.inMs || clip.volume < 0 || clip.volume > 2) throw new Error(`Composition clip ${clip.id} has invalid timing or volume`);
    const durationMs = version.metadata?.durationMs ?? asset.durationMs;
    if (!durationMs || clip.outMs > durationMs + 0.001) throw new Error(`Composition clip ${clip.id} exceeds its measured source length`);
    const maxSourceFrames = getComicAssetDurationFrames({ ...asset, durationMs }, fps) ?? Math.floor(durationMs * fps / 1_000);
    const start = frame(clip.startMs);
    const sourceStart = Math.min(frame(clip.inMs), Math.max(0, maxSourceFrames - 1));
    const sourceEnd = Math.min(frame(clip.outMs), maxSourceFrames);
    const duration = sourceEnd - sourceStart;
    if (duration < 1) throw new Error(`Composition clip ${clip.id} is shorter than one output frame`);
    return { clip, version, asset, start, end: start + duration, sourceStart };
  });
  const videos = timeline.filter(item => item.version.kind === 'video').sort((a, b) => a.start - b.start || a.clip.id.localeCompare(b.clip.id));
  const audio = timeline.filter(item => item.version.kind === 'audio' && !item.clip.muted && item.clip.volume > 0);
  if (!videos.length) throw new Error('Composition requires at least one video');
  let end = 0;
  for (const video of videos) {
    if (video.start !== end) throw new Error('The existing exporter requires a continuous, non-overlapping video track');
    end = video.end;
  }
  if (audio.some(item => item.end > end)) throw new Error('Composition audio extends past its video track');
  const imported = [...project.assets];
  const audioAssets = new Map<string, ComicAsset>();
  audio.forEach(item => {
    const clone = { ...item.asset, id: exportId('asset', `${canvas.id}:${nodeId}:${item.clip.id}`), kind: 'effect' as const };
    imported.push(clone);
    audioAssets.set(item.clip.id, clone);
  });
  const shots: ComicShot[] = [];
  for (const video of videos) {
    const boundaries = [...new Set([video.start, video.end, ...audio.flatMap(item => [item.start, item.end]).filter(value => value > video.start && value < video.end)])].sort((a, b) => a - b);
    for (let index = 0; index < boundaries.length - 1; index++) {
      const start = boundaries[index], stop = boundaries[index + 1];
      const active = audio.filter(item => item.start <= start && item.end >= stop);
      const nativeMuted = video.clip.muted || video.clip.volume === 0;
      const volume = nativeMuted ? active[0]?.clip.volume ?? 0 : video.clip.volume;
      if (active.some(item => item.clip.volume !== volume)) throw new Error('The existing exporter cannot apply unequal gains to simultaneous composition clips');
      const sourceStarts: Record<string, number> = { [video.asset.id]: video.sourceStart + start - video.start };
      const lengths: Record<string, number> = {};
      for (const item of active) {
        const asset = audioAssets.get(item.clip.id)!;
        sourceStarts[asset.id] = item.sourceStart + start - item.start;
        lengths[asset.id] = stop - start;
      }
      const tracks = active.map(item => audioAssets.get(item.clip.id)!.id);
      // An explicit audio slot suppresses native video audio in the existing exporter.
      const audioAssetId = nativeMuted && tracks.length ? tracks.shift() : undefined;
      const mediaFit = node.payload.parameters.mediaFit ?? 'contain';
      if (mediaFit !== 'contain' && mediaFit !== 'cover') throw new Error('Invalid composition framing policy');
      shots.push({ id: exportId('shot', `${nodeId}:${video.clip.id}:${index}`), title: `${node.title} ${shots.length + 1}`, description: '',
        durationFrames: stop - start, shotSize: 'wide', cameraMotion: 'static', visualPrompt: '', negativePrompt: '',
        transitionIn: 'cut', transitionOut: 'cut', volume, fadeInFrames: 0, fadeOutFrames: 0, dialogueCues: [],
        videoAssetId: video.asset.id, ...(audioAssetId ? { audioAssetId } : {}), effectAssetIds: tracks,
        mediaSourceStartFrames: sourceStarts, mediaDurationFrames: lengths, mediaFit, status: 'generated',
        createdAt: canvas.createdAt, updatedAt: canvas.updatedAt });
    }
  }
  const canvasSize = node.payload.parameters.canvas ?? project.canvas;
  if (!canvasSize || typeof canvasSize !== 'object') throw new Error('Invalid composition output canvas');
  const size = canvasSize as ComicProject['canvas'];
  if (!['16:9', '9:16', '1:1', '4:3'].includes(size.aspectRatio) || !Number.isInteger(size.width) || !Number.isInteger(size.height)
    || size.width < 2 || size.height < 2 || size.width > 16_384 || size.height > 16_384) throw new Error('Invalid composition output canvas');
  const { music: _music, composition: _composition, ...base } = project;
  return { ...base, projectKind: 'novel', title: node.title, frameRate: fps, canvas: size, assets: imported,
    scenes: [{ id: exportId('scene', `${canvas.id}:${nodeId}`), title: node.title, summary: '', location: '', timeOfDay: '', shots,
      createdAt: canvas.createdAt, updatedAt: canvas.updatedAt }] };
}
