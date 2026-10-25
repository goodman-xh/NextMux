import assert from 'node:assert/strict';
import test from 'node:test';
import {
    MODEL_LIST_MAX_AGE_MS, MODEL_LIST_RETRY_MS, modelListFingerprint, nextModelListWatermark, parseModelListWatermark, staleModelListConnections
} from '../lib/common/nextmux-model-list-refresh.js';

const hour = 60 * 60_000;
const now = Date.parse('2026-09-25T12:00:00Z');
const at = ms => new Date(ms).toISOString();

test('the catalog fingerprint follows the set of models, not their order, case or repeats', () => {
    assert.equal(modelListFingerprint(['b', 'A', 'a', ' c ']), modelListFingerprint(['c', 'b', 'a']));
    assert.match(modelListFingerprint(['a', 'b']), /^2:[0-9a-f]{8}$/);
    assert.notEqual(modelListFingerprint(['a', 'b']), modelListFingerprint(['a', 'c']));
});

test('only a catalog with a model it did not have before makes every list due', () => {
    // A fresh install records the catalog without re-reading every API.
    const first = nextModelListWatermark(undefined, modelListFingerprint(['a', 'b']), now);
    assert.deepEqual(first, { fingerprint: modelListFingerprint(['a', 'b']), watermark: 0 });
    assert.equal(nextModelListWatermark(first, first.fingerprint, now + 1), first, 'unchanged catalog');
    assert.equal(nextModelListWatermark(first, modelListFingerprint(['a', 'b', 'c']), now + 1).watermark, now + 1, 'a model was added');
    assert.equal(nextModelListWatermark(first, modelListFingerprint(['a', 'c']), now + 2).watermark, now + 2, 'one model replaced by another');
    assert.equal(nextModelListWatermark({ ...first, watermark: 5 }, modelListFingerprint(['a']), now + 3).watermark, 5, 'a model was only removed');
    assert.deepEqual(parseModelListWatermark(JSON.stringify(first)), first);
    for (const broken of [null, '', '{', '{"fingerprint":1,"watermark":2}', '{"fingerprint":"x","watermark":"never"}']) assert.equal(parseModelListWatermark(broken), undefined);
});

test('lists are read again daily and right after new models appear, oldest first, one API at a time', () => {
    const subjects = [
        { id: 'fresh', lastModelDiscoveryAt: at(now - 2 * hour) },
        { id: 'old', lastModelDiscoveryAt: at(now - MODEL_LIST_MAX_AGE_MS - hour) },
        { id: 'never' },
        { id: 'broken-date', lastModelDiscoveryAt: 'yesterday' },
        { id: 'tts', lastModelDiscoveryAt: at(now - 3 * MODEL_LIST_MAX_AGE_MS), media: true }
    ];
    assert.deepEqual(staleModelListConnections(subjects, { now }), ['broken-date', 'never', 'old'], 'media APIs keep their chosen model');
    // New models were seen an hour ago: a list read before that is due too.
    assert.deepEqual(staleModelListConnections(subjects, { now, watermark: now - hour }), ['broken-date', 'never', 'old', 'fresh']);
    // A watermark from a wrong clock cannot make lists due forever.
    assert.deepEqual(staleModelListConnections([{ id: 'just-read', lastModelDiscoveryAt: at(now) }], { now, watermark: now + 10 * hour }), []);
    // A failed read is not retried for hours.
    const attempts = new Map([['old', now - hour], ['never', now - MODEL_LIST_RETRY_MS - 1]]);
    assert.deepEqual(staleModelListConnections(subjects, { now, attempts }), ['broken-date', 'never']);
});

test('a list read before the reader learned new model facts (reasoning efforts) is read again at once', async () => {
    const { MODEL_LIST_FORMAT_AT } = await import('../lib/common/nextmux-model-list-refresh.js');
    const later = MODEL_LIST_FORMAT_AT + 2 * hour;
    const subjects = [
        { id: 'before', lastModelDiscoveryAt: new Date(MODEL_LIST_FORMAT_AT - hour).toISOString() },
        { id: 'after', lastModelDiscoveryAt: new Date(MODEL_LIST_FORMAT_AT + hour).toISOString() }
    ];
    assert.deepEqual(staleModelListConnections(subjects, { now: later }), ['before']);
});
