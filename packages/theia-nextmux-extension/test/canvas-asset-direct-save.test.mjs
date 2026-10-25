import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { sourceModule } from './helpers/comic-organizer-source-loader.mjs';
globalThis.crypto ??= webcrypto;
const { canvasAssetSaveItems, saveCanvasAssets } = sourceModule('browser/nextmux-comic-asset-library-save.ts');
const { comicAssetLibraryText } = sourceModule('browser/nextmux-comic-asset-library-text.ts');
const { ComicAssetLibraryStore } = sourceModule('node/nextmux-comic-asset-library-store.ts');
const { comicAssetLibraryMatches } = sourceModule('common/nextmux-comic-asset-library.ts');
const item = (id, extra = {}) => ({ nodeId: id, requestId: crypto.randomUUID(), assetName: id, assetCategory: 'other', remark: '', textContent: `Text ${id}`, mediaKind: 'text', ...extra });
const entry = input => ({ ...input, assetId: input.requestId, assetType: 'text', source: {}, createdAt: '2026-10-03T00:00:00Z' });
const scope = () => crypto.randomUUID();

test('save snapshots freeze the current version, deduplicate groups and preserve source content', () => {
    const media = { id: 'v1', kind: 'video', uri: 'video.mp4' };
    const canvas = { nodes: [{ id: 'movie', kind: 'video', title: 'Movie', payload: { versions: [media, { ...media, id: 'v2' }], currentVersionId: 'v1' } },
        { id: 'text', kind: 'text', title: '', payload: { text: 't'.repeat(1100) } }, { id: 'empty', kind: 'text', title: 'Empty', payload: { text: ' ' } },
        { id: 'group', kind: 'group', payload: { nodeIds: ['movie', 'text'] } }] };
    const before = JSON.stringify(canvas), items = canvasAssetSaveItems(canvas, ['movie', 'movie', 'group', 'text', 'missing', 'empty']);
    assert.equal(items.length, 3); assert.equal(items[0].versionId, 'v1'); assert.equal(items[0].mediaKind, 'video');
    assert.equal(items[1].textContent.length, 1000); assert.equal(items[2].unavailable, 'emptyText');
    canvas.nodes[0].payload.currentVersionId = 'v2'; assert.equal(items[0].versionId, 'v1');
    canvas.nodes[0].payload.currentVersionId = 'v1'; assert.equal(JSON.stringify(canvas), before);
});

test('automatic names and payloads require no dialog and never forward display-only fields', async () => {
    const calls = [], notices = [];
    const result = await saveCanvasAssets({ scope: scope(), locale: 'zh-CN', items: [item('blank', { assetName: '  ' }), item('long', { assetName: 'x'.repeat(180) })],
        onSave: async input => { calls.push(input); return entry(input); }, onNotice: message => notices.push(message) });
    assert.deepEqual(result, { saved: 2, failed: [] }); assert.deepEqual(notices, ['保存成功']);
    assert.equal(calls[0].assetName, '文本'); assert.equal(calls[1].assetName.length, 160);
    assert.ok(calls.every(input => !('mediaKind' in input) && !('unavailable' in input)));
});

test('automatic portrait categories survive real storage and remain visible in the character filter', async t => {
    const temp = await mkdtemp(join(tmpdir(), 'nextmux-direct-portrait-')); t.after(() => rm(temp, { recursive: true, force: true }));
    const sourcePath = join(temp, 'portrait.png');
    await writeFile(sourcePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=', 'base64'));
    const store = new ComicAssetLibraryStore(join(temp, 'library'));
    const canvas = { nodes: ['character', 'portrait', 'audio'].map(id => ({ id, title: id, kind: id === 'portrait' ? 'imageGen' : id,
        ...(id === 'portrait' ? { origin: { role: 'portrait' } } : {}),
        payload: { currentVersionId: 'v-' + id, versions: [{ id: 'v-' + id, kind: id === 'audio' ? 'audio' : 'image', uri: sourcePath }] } })) };
    const items = canvasAssetSaveItems(canvas, ['character', 'portrait', 'audio']);
    assert.deepEqual(items.map(input => input.assetCategory), ['character', 'character', 'audio']);
    const result = await saveCanvasAssets({ scope: scope(), locale: 'en', items: items.slice(0, 2), onNotice: () => {}, onSave: input => {
        const { nodeId, versionId, ...data } = input;
        return store.save({ ...data, assetType: 'image', sourcePath, source: { projectId: 'p', canvasId: 'c', nodeId, versionId } });
    } });
    assert.deepEqual(result.failed, []);
    const saved = await store.list(); assert.equal(saved.length, 2);
    assert.ok(saved.every(value => value.assetType === 'image' && comicAssetLibraryMatches(value, 'character')));
});

test('duplicate and overlapping clicks share in-flight source saves; each owner keeps its callbacks', async () => {
    const owner = scope(), noticesA = [], noticesB = [], calls = [];
    let release; const gate = new Promise(resolve => { release = resolve; });
    const onSave = async input => { calls.push(input); await gate; return entry(input); };
    const first = saveCanvasAssets({ scope: owner, locale: 'en', items: [item('a')], onSave, onNotice: n => noticesA.push(n) });
    const duplicate = saveCanvasAssets({ scope: owner, locale: 'en', items: [item('a')], onSave: () => { throw Error('new callback must not replace owner'); }, onNotice: n => noticesB.push(n) });
    assert.equal(first, duplicate);
    const overlap = saveCanvasAssets({ scope: owner, locale: 'en', items: [item('a'), item('b')], onSave, onNotice: () => {} });
    const elsewhere = saveCanvasAssets({ scope: scope(), locale: 'zh-CN', items: [item('a')], onSave: async input => { calls.push(input); return entry(input); }, onNotice: n => noticesB.push(n) });
    await elsewhere; release(); await Promise.all([first, overlap]);
    assert.deepEqual(calls.map(input => input.nodeId), ['a', 'a', 'b']); assert.notEqual(calls[0].requestId, calls[1].requestId);
    assert.deepEqual(noticesA, ['Saved successfully']); assert.deepEqual(noticesB, ['保存成功']);
});

test('partial batches retry failed original requests after a lost receipt without duplicating persisted successes', async t => {
    const temp = await mkdtemp(join(tmpdir(), 'nextmux-direct-save-')); t.after(() => rm(temp, { recursive: true, force: true }));
    const store = new ComicAssetLibraryStore(temp), owner = scope(), calls = [], notices = [];
    let loseReceipt = true;
    const onSave = async input => {
        calls.push(input);
        const { nodeId, ...data } = input;
        const saved = await store.save({ ...data, assetType: 'text', source: { projectId: 'p', canvasId: 'c', nodeId } });
        if (nodeId === 'b' && loseReceipt) { loseReceipt = false; throw Error('receipt lost'); }
        return saved;
    };
    const save = () => saveCanvasAssets({ scope: owner, locale: 'en', items: [item('a'), item('b'), item('c')], onSave, onNotice: n => notices.push(n) });
    const initial = await save(); assert.equal(initial.saved, 2); assert.equal(initial.failed[0].nodeId, 'b'); assert.equal((await store.list()).length, 3);
    assert.match(notices[0], /Saved 2\/3.*\nb: receipt lost/);
    assert.deepEqual(await save(), { saved: 3, failed: [] }); assert.deepEqual(calls.map(input => input.nodeId), ['a', 'b', 'c', 'b']);
    assert.equal(calls[1].requestId, calls[3].requestId); assert.equal((await store.list()).length, 3);
    await save(); assert.equal((await store.list()).length, 3, 'a later explicit click also recovers the same saved source');
    const deleted = (await store.list()).find(saved => saved.source.nodeId === 'b'); await store.remove(deleted.assetId);
    await save(); assert.equal((await store.list()).length, 3, 'saving a previously deleted source creates a fresh intentional copy');
    assert.ok(!(await store.list()).some(saved => saved.assetId === deleted.assetId));
});

test('unavailable items report errors while valid items save; changed versions use separate requests', async () => {
    const owner = scope(), calls = [], notices = [], onSave = async input => { calls.push(input); return entry(input); };
    const result = await saveCanvasAssets({ scope: owner, locale: 'en', items: [item('bad', { unavailable: 'emptyMedia' }), item('good')], onSave, onNotice: n => notices.push(n) });
    assert.equal(result.saved, 1); assert.equal(result.failed.length, 1); assert.deepEqual(calls.map(input => input.nodeId), ['good']);
    assert.match(notices[0], /no completed media/); assert.doesNotMatch(notices[0], /Saved successfully/);
    for (const versionId of ['v1', 'v2']) await saveCanvasAssets({ scope: owner, locale: 'en', items: [item('movie', { textContent: undefined, mediaKind: 'video', versionId })], onSave, onNotice: () => {} });
    assert.notEqual(calls[1].requestId, calls[2].requestId); assert.deepEqual(calls.slice(1).map(input => input.versionId), ['v1', 'v2']);
});

test('direct save notices are translated in all twelve supported languages', () => {
    for (const locale of ['zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        for (const key of ['saveSucceeded', 'saveIncomplete']) assert.notEqual(comicAssetLibraryText(locale, key), key);
    }
});
