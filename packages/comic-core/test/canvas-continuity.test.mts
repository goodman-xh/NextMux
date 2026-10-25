import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCanvasCommand, compileCanvasGenerationRequest, createCanvasDocument, createGenerationSnapshot, parseCanvasDocument, serializeCanvasDocument, type CanvasAssetVersion, type CanvasNode } from '../lib/canvas.js';
import { prepareCanvasContinuity, type PrepareCanvasContinuityOptions } from '../lib/canvas-continuity.js';
import type { CanvasModelCapability } from '../lib/canvas-capabilities.js';
const now = '2026-10-03T16:00:00.000Z';
const video: CanvasAssetVersion = { id: 'video-v1', assetId: 'video-asset', kind: 'video', uri: 'nextmux.media/one.mp4', createdAt: now,
  metadata: { width: 1280, height: 720, durationMs: 5000, frameRate: 24, mimeType: 'video/mp4', sha256: 'a'.repeat(64) } };
const frame: CanvasAssetVersion = { id: 'frame-v1', assetId: 'frame-asset', kind: 'image', uri: 'nextmux.media/last.png', createdAt: now,
  metadata: { width: 1280, height: 720, mimeType: 'image/png' }, provenance: { sourceNodeId: 'source', sourceVersionId: video.id, frameSelection: { kind: 'last' }, actualTimeMs: 4958.333 } };
const geometry = { position: { x: 0, y: 0 }, size: { width: 280, height: 280 } };
const source: CanvasNode = { id: 'source', kind: 'video', title: 'A', ...geometry, payload: { versions: [video], currentVersionId: video.id } };
const picture: CanvasNode = { id: 'frame', kind: 'image', title: 'Tail', ...geometry, payload: { versions: [frame], currentVersionId: frame.id } };
const mode = (value: 'imageToVideo' | 'referenceToVideo' | 'videoExtend') => ({ mode: value, outputVariants: [{ id: '720p', resolution: '720p', aspectRatios: ['16:9'] }],
  duration: { kind: 'enum' as const, seconds: [5, 8], defaultSeconds: 5 }, audioGeneration: { mode: 'optional' as const, defaultEnabled: true },
  ...(value === 'imageToVideo' ? { firstFrame: true, frameImageRule: { supported: true, maxCount: 1 } }
    : { referenceRules: { video: { supported: true, maxCount: 1 } }, combinationConstraints: [{ combination: 'video' as const, maxVideos: 1 }] }) });
const capability: CanvasModelCapability = { id: 'fixture', providerId: 'fixture', providerModelId: 'fixture-video', displayName: 'Fixture video', version: 'v1', status: 'available',
  sources: [],
  modes: [mode('imageToVideo'), mode('referenceToVideo'), mode('videoExtend')] };
function options(): PrepareCanvasContinuityOptions {
  return { canvas: { ...createCanvasDocument({ id: 'canvas', projectId: 'project', now }), nodes: [source, picture] }, sourceNodeId: source.id, sourceVersionId: video.id,
    approved: true, intent: 'continueAction', strategy: 'tailFrame', boundary: { appearance: 'Blue coat', action: 'Right hand holds cup; left hand is reaching the door.', camera: 'Tracking right', story: 'The door has not opened.' },
    userPrompt: 'Open the door and enter.', capability, tailFrame: { nodeId: picture.id, versionId: frame.id }, nodeId: 'next', edgeId: 'input', title: 'B', position: { x: 800, y: 0 }, now };
}

test('next shot pins a reviewed source and real last frame without submitting; history is immutable and round-trips', () => {
  const input = options(), result = prepareCanvasContinuity(input);
  assert.equal(result.node.payload.jobs, undefined); assert.equal(result.node.payload.versions.length, 0);
  assert.equal(result.node.payload.modelId, capability.providerModelId);
  assert.equal(result.edge.binding, 'pinnedVersion'); assert.equal(result.edge.pinnedVersionId, frame.id);
  assert.match(result.node.payload.prompt, /Right hand holds cup/);
  assert.equal(result.node.payload.parameters.durationSeconds, 5);
  assert.deepEqual(parseCanvasDocument(serializeCanvasDocument(result.canvas)), result.canvas);
  const snapshot = createGenerationSnapshot(result.canvas, 'next', { capabilityVersion: capability.version });
  assert.equal(snapshot.continuity?.sourceSha256, video.metadata?.sha256);
  assert.ok(Object.isFrozen(snapshot.continuity?.boundary));
  (input.boundary as any).action = 'changed afterwards';
  assert.match(snapshot.continuity!.boundary.action, /Right hand/);
  const updated = applyCanvasCommand(result.canvas, { type: 'node.addVersion', nodeId: source.id, version: { ...video, id: 'video-v2', uri: 'nextmux.media/two.mp4' }, select: true });
  assert.equal(createGenerationSnapshot(updated, 'next', { capabilityVersion: capability.version }).inputFingerprint, snapshot.inputFingerprint);
  const frameUpdated = applyCanvasCommand(updated, { type: 'node.addVersion', nodeId: picture.id, version: { ...frame, id: 'frame-v2', uri: 'nextmux.media/new.png' }, select: true });
  assert.equal(createGenerationSnapshot(frameUpdated, 'next', { capabilityVersion: capability.version }).resolvedInputs[0].versionId, frame.id);
});

test('video reference and native extension send the source video only on declared routes', () => {
  for (const strategy of ['videoReference', 'videoExtend'] as const) {
    const result = prepareCanvasContinuity({ ...options(), strategy });
    assert.equal(result.edge.pinnedVersionId, video.id); assert.equal(result.edge.role, 'referenceVideo');
    assert.equal(result.node.payload.mode, strategy === 'videoExtend' ? 'videoExtend' : 'referenceToVideo');
    assert.throws(() => prepareCanvasContinuity({ ...options(), strategy, capability: { ...capability, modes: [mode('imageToVideo')] } }), { code: 'CONTINUITY_ROUTE_UNAVAILABLE' });
  }
});

test('unapproved, busy, missing, wrong-frame and incomplete states cannot become continuation drafts', () => {
  assert.throws(() => prepareCanvasContinuity({ ...options(), approved: false }), { code: 'CONTINUITY_APPROVAL_REQUIRED' });
  assert.throws(() => prepareCanvasContinuity({ ...options(), sourceVersionId: 'missing' }), { code: 'CONTINUITY_SOURCE_MISSING' });
  assert.throws(() => prepareCanvasContinuity({ ...options(), userPrompt: '  ' }), { code: 'CONTINUITY_STATE_REQUIRED' });
  assert.throws(() => prepareCanvasContinuity({ ...options(), boundary: { ...options().boundary, action: '' } }), { code: 'CONTINUITY_STATE_REQUIRED' });
  for (const provenance of [{ sourceVersionId: 'wrong', frameSelection: { kind: 'last' } }, { sourceVersionId: video.id, frameSelection: { kind: 'first' } }, { sourceVersionId: video.id }]) {
    const input = options();
    const canvas = { ...input.canvas, nodes: [source, { ...picture, payload: { versions: [{ ...frame, provenance }], currentVersionId: frame.id } } as CanvasNode] };
    assert.throws(() => prepareCanvasContinuity({ ...input, canvas }), { code: 'CONTINUITY_FRAME_REQUIRED' });
  }
  const sourceDraft: CanvasNode = { ...source, kind: 'videoGen', payload: { mode: 'textToVideo', modelId: capability.id, prompt: 'A', parameters: {}, versions: [video], currentVersionId: video.id,
    jobs: [{ idempotencyKey: 'running', status: 'running', createdAt: now, updatedAt: now, snapshot: {} as never }] } };
  assert.throws(() => prepareCanvasContinuity({ ...options(), canvas: { ...options().canvas, nodes: [sourceDraft, picture] } }), { code: 'CONTINUITY_SOURCE_BUSY' });
});

test('removed references or mode changes fail before generation instead of claiming continuity', () => {
  const result = prepareCanvasContinuity(options());
  const snapshot = createGenerationSnapshot(result.canvas, 'next', { capabilityVersion: capability.version });
  assert.throws(() => compileCanvasGenerationRequest({ ...snapshot, resolvedInputs: snapshot.resolvedInputs.map(input => ({ ...input, assetId: 'different-asset' })) }), { code: 'CONTINUITY_INPUT_CHANGED' });
  assert.throws(() => compileCanvasGenerationRequest({ ...snapshot, resolvedInputs: snapshot.resolvedInputs.map(input => ({ ...input, sourceNodeId: 'different-node' })) }), { code: 'CONTINUITY_INPUT_CHANGED' });
  const removed = applyCanvasCommand(result.canvas, { type: 'edge.disconnect', edgeId: result.edge.id });
  assert.throws(() => createGenerationSnapshot(removed, 'next', { capabilityVersion: capability.version }));
  const changed = applyCanvasCommand(removed, { type: 'node.setParameters', nodeId: 'next', mode: 'textToVideo', parameters: result.node.payload.parameters });
  assert.throws(() => createGenerationSnapshot(changed, 'next', { capabilityVersion: capability.version }), { code: 'CONTINUITY_INPUT_CHANGED' });
});

test('a same-named version on another video cannot be mistaken for the approved source', () => {
  const input = options();
  const wrongFrame = { ...picture, payload: { ...picture.payload, versions: [{ ...frame, provenance: { ...frame.provenance, sourceNodeId: 'another-source' } }] } } as CanvasNode;
  assert.throws(() => prepareCanvasContinuity({ ...input, canvas: { ...input.canvas, nodes: [source, wrongFrame] } }), { code: 'CONTINUITY_FRAME_REQUIRED' });
});
