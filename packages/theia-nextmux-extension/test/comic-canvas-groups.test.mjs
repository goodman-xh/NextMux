import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCanvasCommand, createCanvasDocument, validateCanvasDocument } from '@nextmux/comic-core/canvas';
import { canvasGroupDescendantIds, canvasNodeParentGroupId, groupCanvasNodes, ungroupCanvas, updateCanvasNodeMembership } from '../lib/browser/nextmux-comic-canvas-groups.js';

const now = '2026-10-01T00:00:00.000Z';
const text = (id, x = 0, y = 0) => ({ id, title: id, kind: 'text', position: { x, y }, size: { width: 100, height: 100 }, payload: { text: id } });
function board(nodes) {
    let canvas = createCanvasDocument({ id: 'groups', projectId: 'project', now });
    for (const node of nodes) canvas = applyCanvasCommand(canvas, { type: 'node.add', node }, { now });
    return canvas;
}
function group(canvas, nodeIds, id, options = {}) {
    const result = groupCanvasNodes(canvas, nodeIds, { groupId: id, nodeId: `${id}-node`, now, ...options });
    assert.equal(result.ok, true, result.message);
    return result.canvas;
}
const positionMap = canvas => Object.fromEntries(canvas.nodes.filter(node => node.kind !== 'group').map(node => [node.id, node.position]));
const move = (canvas, nodeId, position) => applyCanvasCommand(canvas, { type: 'node.move', nodeId, position }, { now });

test('one-node and multi-node boxes use padding and keep all world positions', () => {
    const canvas = board([text('a', 50, -100), text('b', 500, 200)]);
    const before = JSON.stringify(canvas);
    const result = groupCanvasNodes(canvas, ['a'], { groupId: 'g', nodeId: 'gn', now });
    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
    assert.deepEqual(result.node.position, { x: -30, y: -180 });
    assert.deepEqual(result.node.size, { width: 260, height: 260 });
    assert.deepEqual(positionMap(result.canvas), positionMap(canvas));
    const both = groupCanvasNodes(canvas, ['a', 'b'], { groupId: 'both', nodeId: 'both-node', settings: { groupPadding: 100 }, now });
    assert.deepEqual(both.node.position, { x: -50, y: -200 });
    assert.deepEqual(both.node.size, { width: 750, height: 600 });
    assert.equal(JSON.stringify(canvas), before);
    assert.equal(groupCanvasNodes(canvas, []).code, 'EMPTY_SELECTION');
    assert.equal(groupCanvasNodes(canvas, ['unknown']).code, 'NODE_MISSING');
});

test('nested grouping removes redundant selected descendants and ungroup restores their parent', () => {
    let canvas = group(board([text('a', 0, 0), text('b', 300, 100), text('c', 600, 200)]), ['a', 'b', 'c'], 'outer');
    const expected = positionMap(canvas);
    canvas = group(canvas, ['a', 'b'], 'inner');
    assert.equal(canvas.groups.find(item => item.id === 'inner').parentGroupId, 'outer');
    assert.deepEqual(canvas.groups.find(item => item.id === 'outer').nodeIds, ['c', 'inner-node']);
    assert.deepEqual(positionMap(canvas), expected);
    const wrap = groupCanvasNodes(canvas, ['inner-node', 'a'], { groupId: 'wrapper', nodeId: 'wrapper-node', now });
    assert.equal(wrap.ok, true);
    assert.equal(wrap.count, 3);
    assert.deepEqual(wrap.group.nodeIds, ['inner-node']);
    const flattened = ungroupCanvas(canvas, 'inner', now);
    assert.deepEqual(new Set(flattened.groups.find(item => item.id === 'outer').nodeIds), new Set(['a', 'b', 'c']));
    assert.deepEqual(positionMap(flattened), expected);
    assert.deepEqual(validateCanvasDocument(flattened), []);
});

test('60 nodes are accepted and descendant counts refuse 61 without touching input', () => {
    const canvas = board(Array.from({ length: 61 }, (_, at) => text(`n${at}`, at * 120)));
    const sixty = groupCanvasNodes(canvas, canvas.nodes.slice(0, 60).map(node => node.id), { groupId: 'g', nodeId: 'gn', now });
    assert.equal(sixty.ok, true);
    assert.equal(sixty.count, 60);
    const refused = groupCanvasNodes(sixty.canvas, ['gn', 'n0'], { groupId: 'wrapper', nodeId: 'wn', now });
    assert.equal(refused.ok, false);
    assert.equal(refused.count, 61);
    assert.equal(refused.limit, 60);
    assert.match(refused.message, /61.*60/);
    assert.equal(refused.canvas, sixty.canvas);
    assert.equal(groupCanvasNodes(canvas, canvas.nodes.map(node => node.id)).code, 'GROUP_LIMIT');
    const nested = groupCanvasNodes(sixty.canvas, ['n0'], { groupId: 'inner', nodeId: 'inner-node', now });
    assert.equal(nested.ok, false);
    assert.equal(nested.count, 61);
    assert.equal(nested.canvas, sixty.canvas);
});

test('drag centre chooses deepest group, leaves it when outside, and keeps world coordinates', () => {
    let canvas = group(board([text('a', 0, 0), text('b', 800, 800), text('moving', 1500, 1500)]), ['a', 'b'], 'outer');
    canvas = group(canvas, ['a'], 'inner');
    const dragged = move(canvas, 'moving', { x: 0, y: 0 });
    const joined = updateCanvasNodeMembership(dragged, 'moving', now);
    assert.equal(joined.ok, true);
    assert.equal(joined.toGroupId, 'inner');
    assert.equal(canvasNodeParentGroupId(joined.canvas, 'moving'), 'inner');
    assert.deepEqual(joined.canvas.nodes.find(node => node.id === 'moving').position, { x: 0, y: 0 });
    const outerOnly = updateCanvasNodeMembership(move(joined.canvas, 'moving', { x: 400, y: 400 }), 'moving', now);
    assert.equal(outerOnly.toGroupId, 'outer');
    const left = updateCanvasNodeMembership(move(outerOnly.canvas, 'moving', { x: 2000, y: 2000 }), 'moving', now);
    assert.equal(left.ok, true);
    assert.equal(left.toGroupId, undefined);
    assert.equal(canvasNodeParentGroupId(left.canvas, 'moving'), undefined);
    const unchanged = updateCanvasNodeMembership(left.canvas, 'moving', now);
    assert.equal(unchanged.changed, false);
    assert.equal(unchanged.canvas, left.canvas);
});

test('a centre on a group edge remains inside, group movement cannot create parent cycles', () => {
    let canvas = group(board([text('a'), text('b', 800, 800), text('moving', 1500, 1500)]), ['a', 'b'], 'outer');
    canvas = group(canvas, ['a'], 'inner');
    const edge = updateCanvasNodeMembership(move(canvas, 'moving', { x: -130, y: 0 }), 'moving', now);
    assert.equal(edge.toGroupId, 'inner');
    const outerAtCentre = applyCanvasCommand(canvas, { type: 'node.resize', nodeId: 'outer-node', size: { width: 200, height: 200 } }, { now });
    const noCycle = updateCanvasNodeMembership(outerAtCentre, 'outer-node', now);
    assert.equal(noCycle.ok, true);
    assert.equal(noCycle.toGroupId, undefined);
    assert.deepEqual(validateCanvasDocument(noCycle.canvas), []);
    assert.equal(groupCanvasNodes(canvas, ['outer-node'], { parentGroupId: 'inner' }).code, 'GROUP_CYCLE');
});

test('joining a full group refuses with the descendant count and preserves memberships', () => {
    let canvas = board(Array.from({ length: 61 }, (_, at) => text(`n${at}`, at < 60 ? 0 : 1000)));
    canvas = group(canvas, canvas.nodes.slice(0, 60).map(node => node.id), 'full');
    canvas = move(canvas, 'n60', { x: 0, y: 0 });
    const refused = updateCanvasNodeMembership(canvas, 'n60', now);
    assert.equal(refused.ok, false);
    assert.equal(refused.count, 61);
    assert.equal(refused.canvas, canvas);
    assert.equal(canvasNodeParentGroupId(canvas, 'n60'), undefined);
});

test('membership edits preserve parent-only nested groups and exclude descendants once', () => {
    let canvas = group(board([text('a'), text('b', 400, 400)]), ['a', 'b'], 'outer');
    canvas = group(canvas, ['a'], 'inner');
    canvas = { ...canvas, groups: canvas.groups.map(item => item.id === 'outer' ? { ...item, nodeIds: ['b'] } : item) };
    assert.deepEqual(validateCanvasDocument(canvas), []);
    assert.deepEqual(new Set(canvasGroupDescendantIds(canvas, 'outer')), new Set(['b', 'inner-node', 'a']));
    const moved = updateCanvasNodeMembership(move(canvas, 'b', { x: 2000, y: 2000 }), 'b', now);
    assert.equal(moved.ok, true);
    assert.equal(moved.canvas.groups.find(item => item.id === 'inner').parentGroupId, 'outer');
});

test('member-only nesting still determines depth and prevents cycles', () => {
    let canvas = group(board([text('a'), text('b', 800, 800), text('moving', 1500, 1500)]), ['a', 'b'], 'outer');
    canvas = group(canvas, ['a'], 'inner');
    canvas = { ...canvas, groups: canvas.groups.map(item => item.id === 'inner' ? { id: item.id, title: item.title, nodeIds: item.nodeIds } : item) };
    assert.deepEqual(validateCanvasDocument(canvas), []);
    const result = updateCanvasNodeMembership(move(canvas, 'moving', { x: 0, y: 0 }), 'moving', now);
    assert.equal(result.ok, true);
    assert.equal(result.toGroupId, 'inner');
    assert.equal(groupCanvasNodes(canvas, ['outer-node'], { parentGroupId: 'inner' }).code, 'GROUP_CYCLE');
});
