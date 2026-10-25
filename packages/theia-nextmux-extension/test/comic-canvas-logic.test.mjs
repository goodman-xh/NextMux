import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCanvasCommand, createCanvasDocument, createGenerationSnapshot } from '@nextmux/comic-core/canvas';
import { sourceModule } from './helpers/comic-organizer-source-loader.mjs';
const {
    CANVAS_DEFAULT_SIZE, canvasNodeBusy, canvasPendingUpstream, canvasRunOrder, connectCanvasNodes, createCanvasNode, deleteFromCanvas, duplicateCanvasNodes, placeCanvasNode,
    planCanvasConnection, rebaseCanvas, rerouteCanvasEdge, switchCanvasMode
} = sourceModule('browser/nextmux-comic-canvas-logic.ts');
import { canvasIssueText, canvasText, COMIC_CANVAS_LOCALES } from '../lib/browser/nextmux-comic-canvas-text.js';
import { COMIC_DESK_LOCALES } from '../lib/browser/nextmux-comic-desk.js';

const now = '2026-10-01T00:00:00.000Z';
const version = (id, kind = 'image') => ({ id, assetId: `asset-${id}`, kind, uri: `media/${id}.${kind === 'image' ? 'png' : 'mp4'}`, createdAt: now });

function board() {
    let canvas = createCanvasDocument({ id: 'canvas-1', projectId: 'project-1', now });
    const add = node => { canvas = applyCanvasCommand(canvas, { type: 'node.add', node }, { now }); return node.id; };
    const story = add({ ...createCanvasNode('imageGen', { x: 0, y: 0 }, { title: 'story', imageModelId: 'img' }), id: 'story' });
    const other = add({ ...createCanvasNode('imageGen', { x: 0, y: 400 }, { title: 'other', imageModelId: 'img' }), id: 'other' });
    const clip = add({ ...createCanvasNode('videoGen', { x: 400, y: 0 }, { title: 'clip', videoModelId: 'vid', aspectRatio: '9:16', durationSeconds: 5 }), id: 'clip' });
    const text = add({ id: 'text', kind: 'text', title: 'text', position: { x: -400, y: 0 }, size: { width: 280, height: 280 }, payload: { text: 'rain' } });
    const hero = add({ id: 'hero', kind: 'character', title: '林澈', position: { x: -400, y: 400 }, size: { width: 280, height: 280 },
        payload: { characterId: 'c1', versions: [version('portrait')], currentVersionId: 'portrait' } });
    return { canvas, story, other, clip, text, hero };
}

test('a picture wired into a text-to-video node becomes its first frame, a second one its last frame', () => {
    const { canvas, story, other, clip } = board();
    assert.deepEqual(planCanvasConnection(canvas, story, clip), { role: 'firstFrame', mode: 'imageToVideo' });
    const first = connectCanvasNodes(canvas, story, clip, now);
    assert.equal(first.error, undefined);
    assert.equal(first.canvas.nodes.find(node => node.id === clip).payload.mode, 'imageToVideo');
    assert.deepEqual(planCanvasConnection(first.canvas, other, clip), { role: 'lastFrame', mode: 'firstLastFrame' });
    const second = connectCanvasNodes(first.canvas, other, clip, now);
    assert.equal(second.canvas.nodes.find(node => node.id === clip).payload.mode, 'firstLastFrame');
    assert.deepEqual(second.canvas.edges.map(edge => edge.role).sort(), ['firstFrame', 'lastFrame']);
});

test('text feeds the prompt, a portrait becomes a reference picture, a clip cannot feed a picture node', () => {
    const { canvas, story, clip, text, hero } = board();
    assert.deepEqual(planCanvasConnection(canvas, text, story), { role: 'prompt' });
    assert.deepEqual(planCanvasConnection(canvas, hero, story), { role: 'referenceImage', mode: 'imageToImage' });
    // A first-frame clip keeps its frame and gets the character as notes rather than switching modes.
    const framed = connectCanvasNodes(canvas, story, clip, now).canvas;
    assert.deepEqual(planCanvasConnection(framed, hero, clip), { role: 'character' });
    assert.equal(planCanvasConnection(canvas, clip, story), undefined);
    assert.equal(planCanvasConnection(canvas, story, story), undefined);
});

test('re-roling a first frame as a reference switches the clip to reference mode; removing the last picture relaxes it', () => {
    const { canvas, story, clip } = board();
    const wired = connectCanvasNodes(canvas, story, clip, now).canvas;
    const edge = wired.edges[0];
    const rerouted = rerouteCanvasEdge(wired, edge.id, 'referenceImage', now);
    assert.equal(rerouted.error, undefined);
    assert.equal(rerouted.canvas.nodes.find(node => node.id === clip).payload.mode, 'referenceToVideo');
    assert.deepEqual(rerouted.canvas.edges.map(item => item.role), ['referenceImage']);
    const back = rerouteCanvasEdge(rerouted.canvas, rerouted.canvas.edges[0].id, 'firstFrame', now).canvas;
    assert.equal(back.nodes.find(node => node.id === clip).payload.mode, 'imageToVideo');
    const removed = deleteFromCanvas(back, [], [back.edges[0].id], now);
    assert.equal(removed.nodes.find(node => node.id === clip).payload.mode, 'textToVideo');
    assert.equal(removed.edges.length, 0);
});

test('switching mode carries wires over where the meaning holds and reports the rest', () => {
    const { canvas, story, other, clip } = board();
    const both = connectCanvasNodes(connectCanvasNodes(canvas, story, clip, now).canvas, other, clip, now).canvas;
    const reference = switchCanvasMode(both, clip, 'referenceToVideo', now);
    assert.deepEqual(reference.canvas.edges.map(edge => edge.role).sort(), ['referenceImage', 'referenceImage']);
    assert.equal(reference.dropped.length, 0);
    const text = switchCanvasMode(both, clip, 'textToVideo', now);
    assert.equal(text.canvas.edges.length, 0);
    assert.equal(text.dropped.length, 2);
});

test('duplicates keep inputs and results but never a running job', () => {
    const { canvas, story, clip, text } = board();
    let wired = connectCanvasNodes(canvas, story, clip, now).canvas;
    wired = applyCanvasCommand(wired, { type: 'node.addVersion', nodeId: story, version: version('first-frame'), select: true }, { now });
    wired = connectCanvasNodes(wired, text, clip, now).canvas;
    const snapshot = createGenerationSnapshot(wired, clip, { capabilityVersion: 'fixture-cap-v1' });
    wired = { ...wired, nodes: wired.nodes.map(node => node.id === clip ? { ...node, payload: { ...node.payload, versions: [version('v1', 'video')], currentVersionId: 'v1',
        jobs: [{ idempotencyKey: 'k', status: 'running', snapshot, createdAt: now, updatedAt: now }] } } : node) };
    const copy = duplicateCanvasNodes(wired, [clip], { x: 40, y: 40 }, now);
    assert.equal(copy.ids.length, 1);
    const node = copy.canvas.nodes.find(item => item.id === copy.ids[0]);
    assert.equal(node.payload.jobs, undefined);
    assert.equal(node.payload.currentVersionId, 'v1');
    assert.deepEqual(node.position, { x: 440, y: 40 });
    assert.ok(copy.canvas.edges.some(edge => edge.targetNodeId === node.id && edge.sourceNodeId === story && edge.role === 'firstFrame'));
});

test('a rebase keeps the user\'s edits and takes the service\'s results, jobs and added nodes', () => {
    const { canvas: base, story, clip } = board();
    // The user moved the clip, edited the story prompt and deleted the text node.
    let local = applyCanvasCommand(base, { type: 'node.move', nodeId: clip, position: { x: 900, y: 50 } }, { now });
    local = applyCanvasCommand(local, { type: 'node.setParameters', nodeId: story, parameters: {}, prompt: 'new prompt' }, { now });
    local = applyCanvasCommand(local, { type: 'node.delete', nodeIds: ['text'] }, { now });
    // Meanwhile a result arrived for the story node, and an import added a node.
    let server = applyCanvasCommand(base, { type: 'node.addVersion', nodeId: story, version: version('result'), select: true }, { now });
    server = applyCanvasCommand(server, { type: 'node.add', node: { id: 'imported', kind: 'image', title: 'imported', position: { x: 0, y: 900 }, size: { width: 280, height: 280 },
        payload: { versions: [version('imported')], currentVersionId: 'imported' } } }, { now });
    const merged = rebaseCanvas(local, base, server);
    const storyNode = merged.nodes.find(node => node.id === story);
    assert.equal(storyNode.payload.prompt, 'new prompt');
    assert.equal(storyNode.payload.currentVersionId, 'result');
    assert.deepEqual(merged.nodes.find(node => node.id === clip).position, { x: 900, y: 50 });
    assert.ok(!merged.nodes.some(node => node.id === 'text'));
    assert.ok(merged.nodes.some(node => node.id === 'imported'));
    assert.equal(merged.revision, server.revision);
});

test('a version the user picked locally is not overridden by an arriving result', () => {
    let { canvas: base, story } = board();
    base = applyCanvasCommand(base, { type: 'node.addVersion', nodeId: story, version: version('a'), select: true }, { now });
    base = applyCanvasCommand(base, { type: 'node.addVersion', nodeId: story, version: version('b'), select: true }, { now });
    const local = applyCanvasCommand(base, { type: 'node.selectVersion', nodeId: story, versionId: 'a' }, { now });
    const server = applyCanvasCommand(base, { type: 'node.addVersion', nodeId: story, version: version('c'), select: true }, { now });
    const merged = rebaseCanvas(local, base, server).nodes.find(node => node.id === story);
    assert.equal(merged.payload.currentVersionId, 'a');
    assert.deepEqual(merged.payload.versions.map(item => item.id), ['a', 'b', 'c']);
});

test('runs go upstream first, and a clip waits for a storyboard without a result', () => {
    const { canvas, story, clip } = board();
    const wired = connectCanvasNodes(canvas, story, clip, now).canvas;
    assert.deepEqual(canvasRunOrder(wired, [clip, story]), [story, clip]);
    assert.deepEqual(canvasPendingUpstream(wired, clip), [story]);
    const done = applyCanvasCommand(wired, { type: 'node.addVersion', nodeId: story, version: version('frame'), select: true }, { now });
    assert.deepEqual(canvasPendingUpstream(done, clip), []);
});

test('order and waiting follow inputs through a frame extract (video A → frame → video C), and busy means any active job', () => {
    let { canvas, clip } = board();
    const add = node => { canvas = applyCanvasCommand(canvas, { type: 'node.add', node }, { now }); return node.id; };
    const source = add({ ...createCanvasNode('videoGen', { x: -800, y: 800 }, { title: 'source', videoModelId: 'vid', aspectRatio: '9:16', durationSeconds: 5 }), id: 'source' });
    const frame = add({ ...createCanvasNode('frameExtract', { x: -400, y: 800 }, { title: 'frame' }), id: 'frame' });
    let wired = connectCanvasNodes(canvas, source, frame, now);
    assert.equal(wired.error, undefined);
    wired = connectCanvasNodes(wired.canvas, frame, clip, now);
    assert.equal(wired.error, undefined);
    assert.deepEqual(canvasRunOrder(wired.canvas, [clip, source]), [source, clip], 'the source video runs before the clip that uses its frame');
    assert.deepEqual(canvasPendingUpstream(wired.canvas, clip), [frame, source], 'the clip waits for the frame and, through it, the video');
    const sourceDone = applyCanvasCommand(wired.canvas, { type: 'node.addVersion', nodeId: source, version: version('video', 'video'), select: true }, { now });
    assert.deepEqual(canvasPendingUpstream(sourceDone, clip), [frame], 'once the video exists only the frame is missing');
    const job = (id, status, createdAt) => ({ jobId: id, idempotencyKey: id, status, createdAt, updatedAt: createdAt });
    const busy = jobs => canvasNodeBusy({ ...sourceDone.nodes.find(node => node.id === source), payload: { ...sourceDone.nodes.find(node => node.id === source).payload, jobs } });
    assert.equal(busy([job('old', 'interrupted', '2026-10-01T00:00:00.000Z'), job('new', 'completed', '2026-10-02T00:00:00.000Z')]), true,
        'an older active job keeps the node busy, as the canvas service does');
    assert.equal(busy([job('old', 'failed', '2026-10-01T00:00:00.000Z'), job('new', 'completed', '2026-10-02T00:00:00.000Z')]), false);
    assert.equal(canvasNodeBusy(sourceDone.nodes.find(node => node.id === frame)), false, 'tool nodes have no jobs');
});

test('a new node steps aside from the ones already there', () => {
    const { canvas } = board();
    const at = placeCanvasNode(canvas, { x: 140, y: 140 });
    assert.notDeepEqual(at, { x: 0, y: 0 });
    for (const node of canvas.nodes) assert.equal(at.x < node.position.x + node.size.width && at.x + CANVAS_DEFAULT_SIZE.width > node.position.x
        && at.y < node.position.y + node.size.height && at.y + CANVAS_DEFAULT_SIZE.height > node.position.y, false, `new card overlaps ${node.id}`);
});

test('canvas copy exists in every desk language and every issue code has words', () => {
    for (const locale of COMIC_DESK_LOCALES) {
        for (const key of ['add', 'generate', 'toEditor', 'role.firstFrame', 'mode.imageToVideo', 'status.running', 'issue.CAPABILITY_UNKNOWN']) {
            const text = canvasText(locale, key);
            assert.ok(text && text !== key, `${locale} ${key}`);
        }
    }
    assert.ok(COMIC_CANVAS_LOCALES.includes('zh-CN') && COMIC_CANVAS_LOCALES.includes('en'));
    assert.equal(canvasText('zh-CN', 'seconds', { n: 5 }), '5 秒');
    assert.equal(canvasIssueText('zh-CN', { code: 'INPUT_REQUIRED', path: 'inputs.firstFrame' }), '缺少必需的输入：首帧');
    assert.equal(canvasIssueText('zh-CN', { code: 'SOMETHING_NEW' }), '未知错误');
});
