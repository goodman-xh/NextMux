import assert from 'node:assert/strict';
import test from 'node:test';
import { createComicProject } from '../lib/core.js';
import { CanvasError, compileCanvasGenerationRequest } from '../lib/canvas.js';
import type { CanvasDocument, CanvasGenerationMode, CanvasNode } from '../lib/canvas.js';
import { createShotCharacterGenerationSnapshot } from '../lib/canvas-character-generation.js';
import { setProjectCharacterProfile } from '../lib/canvas-characters.js';
import type { CanvasCharacterCapability, CanvasCharacterShot, CharacterProviderScope } from '../lib/canvas-characters.js';
import type { ComicAsset } from '../lib/types.js';

const now = '2026-09-30T00:00:00Z';
const characterId = 'character-11111111-1111-1111-1111-111111111111';
function fixture() {
  const base = createComicProject({ now, starter: 'empty' });
  const asset: ComicAsset = { id: 'asset-11111111-1111-1111-1111-111111111111', kind: 'image', source: 'imported', status: 'ready',
    uri: 'nextmux.media/front.png', mimeType: 'image/png', byteLength: 1000, width: 512, height: 512, sha256: '1'.repeat(64), createdAt: now, updatedAt: now };
  const versionId = `version-${asset.id}`;
  const project = setProjectCharacterProfile({ ...base, assets: [asset], characters: [{ id: characterId, name: '林澈', description: '',
    appearance: '', voice: '', createdAt: now, updatedAt: now }] }, characterId, { canonicalVersion: 1, immutableTraits: '棕色短发，左眼下小痣',
    referenceViews: [{ assetId: asset.id, versionId, view: 'front', qualityStatus: 'approved', subjectCount: 1, sha256: asset.sha256 }],
    outfits: [], voiceBindings: [], providerBindings: [] });
  const shot: CanvasCharacterShot = { id: 'shot-fixture', nodeId: 'generation-node', shotSize: 'close_up', characterSelections: [{ characterId, lead: true }] };
  const node: CanvasNode = { id: 'generation-node', kind: 'imageGen', title: '镜头', position: { x: 0, y: 0 }, size: { width: 100, height: 100 },
    origin: { shotId: shot.id }, payload: { modelId: 'provider-model', mode: 'imageToImage', prompt: '林澈走到窗边。', parameters: { resolution: '512', aspectRatio: '1:1' }, versions: [] } };
  const canvas: CanvasDocument = { schemaVersion: 1, id: 'canvas-fixture', projectId: project.id, title: '桥接', nodes: [node], edges: [], groups: [],
    settings: {}, revision: 0, viewport: { x: 0, y: 0, zoom: 1 }, createdAt: now, updatedAt: now };
  const capability: CanvasCharacterCapability = { id: 'registry-model', providerId: 'provider-a', providerModelId: 'provider-model', displayName: 'Fixture',
    version: 'cap-v1', status: 'available', sources: ['verified fixture'], now, identity: { referenceImages: true, allImagesTotal: 3, subjectPolicy: 'multipleSubjects' },
    modes: [{ mode: 'imageToImage', outputVariants: [{ id: '512', resolution: '512', aspectRatios: ['1:1'] }],
      referenceRules: { image: { supported: true, maxCount: 3, maxBytes: 2000 } }, combinationConstraints: [{ combination: 'image', maxImages: 3 }] }] };
  return { project, canvas, shot, capability, asset, versionId };
}
function videoFixture(mode: CanvasGenerationMode) {
  const data = fixture();
  return { ...data, canvas: { ...data.canvas, nodes: data.canvas.nodes.map(node => node.kind !== 'imageGen' ? node : {
    ...node, kind: 'videoGen', payload: { ...node.payload, mode, parameters: { ...node.payload.parameters, durationSeconds: 4, generateAudio: false } },
  } as CanvasNode) }, capability: { ...data.capability, modes: [{ ...data.capability.modes[0], mode, firstFrame: true,
    duration: { kind: 'fixed' as const, seconds: 4 }, audioGeneration: { mode: 'unsupported' as const, defaultEnabled: false } }] } };
}

test('bridge freezes project-only identity media and produces a request usable by the current generation pipeline', () => {
  const { project, canvas, shot, capability, asset, versionId } = fixture();
  const before = JSON.stringify(canvas);
  let measuredVersionTime = '';
  const snapshot = createShotCharacterGenerationSnapshot(project, shot, canvas, capability, { fileExists: (_uri, version) => { measuredVersionTime = version.createdAt; return true; } });
  assert.equal(snapshot.modelId, capability.providerModelId);
  assert.equal(snapshot.capabilityVersion, capability.version);
  assert.match(snapshot.inputFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.resolvedInputs[0].role, 'referenceImage');
  assert.equal(snapshot.resolvedInputs[0].versionId, versionId);
  assert.equal(snapshot.resolvedInputs[0].uri, asset.uri);
  assert.equal(measuredVersionTime, project.updatedAt);
  assert.equal(snapshot.characterSnapshot[0].canonicalVersion, 1);
  assert.equal(snapshot.characterSnapshot[0].referenceVersionIds[0], versionId);
  assert.ok(Object.isFrozen(snapshot.characterSnapshot[0]));
  assert.ok(Object.isFrozen(snapshot.resolvedInputs[0].metadata));
  const request = compileCanvasGenerationRequest(snapshot);
  assert.equal(request.mode, 'imageToImage');
  assert.equal(JSON.stringify(canvas), before);
  assert.deepEqual(createShotCharacterGenerationSnapshot(project, shot, canvas, capability), snapshot);
});

test('upstream text, linked character pictures and direct imports appear exactly once in the snapshot', () => {
  const { project, canvas, shot, capability, asset, versionId } = fixture();
  const text: CanvasNode = { id: 'prompt-node', kind: 'text', title: '上游', position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, payload: { text: '雨水敲打玻璃。' } };
  const identity: CanvasNode = { id: 'character-node', kind: 'character', title: '林澈', position: { x: 0, y: 0 }, size: { width: 100, height: 100 },
    payload: { characterId, versions: [{ id: versionId, assetId: asset.id, kind: 'image', uri: asset.uri, createdAt: now,
      metadata: { sha256: asset.sha256, width: 512, height: 512, byteLength: 1000, mimeType: 'image/png' } }], currentVersionId: versionId } };
  const linked = { ...canvas, nodes: [...canvas.nodes, text, identity], edges: [
    { id: 'prompt-edge', sourceNodeId: text.id, sourcePort: 'text', targetNodeId: 'generation-node', targetPort: 'prompt', role: 'prompt' as const, order: 0, binding: 'followCurrent' as const },
    { id: 'identity-edge', sourceNodeId: identity.id, sourcePort: 'image', targetNodeId: 'generation-node', targetPort: 'referenceImage', role: 'referenceImage' as const, order: 1, binding: 'followCurrent' as const },
  ] };
  const snapshot = createShotCharacterGenerationSnapshot(project, shot, linked, capability);
  assert.equal(snapshot.prompt.split('雨水敲打玻璃。').length - 1, 1);
  assert.equal(snapshot.prompt.split('林澈走到窗边。').length - 1, 1);
  assert.equal(snapshot.prompt.split('图1 = 林澈 正面').length - 1, 1);
  assert.equal(snapshot.resolvedInputs.length, 1);
});

test('the original canvas version is reused for file verification and later source edits do not alter the snapshot', () => {
  const { project, canvas, shot, capability, asset, versionId } = fixture();
  const version = { id: versionId, assetId: asset.id, kind: 'image' as const, uri: asset.uri, createdAt: '2026-09-29T00:00:00Z',
    provenance: { operation: 'approved-portrait' }, metadata: { sha256: asset.sha256, width: 512, height: 512, byteLength: 1000, mimeType: 'image/png' } };
  const source: CanvasNode = { id: 'source-node', kind: 'image', title: '标准图', position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, payload: { versions: [version], currentVersionId: version.id } };
  const withVersion = { ...canvas, nodes: [...canvas.nodes, source] };
  let checkedVersion: unknown;
  const snapshot = createShotCharacterGenerationSnapshot(project, shot, withVersion, capability, { fileExists: (_uri, selected) => { checkedVersion = selected; return true; } });
  assert.deepEqual(checkedVersion, version);
  const changed = setProjectCharacterProfile(project, characterId, { ...project.characters[0].canvasCharacter!, canonicalVersion: 2, immutableTraits: '银色长发' });
  assert.match(snapshot.prompt, /棕色短发/);
  assert.equal(snapshot.characterSnapshot[0].canonicalVersion, 1);
  assert.notEqual(createShotCharacterGenerationSnapshot(changed, shot, withVersion, capability).inputFingerprint, snapshot.inputFingerprint);
});

test('invalid character compilation throws CanvasError with reviewable issues and missing files are checked by the existing resolver', () => {
  const { project, canvas, shot, capability } = fixture();
  const blocked = { ...capability, identity: { ...capability.identity, maxIdentityImages: 0 } };
  assert.throws(() => createShotCharacterGenerationSnapshot(project, shot, canvas, blocked), (error: unknown) => error instanceof CanvasError
    && error.code === 'CHARACTER_INPUTS_INVALID' && error.issues.some(issue => issue.code === 'CHARACTER_IDENTITY_REQUIRED'));
  assert.throws(() => createShotCharacterGenerationSnapshot(project, shot, canvas, capability, { fileExists: () => false }), (error: unknown) => error instanceof CanvasError && error.code === 'MISSING_INPUT');
});

test('identity references keep referenceImage roles and a frame requires an explicit approved selection', () => {
  const { project, canvas, shot, capability, versionId } = videoFixture('imageToVideo');
  const frameCapability = { ...capability, identity: { ...capability.identity, referenceImages: false, frameRules: { firstFrame: { supported: true, maxCount: 1, maxBytes: 2000 } } } };
  const selected = { ...shot, characterSelections: [{ characterId, frame: { role: 'firstFrame' as const, referenceVersionId: versionId } }] };
  const snapshot = createShotCharacterGenerationSnapshot(project, selected, canvas, frameCapability);
  assert.deepEqual(snapshot.resolvedInputs.map(input => input.role), ['firstFrame']);
  assert.equal(snapshot.characterSnapshot[0].characterId, characterId);
  assert.equal(compileCanvasGenerationRequest(snapshot).mode, 'imageToVideo');
  assert.throws(() => createShotCharacterGenerationSnapshot(project, shot, canvas, frameCapability), (error: unknown) => error instanceof CanvasError && error.code === 'CHARACTER_INPUTS_INVALID');
});

test('an otherwise verified Element binding is blocked until a real element-aware adapter exists', () => {
  const { project, canvas, shot, capability, asset } = videoFixture('textToVideo');
  const scope: CharacterProviderScope = { providerId: capability.providerId, accountNamespace: 'account-a', apiEndpoint: 'https://api.example/v1', product: 'video', modelFamily: 'family-a', modelVersion: 'model-v1' };
  const bound = setProjectCharacterProfile(project, characterId, { ...project.characters[0].canvasCharacter!, providerBindings: [{ id: 'element-binding', scope,
    externalElementId: 'verified-element', capabilityVersion: capability.version, referenceVersion: 1, referenceAssetHashes: [asset.sha256!],
    status: 'active', validatedAt: now, validationMethod: 'query' }] });
  const elementCapability = { ...capability, requestScope: scope, identity: { ...capability.identity, elementBinding: true, elementsTransportVerified: true,
    elementModes: ['textToVideo' as const], maxElements: 1 } };
  assert.throws(() => createShotCharacterGenerationSnapshot(bound, shot, canvas, elementCapability), (error: unknown) => error instanceof CanvasError && error.code === 'ELEMENT_ADAPTER_REQUIRED');
});
