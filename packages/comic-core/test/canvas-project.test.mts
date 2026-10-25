import assert from 'node:assert/strict';
import test from 'node:test';
import { applyComicCommand, bindCanvasCharacterPortrait, buildCanvasCompositionProject, commitCanvasCharacterToProject, commitCanvasToProject,
  createComicProject, resolveCanvasInputs, seedCanvasFromProject, validateCanvasDocument, validateComicProject } from '../lib/index.js';
import type { CanvasAssetVersion, CanvasCompositionNode, CanvasDocument, CanvasModelCapability, ComicProject } from '../lib/index.js';
import { prepareCanvasCharacterProjectBinding } from '../lib/canvas-project.js';
import { characterAssetFromProject, prepareCanvasCharacterProjectForSave, setProjectCharacterProfile } from '../lib/canvas-characters.js';

const now = '2026-09-30T00:00:00.000Z';
function fixture(): ComicProject {
  let counter = 0;
  const idFactory = (prefix: 'project' | 'scene' | 'shot' | 'asset' | 'character' | 'dialogue') => `${prefix}-${String(++counter).padStart(8, '0')}`;
  let project = createComicProject({ now, idFactory, starter: 'storyboard' });
  const apply = (command: object) => { project = applyComicCommand(project, { ...command, expectedRevision: project.revision } as never, { now, idFactory }); };
  apply({ type: 'character.add', character: { name: '小雨', aliases: ['Xiaoyu'], appearance: '短发，蓝色外套' } });
  apply({ type: 'character.add', character: { name: '阿明', appearance: '卷发，白色衬衫' } });
  for (const [index, kind] of ['image', 'video', 'video', 'audio'].entries()) {
    const suffix = kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'wav';
    apply({ type: 'asset.import', asset: { id: `asset-test-${String(index).padStart(8, '0')}`, kind, uri: `nextmux.media/${index}.${suffix}`,
      mimeType: `${kind}/${suffix}`, byteLength: 100, sha256: String(index + 1).repeat(64), jobId: 'media-job-11111111-1111-1111-1111-111111111111',
      provider: 'fixture', model: 'fixture', ...(kind !== 'image' ? { durationMs: 4_000 } : {}) } });
  }
  const scene = project.scenes[0];
  for (const [index, shot] of scene.shots.entries()) apply({ type: 'shot.update', sceneId: scene.id, shotId: shot.id,
    patch: { visualPrompt: `小雨与阿明在车站 ${index}`, durationFrames: 96 } });
  return project;
}
const assetVersion = (project: ComicProject, assetIndex: number, id = `version-${assetIndex}`): CanvasAssetVersion => {
  const asset = project.assets[assetIndex];
  return { id, assetId: asset.id, kind: asset.kind as CanvasAssetVersion['kind'], uri: asset.uri, createdAt: now,
    metadata: { ...(asset.durationMs ? { durationMs: asset.durationMs } : {}) } };
};

test('adaptation seed produces stable typed identities, scene groups, storyboard → video and explicit durations', () => {
  const project = fixture();
  const canvas = seedCanvasFromProject(project);
  assert.deepEqual(validateCanvasDocument(canvas), []);
  assert.deepEqual(seedCanvasFromProject(project), canvas);
  assert.equal(canvas.nodes.filter(node => node.kind === 'character').length, 2);
  assert.equal(canvas.nodes.filter(node => node.origin?.role === 'portrait').length, 2);
  assert.equal(canvas.groups.length, project.scenes.length);
  assert.equal(canvas.edges.filter(edge => edge.role === 'firstFrame').length, project.scenes[0].shots.length);
  const video = canvas.nodes.find(node => node.kind === 'videoGen')!;
  assert.equal(video.kind === 'videoGen' && video.payload.parameters.durationSeconds, 4);
  assert.equal(video.kind === 'videoGen' && video.payload.parameters.aspectRatio, project.canvas.aspectRatio);
  assert.equal(canvas.edges.filter(edge => edge.role === 'character').length, 2, 'portrait identity inputs need no circular visual prerequisite');
});

test('seeding respects verified reference budget and keeps excluded identity text with a notice', () => {
  const project = fixture();
  const capability: CanvasModelCapability = { id: 'image', providerId: 'fixture', providerModelId: 'image', displayName: 'Image', version: '1', status: 'available', sources: ['fixture'],
    modes: [{ mode: 'imageToImage', referenceRules: { image: { supported: true, maxCount: 1 } } }] };
  const canvas = seedCanvasFromProject(project, { imageCapability: capability });
  const storyboard = canvas.nodes.find(node => node.origin?.role === 'storyboard')!;
  assert.equal(canvas.edges.filter(edge => edge.targetNodeId === storyboard.id && edge.role === 'referenceImage').length, 1);
  assert.equal(canvas.edges.filter(edge => edge.targetNodeId === storyboard.id && edge.role === 'character').length, 1);
  assert.equal((canvas.settings.seedNotices as string[]).length, project.scenes[0].shots.length);
  assert.deepEqual(validateCanvasDocument(canvas), []);
});

test('seeded clip durations round fractional shots up to the whole seconds accepted by the existing queue', () => {
  const base = fixture();
  for (const [durationFrames, seconds] of [[1, 1], [25, 2], [97, 5]] as const) {
    const project = { ...base, frameRate: 24 as const, scenes: base.scenes.map(scene => ({ ...scene,
      shots: scene.shots.map(shot => ({ ...shot, durationFrames })) })) };
    const node = seedCanvasFromProject(project).nodes.find(node => node.kind === 'videoGen');
    assert.ok(node?.kind === 'videoGen');
    assert.equal(node.payload.parameters.durationSeconds, seconds);
    assert.equal(Number.isInteger(node.payload.parameters.durationSeconds), true);
  }
});

test('a library portrait is reused in its generator and passed as an image reference on every request', () => {
  const project = fixture();
  const reusable = applyComicCommand(project, { type: 'character.update', expectedRevision: project.revision,
    characterId: project.characters[0].id, patch: { referenceAssetIds: [project.assets[0].id] } }, { now });
  const canvas = seedCanvasFromProject(reusable);
  const portrait = canvas.nodes.find(node => node.origin?.role === 'portrait' && node.origin.characterId === reusable.characters[0].id);
  assert.equal(portrait?.kind === 'imageGen' && portrait.payload.mode, 'imageToImage');
  assert.equal(portrait?.kind === 'imageGen' && portrait.payload.versions.length, 1);
  assert.equal(canvas.edges.find(edge => edge.targetNodeId === portrait!.id)?.role, 'referenceImage');
  assert.deepEqual(validateCanvasDocument(canvas), []);
});

test('reseeding merges source edits, retains user params/layout/disconnections and marks deleted shots orphaned', () => {
  const project = fixture();
  const original = seedCanvasFromProject(project);
  const story = original.nodes.find(node => node.origin?.role === 'storyboard')!;
  const edited: CanvasDocument = { ...original, nodes: [...original.nodes.map(node => node.id === story.id && node.kind === 'imageGen'
    ? { ...node, title: '我的镜头', position: { x: 4, y: 7 }, payload: { ...node.payload, prompt: '手写提示词', parameters: { ...node.payload.parameters, aspectRatio: '1:1' } } } : node),
    { id: 'user-note', kind: 'text', title: 'Note', position: { x: 8, y: 9 }, size: { width: 100, height: 100 }, payload: { text: 'Keep' } }],
    edges: original.edges.filter(edge => edge.targetNodeId !== story.id) };
  const scene = project.scenes[0];
  const updated = applyComicCommand(project, { type: 'shot.update', expectedRevision: project.revision, sceneId: scene.id,
    shotId: scene.shots[0].id, patch: { visualPrompt: '改编新词', durationFrames: 120 } }, { now });
  const merged = seedCanvasFromProject(updated, { previous: edited });
  const retained = merged.nodes.find(node => node.id === story.id)!;
  assert.equal(retained.title, '我的镜头');
  assert.equal(retained.kind === 'imageGen' && retained.payload.prompt, '手写提示词');
  assert.deepEqual(retained.position, { x: 4, y: 7 });
  assert.equal(merged.nodes.filter(node => node.id === story.id).length, 1);
  assert.equal(merged.edges.filter(edge => edge.targetNodeId === story.id).length, 0);
  assert.ok(merged.nodes.some(node => node.id === 'user-note'));
  const mergedVideo = merged.nodes.find(node => node.kind === 'videoGen' && node.origin?.shotId === scene.shots[0].id);
  assert.equal(mergedVideo?.kind === 'videoGen' && mergedVideo.payload.parameters.durationSeconds, 5);
  const removed = applyComicCommand(updated, { type: 'shot.delete', expectedRevision: updated.revision, sceneId: scene.id, shotId: scene.shots[0].id }, { now });
  const reseeded = seedCanvasFromProject(removed, { previous: merged });
  assert.equal(reseeded.nodes.find(node => node.id === story.id)?.orphaned, true);
  assert.deepEqual(validateCanvasDocument(reseeded), []);
  assert.throws(() => seedCanvasFromProject({ ...project, id: 'project-another1' }, { previous: edited }), /another/);
});

test('canvas commit emits existing project commands in project shot order and uses only selected versions', () => {
  const project = fixture();
  let canvas = seedCanvasFromProject(project);
  canvas = { ...canvas, nodes: canvas.nodes.map(node => {
    if (node.kind === 'imageGen' && node.origin?.role === 'storyboard') return { ...node, payload: { ...node.payload, versions: [assetVersion(project, 0)], currentVersionId: 'version-0' } };
    if (node.kind === 'videoGen') return { ...node, payload: { ...node.payload, versions: [assetVersion(project, 1), assetVersion(project, 2)], currentVersionId: 'version-2' } };
    return node;
  }).reverse() };
  const commands = commitCanvasToProject(canvas, project);
  assert.deepEqual(commands.map(command => command.expectedRevision), commands.map((_, index) => project.revision + index));
  assert.deepEqual(commands.filter(command => command.type === 'media.link' && command.slot === 'video').map(command => command.type === 'media.link' && command.shotId), project.scenes[0].shots.map(shot => shot.id));
  let current = project;
  for (const command of commands) current = applyComicCommand(current, command, { now });
  assert.ok(current.scenes[0].shots.every(shot => shot.videoAssetId === project.assets[2].id && shot.visualAssetId === project.assets[0].id));
  assert.deepEqual(commitCanvasToProject(canvas, current), []);
  assert.equal(project.scenes[0].shots[0].videoAssetId, undefined);
});

test('reseeding reconciles shot scene moves and new identities, while preserving authored scripts and grouping', () => {
  const project = fixture();
  const scripted = { ...project, episodes: [{ number: 1, title: 'Episode', script: 'Original script' }] };
  const original = seedCanvasFromProject({ ...scripted, characters: [] });
  const script = original.nodes.find(node => node.kind === 'text')!;
  const edited = { ...original, nodes: original.nodes.map(node => node.id === script.id && node.kind === 'text' ? { ...node, payload: { text: 'Authored script' } } : node) };
  let moved = applyComicCommand(scripted, { type: 'scene.add', expectedRevision: scripted.revision, scene: { title: 'Second scene' } }, { now });
  moved = applyComicCommand(moved, { type: 'shot.move', expectedRevision: moved.revision, sceneId: moved.scenes[0].id,
    shotId: moved.scenes[0].shots[0].id, targetSceneId: moved.scenes[1].id }, { now });
  const merged = seedCanvasFromProject(moved, { previous: edited });
  assert.deepEqual(validateCanvasDocument(merged), []);
  const storyboard = merged.nodes.find(node => node.origin?.role === 'storyboard')!;
  assert.equal(storyboard.kind === 'imageGen' && storyboard.payload.mode, 'imageToImage');
  assert.equal(merged.edges.filter(edge => edge.targetNodeId === storyboard.id && edge.role === 'referenceImage').length, 2);
  assert.equal(merged.groups.filter(group => group.nodeIds.includes(storyboard.id)).length, 1);
  assert.equal(storyboard.origin?.sceneId, moved.scenes[1].id);
  const text = merged.nodes.find(node => node.id === script.id);
  assert.equal(text?.kind === 'text' && text.payload.text, 'Authored script');
});

test('video snapshot first frame remains the editor fallback after the storyboard output changes', () => {
  const project = fixture();
  const original = seedCanvasFromProject(project);
  const canvas: CanvasDocument = { ...original, nodes: original.nodes.map(node => {
    if (node.kind === 'videoGen') return { ...node, payload: { ...node.payload, versions: [{ ...assetVersion(project, 1), snapshot: {
      mode: 'imageToVideo', modelId: 'fixture', capabilityVersion: '1', prompt: 'Frozen', inputFingerprint: 'f'.repeat(64), parameters: {},
      resolvedInputs: [{ role: 'firstFrame', order: 0, kind: 'image', versionId: 'older-frame', assetId: project.assets[0].id, uri: project.assets[0].uri }],
    } }], currentVersionId: 'version-1' } };
    return node;
  }) };
  const commands = commitCanvasToProject(canvas, project);
  assert.equal(commands[0].type === 'media.link' && commands[0].assetId, project.assets[0].id);
  assert.equal(commands[0].type === 'media.link' && commands[0].slot, 'visual');
});

test('character portrait approval updates project references and the reusable character output', () => {
  const project = fixture();
  let canvas = seedCanvasFromProject(project);
  const portrait = canvas.nodes.find(node => node.origin?.role === 'portrait')!;
  const character = canvas.nodes.find(node => node.kind === 'character' && node.payload.characterId === portrait.origin?.characterId)!;
  canvas = { ...canvas, nodes: canvas.nodes.map(node => node.id === portrait.id && node.kind === 'imageGen'
    ? { ...node, payload: { ...node.payload, versions: [assetVersion(project, 0)], currentVersionId: 'version-0' } } : node) };
  const commands = commitCanvasCharacterToProject(canvas, project, character.id, portrait.id);
  const updated = applyComicCommand(project, commands[0], { now });
  assert.deepEqual(prepareCanvasCharacterProjectBinding(canvas, project, character.id, portrait.id, now), updated);
  assert.deepEqual(updated.characters[0].referenceAssetIds, [project.assets[0].id]);
  const bound = bindCanvasCharacterPortrait(canvas, character.id, portrait.id);
  const boundCharacter = bound.nodes.find(node => node.id === character.id);
  assert.equal(boundCharacter?.kind === 'character' && boundCharacter.payload.currentVersionId, 'version-0');
  assert.equal(bound.revision, canvas.revision + 1);
  assert.throws(() => commitCanvasCharacterToProject(canvas, project, canvas.nodes.filter(node => node.kind === 'character')[1].id, portrait.id), /another character/);
});

test('portrait approval advances an existing identity profile and retains its previous canonical version', () => {
  const initial = fixture(), characterId = initial.characters[0].id;
  const base = { ...initial, assets: [...initial.assets, { ...initial.assets[0], id: 'asset-test-11111111', uri: 'nextmux.media/side.png' }] };
  const project = setProjectCharacterProfile(base, characterId, { canonicalVersion: 1, immutableTraits: base.characters[0].appearance,
    referenceViews: [{ assetId: base.assets[0].id, versionId: `version-${base.assets[0].id}`, view: 'front', qualityStatus: 'approved', sha256: base.assets[0].sha256 },
      { assetId: base.assets[4].id, versionId: `version-${base.assets[4].id}`, view: 'side', qualityStatus: 'approved', sha256: base.assets[4].sha256 }],
    outfits: [{ id: 'coat', version: 1, label: '外套', description: '蓝色外套', refs: [] }], providerBindings: [{ id: 'element',
      scope: { providerId: 'fixture', accountNamespace: 'account', apiEndpoint: 'https://api.example/v1', product: 'video', modelFamily: 'fixture', modelVersion: '1' },
      externalElementId: 'approved-element', capabilityVersion: '1', referenceVersion: 1, referenceAssetHashes: [base.assets[0].sha256!],
      status: 'active', validatedAt: now, validationMethod: 'query' }], voiceBindings: [] });
  const originalProfile = project.characters[0].canvasCharacter!;
  let canvas = seedCanvasFromProject(project);
  const portrait = canvas.nodes.find(node => node.origin?.role === 'portrait' && node.origin.characterId === characterId)!;
  const character = canvas.nodes.find(node => node.kind === 'character' && node.payload.characterId === characterId)!;
  const version = { ...assetVersion(project, 0, 'approved-portrait'), metadata: { sha256: project.assets[0].sha256 } };
  canvas = { ...canvas, nodes: canvas.nodes.map(node => node.id === portrait.id && node.kind === 'imageGen'
    ? { ...node, payload: { ...node.payload, versions: [version], currentVersionId: version.id } } : node) };
  const updated = prepareCanvasCharacterProjectBinding(canvas, project, character.id, portrait.id, now);
  const identity = characterAssetFromProject(updated, characterId);
  assert.equal(identity.canonicalVersion, 2);
  assert.equal(identity.sourceIdentityVersion, version.id);
  assert.equal(identity.referenceViews[0].versionId, version.id);
  assert.equal(identity.referenceViews[0].view, 'unspecified', 'a portrait view is never inferred from a title');
  assert.deepEqual(identity.referenceViews[1], originalProfile.referenceViews[1]);
  assert.deepEqual(identity.outfits, originalProfile.outfits);
  assert.equal(identity.providerBindings[0].status, 'stale');
  assert.deepEqual(identity.history![0], { canonicalVersion: originalProfile.canonicalVersion, immutableTraits: originalProfile.immutableTraits,
    referenceViews: originalProfile.referenceViews });
  assert.equal(prepareCanvasCharacterProjectForSave(updated).characters[0].identityVersion, version.id);
  assert.deepEqual(commitCanvasCharacterToProject(canvas, updated, character.id, portrait.id), []);
  assert.equal(prepareCanvasCharacterProjectBinding(canvas, updated, character.id, portrait.id, now), updated);
  assert.equal(project.characters[0].canvasCharacter!.canonicalVersion, 1);
});

test('composition translates trims and audio offsets into the existing exporter without changing the editor', () => {
  const project = fixture();
  const base = seedCanvasFromProject(project);
  const composition: CanvasCompositionNode = { id: 'composition', kind: 'composition', title: 'Joined', position: { x: 0, y: 0 }, size: { width: 280, height: 280 },
    payload: { versions: [], parameters: {}, clips: [
      { id: 'a', assetVersionId: 'v1', trackId: 'video', startMs: 0, inMs: 1_000, outMs: 3_000, volume: 1, muted: false },
      { id: 'b', assetVersionId: 'v2', trackId: 'video', startMs: 2_000, inMs: 0, outMs: 2_000, volume: 1, muted: false },
      { id: 'sound', assetVersionId: 'audio', trackId: 'audio', startMs: 1_000, inMs: 500, outMs: 2_500, volume: 1, muted: false },
    ] } };
  const canvas: CanvasDocument = { ...base, nodes: [...base.nodes, composition,
    { id: 'sources', kind: 'video', title: 'sources', position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, payload: { versions: [assetVersion(project, 1, 'v1'), assetVersion(project, 2, 'v2')] } },
    { id: 'audio-source', kind: 'audio', title: 'sound', position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, payload: { versions: [assetVersion(project, 3, 'audio')] } }] };
  const output = buildCanvasCompositionProject(canvas, composition.id, project);
  assert.equal(output.scenes[0].shots.reduce((sum, shot) => sum + shot.durationFrames, 0), 96);
  assert.deepEqual(output.scenes[0].shots.map(shot => shot.durationFrames), [24, 24, 24, 24]);
  const audioId = output.scenes[0].shots[1].effectAssetIds![0];
  assert.equal(output.scenes[0].shots[1].mediaSourceStartFrames?.[audioId], 12);
  assert.equal(output.scenes[0].shots[2].mediaSourceStartFrames?.[audioId], 36);
  assert.equal(output.scenes[0].shots[0].mediaSourceStartFrames?.[project.assets[1].id], 24);
  validateComicProject(output);
  assert.deepEqual(project, fixture(), 'export-only clone preserves real project');
  const invalid = { ...canvas, nodes: canvas.nodes.map(node => node.id === composition.id && node.kind === 'composition'
    ? { ...node, payload: { ...node.payload, clips: node.payload.clips.map(clip => clip.id === 'sound' ? { ...clip, volume: 0.5 } : clip) } } : node) };
  assert.throws(() => buildCanvasCompositionProject(invalid, composition.id, project), /unequal gains/);
});

test('composition rejects conflicting media sharing a version ID instead of choosing by node order', () => {
  const project = fixture(), base = seedCanvasFromProject(project);
  const composition: CanvasCompositionNode = { id: 'composition', kind: 'composition', title: 'Joined', position: { x: 0, y: 0 }, size: { width: 280, height: 280 },
    payload: { versions: [], parameters: {}, clips: [
      { id: 'clip', assetVersionId: 'shared-version', trackId: 'video', startMs: 0, inMs: 0, outMs: 2_000, volume: 1, muted: false },
    ] } };
  const source = (id: string, index: number) => ({ id, kind: 'video' as const, title: id, position: { x: 0, y: 0 }, size: { width: 100, height: 100 },
    payload: { versions: [assetVersion(project, index, 'shared-version')], currentVersionId: 'shared-version' } });
  const first = source('first', 1), second = source('second', 2);
  const conflicting: CanvasDocument = { ...base, nodes: [...base.nodes, composition, first, second] };
  assert.deepEqual(validateCanvasDocument(conflicting), [], 'version IDs are unique within each source node');
  assert.throws(() => buildCanvasCompositionProject(conflicting, composition.id, project), /conflicting media/);
  assert.throws(() => buildCanvasCompositionProject({ ...conflicting, nodes: [...conflicting.nodes].reverse() }, composition.id, project), /conflicting media/);
  const repeated = { ...base, nodes: [...base.nodes, composition, first, { ...first, id: 'same-output-copy' }] };
  assert.equal(buildCanvasCompositionProject(repeated, composition.id, project).scenes[0].shots[0].videoAssetId, project.assets[1].id);
  const directConflict = { ...base, nodes: [...base.nodes, first, { ...composition, payload: { ...composition.payload,
    inputs: [{ id: 'direct-copy', role: 'compositionVideo' as const, order: 0, version: second.payload.versions[0] }],
  } }] };
  assert.throws(() => buildCanvasCompositionProject(directConflict, composition.id, project), /conflicting media/);
});

test('shot seed exposes place, time and visible looks while excluding off-screen speakers and personality notes', () => {
  const base = fixture();
  const project: ComicProject = { ...base, styleBible: '手绘水彩', characters: base.characters.map((character, index) => index === 0
    ? { ...character, description: '任性但热情的主角', appearance: '外观：黑色短发\n服装：蓝色外套\n性格：固执\nPersonality: curious' } : character),
    scenes: base.scenes.map(scene => ({ ...scene, location: '旧火车站', timeOfDay: '黄昏', shots: scene.shots.map(shot => ({ ...shot,
      visualPrompt: 'Xiaoyu 在站台抬头，风吹起外套', description: '阿明在画外说话',
      dialogueCues: [{ id: 'dialogue-11111111', speakerCharacterId: base.characters[1].id, text: '等等我', startFrame: 0, durationFrames: 24 }] })) })) };
  const canvas = seedCanvasFromProject(project);
  const expected = 'Xiaoyu 在站台抬头，风吹起外套\n旧火车站 · 黄昏\n小雨: 外观：黑色短发 服装：蓝色外套\n手绘水彩';
  for (const node of canvas.nodes.filter(node => node.origin?.shotId)) {
    assert.ok(node.kind === 'imageGen' || node.kind === 'videoGen');
    assert.equal(node.payload.prompt, expected);
    assert.doesNotMatch(node.payload.prompt, /阿明|固执|curious|任性/);
  }
  for (const node of canvas.nodes.filter(node => node.origin?.role === 'storyboard')) {
    assert.equal(canvas.edges.filter(edge => edge.targetNodeId === node.id && edge.role === 'referenceImage').length, 1);
  }
  const noReferences: CanvasModelCapability = { id: 'image', providerId: 'fixture', providerModelId: 'image', displayName: 'Image',
    version: '1', status: 'available', sources: ['fixture'], modes: [{ mode: 'textToImage' }] };
  const textCanvas = seedCanvasFromProject(project, { imageCapability: noReferences });
  const storyboard = textCanvas.nodes.find(node => node.origin?.role === 'storyboard')!;
  assert.equal(storyboard.kind === 'imageGen' && storyboard.payload.mode, 'textToImage');
  assert.equal(textCanvas.edges.find(edge => edge.targetNodeId === storyboard.id)?.role, 'character');
  const resolved = resolveCanvasInputs(textCanvas, storyboard.id);
  assert.deepEqual(resolved.missing, []);
  assert.match(resolved.prompt, /蓝色外套/);
  assert.doesNotMatch(resolved.prompt, /阿明|固执|curious|任性/, 'fallback identity edges must not reintroduce personality or off-screen people');
  assert.equal(project.characters[0].description, '任性但热情的主角', 'visual canvas identities never rewrite library story notes');
  assert.match(project.characters[0].appearance, /性格：固执/);
  assert.deepEqual(validateCanvasDocument(canvas), []);
});

test('visual-only seeded identity refreshes untouched looks and retains explicitly authored canvas identity text', () => {
  const project = fixture(), original = seedCanvasFromProject(project);
  const characterId = project.characters[0].id;
  const edited: CanvasDocument = { ...original, nodes: original.nodes.map(node => node.kind === 'character' && node.payload.characterId === characterId
    ? { ...node, payload: { ...node.payload, description: '用户明确填写的人物提示', appearance: '短发，绿色大衣' } } : node) };
  const updated = { ...project, characters: project.characters.map(character => ({ ...character, description: '新剧情人物说明',
    appearance: '外观：长发\n服装：白色外套\n性格：沉默' })) };
  const merged = seedCanvasFromProject(updated, { previous: edited });
  const authored = merged.nodes.find(node => node.kind === 'character' && node.payload.characterId === characterId)!;
  assert.ok(authored.kind === 'character');
  assert.equal(authored.payload.description, '用户明确填写的人物提示');
  assert.equal(authored.payload.appearance, '短发，绿色大衣');
  const refreshed = merged.nodes.find(node => node.kind === 'character' && node.payload.characterId !== characterId)!;
  assert.ok(refreshed.kind === 'character');
  assert.equal(refreshed.payload.description, undefined);
  assert.equal(refreshed.payload.appearance, '外观：长发 服装：白色外套');
});

test('reseed appends later desk pictures and videos without replacing a canvas take or removing versions', () => {
  const starter = fixture();
  const base = applyComicCommand(starter, { type: 'shot.add', expectedRevision: starter.revision, sceneId: starter.scenes[0].id,
    shot: { title: '第二镜头', visualPrompt: '小雨在站台', durationFrames: 96 } }, { now });
  const firstShot = base.scenes[0].shots[0], secondShot = base.scenes[0].shots[1];
  const original = seedCanvasFromProject(base);
  const canvas: CanvasDocument = { ...original, nodes: original.nodes.map(node => {
    if (node.origin?.shotId !== firstShot.id) return node;
    if (node.kind === 'imageGen') return { ...node, payload: { ...node.payload,
      versions: [assetVersion(base, 0, 'canvas-picture-take')], currentVersionId: 'canvas-picture-take', prompt: '用户镜头提示词' } };
    if (node.kind === 'videoGen') return { ...node, payload: { ...node.payload,
      versions: [assetVersion(base, 1, 'canvas-video-take')], currentVersionId: 'canvas-video-take' } };
    return node;
  }) };
  let project = applyComicCommand(base, { type: 'asset.import', expectedRevision: base.revision,
    asset: { id: 'asset-test-00000004', kind: 'image', uri: 'nextmux.media/new-picture.png', mimeType: 'image/png', byteLength: 100, sha256: '5'.repeat(64),
      jobId: 'media-job-11111111-1111-1111-1111-111111111111', provider: 'fixture', model: 'fixture' } }, { now });
  for (const [shotId, slot, assetId] of [
    [firstShot.id, 'visual', 'asset-test-00000004'], [firstShot.id, 'video', base.assets[2].id],
    [secondShot.id, 'visual', base.assets[0].id], [secondShot.id, 'video', base.assets[1].id],
  ] as const) project = applyComicCommand(project, { type: 'media.link', expectedRevision: project.revision,
    sceneId: base.scenes[0].id, shotId, slot, assetId }, { now });
  const merged = seedCanvasFromProject(project, { previous: canvas });
  for (const node of merged.nodes.filter(node => node.origin?.shotId === firstShot.id)) {
    assert.ok(node.kind === 'imageGen' || node.kind === 'videoGen');
    assert.equal(node.payload.versions.length, 2);
    assert.equal(node.payload.currentVersionId, node.kind === 'imageGen' ? 'canvas-picture-take' : 'canvas-video-take');
    assert.deepEqual(node.payload.versions[0], node.kind === 'imageGen' ? assetVersion(base, 0, 'canvas-picture-take') : assetVersion(base, 1, 'canvas-video-take'));
    if (node.kind === 'imageGen') assert.equal(node.payload.prompt, '用户镜头提示词');
  }
  for (const node of merged.nodes.filter(node => node.origin?.shotId === secondShot.id)) {
    assert.ok(node.kind === 'imageGen' || node.kind === 'videoGen');
    assert.equal(node.payload.versions.length, 1);
    assert.equal(node.payload.currentVersionId, node.payload.versions[0].id);
  }
  const repeated = seedCanvasFromProject(project, { previous: merged });
  assert.deepEqual(repeated.nodes, merged.nodes, 'polling or repeated adaptation never duplicates desk results');
  assert.deepEqual(validateCanvasDocument(merged), []);
});

test('reseed deduplicates a project asset under a canvas version ID and keeps a pending desk video as another take', () => {
  const base = fixture(), scene = base.scenes[0], shot = scene.shots[0];
  const project: ComicProject = { ...base, scenes: [{ ...scene, shots: scene.shots.map(candidate => candidate.id === shot.id
    ? { ...candidate, visualAssetId: base.assets[0].id, videoAssetId: base.assets[1].id, pendingVideoAssetId: base.assets[2].id } : candidate) }] };
  const original = seedCanvasFromProject(base);
  const edited: CanvasDocument = { ...original, nodes: original.nodes.map(node => node.kind === 'imageGen' && node.origin?.shotId === shot.id
    ? { ...node, payload: { ...node.payload, versions: [assetVersion(base, 0, 'canvas-same-picture')], currentVersionId: undefined } } : node) };
  const merged = seedCanvasFromProject(project, { previous: edited });
  const image = merged.nodes.find(node => node.kind === 'imageGen' && node.origin?.shotId === shot.id)!;
  assert.ok(image.kind === 'imageGen');
  assert.equal(image.payload.versions.length, 1);
  assert.equal(image.payload.currentVersionId, 'canvas-same-picture');
  const video = merged.nodes.find(node => node.kind === 'videoGen' && node.origin?.shotId === shot.id)!;
  assert.ok(video.kind === 'videoGen');
  assert.deepEqual(video.payload.versions.map(version => version.assetId), [base.assets[1].id, base.assets[2].id]);
  assert.equal(video.payload.currentVersionId, `version-${base.assets[1].id}`);
  assert.deepEqual(validateCanvasDocument(merged), []);
});

test('seeded cards stay horizontal independently of project aspect ratio and rows clear cards and titles', () => {
  const base = fixture();
  const firstScene = { ...base.scenes[0], shots: Array.from({ length: 3 }, (_, index) => ({ ...base.scenes[0].shots[0], id: `shot-8888888${index}` })) };
  const overlap = (left: { x: number; y: number; width: number; height: number }, right: typeof left) =>
    left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
  for (const aspectRatio of ['16:9', '9:16', '1:1', '4:3'] as const) {
    const project = { ...base, canvas: { ...base.canvas, aspectRatio }, episodes: [{ number: 1, title: '剧本', script: '剧本文本' }],
      scenes: [firstScene, { ...base.scenes[0], id: 'scene-77777777', shots: [] },
        { ...firstScene, id: 'scene-99999999', shots: firstScene.shots.map((shot, index) => ({ ...shot, id: `shot-9999999${index}` })) }] };
    const canvas = seedCanvasFromProject(project);

    const cards = canvas.nodes.filter(node => node.kind !== 'group');
    for (const node of cards.filter(node => node.kind !== 'text')) assert.deepEqual(node.size, { width: 360, height: 260 });
    for (const node of cards.filter(node => node.kind === 'videoGen')) assert.equal(node.payload.parameters.aspectRatio, aspectRatio);
    for (const [index, node] of cards.entries()) for (const other of cards.slice(index + 1)) {
      assert.equal(overlap({ ...node.position, width: node.size.width, height: node.size.height + 24, y: node.position.y - 24 },
        { ...other.position, width: other.size.width, height: other.size.height + 24, y: other.position.y - 24 }), false, `${aspectRatio}: ${node.id} overlaps ${other.id}`);
    }
    for (const group of canvas.nodes.filter(node => node.kind === 'group')) for (const card of cards) {
      assert.equal(overlap({ ...group.position, width: group.size.width, height: 24, y: group.position.y - 24 },
        { ...card.position, width: card.size.width, height: card.size.height + 24, y: card.position.y - 24 }), false, `${aspectRatio}: scene title overlaps ${card.id}`);
    }
    assert.deepEqual(validateCanvasDocument(canvas), []);
  }
});

test('seeded plain titles migrate historical English suffixes and retain authored titles across source renames', () => {
  const project = fixture(), original = seedCanvasFromProject(project);
  const suffixes: Record<string, string> = { portrait: 'Portrait', storyboard: 'Storyboard', shotVideo: 'Video' };
  for (const node of original.nodes.filter(node => suffixes[node.origin?.role ?? ''])) {
    const title = node.origin?.characterId ? project.characters.find(character => character.id === node.origin?.characterId)?.name
      : project.scenes.flatMap(scene => scene.shots).find(shot => shot.id === node.origin?.shotId)?.title;
    assert.equal(node.title, title);
  }
  const legacyNodes = original.nodes.map(node => suffixes[node.origin?.role ?? '']
    ? { ...node, title: `${node.title} · ${suffixes[node.origin!.role!]}` } : node);
  const legacyBaselines = Object.fromEntries(Object.entries(original.settings.seedBaselines as Record<string, Record<string, unknown>>)
    .map(([id, baseline]) => [id, { ...baseline, title: legacyNodes.find(node => node.id === id)!.title }]));
  const authoredId = legacyNodes.find(node => node.origin?.role === 'shotVideo')!.id;
  const legacy: CanvasDocument = { ...original, settings: { ...original.settings, seedBaselines: legacyBaselines },
    nodes: legacyNodes.map(node => node.id === authoredId ? { ...node, title: '用户的片段 · Video' } : node) };
  const renamed = { ...project, characters: project.characters.map(character => ({ ...character, name: `${character.name}改名` })),
    scenes: project.scenes.map(scene => ({ ...scene, shots: scene.shots.map(shot => ({ ...shot, title: `${shot.title}改名` })) })) };
  const merged = seedCanvasFromProject(renamed, { previous: legacy });
  const fresh = seedCanvasFromProject(renamed);
  for (const node of merged.nodes) assert.equal(node.title, node.id === authoredId ? '用户的片段 · Video' : fresh.nodes.find(candidate => candidate.id === node.id)!.title);
  const userSuffixed = { ...original, nodes: original.nodes.map(node => node.id === authoredId ? { ...node, title: `${node.title} · Video` } : node) };
  assert.equal(seedCanvasFromProject(renamed, { previous: userSuffixed }).nodes.find(node => node.id === authoredId)!.title,
    `${original.nodes.find(node => node.id === authoredId)!.title} · Video`, 'a role suffix authored after plain-title seeding is still a user edit');
});
