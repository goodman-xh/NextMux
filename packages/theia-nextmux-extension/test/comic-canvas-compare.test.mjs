import test from 'node:test';
import assert from 'node:assert/strict';
import { CANVAS_COMPARE_LIMIT, normalizeCanvasCompareLibrary, addCanvasCompareVersion, removeCanvasCompareVersion, clearCanvasCompareLibrary }
    from '../lib/browser/nextmux-comic-canvas-compare.js';

const version = (id, kind = 'image', extra = {}) => ({ id, assetId: `asset-${id}`, kind, uri: `nextmux.media/${id}.${kind === 'image' ? 'png' : 'mp4'}`,
    createdAt: '2026-10-01T00:00:00.000Z', metadata: { width: 1920, height: 1080 }, ...extra });

test('image/video references add, remove by URI, and clear without mutating input', () => {
    const original = Object.freeze([]);
    const first = addCanvasCompareVersion(original, version('image'));
    assert.equal(first.ok, true);
    const second = addCanvasCompareVersion(Object.freeze(first.library), version('clip', 'video'));
    assert.equal(second.ok, true);
    assert.deepEqual(second.library.map(item => item.kind), ['image', 'video']);
    assert.equal(original.length, 0);
    assert.equal(first.library.length, 1);
    const removed = removeCanvasCompareVersion(second.library, first.version.uri);
    assert.deepEqual(removed.map(item => item.id), ['clip']);
    assert.deepEqual(clearCanvasCompareLibrary(removed), []);
    assert.equal(removed.length, 1);
});

test('refusals distinguish missing media, duplicate URI and sixteen-version capacity', () => {
    const first = addCanvasCompareVersion([], version('first')).library;
    const duplicate = addCanvasCompareVersion(first, version('different-id', 'video', { uri: first[0].uri }));
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.code, 'DUPLICATE_URI');
    assert.equal(duplicate.library, first);
    for (const missing of [undefined, {}, version('missing', 'image', { uri: '' }), version('upload', 'image', { status: 'uploading' }),
        version('missing-file', 'image', { status: 'missing' }), version('sound', 'audio'), version('blob', 'image', { uri: 'blob:temporary' })]) {
        assert.equal(addCanvasCompareVersion(first, missing).code, 'MISSING_MEDIA');
    }
    const full = Array.from({ length: CANVAS_COMPARE_LIMIT }, (_, index) => version(`v${index}`));
    const refusal = addCanvasCompareVersion(full, version('seventeenth'));
    assert.equal(refusal.code, 'LIBRARY_FULL');
    assert.equal(refusal.count, 16);
    assert.equal(refusal.limit, 16);
    assert.equal(refusal.library, full);
    assert.equal(addCanvasCompareVersion(full, full[0]).code, 'DUPLICATE_URI');
});

test('cached lists restore valid, unique references and discard snapshots, task provenance and excess entries', () => {
    const cached = [null, { uri: 'plain text' }, version('bad-time', 'image', { createdAt: 'not a date' }),
        version('negative-size', 'image', { metadata: { width: -4 } }),
        version('first', 'image', { snapshot: { jobId: 'paid' }, provenance: { taskId: 'paid' },
            metadata: { width: 1920, height: 1080, untrusted: 'drop' } }), version('duplicate', 'image', { uri: 'nextmux.media/first.png' }),
        ...Array.from({ length: 20 }, (_, index) => version(`v${index}`, 'video'))];
    const before = JSON.stringify(cached);
    const library = normalizeCanvasCompareLibrary(cached);
    assert.equal(library.length, 16);
    assert.equal(library[0].id, 'first');
    assert.equal(Object.hasOwn(library[0], 'snapshot'), false);
    assert.equal(Object.hasOwn(library[0], 'provenance'), false);
    assert.equal(Object.hasOwn(library[0].metadata, 'untrusted'), false);
    assert.equal(new Set(library.map(item => item.uri)).size, 16);
    assert.equal(JSON.stringify(cached), before);
    assert.deepEqual(normalizeCanvasCompareLibrary(JSON.parse(JSON.stringify(library))), library);
    assert.deepEqual(normalizeCanvasCompareLibrary({}), []);
});

test('comparison refuses malformed scalar metadata instead of retaining nested runtime data', () => {
    for (const metadata of [{ mimeType: 123 }, { hasAudio: 'yes' }, { sha256: { taskId: 'old-run' } }]) {
        const candidate = version('invalid-metadata', 'video', { metadata });
        assert.equal(addCanvasCompareVersion([], candidate).code, 'MISSING_MEDIA');
        assert.deepEqual(normalizeCanvasCompareLibrary([candidate]), []);
    }
    const valid = version('valid-metadata', 'video', { metadata: { mimeType: 'video/mp4', hasAudio: false, sha256: 'a'.repeat(64) } });
    assert.equal(addCanvasCompareVersion([], valid).ok, true);
    assert.deepEqual(normalizeCanvasCompareLibrary([valid])[0].metadata, valid.metadata);
});
