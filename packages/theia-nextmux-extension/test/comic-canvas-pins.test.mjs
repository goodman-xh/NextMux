import assert from 'node:assert/strict';
import test from 'node:test';
import { PIN_COLORS, createCanvasDocument } from '@nextmux/comic-core/canvas';
import { clearCanvasPins, listCanvasPins, setCanvasNodePins } from '../lib/browser/nextmux-comic-canvas-pins.js';

const now = '2026-09-30T10:00:00.000Z';
const textNode = (id, pinnedColors) => ({ id, kind: 'text', title: id, position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, payload: { text: id }, ...(pinnedColors === undefined ? {} : { pinnedColors }) });
const board = () => ({ ...createCanvasDocument({ id: 'board', projectId: 'project', now }), nodes: [textNode('multi', ['red', 'blue']), textNode('red', ['red']), textNode('plain'), { ...textNode('group', ['grey']), kind: 'group', payload: { groupId: 'g' } }], groups: [{ id: 'g', title: 'Group', nodeIds: ['red'] }] });

test('pin navigation groups any node kind in palette order without duplicating nodes within a color', () => {
    const canvas = board();
    const pins = listCanvasPins(canvas);
    assert.deepEqual(pins.map(group => group.color), PIN_COLORS);
    assert.deepEqual(pins.find(group => group.color === 'red').nodes.map(node => node.id), ['multi', 'red']);
    assert.deepEqual(pins.find(group => group.color === 'blue').nodes.map(node => node.id), ['multi']);
    assert.deepEqual(pins.find(group => group.color === 'grey').nodes.map(node => node.id), ['group']);
    assert.equal(pins.find(group => group.color === 'orange').nodes.length, 0);
    assert.equal(listCanvasPins({ ...canvas, nodes: canvas.nodes.filter(node => node.id !== 'multi') }).find(group => group.color === 'blue').nodes.length, 0);
});

test('clear a color or all colors preserves other pins, content and the input document', () => {
    const canvas = board();
    const before = structuredClone(canvas);
    const cleared = clearCanvasPins(canvas, 'red');
    assert.deepEqual(cleared.nodes.find(node => node.id === 'multi').pinnedColors, ['blue']);
    assert.deepEqual(cleared.nodes.find(node => node.id === 'red').pinnedColors, []);
    assert.deepEqual(cleared.nodes.find(node => node.id === 'group').pinnedColors, ['grey']);
    assert.deepEqual(cleared.edges, canvas.edges);
    assert.deepEqual(cleared.groups, canvas.groups);
    assert.deepEqual(canvas, before);
    assert.ok(clearCanvasPins(cleared).nodes.every(node => !node.pinnedColors?.length));
    assert.equal(clearCanvasPins(canvas, 'orange'), canvas);
});

test('set pins validates colors and permits every kind including group nodes', () => {
    const canvas = board();
    const next = setCanvasNodePins(canvas, 'group', ['cyan', 'pink']);
    assert.deepEqual(next.nodes.find(node => node.id === 'group').pinnedColors, ['cyan', 'pink']);
    assert.throws(() => setCanvasNodePins(canvas, 'plain', ['red', 'red']), /unique supported colors/);
    assert.throws(() => clearCanvasPins(canvas, 'unknown'), /Unknown pin color/);
});
