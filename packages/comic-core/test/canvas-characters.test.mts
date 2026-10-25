import assert from 'node:assert/strict';
import test from 'node:test';
import { createComicProject } from '../lib/core.js';
import { parseComicProject, validateComicProject } from '../lib/codec.js';
import { canvasVersionFromComicAsset } from '../lib/canvas-project.js';
import {
  characterAssetFromProject, compileShotCharacterInputs, listProjectCharacterAssets, normalizeCanvasCharacterProject,
  normalizeCanvasCharacterProfile, parseCanvasCharacterProject, prepareCanvasCharacterProjectForSave,
  restoreCanvasCharacterProfiles, selectVerifiedCharacterBinding, serializeCanvasCharacterProject, setProjectCharacterProfile,
  type CanvasCharacterCapability, type CanvasCharacterProfile, type CanvasCharacterProject, type CanvasCharacterShot,
  type CharacterAssetVersionRef, type CharacterProviderScope, type ProviderCharacterBinding,
} from '../lib/canvas-characters.js';
import type { CanvasDocument, CanvasGenerationMode, CanvasNode } from '../lib/canvas.js';
import type { ComicAsset, ComicProject } from '../lib/types.js';

const now = '2026-09-30T00:00:00.000Z';
const scope: CharacterProviderScope = { providerId: 'provider-a', accountNamespace: 'account-a', apiEndpoint: 'https://api.example/v1',
  product: 'video', modelFamily: 'fixture-family', modelVersion: 'model-v1', region: 'west' };
const char1 = 'character-11111111-1111-1111-1111-111111111111';
const char2 = 'character-22222222-2222-2222-2222-222222222222';
function media(index: number, changes: Partial<ComicAsset> = {}): ComicAsset {
  return { id: `asset-${String(index).padStart(8, '0')}`, kind: 'image', source: 'imported', status: 'ready', uri: `nextmux.media/portrait-${index}.png`,
    mimeType: 'image/png', width: 512, height: 512, byteLength: 1000, sha256: index.toString(16).repeat(64).slice(0, 64), createdAt: now, updatedAt: now, ...changes };
}
function ref(asset: ComicAsset, view: CharacterAssetVersionRef['view'] = 'front'): CharacterAssetVersionRef {
  return { assetId: asset.id, versionId: `version-${asset.id}`, view, qualityStatus: 'approved', sha256: asset.sha256, subjectCount: 1 };
}
function profile(assets: readonly ComicAsset[], changes: Partial<CanvasCharacterProfile> = {}): CanvasCharacterProfile {
  return { canonicalVersion: 1, immutableTraits: '深棕短发，左眼下小痣', referenceViews: assets.map((asset, index) => ref(asset, ['front', 'side', 'fullBody'][index] as CharacterAssetVersionRef['view'] ?? 'front')),
    outfits: [], voiceBindings: [], providerBindings: [], ...changes };
}
function fixture(): { project: CanvasCharacterProject; canvas: CanvasDocument; shot: CanvasCharacterShot; capability: CanvasCharacterCapability } {
  let project: ComicProject = createComicProject({ now, starter: 'storyboard' });
  const assets = [media(1), media(2), media(3), media(4), media(5), media(6)];
  project = { ...project, assets, characters: [
    { id: char1, name: '林澈', aliases: ['小澈'], description: '主角', appearance: '', voice: '清亮低声', createdAt: now, updatedAt: now },
    { id: char2, name: '阿青', description: '', appearance: '', voice: '', createdAt: now, updatedAt: now },
  ] };
  project = setProjectCharacterProfile(project, char1, profile(assets.slice(0, 3)));
  const enriched = setProjectCharacterProfile(project, char2, profile([assets[3]]));
  const shot = { id: project.scenes[0].shots[0].id, nodeId: 'generation-node', shotSize: 'close_up' as const,
    episodeNumber: 2, characterSelections: [{ characterId: char1, lead: true }] };
  const node: CanvasNode = { id: 'generation-node', kind: 'imageGen', title: '本镜', position: { x: 0, y: 0 }, size: { width: 200, height: 200 }, origin: { shotId: shot.id },
    payload: { modelId: 'model-a', mode: 'imageToImage', prompt: '林澈站在窗边。', parameters: { resolution: '512', aspectRatio: '1:1' }, versions: [] } };
  const canvas: CanvasDocument = { schemaVersion: 1, id: 'canvas-fixture', projectId: project.id, title: '人物编译', viewport: { x: 0, y: 0, zoom: 1 },
    settings: {}, nodes: [node], edges: [], groups: [], revision: 0, createdAt: now, updatedAt: now };
  const capability: CanvasCharacterCapability = { id: 'model-a', providerId: 'provider-a', providerModelId: 'fixture-model', displayName: 'Fixture', version: 'cap-v1', status: 'available', sources: ['verified fixture'], now,
    requestScope: scope, identity: { referenceImages: true, subjectPolicy: 'multipleSubjects', allImagesTotal: 4 }, modes: [{ mode: 'imageToImage',
      outputVariants: [{ id: '512', resolution: '512', aspectRatios: ['1:1'] }], referenceRules: { image: { supported: true, maxCount: 4, formats: ['png'], maxBytes: 2000, minWidth: 128, minHeight: 128 } },
      combinationConstraints: [{ combination: 'image', maxImages: 4 }] }] };
  return { project: enriched, canvas, shot, capability };
}
function changeMode(canvas: CanvasDocument, mode: CanvasGenerationMode): CanvasDocument {
  return { ...canvas, nodes: canvas.nodes.map(node => node.id !== 'generation-node' || node.kind !== 'imageGen' && node.kind !== 'videoGen' ? node : {
    ...node, kind: 'videoGen', payload: { ...node.payload, mode, parameters: { ...node.payload.parameters, durationSeconds: 4, generateAudio: false } },
  } as CanvasNode) };
}
function videoCapability(capability: CanvasCharacterCapability, mode: CanvasGenerationMode): CanvasCharacterCapability {
  return { ...capability, modes: [{ ...capability.modes[0], mode, duration: { kind: 'fixed', seconds: 4 }, audioGeneration: { mode: 'unsupported', defaultEnabled: false }, firstFrame: mode === 'imageToVideo' || mode === 'referenceToVideo', lastFrame: mode === 'referenceToVideo' }] };
}
function binding(changes: Partial<ProviderCharacterBinding> = {}): ProviderCharacterBinding {
  return { id: 'binding-a', scope, externalElementId: 'element-only-provider-a', capabilityVersion: 'cap-v1', referenceVersion: 1,
    referenceAssetHashes: [media(1).sha256!, media(2).sha256!, media(3).sha256!], status: 'active', validatedAt: now, validationMethod: 'query', expiresAt: null, ...changes };
}

test('project mapping reuses stable IDs, derives labels and does not guess legacy views', () => {
  const { project } = fixture();
  const asset = characterAssetFromProject(project, char1);
  assert.equal(asset.characterId, char1);
  assert.equal(asset.name, '林澈');
  assert.equal(asset.canonicalVersion, 1);
  assert.equal(listProjectCharacterAssets(project).length, 2);
  const legacy = { ...project, characters: project.characters.map(character => { const { canvasCharacter: _ignored, ...base } = character; return base; }) };
  assert.equal(characterAssetFromProject(legacy, char1).referenceViews[0].view, 'unspecified');
  assert.ok(Object.isFrozen(asset.referenceViews));
});

test('codec normalization and serialization round trip preserves validated profiles on existing characters', () => {
  const { project } = fixture();
  const standard = parseComicProject(JSON.stringify(project)).project;
  assert.deepEqual(standard.characters[0].canvasCharacter, project.characters[0].canvasCharacter);
  const restored = restoreCanvasCharacterProfiles(standard, project);
  assert.deepEqual(restored.characters[0].canvasCharacter, project.characters[0].canvasCharacter);
  assert.deepEqual(normalizeCanvasCharacterProject(project), restored);
  assert.deepEqual(prepareCanvasCharacterProjectForSave(project), restored);
  const roundTrip = parseCanvasCharacterProject(serializeCanvasCharacterProject(project));
  assert.deepEqual(roundTrip, restored);
  assert.equal(validateComicProject(roundTrip).characters[0].id, char1);
  assert.throws(() => restoreCanvasCharacterProfiles(standard, { ...project, id: 'project-other' }), /another project/);
  assert.throws(() => prepareCanvasCharacterProjectForSave({ ...project, characters: project.characters.map(character => ({ ...character, appearance: '偷偷改脸' })) }), /appearance changed/);
});

test('identity edits increment versions, retain old views and prohibit same-version/history/outfit mutation', () => {
  const { project } = fixture();
  const prior = project.characters[0].canvasCharacter!;
  assert.throws(() => setProjectCharacterProfile(project, char1, { ...prior, immutableTraits: '新发型' }), /new canonicalVersion/);
  const next = setProjectCharacterProfile(project, char1, { ...prior, canonicalVersion: 2, immutableTraits: '新发型' });
  assert.equal(next.characters[0].canvasCharacter!.history![0].immutableTraits, prior.immutableTraits);
  assert.throws(() => setProjectCharacterProfile(next, char1, { ...next.characters[0].canvasCharacter!, history: [{ ...prior, immutableTraits: '篡改旧脸' }] }), /immutable/);
  const outfit = { id: 'uniform', version: 1, label: '校服', description: '灰色校服', refs: [] };
  const clothed = setProjectCharacterProfile(project, char1, { ...prior, outfits: [outfit] });
  assert.throws(() => setProjectCharacterProfile(clothed, char1, { ...clothed.characters[0].canvasCharacter!, outfits: [{ ...outfit, description: '红色校服' }] }), /new outfit version/);
  assert.equal(setProjectCharacterProfile(clothed, char1, { ...clothed.characters[0].canvasCharacter!, outfits: [] }).characters[0].canvasCharacter!.outfits.length, 1);
});

test('profile decoder rejects malformed refs/scopes and drops unknown fields including credentials', () => {
  const input = { ...profile([media(1)]), apiKey: 'must-not-persist' };
  assert.equal('apiKey' in normalizeCanvasCharacterProfile(input), false);
  assert.throws(() => normalizeCanvasCharacterProfile({ ...input, canonicalVersion: 0 }), /positive integer/);
  assert.throws(() => normalizeCanvasCharacterProfile({ ...input, referenceViews: [{ ...ref(media(1)), sha256: 'fake-hash' }] }), /content hash/);
  assert.throws(() => normalizeCanvasCharacterProfile({ ...input, providerBindings: [binding({ scope: { ...scope, apiEndpoint: 'https://api.example/v1?api_key=secret' } })] }), /credentials/);
});

test('shot compilation freezes exact identity/version inputs and emits per-request image mapping', () => {
  const { project, canvas, shot, capability } = fixture();
  const compiled = compileShotCharacterInputs(project, shot, canvas, capability);
  assert.equal(compiled.canSubmit, true, JSON.stringify(compiled.issues));
  assert.equal(compiled.mappingText.split('\n')[0], '图1 = 林澈 正面');
  assert.ok(compiled.inputs.every(input => input.role === 'referenceImage' && input.purpose === 'identity'));
  assert.equal(compiled.characters[0].canonicalVersion, 1);
  assert.equal(compiled.characters[0].characterId, char1);
  const updated = setProjectCharacterProfile(project, char1, { ...project.characters[0].canvasCharacter!, canonicalVersion: 2, immutableTraits: '新面貌' });
  assert.equal(compiled.characters[0].immutableTraits, '深棕短发，左眼下小痣');
  const old = compileShotCharacterInputs(updated, { ...shot, characterSelections: [{ characterId: char1, canonicalVersion: 1 }] }, canvas, capability);
  assert.equal(old.characters[0].canonicalVersion, 1);
  assert.equal(old.characters[0].immutableTraits, compiled.characters[0].immutableTraits);
  assert.ok(Object.isFrozen(compiled.inputs[0].metadata));
  assert.ok(Object.isFrozen(compiled.parameters));
});

test('best views follow shot framing and episode outfits are independent of stable identity', () => {
  const { project, canvas, shot, capability } = fixture();
  const outfit = { id: 'uniform', version: 2, label: '校服', description: '浅灰校服，蓝色领结', refs: [ref(project.assets[4], 'fullBody')], episodeNumbers: [2] };
  const updated = setProjectCharacterProfile(project, char1, { ...project.characters[0].canvasCharacter!, outfits: [outfit] });
  const wide = compileShotCharacterInputs(updated, { ...shot, shotSize: 'wide' }, canvas, capability);
  assert.equal(wide.inputs[0].view, 'fullBody');
  assert.equal(wide.characters[0].outfit!.id, 'uniform');
  assert.equal(wide.inputs[1].purpose, 'outfit');
  assert.match(wide.prompt, /浅灰校服/);
  const side = compileShotCharacterInputs(updated, { ...shot, cameraAngle: 'over_the_shoulder' }, canvas, capability);
  assert.equal(side.inputs[0].view, 'side');
  assert.equal(compileShotCharacterInputs(updated, { ...shot, episodeNumber: 1 }, canvas, capability).characters[0].outfit, undefined);
});

test('counts allocate every selected character before optional views and prioritize the lead', () => {
  const { project, canvas, shot, capability } = fixture();
  const narrow = { ...capability, identity: { ...capability.identity, allImagesTotal: 2 }, modes: [{ ...capability.modes[0], referenceRules: { image: { supported: true, maxCount: 2 } }, combinationConstraints: [{ combination: 'image' as const, maxImages: 2 }] }] };
  const selected = { ...shot, characterSelections: [{ characterId: char2 }, { characterId: char1, lead: true }] };
  const two = compileShotCharacterInputs(project, selected, canvas, narrow);
  assert.equal(two.canSubmit, true, JSON.stringify(two.issues));
  assert.deepEqual(two.inputs.map(input => input.characterId), [char1, char2]);
  assert.ok(two.droppedReferences.length > 0);
  const one = compileShotCharacterInputs(project, selected, canvas, { ...narrow, identity: { ...narrow.identity, allImagesTotal: 1 } });
  assert.equal(one.canSubmit, false);
  assert.equal(one.inputs[0].characterId, char1);
  assert.ok(one.droppedReferences.some(drop => drop.characterId === char2 && drop.required));
  assert.ok(one.issues.some(issue => issue.code === 'CHARACTER_IDENTITY_REQUIRED' && issue.characterId === char2));
});

test('oversized, unavailable, unapproved or multi-subject pictures are reported with clear fallbacks', () => {
  const { project, canvas, shot, capability } = fixture();
  const oversized = { ...project, assets: project.assets.map((asset, index) => index === 0 ? { ...asset, byteLength: 3000 } : asset) };
  const result = compileShotCharacterInputs(oversized, shot, canvas, capability);
  assert.equal(result.canSubmit, true, JSON.stringify(result.issues));
  assert.equal(result.inputs[0].view, 'side');
  assert.ok(result.droppedReferences.some(drop => drop.versionId === ref(project.assets[0]).versionId && /byteLength/.test(drop.reason)));
  const rejected = setProjectCharacterProfile(project, char1, { ...project.characters[0].canvasCharacter!, canonicalVersion: 2,
    referenceViews: project.characters[0].canvasCharacter!.referenceViews.map(item => ({ ...item, qualityStatus: 'draft', subjectCount: 2 })) });
  const none = compileShotCharacterInputs(rejected, shot, canvas, capability);
  assert.equal(none.canSubmit, false);
  assert.ok(none.issues.some(issue => issue.code === 'CHARACTER_IDENTITY_REQUIRED'));
});

test('multiple people and undeclared media combinations block preview rather than silently removing a character', () => {
  const { project, canvas, shot, capability } = fixture();
  const multiple = compileShotCharacterInputs(project, { ...shot, characterIds: [char1, char2], characterSelections: undefined }, canvas,
    { ...capability, identity: { ...capability.identity, subjectPolicy: 'singleSubject' } });
  assert.equal(multiple.canSubmit, false);
  assert.ok(multiple.issues.some(issue => issue.code === 'CHARACTER_SUBJECT_POLICY'));
  const audio = { id: 'audio-reference', role: 'referenceAudio' as const, order: 0,
    version: { id: 'audio-v1', assetId: 'asset-audio', kind: 'audio' as const, uri: 'nextmux.media/audio.wav', createdAt: now, metadata: { durationMs: 1000 } } };
  const video = changeMode(canvas, 'referenceToVideo');
  const target = video.nodes[0];
  const withAudio = { ...video, nodes: [{ ...target, payload: { ...target.payload, inputs: [audio] } } as CanvasNode] };
  const compiled = compileShotCharacterInputs(project, shot, withAudio, videoCapability(capability, 'referenceToVideo'));
  assert.equal(compiled.canSubmit, false);
  assert.ok(compiled.issues.some(issue => issue.code === 'INPUT_COMBINATION_UNSUPPORTED'));
  assert.ok(compiled.inputs.some(input => input.role === 'referenceAudio'));
});

test('a scoped verified element is reusable; another provider/account/model/endpoint/version never receives it', () => {
  const { project, canvas, shot, capability } = fixture();
  const bound = setProjectCharacterProfile(project, char1, { ...project.characters[0].canvasCharacter!, providerBindings: [binding()] });
  const cap = { ...videoCapability(capability, 'textToVideo'), identity: { ...capability.identity, elementBinding: true, elementsTransportVerified: true, elementModes: ['textToVideo' as const], maxElements: 2 } };
  const direct = selectVerifiedCharacterBinding(characterAssetFromProject(bound, char1), cap, 'textToVideo');
  assert.equal(direct?.externalElementId, 'element-only-provider-a');
  const compiled = compileShotCharacterInputs(bound, shot, changeMode(canvas, 'textToVideo'), cap);
  assert.equal(compiled.canSubmit, true, JSON.stringify(compiled.issues));
  assert.equal(compiled.characters[0].providerBinding?.externalElementId, 'element-only-provider-a');
  for (const requestScope of [{ ...scope, providerId: 'provider-b' }, { ...scope, accountNamespace: 'account-b' }, { ...scope, modelFamily: 'other' },
    { ...scope, apiEndpoint: 'https://another.example/v1' }, { ...scope, modelVersion: 'model-v2' }, { ...scope, region: 'east' }]) {
    assert.equal(selectVerifiedCharacterBinding(characterAssetFromProject(bound, char1), { ...cap, requestScope }, 'textToVideo'), undefined);
    const fallback = compileShotCharacterInputs(bound, shot, canvas, { ...capability, requestScope, identity: { ...cap.identity, elementModes: ['imageToImage'] } });
    assert.equal(fallback.characters[0].providerBinding, undefined);
    assert.ok(!JSON.stringify(fallback).includes('element-only-provider-a'));
    assert.ok(fallback.inputs.some(input => input.purpose === 'identity'));
  }
});

test('unverified, expired, stale and changed-content element bindings fall back to original managed images', () => {
  const { project, canvas, shot, capability } = fixture();
  const cap = { ...capability, identity: { ...capability.identity, elementBinding: true, elementsTransportVerified: true, elementModes: ['imageToImage' as const], maxElements: 2 } };
  for (const invalid of [binding({ status: 'unverified' }), binding({ expiresAt: '2026-09-29T00:00:00Z' }), binding({ referenceVersion: 2 }), binding({ capabilityVersion: 'old-cap' }), binding({ validationMethod: undefined })]) {
    const updated = setProjectCharacterProfile(project, char1, { ...project.characters[0].canvasCharacter!, providerBindings: [invalid] });
    const compiled = compileShotCharacterInputs(updated, shot, canvas, cap);
    assert.equal(compiled.characters[0].providerBinding, undefined);
    assert.equal(compiled.inputs[0].purpose, 'identity');
  }
  const bound = setProjectCharacterProfile(project, char1, { ...project.characters[0].canvasCharacter!, providerBindings: [binding()] });
  const mutated = { ...bound, assets: bound.assets.map((asset, index) => index === 0 ? { ...asset, sha256: 'f'.repeat(64) } : asset) };
  assert.equal(compileShotCharacterInputs(mutated, shot, canvas, cap).characters[0].providerBinding, undefined);
});

test('identity pictures never become frames implicitly; explicit approved frame selection works in frame-only mode', () => {
  const { project, canvas, shot, capability } = fixture();
  const video = changeMode(canvas, 'imageToVideo');
  const frameCap = { ...videoCapability(capability, 'imageToVideo'), identity: { ...capability.identity, referenceImages: false,
    frameRules: { firstFrame: { supported: true, maxCount: 1, maxBytes: 2000 } } } };
  const implicit = compileShotCharacterInputs(project, shot, video, frameCap);
  assert.equal(implicit.canSubmit, false);
  assert.equal(implicit.inputs.some(input => input.role === 'firstFrame'), false);
  const explicit = compileShotCharacterInputs(project, { ...shot, characterSelections: [{ characterId: char1, lead: true,
    frame: { role: 'firstFrame', referenceVersionId: ref(project.assets[0]).versionId } }] }, video, frameCap);
  assert.equal(explicit.canSubmit, true, JSON.stringify(explicit.issues));
  assert.equal(explicit.inputs[0].role, 'firstFrame');
  assert.equal(explicit.inputs[0].purpose, 'composition');
  assert.ok(explicit.issues.some(issue => issue.code === 'CHARACTER_IDENTITY_VIA_EXPLICIT_FRAME'));
});

test('frame and identity use of the same asset preserve separate slots, with verified combination and shared total budget', () => {
  const { project, canvas, shot, capability } = fixture();
  const first = canvasVersionFromComicAsset(project.assets[0]);
  const video = changeMode(canvas, 'referenceToVideo');
  const selected = { ...shot, characterSelections: [{ characterId: char1, frame: { role: 'firstFrame' as const, referenceVersionId: first.id } }] };
  const cap = { ...videoCapability(capability, 'referenceToVideo'), identity: { ...capability.identity, identityAlongsideStartFrame: true, allImagesTotal: 2,
    frameRules: { firstFrame: { supported: true, maxCount: 1 } } } };
  const compiled = compileShotCharacterInputs(project, selected, video, cap);
  assert.equal(compiled.canSubmit, true, JSON.stringify(compiled.issues));
  assert.deepEqual(compiled.inputs.map(input => [input.role, input.versionId]), [['firstFrame', first.id], ['referenceImage', first.id]]);
  assert.equal(compiled.referenceMap[1].imageIndex, 2);
  const unverified = compileShotCharacterInputs(project, selected, video, { ...cap, identity: { ...cap.identity, identityAlongsideStartFrame: undefined } });
  assert.equal(unverified.canSubmit, false);
  assert.ok(unverified.issues.some(issue => issue.code === 'CHARACTER_FRAME_COMBINATION_UNVERIFIED'));
});

test('linked character IDs drive selection without name guesses and frozen profile replaces floating node output', () => {
  const { project, canvas, shot, capability } = fixture();
  const identityNode: CanvasNode = { id: 'character-node', kind: 'character', title: '可改名', position: { x: 0, y: 0 }, size: { width: 100, height: 100 },
    payload: { characterId: char1, appearance: '过时外观', versions: [] } };
  const wired = { ...canvas, nodes: [...canvas.nodes, identityNode], edges: [{ id: 'identity-edge', sourceNodeId: identityNode.id, sourcePort: 'image',
    targetNodeId: 'generation-node', targetPort: 'referenceImage', role: 'referenceImage' as const, order: 0, binding: 'followCurrent' as const }] };
  const compiled = compileShotCharacterInputs(project, { ...shot, characterSelections: undefined }, wired, capability);
  assert.equal(compiled.canSubmit, true, JSON.stringify(compiled.issues));
  assert.equal(compiled.characters[0].characterId, char1);
  assert.ok(!compiled.prompt.includes('过时外观'));
  const empty = compileShotCharacterInputs(project, { ...shot, characterSelections: [], characterIds: [] }, canvas, capability);
  assert.equal(empty.characters.length, 0, 'all project characters are not injected into every shot');
});

test('different registry and provider model IDs compile to the existing pipeline provider model ID', () => {
  const { project, canvas, shot, capability } = fixture();
  const providerCanvas = { ...canvas, nodes: canvas.nodes.map(node => node.kind !== 'imageGen' ? node : { ...node, payload: { ...node.payload, modelId: capability.providerModelId } }) };
  const compiled = compileShotCharacterInputs(project, { ...shot, nodeId: undefined }, providerCanvas, capability);
  assert.equal(compiled.canSubmit, true, JSON.stringify(compiled.issues));
  assert.equal(compiled.modelId, capability.providerModelId);
  assert.equal(compileShotCharacterInputs(project, shot, canvas, capability).modelId, capability.providerModelId);
  const mismatched = { ...canvas, nodes: canvas.nodes.map(node => node.kind !== 'imageGen' ? node : { ...node, payload: { ...node.payload, modelId: 'unrelated-model' } }) };
  assert.ok(compileShotCharacterInputs(project, shot, mismatched, capability).issues.some(issue => issue.code === 'CHARACTER_MODEL_MISMATCH'));
});

test('the identity-only allowance leaves budget for separate outfit pictures and reports additional angles', () => {
  const { project, canvas, shot, capability } = fixture();
  const updated = setProjectCharacterProfile(project, char1, { ...project.characters[0].canvasCharacter!, outfits: [{ id: 'uniform', version: 1, label: '校服',
    description: '灰色校服', refs: [ref(project.assets[4], 'fullBody')], episodeNumbers: [2] }] });
  const compiled = compileShotCharacterInputs(updated, shot, canvas, { ...capability, identity: { ...capability.identity, maxIdentityImages: 1 } });
  assert.equal(compiled.canSubmit, true, JSON.stringify(compiled.issues));
  assert.deepEqual(compiled.inputs.map(input => input.purpose), ['identity', 'outfit']);
  assert.ok(compiled.droppedReferences.some(drop => /identity image budget/.test(drop.reason)));
  const zero = compileShotCharacterInputs(updated, shot, canvas, { ...capability, identity: { ...capability.identity, maxIdentityImages: 0 } });
  assert.equal(zero.canSubmit, false);
  assert.ok(zero.issues.some(issue => issue.code === 'CHARACTER_IDENTITY_REQUIRED'));
});

test('voice selection is separately verified and never follows the video generated-audio toggle', () => {
  const { project, canvas, shot, capability } = fixture();
  const voice = { id: 'voice-a', voiceProfileId: 'internal-voice', scope, externalVoiceId: 'voice-only-provider-a', status: 'active' as const,
    validatedAt: now, validationMethod: 'controlledCall' as const, expiresAt: null };
  const updated = setProjectCharacterProfile(project, char1, { ...project.characters[0].canvasCharacter!, voiceBindings: [voice] });
  const selected = compileShotCharacterInputs(updated, shot, canvas, { ...capability, identity: { ...capability.identity, voiceSelection: true } });
  assert.equal(selected.characters[0].voiceBinding?.externalVoiceId, 'voice-only-provider-a');
  for (const cap of [capability, { ...capability, identity: { ...capability.identity, voiceSelection: true }, requestScope: { ...scope, accountNamespace: 'another-account' } },
    { ...capability, identity: { ...capability.identity, voiceSelection: true }, requestScope: { ...scope, providerId: 'another-provider' } }]) {
    const rejected = compileShotCharacterInputs(updated, shot, canvas, cap);
    assert.equal(rejected.characters[0].voiceBinding, undefined);
    assert.equal(JSON.stringify(rejected).includes('voice-only-provider-a'), false);
  }
});

test('invalid canvas slot/mode combinations return a reviewable failure without dropping direct inputs', () => {
  const { project, canvas, shot, capability } = fixture();
  const version = { id: 'audio-v1', assetId: 'asset-audio', kind: 'audio' as const, uri: 'nextmux.media/audio.wav', createdAt: now };
  const invalid = { ...canvas, nodes: canvas.nodes.map(node => node.kind !== 'imageGen' ? node : { ...node, payload: { ...node.payload,
    inputs: [{ id: 'unsupported-audio', role: 'referenceAudio' as const, order: 0, version }] } }) };
  const result = compileShotCharacterInputs(project, shot, invalid, capability);
  assert.equal(result.canSubmit, false);
  assert.equal(result.inputs[0].role, 'referenceAudio');
  assert.ok(result.issues.some(issue => issue.code === 'MODE_ROLE'));
});

test('a valid Element ID without adapter transport evidence uses images and cannot claim an element-only submit', () => {
  const { project, canvas, shot, capability } = fixture();
  const updated = setProjectCharacterProfile(project, char1, { ...project.characters[0].canvasCharacter!, providerBindings: [binding()] });
  const unverifiedTransport = { ...capability, identity: { ...capability.identity, elementBinding: true, elementModes: ['imageToImage' as const], maxElements: 2 } };
  const compiled = compileShotCharacterInputs(updated, shot, canvas, unverifiedTransport);
  assert.equal(compiled.canSubmit, true, JSON.stringify(compiled.issues));
  assert.equal(compiled.characters[0].providerBinding, undefined);
  assert.ok(compiled.inputs.some(input => input.purpose === 'identity'));
  assert.ok(compiled.issues.some(issue => issue.code === 'CHARACTER_ELEMENT_TRANSPORT_UNVERIFIED'));
  const imageFallback = compileShotCharacterInputs(updated, shot, changeMode(canvas, 'textToVideo'), {
    ...videoCapability(capability, 'textToVideo'), identity: { ...unverifiedTransport.identity, elementModes: ['textToVideo'] },
  });
  assert.equal(imageFallback.canSubmit, true, JSON.stringify(imageFallback.issues));
  assert.equal(imageFallback.characters[0].providerBinding, undefined);
  assert.ok(imageFallback.inputs.some(input => input.purpose === 'identity'));
});

test('frame generation keeps separately declared identity references and refuses unsupported ones without losing inputs', () => {
  const { project, canvas, shot, capability } = fixture();
  const selected = { ...shot, characterSelections: [{ characterId: char1, frame: { role: 'firstFrame' as const, referenceVersionId: ref(project.assets[0]).versionId } }] };
  const cap = { ...videoCapability(capability, 'imageToVideo'), identity: { ...capability.identity, identityAlongsideStartFrame: true,
    frameRules: { firstFrame: { supported: true, maxCount: 1 } } } };
  const compiled = compileShotCharacterInputs(project, selected, changeMode(canvas, 'imageToVideo'), cap);
  assert.equal(compiled.canSubmit, true, JSON.stringify(compiled.issues));
  assert.ok(compiled.inputs.some(input => input.role === 'firstFrame'));
  assert.ok(compiled.inputs.some(input => input.role === 'referenceImage' && input.purpose === 'identity'));
  const scenePicture = { id: 'scene-picture', role: 'referenceImage' as const, order: 0, version: canvasVersionFromComicAsset(project.assets[4]) };
  const withScene = { ...changeMode(canvas, 'imageToVideo'), nodes: changeMode(canvas, 'imageToVideo').nodes.map(node => node.kind !== 'videoGen' ? node
    : { ...node, payload: { ...node.payload, inputs: [scenePicture] } }) };
  const rejected = compileShotCharacterInputs(project, selected, withScene, {
    ...cap, modes: [{ ...cap.modes[0], referenceRules: { image: { supported: false, maxCount: 0 } } }],
  });
  assert.equal(rejected.canSubmit, false);
  assert.ok(rejected.inputs.some(input => input.versionId === scenePicture.version.id && input.role === 'referenceImage'));
  assert.ok(rejected.inputs.some(input => input.role === 'firstFrame'));
  assert.ok(rejected.issues.some(issue => issue.code === 'INPUT_ROLE_UNSUPPORTED'));
  const unknownTotal = compileShotCharacterInputs(project, selected, changeMode(canvas, 'referenceToVideo'), {
    ...videoCapability(capability, 'referenceToVideo'), identity: { ...cap.identity, allImagesTotal: undefined },
  });
  assert.ok(unknownTotal.issues.some(issue => issue.code === 'CHARACTER_TOTAL_IMAGE_LIMIT_UNKNOWN'));
});

test('combining elements and images needs an explicit shared-budget declaration', () => {
  const { project, canvas, shot, capability } = fixture();
  const updated = setProjectCharacterProfile(project, char1, { ...project.characters[0].canvasCharacter!, providerBindings: [binding()] });
  const scenePicture = { id: 'scene-picture', role: 'referenceImage' as const, order: 0, version: canvasVersionFromComicAsset(project.assets[4]) };
  const withScene = { ...canvas, nodes: canvas.nodes.map(node => node.kind !== 'imageGen' ? node : { ...node, payload: { ...node.payload, inputs: [scenePicture] } }) };
  const cap = { ...capability, identity: { ...capability.identity, elementBinding: true, elementsTransportVerified: true, elementModes: ['imageToImage' as const], maxElements: 1 } };
  const unknown = compileShotCharacterInputs(updated, shot, withScene, cap);
  assert.equal(unknown.canSubmit, false);
  assert.ok(unknown.issues.some(issue => issue.code === 'CHARACTER_ELEMENT_IMAGE_BUDGET_UNKNOWN'));
  assert.equal(compileShotCharacterInputs(updated, shot, withScene, { ...cap, identity: { ...cap.identity, elementsCountAsImages: false } }).canSubmit, true);
});
