import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCanvasDocument, applyCanvasCommand, validateCanvasDocument, resolveCanvasInputs } from '@nextmux/comic-core/canvas';
import { SCENE_POSES, SCENE_PROPS, SCENE_CAMERAS, SCENE_TEMPLATES, SCENE_BODY_TYPES, JOINT_RANGES } from '@nextmux/comic-core/director-catalogue';
import { createSceneDocument, createSceneObject, captureSceneKeyframe } from '@nextmux/comic-core/director-scene';
import { directorText, DIRECTOR_COPY, DIRECTOR_LOCALES } from '../lib/browser/nextmux-comic-director-text.js';
import { directorCatalogueText } from '../lib/browser/nextmux-comic-director-catalogue-text.js';
import { directorImportMime, withDirectorBlobUpload, DIRECTOR_UPLOAD_CHUNK_BYTES } from '../lib/browser/nextmux-comic-director-transfer.js';
import { createCanvasNode, canvasKindIcon, canvasOutputKind, canvasConnectTargets, connectCanvasNodes } from '../lib/browser/nextmux-comic-canvas-logic.js';
import { serializeCanvasClipboard, pasteCanvasClipboard } from '../lib/browser/nextmux-comic-canvas-clipboard.js';
import { normalizeDirectorScene } from '../lib/browser/nextmux-comic-director-validation.js';

test('director controls and every catalogue/joint label have all twelve translations', () => {
    assert.equal(DIRECTOR_LOCALES.length, 12);
    for (const [key, row] of Object.entries(DIRECTOR_COPY)) {
        assert.equal(row.length, 12, key);
        for (const locale of DIRECTOR_LOCALES) assert.ok(directorText(locale, key).trim() && directorText(locale, key) !== key, `${locale}:${key}`);
    }
    const lists = { pose: SCENE_POSES, prop: SCENE_PROPS, camera: SCENE_CAMERAS, template: SCENE_TEMPLATES, body: SCENE_BODY_TYPES,
        joint: Object.keys(JOINT_RANGES).map(id => ({ id })), axis: [...new Set(Object.values(JOINT_RANGES).flatMap(axes => Object.keys(axes)))].map(id => ({ id })) };
    for (const [category, items] of Object.entries(lists)) for (const item of items) for (const locale of DIRECTOR_LOCALES) {
        const text = directorCatalogueText(locale, category, item.id);
        assert.ok(text && text !== item.id, `${locale}:${category}:${item.id}`);
    }
    assert.equal(directorText('en-US', 'stage'), directorText('en', 'stage'));
    assert.equal(directorText('zh-Hant', 'save'), directorText('zh-TW', 'save'));
});

test('new node creators are valid, accept owned image references and export selected captures downstream', () => {
    const now = '2026-10-01T00:00:00Z';
    let canvas = createCanvasDocument({ id: 'director-ui', projectId: 'p', now });
    const add = node => { canvas = applyCanvasCommand(canvas, { type: 'node.add', node }, { now }); return node; };
    const image = add({ id: 'image', title: 'Board image', kind: 'image', position: { x: 0, y: 0 }, size: { width: 280, height: 280 }, payload: {
        versions: [{ id: 'input', assetId: 'input', kind: 'image', uri: 'nextmux.media/input.png', createdAt: now }], currentVersionId: 'input' } });
    for (const kind of ['sceneComposer', 'world']) {
        const node = add(createCanvasNode(kind, { x: 0, y: 400 }, { title: kind }));
        assert.ok(canvasKindIcon(kind));
        const result = connectCanvasNodes(canvas, image.id, node.id, now);
        assert.equal(result.error, undefined);
        canvas = result.canvas;
        assert.equal(resolveCanvasInputs(canvas, node.id).inputs[0].uri, 'nextmux.media/input.png');
        assert.equal(canvasOutputKind(node), 'image');
        assert.ok(canvasConnectTargets('image').includes(kind));
        canvas = applyCanvasCommand(canvas, { type: 'node.addVersion', nodeId: node.id, version: { id: `${kind}-video`, assetId: `${kind}-video`, kind: 'video', uri: 'nextmux.media/capture.mp4', createdAt: now }, select: true }, { now });
        assert.equal(canvasOutputKind(canvas.nodes.find(item => item.id === node.id)), 'video');
    }
    assert.deepEqual(validateCanvasDocument(canvas), []);
});

test('director transport uses model MIME and the component protects IME/canvas shortcuts and disposes recording', () => {
    assert.equal(directorImportMime('SCENE.GLB', ''), 'model/gltf-binary');
    assert.equal(directorImportMime('scene.gltf', ''), 'model/gltf+json');
    assert.equal(directorImportMime('world.spz', ''), 'application/octet-stream');
    const component = readFileSync(new URL('../src/browser/nextmux-comic-director.tsx', import.meta.url), 'utf8');
    assert.ok(component.includes('ImeInput') && component.includes('ImeTextarea'));
    assert.ok(component.includes('event.nativeEvent.isComposing'));
    assert.ok(component.includes('event.stopPropagation()'));
    assert.ok(component.includes('recorder.current?.abort()'));
    assert.ok(component.includes('runtime.current?.dispose()'));
    assert.ok(component.includes('document.body'));
    const canvas = readFileSync(new URL('../src/browser/nextmux-comic-canvas.tsx', import.meta.url), 'utf8');
    assert.ok(canvas.includes('if (director) return false;'));
    assert.ok(canvas.includes('resolveCanvasInputs(canvas, node.id)'));
});

test('director upload streams bounded chunks and consumes only the staged identifier', async () => {
    const previous = globalThis.FileReader;
    globalThis.FileReader = class {
        readAsDataURL(blob) { void blob.arrayBuffer().then(buffer => { this.result = `data:application/octet-stream;base64,${Buffer.from(buffer).toString('base64')}`; this.onload(); }); }
    };
    try {
        const bytes = Buffer.alloc(DIRECTOR_UPLOAD_CHUNK_BYTES * 2 + 17, 37), blob = new Blob([bytes]);
        const parts = [], calls = []; let stagedId;
        const transport = {
            async beginComicDirectorUpload(request) { assert.equal(request.byteLength, blob.size); stagedId = request.uploadId; assert.ok(stagedId); calls.push('begin'); return { uploadId: stagedId, offset: 0, byteLength: blob.size }; },
            async appendComicDirectorUpload(request) {
                assert.equal(request.uploadId, stagedId); assert.equal(request.offset, parts.reduce((sum, part) => sum + part.length, 0));
                const part = Buffer.from(request.dataBase64, 'base64'); assert.ok(part.length <= DIRECTOR_UPLOAD_CHUNK_BYTES); parts.push(part); calls.push('append');
                return { uploadId: stagedId, offset: request.offset + part.length, byteLength: blob.size };
            },
            async discardComicDirectorUpload(request) { assert.equal(request.uploadId, stagedId); calls.push('discard'); }
        };
        const result = await withDirectorBlobUpload(blob, { workspaceRoot: '/project', purpose: 'model', mimeType: 'model/gltf-binary', name: 'scene.glb' }, transport,
            async uploadId => { assert.equal(uploadId, stagedId); assert.deepEqual(Buffer.concat(parts), bytes); calls.push('consume'); return 'saved'; });
        assert.equal(result, 'saved'); assert.deepEqual(calls, ['begin', 'append', 'append', 'append', 'consume', 'discard']);
    } finally { if (previous === undefined) delete globalThis.FileReader; else globalThis.FileReader = previous; }
});

test('director upload cleans staging after invalid acknowledgements and failed final RPC', async () => {
    const previous = globalThis.FileReader;
    globalThis.FileReader = class {
        readAsDataURL(blob) { void blob.arrayBuffer().then(buffer => { this.result = `data:application/octet-stream;base64,${Buffer.from(buffer).toString('base64')}`; this.onload(); }); }
    };
    try {
        for (const corruptOffset of [true, false]) {
            let discarded = 0, consumed = false, stagedId;
            const transport = {
                async beginComicDirectorUpload(request) { stagedId = request.uploadId; return { uploadId: stagedId, offset: 0, byteLength: 1 }; },
                async appendComicDirectorUpload() { return { uploadId: stagedId, offset: corruptOffset ? 0 : 1, byteLength: 1 }; },
                async discardComicDirectorUpload() { discarded++; }
            };
            await assert.rejects(withDirectorBlobUpload(new Blob(['a']), { workspaceRoot: '/project', purpose: 'capture', mimeType: 'image/png' }, transport,
                async () => { consumed = true; throw new Error('FINAL_RPC_FAILED'); }), corruptOffset ? { code: 'DIRECTOR_UPLOAD_INVALID' } : /FINAL_RPC_FAILED/);
            assert.equal(discarded, 1); assert.equal(consumed, !corruptOffset);
        }
    } finally { if (previous === undefined) delete globalThis.FileReader; else globalThis.FileReader = previous; }
});

test('director upload can clean a stage whose begin response was lost', async () => {
    let createdId, discardedId;
    await assert.rejects(withDirectorBlobUpload(new Blob(['a']), { workspaceRoot: '/project', purpose: 'capture', mimeType: 'image/png' }, {
        async beginComicDirectorUpload(request) { createdId = request.uploadId; throw new Error('RESPONSE_LOST'); },
        async appendComicDirectorUpload() { assert.fail('should not append after failed begin'); },
        async discardComicDirectorUpload(request) { discardedId = request.uploadId; }
    }, async () => assert.fail('should not consume after failed begin')), /RESPONSE_LOST/);
    assert.ok(createdId); assert.equal(discardedId, createdId);
});

test('copying director and world nodes preserves their authoring documents', () => {
    const object = createSceneObject('camera', 'camera');
    const scene = { ...createSceneDocument(), objects: [object], keys: [captureSceneKeyframe(object, 0, 'key')] };
    const stage = createCanvasNode('sceneComposer', { x: 0, y: 0 }, { title: 'Stage' });
    const world = createCanvasNode('world', { x: 400, y: 0 }, { title: 'World' });
    stage.payload.scene = scene;
    world.payload.world = { ...world.payload.world, kind: 'model', format: 'glb', uri: 'nextmux.media/director-models/world.glb', scene };
    const source = { ...createCanvasDocument({ id: 'source', projectId: 'project' }), nodes: [stage, world] };
    const result = pasteCanvasClipboard(createCanvasDocument({ id: 'target', projectId: 'project' }), serializeCanvasClipboard(source, [stage.id, world.id]));
    assert.equal(result.ok, true);
    assert.deepEqual(result.canvas.nodes.find(node => node.kind === 'sceneComposer').payload.scene, scene);
    assert.deepEqual(result.canvas.nodes.find(node => node.kind === 'world').payload.world, world.payload.world);
    assert.deepEqual(validateCanvasDocument(result.canvas), []);
});

test('director JSON rejects unsupported primitive IDs before mutating the scene', () => {
    const scene = { ...createSceneDocument(), objects: [createSceneObject('prop', 'prop', { assetId: 'unavailable-model' })] };
    const before = structuredClone(scene);
    assert.throws(() => normalizeDirectorScene(scene), { code: 'DIRECTOR_PROP_UNSUPPORTED' });
    assert.deepEqual(scene, before);
    assert.deepEqual(normalizeDirectorScene({ ...scene, objects: SCENE_PROPS.map(prop => createSceneObject('prop', prop.id, { assetId: prop.id })) }).objects.map(object => object.assetId), SCENE_PROPS.map(prop => prop.id));
});
