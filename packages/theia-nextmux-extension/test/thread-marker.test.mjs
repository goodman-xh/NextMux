import assert from 'node:assert/strict';
import test from 'node:test';

import { selectActiveThreadMarker } from '../lib/browser/nextmux-thread-marker.js';

test('the thread rail follows the last turn whenever the conversation is at bottom', () => {
  assert.equal(selectActiveThreadMarker([
    { id: 'turn-40', top: 80 },
    { id: 'turn-60', top: 220 }
  ], 100, true, 'turn-100'), 'turn-100');
});

test('the thread rail follows the nearest mounted reading anchor away from bottom', () => {
  assert.equal(selectActiveThreadMarker([
    { id: 'turn-40', top: 80 },
    { id: 'turn-60', top: 220 },
    { id: 'turn-80', top: 480 }
  ], 205, false, 'turn-100'), 'turn-60');
  assert.equal(selectActiveThreadMarker([], 205, false, 'turn-100'), 'turn-100');
});
