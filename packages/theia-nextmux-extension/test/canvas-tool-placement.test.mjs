import assert from 'node:assert/strict';
import test from 'node:test';
import { freeCanvasRow } from '../lib/node/nextmux-canvas-tools-service.js';

const card = (id, x, y, width = 280, height = 498, kind = 'videoGen') => ({ id, kind, title: id, position: { x, y }, size: { width, height }, payload: {} });

test('tool results land in free space: below cards they would cover, never on them', () => {
    const nodes = [card('storyboard', 40, 100), card('clip', 420, 100), card('scene', 0, 0, 900, 700, 'group')];
    // Right of the storyboard picture is the clip card: the row moves down below it.
    const spot = freeCanvasRow(nodes, { x: 460, y: 100 }, { width: 280, height: 498 });
    assert.equal(spot.x, 460);
    assert.ok(spot.y >= 100 + 498 + 24, `placed at ${spot.y}`);
    // An empty area keeps the asked spot, even inside a scene frame (groups are frames, not cards).
    assert.deepEqual(freeCanvasRow(nodes, { x: 740, y: 100 }, { width: 120, height: 120 }), { x: 740, y: 100 });
    // A four-cell row needs room for all of it.
    const row = freeCanvasRow([card('a', 1200, 100)], { x: 100, y: 100 }, { width: 4 * 320 - 40, height: 300 });
    assert.ok(row.y >= 100 + 498 + 24);
});
