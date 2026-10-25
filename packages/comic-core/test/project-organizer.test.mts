import assert from 'node:assert/strict';
import test from 'node:test';
import { createComicProject } from '../lib/core.js';
import { validateComicProject } from '../lib/codec.js';
import { setProjectCharacterProfile } from '../lib/canvas-characters.js';
import { createSceneDocument, createSceneObject, normalizeWorld } from '../lib/director-scene.js';
import { createCanvasDocument, validateCanvasDocument } from '../lib/canvas.js';
import type { CanvasAssetVersion, CanvasDocument, CanvasImageGenNode, CanvasNode, GenerationSnapshot } from '../lib/canvas.js';
import type { ComicAsset, ComicProject } from '../lib/types.js';
import { applyComicProjectMetaPatch, comicProjectCoverCandidates, createComicProjectFolder, deleteComicProjectFolder, duplicateComicProject, duplicateComicProjectBundle, normalizeComicProjectMetaPatch, queryComicProjects, renameComicProjectFolder } from '../lib/project-organizer.js';

const now = '2026-10-01T10:00:00.000Z', later = '2026-10-01T11:00:00.000Z';
function project(): ComicProject {
  let next = 0;
  return createComicProject({ title: '工程 2', now, idFactory: kind => `${kind}-test${String(++next).padStart(8, '0')}` });
}
function asset(id: string, kind: ComicAsset['kind'] = 'image', status: ComicAsset['status'] = 'ready'): ComicAsset {
  return { id, kind, source: 'imported', uri: `nextmux.media/${id}.png`, status, createdAt: now, updatedAt: now };
}
function mediaVersion(id: string, assetId: string): CanvasAssetVersion { return { id, assetId, kind: 'image', uri: `nextmux.media/${assetId}.png`, createdAt: now }; }
const geometry = { position: { x: 0, y: 0 }, size: { width: 200, height: 120 } };

test('folders create and rename trim text, reject duplicate/empty/long names, and keep IDs', () => {
  const folders = createComicProjectFolder([], 'folder-one', '  第一组  ', now);
  assert.equal(folders[0].name, '第一组');
  const renamed = renameComicProjectFolder(folders, 'folder-one', '第二组', later);
  assert.equal(renamed[0].id, folders[0].id);
  assert.equal(renamed[0].createdAt, now);
  assert.equal(renamed[0].updatedAt, later);
  assert.equal(folders[0].name, '第一组');
  for (const name of [' ', 'x'.repeat(65)]) assert.throws(() => createComicProjectFolder(folders, 'folder-two', name, now), { code: 'INVALID_NAME' });
  assert.throws(() => createComicProjectFolder(folders, 'folder-two', ' 第一组 ', now), { code: 'DUPLICATE_FOLDER_NAME' });
  const alpha = createComicProjectFolder([], 'folder-alpha', 'Alpha', now);
  assert.throws(() => createComicProjectFolder(alpha, 'folder-beta', 'ＡＬＰＨＡ', now), { code: 'DUPLICATE_FOLDER_NAME' });
  assert.throws(() => renameComicProjectFolder(folders, 'missing', '名称', now), { code: 'FOLDER_NOT_FOUND' });
});

test('deleting a folder clears all memberships without removing project metadata or documents', () => {
  const first = project(), second = { ...project(), id: 'project-second0001' };
  const documents = [first, second], before = JSON.stringify(documents);
  const folders = createComicProjectFolder([], 'folder-one', '组', now);
  const metadata = documents.map(item => ({ projectId: item.id, folderId: 'folder-one', coverAssetId: 'asset-cover0001', updatedAt: now }));
  const result = deleteComicProjectFolder(folders, metadata, 'folder-one', later);
  assert.equal(result.folders.length, 0);
  assert.equal(result.projectMetadata.length, 2);
  assert.ok(result.projectMetadata.every(meta => meta.folderId === null && meta.coverAssetId === 'asset-cover0001'));
  assert.equal(JSON.stringify(documents), before);
  assert.ok(metadata.every(meta => meta.folderId === 'folder-one'));
});

test('metadata patches accept only ready project images and preserve automatic versus cleared cover', () => {
  const base = project(), ready = asset('asset-ready0001');
  const source = { ...base, assets: [ready, asset('asset-missing001', 'image', 'missing'), asset('asset-generating1', 'image', 'generating'), asset('asset-failed0001', 'image', 'failed'), asset('asset-video0001', 'video')] };
  assert.deepEqual(comicProjectCoverCandidates(source), [ready]);
  const folders = createComicProjectFolder([], 'folder-one', '组', now);
  assert.deepEqual(normalizeComicProjectMetaPatch(source, { title: ' 新名称 ', folderId: 'folder-one', coverAssetId: ready.id }, folders), { title: '新名称', folderId: 'folder-one', coverAssetId: ready.id });
  for (const id of ['asset-missing001', 'asset-generating1', 'asset-failed0001', 'asset-video0001', 'asset-foreign001']) assert.throws(() => normalizeComicProjectMetaPatch(source, { coverAssetId: id }, folders), { code: 'INVALID_COVER' });
  assert.throws(() => normalizeComicProjectMetaPatch(source, { folderId: 'unknown' }, folders), { code: 'FOLDER_NOT_FOUND' });
  assert.throws(() => normalizeComicProjectMetaPatch(source, { revision: 8 }, folders), { code: 'INVALID_META_PATCH' });
  const metadata = { projectId: source.id, updatedAt: now };
  const clear = applyComicProjectMetaPatch(source, metadata, { coverAssetId: null }, folders, later);
  assert.equal(clear.metadata.coverAssetId, null);
  assert.strictEqual(clear.project, source);
  assert.equal('coverAssetId' in metadata, false);
  const renamed = applyComicProjectMetaPatch(source, metadata, { title: '手写标题' }, folders, later);
  assert.equal(renamed.project.title, '手写标题');
  assert.equal(renamed.project.revision, source.revision + 1);
  assert.equal(renamed.project.titleDefault, undefined);
});

test('search and folder views include unknown folder IDs in unclassified and use numeric zh-CN ordering', () => {
  const base = project(), projects = [base, { ...base, id: 'project-second0001', title: '工程 10', updatedAt: later }, { ...base, id: 'project-third00001', title: 'ALPHA' }];
  const folders = createComicProjectFolder([], 'folder-one', '组', now);
  const metadata = [{ projectId: base.id, folderId: 'folder-one', updatedAt: now }, { projectId: projects[1].id, folderId: 'removed', updatedAt: later }];
  assert.deepEqual(queryComicProjects(projects, folders, metadata, { folderId: 'folder-one' }).map(p => p.id), [base.id]);
  assert.deepEqual(queryComicProjects(projects, folders, metadata, { folderId: '__none__' }).map(p => p.id), [projects[1].id, projects[2].id]);
  assert.deepEqual(queryComicProjects(projects, folders, metadata, { query: ' 工程 ', sort: 'name' }).map(p => p.title), ['工程 2', '工程 10']);
  assert.equal(queryComicProjects(projects, folders, metadata, { query: 'alpha' })[0].title, 'ALPHA');
  const oldMeta = [{ projectId: base.id, updatedAt: now }], freshlyEdited = [{ ...base, updatedAt: '2026-10-01T12:00:00.000Z' }, projects[1]];
  assert.equal(queryComicProjects(freshlyEdited, folders, oldMeta, { sort: 'recent' })[0].id, base.id);
  assert.equal(projects[0].title, '工程 2');
});

test('full duplication remaps project/canvas identities, references and paths while detaching active jobs', () => {
  const base = project(), imageAsset = asset('asset-image0001'), audioAsset = { ...asset('asset-audio0001', 'audio'), durationMs: 4000 };
  const scene = base.scenes[0], shot = scene.shots[0];
  const source: ComicProject = { ...base, assets: [imageAsset, audioAsset], characters: [{ id: 'character-person001', name: '人物', description: '', appearance: '', voice: '', referenceAssetIds: [imageAsset.id], createdAt: now, updatedAt: now }],
    scenes: [{ ...scene, setPlateAssetId: imageAsset.id, shots: [{ ...shot, continuousTakeId: 'take-original0001', visualAssetId: imageAsset.id, audioAssetId: audioAsset.id, dialogueCues: [{ id: 'dialogue-line0001', speakerCharacterId: 'character-person001', text: imageAsset.id, startFrame: 0, durationFrames: 1 }], mediaSourceStartFrames: { [audioAsset.id]: 0 } }] }] };
  validateComicProject(source);
  const version = mediaVersion('version-original', imageAsset.id);
  const snapshot: GenerationSnapshot = { modelId: imageAsset.id, capabilityVersion: 'test', mode: 'imageToImage', prompt: shot.id, resolvedInputs: [{ role: 'referenceImage', order: 0, sourceNodeId: 'node-image', versionId: version.id, assetId: imageAsset.id, kind: 'image', uri: version.uri }], parameters: {}, inputFingerprint: 'original-fingerprint' };
  const generation: CanvasImageGenNode = { id: 'node-generate', title: '结果', kind: 'imageGen', ...geometry, origin: { sceneId: scene.id, shotId: shot.id }, payload: { modelId: 'model-test', mode: 'imageToImage', prompt: imageAsset.id, parameters: {}, versions: [version], currentVersionId: version.id,
    inputs: [{ id: 'input-reference', role: 'referenceImage', order: 1, version }], job: { id: 'paid-original-job', status: 'running' }, jobs: [{ idempotencyKey: 'original-key', jobId: 'paid-original-job', status: 'running', snapshot, createdAt: now, updatedAt: now }, { idempotencyKey: 'completed-key', jobId: 'paid-completed-job', status: 'succeeded', snapshot, createdAt: now, updatedAt: now }] } };
  const image: CanvasNode = { id: 'node-image', title: imageAsset.id, kind: 'image', ...geometry, payload: { versions: [version], currentVersionId: version.id } };
  const main: CanvasDocument = { ...createCanvasDocument({ id: 'canvas-main', projectId: source.id, now }), nodes: [image, generation], edges: [{ id: 'edge-reference', sourceNodeId: image.id, sourcePort: 'output', targetNodeId: generation.id, targetPort: 'referenceImage', role: 'referenceImage', order: 0, binding: 'pinnedVersion', pinnedVersionId: version.id }], groups: [{ id: 'group-explore', title: '组', nodeIds: [image.id, generation.id] }] };
  const extra: CanvasDocument = { ...createCanvasDocument({ id: 'canvas-extra', projectId: source.id, now }), nodes: [{ ...image, id: 'node-extra-image' }] };
  const before = JSON.stringify([source, main, extra]);
  assert.deepEqual(validateCanvasDocument(main), []);
  let next = 0;
  const result = duplicateComicProjectBundle(source, [main, extra], { projectId: 'project-duplicate001', title: '副本', now: later, idFactory: kind => `${kind}-copy${String(++next).padStart(8, '0')}`, assetUri: uri => uri.replace('nextmux.media/', 'nextmux.media/copied-') });
  assert.equal(result.project.id, 'project-duplicate001');
  assert.equal(result.project.revision, 0);
  assert.equal(result.project.scenes[0].setPlateAssetId, result.idMap[imageAsset.id]);
  assert.equal(result.project.scenes[0].shots[0].visualAssetId, result.idMap[imageAsset.id]);
  assert.equal(result.project.scenes[0].shots[0].continuousTakeId, result.idMap['take-original0001']);
  assert.equal(result.project.scenes[0].shots[0].dialogueCues[0].speakerCharacterId, result.idMap[source.characters[0].id]);
  assert.equal(result.project.scenes[0].shots[0].dialogueCues[0].text, imageAsset.id);
  assert.ok(Object.hasOwn(result.project.scenes[0].shots[0].mediaSourceStartFrames!, result.idMap[audioAsset.id]));
  const copied = result.documents[0], gen = copied.nodes[1] as CanvasImageGenNode;
  assert.equal(gen.origin?.shotId, result.idMap[shot.id]);
  assert.equal(gen.payload.prompt, imageAsset.id);
  assert.equal(gen.payload.job, undefined);
  assert.equal(gen.payload.jobs?.length, 1);
  assert.equal(gen.payload.jobs?.[0].jobId, 'paid-completed-job');
  assert.equal(gen.payload.jobs?.[0].snapshot.modelId, imageAsset.id);
  assert.equal(gen.payload.jobs?.[0].snapshot.resolvedInputs[0].sourceNodeId, result.idMap[image.id]);
  assert.equal(gen.payload.jobs?.[0].snapshot.resolvedInputs[0].uri, `nextmux.media/copied-${imageAsset.id}.png`);
  assert.equal(copied.edges[0].pinnedVersionId, result.idMap[version.id]);
  assert.equal(copied.groups[0].nodeIds[0], result.idMap[image.id]);
  assert.equal(gen.payload.currentVersionId, result.idMap[version.id]);
  assert.equal(gen.payload.versions[0].assetId, result.idMap[imageAsset.id]);
  assert.equal((result.documents[1].nodes[0] as any).payload.currentVersionId, result.idMap[version.id]);
  assert.deepEqual(validateCanvasDocument(copied), []);
  assert.equal(JSON.stringify([source, main, extra]), before);
  assert.equal(new Set(Object.values(result.idMap)).size, Object.keys(result.idMap).length);
});

test('duplicate rejects reused IDs and clears in-progress project states without starting jobs', () => {
  const base = project();
  const source = { ...base, assets: [asset('asset-running0001', 'image', 'generating')], scenes: base.scenes.map(scene => ({ ...scene, shots: scene.shots.map(shot => ({ ...shot, status: 'generating' as const })) })) };
  const result = duplicateComicProject(source, { projectId: 'project-copy000001', title: '副本', now: later });
  assert.equal(result.project.assets[0].status, 'missing');
  assert.equal(result.project.scenes[0].shots[0].status, 'draft');
  assert.throws(() => duplicateComicProject(source, { projectId: source.id, title: '副本', now: later }), { code: 'DUPLICATE_ID' });
  assert.throws(() => duplicateComicProject(source, { projectId: 'project-copy000002', title: '副本', now: later, idFactory: () => source.assets[0].id }), { code: 'DUPLICATE_ID' });
});

test('duplicate retains character provider facts and music content while renewing local profile/MV identities', () => {
  const base = project(), portrait = asset('asset-portrait001'), song = { ...asset('asset-song000001', 'music'), durationMs: 5000 };
  const scope = { providerId: 'provider-test', accountNamespace: 'account-test', apiEndpoint: 'https://example.com/v1', product: 'video', modelFamily: 'family-test', modelVersion: 'model-v1' };
  const plain: ComicProject = { ...base, projectKind: 'music', assets: [portrait, song], characters: [{ id: 'character-profile001', name: '人物', description: '', appearance: '', voice: '', createdAt: now, updatedAt: now }], music: { lyrics: '海风', instrumental: false, genre: '', mood: '', tempo: '', vocals: '', language: '', style: '', length: 'full', format: 'mp3', selectedAssetId: song.id,
    mv: { lyrics: '海风', durationMs: 5000, alignment: 'estimated', songAssetId: song.id, singerPortraitAssetId: portrait.id, lines: [{ id: 'line-original', sectionIndex: 0, sectionTitle: 'Verse', text: '海风', startMs: 0, endMs: 5000 }], segments: [{ id: 'segment-original', sectionIndex: 0, sectionTitle: 'Verse', startMs: 0, endMs: 5000, lineIds: ['line-original'], prompt: '海边', source: 'upload-image', assetId: portrait.id }] } } };
  const ref = { assetId: portrait.id, versionId: 'version-profile-only', view: 'front' as const, qualityStatus: 'approved' as const };
  const source = setProjectCharacterProfile(plain, plain.characters[0].id, { canonicalVersion: 1, immutableTraits: '棕发', sourceIdentityVersion: ref.versionId, referenceViews: [ref], outfits: [{ id: 'outfit-original', version: 1, label: '冬装', description: '', refs: [ref] }], voiceBindings: [], providerBindings: [{ id: 'binding-original', scope, externalElementId: 'external-original', capabilityVersion: 'cap-1', referenceVersion: 1, referenceAssetHashes: [], status: 'unverified' }] }, now);
  const result = duplicateComicProject(source, { projectId: 'project-musiccopy001', title: '音乐副本', now: later });
  const profile = result.project.characters[0].canvasCharacter!;
  assert.equal(profile.referenceViews[0].versionId, result.idMap[ref.versionId]);
  assert.notEqual(profile.referenceViews[0].versionId, ref.versionId);
  assert.equal(profile.sourceIdentityVersion, result.idMap[ref.versionId]);
  assert.equal(result.project.characters[0].identityVersion, result.idMap[ref.versionId]);
  assert.equal(profile.outfits[0].id, result.idMap['outfit-original']);
  assert.equal(profile.providerBindings[0].id, result.idMap['binding-original']);
  assert.equal(profile.providerBindings[0].externalElementId, 'external-original');
  assert.deepEqual(profile.providerBindings[0].scope, scope);
  assert.equal(result.project.music?.lyrics, '海风');
  assert.equal(result.project.music?.selectedAssetId, result.idMap[song.id]);
  assert.equal(result.project.music?.mv?.lines[0].id, result.idMap['line-original']);
  assert.equal(result.project.music?.mv?.segments[0].id, result.idMap['segment-original']);
  assert.deepEqual(result.project.music?.mv?.segments[0].lineIds, [result.idMap['line-original']]);
  assert.equal(result.project.music?.mv?.segments[0].assetId, result.idMap[portrait.id]);
  validateComicProject(result.project);
});

test('duplicate remaps scene object/keyframe links, composition tracks, and every persisted media URI field', () => {
  const base = project(), ownImage = asset('asset-sceneimage01');
  const source = { ...base, assets: [ownImage] };
  const parent = createSceneObject('group', 'scene-parent'), model = createSceneObject('model', 'scene-model', { parentId: parent.id, assetId: ownImage.id, modelUri: 'nextmux.media/scene.glb', imageUri: ownImage.uri });
  const scene = { ...createSceneDocument(), objects: [parent, model], keys: [{ id: 'key-original', objectId: model.id, frame: 10, position: model.position, rotation: model.rotation, scale: model.scale }], panoramaUri: 'nextmux.media/panorama.png' };
  const document: CanvasDocument = { ...createCanvasDocument({ id: 'canvas-director', projectId: source.id, now }), nodes: [
    { id: 'node-director', title: 'Director', kind: 'sceneComposer', ...geometry, payload: { versions: [], scene } },
    { id: 'node-world', title: 'World', kind: 'world', ...geometry, payload: { versions: [], world: normalizeWorld({ kind: 'model', uri: 'nextmux.media/world.glb', format: 'glb' }) } },
    { id: 'node-composition', title: 'Composition', kind: 'composition', ...geometry, payload: { versions: [], parameters: {}, clips: [{ id: 'clip-original', assetVersionId: 'version-film', trackId: 'track-original', startMs: 0, inMs: 0, outMs: 1000, volume: 1, muted: false }] } },
  ] };
  assert.deepEqual(validateCanvasDocument(document), []);
  const copy = duplicateComicProjectBundle(source, [document], { projectId: 'project-directorcopy1', title: '导演副本', now: later, assetUri: uri => uri.replace('nextmux.media/', 'nextmux.media/copied-') });
  const director = copy.documents[0].nodes[0], world = copy.documents[0].nodes[1], composition = copy.documents[0].nodes[2];
  assert.equal(director.kind, 'sceneComposer');
  assert.equal(world.kind, 'world');
  assert.equal(composition.kind, 'composition');
  if (director.kind !== 'sceneComposer' || world.kind !== 'world' || composition.kind !== 'composition') throw new Error('Expected copied authoring nodes');
  assert.equal(director.payload.scene.objects[1].parentId, copy.idMap[parent.id]);
  assert.equal(director.payload.scene.keys[0].objectId, copy.idMap[model.id]);
  assert.equal(director.payload.scene.keys[0].id, copy.idMap['key-original']);
  assert.equal(director.payload.scene.objects[1].assetId, copy.idMap[ownImage.id]);
  assert.equal(director.payload.scene.objects[1].modelUri, 'nextmux.media/copied-scene.glb');
  assert.equal(director.payload.scene.objects[1].imageUri, `nextmux.media/copied-${ownImage.id}.png`);
  assert.equal(director.payload.scene.panoramaUri, 'nextmux.media/copied-panorama.png');
  assert.equal(world.payload.world.uri, 'nextmux.media/copied-world.glb');
  assert.equal(composition.payload.clips[0].id, copy.idMap['clip-original']);
  assert.equal(composition.payload.clips[0].trackId, copy.idMap['track-original']);
  assert.deepEqual(validateCanvasDocument(copy.documents[0]), []);
});

test('duplicate preserves an existing long authored title while applying the new rename limit to new titles', () => {
  const source = { ...project(), title: '长'.repeat(110) };
  const duplicate = duplicateComicProject(source, { projectId: 'project-longcopy001', title: source.title, now: later });
  assert.equal(duplicate.project.title, source.title);
  assert.throws(() => duplicateComicProject(source, { projectId: 'project-longcopy002', title: '新'.repeat(65), now: later }), { code: 'INVALID_NAME' });
});
