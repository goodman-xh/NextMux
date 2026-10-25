import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCanvasCommand, createCanvasDocument } from '@nextmux/comic-core/canvas';
import { canvasMinimapBuckets, searchCanvasNodes } from '../lib/browser/nextmux-comic-canvas-locator.js';
import { groupCanvasNodes } from '../lib/browser/nextmux-comic-canvas-groups.js';

const now = '2026-10-01T00:00:00.000Z';
const text = (id, x = 0, y = 0) => ({ id, title: id, kind: 'text', position: { x, y }, size: { width: 100, height: 100 }, payload: { text: '' } });
function board(nodes) {
    let canvas = createCanvasDocument({ id: 'locator', projectId: 'project', now });
    for (const node of nodes) canvas = applyCanvasCommand(canvas, { type: 'node.add', node }, { now });
    return canvas;
}

test('locator fuzzy-matches titles and translated kind labels without changing nodes', () => {
    const canvas = board([{ ...text('moon'), title: 'Moonlight scene' }, { ...text('cafe'), title: 'Café́ sunset' },
        { ...text('image'), kind: 'imageGen', payload: { mode: 'textToImage', modelId: 'image-model', prompt: '', parameters: {}, versions: [] } }]);
    const before = JSON.stringify(canvas);
    assert.deepEqual(searchCanvasNodes(canvas, 'mnlsc').map(node => node.id), ['moon']);
    assert.deepEqual(searchCanvasNodes(canvas, 'CAFES').map(node => node.id), ['cafe']);
    assert.deepEqual(searchCanvasNodes(canvas, '图生').map(node => node.id), ['image']);
    assert.deepEqual(searchCanvasNodes(canvas, 'imgen', 'all', { locale: 'en' }).map(node => node.id), ['image']);
    assert.deepEqual(searchCanvasNodes(canvas, 'pic', 'all', { kindLabels: { imageGen: 'Picture' } }).map(node => node.id), ['image']);
    assert.equal(searchCanvasNodes(canvas, 'zzzz').length, 0);
    assert.equal(JSON.stringify(canvas), before);
});

test('picture, clip, sound, text and character filters include the corresponding output nodes', () => {
    const resultNode = (id, kind, payload = {}) => ({ ...text(id), kind, payload: { versions: [], ...payload } });
    const canvas = board([text('text'), resultNode('image', 'image'), resultNode('frame', 'frameExtract', { selection: { kind: 'last' } }),
        resultNode('video', 'video'), resultNode('composition', 'composition', { clips: [], parameters: {} }), resultNode('audio', 'audio'),
        resultNode('character', 'character', { characterId: 'hero' })]);
    const ids = filter => searchCanvasNodes(canvas, '', filter).map(node => node.id);
    assert.deepEqual(ids('picture'), ['image', 'frame']);
    assert.deepEqual(ids('clip'), ['video', 'composition']);
    assert.deepEqual(ids('sound'), ['audio']);
    assert.deepEqual(ids('text'), ['text']);
    assert.deepEqual(ids('character'), ['character']);
    assert.equal(ids('all').length, 7);
});

test('up to 8 ungrouped nodes use a canvas bucket; group descendants do not count toward the threshold', () => {
    let canvas = board(Array.from({ length: 10 }, (_, at) => text(`n${at}`, at * 100, at * 100)));
    const grouped = groupCanvasNodes(canvas, ['n0', 'n1'], { groupId: 'g', nodeId: 'gn', now });
    assert.equal(grouped.ok, true);
    canvas = grouped.canvas;
    const buckets = canvasMinimapBuckets(canvas);
    assert.deepEqual(buckets.find(bucket => bucket.id === 'group:g').nodeIds, ['n0', 'n1']);
    assert.deepEqual(buckets.find(bucket => bucket.id === 'canvas').nodeIds, ['n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9']);
    assert.equal(buckets.filter(bucket => bucket.kind === 'quadrant').length, 0);
    assert.deepEqual(canvasMinimapBuckets(board([])), [{ id: 'canvas', kind: 'canvas', nodeIds: [] }]);
});

test('larger ungrouped canvases split at median centres, keeping quadrants stable despite outliers', () => {
    const canvas = board([text('tl0', 0, 0), text('tl1', 10, 10), text('tl2', 20, 20), text('tr', 60, 0), text('bl', 0, 60),
        text('br0', 40, 40), text('br1', 50, 50), text('br2', 70, 70), text('outlier', 10000, 10000)]);
    const buckets = canvasMinimapBuckets(canvas);
    assert.deepEqual(buckets.map(bucket => bucket.id), ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']);
    assert.deepEqual(buckets.find(bucket => bucket.id === 'topLeft').nodeIds, ['tl0', 'tl1', 'tl2']);
    assert.deepEqual(buckets.find(bucket => bucket.id === 'topRight').nodeIds, ['tr']);
    assert.deepEqual(buckets.find(bucket => bucket.id === 'bottomLeft').nodeIds, ['bl']);
    assert.deepEqual(buckets.find(bucket => bucket.id === 'bottomRight').nodeIds, ['br0', 'br1', 'br2', 'outlier']);
    assert.equal(new Set(buckets.flatMap(bucket => bucket.nodeIds)).size, canvas.nodes.length);
});

test('nested minimap buckets retain their parent hierarchy and immediate leaves', () => {
    const canvas = board([text('a'), text('b', 300, 300)]);
    const outer = groupCanvasNodes(canvas, ['a', 'b'], { groupId: 'outer', nodeId: 'outer-node', now }).canvas;
    const inner = groupCanvasNodes(outer, ['a'], { groupId: 'inner', nodeId: 'inner-node', now }).canvas;
    const buckets = canvasMinimapBuckets(inner);
    assert.deepEqual(buckets.find(bucket => bucket.groupId === 'outer').nodeIds, ['b']);
    assert.deepEqual(buckets.find(bucket => bucket.groupId === 'inner'), { id: 'group:inner', kind: 'group', groupId: 'inner', parentGroupId: 'outer', nodeIds: ['a'] });
    const memberOnly = { ...inner, groups: inner.groups.map(group => group.id === 'inner' ? { id: group.id, title: group.title, nodeIds: group.nodeIds } : group) };
    assert.equal(canvasMinimapBuckets(memberOnly).find(bucket => bucket.groupId === 'inner').parentGroupId, 'outer');
});
