import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvasDocument, validateCanvasDocument } from '@nextmux/comic-core/canvas';
import { sourceModule } from './helpers/comic-organizer-source-loader.mjs';
const { CANVAS_CLIPBOARD_FORMAT, CANVAS_CLIPBOARD_VERSION, parseCanvasClipboard, pasteCanvasClipboard, serializeCanvasClipboard } = sourceModule('browser/nextmux-comic-canvas-clipboard.ts');

const now = '2026-09-30T10:00:00.000Z';
const later = '2026-09-30T11:00:00.000Z';
const shape = { position: { x: 100, y: 200 }, size: { width: 100, height: 140 } };
const version = (id, kind = 'image', extra = {}) => ({ id, assetId: `asset-${id}`, kind, uri: `media/${id}.${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'wav'}`, createdAt: now, metadata: { width: 1920, height: 1080 }, ...extra });
const node = (id, kind, payload) => ({ id, kind, title: id, ...shape, createdAt: now, payload });
const edge = (id, sourceNodeId, targetNodeId, role, extra = {}) => ({ id, sourceNodeId, targetNodeId, sourcePort: 'output', targetPort: role, role, order: 0, binding: 'followCurrent', ...extra });
const board = (nodes = [], edges = [], groups = []) => ({ ...createCanvasDocument({ id: 'board', projectId: 'source-project', now }), nodes, edges, groups });
const allocator = () => { let index = 0; return kind => `new-${kind}-${++index}`; };
const snapshot = { modelId: 'img', capabilityVersion: 'cap-v1', mode: 'textToImage', prompt: 'rain', resolvedInputs: [], parameters: {}, inputFingerprint: 'fixed' };

test('clipboard includes nodes and internal wires, strips execution/history state and retains media references', () => {
    const result = version('result', 'image', { snapshot, provenance: { jobId: 'paid-job', taskId: 'remote-task', sourceNodeId: 'external' } });
    const source = board([
        node('external', 'text', { text: 'external prompt' }),
        { ...node('image', 'imageGen', { mode: 'textToImage', modelId: 'img', prompt: 'rain', parameters: { aspectRatio: '16:9', job: { id: 'never-replay' }, nested: { status: 'running', strength: 0.5 }, taskId: 'remote' }, versions: [result], currentVersionId: result.id,
            job: { id: 'paid-job', status: 'running', idempotencyKey: 'paid-key' }, jobs: [{ idempotencyKey: 'paid-key', jobId: 'paid-job', snapshot, status: 'running', createdAt: now, updatedAt: now }] }), pinnedColors: ['red', 'cyan'], origin: { sceneId: 'source-scene' }, orphaned: true },
        node('video', 'videoGen', { mode: 'imageToVideo', modelId: 'vid', prompt: 'walk', parameters: { durationSeconds: 5 }, versions: [version('clip', 'video')], currentVersionId: 'clip' }),
    ], [edge('outside-wire', 'external', 'image', 'prompt'), edge('inside-wire', 'image', 'video', 'firstFrame', { binding: 'pinnedVersion', pinnedVersionId: result.id })]);
    assert.deepEqual(validateCanvasDocument(source), []);
    const before = structuredClone(source);
    const serialized = serializeCanvasClipboard(source, ['image', 'video']);
    const parsed = parseCanvasClipboard(serialized);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.clipboard.format, CANVAS_CLIPBOARD_FORMAT);
    assert.equal(parsed.clipboard.version, CANVAS_CLIPBOARD_VERSION);
    assert.deepEqual(parsed.clipboard.nodes.map(candidate => candidate.id), ['image', 'video']);
    assert.deepEqual(parsed.clipboard.edges.map(candidate => candidate.id), ['inside-wire']);
    const copied = parsed.clipboard.nodes[0];
    assert.equal(copied.payload.job, undefined);
    assert.equal(copied.payload.jobs, undefined);
    assert.deepEqual(copied.payload.parameters, { aspectRatio: '16:9', nested: { strength: 0.5 } });
    assert.equal(copied.origin, undefined);
    assert.equal(copied.orphaned, undefined);
    assert.equal(copied.payload.versions[0].snapshot, undefined);
    assert.equal(copied.payload.versions[0].provenance, undefined);
    assert.equal(copied.payload.versions[0].uri, result.uri);
    assert.equal(copied.payload.versions[0].assetId, result.assetId);
    assert.equal(copied.payload.versions[0].id, result.id);
    assert.deepEqual(copied.pinnedColors, ['red', 'cyan']);
    assert.deepEqual(source, before);
});

test('paste into a different project assigns new IDs, offsets positions and never recovers a paid job', () => {
    const source = board([
        node('picture', 'image', { versions: [version('frame')], currentVersionId: 'frame' }),
        node('video', 'videoGen', { mode: 'imageToVideo', modelId: 'vid', prompt: 'walk', parameters: {}, versions: [] }),
    ], [edge('wire', 'picture', 'video', 'firstFrame', { binding: 'pinnedVersion', pinnedVersionId: 'frame' })]);
    const target = createCanvasDocument({ id: 'other-board', projectId: 'other-project', now });
    const before = structuredClone(target);
    const pasted = pasteCanvasClipboard(target, serializeCanvasClipboard(source, ['picture', 'video']), { offset: { x: -20, y: 40 }, now: later, createId: allocator() });
    assert.equal(pasted.ok, true);
    assert.equal(pasted.canvas.projectId, 'other-project');
    assert.equal(pasted.canvas.id, 'other-board');
    assert.equal(pasted.canvas.revision, target.revision + 1);
    assert.equal(pasted.ids.length, 2);
    assert.ok(pasted.ids.every(id => !source.nodes.some(candidate => candidate.id === id)));
    assert.deepEqual(pasted.canvas.nodes[0].position, { x: 80, y: 240 });
    assert.equal(pasted.canvas.nodes[0].createdAt, later);
    assert.equal(pasted.canvas.nodes[0].payload.versions[0].createdAt, now);
    assert.deepEqual(pasted.canvas.edges[0], { ...source.edges[0], id: 'new-edge-3', sourceNodeId: pasted.idMap.picture, targetNodeId: pasted.idMap.video });
    assert.deepEqual(validateCanvasDocument(pasted.canvas), []);
    assert.deepEqual(target, before);
    const repeated = pasteCanvasClipboard(pasted.canvas, serializeCanvasClipboard(source, ['picture']), { createId: allocator() });
    assert.equal(repeated.ok, true);
    assert.ok(!pasted.ids.includes(repeated.ids[0]));
    assert.deepEqual(repeated.canvas.nodes.at(-1).position, { x: 140, y: 240 });
});

test('copying a group includes nested and parent-only descendants and remaps all group membership', () => {
    const source = board([
        node('leaf', 'text', { text: 'leaf' }),
        node('second', 'text', { text: 'second' }),
        node('inner-card', 'group', { groupId: 'inner' }),
        node('outer-card', 'group', { groupId: 'outer' }),
        node('parent-only-card', 'group', { groupId: 'parent-only' }),
        node('unselected', 'text', { text: 'outside' }),
    ], [], [
        { id: 'inner', title: 'Inner', nodeIds: ['leaf'], parentGroupId: 'outer' },
        { id: 'outer', title: 'Outer', nodeIds: ['inner-card'] },
        { id: 'parent-only', title: 'Parent-only', nodeIds: ['second'], parentGroupId: 'outer' },
    ]);
    const copied = parseCanvasClipboard(serializeCanvasClipboard(source, ['outer-card', 'leaf']));
    assert.equal(copied.ok, true);
    assert.deepEqual(copied.clipboard.nodes.map(candidate => candidate.id), ['leaf', 'second', 'inner-card', 'outer-card', 'parent-only-card']);
    assert.equal(copied.clipboard.groups.length, 3);
    const pasted = pasteCanvasClipboard(createCanvasDocument({ id: 'target', projectId: 'target', now }), copied.clipboard, { createId: allocator() });
    assert.equal(pasted.ok, true);
    const outer = pasted.canvas.groups.find(group => group.title === 'Outer');
    const inner = pasted.canvas.groups.find(group => group.title === 'Inner');
    const parentOnly = pasted.canvas.groups.find(group => group.title === 'Parent-only');
    assert.notEqual(outer.id, 'outer');
    assert.equal(inner.parentGroupId, outer.id);
    assert.equal(parentOnly.parentGroupId, outer.id);
    assert.deepEqual(outer.nodeIds, [pasted.idMap['inner-card']]);
    assert.deepEqual(inner.nodeIds, [pasted.idMap.leaf]);
    assert.equal(pasted.canvas.nodes.find(candidate => candidate.id === pasted.idMap['outer-card']).payload.groupId, outer.id);
    assert.deepEqual(validateCanvasDocument(pasted.canvas), []);
    const justInner = parseCanvasClipboard(serializeCanvasClipboard(source, ['inner-card']));
    assert.equal(justInner.clipboard.groups[0].parentGroupId, undefined);
    const justLeaf = parseCanvasClipboard(serializeCanvasClipboard(source, ['leaf']));
    assert.deepEqual(justLeaf.clipboard.groups, []);
});

test('clipboard supports every non-group node kind with new character, input, clip and track identities', () => {
    const source = board([
        node('text', 'text', { text: '# Story\n\nWords' }),
        node('image', 'image', { versions: [version('image-result')] }),
        node('video', 'video', { versions: [version('video-result', 'video')] }),
        node('audio', 'audio', { versions: [version('audio-result', 'audio')] }),
        node('image-gen', 'imageGen', { mode: 'imageToImage', modelId: 'img', prompt: 'paint', parameters: {}, versions: [], inputs: [{ id: 'input-id', role: 'referenceImage', order: 0, version: version('direct', 'image', { provenance: { jobId: 'old-job' } }) }] }),
        node('video-gen', 'videoGen', { mode: 'textToVideo', modelId: 'vid', prompt: 'walk', parameters: {}, versions: [] }),
        node('frame', 'frameExtract', { selection: { kind: 'time', timeMs: 123 }, versions: [version('still')] }),
        node('composition', 'composition', { versions: [version('output', 'video')], parameters: { frameRate: 24 }, clips: [{ id: 'clip-a', assetVersionId: 'video-result', trackId: 'track', startMs: 0, inMs: 0, outMs: 1000, volume: 1, muted: false }, { id: 'clip-b', assetVersionId: 'video-result', trackId: 'track', startMs: 1000, inMs: 0, outMs: 1000, volume: 0, muted: true }] }),
        node('character', 'character', { characterId: 'hero', description: 'A hero', appearance: 'blue hair', versions: [version('portrait')] }),
    ]);
    const pasted = pasteCanvasClipboard(createCanvasDocument({ id: 'target', projectId: 'target', now }), serializeCanvasClipboard(source, source.nodes.map(candidate => candidate.id)), { createId: allocator() });
    assert.equal(pasted.ok, true);
    assert.equal(pasted.canvas.nodes.length, 9);
    const input = pasted.canvas.nodes.find(candidate => candidate.kind === 'imageGen').payload.inputs[0];
    assert.notEqual(input.id, 'input-id');
    assert.equal(input.version.id, 'direct');
    assert.equal(input.version.provenance, undefined);
    const composition = pasted.canvas.nodes.find(candidate => candidate.kind === 'composition');
    assert.notEqual(composition.payload.clips[0].id, 'clip-a');
    assert.notEqual(composition.payload.clips[0].trackId, 'track');
    assert.equal(composition.payload.clips[0].trackId, composition.payload.clips[1].trackId);
    assert.equal(composition.payload.clips[0].assetVersionId, 'video-result');
    const character = pasted.canvas.nodes.find(candidate => candidate.kind === 'character');
    assert.notEqual(character.payload.characterId, 'hero');
    assert.equal(character.payload.versions[0].id, 'portrait');
    assert.equal(character.payload.description, 'A hero');
});

test('unfinished uploads do not become restored successful media results', () => {
    const source = board([node('image', 'image', { versions: [version('uploading', 'image', { uri: '', status: 'uploading' }), version('missing', 'image', { uri: '', status: 'missing' })], currentVersionId: 'uploading' })]);
    const parsed = parseCanvasClipboard(serializeCanvasClipboard(source, ['image']));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.clipboard.nodes[0].payload.versions, []);
    assert.equal(parsed.clipboard.nodes[0].payload.currentVersionId, undefined);
});

test('ordinary text, unrelated JSON, malformed payloads, credentials and unknown versions are refused', () => {
    const good = JSON.parse(serializeCanvasClipboard(board([node('text', 'text', { text: 'hello' })]), ['text']));
    for (const text of ['hello', '{', 'null', '[]', '{}', JSON.stringify(board())]) assert.equal(parseCanvasClipboard(text).code, 'CLIPBOARD_FORMAT');
    assert.equal(parseCanvasClipboard(JSON.stringify({ ...good, version: 2 })).code, 'CLIPBOARD_VERSION');
    assert.equal(parseCanvasClipboard(JSON.stringify({ ...good, nodes: [] })).code, 'CLIPBOARD_EMPTY');
    for (const bad of [{ ...good, nodes: [good.nodes[0], good.nodes[0]] }, { ...good, nodes: null }, { ...good, edges: [edge('wire', 'missing', 'text', 'prompt')] }, { ...good, nodes: [{ ...good.nodes[0], pinnedColors: ['unrecognized'] }] }, { ...good, nodes: [{ ...good.nodes[0], payload: { text: 'hello', apiKey: 'secret' } }] }]) {
        assert.equal(parseCanvasClipboard(JSON.stringify(bad)).code, 'CLIPBOARD_INVALID');
    }
    assert.throws(() => serializeCanvasClipboard(board(), []), /at least one node/);
});

test('paste failures leave the target intact, including invalid offsets and exhausted ID allocation', () => {
    const source = board([node('text', 'text', { text: 'hello' })]);
    const text = serializeCanvasClipboard(source, ['text']);
    const target = createCanvasDocument({ id: 'target', projectId: 'target', now });
    for (const options of [{ offset: { x: NaN, y: 0 } }, { now: 'invalid date' }, { createId: () => 'text' }]) {
        const result = pasteCanvasClipboard(target, text, options);
        assert.equal(result.ok, false);
        assert.equal(result.canvas, target);
        assert.equal(target.nodes.length, 0);
    }
    const unrelated = pasteCanvasClipboard(target, 'some selected text');
    assert.equal(unrelated.code, 'CLIPBOARD_FORMAT');
    assert.equal(unrelated.canvas, target);
});

test('clipboard rejects malformed scalar metadata rather than retaining hidden data inside media references', () => {
    const good = JSON.parse(serializeCanvasClipboard(board([node('image', 'image', { versions: [version('result')] })]), ['image']));
    for (const metadata of [{ mimeType: 123 }, { sha256: { taskId: 'old-run' } }, { hasAudio: 'yes' }]) {
        const malformed = structuredClone(good);
        malformed.nodes[0].payload.versions[0].metadata = metadata;
        const parsed = parseCanvasClipboard(JSON.stringify(malformed));
        assert.equal(parsed.ok, false);
        assert.equal(parsed.code, 'CLIPBOARD_INVALID');
        assert.ok(parsed.issues.some(issue => issue.code === 'METADATA_TYPE'));
        const target = createCanvasDocument({ id: 'target', projectId: 'target', now });
        const pasted = pasteCanvasClipboard(target, malformed);
        assert.equal(pasted.ok, false);
        assert.equal(pasted.canvas, target);
    }
});

// Different cards in the same project still refer to the same registered person.
test('copying a character to another canvas in the project preserves its registered identity', () => {
    const source = board([node('character-card', 'character', {characterId:'registered-hero',appearance:'blue hair',versions:[version('portrait')]})]);
    const target = createCanvasDocument({id:'second-canvas',projectId:source.projectId,now});
    const pasted = pasteCanvasClipboard(target, serializeCanvasClipboard(source,['character-card']), {createId:allocator()});
    assert.equal(pasted.ok,true);
    assert.notEqual(pasted.canvas.nodes[0].id,'character-card');
    assert.equal(pasted.canvas.nodes[0].payload.characterId,'registered-hero');
    assert.equal(pasted.canvas.nodes[0].payload.versions[0].assetId,'asset-portrait');
});
