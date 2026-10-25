import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCanvasCommand, createCanvasDocument } from '@nextmux/comic-core/canvas';
import { arrangeCanvas } from '../lib/browser/nextmux-comic-canvas-layout.js';
import { groupCanvasNodes } from '../lib/browser/nextmux-comic-canvas-groups.js';

const now = '2026-10-01T00:00:00.000Z';
const text = (id, x = 0, y = 0, width = 100, height = 100) => ({ id, kind: 'text', title: id, position: { x, y }, size: { width, height }, payload: { text: id } });
function board(nodes) {
    let canvas = createCanvasDocument({ id: 'layout', projectId: 'project', now });
    for (const node of nodes) canvas = applyCanvasCommand(canvas, { type: 'node.add', node }, { now });
    return canvas;
}
const ids = positions => positions.map(item => item.nodeId);
const positions = result => Object.fromEntries(result.map(item => [item.nodeId, item.position]));

test('near-square grid uses natural names, reverses sort and never changes the document', () => {
    const canvas = board([text('名称10'), text('名称2'), text('名称1'), text('名称11'), text('名称3')]);
    const before = JSON.stringify(canvas);
    const arranged = arrangeCanvas(canvas, canvas.nodes.map(node => node.id), { mode: 'grid', sortBy: 'name' });
    assert.deepEqual(ids(arranged), ['名称1', '名称2', '名称3', '名称10', '名称11']);
    assert.deepEqual(arranged.map(item => item.position), [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 400, y: 0 }, { x: 0, y: 210 }, { x: 200, y: 210 }]);
    assert.deepEqual(ids(arrangeCanvas(canvas, canvas.nodes.map(node => node.id), { sortBy: 'name', direction: 'descending' })), ['名称11', '名称10', '名称3', '名称2', '名称1']);
    assert.equal(JSON.stringify(canvas), before);
});

test('position sorting follows rows left to right, and creation timestamps support both directions', () => {
    const canvas = board([text('late', -100, 200), text('right', 400, 0), text('left', 0, 0)]);
    assert.deepEqual(ids(arrangeCanvas(canvas, ['late', 'right', 'left'])), ['left', 'right', 'late']);
    const creationTimes = { late: '2026-10-03T00:00:00Z', right: '2026-10-02T00:00:00Z', left: '2026-10-01T00:00:00Z' };
    assert.deepEqual(ids(arrangeCanvas(canvas, ['late', 'right', 'left'], { sortBy: 'createdAt', creationTimes })), ['left', 'right', 'late']);
    assert.deepEqual(ids(arrangeCanvas(canvas, ['late', 'right', 'left'], { sortBy: 'createdAt', creationTimes, direction: 'descending' })), ['late', 'right', 'left']);
    const stamped = { ...canvas, nodes: canvas.nodes.map(node => ({ ...node, createdAt: creationTimes[node.id] })) };
    assert.deepEqual(ids(arrangeCanvas(stamped, ['late', 'right', 'left'], { sortBy: 'createdAt' })), ['left', 'right', 'late']);
});

test('chosen row and column orders preserve explicit IDs and apply gaps after variable bounds', () => {
    const canvas = board([text('a', 0, 0, 100, 100), text('b', 0, 0, 300, 50), text('c', 0, 0, 150, 250), text('d')]);
    const row = arrangeCanvas(canvas, ['a', 'b', 'c', 'd'], { mode: 'order', order: ['b', 'a', 'd', 'c'], rows: 2,
        settings: { arrangeHorizontalSpacing: 150, arrangeVerticalSpacing: 200 }, origin: { x: -10, y: -20 } });
    assert.deepEqual(positions(row), { b: { x: -10, y: -20 }, a: { x: 440, y: -20 }, d: { x: -10, y: 280 }, c: { x: 440, y: 280 } });
    const column = arrangeCanvas(canvas, ['a', 'b', 'c', 'd'], { mode: 'order', order: ['d', 'b'], columns: 2, flow: 'columns' });
    assert.deepEqual(ids(column), ['d', 'b', 'a', 'c']);
    assert.deepEqual(positions(column), { d: { x: 0, y: 0 }, b: { x: 0, y: 210 }, a: { x: 400, y: 0 }, c: { x: 400, y: 210 } });
});

test('wire layout layers dependencies, including paths through unselected nodes', () => {
    const gen = id => ({ id, kind: 'imageGen', title: id, position: { x: 0, y: 0 }, size: { width: 100, height: 100 },
        payload: { mode: 'textToImage', modelId: 'model', prompt: '', parameters: {}, versions: [] } });
    let canvas = board([text('a'), gen('middle'), gen('b'), text('other')]);
    const connect = (id, sourceNodeId, targetNodeId, role) => { canvas = applyCanvasCommand(canvas, { type: 'edge.connect', edge: {
        id, sourceNodeId, targetNodeId, sourcePort: 'output', targetPort: role, role, order: 0, binding: 'followCurrent'
    } }, { now }); };
    connect('one', 'a', 'middle', 'prompt');
    connect('two', 'middle', 'b', 'referenceImage');
    const before = JSON.stringify(canvas);
    const all = positions(arrangeCanvas(canvas, ['b', 'a', 'middle', 'other'], { mode: 'wires', sortBy: 'name' }));
    assert.deepEqual(all.a, { x: 0, y: 0 });
    assert.deepEqual(all.other, { x: 0, y: 210 });
    assert.deepEqual(all.middle, { x: 200, y: 0 });
    assert.deepEqual(all.b, { x: 400, y: 0 });
    const partial = positions(arrangeCanvas(canvas, ['a', 'b'], { mode: 'wires' }));
    assert.ok(partial.b.x > partial.a.x);
    const grouped = groupCanvasNodes(canvas, ['middle'], { groupId: 'g', nodeId: 'gn', now }).canvas;
    const aggregate = applyCanvasCommand(applyCanvasCommand(grouped, { type: 'edge.disconnect', edgeId: 'two' }, { now }), {
        type: 'edge.connect', edge: { id: 'group-edge', sourceNodeId: 'gn', targetNodeId: 'b', sourcePort: 'output', targetPort: 'referenceImage',
            role: 'referenceImage', order: 0, binding: 'followCurrent' }
    }, { now });
    const leaves = positions(arrangeCanvas(aggregate, ['middle', 'b'], { mode: 'wires' }));
    assert.ok(leaves.b.x > leaves.middle.x);
    assert.equal(JSON.stringify(canvas), before);
});

test('group layout uses settings padding; selecting a group and child moves only the group root', () => {
    let canvas = board([text('a', 100, 100), text('b', 600, 400)]);
    const grouped = groupCanvasNodes(canvas, ['a', 'b'], { groupId: 'g', nodeId: 'gn', now });
    assert.equal(grouped.ok, true);
    canvas = grouped.canvas;
    const arranged = positions(arrangeCanvas(canvas, ['a', 'b'], { mode: 'grid', settings: { groupPadding: 100 } }));
    assert.deepEqual(arranged.a, { x: 120, y: 120 });
    assert.deepEqual(arranged.b, { x: 320, y: 120 });
    assert.deepEqual(ids(arrangeCanvas(canvas, ['gn', 'a'], { origin: { x: 0, y: 0 } })), ['gn']);
    assert.deepEqual(arrangeCanvas(canvas, ['missing']), []);
});
