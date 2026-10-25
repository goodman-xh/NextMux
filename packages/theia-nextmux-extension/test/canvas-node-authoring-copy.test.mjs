import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { sourceModule, comicCoreSource as core } from './helpers/comic-organizer-source-loader.mjs';
const require = createRequire(import.meta.url), { createStoryboard, applyCameraPreset } = require('@nextmux/comic-core/canvas-camera');
const { serializeCanvasClipboard: serialize, parseCanvasClipboard: parse, pasteCanvasClipboard: paste } = sourceModule('browser/nextmux-comic-canvas-clipboard.ts');
const { duplicateCanvasNodes: duplicate } = sourceModule('browser/nextmux-comic-canvas-logic.ts');
const { prepareCanvasDragCopy: prepare, commitCanvasDragCopy: commit } = sourceModule('browser/nextmux-comic-canvas-drag-copy.ts');
const { prepareCanvasTransfer: transfer } = sourceModule('browser/nextmux-comic-canvas-transfer.ts');
const { deriveCanvasCameraPrompt: derive } = sourceModule('browser/nextmux-comic-canvas-camera-state.ts');
const now = '2026-10-04T10:00:00.000Z';
const clear = { selection: { movements: [], speed: 'normal' }, prefix: '' };
const slow = { selection: { movements: [], speed: 'slow' }, prefix: '' };
const literal = '[Pan the camera to the left] authored note';
const managedKey = 'managed:fixed:8bfc1a90-87f5-434b-a24b-1e4e9670118c';
const ownKey = 'official:studio:minimax%2Fhailuo-3-max';
const node = id => ({ id, kind: 'videoGen', title: id, position: { x: 20, y: 30 }, size: { width: 280, height: 200 }, payload: {
    mode: 'textToVideo', modelId: 'fixture', prompt: literal, parameters: { durationSeconds: 5 },
    versions: [{ id: 'version-' + id, assetId: 'asset-' + id, kind: 'video', uri: 'media/' + id + '.mp4', createdAt: now }], currentVersionId: 'version-' + id
} });
function fixture() {
    const storyboard = createStoryboard(5);
    return { ...core.createCanvasDocument({ id: 'source', projectId: 'project', now }), nodes: ['clear', 'slow', 'outside'].map(node),
        settings: { unrelated: { preference: 7 }, nodeRoutes: { clear: managedKey, slow: ownKey, outside: 'managed:fixed:other' }, nodeCamera: { clear, slow, outside: slow }, nodeStoryboard: {
            clear: { ...storyboard, originalPrompt: 'recoverable text', shots: storyboard.shots.map(shot => ({ ...shot, camera: applyCameraPreset('gentle_rise'), foreground: 'A person' })) }
        } } };
}
const target = () => ({ ...core.createCanvasDocument({ id: 'target', projectId: 'project', now }), nodes: [node('existing')], settings: { unrelated: true, nodeCamera: { existing: slow } } });
const allocator = () => { let id = 0; return kind => `copied-${kind}-${++id}`; };

test('clipboard whitelists selected authoring state, maps owner IDs and keeps clear/speed-only meaning', () => {
    const source = fixture(), before = structuredClone(source), text = serialize(source, ['clear', 'slow']), copied = parse(text);
    assert.equal(copied.ok, true); assert.deepEqual(Object.keys(copied.clipboard.authoring).sort(), ['nodeCamera', 'nodeRoutes', 'nodeStoryboard']);
    assert.deepEqual(Object.keys(copied.clipboard.authoring.nodeCamera), ['clear', 'slow']);
    assert.equal(copied.clipboard.authoring.unrelated, undefined);
    const destination = target(), pasted = paste(destination, text, { now, createId: allocator() }); assert.equal(pasted.ok, true);
    assert.equal(pasted.canvas.settings.unrelated, true); assert.deepEqual(pasted.canvas.settings.nodeCamera.existing, slow);
    for (const id of ['clear', 'slow']) {
        const newId = pasted.idMap[id], current = pasted.canvas.nodes.find(value => value.id === newId);
        assert.notEqual(newId, id); assert.deepEqual(pasted.canvas.settings.nodeCamera[newId], source.settings.nodeCamera[id]);
        assert.equal(pasted.canvas.settings.nodeRoutes[newId], source.settings.nodeRoutes[id]);
        assert.equal(derive(current.payload.prompt, pasted.canvas.settings.nodeCamera[newId]).body, literal);
    }
    assert.equal(pasted.canvas.settings.nodeCamera.clear, undefined); assert.equal(pasted.canvas.settings.nodeRoutes.clear, undefined);
    assert.deepEqual(pasted.canvas.settings.nodeStoryboard[pasted.idMap.clear], source.settings.nodeStoryboard.clear);
    assert.notEqual(pasted.canvas.settings.nodeStoryboard[pasted.idMap.clear], source.settings.nodeStoryboard.clear);
    assert.notEqual(pasted.canvas.settings.nodeStoryboard[pasted.idMap.clear].shots[0], source.settings.nodeStoryboard.clear.shots[0]);
    assert.deepEqual(source, before); assert.deepEqual(core.validateCanvasDocument(pasted.canvas), []);
});

test('old clipboards still paste, unknown settings are omitted and invalid/secret metadata is refused atomically', () => {
    const raw = JSON.parse(serialize(fixture(), ['clear'])), legacy = structuredClone(raw); delete legacy.authoring;
    const legacyResult = paste(target(), legacy); assert.equal(legacyResult.ok, true); assert.equal(legacyResult.canvas.settings.nodeRoutes, undefined);
    const unknown = structuredClone(raw); unknown.authoring.otherSettings = { runId: 'do-not-copy' }; unknown.authoring.nodeCamera.clear.progress = 10;
    unknown.authoring.nodeStoryboard.clear.shots[0].jobId = 'do-not-copy';
    const clean = parse(JSON.stringify(unknown)); assert.equal(clean.ok, true);
    assert.equal(clean.clipboard.authoring.otherSettings, undefined); assert.equal(clean.clipboard.authoring.nodeCamera.clear.progress, undefined);
    assert.equal(clean.clipboard.authoring.nodeStoryboard.clear.shots[0].jobId, undefined);
    for (const update of [value => { value.authoring.nodeCamera.clear.selection.speed = 'invalid'; }, value => { value.authoring.nodeCamera.clear.prefix = {}; },
        value => { value.authoring.nodeStoryboard.clear.shots = null; }, value => { value.authoring.nodeCamera.clear.credentials = 'never-transfer'; }, value => { value.authoring = null; },
        ...['', '  ', 'route\nkey', 'r'.repeat(4097), { connectionId: 'studio' }, { credentials: 'never-transfer' }, null].map(key => value => { value.authoring.nodeRoutes.clear = key; })]) {
        const bad = structuredClone(raw); update(bad); const original = target(), result = paste(original, bad);
        assert.equal(result.ok, false); assert.equal(result.code, 'CLIPBOARD_INVALID'); assert.equal(result.canvas, original);
    }
});

test('duplicate and both Alt drag modes preserve metadata and merge concurrent unrelated settings', () => {
    const source = fixture(), duplicateResult = duplicate(source, ['clear', 'slow'], { x: 40, y: 40 }, now);
    for (const [index, id] of ['clear', 'slow'].entries()) assert.deepEqual(duplicateResult.canvas.settings.nodeCamera[duplicateResult.ids[index]], source.settings.nodeCamera[id]);
    assert.deepEqual(duplicateResult.canvas.settings.nodeStoryboard[duplicateResult.ids[0]], source.settings.nodeStoryboard.clear);
    for (const [index, id] of ['clear', 'slow'].entries()) assert.equal(duplicateResult.canvas.settings.nodeRoutes[duplicateResult.ids[index]], source.settings.nodeRoutes[id]);
    for (const keepInputs of [false, true]) {
        const prepared = prepare(source, ['clear', 'slow'], keepInputs, now); assert.equal(prepared.ok, true);
        const changed = { ...source, settings: { ...source.settings, concurrent: true, nodeCamera: { ...source.settings.nodeCamera, outside: clear }, nodeRoutes: { ...source.settings.nodeRoutes, outside: 'official:changed' } } };
        const merged = commit(changed, prepared.plan, { x: 30, y: 50 }, now); assert.equal(merged.ok, true);
        assert.equal(merged.canvas.settings.concurrent, true); assert.deepEqual(merged.canvas.settings.nodeCamera.outside, clear);
        assert.equal(merged.canvas.settings.nodeRoutes.outside, 'official:changed');
        for (const [index, id] of ['clear', 'slow'].entries()) assert.deepEqual(merged.canvas.settings.nodeCamera[merged.ids[index]], source.settings.nodeCamera[id]);
        for (const [index, id] of ['clear', 'slow'].entries()) assert.equal(merged.canvas.settings.nodeRoutes[merged.ids[index]], source.settings.nodeRoutes[id]);
        assert.deepEqual(merged.canvas.settings.nodeStoryboard[merged.ids[0]], source.settings.nodeStoryboard.clear);
    }
});

test('cross-canvas retry recognizes authoring metadata and preserves the source if a prior copy changed', () => {
    const source = fixture(), destination = target(), request = { requestId: 'authoring-copy-123', createdAt: now, sourceId: source.id, targetId: destination.id, nodeIds: ['clear'], mode: 'move' };
    const prepared = transfer(source, destination, request); assert.equal(prepared.alreadySaved, false);
    const id = prepared.ids[0]; assert.deepEqual(prepared.document.settings.nodeCamera[id], clear);
    assert.equal(prepared.document.settings.nodeRoutes[id], managedKey);
    assert.equal(transfer(source, prepared.document, request).alreadySaved, true);
    const edited = { ...prepared.document, settings: { ...prepared.document.settings, nodeCamera: { ...prepared.document.settings.nodeCamera, [id]: slow } } };
    assert.throws(() => transfer(source, edited, request), error => error.code === 'CANVAS_TRANSFER_CONFLICT');
    const changedStory = structuredClone(prepared.document); changedStory.settings.nodeStoryboard[id].guidance.push('Changed later');
    assert.throws(() => transfer(source, changedStory, request), error => error.code === 'CANVAS_TRANSFER_CONFLICT');
    const changedRoute = structuredClone(prepared.document); changedRoute.settings.nodeRoutes[id] = ownKey;
    assert.throws(() => transfer(source, changedRoute, request), error => error.code === 'CANVAS_TRANSFER_CONFLICT');
});

test('same and cross-project clipboard paste preserve exact image/video route keys without copying descriptors', () => {
    const source = fixture(); source.nodes.push({ ...node('image'), kind: 'imageGen', payload: { mode: 'textToImage', modelId: 'image-model', prompt: 'Image', parameters: {}, versions: [] } });
    source.settings.nodeRoutes.image = 'official:studio:image%2Fmodel';
    source.settings.connectionDescriptors = { provider: 'not-portable' };
    const text = serialize(source, ['clear', 'slow', 'image']), raw = JSON.parse(text);
    assert.deepEqual(Object.keys(raw.authoring.nodeRoutes), ['clear', 'slow', 'image']);
    assert.equal(raw.authoring.connectionDescriptors, undefined);
    for (const projectId of ['project', 'different-project']) {
        const destination = { ...target(), projectId, settings: { nodeRoutes: { existing: 'official:existing' } } };
        const pasted = paste(destination, text, { now, createId: allocator() }); assert.equal(pasted.ok, true);
        assert.equal(pasted.canvas.settings.nodeRoutes.existing, 'official:existing');
        for (const id of ['clear', 'slow', 'image']) assert.equal(pasted.canvas.settings.nodeRoutes[pasted.idMap[id]], source.settings.nodeRoutes[id]);
    }
    const maximum = structuredClone(raw); maximum.authoring.nodeRoutes.clear = 'r'.repeat(4096);
    assert.equal(parse(JSON.stringify(maximum)).ok, true, 'a bounded opaque legacy key remains valid without requiring a known provider');
});
