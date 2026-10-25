import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceModule, comicCoreSource as core } from './helpers/comic-organizer-source-loader.mjs';
const { canvasLibraryReferenceRoles: roles, removeCanvasDirectReference: remove } = sourceModule('browser/nextmux-comic-canvas-reference-inputs.ts');
const { connectCanvasNodes, createCanvasNode } = sourceModule('browser/nextmux-comic-canvas-logic.ts');
const { comicAssetLibraryText: text } = sourceModule('browser/nextmux-comic-asset-library-text.ts');
const now = '2026-10-03T00:00:00Z';
const version = id => ({ id, assetId: id, uri: `${id}.png`, kind: 'image', createdAt: now, metadata: { width: 512, height: 768, mimeType: 'image/png' } });
const node = mode => ({ ...createCanvasNode(mode.endsWith('Image') ? 'imageGen' : 'videoGen', { x: 0, y: 0 }, { title: 'Target' }), id: 'target', payload: { mode, modelId: 'm', capabilityVersion: '1', prompt: 'go', parameters: {}, versions: [] } });
const ref = { supported: true, maxCount: 3 };
test('library input choices use proven adapter modes and media rules, including text-to-reference transitions', () => {
    assert.deepEqual(roles(node('textToVideo')), []);
    assert.deepEqual(roles(node('textToVideo'), { modes: [{ mode: 'textToVideo' }] }), []);
    const model = { modes: [{ mode: 'textToVideo' }, { mode: 'imageToVideo', firstFrame: true }, { mode: 'referenceToVideo', referenceRules: { image: ref, video: ref, audio: { supported: false, maxCount: 0 } } }] };
    assert.deepEqual(roles(node('textToVideo'), model), ['firstFrame', 'referenceImage', 'referenceVideo']);
    assert.deepEqual(roles(node('imageToVideo'), model), ['firstFrame']);
    assert.deepEqual(roles(node('referenceToVideo'), model), ['referenceImage', 'referenceVideo']);
    assert.deepEqual(roles(node('textToImage'), { modes: [{ mode: 'imageToImage', referenceRules: { image: ref } }] }), ['referenceImage']);
    assert.deepEqual(roles(node('textToImage'), { modes: [{ mode: 'textToImage' }] }), []);
    assert.deepEqual(roles(node('videoEdit'), { modes: [{ mode: 'videoEdit', referenceRules: { video: ref } }] }), ['referenceVideo']);
    assert.deepEqual(roles(node('videoExtend'), { modes: [{ mode: 'videoExtend', referenceRules: { image: { ...ref, maxCount: 0 }, video: ref } }] }), ['referenceVideo']);
});
test('first/last frame input stays in its chosen mode and cannot form a generation snapshot before both frames exist', () => {
    let canvas = { ...core.createCanvasDocument({ id: 'c', projectId: 'p', now }), nodes: [node('firstLastFrame'), ...['a', 'b'].map(id => ({ id, kind: 'image', title: id, position: { x: 0, y: 0 }, size: { width: 200, height: 200 }, payload: { versions: [version(id)], currentVersionId: id } }))] };
    canvas = connectCanvasNodes(canvas, 'a', 'target', now, 'firstFrame').canvas;
    assert.equal(canvas.nodes[0].payload.mode, 'firstLastFrame');
    assert.ok(core.resolveCanvasInputs(canvas, 'target').missing.some(input => input.role === 'lastFrame'));
    assert.throws(() => core.createGenerationSnapshot(canvas, 'target', { capabilityVersion: '1' }), /unavailable/);
    canvas = connectCanvasNodes(canvas, 'b', 'target', now, 'lastFrame').canvas;
    assert.equal(canvas.nodes[0].payload.mode, 'firstLastFrame');
    assert.deepEqual(core.resolveCanvasInputs(canvas, 'target').missing, []);
    assert.equal(core.createGenerationSnapshot(canvas, 'target', { capabilityVersion: '1' }).resolvedInputs.length, 2);
});
test('removing a direct reference preserves other input versions, metadata and the selected mode', () => {
    const target = node('firstLastFrame'); target.payload.inputs = ['a', 'b'].map((id, i) => ({ id, role: i ? 'lastFrame' : 'firstFrame', order: 0, version: version(id) }));
    const canvas = { ...core.createCanvasDocument({ id: 'c', projectId: 'p', now }), nodes: [target] };
    const next = remove(canvas, 'target', 'a', now);
    assert.equal(next.nodes[0].payload.mode, 'firstLastFrame');
    assert.deepEqual(next.nodes[0].payload.inputs, [target.payload.inputs[1]]);
    assert.equal(canvas.nodes[0].payload.inputs.length, 2);
    assert.equal(next.revision, canvas.revision + 1);
    assert.equal(remove(next, 'target', 'missing', now), next);
});
test('new reference messages exist in all twelve supported languages', () => {
    for (const locale of ['zh-CN','en','zh-TW','ja','ko','es','fr','de','pt-BR','ru','ar','hi']) for (const key of ['useInput','noReference','referenceAdded','mediaType','mediaTypeUnknown','usageCategory','usageBulk']) assert.notEqual(text(locale, key), key);
});
