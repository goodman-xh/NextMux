import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { FileHistoryStore, sharedFileHistoryStore } from '../lib/node/nextmux-file-history-store.js';
import { FILE_HISTORY_MAX_ENTRIES, FILE_HISTORY_MAX_VERSION_BYTES } from '../lib/common/nextmux-file-history.js';

async function fixture(t) {
    const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'nextmux-file-history-')));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const source = join(root, 'code.ts');
    await fs.writeFile(source, 'original\n');
    return { root, source, sourceUri: pathToFileURL(source).href, store: await sharedFileHistoryStore(root) };
}
const rejects = code => error => error.code === `FILE_HISTORY_${code}` && error.message === error.code;

test('saved versions persist independently of source files, list metadata and remain repeatedly readable after restart', async t => {
    const f = await fixture(t), before = await fs.stat(f.source);
    const original = await f.store.record({ sourceUri: f.sourceUri, content: 'original\n', kind: 'original' });
    const saved = await f.store.record({ sourceUri: f.sourceUri, content: 'edited\n', kind: 'saved' });
    const restored = await f.store.record({ sourceUri: f.sourceUri, content: 'original\n', kind: 'restored' });
    const restarted = new FileHistoryStore(f.root), listed = await restarted.list(f.sourceUri);
    // Restoring the original bytes is a no-op in file history.  The existing
    // original entry remains the canonical version instead of creating a
    // second "restored" row.
    assert.equal(restored.id, original.id);
    assert.deepEqual(listed.map(entry => entry.id), [saved.id, original.id]);
    assert.ok(listed.every(entry => entry.content === undefined && entry.sha256 === undefined));
    assert.ok(Date.parse(listed[0].createdAt) > Date.parse(listed[1].createdAt));
    for (let i = 0; i < 2; i++) assert.equal((await restarted.read(f.sourceUri, saved.id)).content, 'edited\n');
    assert.equal((await restarted.read(f.sourceUri, original.id)).content, 'original\n');
    assert.equal(await fs.readFile(f.source, 'utf8'), 'original\n');
    assert.equal((await fs.stat(f.source)).mtimeMs, before.mtimeMs);
});

test('concurrent writers serialize, identical consecutive versions coalesce and the first original is never replaced', async t => {
    const f = await fixture(t);
    assert.equal(await sharedFileHistoryStore(f.root), f.store);
    const original = await f.store.record({ sourceUri: f.sourceUri, content: 'first', kind: 'original' });
    await Promise.all(['one', 'two', 'three'].map(content => f.store.record({ sourceUri: f.sourceUri, content, kind: 'saved' })));
    const last = await f.store.record({ sourceUri: f.sourceUri, content: 'three', kind: 'saved' });
    assert.equal((await f.store.list(f.sourceUri)).length, 4);
    assert.equal(last.id, (await f.store.list(f.sourceUri))[0].id);
    assert.equal((await f.store.record({ sourceUri: f.sourceUri, content: 'replacement', kind: 'original' })).id, original.id);
    assert.equal((await f.store.read(f.sourceUri, original.id)).content, 'first');
});

test('bounded retention keeps the original and latest versions without consuming a restored selection', async t => {
    const f = await fixture(t), original = await f.store.record({ sourceUri: f.sourceUri, content: 'original', kind: 'original' });
    for (let index = 0; index < FILE_HISTORY_MAX_ENTRIES + 2; index++) await f.store.record({ sourceUri: f.sourceUri, content: `version ${index}`, kind: 'saved' });
    const entries = await f.store.list(f.sourceUri);
    assert.equal(entries.length, FILE_HISTORY_MAX_ENTRIES);
    assert.equal(entries.at(-1).id, original.id);
    assert.equal((await f.store.read(f.sourceUri, entries[0].id)).content, `version ${FILE_HISTORY_MAX_ENTRIES + 1}`);
    assert.equal((await f.store.read(f.sourceUri, original.id)).content, 'original');
});

test('large Unicode versions remain complete and invalid requests or corrupt stored bytes never become file content', async t => {
    const f = await fixture(t), content = '代码\n'.repeat(180000) + 'END';
    const entry = await f.store.record({ sourceUri: f.sourceUri, content, kind: 'saved' });
    assert.equal((await f.store.read(f.sourceUri, entry.id)).content, content);
    await assert.rejects(f.store.record({ sourceUri: f.sourceUri, content: 'x'.repeat(FILE_HISTORY_MAX_VERSION_BYTES + 1), kind: 'saved' }), rejects('TOO_LARGE'));
    await assert.rejects(f.store.list('https://example.com/code.ts'), rejects('INVALID_REQUEST'));
    await assert.rejects(f.store.read(f.sourceUri, '../manifest'), rejects('INVALID_REQUEST'));
    const key = createHash('sha256').update(f.sourceUri).digest('hex');
    await fs.writeFile(join(f.root, 'file-history-v1', key, `${entry.id}.txt`), 'tampered');
    await assert.rejects(f.store.read(f.sourceUri, entry.id), rejects('CORRUPT'));
    assert.equal(await fs.readFile(f.source, 'utf8'), 'original\n');
});

test('history directory symlinks are rejected and cannot redirect a version write', async t => {
    const f = await fixture(t), outside = join(f.root, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, join(f.root, 'file-history-v1'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(f.store.record({ sourceUri: f.sourceUri, content: 'no write', kind: 'saved' }), rejects('UNSAFE_PATH'));
    assert.deepEqual(await fs.readdir(outside), []);
});

test('one corrupt history remains unreadable without blocking versions for unrelated files', async t => {
    const f = await fixture(t);
    await f.store.record({ sourceUri: f.sourceUri, content: 'first', kind: 'original' });
    const key = createHash('sha256').update(f.sourceUri).digest('hex');
    await fs.writeFile(join(f.root, 'file-history-v1', key, 'manifest.json'), '{broken');
    await assert.rejects(f.store.list(f.sourceUri), rejects('CORRUPT'));
    const other = pathToFileURL(join(f.root, 'other.ts')).href;
    const entry = await f.store.record({ sourceUri: other, content: 'other original', kind: 'original' });
    assert.equal((await f.store.read(other, entry.id)).content, 'other original');
    assert.equal(await fs.readFile(f.source, 'utf8'), 'original\n');
});
