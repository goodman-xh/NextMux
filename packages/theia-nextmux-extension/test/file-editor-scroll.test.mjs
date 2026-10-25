import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contextFileScrollPosition,
  normalizeContextFileScrollPositions,
  updateContextFileScrollPosition,
} from '../lib/browser/nextmux-file-editor-scroll.js';

test('file editor scroll positions are bounded, URI-scoped, and retain the newest entries', () => {
  const uri = 'file:///workspace/src/app.ts';
  const normalized = normalizeContextFileScrollPositions({
    [uri]: { top: 1234, left: 42 },
    __proto__: { top: 99 },
    'file:///workspace/invalid': { top: Number.NaN, left: -10 },
  });

  assert.deepEqual(contextFileScrollPosition(normalized, uri), { top: 1234, left: 42 });
  assert.deepEqual(contextFileScrollPosition(normalized, 'file:///workspace/invalid'), { top: 0, left: 0 });
  assert.equal(Object.hasOwn(normalized, '__proto__'), false);

  let positions = {};
  for (let index = 0; index < 40; index += 1) {
    positions = updateContextFileScrollPosition(
      positions,
      `file:///workspace/file-${index}.ts`,
      index * 100,
      index,
    );
  }
  assert.equal(Object.keys(positions).length, 32);
  assert.equal(contextFileScrollPosition(positions, 'file:///workspace/file-0.ts'), undefined);
  assert.deepEqual(contextFileScrollPosition(positions, 'file:///workspace/file-39.ts'), { top: 3900, left: 39 });
});

test('updating one file does not mutate the previous scroll snapshot', () => {
  const previous = normalizeContextFileScrollPositions({
    'file:///workspace/a.ts': { top: 10, left: 1 },
  });
  const next = updateContextFileScrollPosition(previous, 'file:///workspace/b.ts', 20, 2);

  assert.deepEqual(previous, { 'file:///workspace/a.ts': { top: 10, left: 1 } });
  assert.deepEqual(next, {
    'file:///workspace/a.ts': { top: 10, left: 1 },
    'file:///workspace/b.ts': { top: 20, left: 2 },
  });
});
