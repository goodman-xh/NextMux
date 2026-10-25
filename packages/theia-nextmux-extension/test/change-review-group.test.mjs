import test from 'node:test';
import assert from 'node:assert/strict';
import { groupChangesByFile } from '../lib/browser/nextmux-change-grouping.js';

const change = (id, root, path, kind, additions, deletions) => ({ checkpointId: id, workspaceRoot: root, path, kind, binary: false, additions, deletions, patch: `@@ ${id}`, truncated: false, createdAt: id });

test('a turn lists each file once with net counts and restores from its first checkpoint', () => {
    const rows = groupChangesByFile([
        change('1', '/a', 'notes.txt', 'created', 1, 0), change('2', '/b', 'notes.txt', 'created', 1, 0),
        change('3', '/a', 'run.txt', 'created', 1, 0), change('4', '/a', 'notes.txt', 'deleted', 0, 1),
        change('5', '/b', 'notes.txt', 'deleted', 0, 1), change('6', '/a', 'run.txt', 'modified', 2, 1)
    ]);
    assert.equal(rows.length, 3, 'the summary count and the list agree');
    const a = rows.find(row => row.workspaceRoot === '/a' && row.path === 'notes.txt');
    assert.equal(a.checkpointId, '1');
    assert.equal(a.kind, 'deleted');
    assert.deepEqual([a.additions, a.deletions], [1, 1]);
    assert.equal(a.rootLabel, 'a', 'the same path in two folders is told apart');
    const run = rows.find(row => row.path === 'run.txt');
    assert.equal(run.kind, 'created');
    assert.equal(run.rootLabel, undefined);
    assert.equal(run.patch, '@@ 3\n@@ 6');
});
