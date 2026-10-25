import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ConversationStore } from '../lib/node/nextmux-conversation-store.js';

const session = (id, workspacePath = '/project/a') => ({
    id, workspacePath, title: id, createdAt: 1, updatedAt: 2,
    turns: [{ id: 'turn-1', prompt: 'question', response: 'answer', createdAt: 1, stage: 'complete' }],
});
const corrupt = error => error?.code === 'STORE_CORRUPT';

async function storeFor(t) {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-store-integrity-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    return new ConversationStore(root);
}

async function shardManifest(store, mutate = value => value) {
    const manifestPath = join(store.root, 'manifest-v1.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const raw = JSON.stringify({ sessions: manifest.sessions });
    const shard = `manifest-v1-shard-${createHash('sha256').update(raw).digest('hex')}.json`;
    await writeFile(join(store.root, shard), raw);
    await writeFile(manifestPath, JSON.stringify(mutate({ ...manifest, sessions: [], shardFiles: [shard] })));
    return { manifestPath, shard, raw };
}

test('malformed manifests never erase deletion tombstones or recover deleted orphan payloads', async t => {
    for (const raw of ['{truncated', JSON.stringify({ schemaVersion: 1, sessions: [] })]) {
        await t.test(raw, async t => {
            const store = await storeFor(t);
            const removed = session('removed');
            const kept = session('kept', '/project/b');
            await store.save([removed, kept]);
            store.unlinkFile = async () => { throw new Error('injected post-commit cleanup failure'); };
            await assert.rejects(() => store.deleteProject('/project/a'), error => error.domainError?.params.reason === 'store_removed_cleanup_failed');
            const path = join(store.root, 'manifest-v1.json');
            const committed = await readFile(path, 'utf8');
            const sourceFiles = (await readdir(store.root)).filter(name => name.startsWith('session-'));
            const sourceBytes = await Promise.all(sourceFiles.map(name => readFile(join(store.root, name), 'utf8')));
            await writeFile(path, raw);
            const reader = new ConversationStore(store.root);
            for (const operation of [
                () => reader.load(), () => reader.list(), () => reader.search({ query: 'question' }),
                () => reader.readSession(removed.id), () => reader.isDeletedSession(removed.id),
                () => reader.save([removed, kept]), () => reader.patch([removed], []),
                () => reader.deleteProject('/project/b'), () => reader.clear(),
            ]) await assert.rejects(operation, corrupt);
            assert.equal(await readFile(path, 'utf8'), raw);
            assert.deepEqual(await Promise.all(sourceFiles.map(name => readFile(join(store.root, name), 'utf8'))), sourceBytes);
            assert.equal((await readdir(store.root)).includes('corrupt'), false);
            await writeFile(path, committed);
            const recovered = new ConversationStore(store.root);
            assert.equal(await recovered.isDeletedSession(removed.id), true);
            assert.deepEqual((await recovered.list()).sessions.map(item => item.id), [kept.id]);
        });
    }
});

test('shard hashes are checked even after the manifest has been cached', async t => {
    const store = await storeFor(t);
    const original = session('original');
    await store.save([original]);
    const { manifestPath, shard, raw } = await shardManifest(store);
    const reader = new ConversationStore(store.root);
    assert.equal((await reader.list()).total, 1);
    const pointer = await readFile(manifestPath, 'utf8');
    // Syntactically valid JSON must still fail its content-addressed checksum.
    await writeFile(join(store.root, shard), JSON.stringify({ sessions: [] }));
    for (const operation of [
        () => reader.load(), () => reader.list(), () => reader.readSession(original.id),
        () => reader.search({ query: 'question' }), () => reader.patch([session('second')], []),
    ]) await assert.rejects(operation, corrupt);
    assert.equal(await readFile(manifestPath, 'utf8'), pointer);
    assert.equal((await readdir(store.root)).includes('corrupt'), false);
    await writeFile(join(store.root, shard), raw);
    assert.deepEqual(await reader.readSession(original.id), original);
});

test('shards cannot overlap deleted IDs or silently replace inline manifest entries', async t => {
    for (const mixed of [false, true]) {
        await t.test(mixed ? 'mixed inline and shards' : 'deleted ID overlap', async t => {
            const store = await storeFor(t);
            const original = session('original');
            await store.save([original]);
            const entry = JSON.parse(await readFile(join(store.root, 'manifest-v1.json'), 'utf8')).sessions[0];
            await shardManifest(store, pointer => mixed
                ? { ...pointer, sessions: [entry] }
                : { ...pointer, deletedSessionIds: [original.id] });
            await assert.rejects(() => new ConversationStore(store.root).load(), corrupt);
            assert.equal((await readdir(store.root)).includes('corrupt'), false);
        });
    }
});

test('legacy sharded manifests are expanded before atomic migration cleans old shards', async t => {
    const store = await storeFor(t);
    const originals = [session('first'), session('second')];
    await store.save(originals);
    await shardManifest(store, pointer => {
        delete pointer.createdByVersion;
        delete pointer.minimumReaderVersion;
        return pointer;
    });
    assert.deepEqual((await new ConversationStore(store.root).load()).sessions, originals);
    assert.deepEqual((await new ConversationStore(store.root).load()).sessions, originals);
    const backup = await readFile(join(store.root, 'manifest-v1.legacy-backup.json'), 'utf8');
    assert.equal(JSON.parse(backup).shardFiles, undefined, 'migration backup does not depend on collected shards');
    await writeFile(join(store.root, 'manifest-v1.json'), backup);
    assert.deepEqual((await new ConversationStore(store.root).load()).sessions, originals);
});

test('equal-time conflicting orphan generations remain intact and cannot be silently selected', async t => {
    const store = await storeFor(t);
    const original = session('same-id');
    const replacement = { ...original, turns: [...original.turns, { ...original.turns[0], id: 'turn-2', response: 'unique second reply' }] };
    const names = [];
    const contents = [original, replacement].map(value => JSON.stringify(value));
    for (const content of contents) {
        const name = `session-${createHash('sha256').update(original.id).digest('hex')}-${randomUUID()}.json`;
        names.push(name);
        await writeFile(join(store.root, name), content);
    }
    for (const operation of [() => store.load(), () => store.list(), () => store.patch([session('unrelated')], [])]) {
        await assert.rejects(operation, error => error.domainError?.params.reason === 'store_recovery_conflict');
        assert.deepEqual((await readdir(store.root)).sort(), [...names].sort());
        assert.deepEqual(await Promise.all(names.map(name => readFile(join(store.root, name), 'utf8'))), contents);
    }
});

test('identical orphan generations recover without quarantining valid copies', async t => {
    const store = await storeFor(t);
    const original = session('same-id');
    for (let i = 0; i < 2; i++) {
        const name = `session-${createHash('sha256').update(original.id).digest('hex')}-${randomUUID()}.json`;
        await writeFile(join(store.root, name), JSON.stringify(original));
    }
    assert.deepEqual((await store.load()).sessions, [original]);
    assert.equal((await readdir(store.root)).length, 2);
    assert.equal((await store.list()).total, 1);
});
